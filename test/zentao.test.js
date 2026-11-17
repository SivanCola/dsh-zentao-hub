import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiRoot,
  fetchMe,
  fetchMyItems,
  fetchMyWork,
  fetchWorkAssets,
  fetchWorkDetails,
  listContainers,
  resetZentaoTokens,
  resolveVersion,
  webRoot,
} from '../lib/zentao.js'
import { fetchAssets, fetchWork, listWork, uidOf } from '../lib/work.js'

function json(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers })
}

const BASE = 'https://z.example.com'
const CREDS = { account: 'spring', password: 'pw' }

test('apiRoot and webRoot normalise both API generations', () => {
  assert.equal(apiRoot(BASE), 'https://z.example.com/api.php/v1')
  assert.equal(apiRoot(BASE, 'v2'), 'https://z.example.com/api.php/v2')
  assert.equal(apiRoot(`${BASE}/api.php`), 'https://z.example.com/api.php/v1')
  assert.equal(apiRoot(`${BASE}/api.php`, 'v2'), 'https://z.example.com/api.php/v2')
  assert.equal(apiRoot(`${BASE}/api.php/v1/`), 'https://z.example.com/api.php/v1')
  assert.equal(apiRoot(`${BASE}/api.php/v1`, 'v2'), 'https://z.example.com/api.php/v2')
  assert.equal(webRoot(`${BASE}/api.php/v2`), BASE)
  assert.equal(webRoot(`${BASE}/`), BASE)
})

test('uidOf keeps one stable dispatch key per item', () => {
  assert.equal(uidOf('task-3'), 'zentao:task-3')
  assert.equal(uidOf('bug-9'), 'zentao:bug-9')
})

