Thanks — #460 and #458 together cover a lot of ground. I want to add a **third** way the gate can stay in `user` that I think is still uncovered, because it is not a missed release and it is not the user actually being active.

Short version: on hardware that streams **zero-delta `WM_MOUSEMOVE`**, `physical_mouse()` refreshes `_last_physical_event` on every callback even though the cursor never moves. The idle window then never elapses, so `_tick_locked()` never promotes `user` → `ready`. `_pressed` / `_mouse_down` are empty the whole time, so `StaleInputRecovery` has nothing to reconcile and #460 does not help. Lowering the idle timeout does not help either — I tried 0.5 s and the gate still never opened.

## How this differs from #456

| | #456 | this report |
|---|---|---|
| Latched by | a missed key/button **release** | continuous **zero-delta motion** events |
| `_pressed` / `_mouse_down` | non-empty (stale entry) | **empty** |
| `wait_seconds` | pinned to `0` | pinned just **under** the threshold (~0.49 at 0.5 s idle) |
| #460 `StaleInputRecovery` | fixes it | **does not apply** (no residual holds to clear) |
| Fixed by #458 escape hatch | yes | yes |

So this is orthogonal to both existing fixes. #458 is still the workaround.

## Environment

- Windows 11 25H2, build 26100
- `windows-mcp` **0.8.8** from PyPI (`uv tool install windows-mcp --python 3.14`), Python 3.14.7
- Pointing device: **ASUS ROG OMNI RECEIVER** (wireless dongle)
- MCP `serverInfo.version` reports `4.1.3` — that is FastMCP's version, not the package version (cost me a minute, maybe worth clarifying in bug reports)
- No remote-desktop or macro software running; no elevated hooks

## Observed behaviour

Every tool except `ControlStatus` rejected, indefinitely:

```
ControlStatus      -> OK      {"state":"user","generation":2,"wait_seconds":9.986}
DisplayInventory   -> BLOCKED {"code":"USER_CONTROL", ...}
Screenshot         -> BLOCKED {"code":"USER_CONTROL", ...}
Wait               -> BLOCKED {"code":"USER_CONTROL", ...}
ReadWebpage        -> BLOCKED {"code":"USER_CONTROL", ...}
```

With `WINDOWS_MCP_CONTROL_IDLE_TIMEOUT=0.5` (or my local equivalent), `wait_seconds` drops to `0.49` and stays there — it never reaches 0.

Unlike #456, `state` here is **not** frozen in a latched sense; it genuinely re-enters `user` over and over:

```
state=ready wait=0.00
state=ready wait=0.00
state=user  wait=0.50   <- flipped back
state=user  wait=0.50
...
```

## Instrumented evidence

I wrapped the three hook entry points (`_physical_mouse`, `_physical_key`, `_raw_input`) with counters and left the machine idle for 10 s:

```
counts {'mouse': 1264, 'key': 0, 'raw': 335}
states user,user,user,user,user,user,user,user,user,user
ready_ratio 0.00
```

**1264 mouse-hook callbacks in 10 seconds (~15 ms apart) with the cursor never moving.**

I also checked the message-loop heartbeat — `owner._handle(("tick",))` in `control_win32.py` fires at a similar rate (256 events / 4 s) but does **not** touch `_last_physical_event`, so it is not the cause.

## Root cause

`windows_mcp/desktop/control_hooks.py`, `physical_mouse()` (lines 18–53), **line 29**:

```python
valid = True
owner._last_physical_event = time.monotonic()   # <-- unconditional, every event
if wparam == 0x200 and owner._suppress:
    ...
```

and `control.py` `_tick_locked()` (line 206 ff.):

```python
if self._state == "ready" and now - self._last_physical_event < 10.0:
    self._last_user = self._last_physical_event
    return self._set_locked("user")
...
if (self._state == "user" and not self._pressed and not self._mouse_down
        and now - max(self._last_user, self._last_physical_event) >= 10.0):
    return self._set_locked("ready")
```

`_pressed` and `_mouse_down` are both empty, so only the timestamp matters — and it is refreshed every ~15 ms.

## Reproduction (no mouse, no MCP client, no display needed)

Calls the hook callback directly with a synthetic `MSLLHOOKSTRUCT`. On **unpatched** 0.8.8:

```python
import ctypes, time
from windows_mcp.desktop import control_hooks

class Pt(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

class MouseHookData(ctypes.Structure):
    _fields_ = [("pt", Pt), ("mouseData", ctypes.c_ulong), ("flags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_void_p)]

class Owner:
    def __init__(self):
        self._last_physical_event = 0.0
        self._mouse_down = set(); self._suppress = False; self._emergency = False
        self._deadline = 0.0; self._mouse_hook = None; self._delivered_mouse = set()
    def _queue(self, event): pass
    def _fail_open(self): pass

def fire(owner, x, y, wparam=0x200):
    d = MouseHookData()
    d.pt = Pt(x, y); d.mouseData = 0; d.flags = 0   # 0 = not injected
    d.time = 0; d.dwExtraInfo = 0
    control_hooks.physical_mouse(owner, 0, wparam, ctypes.addressof(d))

o = Owner()
fire(o, 500, 500)
t0 = o._last_physical_event
time.sleep(0.05)
for _ in range(20):
    fire(o, 500, 500)          # identical coordinates
print("advanced:", o._last_physical_event > t0)
```

Result on 0.8.8:

```
advanced: True
```

## Suggested fix

Treat an event as activity only when the pointer actually moved, or when it is not a move event at all:

```python
valid = True
# Some wireless receivers stream zero-delta WM_MOUSEMOVE; those must not
# reset the idle timer or the gate can never open.
_pt = (data.pt.x, data.pt.y)
_moved = getattr(owner, "_last_point", None) != _pt
if _moved or wparam != 0x200:
    owner._last_physical_event = time.monotonic()
owner._last_point = _pt
if wparam == 0x200 and owner._suppress:
    ...
```

With this applied, the same snippet prints `advanced: False`, while a real move `(500,500) -> (520,530)` and a button press at unchanged coordinates still update the timestamp (I verified both).

Notes:
- Lazy `getattr` avoids touching `__init__`; a proper `self._last_point = None` there is fine too.
- `_queue(("point", ...))` is intentionally untouched — the takeover-distance logic in `_handle()` already tolerates repeated identical points.
- Behaviour is unchanged for devices that report real motion.

## Workaround for anyone hitting this on 0.8.8

#458's `--no-control` / `WINDOWS_MCP_CONTROL_IDLE_TIMEOUT` are the right answer, but per #475 they are **not in the 0.8.8 PyPI release**. Until a new release is cut, users on affected hardware have to monkey-patch `physical_mouse` locally or avoid the gated tools.

Happy to open a PR with the fix plus the snippet above as a regression test if that is welcome — the test needs no display or real input, so it should fit the existing fixtures.
