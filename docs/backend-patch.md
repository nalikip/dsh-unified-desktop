# 后端补丁：让桌面控制门真正可用

## 问题

windows-mcp 4.1.3 的桌面控制门（`ControlToolGate`）要求**用户连续空闲 10 秒**才授予 AI 控制权。
除 `ControlStatus` 外的所有工具都会返回 `USER_CONTROL` 错误。

对「用户坐在电脑前用 AI」这个场景，这等于 **wm 后端几乎完全不可用**。

### 更深一层的原因

即使把 10 秒阈值降到 0.5 秒，实测**仍然被拦**。原因是：

部分无线鼠标接收器（实测为 **ROG OMNI RECEIVER**）会以极高频率上报 `WM_MOUSEMOVE`，
**即使光标坐标没有变化**。而 `control_hooks.py` 的 `physical_mouse` 对每个鼠标事件都无条件执行：

```python
owner._last_physical_event = time.monotonic()
```

结果 `_last_physical_event` 被每 15ms 刷新一次，空闲判定 `now - _last_physical_event >= 阈值`
永远不成立 —— **阈值降到多小都没用**。

实测数据：10 秒内收到 1264 次 mouse 钩子调用，坐标完全没变。

## 两处补丁

### 补丁 1：`desktop/control.py` —— 阈值可配置

把 5 处硬编码的 `10.0` 和 1 处 `15.0` 改成环境变量可覆盖：

```python
import os as _os

_IDLE_THRESHOLD = float(_os.getenv("WINDOWS_MCP_IDLE_THRESHOLD", "10.0"))
_LEASE_SECONDS = float(_os.getenv("WINDOWS_MCP_LEASE_SECONDS", "15.0"))
```

默认值保持上游的 10 秒，不影响未使用本插件的人。

### 补丁 2：`desktop/control_hooks.py` —— 忽略无位移移动

```python
# 修改前
valid = True
owner._last_physical_event = time.monotonic()

# 修改后
valid = True
_pt = (data.pt.x, data.pt.y)
_moved = getattr(owner, "_UD_LAST_POINT", None) != _pt
if _moved or wparam != 0x200:
    owner._last_physical_event = time.monotonic()
owner._UD_LAST_POINT = _pt
```

只把**坐标真实变化**或**非移动事件**（按键、滚轮）算作用户活动。

## 使用

```powershell
# 打补丁
node scripts/patch-backend.mjs

# 检查状态
node scripts/patch-backend.mjs --check

# 还原
node scripts/patch-backend.mjs --revert
```

打完后重启 DSH 生效。

## 验证

补丁逻辑有独立单元测试（模拟钩子调用，不依赖真实鼠标）：

```
场景 A：50 次同坐标上报  → 时间戳不变   ✓（修复核心问题）
场景 B：坐标真实变化     → 时间戳更新   ✓
场景 C：鼠标按键         → 时间戳更新   ✓
```

## 升级注意

`uv tool upgrade windows-mcp` 会**覆盖**这两个文件，补丁丢失。升级后重新执行：

```powershell
node scripts/patch-backend.mjs
```

插件启动时不会自动检查补丁（避免启动时改文件），但 wm 工具会退回上游行为（10 秒门）。

## 风险与取舍

**降低阈值的代价**：AI 可能在你正在打字或移动鼠标时抢占输入。

| 阈值 | 体验 |
|---|---|
| `0.5` 秒 | 几乎无感，但可能与你抢鼠标 |
| `2` 秒 | 短暂停顿后接管，误抢概率低（**推荐**） |
| `10` 秒 | 上游默认，最安全但基本不可用 |

在插件设置里调 `idleThresholdSeconds`。

**安全边界不变**：控制门只控制「时机」，不是权限。危险工具
（`PowerShell` / `Registry` / `FileSystem` / `Process`）已被插件从工具面排除。

## 为什么不直接 fork windows-mcp

可以，但要维护一个 Python 分支并跟随上游更新。补丁方案：

- 改动小（约 12 行），易审计
- 默认行为不变（不改环境变量时与上游一致）
- 可一键还原
- 升级后重跑脚本即可

代价是升级会丢补丁，需要重新执行。
