# 能力归属矩阵

这份文档回答一个问题：**两套后端都能做同一件事时，为什么留这一个。**

它不是配置说明，而是踩坑记录。每一条「为什么」都对应一次实测。

---

## 总览

| | 后端原始工具 | 本插件暴露 | 差值 |
|---|---|---|---|
| dsh-computer-use-win（wincu） | 23 | **22** | −1 |
| Windows-MCP（windows-mcp） | 21 | **7** | −14 |
| 合计 | **44** | **29** | **−15** |

15 个被移除的工具分三类：

| 类别 | 数量 | 处理 |
|---|---|---|
| 能力重复，选了更强的实现 | 10 | 移除 windows-mcp 一侧 |
| 危险操作（任意命令、改注册表、删文件、杀进程） | 4 | 两侧都不暴露 |
| 工具管理入口 | 1 | 插件自己管，不需要运行时开关 |

---

## 一、选 wincu 的能力（22 个）

wincu 基于 UI Automation，能拿到**元素语义**而不只是坐标。这是它赢的根本原因。

### 观察

| 工具 | 为什么是 wincu |
|---|---|
| `snapshot` | UIA 树 + RuntimeId 精确元素定位，返回的 elementId 可直接喂给 click/type_text |
| `read_tree` | 只读树不截图，比 snapshot 省 token |
| `element_info` | 能按 elementId 或屏幕坐标反查元素属性 |
| `find` | 按 name/automationId/class 找控件；树稀疏时**自动降级 OCR**，OCR 结果带屏幕坐标 |
| `ocr` | **只有 wincu 有**。走 Windows.Media.Ocr，返回字级坐标框 |
| `list_windows` | 列出顶层窗口的 HWND/PID/是否响应 |
| `health` | 探测 UIA、截图、输入栈是否可用 |

### 鼠标键盘

| 工具 | 为什么是 wincu |
|---|---|
| `click` | **优先走 UIA Invoke 模式，不抢焦点**。坐标点击在窗口移动后会打偏，它自带自校正 |
| `double_click` | 同上 |
| `type_text` | **剪贴板路径支持中文**，且用后恢复原剪贴板内容。sendinput 模式可逐字符输入不碰剪贴板 |
| `keypress` | 支持组合键；Windows 键被刻意屏蔽 |
| `scroll` | 支持按元素或坐标滚动 |
| `move_mouse` | 支持按元素或坐标移动 |
| `drag` | 支持路径拖拽 |
| `set_value` | **只有 wincu 有**。走 UIA ValuePattern，比模拟键盘输入可靠得多 |
| `invoke` | **只有 wincu 有**。走 Invoke/Toggle/SelectionItem/ExpandCollapse 模式 |
| `focus` | 设置 UIA 元素焦点 |

### 窗口

| 工具 | 为什么是 wincu |
|---|---|
| `activate_window` | 按标题子串 / PID / HWND 定位 |
| `close_window` | 发 WM_CLOSE 而不是杀进程，让应用有机会弹保存框 |
| `move_window` | 移动但不激活，避免抢焦点 |

### 等待

| 工具 | 为什么是 wincu |
|---|---|
| `wait` | 简单延时 |
| `wait_for` | **能等 UIA 元素或 OCR 文本出现/消失**，且只在条件真满足时返回 `verification:"observed"` |

---

## 二、选 windows-mcp 的能力（7 个）

这 7 个 wincu 完全没有，是 windows-mcp 独有的。

| 工具 | 为什么是 windows-mcp |
|---|---|
| `read_webpage` | **浏览器 DOM 模式**。`use_dom=true` 能读当前标签页，绕开反爬、复用登录态。wincu 做不到 |
| `screenshot` | 支持 `region=[left,top,right,bottom]` 区域截图和 `display=[0,1]` 多屏选择。wincu 的截图只能整窗 |
| `display_info` | 读显示器布局、工作区、DPI、每屏缩放比 |
| `control_status` | 读桌面控制权归属（user / AI）和剩余空闲等待 |
| `launch_app` | 按开始菜单名启动，或 switch/resize 已有窗口 |
| `notify` | Windows toast 通知（需要 app_id） |
| `clipboard` | 读写剪贴板文本 |

---

## 三、被移除的 15 个

### 3.1 危险操作（4 个，两侧都不暴露）

