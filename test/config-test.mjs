import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// dsh-plugin.mjs 顶部 import @deepseek-ai/schemastery。真实环境中由 DSH 宿主提供；
// 独立跑测试时可能缺失，这里按需生成一个最小 stub，保证测试在 CI 上也能跑。
const STUB = path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'schemastery')
if (!existsSync(path.join(STUB, 'index.js'))) {
  mkdirSync(STUB, { recursive: true })
  writeFileSync(path.join(STUB, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/schemastery', version: '0.0.0-stub', type: 'module',
    main: 'index.js', exports: './index.js',
  }))
  writeFileSync(path.join(STUB, 'index.js'), `
function make() {
  const state = { __default: undefined }
  const self = new Proxy(state, {
    get(t, k) {
      if (k === 'toString') return () => 'stub'
      if (k === 'default') return v => { state.__default = v; return self }
      if (k === '~standard') return undefined
      return () => self
    },
  })
  return self
}
const z = { string: () => make(), number: () => make(), boolean: () => make(), array: () => make(), object: () => make(), const: () => make(), union: () => make() }
export default z
`)
  console.log('(已生成 schemastery stub 供测试使用)')
}

const mod = await import(pathToFileURL(path.join(process.cwd(), 'lib', 'dsh-plugin.mjs')).href)

let pass = 0, fail = 0
const check = (l, a, e) => { if (a === e) { pass++; console.log(`  ✓ ${l}`) } else { fail++; console.log(`  ✗ ${l}: 期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`) } }

console.log('=== 导出 ===')
check('name', mod.name, 'unified-desktop')
check('apply 是函数', typeof mod.apply, 'function')
check('bridgeConfig 是函数', typeof mod.bridgeConfig, 'function')

console.log('\n=== 路径解析（关键）===')
const wcu = mod.resolveWcuServer('')
console.log('  wincu:', wcu)
check('wincu 存在', existsSync(wcu), true)
check('wincu 用 .generations 路径（不是软链接）', wcu.includes('.generations'), true)

const wm = mod.resolveWmExe('')
console.log('  winmcp:', wm)
check('winmcp 存在', existsSync(wm), true)

console.log('\n=== bridgeConfig ===')
const cfg = mod.bridgeConfig({})
check('serverName', cfg.serverName, 'desk')
check('transport', cfg.transport, 'stdio')
check('command 是 node', cfg.command, process.execPath)
check('args 指向 aggregate.mjs', /aggregate\.mjs$/.test(cfg.args[0]), true)
check('aggregate.mjs 存在', existsSync(cfg.args[0]), true)
check('UD_WCU_SERVER 已注入', cfg.env.UD_WCU_SERVER, wcu)
check('UD_WM_EXE 已注入', cfg.env.UD_WM_EXE, wm)
check('守卫默认开', cfg.env.UD_GUARD, '1')
check('遥测关闭', cfg.env.ANONYMIZED_TELEMETRY, 'false')

const enabled = JSON.parse(cfg.env.UD_ENABLED_TOOLS)
check('工具数 29', enabled.length, 29)
check('含 snapshot', enabled.includes('snapshot'), true)
check('含 read_webpage', enabled.includes('read_webpage'), true)

console.log('\n=== 设置校验 ===')
const off = mod.bridgeConfig({ guardEnabled: false })
check('关闭守卫', off.env.UD_GUARD, '0')

const sub = mod.bridgeConfig({ enabledTools: ['snapshot', 'click', 'ocr'] })
check('子集工具数', JSON.parse(sub.env.UD_ENABLED_TOOLS).length, 3)

let threw = false
try { mod.bridgeConfig({ enabledTools: ['不存在的工具'] }) } catch { threw = true }
check('非法工具名抛错', threw, true)

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail === 0 ? 0 : 1)
