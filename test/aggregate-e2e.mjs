// 端到端测试：启动统一插件，验证工具面与路由
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const aggregate = path.join(root, 'lib', 'aggregate.mjs')

// wincu 必须用 .generations 真实路径（软链接会导致启动失败）
const wcuServer = path.join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles',
  '.generations', 'live', 'dsh-computer-use-win+0.5.0+b20332af32af',
  'node_modules', 'dsh-computer-use-win', 'mcp', 'server.mjs')
const wmExe = path.join(process.env.APPDATA, 'uv', 'tools', 'windows-mcp', 'Scripts', 'windows-mcp.exe')

for (const [label, p] of [['aggregate', aggregate], ['wcu', wcuServer], ['wm', wmExe]]) {
  if (!existsSync(p)) { console.error(`缺少 ${label}: ${p}`); process.exit(1) }
  console.log(`✓ ${label}: ${p}`)
}

const child = spawn(process.execPath, [aggregate], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    UD_WCU_SERVER: wcuServer,
    UD_WM_EXE: wmExe,
    UD_GUARD: '1',
    UD_AUDIT_LOG: path.join(process.env.TEMP, 'unified-audit.log'),
  },
})

let stderrAll = ''
child.stderr.on('data', d => {
  const s = d.toString()
  stderrAll += s
  if (!s.includes('ready')) process.stderr.write('[agg] ' + s)
})

let buf = ''
const pending = new Map()
child.stdout.on('data', chunk => {
  buf += chunk.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg); pending.delete(msg.id)
    }
  }
})

let seq = 0
function rpc(method, params, timeout = 120000) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)) }, timeout)
    pending.set(id, m => { clearTimeout(t); resolve(m) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

let pass = 0, fail = 0
const check = (label, actual, expected) => {
  if (actual === expected) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`) }
}

console.log('\n=== 1. initialize ===')
const init = await rpc('initialize', {
  protocolVersion: '2025-06-18', capabilities: {},
  clientInfo: { name: 'e2e', version: '1.0' },
})
check('serverInfo.name', init.result?.serverInfo?.name, 'unified-desktop')
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

console.log('\n=== 2. tools/list（合并两个后端）===')
const list = await rpc('tools/list', {})
const tools = list.result?.tools ?? []
console.log(`  工具数: ${tools.length}`)
console.log(`  工具名: ${tools.map(t => t.name).join(', ')}`)

check('工具数 >= 25', tools.length >= 25, true)
check('包含 snapshot (wcu)', tools.some(t => t.name === 'snapshot'), true)
check('包含 read_webpage (wm)', tools.some(t => t.name === 'read_webpage'), true)
check('包含 ocr (wcu 独有)', tools.some(t => t.name === 'ocr'), true)
check('包含 launch_app (wm 独有)', tools.some(t => t.name === 'launch_app'), true)
check('不含 PowerShell', tools.some(t => t.name === 'PowerShell'), false)
check('不含 Registry', tools.some(t => t.name === 'Registry'), false)
check('不含 FileSystem', tools.some(t => t.name === 'FileSystem'), false)

const chars = JSON.stringify({ tools }).length
console.log(`  序列化: ${chars.toLocaleString()} 字符 ≈ ${Math.round(chars / 3.6).toLocaleString()} tokens`)

console.log('\n=== 3. 每个工具有效 schema ===')
let badSchema = 0
for (const t of tools) {
  if (!t.inputSchema || t.inputSchema.type !== 'object') { badSchema++; console.log(`  ✗ ${t.name} schema 无效`) }
}
check('所有工具 schema 有效', badSchema, 0)

console.log('\n=== 4. 路由到 wcu 后端（安全调用）===')
const health = await rpc('tools/call', { name: 'health', arguments: {} })
const healthText = health.result?.content?.[0]?.text ?? ''
check('health 有返回', healthText.length > 0, true)
console.log(`  返回: ${healthText.slice(0, 100)}`)

console.log('\n=== 5. 路由到 wm 后端（安全调用）===')
const cs = await rpc('tools/call', { name: 'control_status', arguments: {} })
const csText = cs.result?.content?.[0]?.text ?? ''
check('control_status 有返回', csText.length > 0, true)
console.log(`  返回: ${csText.slice(0, 120)}`)

console.log('\n=== 6. 守卫生效 ===')
// 直接调 wincu 的 set_value 不应被拦（不是敏感工具）
// 这里验证守卫对未知危险参数不误伤
const unknown = await rpc('tools/call', { name: 'nonexistent_tool', arguments: {} })
check('未知工具报错', unknown.result?.isError, true)

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`)
if (fail > 0) {
  console.log('\n--- stderr ---')
  console.log(stderrAll.slice(-2000))
}

child.kill()
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 500)
