/**
 * ZenTao REST client (API v1 and v2).
 *
 * This file was extracted from dsh-task-hub's ZenTao adapter and is the only
 * source of truth about the ZenTao API inside this plugin. It keeps the
 * behaviour the task hub proved out (sign in once, resolve the current
 * account, filter the assignee locally) and adds two things the API reference
 * documents but the hub never used:
 *
 *   - API v2 (`/api.php/v2`, token from `POST /users/login`) as an opt-in
 *     transport. Same semantics as v1: everything is listed, then filtered by
 *     assignee, so "include completed" keeps working.
 *   - Product bugs (`/products/{id}/bugs`), which is the work item a developer
 *     actually gets handed after 提测.
 *
 * Attachments are always downloaded through v1 (`/files/{id}` and the
 * `file-read-*` web routes): the v2 reference documents no binary endpoint.
 */
import { createHash } from 'node:crypto'

const REQUEST_TIMEOUT_MS = 20_000
const MAX_PAGES = 5
const PAGE_SIZE = 200
const REQUIREMENT_TYPES = ['story', 'requirement', 'epic']
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** v2 mounts its requirement types on their own collections. */
const V2_COLLECTIONS = { story: 'stories', requirement: 'requirements', epic: 'epics' }

export const API_VERSIONS = ['v1', 'v2', 'auto']
export const SCOPES = ['product', 'project', 'bug']

const tokenCache = new Map()
const resolvedVersions = new Map()
const TOKEN_TTL_MS = 20 * 60 * 1000

export class ZentaoError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'ZentaoError'
    this.code = code
    this.details = details
  }
}

export function normalizeVersion(value) {
  return API_VERSIONS.includes(value) ? value : 'v1'
}

export function apiRoot(baseUrl, version = 'v1') {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) return ''
  const segment = version === 'v2' ? 'v2' : 'v1'
  if (/\/api\.php\/v1$/i.test(base)) return base.replace(/v1$/i, segment)
  if (/\/api\.php\/v2$/i.test(base)) return base.replace(/v2$/i, segment)
  if (/\/api\.php$/i.test(base)) return `${base}/${segment}`
  return `${base}/api.php/${segment}`
}

export function webRoot(baseUrl) {
  return String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\.php(\/v[12])?$/i, '')
}

export function basicAuthHeader({ account, password }) {
  const user = String(account ?? '').trim()
  if (!user || !password) {
    throw new ZentaoError('zentao/missing-basic-auth', '已启用禅道 Basic Auth，请填写网关账号和密码')
  }
  if (/[:\x00-\x1f\x7f]/.test(user) || /[\x00-\x1f\x7f]/.test(password)) {
    throw new ZentaoError('zentao/bad-request', 'Basic Auth 账号不能包含冒号，账号和密码不能包含控制字符')
  }
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
}

function credentialKey({ baseUrl, credentials, version }) {
  return createHash('sha256').update(JSON.stringify([
    String(version ?? 'v1'),
    apiRoot(baseUrl, version === 'v2' ? 'v2' : 'v1'),
    String(credentials?.account ?? '').trim(),
    credentials?.password ?? '',
    credentials?.basicAuth ?? null,
  ])).digest('hex')
}

async function readBody(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

function errorMessageOf(body) {
  if (!body || typeof body !== 'object') return ''
  if (typeof body.error === 'string') return body.error
  if (typeof body.message === 'string') return body.message
  if (body.error && typeof body.error === 'object' && typeof body.error.message === 'string') return body.error.message
  if (typeof body.raw === 'string') return body.raw
  return ''
}

function tokenOf(body) {
  if (!body || typeof body !== 'object') return ''
  if (typeof body.token === 'string') return body.token
  if (body.data && typeof body.data.token === 'string') return body.data.token
  return ''
}

async function request(options) {
  const {
    baseUrl, credentials, path, method = 'GET', body, token, assetUrl, binary,
    fetchImpl = globalThis.fetch, version = 'v1',
  } = options
  const root = apiRoot(baseUrl, version)
  if (!root) throw new ZentaoError('zentao/missing-base-url', '尚未填写禅道地址')
  const headers = { accept: binary ? '*/*' : 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.token = token
  if (credentials?.basicAuth) headers.authorization = basicAuthHeader(credentials.basicAuth)
  const target = assetUrl ?? `${root}${path.startsWith('/') ? path : `/${path}`}`
  let response
  try {
    response = await fetchImpl(target, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(binary ? { redirect: 'error' } : {}),
    })
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ZentaoError('zentao/timeout', '禅道请求超时')
    }
    throw new ZentaoError('zentao/network', `无法连接禅道：${error?.message ?? error}`)
  }
  if (binary && response.ok) return response
  const payload = await readBody(response)
  if (response.status === 401 && /(?:^|,)\s*Basic(?:\s|$)/i.test(response.headers.get('www-authenticate') ?? '')) {
    throw new ZentaoError(
      'zentao/basic-auth-failed',
      credentials?.basicAuth ? '禅道网关 Basic Auth 验证失败，请检查网关账号和密码' : '禅道网关需要 Basic Auth，请在设置中启用并填写网关账号和密码',
    )
  }
  if (response.status === 401 || response.status === 403) {
    throw new ZentaoError('zentao/auth-failed', '禅道认证失败，请检查账号、密码或 Token')
  }
  if (!response.ok) {
    const detail = errorMessageOf(payload)
    throw new ZentaoError('zentao/http-error', `禅道返回 ${response.status}${detail ? `：${detail}` : ''}`, {
      status: response.status,
    })
  }
  return payload
}

