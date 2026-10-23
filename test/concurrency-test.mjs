// 并发串行化回归测试：多个 tools/call 同时发出，结果不能串号。
//
// 背景：aggregate 的 stdin data 回调原本是 async，多个请求会并发写进同一后端，
// 导致响应 id 交错。修复后使用 Promise 队列串行处理，本测试确保修复有效。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const aggregate = path.join(here, '..', 'lib', 'aggregate.mjs')
const wcuServer = path.join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles',
  '.generations', 'live', 'dsh-computer-use-win+0.5.0+b20332af32af',
  'node_modules', 'dsh-computer-use-win', 'mcp', 'server.mjs')
const wmExe = path.join(process.env.APPDATA, 'uv', 'tools', 'windows-mcp', 'Scripts', 'windows-mcp.exe')

for (const [l, p] of [['aggregate', aggregate], ['wcu', wcuServer], ['wm', wmExe]]) {
  if (!existsSync(p)) { console.error(`缺少 ${l}: ${p}`); process.exit(1) }
}

const child = spawn(process.execPath, [aggregate], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    UD_WCU_SERVER: wcuServer,
    UD_WM_EXE: wmExe,
    UD_GUARD: '1',
  },
})
child.stderr.on('data', () => {})

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
function rpc(method, params, timeout = 180000) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method}#${id} timeout`)) }, timeout)
    pending.set(id, m => { clearTimeout(t); resolve({ id, msg: m }) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

let pass = 0, fail = 0
const check = (l, a, e) => {
  if (a === e) { pass++; console.log(`  ✓ ${l}`) }
  else { fail++; console.log(`  ✗ ${l}: 期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`) }
}

console.log('=== 初始化 ===')
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conc', version: '1' } })
check('initialize', init.msg.result?.serverInfo?.name, 'unified-desktop')
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const list = await rpc('tools/list', {})
const tools = list.msg.result?.tools ?? []
check('tools/list 正常', tools.length, 29)

console.log('\n=== 并发 10 个混合后端调用 ===')
// 同时发出：5 个走 wcu，5 个走 wm，验证响应不串号
const jobs = []
for (let i = 0; i < 5; i++) {
  jobs.push({ kind: 'wcu', p: rpc('tools/call', { name: 'health', arguments: {} }) })
  jobs.push({ kind: 'wm', p: rpc('tools/call', { name: 'control_status', arguments: {} }) })
}

const settled = await Promise.allSettled(jobs.map(j => j.p))

let ok = 0, mismatch = 0
settled.forEach((s, idx) => {
  const kind = jobs[idx].kind
  if (s.status !== 'fulfilled') { console.log(`  ✗ job#${idx} ${kind} rejected: ${s.reason?.message}`); mismatch++; return }
  const text = s.value.msg.result?.content?.[0]?.text ?? ''
  // wcu 的 health 返回 JSON 带 "ok":true；wm 的 control_status 返回 "state"
  if (kind === 'wcu') {
    if (text.includes('"ok":true')) ok++
    else { console.log(`  ✗ job#${idx} 期望 wcu health，实际: ${text.slice(0, 90)}`); mismatch++ }
  } else {
    if (text.includes('"state"')) ok++
    else { console.log(`  ✗ job#${idx} 期望 wm control_status，实际: ${text.slice(0, 90)}`); mismatch++ }
  }
})

check('10 个并发调用全部返回', settled.filter(s => s.status === 'fulfilled').length, 10)
check('无响应串号', mismatch, 0)
check('路由全部正确', ok, 10)

console.log('\n=== 并发后仍可正常调用 ===')
const after = await rpc('tools/call', { name: 'health', arguments: {} })
check('并发后 health 正常', (after.msg.result?.content?.[0]?.text ?? '').includes('"ok":true'), true)

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`)
child.kill()
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 500)
