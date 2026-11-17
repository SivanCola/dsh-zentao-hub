/**
 * Host half of the ZenTao task view.
 *
 * Registers a handful of POST routes on the client connection
 * (`/api/zentao/*`) and keeps the ZenTao password in the host credentials
 * service. The panel is self-contained: it lists what ZenTao assigned to you,
 * prepares a checkout and puts a task briefing into a new session's composer.
 */
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { DispatchError, deliverAssets, dispatchStory } from './dispatch.js'
import { readDraftAsset, saveDraftAssets } from './drafts.js'
import { buildTaskPrompt, refreshTaskPrompt } from './prompt.js'
import { apiRoot as zentaoApiRoot, basicAuthHeader, listContainers, listUsers, resetZentaoTokens } from './zentao.js'
import {
  channelCapabilities,
  channelOf,
  cliSite,
  fetchAssets,
  fetchWork,
  listWork,
  resetCliCache,
  runnerFor,
  SourceError,
  uidOf,
} from './work.js'
import { BUG_TYPES, executeWrite, planWrite, RESOLUTIONS } from './writeback.js'
import { cliVersion, runJson } from './cli.js'
import {
  DATA_DIR,
  findDispatch,
  loadSettings,
  loadState,
  putDispatch,
  saveSettings,
} from './store.js'

export const name = 'dsh-zentao-hub'
export const inject = ['connection']

const pkg = createRequire(import.meta.url)('../package.json')
const REF_ZENTAO_PASSWORD = 'ZENTAO_PASSWORD'
const REF_ZENTAO_BASIC_PASSWORD = 'ZENTAO_BASIC_PASSWORD'
const NO_STORE = { 'cache-control': 'no-store' }

function ok(value) {
  return Response.json({ ok: true, value }, { headers: NO_STORE })
}

function fail(error) {
  const code = typeof error?.code === 'string' && error.code.includes('/') ? error.code : 'source/internal'
  const status = /\/(?:basic-)?auth-failed$/.test(code)
    ? 401
    : code.startsWith('dispatch/') ||
        /\/(missing|bad-request|not-found|credential-not-writable|unknown)/.test(code)
      ? 400
      : 500
  const message = error?.message ?? String(error)
  return Response.json({ ok: false, error: { code, message, details: error?.details } }, { status, headers: NO_STORE })
}

function service(ctx, serviceName) {
  try {
    return ctx.get(serviceName) ?? undefined
  } catch {
    return undefined
  }
}

function requireService(ctx, serviceName, label) {
  const found = service(ctx, serviceName)
  if (!found) throw new DispatchError('dispatch/missing-service', `宿主没有提供 ${label ?? serviceName} 服务`)
  return found
}

async function readSecret(ctx, ref) {
  const credentials = service(ctx, 'credentials')
  if (!credentials) return ''
  try {
    const record = await credentials.resolve(ref)
    return record?.value ? String(record.value) : ''
  } catch {
    return ''
  }
}

async function writeCredential(ctx, ref, value, label) {
  const credentials = requireService(ctx, 'credentials', 'credentials')
  try {
    await credentials.set(ref, value)
  } catch (error) {
    throw new SourceError(
      'zentao/credential-not-writable',
      `无法写入${label}（${error?.message ?? error}），可以改为设置环境变量 ${ref}`,
    )
  }
}

/** REST root for a channel; the CLI and auto modes compare by base URL only. */
function rootOf(config) {
  const transport = config?.transport ?? 'v1'
  return zentaoApiRoot(config?.baseUrl, transport === 'v2' ? 'v2' : 'v1')
}

/** The CLI owns its own login, so it needs no REST password at all. */
function needsRestPassword(config) {
  return channelOf(config) !== 'cli'
}

/** A saved login is only reusable for the same site + channel + account. */
function loginChanged(saved, next) {
  return rootOf(saved) !== rootOf(next) ||
    (saved.transport ?? 'v1') !== (next.transport ?? 'v1') ||
    saved.account !== String(next.account ?? '').trim()
}

function passwordRequired() {
  return new SourceError('zentao/missing-credentials', '禅道地址、数据通道或账号已变更，请重新填写禅道登录密码。')
}

function sameGateway(saved, next) {
  return saved.basicAccount === next.basicAccount && rootOf(saved) === rootOf(next)
}

