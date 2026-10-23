# 诊断记录：桌面控制门为什么几乎不可用

本文档记录 2026-10-23 排查 windows-mcp 4.1.3 `USER_CONTROL` 问题的完整过程与数据。
结论已固化为 `scripts/patch-backend.mjs`，此文档保留证据链供后续维护参考。

## 症状

在真实 DSH 会话中调用 `mcp__desk__*` 的 wm 后端工具：

```
mcp__desk__display_info   → Error: {"code": "USER_CONTROL", "status": {"state": "user", ...}}
mcp__desk__screenshot     → Error: {"code": "USER_CONTROL", ...}
mcp__desk__read_webpage   → Error: {"code": "USER_CONTROL", ...}
mcp__desk__control_status → OK  {"state":"user","generation":2,"wait_seconds":9.98}
```

只有 `ControlStatus` 可用，其余全部被拒。

## 第一层：10 秒硬编码

`windows_mcp/desktop/control.py` 的 `ControlToolGate` 要求用户连续空闲 10 秒：

```python
# 5 处硬编码
max(0.0, max(self._last_user, self._last_physical_event) + 10.0 - now)   # L151
if self._state == "ready" and now - self._last_physical_event < 10.0:    # L207
and now - max(self._last_user, self._last_physical_event) >= 10.0        # L214
if now - self._last_physical_event < 10.0:                               # L226
recent_input = ... now - self._last_physical_event < 10.0                # L348
```

`ControlConfig` 只有 `mouse_takeover_units` / `mouse_takeover_pixels`，**没有空闲阈值配置项**。

第一处补丁把 5 处 `10.0` 和 1 处 `15.0` 改成环境变量可覆盖。

## 第二层：改阈值也没用（关键发现）

把阈值降到 0.5 秒后，`wait_seconds` 确实从 9.98 变成 0.49，但**工具仍被拒**。

连续轮询 `ControlStatus` 观察到状态反复横跳：

```
0: state=ready wait=0.00
1: state=ready wait=0.00
2: state=ready wait=0.00
3: state=user  wait=0.50   ← 突然变回 user
4: state=user  wait=0.50
...
```

### 定位：钩子被高频触发

在控制器上挂 spy 记录 `_handle` 收到的事件类型：

```
4 秒内收到 256 个事件
  tick: 256
```

`tick` 是消息循环的心跳（`control_win32.py` L303 `owner._handle(("tick",))`），
每约 15ms 一次。但 `tick` 不写 `_last_physical_event`，所以不是它。

继续挂 spy 到三个钩子：

```
10 秒内：
  mouse: 1264
  key:   0
  raw:   335
```

**鼠标钩子 10 秒被调用 1264 次，而光标坐标完全没变。**

### 根因：无线接收器的无位移上报

`control_hooks.py` 的 `physical_mouse` 对每个鼠标事件无条件执行：

```python
owner._last_physical_event = time.monotonic()
```

设备信息确认是 **ROG OMNI RECEIVER**（华硕无线接收器）。这类设备以高频率上报
`WM_MOUSEMOVE`，即使光标没有移动。结果 `_last_physical_event` 被每 15ms 刷新，
空闲判定 `now - _last_physical_event >= 阈值` 永远不成立 —— **阈值降到多小都没用**。

## 修复

`control_hooks.py` 只把「坐标真实变化」或「非移动事件」算作用户活动：

```python
_pt = (data.pt.x, data.pt.y)
_moved = getattr(owner, "_UD_LAST_POINT", None) != _pt
if _moved or wparam != 0x200:
    owner._last_physical_event = time.monotonic()
owner._UD_LAST_POINT = _pt
```

## 验证

模拟钩子调用的单元测试（不依赖真实鼠标）：

| 场景 | 期望 | 结果 |
|---|---|---|
| 30 次同坐标上报 | 时间戳不变 | ✓ |
| 坐标真实变化 | 时间戳更新 | ✓ |
| 鼠标按键（坐标不变） | 时间戳更新 | ✓ |

真实环境（重启 DSH 后）：

```
mcp__desk__control_status  → {"state":"ready","wait_seconds":0.0}   ← 之前是 9.98
mcp__desk__display_info    → 成功返回显示器信息                      ← 之前被拒
mcp__desk__screenshot      → 成功返回截图                            ← 之前被拒
mcp__desk__read_webpage    → "No DOM information found..."           ← 之前被拒
```

## 排查工具

如果以后再次遇到类似问题，可用以下方法定位：

```powershell
# 1. 看当前状态
node scripts/patch-backend.mjs --check

# 2. 连续观察状态变化
#    在 DSH 里反复调用 mcp__desk__control_status，
#    如果 wait_seconds 固定在某个值附近不动 → 有设备在持续上报

# 3. 确认是哪个钩子
#    在 control.py 的 _handle 上挂 spy 记录 event[0]，
#    统计 key / mouse / raw / tick 的比例
```

## 教训

1. **先测真实环境，别只看文档**。README 说默认策略是 `relaxed`，实际 4.1.3 的行为是
   「除 ControlStatus 外全部 gate」。
2. **改了一个参数没效果时，要查数据来源**。阈值生效了（`wait_seconds` 变了）但结果没变，
   说明瓶颈在别处。
3. **高频设备事件容易被忽略**。1264 次/10 秒看起来像心跳，实际是真实硬件上报。