/** v1 exchanges credentials at /tokens, v2 at /users/login. */
async function login({ baseUrl, credentials, fetchImpl, version }) {
  const account = String(credentials?.account ?? '').trim()
  const password = String(credentials?.password ?? '')
  if (!account) throw new ZentaoError('zentao/missing-credentials', '尚未填写禅道账号')
  if (!password) throw new ZentaoError('zentao/missing-credentials', '尚未填写禅道密码')
  const path = version === 'v2' ? '/users/login' : '/tokens'
  const body = await request({ baseUrl, path, method: 'POST', body: { account, password }, credentials, fetchImpl, version })
  const token = tokenOf(body)
  if (!token) throw new ZentaoError('zentao/auth-failed', '禅道没有返回登录 Token，请确认账号密码')
  return token
}

/**
 * `auto` probes v2 once per site and remembers the answer, so a v1-only
 * install (ZenTao < 21.7.8) costs exactly one extra request.
 */
export async function resolveVersion(options) {
  const wanted = normalizeVersion(options?.version)
  if (wanted !== 'auto') return wanted
  const key = apiRoot(options?.baseUrl, 'v1')
  if (resolvedVersions.has(key)) return resolvedVersions.get(key)
  try {
    const token = await login({ ...options, version: 'v2' })
    tokenCache.set(credentialKey({ ...options, version: 'v2' }), { token, at: Date.now() })
    resolvedVersions.set(key, 'v2')
    return 'v2'
  } catch (error) {
    if (!(error instanceof ZentaoError) || error.code === 'zentao/missing-credentials') throw error
    // Only a definitive answer is remembered. A timeout or a dropped connection
    // used to pin the site to v1 — read-only, no write-back — until restart.
    if (error.code === 'zentao/network' || error.code === 'zentao/timeout' || error.code === 'zentao/auth-failed') {
      throw error
    }
    resolvedVersions.set(key, 'v1')
    return 'v1'
  }
}

/** Exchange account/password for a session token; cached for a short while. */
export async function ensureToken(options) {
  const version = await resolveVersion(options)
  const key = credentialKey({ ...options, version })
  const cached = tokenCache.get(key)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token
  const token = await login({ ...options, version })
  tokenCache.set(key, { token, at: Date.now() })
  return token
}

/** Public entry for callers that need an arbitrary path (write-back). */
export async function callApi(options) {
  return call(options)
}

async function call(options) {
  const version = await resolveVersion(options)
  const scoped = { ...options, version }
  const token = await ensureToken(scoped)
  try {
    return await request({ ...scoped, token })
  } catch (error) {
    if (error?.code !== 'zentao/auth-failed') throw error
    tokenCache.delete(credentialKey(scoped))
    const retried = await ensureToken(scoped)
    return request({ ...scoped, token: retried })
  }
}

function rowsOf(body, ...keys) {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') return []
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key]
  }
  if (Array.isArray(body.data)) return body.data
  for (const key of keys) {
    if (body.data && Array.isArray(body.data[key])) return body.data[key]
  }
  // v2 wraps paged payloads as { data: { items: [...] } } on some builds.
  if (body.data && Array.isArray(body.data.items)) return body.data.items
  if (Array.isArray(body.items)) return body.items
  return []
}

function totalOf(body, fallback) {
  // v2 pagers report `recTotal`; treating it as unknown would stop paging
  // after the first page and silently hide everything past it.
  const total = Number(
    body?.total ??
    body?.data?.total ??
    body?.pager?.total ??
    body?.pager?.recTotal ??
    body?.data?.pager?.total ??
    body?.data?.pager?.recTotal ??
    fallback,
  )
  return Number.isFinite(total) ? total : fallback
}