async function basicCredentials(ctx, saved, next, password) {
  return {
    account: next.basicAccount,
    password: password || (sameGateway(saved, next) ? await readSecret(ctx, REF_ZENTAO_BASIC_PASSWORD) : ''),
  }
}

/** Resolve credentials right before every request; never cache them. */
async function readCredentials(ctx) {
  const settings = await loadSettings()
  const zentao = settings.zentao
  const password = await readSecret(ctx, REF_ZENTAO_PASSWORD)
  const basicAuth = zentao.basicAuth
    ? { account: zentao.basicAccount, password: await readSecret(ctx, REF_ZENTAO_BASIC_PASSWORD) }
    : undefined
  return {
    settings,
    credentials: { account: zentao.account, password, basicAuth },
  }
}

async function credentialStatus(ctx) {
  const credentials = service(ctx, 'credentials')
  const empty = { zentao: { password: false, basicPassword: false } }
  if (!credentials) return empty
  const configured = (ref) => {
    try {
      return Boolean(credentials.describe?.(ref)?.configured)
    } catch {
      return false
    }
  }
  return {
    zentao: {
      password: configured(REF_ZENTAO_PASSWORD),
      basicPassword: configured(REF_ZENTAO_BASIC_PASSWORD),
    },
  }
}

function workspaceSummaries(ctx) {
  const registry = service(ctx, 'workspaceRegistry')
  if (!registry) return []
  try {
    return registry.list().map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessionIds: Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [],
    }))
  } catch {
    return []
  }
}

async function sessionStatuses(ctx) {
  const sessions = service(ctx, 'sessionController')
  const registry = service(ctx, 'workspaceRegistry')
  let registered = null
  try {
    const workspaces = registry?.list?.()
    if (Array.isArray(workspaces) && workspaces.every((workspace) => Array.isArray(workspace.sessionIds))) {
      registered = new Set(workspaces.flatMap((workspace) => workspace.sessionIds))
    }
  } catch {
    // A registry failure leaves the session listing as the fallback.
  }
  let items = null
  try {
    const page = await sessions?.list?.({}, AbortSignal.timeout(10_000))
    if (Array.isArray(page?.items)) items = new Map(page.items.map((item) => [item.sessionId, item]))
  } catch {
    // A failed lookup is different from an empty successful listing.
  }
  return { items, registered }
}

function dispatchStatus(record, statuses) {
  const id = record?.sessionId
  if (!id) return { running: false, sessionMissing: false }
  const { items, registered } = statuses
  const item = items?.get(id)
  const isRegistered = registered?.has(id)
  const sessionMissing = Boolean(items && (isRegistered === false ? !(record.draftPending && item) : !item && !isRegistered))
  return {
    running: Boolean(item?.running),
    sessionMissing,
    statusUnavailable: !sessionMissing && !item,
    draftWaiting: Boolean(record.draft && !record.draftPending && item?.blank === true && !item.running && !sessionMissing),
  }
}

async function realPathOr(target) {
  if (!target) return ''
  try {
    return await fs.realpath(target)
  } catch {
    return target
  }
}

/**
 * In-place dispatch switches branches in the user's own checkout, so it must
 * not run while another agent is working in that same directory.
 */
async function assertWorkspaceIdle(ctx, repoPath) {
  const sessions = service(ctx, 'sessionController')
  if (!sessions?.list) return
  let page
  try {
    page = await sessions.list({}, AbortSignal.timeout(10_000))
  } catch {
    return
  }
  const items = Array.isArray(page?.items) ? page.items : []
  const root = await realPathOr(repoPath)
  if (!root) return
  const busy = []
  for (const item of items) {
    if (!item?.running || !item.cwd) continue
    const cwd = await realPathOr(item.cwd)
    if (cwd === root || cwd.startsWith(root + path.sep)) {
      busy.push({ sessionId: item.sessionId, cwd: item.cwd })
    }
  }
  if (busy.length > 0) {
    throw new DispatchError(
      'dispatch/workspace-busy',
      `这个工作区还有 ${busy.length} 个会话正在运行，切换分支会打断它们。请等它结束、改用独立 worktree，或让 Agent 先停手。`,
      { sessions: busy },
    )
  }
}

const inflightDispatches = new Set()

function parseBody(body) {
  return body && typeof body === 'object' ? body : {}
}

