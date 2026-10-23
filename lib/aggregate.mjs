#!/usr/bin/env node
// 聚合 MCP 服务器：对 DSH 暴露一个统一的工具面，背后驱动两个后端。
//
//   DSH ──stdio──> [aggregate.mjs] ──stdio──> wincu server.mjs
//                                 └─stdio──> windows-mcp.exe
//
// 职责：
//   1. initialize / tools/list 由本进程直接应答（合并两个后端的 schema）
//   2. tools/call 按 catalog 路由到对应后端
//   3. 内建策略守卫（拦截 PowerShell / Registry 危险参数）
//   4. 后端按需懒启动，一个挂了不影响另一个

import { spawn } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { CATALOG, BY_NAME, groupByBackend } from './catalog.mjs'
import { evaluate } from './guard.mjs'

const SERVER_NAME = 'unified-desktop'
const SERVER_VERSION = '0.1.0'
const PROTOCOL = '2025-06-18'

// ── 配置（由 dsh-plugin.mjs 通过 env 注入）──────────────────
const WCU_SERVER = process.env.UD_WCU_SERVER || ''
const WM_EXE = process.env.UD_WM_EXE || ''
const ENABLED = (() => {
  try {
    const v = JSON.parse(process.env.UD_ENABLED_TOOLS || 'null')
    return Array.isArray(v) ? new Set(v) : null
  } catch { return null }
})()
const GUARD_ON = process.env.UD_GUARD !== '0'
const AUDIT_LOG = process.env.UD_AUDIT_LOG || ''
const CALL_TIMEOUT_MS = Number(process.env.UD_CALL_TIMEOUT_MS) || 180000
const IDLE_THRESHOLD = process.env.UD_IDLE_THRESHOLD || '0.5'

// ── 审计 ────────────────────────────────────────────────
let logReady = false
function audit(entry) {
  if (!AUDIT_LOG) return
  try {
    if (!logReady) { mkdirSync(path.dirname(AUDIT_LOG), { recursive: true }); logReady = true }
    appendFileSync(AUDIT_LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

// ── 输出 ────────────────────────────────────────────────
function send(obj) {
  try { process.stdout.write(JSON.stringify(obj) + '\n') } catch {}
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const replyErr = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

// ── 后端进程管理 ────────────────────────────────────────
class Backend {
  constructor(label, command, args, env) {
    this.label = label
    this.command = command
    this.args = args
    this.env = env
    this.child = null
    this.seq = 1000
    this.pending = new Map()
    this.buffer = ''
    this.ready = null
  }

  async ensure() {
    if (this.child) return
    if (!existsSync(this.command) && !this.command.includes('\\') && !this.command.includes('/')) {
      // 命令名（如 node），交给 PATH 解析
    }
    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.env,
      windowsHide: true,
    })

    this.child.on('error', error => {
      process.stderr.write(`[${this.label}] spawn error: ${error.message}\n`)
      this.child = null
    })
    this.child.on('exit', code => {
      process.stderr.write(`[${this.label}] exited ${code}\n`)
      for (const [, p] of this.pending) p.reject(new Error(`${this.label} backend exited`))
      this.pending.clear()
      this.child = null
      this.ready = null
    })
    this.child.stderr.on('data', d => {
      const s = d.toString().trim()
      if (s) process.stderr.write(`[${this.label}] ${s}\n`)
    })
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8')
      let i
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim()
        this.buffer = this.buffer.slice(i + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error.message || 'backend error')) : p.resolve(msg.result)
        }
      }
    })

    this.ready = this.rpc('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    }).then(() => {
      this.notify('notifications/initialized', {})
      return true
    })
    await this.ready
  }

  rpc(method, params, timeoutMs = 90000) {
    if (!this.child) return Promise.reject(new Error(`${this.label} backend not started`))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.label}:${method} timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v) },
        reject: e => { clearTimeout(timer); reject(e) },
      })
      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  notify(method, params) {
    if (!this.child) return
    try {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    } catch {}
  }

  kill() {
    try { this.child?.kill() } catch {}
  }

  /** 崩溃/超时后重置，使下一次调用重新拉起后端 */
  reset() {
    this.kill()
    this.child = null
    this.ready = null
    this.buffer = ''
    for (const [, p] of this.pending) p.reject(new Error(`${this.label} backend reset`))
    this.pending.clear()
  }
}

// ── 实例化后端 ──────────────────────────────────────────
const wcu = WCU_SERVER
  ? new Backend('wcu', process.execPath, [WCU_SERVER], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      WCU_TOOL_MODE: 'full',
    })
  : null

const wm = WM_EXE
  ? new Backend('wm', WM_EXE, ['serve'], {
      ...process.env,
      ANONYMIZED_TELEMETRY: 'false',
      // windows-mcp 上游硬编码「用户空闲 10 秒才授予控制权」，导致用户在用电脑时
      // 除 ControlStatus 外的所有工具都被 USER_CONTROL 拒绝。这里通过环境变量
      // 覆盖它（需要后端补丁支持，见 docs/backend-patch.md）。
      WINDOWS_MCP_IDLE_THRESHOLD: IDLE_THRESHOLD,
    })
  : null

const backends = { wcu, wm }

// ── 工具目录构建 ────────────────────────────────────────
let cachedTools = null

