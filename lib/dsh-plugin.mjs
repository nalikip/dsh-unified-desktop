// 统一插件入口：一个 MCP server，两个后端。
import z from '@deepseek-ai/schemastery'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { CATALOG } from './catalog.mjs'

export const name = 'unified-desktop'
export const inject = ['tools']

const AGGREGATE = fileURLToPath(new URL('./aggregate.mjs', import.meta.url))
const TOOL_NAMES = Object.freeze(CATALOG.map(e => e.name))

/**
 * 定位 wincu 的 server.mjs。
 * 关键：必须用 .generations/live/<pkg>/... 真实路径，不能用 profiles/web/node_modules
 * 的软链接 —— 软链接会让 server.mjs 内部的
 * `import.meta.url === pathToFileURL(process.argv[1]).href` 判断失败而静默退出。
 */
export function resolveWcuServer(configured) {
  if (configured && existsSync(configured)) return configured

  const profiles = path.join(process.env.APPDATA || '', 'dsh-desktop', 'harness', 'profiles')

  // 1) 优先在 .generations/live 下找已安装的 dsh-computer-use-win
  const genRoot = path.join(profiles, '.generations', 'live')
  if (existsSync(genRoot)) {
    const candidates = []
    for (const dir of readdirSync(genRoot)) {
      if (!dir.startsWith('dsh-computer-use-win+')) continue
      const p = path.join(genRoot, dir, 'node_modules', 'dsh-computer-use-win', 'mcp', 'server.mjs')
      if (existsSync(p)) candidates.push(p)
    }
    if (candidates.length) {
      // 取最新修改的
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      return candidates[0]
    }
  }

  // 2) 回退：profiles/*/node_modules（软链接，可能启动失败，但值得一试）
  if (existsSync(profiles)) {
    for (const prof of readdirSync(profiles)) {
      const p = path.join(profiles, prof, 'node_modules', 'dsh-computer-use-win', 'mcp', 'server.mjs')
      if (existsSync(p)) return p
    }
  }

  return configured || ''
}

/** 定位 windows-mcp.exe */
export function resolveWmExe(configured) {
  if (configured && existsSync(configured)) return configured
  const candidates = [
    path.join(process.env.APPDATA || '', 'uv', 'tools', 'windows-mcp', 'Scripts', 'windows-mcp.exe'),
    path.join(os.homedir(), '.local', 'bin', 'windows-mcp.exe'),
  ]
  for (const c of candidates) if (c && existsSync(c)) return c
  return configured || candidates[0]
}

export function auditLogPath(configured) {
  if (configured) return configured
  return path.join(os.homedir(), '.unified-desktop', 'audit.log')
}

const fields = {
  enabledTools: z.array(z.union(TOOL_NAMES.map(n => z.const(n))))
    .default([...TOOL_NAMES])
    .description('暴露的工具 / Exposed tools'),
  guardEnabled: z.boolean().default(true)
    .description('启用守卫 / Enable policy guard'),
  auditLog: z.boolean().default(true)
    .description('写审计日志 / Write audit log'),
  idleThresholdSeconds: z.number().min(0).max(60).default(0.5)
    .description(
      'windows-mcp 桌面控制门的空闲阈值（秒）。' +
      '上游硬编码 10 秒，导致用户在用电脑时所有 wm 工具被 USER_CONTROL 拦截。' +
      '0.5 表示只要停下 0.5 秒就允许 AI 操作。设为 10 恢复上游行为。',
    ),
}

export const SettingsConfig = z.object(fields)

export const Config = z.object({
  ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [
    k, typeof f.volatile === 'function' ? f.volatile() : f.extra('volatile', true),
  ])),
  wcuServerPath: z.string().default('').description('wincu server.mjs 路径 / wincu server path'),
  wmExePath: z.string().default('').description('windows-mcp.exe 路径 / windows-mcp path'),
  logPath: z.string().default('').description('审计日志路径 / Audit log path'),
  toolCallTimeoutMs: z.number().min(1000).default(180000)
    .description('工具调用超时（毫秒） / Tool timeout (ms)'),
  failOnStartupError: z.boolean().default(false),
})

