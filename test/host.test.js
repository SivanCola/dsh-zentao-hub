import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

import { gitExec, tempRepo } from './helpers.js'

const dataHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-zentao-host-test-'))
const home = os.homedir
let host
let store
let drafts
try {
  os.homedir = () => dataHome
  host = await import('../lib/index.js')
  store = await import('../lib/store.js')
  drafts = await import('../lib/drafts.js')
} finally {
  os.homedir = home
}
after(() => rm(dataHome, { recursive: true, force: true }))

const STORY_ID = 'story-101'
const STORY = {
  id: STORY_ID,
  remoteId: '101',
  source: 'zentao',
  projectId: '7',
  kind: 'story',
  requirementType: 'story',
  shortId: '#101',
  name: '禅道任务',
}

function trackerFetch(url) {
  const { hostname, pathname } = new URL(url)
  if (hostname !== 'zentao.example.test') throw new Error('Unexpected request: ' + hostname + pathname)
  if (pathname.endsWith('/tokens')) return Response.json({ token: 'fake-zt-token' })
  if (pathname.endsWith('/users/login')) return Response.json({ status: 'success', token: 'fake-zt-token' })
  if (pathname.endsWith('/user')) return Response.json({ profile: { account: 'account', realname: '测试用户' } })
  if (pathname.endsWith('/products')) return Response.json({ products: [{ id: '7', name: '产品 A' }] })
  if (pathname.endsWith('/projects')) return Response.json({ projects: [{ id: '3', name: '项目 B' }] })
  if (pathname.endsWith('/executions')) return Response.json({ executions: [] })
  if (pathname.endsWith('/products/7/stories')) {
    return Response.json({
      total: 2,
      stories: [
        { id: '101', title: '禅道任务', assignedTo: { account: 'account' }, status: 'active', type: 'story' },
        { id: '102', title: '已完成', assignedTo: { account: 'account' }, status: 'closed', type: 'story' },
      ],
    })
  }
  if (pathname.endsWith('/products/7/bugs')) {
    return Response.json({ bugs: [{ id: '9', title: '页面报错', assignedTo: 'account', status: 'active', severity: 1 }] })
  }
  if (pathname.endsWith('/stories/101')) {
    return Response.json({ id: '101', spec: '<p>最新需求正文</p>', files: [{ id: '4', title: 'details.txt', extension: 'txt' }] })
  }
  if (pathname.endsWith('/files/4')) return new Response('new attachment')
  if (pathname.endsWith('/users')) {
    return Response.json({
      total: 2,
      users: [
        { id: 1, account: 'account', realname: '测试用户', role: 'dev' },
        { id: 2, account: 'anna', realname: '安娜', role: 'qa' },
      ],
    })
  }
  throw new Error('Unexpected request: ' + pathname)
}

function setupHost({ secrets = {}, items = [], workspace } = {}) {
  const workspaces = new Map(workspace ? [[workspace.id, workspace]] : [])
  const routes = new Map()
  const created = []
  const behavior = { listError: false, attachError: false }
  const services = {
    connection: { fetch: { register(route) { routes.set(route.path, route.fetch) } } },
    workspaceRegistry: {
      list: () => [...workspaces.values()],
      get: (id) => workspaces.get(id),
      resolveByPath: (target) => [...workspaces.values()].find((item) => item.path === target),
      create(target, title) {
        const entry = {
          id: 'workspace-' + (workspaces.size + 1),
          title,
          path: target,
          sessionIds: [],
          async attachSession(id) {
            if (behavior.attachError) throw new Error('test attach failure')
            this.sessionIds.push(id)
          },
        }
        workspaces.set(entry.id, entry)
        return entry
      },
    },
    credentials: {
      resolve: (ref) => secrets[ref] ? { value: secrets[ref] } : undefined,
      set: (ref, value) => { secrets[ref] = value },
      describe: (ref) => ({ configured: Boolean(secrets[ref]) }),
    },
    sessionController: {
      async list() {
        if (behavior.listError) throw new Error('temporary listing failure')
        return { items }
      },
      async create({ workspaceId }) {
        const id = 'new-' + (created.length + 1)
        items.push({ sessionId: id, blank: true, cwd: workspaces.get(workspaceId).path })
        created.push(id)
        return { sessionId: id }
      },
      async rename() {},
      async prompt() { assert.fail('a draft should not be sent') },
    },
  }
  host.apply({
    get: (name) => services[name],
    inject(_keys, effect) { effect(this) },
    effect: (effect) => effect(),
  })
  const request = (route, body = {}) => routes.get('/api/zentao/' + route)(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify(body),
  }))
  const call = async (route, body) => (await request(route, body)).json()
  const value = async (route, body) => {
    const result = await call(route, body)
    assert.equal(result.ok, true, result.error?.message)
    return result.value
  }
  return { behavior, created, request, call, value, routes }
}

