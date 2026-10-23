// 统一测试入口：串行跑所有套件，汇总结果。
// 用法：node test/run-all.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const SUITES = [
  { name: 'catalog', file: 'catalog-test.mjs', desc: '工具目录一致性与去重' },
  { name: 'config', file: 'config-test.mjs', desc: '配置校验与路径解析' },
  { name: 'aggregate', file: 'aggregate-e2e.mjs', desc: '聚合工具面与双后端路由' },
  { name: 'concurrency', file: 'concurrency-test.mjs', desc: '并发串行化，响应不串号' },
  { name: 'electron', file: 'electron-verify.mjs', desc: 'DSH 真实 Electron 运行时' },
]

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(here, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { out += d.toString() })
    child.on('exit', code => resolve({ code, out }))
    child.on('error', e => resolve({ code: 1, out: String(e.message) }))
  })
}

const results = []
for (const suite of SUITES) {
  process.stdout.write(`\n${'='.repeat(64)}\n▶ ${suite.name} — ${suite.desc}\n${'='.repeat(64)}\n`)
  const started = Date.now()
  const { code, out } = await run(suite.file)
  const ms = Date.now() - started

  // 只回显断言行和汇总行
  for (const line of out.split('\n')) {
    if (/^\s*[✓✗]/.test(line) || /通过 \/|passed|结果/.test(line) || /^===/.test(line)) {
      process.stdout.write(line + '\n')
    }
  }
  results.push({ ...suite, code, ms })
}

process.stdout.write(`\n${'='.repeat(64)}\n汇总\n${'='.repeat(64)}\n`)
let failed = 0
for (const r of results) {
  const mark = r.code === 0 ? '✓' : '✗'
  if (r.code !== 0) failed++
  process.stdout.write(`  ${mark} ${r.name.padEnd(14)} ${String(r.ms).padStart(6)}ms\n`)
}

process.stdout.write(`\n${failed === 0 ? '全部通过' : `${failed} 个套件失败`}\n`)
process.exit(failed === 0 ? 0 : 1)