test('v1 lists product stories and filters the assignee locally', async () => {
  resetZentaoTokens()
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers, body: init.body })
    if (url.endsWith('/api.php/v1/tokens')) return json({ token: 'tk' })
    if (url.endsWith('/api.php/v1/user')) return json({ profile: { account: 'spring', realname: '测试用户' } })
    if (url.includes('/products/9/stories')) {
      return json({
        total: 2,
        stories: [
          { id: 1, title: '支持导出', assignedTo: { account: 'spring' }, status: 'doing', pri: 2, spec: 'CSV' },
          { id: 2, title: '别人的', assignedTo: { account: 'other', realname: '测试用户' }, status: 'wait', pri: 3 },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await fetchMyWork({
    baseUrl: BASE,
    credentials: CREDS,
    scope: 'product',
    containerId: 9,
    containerName: '产品 A',
    fetchImpl,
  })
  assert.equal(seen[0].url, `${BASE}/api.php/v1/tokens`)
  assert.deepEqual(JSON.parse(seen[0].body), { account: 'spring', password: 'pw' })
  assert.ok(seen.every(({ headers }) => !headers.authorization))
  assert.equal(seen[1].headers.token, 'tk')
  assert.deepEqual(result.me, { account: 'spring', name: '测试用户' })
  assert.equal(result.rawCount, 2)
  assert.equal(result.items.length, 1)
  const story = result.items[0]
  assert.equal(story.id, 'story-1')
  assert.equal(story.shortId, '#1')
  assert.equal(story.vStatus, '进行中')
  assert.equal(story.completed, false)
  assert.equal(story.priorityLabel, 'P2')
  assert.equal(story.iterationName, '产品 A')
  assert.equal(story.url, `${BASE}/story-view-1.html`)
})

test('v1 reads project tasks through each execution', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    if (url.endsWith('/api.php/v1/tokens')) return json({ token: 'tk' })
    if (url.endsWith('/api.php/v1/user')) return json({ profile: { account: 'spring' } })
    if (url.includes('/projects/5/executions')) return json({ executions: [{ id: 11, name: '迭代 11' }] })
    if (url.includes('/executions/11/tasks')) {
      return json({
        tasks: [
          { id: 31, name: '写接口', assignedTo: 'spring', status: 'doing', deadline: '2026-11-20', pri: 1 },
          { id: 32, name: '别人的', assignedTo: 'other', status: 'wait' },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await fetchMyWork({ baseUrl: BASE, credentials: CREDS, scope: 'project', containerId: 5, fetchImpl })
  assert.equal(result.items.length, 1)
  const task = result.items[0]
  assert.equal(task.kind, 'task')
  assert.equal(task.id, 'task-31')
  assert.equal(task.iterationName, '迭代 11')
  assert.equal(task.url, `${BASE}/task-view-31.html`)
  assert.equal(task.due, '2026-11-20')
})

test('v2 signs in at /users/login and reads each requirement collection', async () => {
  resetZentaoTokens()
  const paths = []
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    paths.push(parsed.pathname + parsed.search)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ status: 'success', token: 'v2-token' })
    if (parsed.pathname === '/api.php/v2/users/me') return json({ user: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/products/9/stories') {
      return json({ data: [{ id: 1, title: '研发需求', type: 'story', assignedTo: 'spring', status: 'active' }] })
    }
    if (parsed.pathname === '/api.php/v2/products/9/requirements') {
      return json({ data: [{ id: 2, title: '用户需求', type: 'requirement', assignedTo: 'spring', status: 'active' }] })
    }
    if (parsed.pathname === '/api.php/v2/products/9/epics') {
      return json({ data: { epics: [{ id: 3, title: '业务需求', type: 'epic', assignedTo: 'spring', status: 'active' }] } })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await fetchMyWork({
    baseUrl: BASE,
    version: 'v2',
    credentials: CREDS,
    scope: 'product',
    containerId: 9,
    fetchImpl,
  })
  assert.equal(paths[0], '/api.php/v2/users/login')
  assert.ok(paths.some((path) => path.startsWith('/api.php/v2/products/9/stories')))
  assert.ok(paths.some((path) => path.startsWith('/api.php/v2/products/9/requirements')))
  assert.ok(paths.some((path) => path.startsWith('/api.php/v2/products/9/epics')))
  assert.ok(paths.every((path) => !path.startsWith('/api.php/v1')))
  assert.deepEqual(result.items.map((item) => item.id).sort(), ['story-1', 'story-2', 'story-3'])
  assert.equal(result.items.find((item) => item.id === 'story-3').requirementType, 'epic')
})

test('v2 reads project tasks with status=all so completed work is not lost', async () => {
  resetZentaoTokens()
  let taskQuery = ''
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'v2' })
    if (parsed.pathname === '/api.php/v2/users/me') return json({ user: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/projects/5/executions') return json({ data: [{ id: 11, name: '迭代 11' }] })
    if (parsed.pathname === '/api.php/v2/executions/11/tasks') {
      taskQuery = parsed.search
      return json({ data: [{ id: 31, name: '写接口', assignedTo: 'spring', status: 'done' }] })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await fetchMyWork({ baseUrl: BASE, version: 'v2', credentials: CREDS, scope: 'project', containerId: 5, fetchImpl })
  assert.match(taskQuery, /status=all/)
  assert.equal(result.items[0].completed, true)
})

test('bug scope lists product bugs with severity, resolution and a bug url', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api.php/v1/tokens') return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v1/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v1/products/9/bugs') {
      return json({
        bugs: [
          { id: 5, title: '页面报错', assignedTo: 'spring', status: 'resolved', severity: 1, resolution: 'fixed', pri: 1, steps: '<p>点一下</p>' },
          { id: 6, title: '别人的', assignedTo: 'other', status: 'active' },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const result = await fetchMyWork({ baseUrl: BASE, credentials: CREDS, scope: 'bug', containerId: 9, fetchImpl })
  assert.equal(result.items.length, 1)
  const bug = result.items[0]
  assert.equal(bug.kind, 'bug')
  assert.equal(bug.id, 'bug-5')
  assert.equal(bug.severity, 'P1')
  assert.equal(bug.resolution, 'fixed')
  assert.equal(bug.completed, false)
  assert.equal(bug.resolved, true)
  assert.equal(bug.vStatus, '已解决')
  assert.equal(bug.url, `${BASE}/bug-view-5.html`)
})

test('auto probes v2 once and remembers the answer per site', async () => {
  resetZentaoTokens()
  let logins = 0
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/users/login')) {
      logins += 1
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }
    if (parsed.pathname.endsWith('/tokens')) return json({ token: 'v1' })
    throw new Error(`unexpected ${url}`)
  }
  const first = await resolveVersion({ baseUrl: BASE, version: 'auto', credentials: CREDS, fetchImpl })
  const second = await resolveVersion({ baseUrl: BASE, version: 'auto', credentials: CREDS, fetchImpl })
  assert.equal(first, 'v1')
  assert.equal(second, 'v1')
  assert.equal(logins, 1)
})

test('auto keeps v2 when the site answers', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith('/users/login')) return json({ token: 'v2' })
    throw new Error(`unexpected ${url}`)
  }
  assert.equal(await resolveVersion({ baseUrl: 'https://modern.example.com', version: 'auto', credentials: CREDS, fetchImpl }), 'v2')
})

test('details are fetched from the collection that matches the item kind', async () => {
  resetZentaoTokens()
  const seen = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    seen.push(parsed.pathname)
    if (parsed.pathname.endsWith('/tokens') || parsed.pathname.endsWith('/users/login')) return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v1/tasks/31') return json({ task: { id: 31, name: '写接口', desc: '<p>细节</p>', files: { 7: { id: 7, title: 'x.txt' } } } })
    if (parsed.pathname === '/api.php/v2/bugs/9') return json({ bug: { id: 9, title: 'bug', steps: '<p>步骤</p>' } })
    if (parsed.pathname === '/api.php/v2/epics/3') return json({ epic: { id: 3, title: '业务需求', spec: '<p>正文</p>' } })
    throw new Error(`unexpected ${url}`)
  }
  const task = await fetchWorkDetails({ baseUrl: BASE, credentials: CREDS, story: { id: 'task-31', kind: 'task', remoteId: '31' }, fetchImpl })
  assert.match(task.description, /细节/)
  assert.equal(task.sourceFiles.length, 1)

  const bug = await fetchWorkDetails({
    baseUrl: BASE, version: 'v2', credentials: CREDS, story: { id: 'bug-9', kind: 'bug', remoteId: '9' }, fetchImpl,
  })
  assert.match(bug.description, /步骤/)

  const epic = await fetchWorkDetails({
    baseUrl: BASE, version: 'v2', credentials: CREDS, story: { id: 'story-3', kind: 'story', remoteId: '3', requirementType: 'epic' }, fetchImpl,
  })
  assert.match(epic.description, /正文/)
  assert.ok(seen.includes('/api.php/v2/epics/3'))
})

test('attachments always come from the v1 file endpoint, even on v2', async () => {
  resetZentaoTokens()
  const seen = []
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    seen.push(parsed.pathname)
    if (parsed.pathname.endsWith('/users/login') || parsed.pathname.endsWith('/tokens')) return json({ token: 'v2' })
    if (parsed.pathname === '/api.php/v1/files/7') {
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    throw new Error(`unexpected ${url}`)
  }
  const assets = await fetchWorkAssets({
    baseUrl: BASE,
    version: 'v2',
    credentials: CREDS,
    story: { description: `<p><img src="${BASE}/file-read-7.png" /></p>`, sourceFiles: [] },
    fetchImpl,
  })
  assert.ok(seen.includes('/api.php/v1/files/7'))
  assert.equal(assets.images.length, 1)
  assert.equal(assets.images[0].mediaType, 'image/png')
})

test('listContainers returns products, projects and executions', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/tokens')) return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v1/products') return json({ products: [{ id: 1, name: '产品 A' }] })
    if (parsed.pathname === '/api.php/v1/projects') return json({ projects: [{ id: 5, name: '项目 B' }] })
    if (parsed.pathname === '/api.php/v1/executions') return json({ executions: [{ id: 11, name: '迭代 11', project: 5 }] })
    throw new Error(`unexpected ${url}`)
  }
  const result = await listContainers({ baseUrl: BASE, credentials: CREDS, fetchImpl })
  assert.deepEqual(result.products, [{ id: '1', name: '产品 A', kind: 'product', parent: '' }])
  assert.deepEqual(result.projects, [{ id: '5', name: '项目 B', kind: 'project', parent: '' }])
  assert.deepEqual(result.executions, [{ id: '11', name: '迭代 11', kind: 'execution', parent: '5' }])
})

