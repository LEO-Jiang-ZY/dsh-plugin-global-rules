/**
 * HTTP surface of the rule manager.
 *
 * The Web GUI runs on the same loopback server this plugin is mounted in, so the
 * editor is served as ordinary HTTP instead of a client bundle: a page at
 * `/rules` and a small JSON API beside it. That keeps the UI independent of the
 * client build pipeline and makes it reachable from any browser on the machine.
 *
 * Every operation names a **scope**: `global`, or a workspace path. A workspace
 * scope resolves to that workspace's own store; the global scope resolves to the
 * store root. Nothing else in the API knows the difference.
 *
 * Security posture — the server is loopback-only, and the page can rewrite the
 * prompt every session sees:
 * - Only `127.0.0.1` / `::1` / `localhost` peers may call the API.
 * - Mutating calls must be same-origin, JSON, and carry no `Origin` from another
 *   host, so a page the user visits elsewhere cannot drive the endpoint.
 * - A workspace scope must name an absolute path, and every file path is derived
 *   from it on the server, never taken from the request.
 *
 * @module dsh-plugin-global-rules/api
 */

import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SECTION_NAME,
  budgetedSection,
  escapeFraming,
  isEnglish,
  ruleFilePlan,
  toPathList,
} from './rules.js'
import {
  MANIFEST_NAME,
  deleteWorkspaceStore,
  ensureStore,
  ensureWorkspaceStore,
  getStore,
  isValidId,
  listWorkspaceStores,
  readManifestIn,
  resolveWorkspaceStore,
  slugify,
  storeDirectory,
} from './store.js'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const WEB_DIR = join(here, 'web')

/** Largest JSON request body accepted, in bytes. */
const MAX_BODY_BYTES = 512 * 1024

/** Prefix every route shares. */
export const ROUTE_PREFIX = '/rules'

