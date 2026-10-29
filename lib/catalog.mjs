// 统一工具目录：一个去重后的工具面，背后路由到两个后端。
//
// 设计原则：
//   1. 能力优先选「更强的实现」—— UIA 语义操作 > 坐标点击，OCR 只有 wincu 有
//   2. 名字统一用短名，不再有 windows_computer_use_ 前缀
//   3. 同一能力只暴露一次，避免模型选择困难
//   4. 参数做最小必要转换，尽量保持两边原生语义

/**
 * 每个条目：
 *   name        统一后的工具名
 *   backend     'wcu' | 'wm'
 *   target      后端原始工具名
 *   description 面向模型的描述
 *   inputSchema 面向模型的 schema（已归一化）
 *   transform   可选：把统一参数转成后端参数
 */
export const CATALOG = [
  // ══════════════ 观察 ══════════════
  {
    name: 'snapshot',
    backend: 'wcu',
    target: 'windows_computer_use_snapshot',
    description:
      'Capture a screenshot plus the UI Automation tree of the target (or foreground) window. ' +
      'This is the primary observation tool: it returns controls with element ids you can pass to click/type_text/set_value. ' +
      'Use captureWindow for a smaller image, and scope:"desktop" for all windows.',
    // 直接用 wincu 的 schema（已从后端实时获取后填充）
    inputSchema: null,
  },
  {
    name: 'screenshot',
    backend: 'wm',
    target: 'Screenshot',
    description:
      'Fast screenshot-first capture with cursor position and open-window summary, without UI tree extraction. ' +
      'Supports display=[0,1] for specific monitors and region=[left,top,right,bottom] to capture just a rectangle. ' +
      'Prefer this over snapshot when you only need visual context and want to save tokens.',
    inputSchema: null,
  },
  {
    name: 'read_tree',
    backend: 'wcu',
    target: 'windows_computer_use_accessibility_tree',
    description:
      'Read the UI Automation tree without taking a screenshot. Cheaper than snapshot when you only need structure.',
    inputSchema: null,
  },
  {
    name: 'element_info',
    backend: 'wcu',
    target: 'windows_computer_use_element_info',
    description: 'Inspect one UI Automation element by elementId or by physical screen coordinates.',
    inputSchema: null,
  },
  {
    name: 'find',
    backend: 'wcu',
    target: 'windows_computer_use_find',
    description:
      'Find UI Automation controls by name, automation id, class, value or control type. ' +
      'When the accessibility tree is sparse it automatically falls back to OCR; OCR hits carry SCREEN coordinates.',
    inputSchema: null,
  },
  {
    name: 'ocr',
    backend: 'wcu',
    target: 'windows_computer_use_ocr',
    description:
      'Read visible text with Windows OCR. Returns text, lines and word boxes in SCREEN coordinates. ' +
      'Use this when the app exposes no accessibility tree (games, custom-drawn UI, images).',
    inputSchema: null,
  },
  {
    name: 'list_windows',
    backend: 'wcu',
    target: 'windows_computer_use_list_windows',
    description: 'List native top-level windows with HWND, PID and responsiveness.',
    inputSchema: null,
  },
  {
    name: 'read_webpage',
    backend: 'wm',
    target: 'Scrape',
    description:
      'Read web page content. With use_dom=true it extracts the ACTIVE browser tab DOM ' +
      '(Chrome/Edge/Firefox) — use this for pages that block plain HTTP requests or need a signed-in session. ' +
      'Without use_dom it performs a lightweight HTTP fetch and returns a cleaned summary.',
    inputSchema: null,
  },
  {
    name: 'display_info',
    backend: 'wm',
    target: 'DisplayInventory',
    description: 'Read display layout, work areas, effective DPI and per-monitor scale factors.',
    inputSchema: null,
  },
  {
    name: 'control_status',
    backend: 'wm',
    target: 'ControlStatus',
    description:
      'Read who currently owns desktop control (user or AI) and the remaining idle wait. ' +
      'Call this if an action is rejected with USER_CONTROL.',
    inputSchema: null,
  },
  {
    name: 'health',
    backend: 'wcu',
    target: 'windows_computer_use_health',
    description: 'Check that the Windows UI Automation backend, screenshot capture and input stack are available.',
    inputSchema: null,
  },

  // ══════════════ 鼠标与键盘 ══════════════
  {
    name: 'click',
    backend: 'wcu',
    target: 'windows_computer_use_click',
    description:
      'Click an elementId (preferred: uses the UIA Invoke pattern in the background, no focus steal) ' +
      'or physical SCREEN coordinates. dispatch:"auto" picks the best path; raw-coordinate clicks self-correct if the window moved.',
    inputSchema: null,
  },
  {
    name: 'double_click',
    backend: 'wcu',
    target: 'windows_computer_use_double_click',
    description: 'Double-click an elementId or physical SCREEN coordinates.',
    inputSchema: null,
  },
  {
    name: 'type_text',
    backend: 'wcu',
    target: 'windows_computer_use_type_text',
    description:
      'Type text into the focused control. clipboard (default) handles CJK reliably and restores your clipboard; ' +
      'sendinput types per character without touching the clipboard.',
    inputSchema: null,
  },
  {
    name: 'keypress',
    backend: 'wcu',
    target: 'windows_computer_use_keypress',
    description: 'Press a key or chord, e.g. ["ctrl","a"], ["enter"], ["alt","f4"]. The Windows key is blocked by design.',
    inputSchema: null,
  },
  {
    name: 'scroll',
    backend: 'wcu',
    target: 'windows_computer_use_scroll',
    description: 'Scroll at an element or screen coordinate. Positive deltaY scrolls down.',
    inputSchema: null,
  },
  {
    name: 'move_mouse',
    backend: 'wcu',
    target: 'windows_computer_use_move',
    description: 'Move the pointer to an element or screen coordinate.',
    inputSchema: null,
  },
  {
    name: 'drag',
    backend: 'wcu',
    target: 'windows_computer_use_drag',
    description: 'Drag through a path of screen coordinates. The target window must be foreground.',
    inputSchema: null,
  },
  {
    name: 'set_value',
    backend: 'wcu',
    target: 'windows_computer_use_set_value',
    description:
      'Set a control value through the UIA ValuePattern — far more reliable than typing when the control supports it. ' +
      'Falls back to focus + type.',
    inputSchema: null,
  },
  {
    name: 'invoke',
    backend: 'wcu',
    target: 'windows_computer_use_invoke',
    description:
      'Invoke an element through Invoke/Toggle/SelectionItem/ExpandCollapse patterns, with click fallback. ' +
      'Prefer this over coordinate clicks for buttons and menu items.',
    inputSchema: null,
  },
  {
    name: 'focus',
    backend: 'wcu',
    target: 'windows_computer_use_focus',
    description: 'Set keyboard focus to a UI Automation element.',
    inputSchema: null,
  },

  // ══════════════ 窗口 ══════════════
  {
    name: 'activate_window',
    backend: 'wcu',
    target: 'windows_computer_use_activate_window',
    description: 'Bring a top-level window to the foreground by title substring, process id or HWND.',
    inputSchema: null,
  },
  {
    name: 'close_window',
    backend: 'wcu',
    target: 'windows_computer_use_close_window',
    description:
      'Close a window by posting WM_CLOSE (the app may show a save dialog). Safer than killing the process.',
    inputSchema: null,
  },
  {
    name: 'move_window',
    backend: 'wcu',
    target: 'windows_computer_use_move_window',
    description: 'Move (not resize) a window to screen coordinates without activating it.',
    inputSchema: null,
  },
  {
    name: 'launch_app',
    backend: 'wm',
    target: 'App',
    description:
      'Launch an application by Start Menu name or by executable path, or switch/resize an existing window. ' +
      'Use mode:"launch" to open, mode:"switch" to focus, mode:"resize" to change geometry.',
    inputSchema: null,
  },

  // ══════════════ 等待 ══════════════
  {
    name: 'wait',
    backend: 'wcu',
    target: 'windows_computer_use_wait',
    description: 'Pause for a short period before observing the UI again.',
    inputSchema: null,
  },
  {
    name: 'wait_for',
    backend: 'wcu',
    target: 'windows_computer_use_wait_for',
    description:
      'Wait until a window, a UIA element, or literal visible OCR text appears/disappears. ' +
      'Returns verification:"observed" only when the condition was actually met. ' +
      'Confirm text that appears only AFTER the desired effect, not the text you just typed.',
    inputSchema: null,
  },

  // ══════════════ 系统 ══════════════
  {
    name: 'notify',
    backend: 'wm',
    target: 'Notification',
    description: 'Send a Windows toast notification with a title and message.',
    inputSchema: null,
  },
  {
    name: 'clipboard',
    backend: 'wm',
    target: 'Clipboard',
    description: 'Read or set the Windows clipboard text.',
    inputSchema: null,
  },
]