/** v2 documents recPerPage/pageID; v1 documents limit/page. Send both. */
function pageQuery(version, page, size) {
  return version === 'v2'
    ? `limit=${size}&page=${page}&recPerPage=${size}&pageID=${page}`
    : `limit=${size}&page=${page}`
}

async function paged(options, pathForPage, keys) {
  const version = await resolveVersion(options)
  const rows = []
  let total = Infinity
  for (let page = 1; page <= MAX_PAGES && rows.length < total; page += 1) {
    const body = await call({ ...options, path: pathForPage(page, version) })
    const batch = rowsOf(body, ...keys)
    rows.push(...batch)
    total = totalOf(body, rows.length)
    if (batch.length === 0) break
  }
  return rows
}

function accountOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') return String(value.account ?? '').trim()
  return ''
}

function nameOf(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') return String(value.realname ?? value.name ?? value.account ?? '').trim()
  return ''
}

export const TASK_STATUS_LABELS = new Map([
  ['wait', '未开始'],
  ['doing', '进行中'],
  ['done', '已完成'],
  ['closed', '已关闭'],
  ['cancel', '已取消'],
  ['pause', '已暂停'],
])
const STORY_STATUS_LABELS = new Map([
  ['draft', '草稿'],
  ['changed', '已变更'],
  ['active', '进行中'],
])
export const BUG_STATUS_LABELS = new Map([
  ['active', '待解决'],
  ['resolved', '已解决'],
  ['closed', '已关闭'],
])

function normalizeStatus(raw) {
  const status = String(raw?.status ?? '').trim().toLowerCase()
  return {
    status,
    vStatus: TASK_STATUS_LABELS.get(status) ?? STORY_STATUS_LABELS.get(status) ?? BUG_STATUS_LABELS.get(status) ?? status,
    completed: status === 'done' || status === 'closed' || status === 'cancel',
    resolved: status === 'resolved',
  }
}

export const STORY_STAGE_LABELS = new Map([
  ['wait', '未开始'],
  ['planned', '已计划'],
  ['projected', '已立项'],
  ['developing', '研发中'],
  ['developed', '研发完毕'],
  ['testing', '测试中'],
  ['tested', '测试完毕'],
  ['verified', '已验收'],
  ['released', '已发布'],
  ['closed', '已关闭'],
])

function normalizeStoryStage(value) {
  const stage = typeof value === 'string' ? value.trim() : ''
  return { stage, stageLabel: STORY_STAGE_LABELS.get(stage.toLowerCase()) ?? stage }
}

function normalizePriority(raw) {
  const pri = String(raw?.pri ?? raw?.priority ?? '').trim()
  if (!pri) return { priority: '', priorityLabel: '' }
  return { priority: pri, priorityLabel: /^\d+$/.test(pri) ? `P${pri}` : pri }
}

