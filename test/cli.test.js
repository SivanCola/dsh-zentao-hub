import assert from 'node:assert/strict'
import test from 'node:test'

import { CliError, mapCliError, myListArgs, runJson, stamp, writeArgs } from '../lib/cli.js'
import { executeWrite, planWrite } from '../lib/writeback.js'
import { channelCapabilities, listWork, resetCliCache, fetchWork } from '../lib/work.js'
import { resetZentaoTokens } from '../lib/zentao.js'

const BASE = 'https://z.example.com'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A fake `zentao` binary: a map of argv-joined -> JSON envelope. */
function fakeRunner(table) {
  const calls = []
  const runner = async (args) => {
    const key = args.join(' ')
    calls.push(args)
    const hit = Object.entries(table).find(([pattern]) => key.startsWith(pattern))
    if (!hit) throw new Error(`unexpected zentao ${key}`)
    const value = typeof hit[1] === 'function' ? hit[1](args) : hit[1]
    return { stdout: JSON.stringify(value), stderr: '' }
  }
  runner.calls = calls
  return runner
}

const AUTH = {
  'auth status': { ok: true, data: { server: BASE, account: 'spring', credentialType: 'token', verified: true }, meta: {} },
}

test('runJson unwraps the envelope and maps error codes', async () => {
  const ok = fakeRunner({ 'version': { ok: true, data: { cli: '0.4.4' }, meta: {} } })
  assert.deepEqual(await runJson(ok, ['version']), { data: { cli: '0.4.4' }, meta: {} })

  const expired = fakeRunner({ 'my tasks': { ok: false, error: { code: '1004', message: 'Token 已失效' } } })
  await assert.rejects(() => runJson(expired, ['my', 'tasks']), (error) => {
    assert.equal(error.code, 'zentao/auth-failed')
    assert.equal(error.details.cliCode, '1004')
    return true
  })

  assert.equal(mapCliError({ error: { code: '2010' } }).code, 'zentao/unsupported-version')
  assert.equal(mapCliError({ error: { code: '9999' } }).code, 'zentao/cli-error')

  // Old CLI builds parse flags differently: that must not look like our bug.
  const outdated = mapCliError({ error: { code: '2009', message: '选项 --no-input 的值无效，请使用 --字段名=值 传参' } })
  assert.equal(outdated.code, 'zentao/cli-outdated')
  assert.match(outdated.message, /npm i -g zentao-cli/)
})

test('runJson tolerates progress lines before the JSON envelope', async () => {
  const runner = async () => ({ stdout: '登录中...\n{"ok":true,"data":{"x":1},"meta":{}}', stderr: '' })
  assert.deepEqual((await runJson(runner, ['x'])).data, { x: 1 })
})

test('runJson reports a missing binary distinctly', async () => {
  const runner = async () => {
    throw new CliError('zentao/cli-missing', '找不到 zentao 命令')
  }
  await assert.rejects(() => runJson(runner, ['my', 'tasks']), (error) => {
    assert.equal(error.code, 'zentao/cli-missing')
    return true
  })
})

test('myListArgs picks the collection that matches the scope', () => {
  assert.deepEqual(myListArgs('project').args, ['my', 'tasks', '--all', '--max-items=500'])
  assert.deepEqual(myListArgs('bug').args, ['my', 'bugs', '--all', '--max-items=500'])
  assert.deepEqual(myListArgs('product').args, ['my', 'stories', '--all', '--max-items=500'])
})