function isString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function summarizeDispatch(record, statuses) {
  const { sessionId, branch, workspaceId, baseBranch, worktreePath, repoPath, createdAt, draft, attachments, images } = record
  return {
    sessionId,
    branch,
    workspaceId,
    baseBranch,
    worktreePath,
    repoPath,
    createdAt,
    draft: draft ?? null,
    attachments: attachments ?? [],
    images: images ?? [],
    draftPending: Boolean(record.draftPending),
    ...dispatchStatus(record, statuses),
  }
}

async function collectTasks(ctx, body) {
  const { settings, credentials } = await readCredentials(ctx)
  if (needsRestPassword(settings.zentao) && (!credentials.account || !credentials.password)) {
    throw new SourceError('zentao/missing-credentials', '尚未配置禅道账号密码。请在设置里填写禅道账号与密码。')
  }
  const excludeCompleted = body.includeCompleted === true ? false : settings.excludeCompleted
  const result = await listWork({
    settings,
    credentials,
    excludeCompleted,
    includeStatusOptions: body.includeStatusOptions === true,
  })

  const [dispatches, statuses] = await Promise.all([loadState(), sessionStatuses(ctx)])
  const stories = result.items.map((story) => {
    const record = dispatches[story.uid]
    return {
      ...story,
      dispatch: record ? {
        ...summarizeDispatch(record, statuses),
        previousSessions: (record.previousSessions ?? []).map((previous) => summarizeDispatch(previous, statuses)),
      } : null,
    }
  })
  return {
    stories,
    total: stories.length,
    rawCount: result.rawCount,
    scope: settings.zentao.scope,
    channel: result.channel ?? channelOf(settings.zentao),
    serverFiltered: result.serverFiltered === true,
    iterations: result.iterations,
    ownerFilteredEmpty: result.ownerFilteredEmpty,
    syncedAt: new Date().toISOString(),
    ...(body.includeStatusOptions === true && result.statusOptions && { statusOptions: result.statusOptions }),
  }
}

/** Best-effort CLI probe: never let a missing binary break the panel. */
async function cliInfo(config) {
  const runner = runnerFor(config)
  try {
    const [version, site] = await Promise.all([cliVersion(runner), cliSite(runner)])
    return { available: true, version, site }
  } catch (error) {
    return { available: false, error: error?.message ?? String(error), code: error?.code ?? '' }
  }
}

/**
 * Counts only — the sidebar badge polls this instead of the full task list.
 * Same channel as the panel, so it still works when /my/* is the source.
 */
async function handleCounts(ctx) {
  const { settings, credentials } = await readCredentials(ctx)
  if (needsRestPassword(settings.zentao) && (!credentials.account || !credentials.password)) {
    throw new SourceError('zentao/missing-credentials', '尚未配置禅道账号密码。')
  }
  const result = await listWork({ settings, credentials, excludeCompleted: false })
  const byKind = { task: 0, bug: 0, story: 0 }
  let open = 0
  for (const item of result.items) {
    if (item.completed) continue
    open += 1
    const kind = item.kind === 'bug' ? 'bug' : item.kind === 'task' ? 'task' : 'story'
    byKind[kind] += 1
  }
  return {
    open,
    total: result.items.length,
    byKind,
    scope: settings.zentao.scope,
    channel: result.channel ?? channelOf(settings.zentao),
    serverFiltered: result.serverFiltered === true,
    syncedAt: new Date().toISOString(),
  }
}

/**
 * Write-back. `confirm: false` returns the plan (what would be sent), so the
 * panel can show it before anything touches ZenTao. `confirm: true` executes.
 */
async function handleWrite(ctx, body) {
  const { settings, credentials } = await readCredentials(ctx)
  const capabilities = channelCapabilities(settings.zentao)
  if (!capabilities.writeBack) {
    throw new SourceError(
      'zentao/unsupported-version',
      '当前数据通道不能回写。请切换到 v2（禅道 22.0+）或 zentao-cli。',
    )
  }
  const item = body.item
  if (!item || typeof item !== 'object') throw new SourceError('source/bad-request', '缺少条目信息')
  const action = String(body.action ?? '').trim()
  const input = body.input && typeof body.input === 'object' ? body.input : {}
  if (body.confirm !== true) {
    return { plan: planWrite({ settings, item, action, input }) }
  }
  return executeWrite({ settings, credentials, item, action, input })
}