/** ZenTao reports effort as `"12.50h"`; the panel needs a number to prefill. */
function hoursOf(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/h$/i, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function taskGroup(raw, fallback) {
  const execution = raw?.execution
  return (
    String(raw?.executionName ?? '').trim() ||
    nameOf(execution) ||
    String(raw?.execution_title ?? '').trim() ||
    fallback
  )
}

export function normalizeTask(raw, context) {
  if (!raw || typeof raw !== 'object') return null
  const remoteId = String(raw.id ?? '').trim()
  if (!remoteId) return null
  const status = normalizeStatus(raw)
  const priority = normalizePriority(raw)
  const execution = raw.execution
  const executionName = taskGroup(raw, context.containerName)
  return {
    source: 'zentao',
    kind: 'task',
    id: `task-${remoteId}`,
    remoteId,
    shortId: `#${remoteId}`,
    name: String(raw.name ?? raw.title ?? '').trim() || `任务 ${remoteId}`,
    description: typeof raw.desc === 'string' ? raw.desc : typeof raw.description === 'string' ? raw.description : '',
    ...status,
    owner: nameOf(raw.assignedTo) || nameOf(raw.finishedBy),
    creator: nameOf(raw.openedBy),
    ...priority,
    due: String(raw.deadline ?? raw.dueDate ?? '').trim(),
    begin: String(raw.startDate ?? raw.openedDate ?? '').trim(),
    realStarted: String(raw.realStarted ?? '').trim(),
    estimate: hoursOf(raw.estimate),
    consumed: hoursOf(raw.consumed),
    left: hoursOf(raw.left),
    created: String(raw.openedDate ?? '').trim(),
    modified: String(raw.lastEditedDate ?? '').trim(),
    iterationId: String(execution && typeof execution === 'object' ? execution.id ?? '' : execution ?? '').trim(),
    iterationName: executionName,
    categoryId: '',
    projectId: String(context.containerId ?? '').trim(),
    url: `${context.webRoot}/task-view-${encodeURIComponent(remoteId)}.html`,
    rootId: '',
    rootShortId: '',
    level: '1',
  }
}

export function normalizeStory(raw, context) {
  if (!raw || typeof raw !== 'object') return null
  const remoteId = String(raw.id ?? '').trim()
  if (!remoteId) return null
  const status = normalizeStatus(raw)
  const priority = normalizePriority(raw)
  const requirementType = REQUIREMENT_TYPES.includes(raw.type) ? raw.type : context.requirementType
  const detailSuffix = requirementType === 'story' ? '' : `-0-0-${requirementType}`
  return {
    source: 'zentao',
    kind: 'story',
    requirementType,
    id: `story-${remoteId}`,
    remoteId,
    shortId: `#${remoteId}`,
    name: String(raw.title ?? raw.name ?? '').trim() || `需求 ${remoteId}`,
    description: typeof raw.spec === 'string' ? raw.spec : typeof raw.description === 'string' ? raw.description : '',
    ...status,
    ...normalizeStoryStage(raw.stage),
    owner: nameOf(raw.assignedTo),
    creator: nameOf(raw.openedBy),
    ...priority,
    due: String(raw.dueDate ?? '').trim(),
    begin: String(raw.openedDate ?? '').trim(),
    created: String(raw.openedDate ?? '').trim(),
    modified: String(raw.lastEditedDate ?? '').trim(),
    iterationId: '',
    iterationName: context.containerName,
    categoryId: String(raw.category ?? '').trim(),
    projectId: String(context.containerId ?? '').trim(),
    url: `${context.webRoot}/story-view-${encodeURIComponent(remoteId)}${detailSuffix}.html`,
    rootId: '',
    rootShortId: '',
    level: '1',
  }
}

const SEVERITY_LABELS = new Map([
  ['1', 'P1'],
  ['2', 'P2'],
  ['3', 'P3'],
  ['4', 'P4'],
])

/** A bug carries a severity and a resolution; both matter when triaging. */
export function normalizeBug(raw, context) {
  if (!raw || typeof raw !== 'object') return null
  const remoteId = String(raw.id ?? '').trim()
  if (!remoteId) return null
  const status = normalizeStatus(raw)
  const priority = normalizePriority(raw)
  const severity = String(raw.severity ?? '').trim()
  return {
    source: 'zentao',
    kind: 'bug',
    id: `bug-${remoteId}`,
    remoteId,
    shortId: `#${remoteId}`,
    name: String(raw.title ?? '').trim() || `Bug ${remoteId}`,
    description: typeof raw.steps === 'string' ? raw.steps : typeof raw.description === 'string' ? raw.description : '',
    ...status,
    severity: SEVERITY_LABELS.get(severity) ?? severity,
    resolution: String(raw.resolution ?? '').trim(),
    // `/confirm` is only offered while the bug has not been confirmed yet.
    confirmed: raw.confirmed === true || raw.confirmed === '1' || raw.confirmed === 1,
    owner: nameOf(raw.assignedTo),
    creator: nameOf(raw.openedBy),
    ...priority,
    due: '',
    begin: String(raw.openedDate ?? '').trim(),
    created: String(raw.openedDate ?? '').trim(),
    modified: String(raw.lastEditedDate ?? '').trim(),
    iterationId: '',
    iterationName: context.containerName,
    categoryId: '',
    projectId: String(raw.project ?? context.containerId ?? '').trim(),
    url: `${context.webRoot}/bug-view-${encodeURIComponent(remoteId)}.html`,
    rootId: '',
    rootShortId: '',
    level: '1',
  }
}

/**
 * Where "who am I" lives differs by generation: v1 mounts `/user`, v2 mounts
 * `/users/me` (and answers 401 — not 404 — for the path it does not mount, so
 * the status code alone cannot tell "no such route" from "bad password").
 * Ask the one this version documents, then the other, and never let a missing
 * endpoint break listing: the settings already state who we are.
 */
const ME_PATHS = { v1: ['/user', '/users/me'], v2: ['/users/me', '/user'] }

export async function fetchMe(options) {
  const configured = String(options?.credentials?.account ?? '').trim()
  const version = await resolveVersion(options)
  let lastError
  for (const path of ME_PATHS[version] ?? ME_PATHS.v1) {
    try {
      const body = await call({ ...options, path })
      const user = body?.profile ?? body?.data?.profile ?? body?.user ?? body?.data?.user ?? body ?? {}
      return { account: accountOf(user) || configured, name: nameOf(user) }
    } catch (error) {
      lastError = error
      // Only a route the build does not mount justifies a second attempt: a
      // network error would otherwise double the login requests.
      const unmounted = error instanceof ZentaoError && (
        error.code === 'zentao/auth-failed' ||
        (error.code === 'zentao/http-error' && [401, 403, 404, 405].includes(error.details?.status))
      )
      if (!unmounted) throw error
    }
  }
  if (configured) return { account: configured, name: '' }
  throw lastError
}

function detailPath(version, kind, id, requirementType) {
  if (version === 'v2') {
    if (kind === 'bug') return `/bugs/${id}`
    if (kind === 'task') return `/tasks/${id}`
    return `/${V2_COLLECTIONS[requirementType] ?? 'stories'}/${id}`
  }
  const query = kind !== 'task' && REQUIREMENT_TYPES.includes(requirementType) && requirementType !== 'story'
    ? `?type=${requirementType}`
    : ''
  return `/${kind === 'task' ? 'tasks' : 'stories'}/${id}${query}`
}

/** List responses omit spec/desc and may omit attachment metadata. */
export async function fetchWorkDetails(options) {
  const { story } = options
  const version = await resolveVersion(options)
  const kind = story.kind === 'bug' || String(story.id).startsWith('bug-')
    ? 'bug'
    : story.kind === 'task' || String(story.id).startsWith('task-')
      ? 'task'
      : 'story'
  const id = String(story.remoteId ?? story.id ?? '').replace(/^(?:story|task|bug)-/, '')
  if (!/^\d+$/.test(id)) throw new ZentaoError('zentao/bad-request', '无效的禅道条目 ID')
  const body = await call({
    ...options,
    path: detailPath(version, kind, id, story.requirementType),
  })
  // v2 answers an epic with `{ epic: {...} }`, v1 always answers `{ story: {...} }`.
  const keys = kind === 'story'
    ? ['story', story.requirementType, V2_COLLECTIONS[story.requirementType]].filter(Boolean)
    : [kind]
  const detail = keys
    .map((key) => body?.[key] ?? body?.data?.[key])
    .find((value) => value && typeof value === 'object') ?? body?.data ?? body
  if (String(detail?.id ?? '') !== id) {
    throw new ZentaoError('zentao/detail-failed', `禅道没有返回条目 #${id} 的详情`)
  }
  const description = kind === 'bug'
    ? detail.steps ?? detail.description
    : kind === 'task'
      ? detail.desc ?? detail.description
      : detail.spec ?? detail.description
  return {
    ...story,
    ...(kind === 'story' && typeof detail.stage === 'string' ? normalizeStoryStage(detail.stage) : {}),
    description: typeof description === 'string' ? description : story.description,
    sourceFiles: Object.values(detail.files ?? {}),
    // The list snapshot is stale by design; callers re-normalize this so a
    // status change (ours or someone else's) is reflected immediately.
    detail,
  }
}

function imageSource(src, root) {
  const placeholder = /^\{(\d+)(?:\.(\w+))?\}$/.exec(src)
  if (placeholder) return { id: placeholder[1], ext: placeholder[2] }
  const url = new URL(src, root)
  if (url.origin !== root.origin || url.username || url.password) {
    throw new ZentaoError('zentao/image-failed', '禅道正文包含站外图片，无法通过禅道读取')
  }
  const filename = url.pathname.split('/').at(-1)
  const fileLink = /^file-(?:read|download|viewdownload)-(\d+)(?:-\d+)?(?:-view)?(?:\.(\w+))?$/i.exec(filename)
  const apiFile = /^\d+$/.test(filename) && /\/api\.php\/v1\/files\/[^/]+$/.test(url.pathname)
  if (apiFile) return { id: filename }
  const queryId = url.searchParams.get('fileID')
  if (fileLink) return { id: fileLink[1], ext: fileLink[2] }
  if (url.searchParams.get('m') === 'file' && /^(read|download)$/.test(url.searchParams.get('f') ?? '') && /^\d+$/.test(queryId ?? '')) {
    return { id: queryId, ext: url.searchParams.get('t') }
  }
  if (!url.pathname.startsWith(`${root.pathname}data/upload/`)) {
    throw new ZentaoError('zentao/image-failed', '禅道正文包含无法识别的图片地址')
  }
  return { url: url.href, ext: filename.split('.').at(-1) }
}

async function readAssetBytes(response, limit, name) {
  const reader = response.body?.getReader()
  const chunks = []
  let size = 0
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) {
          await reader.cancel().catch(() => {})
          throw new ZentaoError('zentao/asset-too-large', `禅道附件「${name}」超过草稿大小限制`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }
  if (size === 0) throw new ZentaoError('zentao/asset-failed', `禅道附件「${name}」为空`)
  return Buffer.concat(chunks, size)
}

function imageType(data) {
  if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return IMAGE_TYPES.png
  if (data.subarray(0, 3).toString('hex') === 'ffd8ff') return IMAGE_TYPES.jpg
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) return IMAGE_TYPES.gif
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return IMAGE_TYPES.webp
  return ''
}