test('writeArgs maps a start to the CLI flags it documents', () => {
  const { args, summary } = writeArgs({
    action: 'start',
    item: { id: 'task-31', kind: 'task' },
    input: { realStarted: '2026-11-17 10:00:00', comment: '已派发', consumed: 0 },
  })
  assert.deepEqual(args, ['task', 'start', '--task-id=31', '--real-started=2026-11-17 10:00:00', '--comment=已派发'])
  assert.match(summary, /#31/)

  const resolve = writeArgs({ action: 'resolve', item: { id: 'bug-9', kind: 'bug' }, input: { resolution: 'fixed' } })
  assert.deepEqual(resolve.args, ['bug', 'resolve', '--bug-id=9', '--resolution=fixed'])

  assert.throws(() => writeArgs({ action: 'start', item: { id: 'bug-9', kind: 'bug' }, input: {} }), /只有任务/)
  assert.throws(() => writeArgs({ action: 'resolve', item: { id: 'bug-9', kind: 'bug' }, input: {} }), /解决方案/)
  assert.throws(() => writeArgs({ action: 'nope', item: { id: 'task-1', kind: 'task' }, input: {} }), /不支持/)
})

test('stamp formats a local timestamp to the second', () => {
  assert.match(stamp(new Date(2026, 10, 17, 9, 5, 4)), /^2026-11-17 09:05:04$/)
})

test('channelCapabilities is the single source of truth for the UI', () => {
  assert.deepEqual(channelCapabilities({ transport: 'v1' }), { channel: 'v1', myWork: false, writeBack: false, assets: true })
  assert.deepEqual(channelCapabilities({ transport: 'v2' }), { channel: 'v2', myWork: true, writeBack: true, assets: true })
  assert.deepEqual(channelCapabilities({ transport: 'cli' }), { channel: 'cli', myWork: true, writeBack: true, assets: false })
  assert.equal(channelCapabilities({ transport: 'weird' }).channel, 'v1')
})

test('the CLI channel lists 地盘 work items and normalizes them', async () => {
  resetCliCache()
  const runner = fakeRunner({
    ...AUTH,
    'my tasks': {
      ok: true,
      data: {
        tasks: [
          { id: 31, name: '写接口', status: 'wait', assignedTo: 'spring', pri: 1, deadline: '2026-11-20', execution: { id: 11, name: '迭代 11' } },
          { id: 32, name: '别人的', status: 'doing', assignedTo: 'other' },
        ],
      },
      meta: { total: 2 },
    },
  })
  const result = await listWork({
    settings: { zentao: { baseUrl: '', transport: 'cli', scope: 'project', cliBin: 'zentao' } },
    credentials: {},
    runner,
  })
  assert.equal(result.channel, 'cli')
  assert.equal(result.serverFiltered, true)
  // The CLI is already server-filtered; the adapter keeps every row it returns.
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].uid, 'zentao:task-31')
  assert.equal(result.items[0].iterationName, '迭代 11')
  assert.equal(result.items[0].priorityLabel, 'P1')
  // No URL configured: the site comes from `auth status`, so links still work.
  assert.equal(result.items[0].url, `${BASE}/task-view-31.html`)
  assert.ok(
    runner.calls.some((call) => call[0] === 'auth' && call[1] === 'status'),
    'the site is resolved from auth status when no URL is configured',
  )
})

test('the CLI channel reads one item and keeps its HTML description', async () => {
  resetCliCache()
  const runner = fakeRunner({
    ...AUTH,
    'task get': { ok: true, data: { task: { id: 31, name: '写接口', desc: '<p>细节</p><img src="/file-read-7.png">', files: { 7: { id: 7, title: 'x.txt' } } } }, meta: {} },
  })
  const fresh = await fetchWork({
    settings: { zentao: { transport: 'cli', scope: 'project' } },
    credentials: {},
    story: { id: 'task-31', kind: 'task', remoteId: '31', name: '写接口' },
    runner,
  })
  assert.equal(fresh.channel, 'cli')
  assert.match(fresh.description, /<img/)
  assert.equal(fresh.sourceFiles.length, 1)
  assert.equal(fresh.uid, 'zentao:task-31')
})

test('a CLI below the minimum version surfaces as unsupported-version', async () => {
  resetCliCache()
  const runner = fakeRunner({
    ...AUTH,
    'my bugs': { ok: false, error: { code: '2010', message: '当前服务器版本不支持该动作' } },
  })
  await assert.rejects(
    () => listWork({ settings: { zentao: { transport: 'cli', scope: 'bug' } }, credentials: {}, runner }),
    (error) => error.code === 'zentao/unsupported-version' && error.name === 'SourceError',
  )
})

test('v2 reads /my/tasks instead of enumerating containers', async () => {
  resetZentaoTokens()
  const seen = []
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    seen.push(`${init?.method ?? 'GET'} ${parsed.pathname}`)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v2/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/my/tasks') {
      return json({ data: { tasks: [{ id: 31, name: '写接口', status: 'doing', assignedTo: 'spring' }] } })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await listWork({
    settings: { zentao: { baseUrl: BASE, transport: 'v2', scope: 'project', myWork: true } },
    credentials: { account: 'spring', password: 'pw' },
    fetchImpl,
  })
  assert.ok(seen.includes('GET /api.php/v2/my/tasks'), seen.join(', '))
  assert.equal(result.channel, 'v2')
  assert.equal(result.serverFiltered, true)
  assert.equal(result.items[0].uid, 'zentao:task-31')
})

