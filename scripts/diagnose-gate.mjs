#!/usr/bin/env node
// 诊断工具：检查 windows-mcp 桌面控制门的实时状态。
//
// 用于排查 USER_CONTROL 问题。不修改任何文件，只读。
//
// 用法：
//   node scripts/diagnose-gate.mjs
//
// 输出：
//   - 补丁是否应用
//   - 当前控制状态（ready / user / unavailable）
//   - 如果持续是 user，报告是哪个钩子在触发

import { existsSync, readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

const SITE = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Lib', 'site-packages', 'windows_mcp')
const CONTROL = path.join(SITE, 'desktop', 'control.py')
const HOOKS = path.join(SITE, 'desktop', 'control_hooks.py')
const PY = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Scripts', 'python.exe')
const EXE = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Scripts', 'windows-mcp.exe')

console.log('=== 1. 环境 ===')
if (!existsSync(CONTROL)) {
  console.error('未安装 windows-mcp。请先：uv tool install windows-mcp --python 3.14')
  process.exit(1)
}
console.log('  安装目录:', SITE)

console.log('\n=== 2. 补丁状态 ===')
const controlText = readFileSync(CONTROL, 'utf8').replace(/^\uFEFF/, '')
const hooksText = existsSync(HOOKS) ? readFileSync(HOOKS, 'utf8').replace(/^\uFEFF/, '') : ''
const p1 = controlText.includes('_IDLE_THRESHOLD')
const p2 = hooksText.includes('_UD_LAST_POINT')
console.log(`  阈值补丁 (control.py)     : ${p1 ? '✓ 已应用' : '✗ 未应用'}`)
console.log(`  钩子补丁 (control_hooks.py): ${p2 ? '✓ 已应用' : '✗ 未应用'}`)
if (!p1 || !p2) {
  console.log('\n  修复：node scripts/patch-backend.mjs')
}

console.log('\n=== 3. 钩子触发统计（5 秒）===')
if (!existsSync(PY)) {
  console.log('  跳过：找不到 python.exe')
} else {
  const script = `
import os, time, ctypes
os.environ.setdefault("WINDOWS_MCP_IDLE_THRESHOLD", "0.5")
from windows_mcp.desktop.control import get_controller
c = get_controller()
counts = {"mouse": 0, "key": 0, "raw": 0}
om, ok_, oraw = c._physical_mouse, c._physical_key, c._raw_input
def m(a, b, d): counts["mouse"] += 1; return om(a, b, d)
def k(a, b, d): counts["key"] += 1; return ok_(a, b, d)
def r(d): counts["raw"] += 1; return oraw(d)
c._physical_mouse, c._physical_key, c._raw_input = m, k, r
c.start()
states = []
for _ in range(10):
    time.sleep(0.5)
    st = c.status()
    states.append(st["state"])
c.stop()
print("counts", counts)
print("states", ",".join(states))
print("ready_ratio", f"{states.count('ready')/len(states):.2f}")
`
  const r = spawnSync(PY, ['-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  const out = r.stdout || ''
  const countsLine = out.split('\n').find(l => l.startsWith('counts'))
  const statesLine = out.split('\n').find(l => l.startsWith('states'))
  const ratioLine = out.split('\n').find(l => l.startsWith('ready_ratio'))
  if (countsLine) console.log('  ' + countsLine)
  if (statesLine) console.log('  ' + statesLine)
  if (ratioLine) console.log('  ' + ratioLine)

  if (ratioLine) {
    const ratio = parseFloat(ratioLine.split(' ')[1])
    console.log('')
    if (ratio === 0) {
      console.log('  ⚠ 5 秒内从未 ready。如果有大量 mouse 事件但你没动鼠标，')
      console.log('    说明钩子补丁未生效或有设备在高频上报。')
    } else if (ratio < 0.3) {
      console.log('  ⚠ ready 时间占比较低，你可能正在频繁操作电脑。')
    } else {
      console.log('  ✓ 控制门工作正常。')
    }
  }
}

console.log('\n=== 4. MCP 层实测 ===')
if (!existsSync(EXE)) {
  console.log('  跳过：找不到 windows-mcp.exe')
  process.exit(0)
}

const child = spawn(EXE, ['serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, ANONYMIZED_TELEMETRY: 'false', WINDOWS_MCP_IDLE_THRESHOLD: '0.5' },
})
let buf = ''
const pending = new Map()
let seq = 0
child.stdout.on('data', d => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } } catch {}
  }
})
child.stderr.on('data', () => {})
const rpc = (method, params) => new Promise(r => {
  const id = ++seq
  pending.set(id, r)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'diag', version: '1' } })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
await new Promise(r => setTimeout(r, 2000))

for (const name of ['ControlStatus', 'DisplayInventory']) {
  const res = await rpc('tools/call', { name, arguments: {} })
  const blocked = res.result?.isError === true
  const text = String(res.result?.content?.[0]?.text ?? '').slice(0, 60).replace(/\n/g, ' ')
  console.log(`  ${name.padEnd(18)} ${blocked ? '✗ BLOCKED' : '✓ OK     '} ${text}`)
}

child.kill()
process.exit(0)
