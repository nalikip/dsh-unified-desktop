# 上游反馈记录

本文件记录本项目向上游报告的问题及后续进展。

## [#498] Zero-delta WM_MOUSEMOVE keeps the control gate in `user` forever

- **仓库**：https://github.com/CursorTouch/Windows-MCP
- **链接**：https://github.com/CursorTouch/Windows-MCP/issues/498
- **提交时间**：2026-10-23
- **状态**：open
- **版本**：windows-mcp 0.8.8

### 问题

`physical_mouse()`（`control_hooks.py` 第 29 行）对每个鼠标钩子事件无条件刷新
`_last_physical_event`，包括坐标未变化的 `WM_MOUSEMOVE`。

部分无线接收器（实测 ASUS ROG OMNI RECEIVER）以约 15 ms 间隔上报零位移移动事件，
导致空闲计时永不满足，`ControlToolGate` 除 `ControlStatus` 外拒绝所有工具。

实测：10 秒内 1264 次鼠标钩子回调，光标坐标未变。

### 与已有 issue 的关系

| Issue | 内容 | 是否覆盖本问题 |
|---|---|---|
| #456 | 漏掉 key-up 导致 `_pressed` 残留 | ❌ 本问题 `_pressed` 为空 |
| #457 | 阈值硬编码 10 秒 | ❌ 降到 0.5 秒仍无效 |
| #460 | `StaleInputRecovery` 清理残留按键 | ❌ 无残留可清理 |
| #458 | `--no-control` / 可配置超时（已合并） | ⚠️ 是绕过方案，但见 #475 |
| #475 | 0.8.8 未包含 #458 的修复 | — |
| **#498** | **本报告** | — |

### 建议的修复

只把「坐标真实变化」或「非移动事件」算作用户活动：

```python
_pt = (data.pt.x, data.pt.y)
_moved = getattr(owner, "_last_point", None) != _pt
if _moved or wparam != 0x200:
    owner._last_physical_event = time.monotonic()
owner._last_point = _pt
```

### 本地状态

本项目已通过 `scripts/patch-backend.mjs` 应用等效修复，并有回归测试
（`test/backend-patch-test.mjs`）。

**如果上游接受，可考虑移除本地补丁，改用上游版本。**

### 进展

- 2026-10-23：提交 issue，等待回复。

### 相关文件

- `docs/repro/repro-zero-delta.py` — 独立复现脚本
- `docs/diagnosis-user-control.md` — 完整排查过程
- `scripts/patch-backend.mjs` — 本地补丁
- `docs/backend-patch.md` — 补丁说明
