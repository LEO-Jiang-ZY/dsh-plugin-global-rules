// HTTP surface tests: the editor page, the JSON API, and the trust checks.
// The routes are exercised through a fake web server that captures registrations,
// so no socket is opened.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { ROUTE_PREFIX, previewPayload, registerRoutes, statePayload } from '../lib/api.js'
import { resolveConfig } from '../lib/rules.js'
import { MANIFEST_NAME, listRulesets, readManifest, readRuleset, writeManifest, writeRuleset } from '../lib/store.js'

/** A config plus store in a fresh temp home. */
function fixture(rulesets = [{ id: 'global', title: '全局规则', content: 'GLOBAL-CONTENT' }]) {
  const home = mkdtempSync(join(tmpdir(), 'gr-api-'))
  const config = resolveConfig({ dshHome: home })
  rulesets.forEach(entry => writeRuleset(config, entry.id, entry.content))
  writeManifest(config, rulesets.map((entry, index) => ({
    id: entry.id,
    title: entry.title ?? entry.id,
    enabled: entry.enabled !== false,
    order: index,
  })))
  return { home, config, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

/** Capture the routes a plugin would register, without a real server. */
function fakeServer() {
  const routes = []
  const registered = []
  return {
    routes,
    registered,
    service: {
      register(route) {
        if (routes.some(existing => existing.kind === route.kind && existing.path === route.path)) {
          throw new Error(`duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index !== -1) routes.splice(index, 1)
        }
      },
    },
    find(path) {
      // Mirror the server's own matching: exact over the whole table first, then
      // the longest matching prefix.
      const exact = routes.find(route => route.kind === 'exact' && route.path === path)
      if (exact) return exact
      const prefixes = routes
        .filter(route => route.kind === 'prefix' && path.startsWith(route.path))
        .sort((a, b) => b.path.length - a.path.length)
      return prefixes[0]
    },
  }
}

/** A fake Cordis context exposing only what registerRoutes needs. */
function fakeCtx(server, { warn } = {}) {
  return {
    get: service => (service === 'webServer' ? server : undefined),
    effect(factory, label) {
      factory()
      return () => { void label }
    },
    ...(warn ? { warn } : {}),
  }
}

/** A request whose peer is loopback and whose shape is same-origin JSON. */
function makeRequest({ method = 'GET', url = '/', body, contentType = 'application/json', origin, remoteAddress = '127.0.0.1' } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const stream = Readable.from(payload.length > 0 ? [Buffer.from(payload, 'utf8')] : [])
  stream.method = method
  stream.url = url
  stream.headers = {
    ...(body === undefined ? {} : { 'content-type': contentType }),
    ...(origin === undefined ? {} : { origin }),
  }
  stream.socket = { remoteAddress }
  return stream
}

/** A response recorder with a promise that settles when the handler ends it. */
function makeResponse() {
  let resolve
  const done = new Promise(done_ => { resolve = done_ })
  const response = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      response.status = status
      response.headers = headers ?? {}
    },
    end(chunk) {
      response.body += chunk === undefined ? '' : String(chunk)
      resolve(response)
    },
  }
  response.done = done
  return response
}

/** Invoke one route and return `{ status, json }`. */
async function call(server, path, options) {
  const route = server.find(path)
  if (!route) throw new Error(`no route matches ${path}`)
  const response = makeResponse()
  await route.handler(makeRequest({ url: path, ...options }), response)
  const settled = await Promise.race([
    response.done,
    new Promise((_, reject) => setTimeout(() => reject(new Error('handler never ended the response')), 2000)),
  ])
  let json
  try {
    json = JSON.parse(settled.body)
  } catch {
    json = undefined
  }
  return { status: settled.status, json, text: settled.body, headers: settled.headers }
}

function setup(rulesets) {
  const data = rulesets === undefined ? fixture() : fixture(rulesets)
  let invalidated = 0
  const server = fakeServer()
  const ctx = fakeCtx(server.service)
  const routes = registerRoutes(ctx, {
    config: data.config,
    invalidate: () => { invalidated += 1 },
    snapshot: () => ({ bytes: 0, sources: [] }),
  })
  return { ...data, server, routes, invalidated: () => invalidated }
}

test('the editor registers its page, assets, and API routes', () => {
  const f = setup()
  try {
    assert.equal(f.routes, 10)
    const paths = f.server.routes.map(route => `${route.kind} ${route.path}`)
    assert.ok(paths.includes(`exact ${ROUTE_PREFIX}`), 'the editor page must be served')
    assert.ok(paths.includes(`exact ${ROUTE_PREFIX}/app.js`))
    assert.ok(paths.includes(`exact ${ROUTE_PREFIX}/app.css`))
    assert.ok(paths.includes(`prefix ${ROUTE_PREFIX}/api/state`))
    assert.ok(paths.includes(`prefix ${ROUTE_PREFIX}/api/scope`), 'the scope route is required for workspace rules')
  } finally {
    f.cleanup()
  }
})

test('no web server means no routes and no failure', () => {
  const data = fixture()
  try {
    const ctx = { get: () => undefined, effect: () => () => {} }
    assert.equal(registerRoutes(ctx, { config: data.config, invalidate: () => {} }), 0)
  } finally {
    data.cleanup()
  }
})

test('GET /rules serves the editor page', async () => {
  const f = setup()
  try {
    const result = await call(f.server, ROUTE_PREFIX)
    assert.equal(result.status, 200)
    assert.match(result.headers['content-type'], /text\/html/)
    assert.match(result.text, /全局规则/)
    assert.match(result.text, /\/rules\/app\.js/)
  } finally {
    f.cleanup()
  }
})

test('GET /rules/app.js and app.css serve the assets', async () => {
  const f = setup()
  try {
    const js = await call(f.server, `${ROUTE_PREFIX}/app.js`)
    assert.equal(js.status, 200)
    assert.match(js.headers['content-type'], /javascript/)
    assert.match(js.text, /dryRun|试运行/)
    const css = await call(f.server, `${ROUTE_PREFIX}/app.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers['content-type'], /text\/css/)
  } finally {
    f.cleanup()
  }
})

test('GET /rules/api/state reports the store', async () => {
  const f = setup()
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/state`)
    assert.equal(result.status, 200)
    assert.equal(result.json.storeDirectory, f.config.storeDirectory)
    assert.equal(result.json.rulesets.length, 1)
    assert.equal(result.json.rulesets[0].id, 'global')
    assert.equal(result.json.rulesets[0].content, 'GLOBAL-CONTENT')
    assert.equal(result.json.maxBytes, f.config.maxBytes)
    assert.deepEqual(result.json.global.rulesets.map(entry => entry.id), ['global'])
    assert.deepEqual(result.json.workspaces, [], 'no workspace stores exist yet')
    // The effective plan names the global set plus the session-level override file.
    assert.deepEqual(
      result.json.effective.filter(entry => entry.scope === 'global').map(entry => entry.id),
      ['global'],
    )
    assert.ok(result.json.effective.every(entry => typeof entry.path === 'string'))
  } finally {
    f.cleanup()
  }
})

test('PUT /rules/api/ruleset saves content and invalidates the cache', async () => {
  const f = setup()
  try {
    const id = encodeURIComponent('global')
    const result = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=${id}`, {
      method: 'PUT',
      body: { content: 'NEW-CONTENT', title: '新标题' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.json.saved, true)
    assert.equal(result.json.bytes, Buffer.byteLength('NEW-CONTENT'))
    assert.equal(readRuleset(f.config, 'global'), 'NEW-CONTENT')
    assert.equal(readManifest(f.config).rulesets[0].title, '新标题')
    assert.equal(f.invalidated(), 1, 'a save must invalidate the prompt cache')
  } finally {
    f.cleanup()
  }
})

test('PUT rejects an unknown id and a non-string body', async () => {
  const f = setup()
  try {
    const bad = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=${encodeURIComponent('../escape')}`, {
      method: 'PUT',
      body: { content: 'x' },
    })
    assert.equal(bad.status, 400)
    const wrongType = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, {
      method: 'PUT',
      body: { content: 42 },
    })
    assert.equal(wrongType.status, 400)
  } finally {
    f.cleanup()
  }
})

test('POST /rules/api/create adds a rule set and refuses a duplicate', async () => {
  const f = setup()
  try {
    const created = await call(f.server, `${ROUTE_PREFIX}/api/create`, {
      method: 'POST',
      body: { title: '代码风格' },
    })
    assert.equal(created.status, 201)
    // A title with no ASCII word characters slugifies to the fallback id.
    assert.equal(created.json.id, 'rules')
    assert.equal(readManifest(f.config).rulesets.find(entry => entry.id === 'rules').title, '代码风格')

    const named = await call(f.server, `${ROUTE_PREFIX}/api/create`, {
      method: 'POST',
      body: { title: 'Code Style' },
    })
    assert.equal(named.json.id, 'code-style')

    const ids = listRulesets(f.config).rulesets.map(entry => entry.id)
    assert.deepEqual(ids, ['global', 'rules', 'code-style'])

    const again = await call(f.server, `${ROUTE_PREFIX}/api/create`, {
      method: 'POST',
      body: { id: 'global', title: '重复' },
    })
    assert.equal(again.status, 409)
  } finally {
    f.cleanup()
  }
})

test('POST /rules/api/delete removes the file and the manifest row', async () => {
  const f = setup([
    { id: 'global', content: 'A' },
    { id: 'extra', content: 'B' },
  ])
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/delete`, { method: 'POST', body: { id: 'extra' } })
    assert.equal(result.status, 200)
    assert.equal(result.json.removed, true)
    assert.deepEqual(listRulesets(f.config).rulesets.map(entry => entry.id), ['global'])
    assert.deepEqual(readManifest(f.config).rulesets.map(entry => entry.id), ['global'])
  } finally {
    f.cleanup()
  }
})

test('PATCH /rules/api/manifest toggles and reorders', async () => {
  const f = setup([
    { id: 'one', content: 'ONE' },
    { id: 'two', content: 'TWO' },
    { id: 'three', content: 'THREE' },
  ])
  try {
    await call(f.server, `${ROUTE_PREFIX}/api/manifest`, { method: 'PATCH', body: { id: 'two', enabled: false } })
    assert.equal(readManifest(f.config).rulesets.find(entry => entry.id === 'two').enabled, false)

    await call(f.server, `${ROUTE_PREFIX}/api/manifest`, { method: 'PATCH', body: { id: 'three', move: 'top' } })
    assert.deepEqual(readManifest(f.config).rulesets.map(entry => entry.id), ['three', 'one', 'two'])

    await call(f.server, `${ROUTE_PREFIX}/api/manifest`, { method: 'PATCH', body: { id: 'three', move: 'down' } })
    assert.deepEqual(readManifest(f.config).rulesets.map(entry => entry.id), ['one', 'three', 'two'])
  } finally {
    f.cleanup()
  }
})

test('POST /rules/api/preview renders the draft without writing', async () => {
  const f = setup()
  try {
    const before = readRuleset(f.config, 'global')
    const result = await call(f.server, `${ROUTE_PREFIX}/api/preview`, {
      method: 'POST',
      body: {
        rulesets: [
          { id: 'global', title: '全局规则', enabled: true, content: 'DRAFT-CONTENT' },
          { id: 'off', title: '关闭的', enabled: false, content: 'HIDDEN' },
        ],
      },
    })
    assert.equal(result.status, 200)
    assert.match(result.json.text, /DRAFT-CONTENT/)
    assert.doesNotMatch(result.json.text, /HIDDEN/)
    assert.match(result.json.text, /Standing rules from the user/)
    assert.equal(result.json.bytes, Buffer.byteLength(result.json.text, 'utf8'))
    assert.equal(readRuleset(f.config, 'global'), before, 'a preview must not write anything')
  } finally {
    f.cleanup()
  }
})

test('previewPayload applies the byte budget and reports overflow', () => {
  const config = resolveConfig({ dshHome: '/h', maxBytes: 512 })
  const payload = previewPayload(config, {
    rulesets: [{ id: 'big', title: '很大', enabled: true, content: 'X'.repeat(20_000) }],
  })
  assert.ok(payload.bytes <= 512, `preview must respect the budget, got ${payload.bytes}`)
  assert.equal(payload.budgetBytes, 512)
  assert.match(payload.text, /Standing rules from the user/)
})

test('previewPayload of an all-disabled draft renders nothing', () => {
  const config = resolveConfig({ dshHome: '/h' })
  const payload = previewPayload(config, { rulesets: [{ id: 'a', enabled: false, content: 'X' }] })
  assert.equal(payload.text, '')
  assert.equal(payload.bytes, 0)
  assert.equal(payload.overBudget, false)
})

test('the API refuses a non-loopback peer', async () => {
  const f = setup()
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/state`, { remoteAddress: '10.0.0.7' })
    assert.equal(result.status, 403)
    assert.match(result.json.error, /loopback-only/)
  } finally {
    f.cleanup()
  }
})

test('the API refuses a cross-origin caller', async () => {
  const f = setup()
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/state`, { origin: 'https://evil.example' })
    assert.equal(result.status, 403)
    assert.match(result.json.error, /cross-origin/)
    const loopback = await call(f.server, `${ROUTE_PREFIX}/api/state`, { origin: 'http://127.0.0.1:19387' })
    assert.equal(loopback.status, 200)
    const electron = await call(f.server, `${ROUTE_PREFIX}/api/state`, { origin: 'null' })
    assert.equal(electron.status, 200, 'the Electron file:// origin arrives as "null"')
  } finally {
    f.cleanup()
  }
})

test('a mutating call must be JSON, and an unparsable body is rejected', async () => {
  const f = setup()
  try {
    const wrongType = await call(f.server, `${ROUTE_PREFIX}/api/create`, {
      method: 'POST',
      body: { title: 'x' },
      contentType: 'text/plain',
    })
    assert.equal(wrongType.status, 415)

    const noBody = await call(f.server, `${ROUTE_PREFIX}/api/create`, { method: 'POST' })
    assert.equal(noBody.status, 415, 'a POST without a JSON content type is refused')
  } finally {
    f.cleanup()
  }
})

test('an unparsable JSON body is a 400, not a crash', async () => {
  const f = setup()
  try {
    const route = f.server.find(`${ROUTE_PREFIX}/api/create`)
    const broken = Readable.from([Buffer.from('{ nope', 'utf8')])
    Object.assign(broken, {
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    })
    const response = makeResponse()
    await route.handler(broken, response)
    await response.done
    assert.equal(response.status, 400)
  } finally {
    f.cleanup()
  }
})

test('an unknown rule set id is a 404 on read', async () => {
  const f = setup()
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=missing`)
    assert.equal(result.status, 404)
  } finally {
    f.cleanup()
  }
})

test('statePayload reports a manifest override situation', () => {
  const data = fixture()
  try {
    // The fixture path has to be absolute on the platform running the test: on Linux
    // `C:/somewhere` is a relative path, so `path.isAbsolute` would refuse it and the
    // entry would be resolved against the store directory instead.
    const explicit = join(data.config.dshHome, 'explicit.md')
    const overridden = { ...data.config, rulesFiles: [explicit] }
    const payload = statePayload(overridden)
    assert.equal(payload.ignoredBecauseOverride, true)
    assert.deepEqual(payload.rulesFilesOverride, [explicit])
    // `rulesFiles` replaces the global store; the session file still follows it.
    assert.deepEqual(
      payload.effective.filter(entry => entry.scope === 'global').map(entry => entry.path),
      [explicit],
    )
    assert.ok(payload.effective.length >= 1)
  } finally {
    data.cleanup()
  }
})

test('the state revision changes when the store changes', async () => {
  const f = setup()
  try {
    const first = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    assert.equal(typeof first, 'string')
    assert.ok(first.length > 0)
    assert.equal((await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision, first, 'a no-op read is stable')

    await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, { method: 'PUT', body: { content: 'CHANGED' } })
    const second = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    assert.notEqual(second, first)

    await call(f.server, `${ROUTE_PREFIX}/api/manifest`, { method: 'PATCH', body: { id: 'global', enabled: false } })
    const third = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    assert.notEqual(third, second)

    await call(f.server, `${ROUTE_PREFIX}/api/create`, { method: 'POST', body: { title: 'Another' } })
    const fourth = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    assert.notEqual(fourth, third)
  } finally {
    f.cleanup()
  }
})

test('a save reports a conflict when another writer moved the store first', async () => {
  const f = setup()
  try {
    const base = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    // Somebody else writes, invalidating the revision this page holds.
    await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, { method: 'PUT', body: { content: 'OTHER-TAB' } })
    const stale = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, {
      method: 'PUT',
      body: { content: 'MINE', baseRevision: base },
    })
    assert.equal(stale.status, 200)
    assert.equal(stale.json.conflict, true, 'a stale base must be reported')
    assert.equal(readRuleset(f.config, 'global'), 'MINE', 'the explicit save still wins')
  } finally {
    f.cleanup()
  }
})

test('a save with a matching base reports no conflict', async () => {
  const f = setup()
  try {
    const base = (await call(f.server, `${ROUTE_PREFIX}/api/state`)).json.revision
    const result = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, {
      method: 'PUT',
      body: { content: 'FRESH', baseRevision: base },
    })
    assert.equal(result.json.conflict, false)
  } finally {
    f.cleanup()
  }
})

test('a save carries the title and enabled flag through to the manifest', async () => {
  const f = setup()
  try {
    const result = await call(f.server, `${ROUTE_PREFIX}/api/ruleset?id=global`, {
      method: 'PUT',
      body: { content: 'X', title: '改名了', enabled: false },
    })
    assert.equal(result.status, 200)
    const entry = readManifest(f.config).rulesets.find(item => item.id === 'global')
    assert.equal(entry.title, '改名了')
    assert.equal(entry.enabled, false)
    // The editor must never silently drop a rename or a toggle.
    assert.equal(result.json.state.rulesets.find(item => item.id === 'global').title, '改名了')
  } finally {
    f.cleanup()
  }
})

test('the manifest is written atomically and never leaves a temp file behind', async () => {
  const f = setup()
  try {
    await call(f.server, `${ROUTE_PREFIX}/api/manifest`, { method: 'PATCH', body: { id: 'global', enabled: true } })
    const { existsSync } = await import('node:fs')
    const { join: joinPath } = await import('node:path')
    assert.equal(existsSync(joinPath(f.config.storeDirectory, MANIFEST_NAME)), true)
    assert.equal(existsSync(joinPath(f.config.storeDirectory, `${MANIFEST_NAME}.tmp`)), false)
  } finally {
    f.cleanup()
  }
})
