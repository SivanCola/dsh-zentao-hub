/**
 * Settings and dispatch-state persistence.
 *
 * The harness storage domain service needs a zod DomainSpec, which is more
 * machinery than this plugin needs, so two small JSON files live under
 * ~/.dsh/zentao/. Secrets never go here: the ZenTao password and the gateway
 * password are owned by the host credentials service.
 *
 * First read also imports what dsh-task-hub (TAPD + ZenTao, one panel) had
 * already stored: its ZenTao settings and its `zentao:*` dispatch records.
 * Losing that history on a split would be the one thing users notice.
 */
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DATA_DIR = path.join(os.homedir(), '.dsh', 'zentao')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const STATE_FILE = path.join(DATA_DIR, 'state.json')

// dsh-task-hub kept both trackers in one directory; only the ZenTao half is
// ours to inherit.
const HUB_DIR = path.join(os.homedir(), '.dsh', 'task-hub')

let readyPromise = null
const writes = new Map()

function serializeWrite(file, operation) {
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(operation)
  writes.set(file, next)
  return next.finally(() => {
    if (writes.get(file) === next) writes.delete(file)
  })
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function readJson(file, allowInvalid = true) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && (error.code === 'ENOENT' || (allowInvalid && error.name === 'SyntaxError'))) return null
    throw error
  }
}

async function writeJsonNow(file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/** Public writer: waits for the data directory and the one-off migration. */
async function writeJson(file, value) {
  await ready()
  return writeJsonNow(file, value)
}

function hubSettings(raw) {
  const zentao = raw?.zentao
  return zentao && typeof zentao === 'object' && String(zentao.baseUrl ?? '').trim() ? raw : null
}

/** Copy the ZenTao half of the task hub's files, once. */
async function migrateFromTaskHub() {
  if (!(await exists(HUB_DIR))) return
  if (!(await exists(SETTINGS_FILE))) {
    const previous = hubSettings(await readJson(path.join(HUB_DIR, 'settings.json')))
    if (previous) {
      await writeJsonNow(SETTINGS_FILE, normalizeSettings(previous))
    }
  }
  if (!(await exists(STATE_FILE))) {
    const hubState = await readJson(path.join(HUB_DIR, 'state.json'))
    if (hubState && typeof hubState === 'object' && !Array.isArray(hubState)) {
      const mine = Object.fromEntries(Object.entries(hubState).filter(([key]) => key.startsWith('zentao:')))
      if (Object.keys(mine).length > 0) await writeJsonNow(STATE_FILE, mine)
    }
  }
}

function ready() {
  readyPromise ??= (async () => {
    await mkdir(DATA_DIR, { recursive: true })
    try {
      await migrateFromTaskHub()
    } catch {
      // Never block the panel on a migration hiccup; defaults are used instead.
    }
  })()
  return readyPromise
}

export const DEFAULT_SETTINGS = Object.freeze({
  zentao: Object.freeze({
    baseUrl: '',
    // v1 | v2 | auto | cli — see lib/work.js for what each channel can do.
    transport: 'v1',
    cliBin: 'zentao',
    basicAuth: false,
    basicAccount: '',
    account: '',
    owner: '',
    scope: 'product',
    // Prefer the server-side /my/* collections when the channel supports them.
    myWork: true,
    containerIds: [],
    containerNames: {},
  }),
  defaultWorkspacePath: '',
  baseBranch: '',
  useWorktree: true,
  excludeCompleted: true,
  agentPreset: '',
})

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function numericIds(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return [
    ...new Set(
      list
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  ]
}

const SCOPES = ['product', 'project', 'bug']
const TRANSPORTS = ['v1', 'v2', 'auto', 'cli']

function normalizeZentao(input) {
  const raw = asRecord(input)
  const containerIds = numericIds(raw.containerIds ?? [raw.containerId])
  const names = asRecord(raw.containerNames)
  const legacyId = String(raw.containerId ?? '').trim()
  const containerNames = {}
  for (const id of containerIds) {
    const name = asString(names[id] ?? (id === legacyId ? raw.containerName : '')).trim()
    if (name) containerNames[id] = name
  }
  return {
    baseUrl: asString(raw.baseUrl).trim().replace(/\/+$/, ''),
    // v1 is the channel the task hub ran in production; the rest are opt-in.
    // Older settings called this `apiVersion`, so that name still migrates.
    transport: TRANSPORTS.includes(raw.transport)
      ? raw.transport
      : TRANSPORTS.includes(raw.apiVersion)
        ? raw.apiVersion
        : DEFAULT_SETTINGS.zentao.transport,
    cliBin: asString(raw.cliBin, DEFAULT_SETTINGS.zentao.cliBin).trim() || DEFAULT_SETTINGS.zentao.cliBin,
    myWork: asBoolean(raw.myWork, DEFAULT_SETTINGS.zentao.myWork),
    basicAuth: asBoolean(raw.basicAuth, false),
    basicAccount: asString(raw.basicAccount).trim(),
    account: asString(raw.account).trim(),
    owner: asString(raw.owner).trim(),
    scope: SCOPES.includes(raw.scope) ? raw.scope : DEFAULT_SETTINGS.zentao.scope,
    containerIds,
    containerNames,
  }
}

/** Normalize whatever is on disk into a complete, typed settings object. */
export function normalizeSettings(raw) {
  const input = asRecord(raw)
  return {
    zentao: normalizeZentao(input.zentao ?? DEFAULT_SETTINGS.zentao),
    defaultWorkspacePath: asString(input.defaultWorkspacePath).trim(),
    baseBranch: asString(input.baseBranch).trim(),
    useWorktree: asBoolean(input.useWorktree, DEFAULT_SETTINGS.useWorktree),
    excludeCompleted: asBoolean(input.excludeCompleted, DEFAULT_SETTINGS.excludeCompleted),
    agentPreset: asString(input.agentPreset).trim(),
  }
}

export async function loadSettings() {
  await ready()
  return normalizeSettings(await readJson(SETTINGS_FILE))
}

/** Merge a patch into the stored settings; returns the normalized result. */
export function saveSettings(patch) {
  return serializeWrite(SETTINGS_FILE, async () => {
    const current = await loadSettings()
    const input = asRecord(patch)
    const merged = { ...current, ...input }
    if (input.zentao && typeof input.zentao === 'object') merged.zentao = { ...current.zentao, ...input.zentao }
    const next = normalizeSettings(merged)
    await writeJson(SETTINGS_FILE, next)
    return next
  })
}

/** dispatch key (zentao:storyId) -> dispatch record */
export async function loadState() {
  await ready()
  const raw = await readJson(STATE_FILE)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

export function saveState(state) {
  return serializeWrite(STATE_FILE, async () => {
    const input = asRecord(state)
    await writeJson(STATE_FILE, input)
    return input
  })
}

export function putDispatch(storyKey, record) {
  return serializeWrite(STATE_FILE, async () => {
    await ready()
    const state = asRecord(await readJson(STATE_FILE, false))
    state[String(storyKey)] = record
    await writeJson(STATE_FILE, state)
    return state
  })
}

export async function getDispatch(storyKey) {
  const state = await loadState()
  return state[String(storyKey)] ?? null
}

/** Read a dispatch record by its stable key. */
export async function findDispatch(storyId) {
  const state = await loadState()
  return state[`zentao:${storyId}`] ?? null
}