test('v2 falls back to container enumeration when /my is too old', async () => {
  resetZentaoTokens()
  const seen = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    seen.push(parsed.pathname)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v2/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/my/stories') return json({ error: 'not found' }, 404)
    if (parsed.pathname === '/api.php/v2/products/9/stories') {
      return json({ data: [{ id: 1, title: '需求', assignedTo: 'spring', status: 'active', type: 'story' }] })
    }
    if (parsed.pathname === '/api.php/v2/products/9/requirements' || parsed.pathname === '/api.php/v2/products/9/epics') {
      return json({ data: [] })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await listWork({
    settings: { zentao: { baseUrl: BASE, transport: 'v2', scope: 'product', myWork: true, containerIds: ['9'] } },
    credentials: { account: 'spring', password: 'pw' },
    fetchImpl,
  })
  assert.ok(seen.includes('/api.php/v2/my/stories'))
  assert.ok(seen.includes('/api.php/v2/products/9/stories'))
  assert.equal(result.items.length, 1)
  assert.equal(result.serverFiltered, undefined)
})

test('planWrite refuses the read-only channel and explains why', () => {
  assert.throws(
    () => planWrite({ settings: { zentao: { transport: 'v1' } }, item: { id: 'task-1', kind: 'task' }, action: 'start' }),
    (error) => error.code === 'zentao/unsupported-version' && /v2/.test(error.message),
  )
})

test('planWrite builds a v2 request the operator can read', () => {
  const plan = planWrite({
    settings: { zentao: { transport: 'v2' } },
    item: { id: 'task-31', kind: 'task', name: '写接口' },
    action: 'start',
    input: { realStarted: '2026-11-17 10:00:00', comment: '已派发，分支 feature/x' },
  })
  assert.equal(plan.channel, 'v2')
  assert.equal(plan.request.method, 'PUT')
  assert.equal(plan.request.path, '/tasks/31/start')
  assert.deepEqual(plan.request.body, { realStarted: '2026-11-17 10:00:00', comment: '已派发，分支 feature/x' })
  assert.match(plan.summary, /#31/)

  const resolve = planWrite({
    settings: { zentao: { transport: 'v2' } },
    item: { id: 'bug-9', kind: 'bug' },
    action: 'resolve',
    input: { resolution: 'fixed' },
  })
  assert.equal(resolve.request.path, '/bugs/9/resolve')
  assert.deepEqual(resolve.request.body, { resolution: 'fixed' })

  assert.throws(
    () => planWrite({ settings: { zentao: { transport: 'v2' } }, item: { id: 'bug-9', kind: 'bug' }, action: 'resolve', input: { resolution: 'nope' } }),
    /有效的解决方案/,
  )
})

test('planWrite caps the note so a stray paste cannot bloat the request', () => {
  const plan = planWrite({
    settings: { zentao: { transport: 'v2' } },
    item: { id: 'task-1', kind: 'task' },
    action: 'start',
    input: { comment: 'x'.repeat(900) },
  })
  assert.equal(plan.request.body.comment.length, 500)
})

test('executeWrite PUTs the v2 transition and re-reads the item', async () => {
  resetZentaoTokens()
  const calls = []
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    calls.push({ method: init?.method ?? 'GET', path: parsed.pathname, body: init?.body ? JSON.parse(init.body) : null })
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v2/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/tasks/31/start') return json({ status: 'success' })
    if (parsed.pathname === '/api.php/v2/tasks/31') {
      return json({ task: { id: 31, name: '写接口', status: 'doing', assignedTo: 'spring' } })
    }
    throw new Error(`unexpected ${req(url)}`)
  }
  const result = await executeWrite({
    settings: { zentao: { baseUrl: BASE, transport: 'v2' } },
    credentials: { account: 'spring', password: 'pw' },
    item: { id: 'task-31', kind: 'task', remoteId: '31', name: '写接口' },
    action: 'start',
    input: { realStarted: '2026-11-17 10:00:00', comment: '已派发' },
    fetchImpl,
  })
  const put = calls.find((call) => call.path === '/api.php/v2/tasks/31/start')
  assert.equal(put.method, 'PUT')
  assert.deepEqual(put.body, { realStarted: '2026-11-17 10:00:00', comment: '已派发' })
  assert.equal(result.verification.status, 'doing')
  assert.equal(result.verification.statusLabel, '进行中')
})

function req(url) {
  return url
}

test('executeWrite runs the CLI command and verifies with a get', async () => {
  resetCliCache()
  const runner = fakeRunner({
    ...AUTH,
    'task start': { ok: true, data: {}, meta: {} },
    'task get': { ok: true, data: { task: { id: 31, name: '写接口', status: 'doing', assignedTo: 'spring' } }, meta: {} },
  })
  const result = await executeWrite({
    settings: { zentao: { transport: 'cli', scope: 'project' } },
    credentials: {},
    item: { id: 'task-31', kind: 'task', remoteId: '31', name: '写接口' },
    action: 'start',
    input: { comment: '已派发' },
    runner,
  })
  const startCall = runner.calls.find((call) => call[1] === 'start')
  assert.equal(startCall[0], 'task')
  assert.equal(startCall[2], '--task-id=31')
  assert.match(startCall[3], /^--real-started=\d{4}-\d{2}-\d{2} /)
  assert.equal(startCall[4], '--comment=已派发')
  assert.equal(result.verification.status, 'doing')
})

test('executeWrite reports a failed verification instead of claiming success', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v2/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/bugs/9/resolve' && init?.method === 'PUT') return json({ status: 'success' })
    return json({ error: 'boom' }, 500)
  }
  const result = await executeWrite({
    settings: { zentao: { baseUrl: BASE, transport: 'v2' } },
    credentials: { account: 'spring', password: 'pw' },
    item: { id: 'bug-9', kind: 'bug', remoteId: '9' },
    action: 'resolve',
    input: { resolution: 'fixed' },
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.verification, null)
  assert.match(result.verifyError, /500|boom/)
})