test('the host registers its routes under /api/zentao and reports state', async () => {
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'pw' } })
  const paths = [...host.routes.keys()].sort()
  assert.deepEqual(paths, [
    '/api/zentao/asset',
    '/api/zentao/containers',
    '/api/zentao/counts',
    '/api/zentao/dispatch',
    '/api/zentao/settings',
    '/api/zentao/state',
    '/api/zentao/status',
    '/api/zentao/tasks',
    '/api/zentao/users',
    '/api/zentao/write',
  ])
  const state = await host.value('state')
  assert.equal(state.settings.zentao.transport, 'v1')
  assert.deepEqual(state.capabilities, {
    channel: 'v1',
    myWork: false,
    writeBack: false,
    assets: true,
    // Capabilities the panel can trust instead of guessing from a version.
    backfill: true,
    reassign: true,
  })
  assert.equal(state.credentials.zentao.password, true)
  assert.equal(state.credentialPresence.password, true)
  assert.equal(state.dataDir, store.DATA_DIR)
  assert.match(state.version, /^\d+\.\d+\.\d+$/)
})

test('settings refuse to keep a login for a different site, version or account', async () => {
  const calls = []
  test.mock.method(globalThis, 'fetch', (url) => {
    calls.push(new URL(url).hostname)
    if (String(url).endsWith('/tokens')) return Response.json({ token: 'tk' })
    return Response.json({ products: [], projects: [], executions: [] })
  })
  await store.saveSettings({ zentao: { baseUrl: 'https://zentao.example.test', transport: 'v1', account: 'account' } })
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'saved' } })
  await host.value('containers', { baseUrl: 'https://zentao.example.test/api.php/v1' })

  for (const change of [
    { baseUrl: 'https://different.example.test', account: 'account' },
    { baseUrl: 'https://zentao.example.test', transport: 'v2', account: 'account' },
    { baseUrl: 'https://zentao.example.test', account: 'someone-else' },
  ]) {
    assert.equal((await host.call('containers', change)).error.code, 'zentao/missing-credentials')
    assert.equal((await host.call('settings', { zentao: change })).error.code, 'zentao/missing-credentials')
  }
  assert.ok(calls.every((address) => address === 'zentao.example.test'))
  assert.equal((await store.loadSettings()).zentao.baseUrl, 'https://zentao.example.test')

  const saved = await host.value('settings', {
    zentao: { baseUrl: 'https://zentao.example.test', transport: 'v2', account: 'account' },
    zentaoPassword: 'new-password',
  })
  assert.equal(saved.settings.zentao.transport, 'v2')
})

test('tasks list what ZenTao assigned to me and merge the dispatch record', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  await store.saveState({ 'zentao:story-101': { sessionId: 'old-session', draft: { text: 'old draft' } } })
  await store.saveSettings({
    excludeCompleted: true,
    zentao: {
      baseUrl: 'https://zentao.example.test',
      transport: 'v1',
      account: 'account',
      scope: 'product',
      containerIds: ['7'],
      containerNames: { 7: '产品 A' },
    },
  })
  const host = setupHost({
    secrets: { ZENTAO_PASSWORD: 'pw' },
    items: [{ sessionId: 'old-session', blank: true }],
    workspace: { id: 'w1', sessionIds: ['old-session'] },
  })
  const tasks = await host.value('tasks')
  assert.equal(tasks.total, 1)
  assert.equal(tasks.scope, 'product')
  assert.equal(tasks.rawCount, 2)
  assert.equal(tasks.stories[0].uid, 'zentao:story-101')
  assert.equal(tasks.stories[0].vStatus, '进行中')
  assert.equal(tasks.stories[0].dispatch.sessionId, 'old-session')
  assert.equal(tasks.stories[0].dispatch.draftWaiting, true)

  const all = await host.value('tasks', { includeCompleted: true, includeStatusOptions: true })
  assert.deepEqual(all.stories.map((story) => story.completed), [false, true])
  for (const label of ['已计划', '研发中', '测试中', '已发布', '已关闭']) {
    assert.ok(all.statusOptions.includes(label), label)
  }
})

