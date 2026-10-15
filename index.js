/**
 * dsh-plugin-global-rules — one standing rule set for every workspace.
 *
 * The plugin registers one `systemPrompt` section whose text is the user's
 * global rules file plus an optional per-workspace override, so every session
 * on every surface (Web, headless, SDK, ACP) starts from the same rules.
 *
 * Design notes:
 * - The section is registered through the *global* prompt layer, which
 *   contributes to every assembly (subagents and Agent Teams teammates
 *   included) unless `applyToSubagents: false` skips them at render time.
 * - The section is evaluated per assembly, so editing a rule file takes effect
 *   on the next model step of a running session — no restart, no new session.
 * - Reads are cached per Agent and invalidated by a stat fingerprint over the
 *   candidate files *and their parent directories*, so creating or deleting the
 *   workspace override is noticed without a filesystem watcher.
 *
 * @module dsh-plugin-global-rules
 */

import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_ORDER,
  SECTION_NAME,
  budgetedSection,
  escapeFraming,
  resolveConfig,
  ruleFilePlan,
} from './lib/rules.js'
import { MANIFEST_NAME, ensureStore, resolveWorkspaceStore, storeDirectory } from './lib/store.js'
import { ROUTE_PREFIX, registerRoutes } from './lib/api.js'

export { SECTION_NAME, DEFAULT_ORDER } from './lib/rules.js'
export * from './lib/rules.js'

/** Cordis plugin name. */
export const name = 'global-rules'

/**
 * The one hard dependency: prompt sections are the plugin's purpose, so a
 * composition without `systemPrompt` must not activate it.
 *
 * `webServer` is deliberately NOT listed. It is optional by design — a headless,
 * SDK, or ACP profile never provides one, and requiring it would silence rule
 * injection on exactly the surfaces that need it. The editor binds to it late
 * instead (see `bindRoutes`).
 */
export const inject = ['systemPrompt']

/**
 * No runtime schema dependency: the row validates its own config so it can be
 * installed with zero third-party packages. Cordis accepts a plain config.
 */
export const Config = undefined

/** Read one rule file, or `undefined` when it does not exist. */
function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR')) return undefined
    throw error
  }
}

/** One stat fingerprint entry: the file itself, and its parent directory for creation. */
function statFingerprint(path) {
  const entry = { path, file: -1, dir: -1 }
  try {
    entry.file = statSync(path).mtimeMs
  } catch { /* absent is a real state, not an error */ }
  try {
    entry.dir = statSync(dirname(path)).mtimeMs
  } catch { /* an absent parent directory is also meaningful */ }
  return entry
}

/** Fingerprint the complete candidate set for one workspace. */
/**
 * Fingerprint a candidate set: each file, its parent directory (so creation and
 * deletion are noticed), and the store directory itself (so enabling, disabling,
 * adding, or reordering a rule set in the manifest invalidates the cache).
 */
function fingerprintFor(plan, config) {
  const entries = plan.map(candidate => statFingerprint(candidate.path))
  const store = statFingerprint(join(storeDirectory(config), MANIFEST_NAME))
  const storeDir = statFingerprint(storeDirectory(config))
  return {
    entries,
    key: [
      ...entries.map(entry => `${entry.file}:${entry.dir}`),
      `manifest=${store.file}`,
      `store=${storeDir.dir}`,
    ].join('|'),
  }
}