test('listWork translates client errors and hides completed items by default', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/tokens')) return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v1/user') return json({ profile: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v1/products/9/stories') {
      return json({
        stories: [
          { id: 1, title: '在做', assignedTo: 'spring', status: 'active' },
          { id: 2, title: '完了', assignedTo: 'spring', status: 'closed' },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const settings = {
    zentao: { baseUrl: BASE, transport: 'v1', scope: 'product', containerIds: ['9'], containerNames: { 9: '产品 A' } },
  }
  const result = await listWork({ settings, credentials: CREDS, fetchImpl })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].uid, 'zentao:story-1')
  assert.equal(result.items[0].iterationName, '产品 A')
  assert.equal(result.rawCount, 2)

  const all = await listWork({ settings, credentials: CREDS, excludeCompleted: false, fetchImpl })
  assert.equal(all.items.length, 2)

  await assert.rejects(
    () => listWork({ settings: { zentao: { ...settings.zentao, containerIds: [] } }, credentials: CREDS, fetchImpl }),
    (error) => error.code === 'zentao/missing-container' && error.name === 'SourceError',
  )
})

test('fetchWork and fetchAssets go through the adapter with the saved settings', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/tokens')) return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v1/tasks/31') return json({ task: { id: 31, name: '写接口', desc: '细节' } })
    throw new Error(`unexpected ${url}`)
  }
  const settings = { zentao: { baseUrl: BASE, transport: 'v1' } }
  const fresh = await fetchWork({
    settings,
    credentials: CREDS,
    story: { id: 'task-31', kind: 'task', remoteId: '31', name: '写接口' },
    fetchImpl,
  })
  assert.equal(fresh.uid, 'zentao:task-31')
  assert.equal(fresh.description, '细节')
  const assets = await fetchAssets({ settings, credentials: CREDS, story: { description: '', sourceFiles: [] }, fetchImpl })
  assert.deepEqual(assets, { files: [], images: [] })
  await assert.rejects(() => fetchWork({ settings, credentials: CREDS, story: null, fetchImpl }), /缺少任务信息/)
})

