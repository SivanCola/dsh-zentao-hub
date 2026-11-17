/**
 * One adapter over the ZenTao client.
 *
 * The task hub had a provider registry because TAPD and ZenTao shared a panel.
 * Here there is exactly one source, so this module is the seam that turns
 * settings + credentials into normalized work items, and translates client
 * errors into the codes the host routes answer with.
 */
import { fetchMyWork, fetchWorkAssets, fetchWorkDetails, ZentaoError } from './zentao.js'

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

function translate(error) {
  if (error instanceof ZentaoError) return new SourceError(error.code, error.message, error.details)
  return error
}

function sortByModified(items) {
  return items.sort((left, right) => String(right.modified).localeCompare(String(left.modified)))
}

/** Work assigned to me in the configured scope. */
export async function listWork(options) {
  const { settings, credentials, excludeCompleted = true, includeStatusOptions, fetchImpl } = options ?? {}
  const config = settings.zentao ?? {}
  let result
  try {
    result = await fetchMyWork({
      baseUrl: config.baseUrl,
      version: config.apiVersion,
      credentials: credentials ?? {},
      scope: config.scope,
      containerId: config.containerId,
      containerName: config.containerName,
      containerIds: config.containerIds,
      containerNames: config.containerNames,
      includeStatusOptions,
      fetchImpl,
    })
  } catch (error) {
    throw translate(error)
  }
  const ownerFilteredEmpty = result.rawCount > 0 && result.items.length === 0
  let items = result.items.map((item) => ({ ...item, uid: uidOf(item.id) }))
  if (excludeCompleted) items = items.filter((item) => !item.completed)
  return {
    items,
    rawCount: result.rawCount,
    iterations: result.iterations,
    ownerFilteredEmpty,
    ...(result.statusOptions && { statusOptions: result.statusOptions }),
  }
}

/** Re-read one item before dispatching; returns the normalized item. */
export async function fetchWork(options) {
  const { settings, credentials, story, fetchImpl } = options ?? {}
  if (!story) throw new SourceError('source/bad-request', '缺少任务信息')
  try {
    const fresh = await fetchWorkDetails({
      baseUrl: settings.zentao.baseUrl,
      version: settings.zentao.apiVersion,
      credentials,
      story,
      fetchImpl,
    })
    return { ...fresh, uid: uidOf(fresh.id) }
  } catch (error) {
    throw translate(error)
  }
}

/** Download screenshots and attachments for the dispatch draft. */
export async function fetchAssets({ settings, credentials, story, fetchImpl }) {
  try {
    return await fetchWorkAssets({
      baseUrl: settings.zentao.baseUrl,
      version: settings.zentao.apiVersion,
      credentials,
      story,
      fetchImpl,
    })
  } catch (error) {
    throw translate(error)
  }
}