/** Read the session working directory off an assembly context, defensively. */
function workspaceOf(context) {
  const agent = context?.agent ?? context?.scope
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** Read the session identity off an assembly context, for cache keying. */
function sessionIdOf(context) {
  const agent = context?.agent ?? context?.scope
  const id = agent?.id ?? agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Report whether this session is a subagent session rather than a root session. */
function isSubagentSession(agents, context) {
  try {
    const agent = context?.agent ?? context?.scope
    if (!agent || typeof agents?.roots !== 'function') return false
    return !agents.roots().includes(agent)
  } catch {
    return false
  }
}

/**
 * Install the plugin.
 * @param ctx - the owning Cordis context.
 * @param rawConfig - the row's configuration.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  /** Per-Agent resolution cache, keyed by session id. */
  const cache = new Map()
  let lastLoggedSignature = ''
  let lastLoggedNotices = ''
  let mount = { directory: storeDirectory(config), created: [] }

  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch { /* logging must never break assembly */ }
  }

  // First run creates the store and adopts an earlier single-file setup, so the
  // Web editor always opens onto something real.
  if (config.rulesFiles.length === 0) {
    try {
      mount = ensureStore(config)
    } catch (error) {
      warn(`global-rules: could not prepare the rule-set store: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Append one diagnostic line when `diagnosticsFile` is configured. Off by
   * default: this exists so an operator can see what the plugin resolved at
   * run time without a debugger, and it never runs unless asked for.
   * @param event - the record to append; a timestamp is added.
   */
  const diagnose = (event) => {
    if (config.diagnosticsFile === undefined) return
    try {
      appendFileSync(config.diagnosticsFile, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
    } catch { /* diagnostics must never break assembly */ }
  }

  /**
   * Resolve the rule state and its bounded text for one assembly, reusing the
   * cached result while the candidate files are unchanged.
   * @param context - the assembly context.
   * @returns `{ text, state }` for the section.
   */
  const stateFor = (context) => {
    const workspacePath = workspaceOf(context)
    const subagent = isSubagentSession(ctx.get('agents'), context)
    const plan = ruleFilePlan(config, workspacePath)
    const fingerprint = fingerprintFor(plan, config)
    const cacheKey = `${sessionIdOf(context) ?? 'unknown'}|${workspacePath ?? ''}`
    const cached = cache.get(cacheKey)
    if (cached && cached.fingerprint === fingerprint.key) {
      diagnose({ event: 'cache-hit', cacheKey, bytes: Buffer.byteLength(cached.text, 'utf8') })
      return cached
    }
    let resolved
    try {
      resolved = budgetedSection({
        config,
        workspacePath,
        isSubagent: subagent,
        readText: path => readIfPresent(path),
      })
    } catch (error) {
      // A broken rule file must degrade to "no rules", never to a failed request.
      warn(`global-rules: could not resolve rules: ${error instanceof Error ? error.message : String(error)}`)
      resolved = { text: '', state: { sources: [], notices: [], error: String(error) }, bytes: 0 }
    }
    const entry = {
      fingerprint: fingerprint.key,
      text: resolved.text,
      state: resolved.state,
      candidates: plan.map(candidate => candidate.path),
    }
    if (cache.size > 512) cache.clear()
    cache.set(cacheKey, entry)
    diagnose({
      event: 'resolve',
      cacheKey,
      workspacePath: workspacePath ?? null,
      subagent,
      candidates: entry.candidates,
      sources: resolved.state.sources.map(source => source.path),
      notices: resolved.state.notices,
      skipped: resolved.state.skipped ?? null,
      bytes: Buffer.byteLength(resolved.text, 'utf8'),
    })
    return entry
  }

  ctx.effect(() => {
    const disposer = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: config.order,
      interpolate: false,
      text: (context) => {
        if (!config.enabled) return ''
        const { text, state, candidates } = stateFor(context)
        if (state.sources.length === 0) {
          // Only speak up when the user clearly expected rules to exist.
          const signature = `${candidates.join(',')}|${state.notices.length > 0}`
          if (signature !== lastLoggedSignature) {
            lastLoggedSignature = signature
            if (state.notices.length > 0) warn(`global-rules: no rules injected. ${state.notices.join(' ')}`)
          }
          return ''
        }
        const notices = state.notices.join(' ')
        if (notices !== lastLoggedNotices) {
          lastLoggedNotices = notices
          if (notices.length > 0) warn(`global-rules: ${notices}`)
        }
        return escapeFraming(text)
      },
    })
    const plan = ruleFilePlan(config, undefined)
    const globalCandidates = plan.filter(candidate => candidate.source === 'global')
    diagnose({
      event: 'section-registered',
      section: SECTION_NAME,
      order: config.order,
      storeDirectory: storeDirectory(config),
      ruleFiles: globalCandidates.map(candidate => candidate.path),
    })
    return disposer
  }, 'global-rules.section()')

  // A read-only service so operators (and the Cordis inspect providers) can see
  // exactly which files produced the current prompt text.
  const service = {
    /**
     * Describe the current resolution without invoking a model.
     * @param options - optional scope override.
     * @returns the config, the rule files, and the rendered text.
     */
    snapshot(options = {}) {
      const workspacePath = options.cwd
      const plan = ruleFilePlan(config, workspacePath)
      const { text, state } = budgetedSection({
        config,
        workspacePath,
        isSubagent: options.subagent === true,
        readText: path => readIfPresent(path),
      })
      const workspaceStore = resolveWorkspaceStore(config, workspacePath)
      return {
        enabled: config.enabled,
        sectionName: SECTION_NAME,
        order: config.order,
        storeDirectory: storeDirectory(config),
        // Every contributing file, in precedence order, each tagged with the scope
        // it came from so an operator can see why a rule is in effect.
        plan: plan.map(candidate => ({
          scope: candidate.scope ?? candidate.source,
          path: candidate.path,
          id: candidate.id ?? null,
          title: candidate.title ?? null,
        })),
        ruleFiles: plan.filter(candidate => (candidate.scope ?? 'global') === 'global').map(candidate => candidate.path),
        workspaceFiles: plan
          .filter(candidate => candidate.source === 'workspace')
          .map(candidate => candidate.path),
        cwd: workspacePath ?? null,
        workspaceStore: workspaceStore?.directory ?? null,
        workspaceMatchedFrom: workspaceStore?.matchedFrom ?? null,
        maxBytes: config.maxBytes,
        applyToSubagents: config.applyToSubagents,
        sources: state.sources.map(source => ({ source: source.source, path: source.path, bytes: Buffer.byteLength(source.content, 'utf8') })),
        notices: state.notices,
        skipped: state.skipped ?? null,
        bytes: Buffer.byteLength(text, 'utf8'),
        text: escapeFraming(text),
      }
    },
    /** Drop the per-Agent cache; the next assembly re-reads every candidate. */
    invalidate() {
      cache.clear()
      return true
    },
    /** The resolved configuration this row is running with. */
    configuration() {
      return { ...config }
    },
  }
  ctx.provide('globalRules', service)

  // Serve the editor when this composition has an HTTP server. Registration is
  // bound late and retried: the webserver may activate after this row, and a
  // profile without one simply gets no Web page.
  const routes = bindRoutes(ctx, {
    config,
    invalidate: () => cache.clear(),
    snapshot: () => {
      const live = service.snapshot()
      return { bytes: live.bytes, sources: live.sources }
    },
    warn,
    diagnose,
  })
  diagnose({
    event: 'http',
    editorUrl: ROUTE_PREFIX,
    routes,
    storeDirectory: mount.directory,
    adopted: mount.created,
  })
}

/**
 * Register the editor's routes as soon as an HTTP server exists.
 *
 * The row activates on `systemPrompt` alone, so this may run before the
 * webserver mounts. A short bounded retry covers that ordering without holding
 * activation open, and every attempt is disposed by the plugin's own context.
 *
 * @param ctx - the owning Cordis context.
 * @param options - passed through to {@link registerRoutes}, plus `diagnose`.
 * @returns the number of routes registered on the first attempt.
 */
function bindRoutes(ctx, options) {
  const attempt = () => {
    if (ctx.get('webServer') === undefined) return 0
    return registerRoutes(ctx, options)
  }
  const immediate = attempt()
  if (immediate > 0) return immediate

  // Bounded late binding: ~4 seconds of retries, then stay quiet.
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    if (attempt() > 0) {
      clearInterval(timer)
      return
    }
    if (tries >= 20) {
      clearInterval(timer)
      options.warn?.('global-rules: no HTTP server appeared; the /rules editor is unavailable in this profile')
    }
  }, 200)
  if (typeof timer.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'global-rules.route-binding()')
  return 0
}
