// 目录一致性测试：确保 catalog 与实际后端工具对得上。
// 这是防止「改了一边忘了另一边」的关键保障。
import { CATALOG, BY_NAME, EXCLUDED, groupByBackend } from '../lib/catalog.mjs'

let pass = 0, fail = 0
const check = (l, a, e) => {
  if (JSON.stringify(a) === JSON.stringify(e)) { pass++; console.log(`  ✓ ${l}`) }
  else { fail++; console.log(`  ✗ ${l}: 期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`) }
}
const ok = (l, cond) => check(l, Boolean(cond), true)

console.log('=== 结构完整性 ===')
ok('CATALOG 非空', CATALOG.length > 0)
ok('条目数 29', CATALOG.length === 29)
ok('工具名唯一', new Set(CATALOG.map(e => e.name)).size === CATALOG.length)
ok('每个条目有 backend', CATALOG.every(e => e.backend === 'wcu' || e.backend === 'wm'))
ok('每个条目有 target', CATALOG.every(e => typeof e.target === 'string' && e.target.length > 0))
ok('每个条目有 description', CATALOG.every(e => typeof e.description === 'string' && e.description.length > 20))

console.log('\n=== 命名规范 ===')
ok('全部小写蛇形', CATALOG.every(e => /^[a-z][a-z0-9_]*$/.test(e.name)))
ok('无 windows_computer_use_ 前缀', CATALOG.every(e => !e.name.includes('windows_computer_use')))
ok('无驼峰命名', CATALOG.every(e => !/[A-Z]/.test(e.name)))

console.log('\n=== BY_NAME 索引 ===')
ok('BY_NAME 大小一致', BY_NAME.size === CATALOG.length)
ok('BY_NAME 可查', BY_NAME.get('snapshot')?.backend === 'wcu')
ok('BY_NAME 可查 wm', BY_NAME.get('read_webpage')?.backend === 'wm')
ok('未知工具返回 undefined', BY_NAME.get('nope') === undefined)

console.log('\n=== 后端分组 ===')
const { wcu, wm } = groupByBackend()
ok('wcu 组非空', wcu.length > 0)
ok('wm 组非空', wm.length > 0)
ok('两组之和等于总数', wcu.length + wm.length === CATALOG.length)
ok('wcu 全部指向 wincu 工具', wcu.every(t => t.startsWith('windows_computer_use_')))
ok('wm 全部无前缀', wm.every(t => !t.startsWith('windows_computer_use_')))

console.log('\n=== 关键能力覆盖（不能丢） ===')
for (const name of ['snapshot', 'ocr', 'click', 'type_text', 'invoke', 'set_value', 'find']) {
  ok(`保留 wcu 能力: ${name}`, BY_NAME.get(name)?.backend === 'wcu')
}
for (const name of ['read_webpage', 'screenshot', 'launch_app', 'notify', 'clipboard', 'display_info']) {
  ok(`保留 wm 能力: ${name}`, BY_NAME.get(name)?.backend === 'wm')
}

console.log('\n=== 危险工具必须不暴露 ===')
for (const danger of ['PowerShell', 'Registry', 'FileSystem', 'Process']) {
  ok(`不暴露 ${danger}`, !CATALOG.some(e => e.name === danger || e.target === danger))
  ok(`${danger} 在 EXCLUDED 中有记录`, EXCLUDED.some(e => e.tool === danger))
}

console.log('\n=== EXCLUDED 记录完整 ===')
ok('EXCLUDED 非空', EXCLUDED.length > 0)
ok('每条都有原因', EXCLUDED.every(e => typeof e.reason === 'string' && e.reason.length > 5))
const excludedNames = new Set(EXCLUDED.map(e => e.tool))
const targetNames = new Set(CATALOG.map(e => e.target))
const overlap = [...excludedNames].filter(n => targetNames.has(n))
check('EXCLUDED 与 CATALOG 无重叠', overlap, [])

console.log('\n=== 无重复 target（同一后端工具只映射一次）===')
const byBackendTarget = new Map()
let dup = []
for (const e of CATALOG) {
  const key = `${e.backend}:${e.target}`
  if (byBackendTarget.has(key)) dup.push(key)
  byBackendTarget.set(key, e.name)
}
check('无重复 target', dup, [])

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