test('the bug scope goes through /products/{id}/bugs and keeps severity', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  await store.saveSettings({
    zentao: { baseUrl: 'https://zentao.example.test', transport: 'v1', account: 'account', scope: 'bug', containerIds: ['7'] },
  })
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'pw' } })
  const tasks = await host.value('tasks')
  assert.equal(tasks.scope, 'bug')
  assert.equal(tasks.stories[0].kind, 'bug')
  assert.equal(tasks.stories[0].severity, 'P1')
  assert.equal(tasks.stories[0].url, 'https://zentao.example.test/bug-view-9.html')
})

test('a missing password is reported as a setup error, not a crash', async () => {
  await store.saveSettings({
    zentao: { baseUrl: 'https://zentao.example.test', transport: 'v1', account: 'account', scope: 'product', containerIds: ['7'] },
  })
  const host = setupHost({})
  const result = await host.call('tasks')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'zentao/missing-credentials')
})

test('a cold start imports the task hub directory, ZenTao half only', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const coldHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-zentao-migrate-'))
  const hub = path.join(coldHome, '.dsh', 'task-hub')
  await mkdir(hub, { recursive: true })
  await writeFile(path.join(hub, 'settings.json'), JSON.stringify({
    provider: 'tapd',
    tapd: { projects: ['42'] },
    zentao: { baseUrl: 'https://legacy.example.test', account: 'account', containerIds: ['9'], containerNames: { 9: '旧产品' } },
    excludeCompleted: false,
  }))
  await writeFile(path.join(hub, 'state.json'), JSON.stringify({
    'tapd:9999': { sessionId: 'tapd-session' },
    'zentao:story-9': { sessionId: 'zentao-session', storyId: 'story-9' },
  }))
  const script = `
    const store = await import(${JSON.stringify(new URL('../lib/store.js', import.meta.url).href)})
    const settings = await store.loadSettings()
    const state = await store.loadState()
    const record = await store.findDispatch('story-9')
    console.log(JSON.stringify({ settings, state, record }))
  `
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HOME: coldHome },
  })
  const result = JSON.parse(stdout.trim().split('\n').at(-1))
  assert.equal(result.settings.zentao.baseUrl, 'https://legacy.example.test')
  assert.deepEqual(result.settings.zentao.containerIds, ['9'])
  assert.equal(result.settings.zentao.transport, 'v1')
  assert.equal(result.settings.excludeCompleted, false)
  assert.equal('tapd' in result.settings, false)
  assert.deepEqual(Object.keys(result.state), ['zentao:story-9'])
  assert.equal(result.record.sessionId, 'zentao-session')
  await rm(coldHome, { recursive: true, force: true })
})

test('session lookup errors stay distinct from archived sessions and blank drafts', async () => {
  await store.saveState({ 'zentao:story-101': { sessionId: 'old-session', storyId: STORY_ID, draft: { text: 'old draft' } } })
  const item = { sessionId: 'old-session', blank: true }
  const workspace = { id: 'workspace', sessionIds: ['old-session'] }
  const host = setupHost({ items: [item], workspace })
  host.behavior.listError = true
  const unavailable = (await host.value('status')).entries[0]
  assert.equal(unavailable.statusUnavailable, true)
  assert.equal(unavailable.sessionMissing, false)
  assert.equal((await host.value('dispatch', { storyId: STORY_ID })).sessionId, 'old-session')
  host.behavior.listError = false
  assert.equal((await host.value('status')).entries[0].draftWaiting, true)
  item.blank = false
  assert.equal((await host.value('status')).entries[0].draftWaiting, false)
  workspace.sessionIds.length = 0
  assert.equal((await host.value('status')).entries[0].sessionMissing, true)
})