async function buildToolList() {
  if (cachedTools) return cachedTools

  const { wcu: wcuNames, wm: wmNames } = groupByBackend()

  // 并行取两边 schema
  const [wcuTools, wmTools] = await Promise.all([
    wcu ? wcu.ensure().then(() => wcu.rpc('tools/list', {})).then(r => r.tools).catch(e => {
      process.stderr.write(`[aggregate] wcu tools/list failed: ${e.message}\n`); return []
    }) : Promise.resolve([]),
    wm ? wm.ensure().then(() => wm.rpc('tools/list', {})).then(r => r.tools).catch(e => {
      process.stderr.write(`[aggregate] wm tools/list failed: ${e.message}\n`); return []
    }) : Promise.resolve([]),
  ])

  const wcuMap = new Map(wcuTools.map(t => [t.name, t]))
  const wmMap = new Map(wmTools.map(t => [t.name, t]))

  const out = []
  for (const entry of CATALOG) {
    if (ENABLED && !ENABLED.has(entry.name)) continue
    const src = entry.backend === 'wcu' ? wcuMap.get(entry.target) : wmMap.get(entry.target)
    if (!src) {
      process.stderr.write(`[aggregate] missing backend tool: ${entry.target} (${entry.backend})\n`)
      continue
    }
    out.push({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema ?? src.inputSchema ?? { type: 'object', properties: {} },
      annotations: src.annotations,
    })
  }

  cachedTools = out
  return out
}

// ── 工具调用路由 ────────────────────────────────────────
async function callTool(name, args) {
  const entry = BY_NAME.get(name)
  if (!entry) throw new Error(`unknown tool: ${name}`)
  if (ENABLED && !ENABLED.has(name)) throw new Error(`tool disabled in settings: ${name}`)

  // 守卫：只对可能危险的后端工具生效
  if (GUARD_ON) {
    const verdict = evaluate(entry.target, args)
    if (!verdict.allowed) {
      audit({ decision: 'block', tool: name, backend: entry.backend, ruleId: verdict.ruleId, args, reason: verdict.reason })
      return {
        content: [{ type: 'text', text: `[BLOCKED by unified guard] ${verdict.reason}` }],
        isError: true,
      }
    }
  }

  const backend = backends[entry.backend]
  if (!backend) throw new Error(`backend ${entry.backend} not configured`)

  const started = Date.now()
  try {
    await backend.ensure()
    const result = await backend.rpc(
      'tools/call',
      { name: entry.target, arguments: args ?? {} },
      CALL_TIMEOUT_MS,
    )
    return result
  } catch (error) {
    // 后端崩溃或超时：重置，让下次调用重新拉起，而不是永久卡死
    backend.reset()
    audit({
      decision: 'error',
      tool: name,
      backend: entry.backend,
      args,
      durationMs: Date.now() - started,
      reason: String(error?.message ?? error),
    })
    throw error
  }
}

// ── MCP 主循环 ──────────────────────────────────────────
// 串行队列：stdin 的 data 回调是异步的，若不排队，多个 tools/call 会并发
// 写进同一个后端的 stdin，导致响应 id 交错、结果串号。这里用一个 Promise 链
// 保证「一行进 → 处理完 → 下一行」。
let queue = Promise.resolve()
let buf = ''

function enqueue(task) {
  queue = queue.then(task).catch(error => {
    process.stderr.write(`[aggregate] handler error: ${error?.message ?? error}\n`)
  })
}

async function handleMessage(msg) {
  try {
    if (msg.method === 'initialize') {
      reply(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Unified Windows desktop automation. Observation: snapshot / screenshot / find / ocr / read_webpage. ' +
          'Act: click / type_text / keypress / invoke / set_value. Window: activate_window / close_window / launch_app.',
      })
    } else if (msg.method === 'notifications/initialized') {
      // 无需回应
    } else if (msg.method === 'tools/list') {
      const tools = await buildToolList()
      reply(msg.id, { tools })
    } else if (msg.method === 'tools/call') {
      const name = msg.params?.name
      const args = msg.params?.arguments ?? {}
      try {
        const result = await callTool(name, args)
        reply(msg.id, result)
      } catch (error) {
        reply(msg.id, {
          content: [{ type: 'text', text: String(error?.message ?? error) }],
          isError: true,
        })
      }
    } else if (msg.method === 'ping') {
      reply(msg.id, {})
    } else if (msg.id != null) {
      replyErr(msg.id, -32601, `method not found: ${msg.method}`)
    }
  } catch (error) {
    if (msg.id != null) replyErr(msg.id, -32603, String(error?.message ?? error))
  }
}

process.stdin.on('data', chunk => {
  buf += chunk.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue

    let msg
    try { msg = JSON.parse(line) } catch {
      replyErr(null, -32700, 'parse error')
      continue
    }
    // 通知类消息不需要排队等待（fire and forget）
    if (msg.method === 'notifications/initialized') { handleMessage(msg); continue }
    enqueue(() => handleMessage(msg))
  }
})

process.stdin.on('end', () => {
  wcu?.kill()
  wm?.kill()
  process.exit(0)
})

process.on('exit', () => { wcu?.kill(); wm?.kill() })
process.on('SIGTERM', () => { wcu?.kill(); wm?.kill(); process.exit(0) })

process.stderr.write(`[aggregate] unified-desktop ${SERVER_VERSION} ready (wcu=${Boolean(wcu)} wm=${Boolean(wm)} guard=${GUARD_ON})\n`)
