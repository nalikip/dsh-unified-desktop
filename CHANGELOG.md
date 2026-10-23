# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 计划中
- 工具参数归一化：统一 `window` 选择参数，屏蔽两个后端的命名差异
- 后端健康探测：`health` 工具汇总两个后端状态
- 支持自定义工具目录（通过配置文件扩展 `catalog.mjs`）
- Linux/macOS 后端适配调研

## [0.1.0] - 2026-10-23

首个可用版本。已在 DSH Desktop（Windows 11 25H2 26100）实测通过。

### 新增

**聚合架构**
- 单一 MCP 入口（`mcp__desk__*`），背后驱动 wincu 与 windows-mcp 两个后端
- 工具面去重合并：44 个工具 → 29 个
- 上下文占用从 ≈17,012 tokens 降至 ≈6,749 tokens（-60%）

**能力覆盖**
- wincu 侧：`snapshot` `read_tree` `find` `ocr` `element_info` `click` `double_click`
  `type_text` `keypress` `scroll` `move_mouse` `drag` `set_value` `invoke` `focus`
  `activate_window` `close_window` `move_window` `wait` `wait_for` `list_windows` `health`
- windows-mcp 侧：`read_webpage`（DOM 模式）`screenshot`（区域/多屏）`launch_app`
  `notify` `clipboard` `display_info` `control_status`

**安全**
- 内建策略守卫，按可逆性分级拦截危险操作
- 危险工具不暴露：`PowerShell` `Registry` `FileSystem` `Process`
- 审计日志（JSONL，可选关闭）

**健壮性**
- 并发串行化：Promise 队列保证请求不串号（有专门回归测试）
- 后端崩溃/超时自动重置，下次调用重新拉起
- 两个后端相互隔离，一个挂了另一个仍可用

**关键修复**
- wincu 必须用 `.generations/live/` 真实路径启动。软链接会导致其入口判断
  `import.meta.url === pathToFileURL(process.argv[1]).href` 失败而静默退出（exit 0，无输出）。
  `resolveWcuServer()` 自动优先选择真实路径。

### 测试

5 个套件、90 个断言，全部通过：

| 套件 | 断言数 | 覆盖 |
|---|---|---|
| `catalog-test.mjs` | 43 | 目录一致性、去重、危险工具排除 |
| `config-test.mjs` | 21 | 配置校验、路径解析 |
| `aggregate-e2e.mjs` | 13 | 工具面合并、双后端路由 |
| `concurrency-test.mjs` | 6 | 并发不串号 |
| `electron-verify.mjs` | 7 | DSH 真实 Electron 运行时 |

### 已知限制

- 守卫是正则黑名单，不是沙箱；挡得住直白危险命令，挡不住刻意构造的绕过
- `read_webpage` 的 DOM 模式依赖 Chrome/Edge/Firefox 活动标签页
- wincu 升级后路径前缀变化会自动重新探测，但未在跨大版本升级场景验证

### 修复：桌面控制门几乎不可用

实测发现 windows-mcp 4.1.3 在真实使用中**几乎无法工作**：除 `ControlStatus` 外的
所有工具都返回 `USER_CONTROL`。定位到两个叠加原因：

1. 上游硬编码「用户连续空闲 10 秒」才授予控制权
2. 部分无线鼠标接收器（实测 ROG OMNI RECEIVER）以每 15ms 频率上报**无位移**的
   `WM_MOUSEMOVE`，导致 `_last_physical_event` 被持续刷新，空闲判定永不成立

新增 `scripts/patch-backend.mjs` 两处补丁：

- `control.py`：把 5 处 `10.0` 和 1 处 `15.0` 改成环境变量可配置（默认值不变）
- `control_hooks.py`：只把「坐标真实变化」或「非移动事件」算作用户活动

支持 `--check` / `--revert`，幂等，有单元测试覆盖三种场景。

同时新增设置项 `idleThresholdSeconds`（默认 0.5 秒）。

[Unreleased]: https://github.com/your-org/dsh-unified-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/dsh-unified-desktop/releases/tag/v0.1.0