/** Reassignment candidates: the ZenTao roster, cached in lib/zentao.js. */
async function handleUsers(ctx) {
  const { settings, credentials } = await readCredentials(ctx)
  const config = settings.zentao
  const channel = channelOf(config)
  // The CLI channel deliberately keeps no REST password; it owns its own login,
  // so ask it for the roster rather than failing the dialog.
  if (channel === 'cli' && !credentials.password) {
    const { data } = await runJson(runnerFor(config), ['user', 'list', '--recPerPage=200'])
    const rows = Array.isArray(data) ? data : data?.users ?? data?.data ?? []
    return {
      users: rows
        .filter((raw) => raw && !raw.deleted)
        .map((raw) => ({
          account: String(raw.account ?? '').trim(),
          name: String(raw.realname ?? raw.account ?? '').trim(),
          role: String(raw.role ?? '').trim(),
        }))
        .filter((user) => user.account),
      source: 'cli',
    }
  }
  if (!credentials.password) {
    throw new SourceError('zentao/missing-credentials', '读取人员列表需要禅道账号密码，请先在设置里填写')
  }
  const baseUrl = String(config.baseUrl ?? '').trim() || await cliSite(runnerFor(config))
  const version = channel === 'cli' ? 'v1' : config.transport
  return { users: await listUsers({ baseUrl, version, credentials }), source: 'rest' }
}

async function handleState(ctx) {
  const { settings, credentials } = await readCredentials(ctx)
  const capabilities = channelCapabilities(settings.zentao)
  return {
    settings,
    capabilities: { ...capabilities, backfill: true, reassign: true },
    resolutions: RESOLUTIONS,
    bugTypes: BUG_TYPES,
    ...(capabilities.channel === 'cli' ? { cli: await cliInfo(settings.zentao) } : {}),
    credentials: await credentialStatus(ctx),
    credentialPresence: {
      password: Boolean(credentials.password),
      basicPassword: Boolean(settings.zentao.basicAccount &&
        (credentials.basicAuth?.password ?? await readSecret(ctx, REF_ZENTAO_BASIC_PASSWORD))),
    },
    workspaces: workspaceSummaries(ctx),
    dataDir: DATA_DIR,
    version: pkg.version,
    services: {
      workspaceRegistry: Boolean(service(ctx, 'workspaceRegistry')),
      sessionController: Boolean(service(ctx, 'sessionController')),
      credentials: Boolean(service(ctx, 'credentials')),
    },
  }
}

const SETTINGS_KEYS = ['defaultWorkspacePath', 'baseBranch', 'agentPreset']

async function handleSaveSettings(ctx, body) {
  const patch = {}
  for (const key of SETTINGS_KEYS) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  for (const key of ['useWorktree', 'excludeCompleted']) {
    if (typeof body[key] === 'boolean') patch[key] = body[key]
  }
  if (body.zentao && typeof body.zentao === 'object' && !Array.isArray(body.zentao)) {
    patch.zentao = body.zentao
  }
  const basicPassword = typeof body.zentaoBasicPassword === 'string' ? body.zentaoBasicPassword : ''
  if (patch.zentao) {
    const saved = (await loadSettings()).zentao
    const next = { ...saved, ...patch.zentao }
    if (needsRestPassword(next) && loginChanged(saved, next) &&
        !isString(body.zentaoPassword) && await readSecret(ctx, REF_ZENTAO_PASSWORD)) {
      throw passwordRequired()
    }
    next.basicAccount = typeof next.basicAccount === 'string' ? next.basicAccount.trim() : ''
    // Only re-validate the gateway credentials when this save touches them:
    // a scope switch must not depend on the stored gateway password.
    const basicTouched = Boolean(basicPassword) ||
      next.basicAuth !== saved.basicAuth ||
      next.basicAccount !== saved.basicAccount
    if (next.basicAuth === true && basicTouched) {
      basicAuthHeader(await basicCredentials(ctx, saved, next, basicPassword))
      if (basicPassword) await writeCredential(ctx, REF_ZENTAO_BASIC_PASSWORD, basicPassword, '禅道网关密码')
    } else if (next.basicAuth !== true && !sameGateway(saved, next)) {
      patch.zentao.basicAccount = ''
    }
  }
  await saveSettings(patch)
  if (isString(body.zentaoPassword)) {
    await writeCredential(ctx, REF_ZENTAO_PASSWORD, body.zentaoPassword, '禅道密码')
  }
  // A channel or binary change invalidates cached tokens and the CLI probe.
  if (patch.zentao) {
    resetCliCache()
    resetZentaoTokens()
  }
  return handleState(ctx)
}