/** Loopback peer addresses the API accepts. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

/** Report whether a request peer is loopback. */
function isLoopback(req) {
  const address = req?.socket?.remoteAddress
  if (typeof address !== 'string') return false
  return LOOPBACK.has(address) || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/**
 * Report whether a request looks same-origin.
 *
 * The GUI may be loaded over the loopback server or from `file://` in Electron,
 * so a missing `Origin` is accepted while any `Origin` naming a different host is
 * refused. Together with the required JSON content type this blocks the
 * cross-site request shapes a browser can produce without a preflight.
 */
function isSameOrigin(req) {
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') return true
  try {
    const { hostname } = new URL(origin)
    return LOOPBACK.has(hostname) || hostname.startsWith('127.')
  } catch {
    return false
  }
}

/** Send a JSON response. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Send a static asset with a safe content type and no caching. */
function sendAsset(res, name, type) {
  try {
    const body = readFileSync(join(WEB_DIR, name))
    res.writeHead(200, {
      'content-type': `${type}; charset=utf-8`,
      'cache-control': 'no-store',
      'content-length': body.length,
      // The editor is embedded in an iframe by the in-app overlay, so framing it
      // from this same origin is intended and must not be blocked by a default.
      'x-frame-options': 'SAMEORIGIN',
    })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`asset "${name}" is missing from the plugin: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Read and parse a bounded JSON request body. */
async function readJsonBody(req) {
  const type = String(req.headers?.['content-type'] ?? '')
  if (!type.toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('content-type must be application/json'), { status: 415 })
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      throw Object.assign(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`), { status: 413 })
    }
    chunks.push(chunk)
  }
  if (total === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object')
    }
    return parsed
  } catch (error) {
    throw Object.assign(new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`), { status: 400 })
  }
}

/** Reject a request that may not mutate state. */
function requireTrusted(req) {
  if (!isLoopback(req)) {
    throw Object.assign(new Error('this endpoint is loopback-only'), { status: 403 })
  }
  if (!isSameOrigin(req)) {
    throw Object.assign(new Error('cross-origin request refused'), { status: 403 })
  }
}

/** Read a query parameter from a request URL. */
function query(req, name) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(name) ?? ''
  } catch {
    return ''
  }
}

/** The language a request asked for; anything but English falls back to Chinese. */
const langOf = req => (isEnglish(query(req, 'lang')) ? 'en' : 'zh')

/* ── scopes ──────────────────────────────────────────────────────────────── */

/**
 * Resolve a request's scope into a store.
 *
 * `scope=global` (or absent) is the store root. `scope=workspace&path=<abs>` is
 * that workspace's own store, created on demand by the mutating handlers. A
 * relative path is refused: the server, not the caller, decides where files live.
 *
 * @param config - resolved plugin configuration.
 * @param req - the request carrying the query.
 * @param options - `{ create: true }` creates the workspace store when missing.
 * @returns the store operations plus `{ scope, workspacePath }`.
 */
function resolveScope(config, req, options = {}) {
  const scope = query(req, 'scope') || 'global'
  if (scope === 'global') {
    return { scope: 'global', workspacePath: undefined, store: getStore(config) }
  }
  if (scope !== 'workspace') {
    throw Object.assign(new Error(`unknown scope "${scope}"`), { status: 400 })
  }
  const path = query(req, 'path')
  if (path.length === 0) {
    throw Object.assign(new Error('a workspace scope needs ?path=<absolute directory>'), { status: 400 })
  }
  if (!isAbsolute(path)) {
    throw Object.assign(new Error('the workspace path must be absolute'), { status: 400 })
  }
  if (options.create === true) {
    const created = ensureWorkspaceStore(config, path)
    return {
      scope: 'workspace',
      workspacePath: path,
      store: getStore({ ...config, storeDirectory: created.directory }),
      title: created.title,
    }
  }
  const existing = resolveWorkspaceStore(config, path)
  if (existing === undefined) {
    throw Object.assign(new Error(`no rule set store for workspace ${path}`), { status: 404 })
  }
  return {
    scope: 'workspace',
    workspacePath: existing.path,
    store: getStore({ ...config, storeDirectory: existing.directory }),
    matchedFrom: existing.matchedFrom,
  }
}

/**
 * Describe one store the way the editor needs it.
 * @param config - resolved plugin configuration.
 * @param scope - `{ scope, workspacePath, store }`.
 * @param lang - the language for default titles.
 * @returns the scope payload.
 */
function scopePayload(config, scope, lang) {
  const listed = scope.store.listRulesets()
  return {
    scope: scope.scope,
    workspacePath: scope.workspacePath ?? null,
    title: scope.workspacePath ? (readManifestIn(scope.store.directory).title ?? scope.workspacePath) : null,
    storeDirectory: scope.store.directory,
    manifestPath: join(scope.store.directory, MANIFEST_NAME),
    manifestError: listed.manifest.error ?? null,
    rulesets: listed.rulesets.map(entry => ({
      id: entry.id,
      title: entry.title,
      enabled: entry.enabled,
      order: entry.order,
      path: entry.path,
      bytes: entry.bytes,
      untracked: entry.untracked === true,
      legacy: entry.legacy === true,
      content: scope.store.readRuleset(entry.id) ?? (entry.legacy ? safeRead(entry.path) : ''),
    })),
    defaultTitle: lang === 'en' ? 'Untitled rule set' : '未命名规则集',
    revision: revisionOf(scope.store),
  }
}

/** A cheap identity for a store's contents, so two writers can detect each other. */
function revisionOf(store) {
  const listed = store.listRulesets()
  const parts = listed.rulesets.map(entry => `${entry.id}:${entry.bytes}:${entry.enabled ? 1 : 0}`)
  parts.push(`m:${listed.manifest.rulesets.map(entry => `${entry.id}:${entry.enabled ? 1 : 0}`).join(',')}`)
  let hash = 2166136261
  for (const character of parts.join('|')) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Read a file, or `''` when it cannot be read. */
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Describe the whole rule manager: global store, every workspace store, and what
 * this session actually injects.
 *
 * @param config - resolved plugin configuration.
 * @param options - `{ cwd, lang }` for the session in view.
 * @returns the state payload.
 */
export function statePayload(config, options = {}) {
  const lang = options.lang === 'en' ? 'en' : 'zh'
  const globalScope = { scope: 'global', workspacePath: undefined, store: getStore(config) }
  const workspaces = listWorkspaceStores(config).map(entry => ({
    slug: entry.slug,
    path: entry.path,
    title: entry.title,
    directory: entry.directory,
    ruleCount: entry.rulesets.length,
    enabledCount: entry.rulesets.filter(ruleset => ruleset.enabled).length,
    bytes: entry.rulesets.filter(ruleset => ruleset.enabled).reduce((sum, ruleset) => sum + ruleset.bytes, 0),
  }))

  const cwd = typeof options.cwd === 'string' && options.cwd.length > 0 ? options.cwd : undefined
  const plan = ruleFilePlan(config, cwd)
  const active = resolveWorkspaceStore(config, cwd)
  const global = scopePayload(config, globalScope, lang)

  return {
    lang,
    editorUrl: ROUTE_PREFIX,
    storeRoot: storeDirectory(config),
    workspacesRoot: join(storeDirectory(config), 'workspaces'),
    enabled: config.enabled,
    maxBytes: config.maxBytes,
    order: config.order,
    workspaceFiles: toPathList(config.workspaceFiles),
    rulesFilesOverride: toPathList(config.rulesFiles),
    ignoredBecauseOverride: config.rulesFiles.length > 0,
    /** The global store: the scope the editor opens on by default. */
    global,
    /** Aliases, so a caller that only cares about the global scope need not nest. */
    rulesets: global.rulesets,
    revision: global.revision,
    storeDirectory: global.storeDirectory,
    workspaces,
    cwd: cwd ?? null,
    activeWorkspacePath: active?.path ?? null,
    activeWorkspaceMatchedFrom: active?.matchedFrom ?? null,
    /**
     * The files this session actually reads, in order. The editor shows this so
     * "what is injected" is never a guess.
     */
    effective: plan.map(entry => ({
      source: entry.source,
      scope: entry.scope ?? entry.source,
      path: entry.path,
      id: entry.id ?? null,
      title: entry.title ?? null,
    })),
  }
}

/**
 * Render what the model would see for a proposed store state, without writing.
 *
 * The draft is rendered through the live path itself, so the preview cannot drift from
 * what the model actually receives — including the shedding order under budget
 * pressure. Pass `cwd` to include the workspace sets that would apply to a session in
 * that directory.
 *
 * @param config - resolved plugin configuration.
 * @param body - the draft from the UI.
 * @returns the preview payload.
 */
export function previewPayload(config, body) {
  const draft = Array.isArray(body?.rulesets) ? body.rulesets : []
  // Notices reach the user, so they follow the configured language rather than the
  // maintainer's.
  const english = isEnglish(config.lang)
  const notices = []
  const sources = []
  for (const entry of draft) {
    if (!entry || entry.enabled === false) continue
    const title = typeof entry.title === 'string' && entry.title.trim().length > 0 ? entry.title.trim() : (entry.id ?? 'untitled')
    const content = typeof entry.content === 'string' ? entry.content.replace(/^\uFEFF/, '').trim() : ''
    if (content.length === 0) continue
    const scope = entry.scope === 'workspace' ? 'workspace' : 'global'
    // The path is display-only here; the section itself renders a bare scope tag.
    sources.push({ source: scope, path: `${english ? 'rule set' : '规则集'}: ${title}`, title, content })
  }
  const budget = Number.isFinite(config.maxBytes) ? config.maxBytes : 0
  const { text, bytes } = budgetedSection({
    config: { ...config, maxBytes: budget },
    workspacePath: body?.cwd,
    isSubagent: false,
    readText: () => undefined,
    sources,
    notices: [],
  })
  if (budget <= 0 && sources.length > 0) {
    notices.push(english
      ? 'maxBytes is 0, so nothing is injected.'
      : 'maxBytes 为 0，因此不会注入任何规则。')
  }
  if (budget > 0 && bytes >= budget && sources.length > 0) {
    notices.push(english
      ? `The rendered section reaches the ${budget}-byte budget.`
      : `渲染结果达到或超过 ${budget} 字节的预算上限。`)
  }
  return {
    bytes,
    budgetBytes: budget,
    overBudget: budget > 0 && bytes > budget,
    omitted: notices,
    sectionName: SECTION_NAME,
    text: escapeFraming(text),
    drafts: sources.map(source => ({ title: source.title, bytes: Buffer.byteLength(source.content, 'utf8') })),
  }
}

/** Read the manifest, mutation-safe, preserving a workspace store's identity. */
function touchManifest(store, mutate, scope) {
  const manifest = store.readManifest()
  const next = mutate(manifest.rulesets)
  // A workspace store must keep naming the workspace it belongs to; the display
  // title is preserved from the manifest it already has.
  const extra = scope.scope === 'workspace'
    ? { path: scope.workspacePath, title: manifest.title ?? basename(scope.workspacePath ?? '') }
    : {}
  store.writeManifest(next, extra)
  return next
}

/** Insert or update one manifest entry, keeping order stable. */
function upsert(manifest, patch) {
  if (!isValidId(patch.id)) return manifest
  const index = manifest.findIndex(entry => entry.id === patch.id)
  if (index === -1) {
    return [...manifest, {
      id: patch.id,
      title: typeof patch.title === 'string' && patch.title.trim().length > 0 ? patch.title.trim() : patch.id,
      enabled: patch.enabled !== false,
      order: manifest.length,
    }]
  }
  const next = manifest.slice()
  next[index] = {
    ...next[index],
    ...(typeof patch.title === 'string' && patch.title.trim().length > 0 ? { title: patch.title.trim() } : {}),
    ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
  }
  return next
}

/**
 * Register the editor's routes.
 *
 * @param ctx - the owning Cordis context (for `ctx.effect`).
 * @param options - the plugin's config, the cache invalidator, a snapshot reader, and loggers.
 * @returns the number of routes registered.
 */
export function registerRoutes(ctx, options) {
  const { config, invalidate, snapshot } = options
  const webServer = ctx.get('webServer')
  if (!webServer?.register) return 0

  const guard = handler => async (req, res) => {
    try {
      requireTrusted(req)
      await handler(req, res)
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const state = (req, extra = {}) => statePayload(config, { lang: langOf(req), cwd: query(req, 'cwd'), ...extra })

  const routes = [
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/state`,
      handler: guard(async (req, res) => {
        // Ensure the global store exists so the editor always opens onto something.
        try { ensureStore(config) } catch { /* reported through the payload below */ }
        sendJson(res, 200, state(req))
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/scope`,
      handler: guard(async (req, res) => {
        if (req.method === 'GET') {
          const scope = resolveScope(config, req)
          return sendJson(res, 200, scopePayload(config, scope, langOf(req)))
        }
        if (req.method === 'POST') {
          // Create (or adopt) the workspace store for an absolute path.
          const scope = resolveScope(config, req, { create: true })
          invalidate()
          const payload = scopePayload(config, scope, langOf(req))
          return sendJson(res, 201, { ...payload, created: true })
        }
        if (req.method === 'DELETE') {
          const path = query(req, 'path')
          if (!isAbsolute(path)) return sendJson(res, 400, { error: 'the workspace path must be absolute' })
          const removed = deleteWorkspaceStore(config, path)
          invalidate()
          return sendJson(res, 200, { removed, path, state: state(req) })
        }
        return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/ruleset`,
      handler: guard(async (req, res) => {
        const id = query(req, 'id')
        if (!isValidId(id)) return sendJson(res, 400, { error: 'invalid rule set id' })
        // Only a write may create the scoped store; a read of a missing scope is a 404.
        const scope = resolveScope(config, req, { create: req.method === 'PUT' })
        const store = scope.store

        if (req.method === 'GET') {
          const content = store.readRuleset(id)
          if (content === undefined) return sendJson(res, 404, { error: `no such rule set: ${id}` })
          return sendJson(res, 200, { id, content })
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req)
          if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content must be a string' })
          // Detect a concurrent write. The save still wins — the user pressed the
          // button — but the overwrite is reported instead of silent.
          const before = scopePayload(config, scope, langOf(req))
          const conflict = typeof body.baseRevision === 'string'
            && body.baseRevision.length > 0
            && body.baseRevision !== before.revision
          store.writeRuleset(id, body.content)
          touchManifest(store, manifest => upsert(manifest, { id, title: body.title, enabled: body.enabled }), scope)
          invalidate()
          const after = scopePayload(config, scope, langOf(req))
          return sendJson(res, 200, {
            saved: true,
            id,
            scope: scope.scope,
            workspacePath: scope.workspacePath ?? null,
            bytes: Buffer.byteLength(body.content, 'utf8'),
            conflict,
            scopeState: after,
            state: state(req),
          })
        }
        return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/create`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
        const body = await readJsonBody(req)
        const scope = resolveScope(config, req, { create: true })
        const store = scope.store
        const taken = new Set(store.listRulesets().rulesets.map(entry => entry.id))
        const wanted = typeof body.id === 'string' && body.id.length > 0 ? body.id : slugify(body.title ?? 'rules', taken)
        if (!isValidId(wanted)) return sendJson(res, 400, { error: 'id must match [a-z0-9][a-z0-9_-]*' })
        if (taken.has(wanted)) return sendJson(res, 409, { error: `rule set "${wanted}" already exists` })
        const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : wanted
        store.writeRuleset(wanted, typeof body.content === 'string' ? body.content : `# ${title}\n\n`)
        touchManifest(store, manifest => upsert(manifest, { id: wanted, title, enabled: true }), scope)
        invalidate()
        return sendJson(res, 201, { created: true, id: wanted, scope: scope.scope, state: state(req) })
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/delete`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
        const body = await readJsonBody(req)
        const id = String(body.id ?? '')
        if (!isValidId(id)) return sendJson(res, 400, { error: 'invalid rule set id' })
        const scope = resolveScope(config, req, { create: true })
        const removed = scope.store.deleteRuleset(id)
        touchManifest(scope.store, manifest => manifest.filter(entry => entry.id !== id), scope)
        invalidate()
        return sendJson(res, 200, { removed, id, scope: scope.scope, state: state(req) })
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/manifest`,
      handler: guard(async (req, res) => {
        if (req.method !== 'PATCH' && req.method !== 'PUT') {
          return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
        }
        const body = await readJsonBody(req)
        const scope = resolveScope(config, req, { create: true })
        touchManifest(scope.store, (manifest) => {
          let next = manifest.slice()
          if (typeof body.enabled === 'boolean' && typeof body.id === 'string') {
            next = upsert(next, { id: body.id, enabled: body.enabled })
          }
          if (typeof body.move === 'string' && typeof body.id === 'string') {
            const from = next.findIndex(entry => entry.id === body.id)
            if (from !== -1) {
              const [moved] = next.splice(from, 1)
              const to = body.move === 'top'
                ? 0
                : body.move === 'bottom'
                  ? next.length
                  : Math.max(0, Math.min(next.length, from + (body.move === 'up' ? -1 : 1)))
              next.splice(to, 0, moved)
            }
          }
          // A workspace store keeps its identifying fields across edits.
          return next
        }, scope)
        invalidate()
        return sendJson(res, 200, { ok: true, scopeState: scopePayload(config, scope, langOf(req)), state: state(req) })
      }),
    },
    {
      kind: 'prefix',
      path: `${ROUTE_PREFIX}/api/preview`,
      handler: guard(async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: `method ${req.method} is not allowed here` })
        const body = await readJsonBody(req)
        const payload = previewPayload(config, body)
        if (typeof snapshot === 'function') {
          const live = snapshot({ cwd: query(req, 'cwd') })
          payload.live = { bytes: live.bytes, sources: live.sources.map(source => source.path) }
        }
        return sendJson(res, 200, payload)
      }),
    },
    {
      kind: 'exact',
      path: ROUTE_PREFIX,
      handler: guard(async (_req, res) => sendAsset(res, 'index.html', 'text/html')),
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/app.js`,
      handler: guard(async (_req, res) => sendAsset(res, 'app.js', 'text/javascript')),
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/app.css`,
      handler: guard(async (_req, res) => sendAsset(res, 'app.css', 'text/css')),
    },
  ]

  let registered = 0
  for (const route of routes) {
    try {
      ctx.effect(() => webServer.register(route), `global-rules.route(${route.path})`)
      registered += 1
    } catch (error) {
      // A duplicate route must not take the whole plugin down.
      options.warn?.(`global-rules: could not register ${route.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return registered
}

/** The identifying manifest fields a workspace store must preserve. */
