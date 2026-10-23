// 策略引擎：判断一次 tools/call 是否放行。
//
// 设计原则（按可逆性，不按工具名）：
//   读操作            → 放行
//   可逆写（HKCU\Software 普通键） → 放行
//   不可逆 / 提权 / 持久化后门    → 拦截
//
// 这个模块不启动进程、不读环境变量，纯函数，方便单测。

/** 规则集：每条 [正则, 人类可读标签] */
export const PS_RULES = Object.freeze([
  // ── 破坏性文件操作 ────────────────────────────────────────────
  { id: 'ps.rm.recurse', re: /\bRemove-Item\b[^\n]*\s-(Recurse|Force)\b/i, label: '递归/强制删除' },
  { id: 'ps.rm.system', re: /\bRemove-Item\b[^\n]*\b[A-Z]:\\(Windows|Program Files|ProgramData|Users)\b/i, label: '删除系统目录' },
  { id: 'ps.rm.cmd', re: /\b(rm|del|rmdir|rd)\s+(-[a-z]*r[a-z]*f?|\/[sqf]|\/[sq]\s*\/[qf])/i, label: '递归删除' },
  { id: 'ps.disk', re: /\bFormat-Volume\b|\bClear-Disk\b|\bInitialize-Disk\b|\bdiskpart\b|\bFormat-Volume\b/i, label: '磁盘操作' },
  { id: 'ps.rm.pipeline', re: /\bGet-ChildItem\b[^\n]*\|\s*Remove-Item\b/i, label: '管道批量删除' },

  // ── 注册表（防止绕过 Registry 工具的限制）────────────────────
  { id: 'ps.reg.exe', re: /\breg(\.exe)?\s+(add|delete|import|restore)\b/i, label: 'reg.exe 修改注册表' },
  { id: 'ps.reg.hklm', re: /\b(Set|New|Remove)-ItemProperty\b[^\n]*\bHKLM:/i, label: '写 HKLM 注册表' },
  { id: 'ps.reg.autostart', re: /\b(Set|New|Remove)-ItemProperty\b[^\n]*\bHKCU:[^\n]*\\(Run|RunOnce|Policies)\b/i, label: '写自启动/策略键' },
  { id: 'ps.reg.newkey', re: /\bNew-Item\b[^\n]*\bHKLM:/i, label: '新建 HKLM 键' },

  // ── 代码执行 / 下载执行 ──────────────────────────────────────
  { id: 'ps.iex', re: /\bInvoke-Expression\b|\bIEX\b/i, label: '动态代码执行' },
  { id: 'ps.encoded', re: /-(EncodedCommand|enc)\b/i, label: 'Base64 编码命令' },
  { id: 'ps.download.run', re: /\b(Invoke-WebRequest|iwr|curl|wget)\b[^\n]*-OutFile\b[^\n]*(\bStart-Process\b|&|\.exe)/i, label: '下载后执行' },
  { id: 'ps.startproc', re: /\bStart-Process\b[^\n]*\.(exe|bat|cmd|ps1|vbs|js|msi)\b/i, label: '启动外部程序（请改用 App 工具）' },
  { id: 'ps.remote', re: /\bInvoke-Command\b|\bEnter-PSSession\b|\bNew-PSSession\b/i, label: '远程执行' },
  { id: 'ps.execpolicy', re: /\bEnable-PSRemoting\b|\bSet-ExecutionPolicy\b/i, label: '修改执行策略/远程' },
  { id: 'ps.addtype', re: /\bAdd-Type\b[^\n]*-TypeDefinition\b|\bAdd-Type\b[^\n]*DllImport/i, label: '编译注入本机代码' },

  // ── 进程与服务 ──────────────────────────────────────────────
  { id: 'ps.kill.force', re: /\bStop-Process\b[^\n]*\s-Force\b|\btaskkill\b[^\n]*\/f/i, label: '强制杀进程' },
  { id: 'ps.svc', re: /\bsc(\.exe)?\s+(config|delete|stop|start)\b/i, label: 'sc.exe 改服务' },
  { id: 'ps.svc.disable', re: /\bSet-Service\b[^\n]*-(StartupType\s+Disabled|Status\s+Stopped)/i, label: '停用服务' },

  // ── 账户与安全 ──────────────────────────────────────────────
  { id: 'ps.account', re: /\bnet\s+(user|localgroup)\b|\bNew-LocalUser\b|\bSet-LocalUser\b|\bAdd-LocalGroupMember\b/i, label: '账户操作' },
  { id: 'ps.av', re: /\bSet-MpPreference\b|\bAdd-MpPreference\b[^\n]*Exclusion|\bDisable-WindowsOptionalFeature\b/i, label: '修改杀毒/系统功能' },
  { id: 'ps.firewall', re: /\bnetsh\s+advfirewall\s+set\b|\bSet-NetFirewallProfile\b[^\n]*-Enabled\s+(False|0)/i, label: '修改防火墙' },
  { id: 'ps.boot', re: /\bbcdedit\b|\bvssadmin\b[^\n]*delete|\bwevtutil\s+cl\b|\bRemove-EventLog\b/i, label: '启动项/卷影/清日志' },
  { id: 'ps.sched', re: /\bRegister-ScheduledTask\b|\bschtasks\b[^\n]*\/create/i, label: '创建计划任务' },
  { id: 'ps.restore', re: /\bDisable-ComputerRestore\b|\bCheckpoint-Computer\b/i, label: '系统还原点操作' },
  { id: 'ps.priv', re: /\bwhoami\b[^\n]*\/priv|\bSeDebugPrivilege\b|\bSeTakeOwnershipPrivilege\b/i, label: '提权操作' },
  { id: 'ps.takeown', re: /\btakeown\b|\bicacls\b[^\n]*\/grant/i, label: '改文件所有权/ACL' },
])

