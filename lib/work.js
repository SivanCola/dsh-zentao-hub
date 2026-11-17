/**
 * One adapter over the three data channels.
 *
 * `v1` / `v2` / `auto` talk to the ZenTao REST API directly (lib/zentao.js);
 * `cli` shells out to the official zentao-cli (lib/cli.js). Both produce the
 * same normalized work item, so the host routes and the panel do not care
 * which one is configured.
 *
 * Channel capabilities, kept explicit because the UI explains them:
 *   v1   read containers only, no /my/*, no state transitions
 *   v2   /my/* (ZenTao 22.5+) and REST state transitions
 *   cli  /my/*, state transitions, auth and version gates owned by the CLI
 */
import {
  cliStatus,
  createRunner,
  itemGetArgs,
  kindOf,
  myListArgs,
  rowsFrom,
  runJson,
  totalFrom,
  KINDS,
  CliError,
} from './cli.js'
import {
  normalizeRows,
  statusOptionsOfScope,
  fetchMyItems,
  fetchMyWork,
  fetchWorkAssets,
  fetchWorkDetails,
  webRoot,
  ZentaoError,
} from './zentao.js'

export class SourceError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'SourceError'
    this.code = code
    this.details = details
  }
}

/** Dispatch state is keyed by this string; it must stay stable across versions. */
export function uidOf(id) {
  return `zentao:${String(id ?? '')}`
}

const CHANNELS = ['v1', 'v2', 'auto', 'cli']

export function channelOf(config) {
  return CHANNELS.includes(config?.transport) ? config.transport : 'v1'
}

/** Channel capability flags the panel uses to enable buttons. */
export function channelCapabilities(config) {
  const channel = channelOf(config)
  return {
    channel,
    // /my/* needs v2 or the CLI.
    myWork: channel !== 'v1',
    // State transitions need a writable channel.
    writeBack: channel === 'v2' || channel === 'cli',
    // Attachments always come from v1, so they need REST credentials.
    assets: channel !== 'cli',
  }
}

function translate(error) {
  if (error instanceof ZentaoError) return new SourceError(error.code, error.message, error.details)
  if (error instanceof CliError) return new SourceError(error.code, error.message, error.details)
  return error
}

function sortByModified(items) {
  return items.sort((left, right) => String(right.modified).localeCompare(String(left.modified)))
}

const runners = new Map()

/** One runner per binary path; tests inject their own. */
export function runnerFor(config, injected) {
  if (injected) return injected
  const bin = String(config?.cliBin ?? '').trim() || 'zentao'
  if (!runners.has(bin)) {
    runners.set(bin, createRunner({ binPath: bin, assistant: 'AI dsh-zentao' }))
  }
  return runners.get(bin)
}

const statusCache = new Map()

/** The site the CLI is logged into, used when no URL is configured. */
export async function cliSite(runner) {
  const key = runner
  if (statusCache.has(key)) return statusCache.get(key)
  const status = await cliStatus(runner)
  statusCache.set(key, status)
  return status
}

export function resetCliCache() {
  statusCache.clear()
}

async function baseUrlFor(config, runner) {
  const configured = String(config?.baseUrl ?? '').trim()
  if (configured) return configured
  const status = await cliSite(runner)
  return status.server
}

function contextFor(baseUrl) {
  return { webRoot: webRoot(baseUrl), containerId: '', containerName: '我的地盘' }
}

/** List my work through `zentao my <collection>`. */
async function cliListWork({ config, runner, excludeCompleted, includeStatusOptions }) {
  const { kind, args } = myListArgs(config.scope)
  const { data, meta } = await runJson(runner, args)
  const rows = rowsFrom(data, KINDS[kind].my)
  const baseUrl = await baseUrlFor(config, runner)
  const items = normalizeRows(config.scope, rows, contextFor(baseUrl))
  const ownerFilteredEmpty = totalFrom(meta, data, rows.length) > 0 && items.length === 0
  const filtered = excludeCompleted ? items.filter((item) => !item.completed) : items
  return {
    items: filtered.map((item) => ({ ...item, uid: uidOf(item.id) })),
    rawCount: rows.length,
    serverFiltered: true,
    channel: 'cli',
    ownerFilteredEmpty,
    iterations: [...new Set(filtered.map((item) => item.iterationName).filter(Boolean))],
    ...(includeStatusOptions && { statusOptions: statusOptionsOfScope(config.scope) }),
  }
}

