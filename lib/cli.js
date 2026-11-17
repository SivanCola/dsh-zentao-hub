/**
 * zentao-cli transport.
 *
 * `zentao-cli` (official, MIT, 0.4.4) already wraps auth, profiles, paging,
 * version gates and the write rules of API 2.0. Running it as a child process
 * is how this plugin gets `/my/*` work items and state transitions without
 * re-deriving the API surface — see docs/zentao-api-notes.md for the contract
 * verified from the SDK's own machine-readable definitions.
 *
 * Everything is injectable (`runner`) so tests never spawn a real process.
 */
import { execFile } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export class CliError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.details = details
  }
}

/** CLI error codes, from the CLI's own error table. */
const ERROR_CODES = new Map([
  ['1001', 'zentao/missing-credentials'],
  ['1006', 'zentao/missing-credentials'],
  ['1003', 'zentao/auth-failed'],
  ['1004', 'zentao/auth-failed'],
  ['1005', 'zentao/cli-config'],
  ['1011', 'zentao/cli-config'],
  ['2002', 'zentao/http-error'],
  ['2006', 'zentao/http-error'],
  ['2008', 'zentao/http-error'],
  ['2003', 'zentao/bad-request'],
  ['2004', 'zentao/bad-request'],
  ['2007', 'zentao/bad-request'],
  ['2009', 'zentao/bad-request'],
  ['2010', 'zentao/unsupported-version'],
  ['1002', 'zentao/network'],
  ['5001', 'zentao/network'],
  ['5002', 'zentao/network'],
])

export function mapCliError(payload) {
  const raw = payload?.error ?? {}
  const code = String(raw.code ?? '').trim()
  const message = String(raw.message ?? '')
  // Older CLI builds (<= 0.4.1) parse flags differently and reject the bare
  // `--no-input` this adapter passes. Say so instead of blaming the arguments.
  if (code === '2009' && message.includes('--no-input')) {
    return new CliError(
      'zentao/cli-outdated',
      'zentao-cli 版本过旧，它的参数写法与当前适配器不一致。请升级：npm i -g zentao-cli@latest（或 npx zentao-cli@0.4.4）。',
      { cliCode: code, message },
    )
  }
  const mapped = ERROR_CODES.get(code) ?? 'zentao/cli-error'
  return new CliError(mapped, message || `zentao-cli 失败（${code || '未知错误'}）`, {
    cliCode: code,
    message,
    details: raw.details,
  })
}

/**
 * Default runner: `zentao <args>` with JSON output and no interactivity.
 * `--assistant` marks AI-originated calls, which the CLI forwards to ZenTao.
 */
export function createRunner({ binPath = 'zentao', assistant = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // `cliBin` may be a command with a prefix (`npx zentao-cli`), which execFile
  // cannot express in one string.
  const [bin, ...prefix] = String(binPath).trim().split(/\s+/).filter(Boolean)
  return function run(args) {
    return new Promise((resolve, reject) => {
      const argv = [...prefix, ...args, '--format=json', '--no-input']
      if (assistant) argv.push('--assistant', assistant)
      execFile(
        bin,
        argv,
        { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: process.env },
        (error, stdout, stderr) => {
          if (error && error.code === 'ENOENT') {
            reject(new CliError('zentao/cli-missing', `找不到 zentao 命令（${binPath}）。请先 npm i -g zentao-cli，或在设置里填写完整路径。`))
            return
          }
          if (error && error.killed) {
            reject(new CliError('zentao/timeout', 'zentao-cli 执行超时'))
            return
          }
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        },
      )
    })
  }
}

function lastJson(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // The CLI may print progress lines before the JSON envelope.
    const start = trimmed.lastIndexOf('\n{')
    if (start < 0) return null
    try {
      return JSON.parse(trimmed.slice(start + 1))
    } catch {
      return null
    }
  }
}

/** Run one CLI command and unwrap `{ok,data,meta}`. */
export async function runJson(runner, args) {
  let result
  try {
    result = await runner(args)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('zentao/cli-error', `无法执行 zentao-cli：${error?.message ?? error}`)
  }
  const payload = lastJson(result.stdout) ?? lastJson(result.stderr)
  if (!payload) {
    const hint = String(result.stderr || result.stdout || '').trim().slice(0, 300)
    throw new CliError('zentao/cli-output', `zentao-cli 没有返回 JSON${hint ? `：${hint}` : ''}`)
  }
  if (payload.ok !== true) throw mapCliError(payload)
  return { data: payload.data, meta: payload.meta ?? {} }
}

/** List payloads arrive as an array or wrapped by the resource name. */
export function rowsFrom(data, ...keys) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key]
  }
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.items)) return data.items
  return []
}

export function totalFrom(meta, data, fallback) {
  const total = Number(meta?.total ?? data?.total ?? data?.pager?.total ?? fallback)
  return Number.isFinite(total) ? total : fallback
}