test('fetchMe asks the route each API generation mounts', async () => {
  resetZentaoTokens()
  const seen = []
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    seen.push(parsed.pathname)
    if (parsed.pathname.endsWith('/tokens') || parsed.pathname.endsWith('/users/login')) return json({ token: 'tk' })
    if (parsed.pathname === '/api.php/v2/users/me') return json({ status: 'success', user: { account: 'spring', realname: '测试用户' } })
    if (parsed.pathname === '/api.php/v1/user') return json({ profile: { account: 'spring', realname: '测试用户' } })
    // ZenTao answers 401 for a route the generation does not mount.
    return new Response('{"error":"Unauthorized"}', { status: 401 })
  }
  const v2 = await fetchMe({ baseUrl: BASE, version: 'v2', credentials: CREDS, fetchImpl })
  assert.deepEqual(v2, { account: 'spring', name: '测试用户' })
  assert.ok(seen.includes('/api.php/v2/users/me'))
  assert.ok(!seen.includes('/api.php/v2/user'))

  seen.length = 0
  const v1 = await fetchMe({ baseUrl: BASE, version: 'v1', credentials: CREDS, fetchImpl })
  assert.deepEqual(v1, { account: 'spring', name: '测试用户' })
  assert.ok(seen.includes('/api.php/v1/user'))
  assert.ok(!seen.includes('/api.php/v1/users/me'))
})

test('a build without either me-route still lists my work', async () => {
  resetZentaoTokens()
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'v2' })
    if (parsed.pathname === '/api.php/v2/users/me' || parsed.pathname === '/api.php/v2/user') {
      return new Response('{"error":"Unauthorized"}', { status: 401 })
    }
    if (parsed.pathname === '/api.php/v2/my/tasks') {
      return json({
        status: 'success',
        pager: { recTotal: 2, recPerPage: 200, pageID: 1 },
        tasks: [
          { id: 2260, name: '调研-backend', assignedTo: 'spring', status: 'wait' },
          { id: 2255, name: 'banner-backend', assignedTo: 'spring', status: 'done' },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const mine = await fetchMyItems({ baseUrl: BASE, version: 'v2', credentials: CREDS, scope: 'project', fetchImpl })
  assert.deepEqual(mine.me, { account: 'spring', name: '' })
  assert.equal(mine.items.length, 2)
  assert.equal(mine.items.filter((item) => item.completed).length, 1)
})

test('v2 pagers use recTotal, so the second page is still fetched', async () => {
  resetZentaoTokens()
  const pages = []
  const row = (id) => ({ id, name: `任务 ${id}`, assignedTo: 'spring', status: 'wait' })
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname === '/api.php/v2/users/login') return json({ token: 'v2' })
    if (parsed.pathname === '/api.php/v2/users/me') return json({ user: { account: 'spring' } })
    if (parsed.pathname === '/api.php/v2/my/tasks') {
      const page = Number(parsed.searchParams.get('pageID'))
      pages.push(page)
      return json({
        pager: { recTotal: 201, recPerPage: 200, pageID: page },
        tasks: page === 1 ? Array.from({ length: 200 }, (_, i) => row(i + 1)) : [row(201)],
      })
    }
    throw new Error(`unexpected ${url}`)
  }
  const mine = await fetchMyItems({ baseUrl: BASE, version: 'v2', credentials: CREDS, scope: 'project', fetchImpl })
  assert.deepEqual(pages, [1, 2])
  assert.equal(mine.items.length, 201)
})

test('a network failure does not pin the auto channel to v1', async () => {
  resetZentaoTokens()
  const down = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(
    () => resolveVersion({ baseUrl: BASE, version: 'auto', credentials: CREDS, fetchImpl: down }),
    /无法连接/,
  )
  // The next call probes again and takes the real answer instead of the cached
  // v1 that a single blip used to leave behind.
  const healthy = async (url) => (String(url).endsWith('/users/login') ? json({ token: 'v2' }) : json({}))
  assert.equal(await resolveVersion({ baseUrl: BASE, version: 'auto', credentials: CREDS, fetchImpl: healthy }), 'v2')
})
