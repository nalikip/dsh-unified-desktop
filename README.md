# dsh-unified-desktop

**一个 MCP 插件，统一两套 Windows 桌面自动化能力。**

把 [dsh-computer-use-win](https://github.com/Yu-tao-Li/dsh-computer-use-win)（UI Automation + OCR + 元素级语义操作）
和 [Windows-MCP](https://github.com/CursorTouch/Windows-MCP)（浏览器 DOM + 区域截图 + 应用启动）合并成**一个工具面**，
去重后暴露 29 个工具，模型看到 `mcp__desk__*`。

---

## 为什么需要它

分开装两个插件的结果：

| | 分开装 | 本插件 |
|---|---|---|
| MCP server 数 | 2 | **1** |
| 工具数 | 44 | **29** |
| 上下文占用 | ≈ 17,012 tokens | **≈ 6,749 tokens** |
| 能力重叠 | 严重（两套点击/输入/截图） | **已去重** |
| 危险工具 | 需额外守卫插件 | **内建** |

**省 60% 上下文，且能力不丢。**

## 架构

```
DSH ──stdio──> [aggregate.mjs] ──stdio──> wincu server.mjs
                              └─stdio──> windows-mcp.exe
```

聚合层负责三件事：

1. **合并工具面** —— 从两个后端拉 `tools/list`，按目录去重合并
2. **路由调用** —— `tools/call` 按目录映射到对应后端
3. **内建守卫** —— 危险参数在转发前拦截

## 能力分工

**选 wincu 的（它更强）**：

| 能力 | 为什么用 wincu |
|---|---|
| `snapshot` / `read_tree` / `find` | UIA 树 + RuntimeId 精确元素定位 |
| `ocr` | **只有 wincu 有**，Windows.Media.Ocr 字级坐标 |
| `click` / `double_click` | 优先走 UIA Invoke 模式，不抢焦点 |
| `invoke` / `set_value` | **只有 wincu 有**，UIA 语义操作 |
| `type_text` | 剪贴板路径支持中文，且恢复原剪贴板 |
| 窗口管理 | activate / close / move |

**选 windows-mcp 的（wincu 没有）**：

| 能力 | 用途 |
|---|---|
| `read_webpage` | **浏览器 DOM 模式**，读当前标签页，绕开反爬 |
| `screenshot` | 区域截图 `region` + 多屏 `display` |
| `launch_app` | 按开始菜单名启动应用 |
| `notify` | Windows toast 通知 |
| `clipboard` | 读写剪贴板 |
| `display_info` / `control_status` | 显示器信息、桌面控制权 |

## 不暴露的工具

**风险类**（内建守卫，且 DSH 原生工具已覆盖）：

| 工具 | 排除原因 |
|---|---|
| `PowerShell` | 任意命令执行；DSH 原生 `pwsh` 已覆盖且受策略管辖 |
| `Registry` | 直接改注册表，风险过高 |
| `FileSystem` | DSH 原生 `read`/`write`/`edit`/`glob`/`grep` 已覆盖 |
| `Process` | `kill` 风险高 |

**重复类**（已由 wincu 的更强实现替代）：

`Click`、`Type`、`Move`、`Scroll`、`Shortcut`、`Wait`、`WaitFor`、`Snapshot`、`MultiSelect`、`MultiEdit`

完整清单见 [lib/catalog.mjs](lib/catalog.mjs) 的 `EXCLUDED`。

## 工具清单（29 个）

**观察**
`snapshot` `screenshot` `read_tree` `element_info` `find` `ocr` `list_windows` `read_webpage` `display_info` `control_status` `health`

**鼠标键盘**
`click` `double_click` `type_text` `keypress` `scroll` `move_mouse` `drag` `set_value` `invoke` `focus`

**窗口**
`activate_window` `close_window` `move_window` `launch_app`

**等待**
`wait` `wait_for`

**系统**
`notify` `clipboard`

## 安装

**前置**：

```powershell
# 1. wincu（提供 UIA + OCR）
dsh plugin --profile web add dsh-computer-use-win

# 2. windows-mcp（提供 DOM + 应用启动）
uv tool install windows-mcp --python 3.14
```

**安装本插件**：

```powershell
dsh plugin --profile web add <本目录路径>
```

**重要**：本插件已聚合 wincu 的能力，需**禁用独立挂载的 wincu**避免工具重复。
在 profile 的 `cordis.patch.yml` 加：

```yaml
- id: mcp-dsh-computer-use-win
  disabled: true
```

重启 DSH，工具以 `mcp__desk__*` 出现。

## 设置项

| 项 | 默认 | 说明 |
|---|---|---|
| `enabledTools` | 全部 29 个 | 暴露哪些工具 |
| `guardEnabled` | `true` | 策略守卫开关 |
| `auditLog` | `true` | 写审计日志 |
| `wcuServerPath` | 自动探测 | wincu server.mjs 路径 |
| `wmExePath` | 自动探测 | windows-mcp.exe 路径 |
| `toolCallTimeoutMs` | `180000` | 工具超时 |

## 一个关键实现细节

**wincu 必须用 `.generations/live/` 下的真实路径启动，不能用 `profiles/web/node_modules` 的软链接。**

因为它的入口判断是：

```js
import.meta.url === pathToFileURL(process.argv[1]).href
```

软链接会让 `import.meta.url` 解析成真实路径，而 `argv[1]` 是链接路径，两者不等，
server 会**静默退出（exit 0，无任何输出）**。

本插件的 `resolveWcuServer()` 会自动优先选 `.generations` 路径。

## 测试

```powershell
node test/config-test.mjs       # 配置与路径解析（21 断言）
node test/aggregate-e2e.mjs     # 聚合与路由（13 断言）
node test/electron-verify.mjs   # DSH 真实运行时（7 断言）
```

## 已知限制

1. **不是沙箱**。守卫是正则黑名单，挡得住直白危险命令，挡不住刻意构造的绕过。
2. **wincu 升级可能破坏路径**。`resolveWcuServer` 按目录名前缀匹配，升级后版本号变化会自动重新探测。
3. **两个后端独立启动**。一个挂了另一个仍可用，但相应工具会缺失。
4. **DOM 模式依赖浏览器**。`read_webpage` 的 `use_dom` 需要 Chrome/Edge/Firefox 活动标签页。

## License

MIT。聚合层原创；能力来自两个上游项目（均为 MIT）。