/** 名称 → 条目 */
export const BY_NAME = new Map(CATALOG.map(e => [e.name, e]))

/** 按后端分组 */
export function groupByBackend() {
  const wcu = [], wm = []
  for (const e of CATALOG) (e.backend === 'wcu' ? wcu : wm).push(e.target)
  return { wcu, wm }
}

/**
 * 被刻意排除的后端工具（有替代或风险过高）。
 * 用于文档与校验，也说明「为什么不暴露」。
 *
 * kind 取值：
 *   duplicate  —— 能力重复，选了另一个后端的更强实现
 *   danger     —— 危险操作，两侧都不暴露
 *   management —— 工具管理入口，改由设置项管理
 */
export const EXCLUDED = Object.freeze([
  // wincu 的 tools 管理入口：统一插件自己管工具，不需要再暴露
  { tool: 'windows_computer_use_tools', kind: 'management', reason: '统一插件通过设置管理工具，无需运行时开关' },
  // winmcp 的危险/重复工具
  { tool: 'PowerShell', kind: 'danger', reason: '任意命令执行；DSH 原生 pwsh 工具已覆盖且受策略管辖' },
  { tool: 'Registry', kind: 'danger', reason: '直接改注册表；风险过高且无替代价值' },
  { tool: 'FileSystem', kind: 'danger', reason: 'DSH 原生 read/write/edit/glob/grep 已覆盖且受沙箱管辖' },
  { tool: 'Process', kind: 'danger', reason: 'DSH 原生 pwsh 可查进程；kill 风险高' },
  { tool: 'Click', kind: 'duplicate', reason: '已由 wincu 的 click 替代（支持 UIA 语义操作，更可靠）' },
  { tool: 'Type', kind: 'duplicate', reason: '已由 wincu 的 type_text 替代（支持 CJK 剪贴板）' },
  { tool: 'Move', kind: 'duplicate', reason: '已由 wincu 的 move 替代' },
  { tool: 'Scroll', kind: 'duplicate', reason: '已由 wincu 的 scroll 替代' },
  { tool: 'Shortcut', kind: 'duplicate', reason: '已由 wincu 的 keypress 替代' },
  { tool: 'Wait', kind: 'duplicate', reason: '已由 wincu 的 wait 替代' },
  { tool: 'WaitFor', kind: 'duplicate', reason: '已由 wincu 的 wait_for 替代（支持 UIA 元素与 OCR 文本）' },
  { tool: 'Snapshot', kind: 'duplicate', reason: '部分能力已由 screenshot + snapshot 覆盖；DOM 模式并入 read_webpage' },
  { tool: 'MultiSelect', kind: 'duplicate', reason: '使用频率低，可用多次 click 替代' },
  { tool: 'MultiEdit', kind: 'duplicate', reason: '使用频率低，可用多次 type_text 替代' },
])

/** 按 kind 统计被移除的工具数 */
export function excludedCounts() {
  const out = { duplicate: 0, danger: 0, management: 0 }
  for (const e of EXCLUDED) out[e.kind] = (out[e.kind] || 0) + 1
  return out
}