/** ZenTao products/projects/executions for the settings picker, before saving. */
async function handleContainers(ctx, body) {
  const { settings, credentials } = await readCredentials(ctx)
  const baseUrl = isString(body.baseUrl) ? body.baseUrl.trim() : settings.zentao.baseUrl
  const transport = isString(body.transport) ? body.transport.trim() : settings.zentao.transport
  const account = isString(body.account) ? body.account.trim() : settings.zentao.account
  if (channelOf({ transport }) === 'cli') {
    throw new SourceError(
      'zentao/unsupported-version',
      'zentao-cli 通道直接按「我的地盘」读取，不需要选择产品/项目。切换到 v1 或 v2 才能枚举容器。',
    )
  }
  if (loginChanged(settings.zentao, { baseUrl, transport, account }) && !isString(body.password)) {
    throw passwordRequired()
  }
  const password = isString(body.password) ? body.password : credentials.password
  if (!account || !password) {
    throw new SourceError('zentao/missing-credentials', '请先填写禅道账号与密码')
  }
  const basicEnabled = typeof body.basicAuth === 'boolean' ? body.basicAuth : settings.zentao.basicAuth
  let basicAuth
  if (basicEnabled) {
    const basicAccount = typeof body.basicAccount === 'string' ? body.basicAccount.trim() : settings.zentao.basicAccount
    const basicPassword = typeof body.basicPassword === 'string' ? body.basicPassword : ''
    basicAuth = await basicCredentials(ctx, settings.zentao, { baseUrl, transport, basicAccount }, basicPassword)
  }
  return listContainers({ baseUrl, version: transport, credentials: { account, password, basicAuth } })
}

/**
 * Re-dispatching an item normally returns the existing session. If that
 * session was created before assets were carried, backfill them once instead
 * of leaving it text-only forever (the list offers no second dispatch).
 */
async function backfillDispatchAssets(ctx, record, { settings, credentials, story, key }) {
  const unchanged = { ...record, alreadyDispatched: true }
  const known = (record.attachments?.length ?? 0) + (record.images?.length ?? 0)
  if (known > 0) return unchanged

  const assets = await fetchAssets({ settings, credentials, story })
  if (assets.files.length === 0 && assets.images.length === 0) return unchanged

  const sessions = requireService(ctx, 'sessionController', 'sessionController')
  const uploads = service(ctx, 'fileUploads')
  const delivered = await deliverAssets({
    sessionId: record.sessionId,
    files: assets.files,
    images: assets.images,
    text: '补充这条任务随任务下发的附件与截图（此前派发时未携带），请结合它们继续。',
    services: { sessionController: sessions, fileUploads: uploads },
  })
  const updated = {
    ...record,
    attachments: [...(record.attachments ?? []), ...delivered.attachments],
    images: [...(record.images ?? []), ...delivered.images],
  }
  await putDispatch(key, updated)
  return { ...updated, alreadyDispatched: true, assetsAdded: true }
}

async function refreshDraft(record, options) {
  if (!record.draft) throw new DispatchError('dispatch/missing-draft', '这条派发记录没有草稿')
  if (record.draft.detailsLoaded) return record
  const { files, images } = await fetchAssets(options)
  const assets = await saveDraftAssets({ sessionId: record.sessionId, files, images })
  const previousText = String(record.draft.text ?? '')
  const updated = {
    ...record,
    draft: {
      text: refreshTaskPrompt(previousText, options.story, {
        attachments: assets.filter((asset) => asset.kind === 'file'),
        images: assets.filter((asset) => asset.kind === 'image'),
      }),
      previousText,
      detailsLoaded: true,
      assets,
      files: assets.filter((asset) => asset.kind === 'file').map((asset) => asset.name),
      images: assets.filter((asset) => asset.kind === 'image').map((asset) => asset.name),
    },
  }
  await putDispatch(options.key, updated)
  return updated
}