/** Work assigned to me, through whichever channel can answer. */
export async function listWork(options) {
  const { settings, credentials, excludeCompleted = true, includeStatusOptions, fetchImpl, runner } = options ?? {}
  const config = settings.zentao ?? {}
  const channel = channelOf(config)
  try {
    if (channel === 'cli') {
      return await cliListWork({ config, runner: runnerFor(config, runner), excludeCompleted, includeStatusOptions })
    }
    const base = {
      baseUrl: config.baseUrl,
      version: config.transport,
      credentials: credentials ?? {},
      scope: config.scope,
      fetchImpl,
    }
    // /my/* when the channel supports it, containers as the fallback.
    if (channel !== 'v1' && config.myWork !== false) {
      try {
        const mine = await fetchMyItems({ ...base, includeStatusOptions })
        const filtered = excludeCompleted ? mine.items.filter((item) => !item.completed) : mine.items
        return {
          items: filtered.map((item) => ({ ...item, uid: uidOf(item.id) })),
          rawCount: mine.rawCount,
          serverFiltered: true,
          channel,
          iterations: mine.iterations,
          ...(includeStatusOptions && mine.statusOptions && { statusOptions: mine.statusOptions }),
        }
      } catch (error) {
        const notThere = error?.code === 'zentao/unsupported-version' ||
          (error?.code === 'zentao/http-error' && [404, 405].includes(error?.details?.status))
        if (!notThere) throw error
        // ZenTao older than 22.5 has no /my/*: fall back to enumeration.
      }
    }
    const result = await fetchMyWork({
      ...base,
      containerId: config.containerId,
      containerName: config.containerName,
      containerIds: config.containerIds,
      containerNames: config.containerNames,
      includeStatusOptions,
    })
    const ownerFilteredEmpty = result.rawCount > 0 && result.items.length === 0
    let items = result.items.map((item) => ({ ...item, uid: uidOf(item.id) }))
    if (excludeCompleted) items = items.filter((item) => !item.completed)
    return {
      items,
      rawCount: result.rawCount,
      channel,
      iterations: result.iterations,
      ownerFilteredEmpty,
      ...(includeStatusOptions && result.statusOptions && { statusOptions: result.statusOptions }),
    }
  } catch (error) {
    throw translate(error)
  }
}

/** Re-read one item before dispatching; returns the normalized item. */
export async function fetchWork(options) {
  const { settings, credentials, story, fetchImpl, runner } = options ?? {}
  if (!story) throw new SourceError('source/bad-request', '缺少任务信息')
  const config = settings.zentao ?? {}
  try {
    if (channelOf(config) === 'cli') {
      const binary = runnerFor(config, runner)
      const { kind, args } = itemGetArgs(story)
      const { data } = await runJson(binary, args)
      const row = data?.[KINDS[kind].resource] ?? data?.data?.[KINDS[kind].resource] ?? data
      const baseUrl = await baseUrlFor(config, binary)
      const scope = kind === 'task' ? 'project' : kind === 'bug' ? 'bug' : 'product'
      const [fresh] = normalizeRows(scope, [row], contextFor(baseUrl))
      if (!fresh) throw new SourceError('zentao/detail-failed', `禅道没有返回条目 #${story.id} 的详情`)
      return {
        ...fresh,
        ...(fresh.requirementType === undefined && story.requirementType ? { requirementType: story.requirementType } : {}),
        sourceFiles: Object.values(row?.files ?? {}),
        uid: uidOf(fresh.id),
        channel: 'cli',
      }
    }
    const fresh = await fetchWorkDetails({
      baseUrl: config.baseUrl,
      version: config.transport,
      credentials,
      story,
      fetchImpl,
    })
    const { detail, ...rest } = fresh
    // Re-normalize the detail so status/priority are the values ZenTao has now,
    // not the ones the list showed when the panel was drawn.
    const scope = kindOf(rest) === 'task'
      ? 'project'
      : kindOf(rest) === 'bug'
        ? 'bug'
        : 'product'
    const [normalized] = detail
      ? normalizeRows(scope, [detail], {
          webRoot: webRoot(config.baseUrl ?? ''),
          containerId: String(rest.projectId ?? ''),
          containerName: String(rest.iterationName ?? ''),
        })
      : []
    // Only overwrite what the detail actually carried; a detail response
    // without a title must not rename the item to "需求 101".
    const patch = {}
    if (normalized && detail) {
      if (detail.status !== undefined) {
        patch.status = normalized.status
        patch.vStatus = normalized.vStatus
        patch.completed = normalized.completed
        patch.resolved = normalized.resolved
      }
      if (detail.title !== undefined || detail.name !== undefined) patch.name = normalized.name
      if (detail.severity !== undefined) patch.severity = normalized.severity
      if (detail.resolution !== undefined) patch.resolution = normalized.resolution
      if (detail.assignedTo !== undefined) patch.owner = normalized.owner
      if (detail.pri !== undefined || detail.priority !== undefined) {
        patch.priority = normalized.priority
        patch.priorityLabel = normalized.priorityLabel
      }
      if (detail.lastEditedDate !== undefined) patch.modified = normalized.modified
    }
    return {
      ...rest,
      ...patch,
      uid: uidOf(rest.id),
      channel: channelOf(config),
    }
  } catch (error) {
    throw translate(error)
  }
}

/**
 * Download screenshots and attachments for the dispatch draft.
 *
 * The CLI channel has no binary access, so it only works when REST
 * credentials are also configured; otherwise the draft says so instead of
 * silently dropping the files.
 */
export async function fetchAssets({ settings, credentials, story, fetchImpl, runner }) {
  const config = settings.zentao ?? {}
  try {
    if (channelOf(config) === 'cli') {
      if (!credentials?.password) {
        return {
          files: [],
          images: [],
          unavailable: '附件与正文图片未随任务下发：cli 通道没有二进制下载能力，请在禅道任务页查看（或同时配置禅道账号密码）。',
        }
      }
      const baseUrl = await baseUrlFor(config, runnerFor(config, runner))
      return await fetchWorkAssets({ baseUrl, version: 'v1', credentials, story, fetchImpl })
    }
    return await fetchWorkAssets({
      baseUrl: config.baseUrl,
      version: config.transport,
      credentials,
      story,
      fetchImpl,
    })
  } catch (error) {
    throw translate(error)
  }
}

export { kindOf }
