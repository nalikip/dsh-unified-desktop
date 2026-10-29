// 用 DSH 的真实方式（Electron 运行时）验证统一插件
import { spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const AGG = path.join(here, '..', 'lib', 'aggregate.mjs')

// Electron 可执行文件：优先环境变量，其次从当前 DSH 进程推断，最后回退常见安装位置
const ELECTRON = process.env.UD_ELECTRON
  || (process.env.PORTABLE_EXECUTABLE_FILE ?? '')
  || (process.versions.electron ? process.execPath : '')
  || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'dsh-desktop', 'DSH Desktop.exe')

const WCU = process.env.UD_WCU_SERVER || path.join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles',
  '.generations', 'live', 'dsh-computer-use-win+0.5.0+b20332af32af',
  'node_modules', 'dsh-computer-use-win', 'mcp', 'server.mjs')
const WM = path.join(process.env.APPDATA, 'uv', 'tools', 'windows-mcp', 'Scripts', 'windows-mcp.exe')

for (const [l, p] of [['electron', ELECTRON], ['agg', AGG], ['wcu', WCU], ['wm', WM]]) {
  if (!existsSync(p)) { console.error('缺少', l, p); process.exit(1) }
}

const child = spawn(ELECTRON, [AGG], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    UD_WCU_SERVER: WCU,
    UD_WM_EXE: WM,
    UD_GUARD: '1',
  },
  windowsHide: true,
})

child.stderr.on('data', d => {
  const s = d.toString().trim()
  if (s && !s.includes('ready') && !s.includes('INFO')) process.stderr.write('[agg] ' + s + '\n')
})

let buf = ''
const pending = new Map()
child.stdout.on('data', c => {
  buf += c.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
})

let seq = 0
const rpc = (method, params, t = 120000) => {
  const id = ++seq
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(method + ' timeout')) }, t)
    pending.set(id, m => { clearTimeout(timer); res(m) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

let pass = 0, fail = 0
const check = (l, a, e) => { if (a === e) { pass++; console.log(`  ✓ ${l}`) } else { fail++; console.log(`  ✗ ${l}: 期望 ${e} 实际 ${a}`) } }

console.log('=== 用 DSH 的 Electron 运行时验证 ===\n')

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v', version: '1' } })
check('initialize', init.result?.serverInfo?.name, 'unified-desktop')
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const list = await rpc('tools/list', {})
const tools = list.result?.tools ?? []
console.log(`\n  工具数: ${tools.length}`)
const chars = JSON.stringify({ tools }).length
console.log(`  体积: ${chars.toLocaleString()} 字符 ≈ ${Math.round(chars / 3.6).toLocaleString()} tokens`)

check('工具数 29', tools.length, 29)
check('wcu 工具存在', tools.some(t => t.name === 'snapshot'), true)
check('wm 工具存在', tools.some(t => t.name === 'read_webpage'), true)

console.log('\n  路由测试:')
const h = await rpc('tools/call', { name: 'health', arguments: {} })
check('health (wcu)', (h.result?.content?.[0]?.text ?? '').includes('"ok":true'), true)

const c = await rpc('tools/call', { name: 'control_status', arguments: {} })
const ct = c.result?.content?.[0]?.text ?? ''
check('control_status (wm)', ct.length > 5, true)
console.log(`    ${ct.slice(0, 80)}`)

const ocr = await rpc('tools/call', { name: 'list_windows', arguments: {} })
check('list_windows (wcu)', (ocr.result?.content?.[0]?.text ?? '').length > 10, true)

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`)
child.kill()
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 500)