async function prepareContinuation(record, options, extraInstructions) {
  const { files, images } = await fetchAssets(options)
  const draftId = randomUUID()
  const assets = files.length || images.length
    ? await saveDraftAssets({ sessionId: record.sessionId, files, images, draftId })
    : []
  const text = buildTaskPrompt(options.story, { ...record, repoRoot: record.repoPath, attachments: files, images })
  const extra = typeof extraInstructions === 'string' ? extraInstructions.trim() : ''
  return {
    sessionId: record.sessionId,
    continuation: true,
    draft: { draftId, text: extra ? `${text}\n\n## 补充要求\n\n${extra}` : text, assets },
  }
}

async function handleDispatch(ctx, body) {
  const { settings, credentials } = await readCredentials(ctx)
  const storyId = String(body.storyId ?? body.story?.id ?? '').trim()
  if (!storyId) throw new SourceError('source/bad-request', '缺少任务 ID')
  if (body.story?.id != null && String(body.story.id).trim() !== storyId) {
    throw new SourceError('source/bad-request', '任务详情与任务 ID 不匹配，请刷新后重试。')
  }
  if (body.story?.source && body.story.source !== 'zentao') {
    throw new DispatchError('dispatch/source-changed', '当前任务来源已切换，请刷新后重新选择任务。')
  }
  const branchName = String(body.branchName ?? '').trim()

  const key = uidOf(storyId)
  // Two clicks on 派发 must not create two sessions/branches.
  if (inflightDispatches.has(key)) {
    throw new DispatchError('dispatch/in-progress', '这个任务正在派发，请稍候再试。')
  }
  inflightDispatches.add(key)
  try {
    const current = await findDispatch(storyId)
    const previousSessions = current?.previousSessions ?? []
    const continuing = body.conversation === 'existing'
    const requestedId = isString(body.requestId) ? body.requestId : undefined
    const candidates = [current, ...previousSessions]
    const priorRequest = body.conversation === 'new' && requestedId
      ? candidates.find((record) => record?.requestId === requestedId)
      : null
    const forceNew = body.conversation === 'new' && !priorRequest
    const reuseCheckout = forceNew && isString(current?.branch) ? current : null
    const existing = continuing && isString(body.sessionId)
      ? candidates.find((record) => record?.sessionId === body.sessionId)
      : priorRequest ?? current
    const existingStatus = existing?.sessionId ? dispatchStatus(existing, await sessionStatuses(ctx)) : null
    const reusable = !forceNew && existingStatus && !existingStatus.sessionMissing
    const failedWithDraft = Boolean(existing && existing.status === 'failed' && existing.draft?.text)
    const resumeDraft = reusable && (existing.draftPending || failedWithDraft) ? existing : null

    // A temporary lookup error must not cause an implicit second dispatch.
    if (reusable && !resumeDraft && !continuing && !body.refreshDraft && body.deliver !== 'send') {
      return { ...existing, ...existingStatus, alreadyDispatched: true }
    }
    if ((continuing || priorRequest || body.refreshDraft === true || body.conversation === 'retry') && !reusable) {
      throw new DispatchError('dispatch/missing-draft', '原会话已不存在，请新开对话。')
    }
    if (!reusable && !reuseCheckout && !branchName) throw new SourceError('dispatch/missing-branch', '请填写完整的分支名称')

    let story = null
    if (body.story && typeof body.story === 'object') {
      story = await fetchWork({ settings, credentials, story: body.story })
    }
    if (!story) throw new SourceError('source/bad-request', '缺少任务信息')
    story = { ...story, uid: key, source: 'zentao' }

    if (continuing && !resumeDraft) {
      if (existingStatus.statusUnavailable) throw new DispatchError('dispatch/status-unavailable', '暂时无法确认原会话状态，请稍后重试。')
      return prepareContinuation(existing, { settings, credentials, story }, body.extraInstructions)
    }

    if (reusable && !resumeDraft) {
      if (body.refreshDraft === true) {
        return refreshDraft(existing, { settings, credentials, story, key })
      }
      if (existingStatus.statusUnavailable) {
        throw new DispatchError('dispatch/status-unavailable', '暂时无法确认原会话状态，请稍后重试。')
      }
      return backfillDispatchAssets(ctx, existing, { settings, credentials, story, key })
    }

    const registry = requireService(ctx, 'workspaceRegistry', 'workspaceRegistry')
    const sessions = requireService(ctx, 'sessionController', 'sessionController')
    const uploads = service(ctx, 'fileUploads')

    const history = current && (!reusable || forceNew)
      ? [{ ...current, previousSessions: undefined }, ...previousSessions]
      : previousSessions
    const saveRecord = (record) => putDispatch(key, {
      ...record,
      provider: 'zentao',
      storySource: 'zentao',
      requestId: record.requestId ?? requestedId,
      ...(history.length ? { previousSessions: history } : {}),
    })
    const record = await dispatchStory({
      story,
      settings,
      services: { workspaceRegistry: registry, sessionController: sessions, fileUploads: uploads },
      assertIdle: (target) => assertWorkspaceIdle(ctx, target),
      resumeDraft,
      reuseCheckout,
      saveDraftCheckpoint: saveRecord,
      loadAttachments: () => fetchAssets({ settings, credentials, story }),
      options: {
        branchName,
        workspaceId: isString(body.workspaceId) ? body.workspaceId : undefined,
        workspacePath: isString(body.workspacePath) ? body.workspacePath : undefined,
        useWorktree: typeof body.useWorktree === 'boolean' ? body.useWorktree : undefined,
        baseBranch: isString(body.baseBranch) ? body.baseBranch : undefined,
        prompt: isString(body.prompt) ? body.prompt : undefined,
        extraInstructions: isString(body.extraInstructions) ? body.extraInstructions : undefined,
        // The panel never sends on the operator's behalf: the task text and
        // its files are placed in the composer for review.
        deliver: body.deliver === 'send' && !body.conversation ? 'send' : 'draft',
        smartCheckout: body.smartCheckout !== false,
        backupRoot: path.join(DATA_DIR, 'backups'),
      },
    })
    if (record.draft) record.draft.detailsLoaded = true
    if (resumeDraft && existing !== current) {
      await putDispatch(key, {
        ...current,
        previousSessions: previousSessions.map((previous) => previous.sessionId === record.sessionId ? record : previous),
      })
      return { ...record, continuation: true }
    }
    await saveRecord(record)
    return { ...record, previousSessions: history, draftWaiting: Boolean(record.draft) }
  } finally {
    inflightDispatches.delete(key)
  }
}