/**
 * Command table. `resource` is the CLI noun, `my` the 地盘 collection,
 * `list` the collection under a container, `idFlag` what `get` expects.
 */
const KINDS = {
  task: { resource: 'task', my: 'tasks', idFlag: '--task-id' },
  bug: { resource: 'bug', my: 'bugs', idFlag: '--bug-id' },
  story: { resource: 'story', my: 'stories', idFlag: '--story-id' },
  requirement: { resource: 'requirement', my: 'stories', idFlag: '--story-id' },
  epic: { resource: 'epic', my: 'stories', idFlag: '--story-id' },
}

export function kindOf(item) {
  if (item?.kind === 'bug' || String(item?.id ?? '').startsWith('bug-')) return 'bug'
  if (item?.kind === 'task' || String(item?.id ?? '').startsWith('task-')) return 'task'
  if (item?.requirementType === 'epic') return 'epic'
  if (item?.requirementType === 'requirement') return 'requirement'
  return 'story'
}

/** Which CLI noun a plugin "read from" scope maps to. */
export function kindOfScope(scope) {
  if (scope === 'project') return 'task'
  if (scope === 'bug') return 'bug'
  return 'story'
}

export function remoteIdOf(item) {
  return String(item?.remoteId ?? item?.id ?? '').replace(/^(?:story|task|bug)-/, '')
}

/** `zentao my tasks --all --max-items N` */
export function myListArgs(scope, { maxItems = 500 } = {}) {
  const kind = kindOfScope(scope)
  return { kind, args: ['my', KINDS[kind].my, '--all', `--max-items=${maxItems}`] }
}

/** Read one item. Rich text stays HTML so `<img src>` extraction still works. */
export function itemGetArgs(item) {
  const kind = kindOf(item)
  return { kind, args: [KINDS[kind].resource, 'get', `${KINDS[kind].idFlag}=${remoteIdOf(item)}`] }
}

/** Local `YYYY-MM-DD HH:mm:ss`, the format the CLI documents for timestamps. */
export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ')
}

/**
 * Args for one state transition. `comment` rides on the transition because
 * v2 has no standalone comment endpoint (see docs/zentao-api-notes.md).
 */
export function writeArgs({ action, item, input = {} }) {
  const kind = kindOf(item)
  const id = remoteIdOf(item)
  if (!/^\d+$/.test(id)) throw new CliError('zentao/bad-request', '无效的禅道条目 ID')
  const comment = String(input.comment ?? '').trim()
  if (action === 'start') {
    if (kind !== 'task') throw new CliError('zentao/bad-request', '只有任务可以「开始」')
    const realStarted = String(input.realStarted ?? '').trim() || stamp()
    const args = ['task', 'start', `--task-id=${id}`, `--real-started=${realStarted}`]
    if (input.consumed) args.push(`--consumed=${input.consumed}`)
    if (input.left) args.push(`--left=${input.left}`)
    if (comment) args.push(`--comment=${comment}`)
    return { kind, id, args, summary: `把任务 #${id} 置为进行中（realStarted=${realStarted}）` }
  }
  if (action === 'resolve') {
    if (kind !== 'bug') throw new CliError('zentao/bad-request', '只有 Bug 可以「解决」')
    const resolution = String(input.resolution ?? '').trim()
    if (!resolution) throw new CliError('zentao/bad-request', '请选择解决方案')
    const args = ['bug', 'resolve', `--bug-id=${id}`, `--resolution=${resolution}`]
    if (input.resolvedDate) args.push(`--resolved-date=${input.resolvedDate}`)
    if (comment) args.push(`--comment=${comment}`)
    return { kind, id, args, summary: `把 Bug #${id} 标记为已解决（resolution=${resolution}）` }
  }
  if (action === 'close') {
    const args = [KINDS[kind].resource, 'close', `${KINDS[kind].idFlag}=${id}`]
    if (comment) args.push(`--comment=${comment}`)
    return { kind, id, args, summary: `关闭 ${KINDS[kind].resource} #${id}` }
  }
  throw new CliError('zentao/bad-request', `不支持的回写动作：${action}`)
}

/** `zentao auth status --format=json` — which site and account the CLI owns. */
export async function cliStatus(runner) {
  const { data } = await runJson(runner, ['auth', 'status'])
  return {
    server: String(data?.server ?? '').trim().replace(/\/+$/, ''),
    account: String(data?.account ?? '').trim(),
    credentialType: String(data?.credentialType ?? '').trim(),
    verified: data?.verified === true,
  }
}

/** `zentao version --format=json` — used to prove the CLI is installed. */
export async function cliVersion(runner) {
  const { data } = await runJson(runner, ['version'])
  return {
    cli: String(data?.cli ?? '').trim(),
    sdk: String(data?.sdk ?? '').trim(),
    runtime: String(data?.runtime ?? '').trim(),
  }
}

export { KINDS }