/** Resolve rich-text screenshots and file IDs into the shared dispatch payload. */
export async function fetchWorkAssets(options) {
  const { story, baseUrl } = options
  const root = new URL(`${webRoot(baseUrl)}/`)
  const refs = new Map()
  for (const match of String(story.description ?? '').matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const src = (match[1] ?? match[2] ?? match[3]).replace(/&amp;|&#38;|&#x26;/gi, '&').trim()
    const inline = /^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(src)
    const ref = inline ? { inline: inline[2], ext: inline[1] } : imageSource(src, root)
    refs.set(ref.id ?? src, { ...ref, image: true })
  }
  for (const file of story.sourceFiles ?? []) {
    const id = String(file?.id ?? '')
    if (!/^\d+$/.test(id)) continue
    refs.set(id, { id, ext: file.extension, name: file.title ?? file.name, ...refs.get(id) })
  }
  const files = []
  const images = []
  let total = 0
  for (const ref of refs.values()) {
    const ext = String(ref.ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const image = ref.image || Object.hasOwn(IMAGE_TYPES, ext)
    const limit = Math.min(image ? MAX_IMAGE_BYTES : MAX_ASSET_BYTES, MAX_ASSET_BYTES - total)
    let name = String(ref.name ?? '').trim() || `${image ? '禅道图片' : '禅道附件'}-${ref.id ?? images.length + 1}`
    let data
    if (ref.inline) {
      if (Buffer.byteLength(ref.inline, 'base64') > limit + 2) throw new ZentaoError('zentao/asset-too-large', `禅道图片「${name}」超过草稿大小限制`)
      data = Buffer.from(ref.inline, 'base64')
      if (data.byteLength > limit) throw new ZentaoError('zentao/asset-too-large', `禅道图片「${name}」超过草稿大小限制`)
    } else {
      // Attachments stay on the v1 surface: v2 documents no binary endpoint.
      const response = await call({ ...options, version: 'v1', path: `/files/${ref.id}`, assetUrl: ref.url, binary: true })
      const type = response.headers.get('content-type') ?? ''
      if (/^(?:text\/html|application\/json)\b/i.test(type) && !/^attachment\b/i.test(response.headers.get('content-disposition') ?? '')) {
        await response.body?.cancel()
        throw new ZentaoError('zentao/asset-failed', `禅道没有返回附件「${name}」的文件内容`)
      }
      data = await readAssetBytes(response, limit, name)
    }
    total += data.byteLength
    const mediaType = imageType(data)
    if (image && !mediaType) throw new ZentaoError('zentao/image-failed', `禅道图片「${name}」格式无效或不受支持`)
    const extension = mediaType === IMAGE_TYPES.jpg ? 'jpg' : mediaType?.split('/')[1] || ext
    const namedExtension = name.toLowerCase().split('.').at(-1)
    if (extension && namedExtension !== extension && IMAGE_TYPES[namedExtension] !== mediaType) name += `.${extension}`
    if (mediaType) images.push({ name, mediaType, data })
    else files.push({ name, data })
  }
  return { files, images }
}

/** Products, projects and executions that can act as the work container. */
export async function listContainers(options) {
  await ensureToken(options)
  const [products, projects, executions] = await Promise.all([
    paged(options, (page, version) => `/products?${pageQuery(version, page, PAGE_SIZE)}`, ['products']),
    paged(options, (page, version) => `/projects?${pageQuery(version, page, PAGE_SIZE)}`, ['projects']),
    paged(options, (page, version) => `/executions?${pageQuery(version, page, PAGE_SIZE)}`, ['executions']),
  ])
  const map = (wanted) => (raw) => {
    const id = String(raw?.id ?? '').trim()
    if (!id) return null
    return {
      id,
      name: String(raw?.name ?? '').trim() || id,
      kind: wanted,
      parent: String(raw?.project ?? '').trim(),
    }
  }
  return {
    products: products.map(map('product')).filter(Boolean),
    projects: projects.map(map('project')).filter(Boolean),
    executions: executions.map(map('execution')).filter(Boolean),
  }
}

/**
 * Stories (product scope), tasks (project scope) or bugs (bug scope) assigned
 * to the current ZenTao user.
 */
export async function fetchMyWork(options) {
  const { baseUrl, containerId, containerName, containerIds, containerNames, scope = 'product', includeStatusOptions } = options ?? {}
  const containers = [...new Set((containerIds ?? [containerId]).map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (containers.length === 0) throw new ZentaoError('zentao/missing-container', '尚未选择禅道产品/项目')
  const me = await fetchMe(options)
  const matches = (raw) => {
    const assignee = raw?.assignedTo
    const account = accountOf(assignee)
    if (account && me.account && account.toLowerCase() === me.account.toLowerCase()) return true
    if (account && typeof assignee === 'object') return false
    return Boolean(me.name && nameOf(assignee) === me.name)
  }
  const byId = new Map()
  const names = []
  const root = webRoot(baseUrl)
  let rawCount = 0
  for (const id of containers) {
    const name = String(containerNames?.[id] ?? (containerIds == null ? containerName ?? '' : '')).trim() || id
    names.push(name)
    const result = await fetchContainerWork(options, { containerId: id, containerName: name, webRoot: root, scope }, matches)
    rawCount += result.rawCount
    for (const item of result.items) {
      if (!byId.has(item.id)) byId.set(item.id, item)
    }
  }
  const items = [...byId.values()]
  const statusOptions = includeStatusOptions
    ? scope === 'project'
      ? [...TASK_STATUS_LABELS.values()]
      : scope === 'bug'
        ? [...BUG_STATUS_LABELS.values()]
        : [...STORY_STAGE_LABELS.values(), STORY_STATUS_LABELS.get('draft'), STORY_STATUS_LABELS.get('changed')]
    : undefined
  return {
    items,
    stories: items,
    rawCount,
    ...(statusOptions && { statusOptions }),
    iterations: [...new Set(items.map((item) => item.iterationName).filter(Boolean))],
    me,
    containerName: names.join(', '),
  }
}

async function fetchContainerWork(options, context, matches) {
  const { scope = 'product', pageSize = PAGE_SIZE } = options
  const version = await resolveVersion(options)
  const container = encodeURIComponent(context.containerId)
  if (scope === 'project') {
    const executions = await paged(
      options,
      (page, v) => `/projects/${container}/executions?${pageQuery(v, page, pageSize)}`,
      ['executions'],
    )
    const items = []
    let rawCount = 0
    for (const execution of executions) {
      const executionId = String(execution?.id ?? '').trim()
      if (!executionId) continue
      const rows = await paged(
        options,
        (page, v) => `/executions/${encodeURIComponent(executionId)}/tasks?${pageQuery(v, page, pageSize)}${v === 'v2' ? '&status=all' : ''}`,
        ['tasks'],
      )
      rawCount += rows.length
      for (const raw of rows) {
        if (!matches(raw)) continue
        const task = normalizeTask(raw, {
          ...context,
          containerName: String(execution?.name ?? '').trim() || context.containerName,
        })
        if (task) items.push(task)
      }
    }
    return { items, rawCount }
  }
  if (scope === 'bug') {
    const rows = await paged(
      options,
      (page, v) => `/products/${container}/bugs?${pageQuery(v, page, pageSize)}${v === 'v2' ? '&browseType=all' : ''}`,
      ['bugs'],
    )
    const items = rows
      .filter((raw) => matches(raw))
      .map((raw) => normalizeBug(raw, context))
      .filter(Boolean)
    return { items, rawCount: rows.length }
  }
  if (version === 'v2') {
    // v2 mounts each requirement type on its own collection.
    const items = []
    let rawCount = 0
    for (const type of REQUIREMENT_TYPES) {
      const rows = await paged(
        options,
        (page, v) => `/products/${container}/${V2_COLLECTIONS[type]}?${pageQuery(v, page, pageSize)}&browseType=allstory`,
        [V2_COLLECTIONS[type], 'stories'],
      )
      rawCount += rows.length
      for (const raw of rows) {
        if (!matches(raw)) continue
        const story = normalizeStory(raw, { ...context, requirementType: type })
        if (story) items.push(story)
      }
    }
    return { items, rawCount }
  }
  const batches = await Promise.all(REQUIREMENT_TYPES.map((type) => paged(
    options,
    (page, v) => `/products/${container}/stories?${pageQuery(v, page, pageSize)}&type=${type}`,
    ['stories'],
  )))
  // All types share the same ZenTao story IDs. Some responses also include
  // related requirements from another type, or ignore type on older versions.
  const rows = new Map()
  for (const [index, batch] of batches.entries()) {
    for (const raw of batch) {
      const story = normalizeStory(raw, { ...context, requirementType: REQUIREMENT_TYPES[index] })
      if (story && !rows.has(story.id)) rows.set(story.id, { story, assigned: matches(raw) })
    }
  }
  const items = [...rows.values()].filter((row) => row.assigned).map((row) => row.story)
  return { items, rawCount: rows.size }
}

/** The "read from" scope selects both the collection and the status labels. */
export function collectionOfScope(scope) {
  return scope === 'project' ? 'tasks' : scope === 'bug' ? 'bugs' : 'stories'
}

export function statusOptionsOfScope(scope) {
  if (scope === 'project') return [...TASK_STATUS_LABELS.values()]
  if (scope === 'bug') return [...BUG_STATUS_LABELS.values()]
  return [...STORY_STAGE_LABELS.values(), STORY_STATUS_LABELS.get('draft'), STORY_STATUS_LABELS.get('changed')]
}

/** Normalize raw rows from either the REST API or the CLI (same field names). */
export function normalizeRows(scope, rows, context) {
  return rows
    .map((raw) => {
      if (scope === 'project') return normalizeTask(raw, context)
      if (scope === 'bug') return normalizeBug(raw, context)
      const type = ['story', 'requirement', 'epic'].includes(raw?.type) ? raw.type : 'story'
      return normalizeStory(raw, { ...context, requirementType: type })
    })
    .filter(Boolean)
}

/**
 * Server-side "assigned to me" (`/my/*`, ZenTao >= 22.5).
 * v1 has no such endpoint, so this is v2-and-newer only.
 */
export async function fetchMyItems(options) {
  const { baseUrl, scope = 'product', includeStatusOptions } = options ?? {}
  const version = await resolveVersion(options)
  if (version === 'v1') {
    throw new ZentaoError(
      'zentao/unsupported-version',
      '内置 v1 通道没有「我的地盘」接口。请把数据通道切换为 v2（禅道 22.5+）或 zentao-cli。',
    )
  }
  const collection = collectionOfScope(scope)
  const rows = await paged(
    options,
    (page, v) => `/my/${collection}?${pageQuery(v, page, PAGE_SIZE)}`,
    [collection],
  )
  const me = await fetchMe(options)
  const context = { webRoot: webRoot(baseUrl), containerId: '', containerName: '我的地盘' }
  const items = normalizeRows(scope, rows, context)
  return {
    items,
    rawCount: rows.length,
    serverFiltered: true,
    me,
    containerName: '我的地盘',
    iterations: [...new Set(items.map((item) => item.iterationName).filter(Boolean))],
    ...(includeStatusOptions && { statusOptions: statusOptionsOfScope(scope) }),
  }
}

/**
 * People a card can be reassigned to. Cached briefly: the roster changes
 * rarely and every modal open would otherwise re-page 50+ users.
 */
const usersCache = new Map()
const USERS_TTL_MS = 10 * 60_000

export async function listUsers(options) {
  const key = `${String(options?.baseUrl ?? '')}|${String(options?.credentials?.account ?? '')}`
  const cached = usersCache.get(key)
  if (cached && Date.now() - cached.at < USERS_TTL_MS) return cached.users
  const rows = await paged(options, (page, v) => `/users?${pageQuery(v, page, PAGE_SIZE)}`, ['users'])
  const users = rows
    .filter((raw) => raw && !raw.deleted)
    .map((raw) => ({
      account: String(raw.account ?? '').trim(),
      name: String(raw.realname ?? raw.account ?? '').trim(),
      role: String(raw.role ?? '').trim(),
      // Empty on most installs, but the search box uses it when it is there.
      pinyin: String(raw.pinyin ?? '').trim(),
    }))
    .filter((user) => user.account)
  usersCache.set(key, { users, at: Date.now() })
  return users
}

export function resetZentaoTokens() {
  tokenCache.clear()
  resolvedVersions.clear()
  usersCache.clear()
}
