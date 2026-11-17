/**
 * Write-back into ZenTao: state transitions with an attached note.
 *
 * Two hard facts shape this module (both verified, see
 * docs/zentao-api-notes.md):
 *
 *   1. API 2.0 has no standalone "add a comment" endpoint. `comment` only
 *      rides on a transition, so "write a note back" must also be a state
 *      change. For a dispatch that is exactly `start` (未开始 → 进行中).
 *   2. A transition is a real business action in someone else's system, so the
 *      panel always shows the plan first and executes on a second call. The
 *      same caution the official skills doc asks for: human review before any
 *      AI-originated data change.
 *
 * Channels: `v2` (REST PUT) or `cli` (`zentao task start ...`). `v1` cannot
 * write, and the panel says so instead of failing at click time.
 */
import { callApi } from './zentao.js'
import { stamp, writeArgs, runJson, kindOf, remoteIdOf } from './cli.js'
import { channelOf, fetchWork, runnerFor, SourceError } from './work.js'

export const ACTIONS = ['start', 'resolve', 'close']

const RESOLUTIONS = ['fixed', 'notrepro', 'bydesign', 'duplicate', 'external', 'postponed', 'willnotfix', 'tostory']
const MAX_COMMENT = 500

/** v2 request bodies, mirroring the SDK's own schema for each action. */
function restPlan({ kind, id, action, input }) {
  const comment = String(input.comment ?? '').trim().slice(0, MAX_COMMENT)
  if (action === 'start') {
    if (kind !== 'task') throw new SourceError('zentao/bad-request', '只有任务可以「开始」')
    const body = { realStarted: String(input.realStarted ?? '').trim() || stamp() }
    if (input.consumed) body.consumed = Number(input.consumed)
    if (input.left) body.left = Number(input.left)
    if (comment) body.comment = comment
    return { method: 'PUT', path: `/tasks/${id}/start`, body }
  }
  if (action === 'resolve') {
    if (kind !== 'bug') throw new SourceError('zentao/bad-request', '只有 Bug 可以「解决」')
    const resolution = String(input.resolution ?? '').trim()
    if (!RESOLUTIONS.includes(resolution)) throw new SourceError('zentao/bad-request', '请选择有效的解决方案')
    const body = { resolution }
    if (input.resolvedDate) body.resolvedDate = String(input.resolvedDate).trim()
    if (comment) body.comment = comment
    return { method: 'PUT', path: `/bugs/${id}/resolve`, body }
  }
  if (action === 'close') {
    const body = {}
    if (comment) body.comment = comment
    return { method: 'PUT', path: `/${kind === 'bug' ? 'bugs' : 'tasks'}/${id}/close`, body }
  }
  throw new SourceError('zentao/bad-request', `不支持的回写动作：${action}`)
}

function summaryOf({ action, kind, id, input }) {
  const comment = String(input.comment ?? '').trim()
  const tail = comment ? `，并附言「${comment.length > 40 ? `${comment.slice(0, 40)}…` : comment}」` : ''
  if (action === 'start') return `把任务 #${id} 置为进行中${tail}`
  if (action === 'resolve') return `把 Bug #${id} 标记为已解决（${input.resolution}）${tail}`
  if (action === 'close') return `关闭 ${kind === 'bug' ? 'Bug' : '任务'} #${id}${tail}`
  return `回写 #${id}`
}

/**
 * Build the plan the operator confirms. Pure: no network, no process.
 */
export function planWrite({ settings, item, action, input = {} }) {
  if (!item) throw new SourceError('source/bad-request', '缺少条目信息')
  if (!ACTIONS.includes(action)) throw new SourceError('zentao/bad-request', `不支持的回写动作：${action}`)
  const config = settings?.zentao ?? {}
  const channel = channelOf(config)
  if (channel === 'v1') {
    throw new SourceError(
      'zentao/unsupported-version',
      '内置 v1 通道不能回写。请把数据通道切换为 v2（禅道 22.0+）或 zentao-cli。',
    )
  }
  const kind = kindOf(item)
  const id = remoteIdOf(item)
  if (!/^\d+$/.test(id)) throw new SourceError('zentao/bad-request', '无效的禅道条目 ID')

  if (channel === 'cli') {
    const { args, summary } = writeArgs({ action, item, input })
    return {
      action,
      kind,
      id,
      title: String(item.name ?? ''),
      channel,
      summary,
      command: args,
    }
  }
  const request = restPlan({ kind, id, action, input })
  return {
    action,
    kind,
    id,
    title: String(item.name ?? ''),
    channel,
    summary: summaryOf({ action, kind, id, input }),
    request,
  }
}

function verificationOf(item) {
  if (!item) return null
  return {
    status: item.status ?? '',
    statusLabel: item.vStatus ?? item.status ?? '',
    resolved: item.resolved === true,
    completed: item.completed === true,
  }
}

/**
 * Execute a confirmed plan, then re-read the item so the panel can report the
 * state ZenTao actually stored (a 200 is not proof of a write).
 */
export async function executeWrite(options) {
  const { settings, credentials, item, action, input = {}, fetchImpl, runner, verify = true } = options ?? {}
  const plan = planWrite({ settings, item, action, input })
  const config = settings.zentao ?? {}
  try {
    if (plan.channel === 'cli') {
      await runJson(runnerFor(config, runner), plan.command)
    } else {
      await callApi({
        baseUrl: config.baseUrl,
        version: 'v2',
        credentials,
        path: plan.request.path,
        method: plan.request.method,
        body: plan.request.body,
        fetchImpl,
      })
    }
  } catch (error) {
    if (error?.code) throw error
    throw new SourceError('zentao/write-failed', `回写失败：${error?.message ?? error}`)
  }

  let verification = null
  let verifyError = ''
  if (verify) {
    try {
      const fresh = await fetchWork({ settings, credentials, story: item, fetchImpl, runner })
      verification = verificationOf(fresh)
    } catch (error) {
      verifyError = error?.message ?? String(error)
    }
  }
  return { ok: true, plan, verification, verifyError }
}

export { RESOLUTIONS, MAX_COMMENT }
