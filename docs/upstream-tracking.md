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
- 2026-10-25：维护者 `Jeomon` 回复 **"make a PR"**。
- 2026-10-25：提交 PR [#508]。
  - 分支：`nalikip:fix/zero-delta-mouse-motion`
  - 基线：`CursorTouch:main` @ `0db91ff`
  - 改动：3 文件，+151 −4（`control.py` +1、`control_hooks.py` +17/−4、新增测试 133 行）
  - 实现方式与本地补丁不同：不是「坐标变化或非移动事件」，而是
    **光标基线 + 按键变化或真实位移**才算活动，同时让注入事件也更新基线，
    避免 AI 移动光标后静止设备被误判。零位移 raw 报告同样丢弃。
  - 测试：新增 `tests/test_control_zero_delta_motion.py`（8 例）；
    本地全量 `1335 passed, 6 skipped`。
- 2026-10-25：PR 曾被误关闭，已重开，现为 **open / mergeable**。

### CI 状态（截至 2026-10-25）

| 运行 | 结论 | 说明 |
|---|---|---|
| #241 `Tests` | `failure` | **不是测试失败**。页面注明：`This workflow run required approval but was not approved before it expired.` 首次贡献者需维护者手动批准 workflow |
| 第二次 `Tests` | `action_required` | 同上，等待维护者批准 |

**即 CI 尚未真正执行过本项目代码。** 需要维护者点一次 "Approve and run"。

### 本地验证的一个坑

在本机跑 `pytest` 时 `test_scrape_ssrf.py` 有 1 例失败，原因不是代码：
`safe_get()` 内部用 `requests.Session()`，默认 `trust_env=True`，会读取
**WinINET 系统代理**。系统代理开启时 `rebind.example` 的请求被转发到代理，
返回 502 而非预期的 200。

验证方法：临时把 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
的 `ProxyEnable` 置 0 后重跑，**13 例全过**。这与 PR 描述中「DNS 行为差异」的
说法不准确，实际是系统代理。**CI 上该测试在 `main` 是绿的，因此与本 PR 无关。**

### 相关文件

- `docs/repro/repro-zero-delta.py` — 独立复现脚本
- `docs/diagnosis-user-control.md` — 完整排查过程
- `scripts/patch-backend.mjs` — 本地补丁
- `docs/backend-patch.md` — 补丁说明

[#508]: https://github.com/CursorTouch/Windows-MCP/pull/508