/** 注册表：写/删时禁止的位置（前缀，已大写、反斜杠） */
export const REG_DENY_PREFIX = Object.freeze([
  'HKEY_LOCAL_MACHINE', 'HKLM:',
  'HKEY_USERS', 'HKU:',
  'HKEY_CLASSES_ROOT', 'HKCR:',
  'HKEY_CURRENT_CONFIG', 'HKCC:',
  'HKCU:\\SOFTWARE\\POLICIES',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\RUN',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\RUNONCE',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\POLICIES',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\WINLOGON',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\EXPLORER',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\SHELL FOLDERS',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS\\CURRENTVERSION\\UNINSTALL',
  'HKCU:\\SOFTWARE\\MICROSOFT\\WINDOWS NT\\CURRENTVERSION\\WINDOWS',
])

/** 注册表：写/删允许的位置 */
export const REG_ALLOW_PREFIX = Object.freeze(['HKCU:\\SOFTWARE\\'])

export function normalizeRegPath(value) {
  return String(value ?? '').toUpperCase().replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\+$/, '')
}

/**
 * 决定一次调用是否放行。
 * @param {string} tool 工具名
 * @param {object} args 参数
 * @param {object} [options]
 * @param {boolean} [options.enforceRegistry=true] 是否限制 Registry 写
 * @param {boolean} [options.enforcePowerShell=true] 是否限制 PowerShell
 * @param {string[]} [options.extraDeny=[]] 额外的 PowerShell 正则（字符串）
 * @returns {{allowed: boolean, ruleId?: string, reason?: string}}
 */
export function evaluate(tool, args, options = {}) {
  const {
    enforceRegistry = true,
    enforcePowerShell = true,
    extraDeny = [],
  } = options

  if (tool === 'PowerShell' && enforcePowerShell) {
    const cmd = String(args?.command ?? '')
    for (const rule of PS_RULES) {
      if (rule.re.test(cmd)) {
        return { allowed: false, ruleId: rule.id, reason: `PowerShell 被守卫拦截（${rule.label}）` }
      }
    }
    for (const [i, pattern] of extraDeny.entries()) {
      let re
      try { re = new RegExp(pattern, 'i') } catch { continue }
      if (re.test(cmd)) {
        return { allowed: false, ruleId: `custom.${i}`, reason: `PowerShell 命中自定义规则（${pattern}）` }
      }
    }
    return { allowed: true }
  }

  if (tool === 'Registry' && enforceRegistry) {
    const mode = String(args?.mode ?? '')
    if (mode === 'set' || mode === 'delete') {
      const p = normalizeRegPath(args?.path)
      if (!p) return { allowed: false, ruleId: 'reg.empty', reason: '注册表路径为空' }
      for (const prefix of REG_DENY_PREFIX) {
        if (p.startsWith(prefix)) {
          return { allowed: false, ruleId: 'reg.protected', reason: `受保护的注册表位置：${p}` }
        }
      }
      if (!REG_ALLOW_PREFIX.some(prefix => p.startsWith(prefix))) {
        return {
          allowed: false,
          ruleId: 'reg.outside',
          reason: `写入仅允许 HKCU:\\Software 下的普通键，收到：${p}`,
        }
      }
    }
    return { allowed: true }
  }

  return { allowed: true }
}