| 工具 | 为什么不暴露 |
|---|---|
| `PowerShell` | 任意命令执行。DSH 原生 `pwsh` 已覆盖，且**受 DSH 沙箱与审批管辖**；MCP server 是独立进程，沙箱管不到它 |
| `Registry` | 直接改注册表，风险过高且无替代价值 |
| `FileSystem` | DSH 原生 `read`/`write`/`edit`/`glob`/`grep` 已覆盖且受沙箱管辖 |
| `Process` | `kill` 风险高；查进程用 DSH 原生 `pwsh` 即可 |

> 核心判断：**保留它们等于开一条绕过沙箱的通道，收益为零。**

### 3.2 能力重复（10 个，移除 windows-mcp 一侧）

| 被移除 | 由谁替代 | 理由 |
|---|---|---|
| `Click` | wincu `click` | 支持 UIA 语义操作，不抢焦点 |
| `Type` | wincu `type_text` | 支持 CJK 剪贴板路径 |
| `Move` | wincu `move_mouse` | 支持按元素定位 |
| `Scroll` | wincu `scroll` | 支持按元素定位 |
| `Shortcut` | wincu `keypress` | 支持组合键与按键校验 |
| `Wait` | wincu `wait` | 等价 |
| `WaitFor` | wincu `wait_for` | 支持 UIA 元素与 OCR 文本两种条件 |
| `Snapshot` | `screenshot` + `snapshot` | DOM 模式并入 `read_webpage`，树模式用 wincu 的 |
| `MultiSelect` | 多次 `click` | 使用频率低，不值得占 schema |
| `MultiEdit` | 多次 `type_text` | 同上 |

### 3.3 管理入口（1 个）

| 被移除 | 理由 |
|---|---|
| `windows_computer_use_tools` | 本插件通过设置项 `enabledTools` 管理工具，不需要运行时开关 |

---

## 四、为什么不反过来（选 windows-mcp 做主力）

反过来的方案是：让 windows-mcp 当主力，wincu 只补 OCR 和 UIA 语义操作。

**否决理由**：

1. **windows-mcp 的每个工具 schema 都很大**。实测 21 个工具占 4,921 tokens，而 wincu 的 23 个占 56,678 tokens——看起来 wincu 更贵，但 wincu 的工具**信息量大**（UIA 树、元素定位、语义操作），这些是替代不了的。
2. **wincu 的工具数量少但能力强**。22 个工具覆盖了全部交互类操作，windows-mcp 的 10 个交互工具全是它的弱化版。
3. **windows-mcp 的独有能力集中在"窗口/系统层面"**（DOM 读取、区域截图、应用启动、通知、剪贴板），这些和 wincu 的能力**不重叠**，正好互补。

所以正确的分法是：**交互类全给 wincu，系统与浏览器类全给 windows-mcp**，重叠部分一律砍 windows-mcp 那一侧。

---

## 五、一个反面案例：为什么不去重 schema

理论上还能再省——两个后端的参数命名不同（wincu 用 `elementId`，windows-mcp 用 `loc`/`label`），归一化后 schema 可以更小。

**没做，原因**：

- 归一化意味着要在聚合层重写每个工具的 schema，一旦上游改参数就得跟着改
- 现在的做法是「原样透传」，上游升级只需要更新 `target` 名字，聚合层不动
- 省下来的 token 有限，但维护成本会翻倍

这条记在 [CHANGELOG](CHANGELOG.md) 的 `Unreleased` 里，属于已知的未做项。

---

## 六、这张表怎么用

**如果你只想装一个后端**：装 wincu 就够日常交互；需要读网页 DOM 或区域截图时再补 windows-mcp。

**如果你想改工具面**：改 `lib/catalog.mjs` 的 `CATALOG` 或 `EXCLUDED`，然后跑 `node test/catalog-test.mjs`——它会校验命名规范、去重、以及 `EXCLUDED` 与 `CATALOG` 不重叠。

**如果你在评估要不要用这个插件**：看你是否同时装了这两个后端。只装一个的话，本插件的价值就只剩守卫层，不如直接用原插件。

---

## 附：关于 token 数字

仓库里曾出现「17,012 → 6,749 tokens」的说法，这个数字**来源不明、无法复现**，已在 README 与 CHANGELOG 中更正。

可复现的只有一项：44 个工具的 schema 合计 **61,599 tokens**（`docs/tool-footprint.json`，2026-10-22 实测）。去重后的准确数值需要重新跑 `tools/list` 统计，本项目暂未提供。
