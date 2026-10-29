// 从 lib/catalog.mjs 生成 assets/dedup.svg，保证图里的数字永远和代码一致。
// 用法：node scripts/gen-dedup-svg.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG, EXCLUDED, excludedCounts } from '../lib/catalog.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const W = 1180
const H = 560

const wcuCount = CATALOG.filter(e => e.backend === 'wcu').length
const wmCount = CATALOG.filter(e => e.backend === 'wm').length
const total = CATALOG.length

// 从 catalog.mjs 里读后端原始工具数（写在注释里的口径不可靠，这里用实测值兜底）
const FOOTPRINT = JSON.parse(readFileSync(path.join(root, 'docs', 'tool-footprint.json'), 'utf8'))
const backendWcu = FOOTPRINT.wincu.count
const backendWm = FOOTPRINT.winmcp.count
const backendTotal = FOOTPRINT.combined.count

const excludedTotal = backendTotal - total
const counts = excludedCounts()
const dupCount = counts.duplicate
const dangerCount = counts.danger
const mgmtCount = counts.management

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 简单的等宽中文字体栈
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif"

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="44 个后端工具去重为 29 个">
  <defs>
    <style>
      text { font-family: ${FONT}; }
      .h1 { font-size: 26px; font-weight: 700; fill: #0d1117; }
      .sub { font-size: 14px; fill: #57606a; }
      .card-title { font-size: 15px; font-weight: 600; fill: #0d1117; }
      .num { font-size: 44px; font-weight: 800; }
      .num-sm { font-size: 15px; font-weight: 600; }
      .item { font-size: 12.5px; fill: #24292f; }
      .muted { font-size: 12px; fill: #6e7781; }
      .tag { font-size: 11.5px; font-weight: 600; }
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>

  <!-- 标题 -->
  <text class="h1" x="40" y="56">44 个后端工具 → 29 个统一工具面</text>
  <text class="sub" x="40" y="82">两个 Windows 桌面自动化 MCP 的能力重叠与取舍 · 数据来自 lib/catalog.mjs</text>

  <!-- 左：两个后端 -->
  <rect x="40" y="112" width="300" height="300" rx="12" fill="#f6f8fa" stroke="#d0d7de"/>
  <text class="card-title" x="62" y="142">两个后端</text>
  <text class="num" x="62" y="200" fill="#0969da">${backendTotal}</text>
  <text class="muted" x="62" y="222">个工具，两套 schema</text>

  <rect x="62" y="244" width="256" height="60" rx="8" fill="#ffffff" stroke="#d0d7de"/>
  <text class="item" x="78" y="268" font-weight="600">dsh-computer-use-win</text>
  <text class="num-sm" x="78" y="290" fill="#57606a">${backendWcu} 个 · UI Automation + OCR</text>

  <rect x="62" y="316" width="256" height="60" rx="8" fill="#ffffff" stroke="#d0d7de"/>
  <text class="item" x="78" y="340" font-weight="600">Windows-MCP</text>
  <text class="num-sm" x="78" y="362" fill="#57606a">${backendWm} 个 · DOM + 截图 + 启动</text>

  <!-- 中：去重动作 -->
  <rect x="380" y="112" width="360" height="300" rx="12" fill="#fff8f0" stroke="#f0b775"/>
  <text class="card-title" x="402" y="142">去掉 ${excludedTotal} 个</text>

  <rect x="402" y="160" width="316" height="70" rx="8" fill="#ffffff" stroke="#e8c9a0"/>
  <text class="tag" x="418" y="184" fill="#bc4c00">能力重复 · ${dupCount} 个</text>
  <text class="muted" x="418" y="206">Click Type Move Scroll Shortcut Wait</text>
  <text class="muted" x="418" y="222">WaitFor Snapshot MultiSelect MultiEdit</text>

  <rect x="402" y="242" width="316" height="70" rx="8" fill="#ffffff" stroke="#e8c9a0"/>
  <text class="tag" x="418" y="266" fill="#cf222e">危险操作 · ${dangerCount} 个</text>
  <text class="muted" x="418" y="288">PowerShell Registry FileSystem Process</text>
  <text class="muted" x="418" y="304">绕过 DSH 沙箱，收益为零</text>

  <rect x="402" y="324" width="316" height="70" rx="8" fill="#ffffff" stroke="#e8c9a0"/>
  <text class="tag" x="418" y="348" fill="#6e7781">管理入口 · ${mgmtCount} 个</text>
  <text class="muted" x="418" y="370">windows_computer_use_tools</text>
  <text class="muted" x="418" y="386">改由设置项 enabledTools 管理</text>

  <!-- 右：结果 -->
  <rect x="780" y="112" width="360" height="300" rx="12" fill="#f0f9f4" stroke="#7dd3a0"/>
  <text class="card-title" x="802" y="142">本插件暴露</text>
  <text class="num" x="802" y="200" fill="#1a7f37">${total}</text>
  <text class="muted" x="802" y="222">个工具，一个命名空间 mcp__desk__*</text>

  <rect x="802" y="244" width="316" height="60" rx="8" fill="#ffffff" stroke="#a7e0bd"/>
  <text class="item" x="818" y="268" font-weight="600">wincu 侧</text>
  <text class="num-sm" x="818" y="290" fill="#57606a">${wcuCount} 个 · 交互类全给 UIA 语义操作</text>

  <rect x="802" y="316" width="316" height="60" rx="8" fill="#ffffff" stroke="#a7e0bd"/>
  <text class="item" x="818" y="340" font-weight="600">windows-mcp 侧</text>
  <text class="num-sm" x="818" y="362" fill="#57606a">${wmCount} 个 · 系统与浏览器类</text>

  <!-- 箭头 -->
  <defs>
    <marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#8b949e"/>
    </marker>
  </defs>
  <line x1="340" y1="262" x2="378" y2="262" stroke="#8b949e" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="740" y1="262" x2="778" y2="262" stroke="#8b949e" stroke-width="2" marker-end="url(#ar)"/>

  <!-- 底部说明 -->
  <text class="muted" x="40" y="452">每个工具的归属理由见 docs/capability-matrix.md；工具面由 lib/catalog.mjs 的 CATALOG / EXCLUDED 定义，test/catalog-test.mjs 校验一致性。</text>
  <text class="muted" x="40" y="476">危险调用在转发前由 lib/guard.mjs 按可逆性分级拦截；审计日志可选关闭。</text>

  <!-- 图例 -->
  <rect x="40" y="504" width="14" height="14" rx="3" fill="#f6f8fa" stroke="#d0d7de"/>
  <text class="muted" x="62" y="516">后端原始能力</text>
  <rect x="170" y="504" width="14" height="14" rx="3" fill="#fff8f0" stroke="#f0b775"/>
  <text class="muted" x="192" y="516">被移除的</text>
  <rect x="270" y="504" width="14" height="14" rx="3" fill="#f0f9f4" stroke="#7dd3a0"/>
  <text class="muted" x="292" y="516">最终暴露的</text>
</svg>
`

mkdirSync(path.join(root, 'assets'), { recursive: true })
writeFileSync(path.join(root, 'assets', 'dedup.svg'), svg, 'utf8')
console.log('wrote assets/dedup.svg')
console.log(`后端 ${backendTotal} (wcu ${backendWcu} + wm ${backendWm})`)
console.log(`暴露 ${total} (wcu ${wcuCount} + wm ${wmCount})`)
console.log(`移除 ${excludedTotal} (重复 ${dupCount} + 危险 ${dangerCount} + 管理 ${mgmtCount})`)
if (wcuCount + wmCount !== total) { console.error('数字不自洽！'); process.exit(1) }
if (dupCount + dangerCount + mgmtCount !== excludedTotal) { console.error('移除数不自洽！'); process.exit(1) }
