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

[Unreleased]: https://github.com/your-org/dsh-unified-desktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/dsh-unified-desktop/releases/tag/v0.1.0