test('continuation re-reads the task and keeps the old session, draft and assets', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  const original = { sessionId: 'original', branch: 'feature/original', workspaceId: 'w1', draft: { text: '旧草稿' } }
  await store.saveState({ 'zentao:story-101': original })
  await drafts.saveDraftAssets({ sessionId: original.sessionId, files: [{ name: 'original.txt', data: Buffer.from('old asset') }] })
  const host = setupHost({
    secrets: { ZENTAO_PASSWORD: 'pw' },
    items: [{ sessionId: 'original', blank: false }],
    workspace: { id: 'w1', sessionIds: ['original'] },
  })
  const result = await host.value('dispatch', {
    storyId: STORY_ID, story: STORY, conversation: 'existing', sessionId: 'original', extraInstructions: '继续测试',
  })
  assert.equal(result.sessionId, 'original')
  assert.equal(result.continuation, true)
  assert.match(result.draft.text, /最新需求正文[\s\S]*继续测试/)
  assert.match(result.draft.text, /^# 禅道研发需求 #101：禅道任务/)
  const bytes = await host.request('asset', { session: 'original', i: 0, draftId: result.draft.draftId })
  assert.equal(await bytes.text(), 'new attachment')
  assert.equal(await (await host.request('asset', { session: 'original', i: 0 })).text(), 'old asset')
  assert.deepEqual(await store.findDispatch(STORY_ID), original)
  assert.deepEqual(host.created, [])
})

test('new conversation reuses the original worktree, retries its draft, and keeps the original selectable', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  const repo = await tempRepo()
  const folder = await mkdtemp(path.join(os.tmpdir(), 'dsh-zentao-worktree-'))
  t.after(() => Promise.all([repo, folder].map((target) => rm(target, { force: true, recursive: true }))))
  const checkout = path.join(folder, 'checkout')
  await gitExec(repo, ['worktree', 'add', '-b', 'feature/original', checkout, 'main'])
  const original = {
    sessionId: 'original', branch: 'feature/original', workspaceId: 'w1',
    repoPath: repo, worktreePath: checkout, baseBranch: 'main', draft: { text: '旧草稿' },
  }
  await store.saveState({ 'zentao:story-101': original })
  const host = setupHost({
    secrets: { ZENTAO_PASSWORD: 'pw' },
    items: [{ sessionId: 'original', blank: false }],
    workspace: {
      id: 'w1',
      path: checkout,
      sessionIds: ['original'],
      async attachSession(id) {
        if (host.behavior.attachError) throw new Error('test attach failure')
        this.sessionIds.push(id)
      },
    },
  })
  const request = { storyId: STORY_ID, story: STORY, conversation: 'new', requestId: 'one-new-intent' }
  const before = await gitExec(repo, ['worktree', 'list', '--porcelain'])

  host.behavior.attachError = true
  assert.equal((await host.call('dispatch', request)).error.code, 'dispatch/draft-incomplete')
  assert.equal((await store.findDispatch(STORY_ID)).draftPending, true)
  host.behavior.attachError = false
  const result = await host.value('dispatch', request)
  assert.equal(result.sessionId, 'new-1')
  assert.equal(result.workspaceId, original.workspaceId)
  assert.equal(result.branch, original.branch)
  assert.equal(result.worktreePath, original.worktreePath)
  assert.match(result.draft.text, /feature\/original/)
  assert.equal(result.draftPending, false)
  assert.equal(result.previousSessions[0].sessionId, 'original')
  assert.equal((await host.value('dispatch', request)).sessionId, result.sessionId)
  assert.deepEqual(host.created, ['new-1'])
  assert.equal(await gitExec(repo, ['branch', '--show-current']), 'main\n')
  assert.equal(await gitExec(repo, ['worktree', 'list', '--porcelain']), before)
  const historical = await host.value('dispatch', { ...request, conversation: 'existing', sessionId: 'original' })
  assert.equal(historical.sessionId, 'original')
  assert.equal((await store.findDispatch(STORY_ID)).sessionId, 'new-1')
})

