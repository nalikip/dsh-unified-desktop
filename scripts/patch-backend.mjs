#!/usr/bin/env node
// 给 windows-mcp 打补丁，解决「桌面控制门几乎不可用」的问题。
//
// 两处补丁：
//   1. control.py        —— 把硬编码的 10 秒空闲阈值改成可配置
//   2. control_hooks.py  —— 忽略「无位移的鼠标移动」，避免高频无线接收器
//                           （如 ROG OMNI RECEIVER）让空闲判定永不满足
//
// 用法：
//   node scripts/patch-backend.mjs           打补丁
//   node scripts/patch-backend.mjs --revert  还原
//   node scripts/patch-backend.mjs --check   只检查状态
//
// 幂等：重复执行不会重复注入。

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const MARKER = 'WINDOWS_MCP_IDLE_THRESHOLD'
const HOOK_MARKER = '_UD_LAST_POINT'
const BACKUP_SUFFIX = '.bak-ud'

const SITE = path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Lib', 'site-packages', 'windows_mcp')

function locate() {
  const control = path.join(SITE, 'desktop', 'control.py')
  const hooks = path.join(SITE, 'desktop', 'control_hooks.py')
  if (!existsSync(control)) return null
  return { control, hooks }
}

function py() {
  return path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Scripts', 'python.exe')
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

function isPatched(text) {
  return text.includes(MARKER)
}

function revert(file) {
  const backup = file + BACKUP_SUFFIX
  if (!existsSync(backup)) {
    console.log('没有备份文件，无法还原：', backup)
    return 1
  }
  copyFileSync(backup, file)
  console.log('已还原：', file)
  return 0
}

function check(file) {
  const text = stripBom(readFileSync(file, 'utf8'))
  if (isPatched(text)) {
    console.log('状态：已打补丁')
    const m = text.match(/_IDLE_THRESHOLD = float\(_os\.getenv\("WINDOWS_MCP_IDLE_THRESHOLD", "([^"]+)"\)\)/)
    if (m) console.log('  默认阈值：', m[1], '秒')
    return 0
  }
  console.log('状态：未打补丁（上游行为，10 秒空闲门）')
  return 2
}

function patch(file) {
  let text = stripBom(readFileSync(file, 'utf8'))

  if (isPatched(text)) {
    console.log('已打过补丁，跳过注入')
    return verify(file)
  }

  // 备份（只在首次备份，保留原始版本）
  const backup = file + BACKUP_SUFFIX
  if (!existsSync(backup)) {
    copyFileSync(file, backup)
    console.log('已备份：', backup)
  } else {
    console.log('备份已存在，保留原备份：', backup)
  }

  // 1) 注入常量定义
  const anchor = 'from windows_mcp.desktop.control_win32 import ('
  if (!text.includes(anchor)) {
    console.error('找不到注入锚点，上游结构可能已变化：', anchor)
    return 1
  }
  const inject = [
    'import os as _os',
    '',
    '# dsh-unified-desktop: 空闲阈值可配置。',
    '# 上游硬编码 10 秒，导致用户在用电脑时所有工具被 USER_CONTROL 拦截。',
    '_IDLE_THRESHOLD = float(_os.getenv("WINDOWS_MCP_IDLE_THRESHOLD", "10.0"))',
    '_LEASE_SECONDS = float(_os.getenv("WINDOWS_MCP_LEASE_SECONDS", "15.0"))',
    '',
    '',
  ].join('\n')
  text = text.replace(anchor, inject + anchor)

  // 2) 替换硬编码
  const replacements = [
    ['max(self._last_user, self._last_physical_event) + 10.0 - now',
     'max(self._last_user, self._last_physical_event) + _IDLE_THRESHOLD - now'],
    ['if self._state == "ready" and now - self._last_physical_event < 10.0:',
     'if self._state == "ready" and now - self._last_physical_event < _IDLE_THRESHOLD:'],
    ['and now - max(self._last_user, self._last_physical_event) >= 10.0',
     'and now - max(self._last_user, self._last_physical_event) >= _IDLE_THRESHOLD'],
    ['if now - self._last_physical_event < 10.0:',
     'if now - self._last_physical_event < _IDLE_THRESHOLD:'],
    ['self._lease_until = time.monotonic() + 15.0',
     'self._lease_until = time.monotonic() + _LEASE_SECONDS'],
    ['recent_input = self._last_physical_event > 0 and now - self._last_physical_event < 10.0',
     'recent_input = self._last_physical_event > 0 and now - self._last_physical_event < _IDLE_THRESHOLD'],
  ]

  let replaced = 0
  for (const [from, to] of replacements) {
    if (text.includes(from)) {
      text = text.split(from).join(to)
      replaced++
    }
  }
  console.log(`替换了 ${replaced}/${replacements.length} 处硬编码`)

  if (replaced === 0) {
    console.error('没有替换任何位置，上游可能已改动')
    return 1
  }

  // 3) 写回（UTF-8 无 BOM）
  writeFileSync(file, text, 'utf8')
  console.log('已写入：', file)

  return verify(file)
}

// ── 补丁 2：忽略无位移的鼠标移动 ──────────────────────
function patchHooks(file) {
  if (!file || !existsSync(file)) {
    console.log('跳过 hooks 补丁：找不到 control_hooks.py')
    return 0
  }
  let text = stripBom(readFileSync(file, 'utf8'))

  if (text.includes(HOOK_MARKER)) {
    console.log('hooks 已打过补丁，跳过')
    return 0
  }

  const backup = file + BACKUP_SUFFIX
  if (!existsSync(backup)) {
    copyFileSync(file, backup)
    console.log('已备份：', backup)
  }

  const before = `        valid = True
        owner._last_physical_event = time.monotonic()
        if wparam == 0x200 and owner._suppress:`

  const after = `        valid = True
        # dsh-unified-desktop: 只在真实用户活动时更新。
        # 部分无线接收器（如 ROG OMNI RECEIVER）会高频上报 WM_MOUSEMOVE，
        # 即使坐标未变也触发，导致空闲判定永不满足。这里要求坐标真的变了。
        _pt = (data.pt.x, data.pt.y)
        _moved = getattr(owner, "${HOOK_MARKER}", None) != _pt
        if _moved or wparam != 0x200:
            owner._last_physical_event = time.monotonic()
        owner.${HOOK_MARKER} = _pt
        if wparam == 0x200 and owner._suppress:`

  if (!text.includes(before)) {
    console.error('hooks 补丁：找不到目标代码块，上游可能已变化')
    return 1
  }

  text = text.replace(before, after)
  writeFileSync(file, text, 'utf8')
  console.log('已写入 hooks 补丁：', file)

  const python = py()
  if (existsSync(python)) {
    const r = spawnSync(python, ['-c',
      `import ast; ast.parse(open(r"${file}", encoding="utf-8").read()); print("syntax OK")`,
    ], { encoding: 'utf8' })
    console.log('hooks 语法：', (r.stdout || '').trim() || (r.stderr || '').trim())
  }
  return 0
}

function verify(file) {
  const python = py()
  if (!existsSync(python)) {
    console.log('找不到 python.exe，跳过语法校验')
    return 0
  }
  const syntax = spawnSync(python, ['-c',
    `import ast; ast.parse(open(r"${file}", encoding="utf-8").read()); print("syntax OK")`,
  ], { encoding: 'utf8' })
  const syntaxOut = (syntax.stdout || '').trim()
  if (!syntaxOut.includes('OK')) {
    console.error('语法校验失败：', syntaxOut || syntax.stderr)
    return 1
  }
  console.log('语法校验：', syntaxOut)

  const imp = spawnSync(python, ['-c',
    'from windows_mcp.desktop.control import _IDLE_THRESHOLD, _LEASE_SECONDS; ' +
    'print("import OK idle=", _IDLE_THRESHOLD, "lease=", _LEASE_SECONDS)',
  ], { encoding: 'utf8' })
  const impOut = (imp.stdout || '').trim()
  if (!impOut.includes('import OK')) {
    console.error('导入校验失败：', impOut || imp.stderr)
    return 1
  }
  console.log('导入校验：', impOut)
  return 0
}

// ── main ──
const paths = locate()
if (!paths) {
  console.error('找不到 windows-mcp 的 control.py。请先安装：uv tool install windows-mcp --python 3.14')
  process.exit(1)
}
console.log('目标目录：', SITE)

const arg = process.argv[2]
let code

if (arg === '--revert') {
  let rc = 0
  for (const f of [paths.control, paths.hooks]) {
    if (f && existsSync(f + BACKUP_SUFFIX)) {
      copyFileSync(f + BACKUP_SUFFIX, f)
      console.log('已还原：', f)
    } else {
      rc = 1
    }
  }
  code = rc
} else if (arg === '--check') {
  const controlText = stripBom(readFileSync(paths.control, 'utf8'))
  const hooksText = existsSync(paths.hooks) ? stripBom(readFileSync(paths.hooks, 'utf8')) : ''
  const c1 = controlText.includes(MARKER)
  const c2 = hooksText.includes(HOOK_MARKER)
  console.log(`  阈值补丁 (control.py)     : ${c1 ? '已应用' : '未应用'}`)
  console.log(`  钩子补丁 (control_hooks.py): ${c2 ? '已应用' : '未应用'}`)
  if (c1) {
    const m = controlText.match(/_IDLE_THRESHOLD = float\(_os\.getenv\("WINDOWS_MCP_IDLE_THRESHOLD", "([^"]+)"\)\)/)
    if (m) console.log(`  默认空闲阈值：${m[1]} 秒`)
  }
  code = (c1 && c2) ? 0 : 2
} else {
  console.log('\n[1/2] 补丁 control.py（可配置阈值）')
  code = patch(paths.control)
  if (code === 0) {
    console.log('\n[2/2] 补丁 control_hooks.py（忽略无位移移动）')
    code = patchHooks(paths.hooks)
  }
  if (code === 0) {
    console.log('\n完成。重启 DSH 后生效。')
  }
}

process.exit(code)