export function apply(ctx) {
  ctx.inject(['connection'], (scoped) => {
    const connection = scoped.get('connection')
    if (!connection?.fetch?.register) return

    const route = (path, label, handler) =>
      scoped.effect(
        () =>
          connection.fetch.register({
            path: `/api/zentao/${path}`,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
              try {
                const body = parseBody(await request.json().catch(() => null))
                return ok(await handler(body))
              } catch (error) {
                return fail(error)
              }
            },
          }),
        `dsh-zentao-hub: ${label}`,
      )

    route('state', 'state', () => handleState(ctx))
    route('settings', 'settings', (body) => handleSaveSettings(ctx, body))
    route('containers', 'containers', (body) => handleContainers(ctx, body))
    route('tasks', 'tasks', (body) => collectTasks(ctx, body))
    route('counts', 'counts', () => handleCounts(ctx))
    route('write', 'write', (body) => handleWrite(ctx, body))
    route('users', 'users', () => handleUsers(ctx))
    route('dispatch', 'dispatch', (body) => handleDispatch(ctx, body))
    // Draft attachments: the composer only accepts real browser Files, so the
    // Client streams these bytes back over the same connection. The body is
    // binary, which the JSON envelope of `route` cannot carry.
    scoped.effect(
      () =>
        connection.fetch.register({
          path: '/api/zentao/asset',
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            try {
              const body = parseBody(await request.json().catch(() => null))
              const asset = await readDraftAsset({ sessionId: body.session, index: body.i, draftId: body.draftId })
              return new Response(asset.data, {
                status: 200,
                headers: {
                  'content-type': asset.mediaType || 'application/octet-stream',
                  'content-length': String(asset.data.byteLength),
                  'cache-control': 'no-store',
                },
              })
            } catch (error) {
              return fail(error)
            }
          },
        }),
      'dsh-zentao-hub: asset',
    )
    route('status', 'status', async () => {
      const statuses = await sessionStatuses(ctx)
      const state = await loadState()
      const entries = Object.entries(state).map(([key, record]) => ({
        uid: key,
        storyId: record?.storyId ?? key,
        ...record,
        ...dispatchStatus(record, statuses),
        previousSessions: (record?.previousSessions ?? []).map((previous) => summarizeDispatch(previous, statuses)),
      }))
      return { entries, workspaces: workspaceSummaries(ctx) }
    })
  })
}