test('the task branch is prepared or reused when the original workspace moved on', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  for (const alreadyCheckedOut of [true, false]) {
    await t.test(alreadyCheckedOut ? 'reuse another worktree' : 'prepare a worktree on the existing branch', async (child) => {
      const repo = await tempRepo()
      const root = (await gitExec(repo, ['rev-parse', '--show-toplevel'])).trim()
      const branch = 'feature/zentao-101'
      const checkout = alreadyCheckedOut
        ? path.join(root, '..', path.basename(root) + '-other-worktree')
        : path.join(root, '..', '.dsh-worktrees', path.basename(root) + '-' + branch.replace(/\//g, '-'))
      child.after(() => Promise.all([repo, checkout].map((target) => rm(target, { force: true, recursive: true }))))
      const original = { sessionId: 'original', branch, workspaceId: 'w1', repoPath: root }
      await store.saveState({ 'zentao:story-101': original })
      const host = setupHost({
        secrets: { ZENTAO_PASSWORD: 'pw' },
        items: [{ sessionId: 'original', blank: false }],
        workspace: { id: 'w1', path: root, sessionIds: ['original'] },
      })
      const request = { storyId: STORY_ID, story: STORY, conversation: 'new', requestId: 'reuse-branch' }
      const missing = await host.call('dispatch', request)
      assert.equal(missing.error.code, 'dispatch/branch-not-found')
      assert.deepEqual(host.created, [])

      await gitExec(repo, ['branch', branch])
      if (alreadyCheckedOut) await gitExec(repo, ['worktree', 'add', checkout, branch])
      const list = await gitExec(repo, ['worktree', 'list', '--porcelain'])
      const refs = await gitExec(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'])
      await writeFile(path.join(repo, 'a.txt'), 'original worktree edit\n')

      const result = await host.value('dispatch', request)
      assert.equal(result.branch, branch)
      assert.equal(result.worktreePath, checkout)
      assert.notEqual(result.workspaceId, original.workspaceId)
      assert.equal(await gitExec(checkout, ['branch', '--show-current']), branch + '\n')
      assert.equal(await gitExec(repo, ['branch', '--show-current']), 'main\n')
      assert.equal(await readFile(path.join(repo, 'a.txt'), 'utf8'), 'original worktree edit\n')
      assert.equal(await gitExec(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']), refs)
      if (alreadyCheckedOut) assert.equal(await gitExec(repo, ['worktree', 'list', '--porcelain']), list)
      assert.equal(result.previousSessions[0].sessionId, original.sessionId)
    })
  }
})

test('the reassignment roster comes from ZenTao, not from a hard-coded list', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  await store.saveSettings({
    zentao: {
      baseUrl: 'https://zentao.example.test',
      transport: 'v2',
      account: 'account',
      scope: 'project',
    },
  })
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'pw' } })
  const value = await host.value('users')
  assert.deepEqual(value.users, [
    { account: 'account', name: '测试用户', role: 'dev', pinyin: '' },
    { account: 'anna', name: '安娜', role: 'qa', pinyin: '' },
  ])
  // A second call is served from the cache in lib/zentao.js.
  assert.deepEqual((await host.value('users')).users, value.users)
})

test('the container picker survives a gateway that needs Basic Auth', async (t) => {
  t.mock.method(globalThis, 'fetch', trackerFetch)
  await store.saveSettings({
    zentao: {
      baseUrl: 'https://zentao.example.test',
      transport: 'v1',
      account: 'account',
      basicAuth: true,
      basicAccount: 'gateway',
      containerIds: ['7'],
    },
  })
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'pw' } })
  // This used to throw `apiVersion is not defined` before any request was made.
  const value = await host.value('containers', {
    baseUrl: 'https://zentao.example.test',
    transport: 'v1',
    account: 'account',
    password: 'pw',
    basicAuth: true,
    basicAccount: 'gateway',
    basicPassword: 'gwpw',
  })
  assert.deepEqual(value.products.map((item) => item.id), ['7'])
})

test('draft attachments are private and old ones are pruned', async () => {
  const drafts = await import('../lib/drafts.js')
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-draft-mode-'))
  const items = await drafts.saveDraftAssets({
    sessionId: 'session-1',
    files: [{ name: 'notes.txt', data: Buffer.from('x') }],
    root,
  })
  const file = path.join(root, 'session-1', '0.bin')
  const manifest = path.join(root, 'session-1', 'manifest.json')
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(manifest)).mode & 0o777, 0o600)
  assert.equal(items.length, 1)
  // A folder older than the TTL goes away on the next write.
  const stale = path.join(root, 'stale-session')
  await mkdir(stale, { recursive: true })
  await utimes(stale, new Date('2020-01-01'), new Date('2020-01-01'))
  await drafts.saveDraftAssets({ sessionId: 'session-2', files: [], root })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await assert.rejects(() => stat(stale))
})

test('switching only the read scope saves without touching credentials', async () => {
  await store.saveSettings({
    zentao: {
      baseUrl: 'https://zentao.example.test',
      transport: 'v2',
      account: 'account',
      scope: 'product',
      // A gateway in front of ZenTao must not force its password again here.
      basicAuth: true,
      basicAccount: 'gateway',
    },
  })
  const host = setupHost({ secrets: { ZENTAO_PASSWORD: 'pw' } })
  const saved = await host.value('settings', { zentao: { scope: 'bug' } })
  assert.equal(saved.settings.zentao.scope, 'bug')
  assert.equal(saved.settings.zentao.basicAuth, true)
  assert.equal(saved.settings.zentao.basicAccount, 'gateway')
})
