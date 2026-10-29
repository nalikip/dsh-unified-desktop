"""Minimal reproduction: zero-delta WM_MOUSEMOVE keeps the desktop gate closed.

Run against an UNPATCHED windows_mcp install:

    python repro-zero-delta.py

Expected (buggy):  _last_physical_event advances on every call even though
                   the cursor never moves, so the idle window never opens.
Expected (fixed):  _last_physical_event stays put for repeated identical points.

No Windows session, no real mouse and no MCP client is required: the hook
callback is called directly with a synthetic MSLLHOOKSTRUCT.

Attribution: the MSLLHOOKSTRUCT / POINT ctypes layout below mirrors the
structures used by windows_mcp (MIT License, Copyright (c) CursorTouch,
https://github.com/CursorTouch/Windows-MCP). Only the field layout is reused,
which is dictated by the Win32 API, not by the upstream implementation.
"""

import ctypes
import time

from windows_mcp.desktop import control_hooks


class Pt(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MouseHookData(ctypes.Structure):
    _fields_ = [
        ("pt", Pt),
        ("mouseData", ctypes.c_ulong),
        ("flags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


class Owner:
    """Minimal stand-in for ControlCoordinator."""

    def __init__(self):
        self._last_physical_event = 0.0
        self._mouse_down = set()
        self._suppress = False
        self._emergency = False
        self._deadline = 0.0
        self._mouse_hook = None
        self._delivered_mouse = set()

    def _queue(self, event):
        pass

    def _fail_open(self):
        pass


def fire_mouse(owner, x, y, wparam=0x200):
    """Deliver one WM_MOUSEMOVE (0x200) at (x, y)."""
    data = MouseHookData()
    data.pt = Pt(x, y)
    data.mouseData = 0
    data.flags = 0  # 0 = not injected, i.e. treated as physical input
    data.time = 0
    data.dwExtraInfo = 0
    control_hooks.physical_mouse(owner, 0, wparam, ctypes.addressof(data))


def main():
    owner = Owner()

    fire_mouse(owner, 500, 500)
    first = owner._last_physical_event
    print(f"after 1st move at (500,500): _last_physical_event={first:.6f}")

    time.sleep(0.05)
    for _ in range(20):
        fire_mouse(owner, 500, 500)  # identical coordinates
    after = owner._last_physical_event

    print(f"after 20 repeats at (500,500): _last_physical_event={after:.6f}")
    moved = after > first
    print(f"timestamp advanced: {moved}")
    print()
    if moved:
        print("BUG REPRODUCED: identical-coordinate mouse events reset the idle timer.")
        print("A device streaming zero-delta motion keeps the gate closed forever.")
    else:
        print("OK: identical-coordinate events do not reset the idle timer.")

    # Control: a real move must still count as activity.
    owner2 = Owner()
    fire_mouse(owner2, 500, 500)
    t1 = owner2._last_physical_event
    time.sleep(0.05)
    fire_mouse(owner2, 520, 530)
    print()
    print(f"real move updates timestamp: {owner2._last_physical_event > t1} (must be True)")

    # Control: a button press must still count even without movement.
    owner3 = Owner()
    fire_mouse(owner3, 500, 500)
    t2 = owner3._last_physical_event
    time.sleep(0.05)
    fire_mouse(owner3, 500, 500, wparam=0x201)  # WM_LBUTTONDOWN
    print(f"button press updates timestamp: {owner3._last_physical_event > t2} (must be True)")


if __name__ == "__main__":
    main()