export function normalizeSettings(input = {}) {
  const pick = k => {
    const raw = input[k]
    return raw && typeof raw.get === 'function' ? raw.get() : raw
  }
  const defaults = {
    enabledTools: [...TOOL_NAMES],
    guardEnabled: true,
    auditLog: true,
    idleThresholdSeconds: 0.5,
  }
  const value = { ...defaults }
  for (const k of Object.keys(defaults)) {
    const v = pick(k)
    if (v !== undefined) value[k] = v
  }
  if (!Array.isArray(value.enabledTools) || value.enabledTools.some(n => !TOOL_NAMES.includes(n))) {
    throw new Error('enabledTools 必须是已知工具名的数组')
  }
  value.enabledTools = TOOL_NAMES.filter(n => value.enabledTools.includes(n))
  for (const k of ['guardEnabled', 'auditLog']) {
    if (typeof value[k] !== 'boolean') throw new Error(`${k} 必须是布尔值`)
  }
  const idle = Number(value.idleThresholdSeconds)
  if (!Number.isFinite(idle) || idle < 0 || idle > 60) {
    throw new Error('idleThresholdSeconds 必须是 0-60 之间的数字')
  }
  value.idleThresholdSeconds = idle
  return value
}

export function bridgeConfig(config = {}) {
  const settings = normalizeSettings(config)
  const wcuServer = resolveWcuServer(config.wcuServerPath)
  const wmExe = resolveWmExe(config.wmExePath)
  const log = auditLogPath(config.logPath)

  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    UD_WCU_SERVER: wcuServer,
    UD_WM_EXE: wmExe,
    UD_GUARD: settings.guardEnabled ? '1' : '0',
    UD_ENABLED_TOOLS: JSON.stringify(settings.enabledTools),
    UD_IDLE_THRESHOLD: String(settings.idleThresholdSeconds),
    ANONYMIZED_TELEMETRY: 'false',
  }
  if (settings.auditLog) env.UD_AUDIT_LOG = log

  return {
    serverName: 'desk',
    transport: 'stdio',
    command: process.execPath,
    args: [AGGREGATE],
    env,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 180000,
    failOnStartupError: config.failOnStartupError ?? false,
  }
}

export async function apply(ctx, config) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client')

  const wcuServer = resolveWcuServer(config.wcuServerPath)
  const wmExe = resolveWmExe(config.wmExePath)
  if (!existsSync(wcuServer)) ctx.logger?.warn?.(`[unified-desktop] 找不到 wincu server: ${wcuServer}`)
  if (!existsSync(wmExe)) ctx.logger?.warn?.(`[unified-desktop] 找不到 windows-mcp: ${wmExe}`)

  let desired = normalizeSettings(config)
  let runningKey = JSON.stringify(desired)
  let connection
  let stopped = false

  ctx.effect(() => () => { stopped = true })

  const reconnect = async next => {
    if (stopped || !connection) return
    await connection.await()
    const key = JSON.stringify(next)
    if (key === runningKey) return
    await connection.update(bridgeConfig({ ...config, ...next }), true)
    await connection.await()
    runningKey = key
  }

  connection = ctx.plugin(bridge, bridgeConfig({ ...config, ...desired }))
  await connection

  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        const next = normalizeSettings({ ...config, ...ctx.fiber?.entry?.options?.config })
        if (JSON.stringify(next) !== JSON.stringify(desired)) {
          desired = next
          reconnect(desired).catch(e => ctx.logger?.error?.(e))
        }
      } catch (e) { ctx.logger?.error?.(e) }
    }, 500)
    timer.unref?.()
    return () => clearInterval(timer)
  })

  ctx.inject(['settings'], settingsContext => {
    if (typeof settingsContext.settings.register !== 'function') {
      if (settingsContext.settings.configure) {
        settingsContext.effect(() => settingsContext.settings.configure({ auto: false }, ctx.fiber))
      }
      return
    }
    const scope = settingsContext.settings.register('unified-desktop', SettingsConfig, {
      base: normalizeSettings(config),
      applies: 'live',
      validate: normalizeSettings,
    })
    desired = normalizeSettings(scope.get())
    settingsContext.effect(() => scope.watch(next => {
      const normalized = normalizeSettings(next)
      desired = normalized
      reconnect(normalized).catch(e => ctx.logger?.error?.(e))
    }))
  })
}
