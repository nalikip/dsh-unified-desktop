// 后端补丁状态与逻辑测试。
//
// 这个套件在没有安装 windows-mcp 的机器上会跳过（不失败），
// 因为补丁针对的是可选后端。
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const SITE = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Lib', 'site-packages', 'windows_mcp')
const CONTROL = path.join(SITE, 'desktop', 'control.py')
const HOOKS = path.join(SITE, 'desktop', 'control_hooks.py')
const PY = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Scripts', 'python.exe')

let pass = 0, fail = 0, skipped = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`) }
}
const ok = (label, cond) => check(label, Boolean(cond), true)

console.log('=== 环境探测 ===')
if (!existsSync(CONTROL)) {
  console.log('  ⊘ 未安装 windows-mcp，跳过补丁测试')
  console.log('\n=== 0 通过 / 0 失败（跳过）===')
  process.exit(0)
}
console.log('  找到 windows-mcp:', SITE)

const controlText = readFileSync(CONTROL, 'utf8').replace(/^\uFEFF/, '')
const hooksText = existsSync(HOOKS) ? readFileSync(HOOKS, 'utf8').replace(/^\uFEFF/, '') : ''

console.log('\n=== 补丁 1：阈值可配置（control.py）===')
ok('注入 _IDLE_THRESHOLD 常量', controlText.includes('_IDLE_THRESHOLD'))
ok('注入 _LEASE_SECONDS 常量', controlText.includes('_LEASE_SECONDS'))
ok('从环境变量读取', controlText.includes('WINDOWS_MCP_IDLE_THRESHOLD'))
ok('默认值保持 10.0（不改上游行为）', /WINDOWS_MCP_IDLE_THRESHOLD", "10\.0"/.test(controlText))

// 确认没有残留的硬编码 10.0（除了默认值那一行）
const hardcoded = [...controlText.matchAll(/[<>=]\s*10\.0|[+]\s*10\.0/g)]
check('无残留硬编码 10.0（仅默认值例外）', hardcoded.length, 0)

console.log('\n=== 补丁 2：忽略无位移移动（control_hooks.py）===')
ok('注入 _UD_LAST_POINT 标记', hooksText.includes('_UD_LAST_POINT'))
ok('有坐标比较逻辑', hooksText.includes('_moved'))
ok('非移动事件仍更新', /if _moved or wparam != 0x200/.test(hooksText))

console.log('\n=== Python 语法与导入 ===')
if (!existsSync(PY)) {
  console.log('  ⊘ 找不到 python.exe，跳过语法检查')
  skipped++
} else {
  const syntax = spawnSync(PY, ['-c',
    `import ast; ast.parse(open(r"${CONTROL}", encoding="utf-8").read()); print("OK")`,
  ], { encoding: 'utf8' })
  check('control.py 语法正确', (syntax.stdout || '').trim(), 'OK')

  const hooksSyntax = spawnSync(PY, ['-c',
    `import ast; ast.parse(open(r"${HOOKS}", encoding="utf-8").read()); print("OK")`,
  ], { encoding: 'utf8' })
  check('control_hooks.py 语法正确', (hooksSyntax.stdout || '').trim(), 'OK')

  const imp = spawnSync(PY, ['-c',
    'from windows_mcp.desktop.control import _IDLE_THRESHOLD, _LEASE_SECONDS; ' +
    'import windows_mcp.desktop.control_hooks; print("OK")',
  ], { encoding: 'utf8' })
  check('模块可导入', (imp.stdout || '').trim(), 'OK')
}

console.log('\n=== 补丁行为（模拟钩子调用）===')
if (!existsSync(PY)) {
  console.log('  ⊘ 跳过')
} else {
  const behavior = spawnSync(PY, ['-c', `
import os, time, ctypes
os.environ["WINDOWS_MCP_IDLE_THRESHOLD"] = "0.5"
from windows_mcp.desktop import control_hooks

class Pt(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
class MouseHookData(ctypes.Structure):
    _fields_ = [("pt", Pt), ("mouseData", ctypes.c_ulong), ("flags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.c_void_p)]
class Owner:
    def __init__(self):
        self._last_physical_event = 0.0
        self._mouse_down = set(); self._suppress = False; self._emergency = False
        self._deadline = 0.0; self._mouse_hook = None; self._delivered_mouse = set()
    def _queue(self, ev): pass
    def _fail_open(self): pass

def fire(o, x, y, wparam=0x200):
    d = MouseHookData(); d.pt = Pt(x, y); d.mouseData = 0; d.flags = 0
    d.time = 0; d.dwExtraInfo = 0
    control_hooks.physical_mouse(o, 0, wparam, ctypes.addressof(d))

# A: 同坐标高频上报
o = Owner(); fire(o, 500, 500); t0 = o._last_physical_event
for _ in range(30): fire(o, 500, 500)
print("same_pos_frozen", o._last_physical_event == t0)

# B: 坐标变化
o2 = Owner(); fire(o2, 500, 500); t1 = o2._last_physical_event
time.sleep(0.02); fire(o2, 520, 530)
print("moved_updates", o2._last_physical_event > t1)

# C: 按键
o3 = Owner(); fire(o3, 500, 500); t2 = o3._last_physical_event
time.sleep(0.02); fire(o3, 500, 500, wparam=0x201)
print("click_updates", o3._last_physical_event > t2)
`, ], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })

  const out = behavior.stdout || ''
  ok('同坐标高频上报不重置计时', out.includes('same_pos_frozen True'))
  ok('坐标真实变化时更新', out.includes('moved_updates True'))
  ok('鼠标按键时更新', out.includes('click_updates True'))
  if (!out) console.log('    stderr:', (behavior.stderr || '').slice(0, 400))
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败${skipped ? ` / ${skipped} 跳过` : ''} ===`)
process.exit(fail === 0 ? 0 : 1)
