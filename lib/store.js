/**
 * Rule-set store: the on-disk shape of a rule manager.
 *
 * Layout under the store root (default `<DSH_HOME>/rules`):
 *
 *   manifest.json                 the global rule sets: order, titles, enabled flags
 *   <id>.md                       one global rule set per file
 *   workspaces/<slug>~<digest>/   one store per workspace, same shape inside
 *     manifest.json               carries `path` (the workspace it belongs to) and `title`
 *     <id>.md
 *
 * A workspace store is a full store, not a special case: the same read/write code
 * serves both, and `manifest.json`'s optional `path`/`title` fields are what make a
 * directory self-describing. A store that exists on disk but not in the manifest
 * still appears in listings — silently hiding a file the user created is worse than
 * surfacing an entry they did not ask for.
 *
 * The workspace directory name is a readable slug plus a digest of the normalized
 * path, so two paths that slugify identically (`C:\a b` and `C:\a-b`) can never
 * share a directory.
 *
 * @module dsh-plugin-global-rules/store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

/** Manifest file name inside a store directory. */
export const MANIFEST_NAME = 'manifest.json'

/** Rule-set file extension. */
export const RULESET_EXTENSION = '.md'

/** Highest manifest version this module writes. */
export const MANIFEST_VERSION = 1

/** Largest rule-set file the store will read, in bytes. */
export const MAX_RULESET_BYTES = 1_048_576

/** Subdirectory of the store root holding per-workspace stores. */
export const WORKSPACE_DIR = 'workspaces'

/** Separator between the readable slug and the path digest. */
const SLUG_SEPARATOR = '~'

/** Characters Windows forbids in a file name, plus the control range. */
const UNSAFE_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g

/** Rule-set ids: lowercase letters, digits, dash, underscore. Used as file names. */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Validate a rule-set id.
 * @param id - the candidate id.
 * @returns whether the id is safe to use as a file name.
 */
export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

/** Turn an arbitrary title into a usable, unique id. */
export function slugify(title, taken = new Set()) {
  const base = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'rules'
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/* ── store locations ─────────────────────────────────────────────────────── */

/**
 * Normalize a path for comparison and for slugging: absolute, unified separators,
 * case-folded on Windows where the filesystem is case-insensitive.
 * @param value - the path to normalize.
 * @returns the comparable form.
 */
export function normalizePath(value) {
  const absolute = resolve(String(value)).replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Turn a workspace path into a readable, collision-free directory name.
 * @param workspacePath - the absolute workspace directory.
 * @returns the directory name.
 */
export function workspaceSlug(workspacePath) {
  const normalized = normalizePath(workspacePath)
  const tail = normalized.split('/').filter(Boolean).slice(-2).join('-')
  const slug = tail
    .replace(UNSAFE_FILENAME, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(-40) || 'workspace'
  return `${slug}${SLUG_SEPARATOR}${digest(normalized)}`
}

/** A short, stable digest of a string. */
function digest(value) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 8)
}

/** Resolve a config's store root. */
export function storeDirectory(config) {
  return config.storeDirectory
}

/** The directory holding one workspace's store. */
export function workspaceDirectory(config, workspacePath) {
  return join(storeDirectory(config), WORKSPACE_DIR, workspaceSlug(workspacePath))
}

/* ── low-level store operations, keyed by directory ──────────────────────── */

/** Path of one rule-set file inside a directory. */
export const rulesetPathIn = (directory, id) => join(directory, `${id}${RULESET_EXTENSION}`)

/** Path of a directory's manifest. */
export const manifestPathIn = directory => join(directory, MANIFEST_NAME)

/** Read a directory's manifest, tolerating absence and malformed content. */
export function readManifestIn(directory) {
  let raw
  try {
    raw = readFileSync(manifestPathIn(directory), 'utf8')
  } catch {
    return { version: MANIFEST_VERSION, rulesets: [], exists: false, error: undefined, path: undefined, title: undefined }
  }
  try {
    const parsed = JSON.parse(raw)
    const rulesets = Array.isArray(parsed?.rulesets) ? parsed.rulesets : []
    return {
      version: Number.isFinite(parsed?.version) ? Number(parsed.version) : MANIFEST_VERSION,
      rulesets: rulesets
        .filter(entry => entry && isValidId(entry.id))
        .map(entry => ({
          id: entry.id,
          title: typeof entry.title === 'string' && entry.title.trim().length > 0 ? entry.title.trim() : entry.id,
          enabled: entry.enabled !== false,
          order: Number.isFinite(entry.order) ? Number(entry.order) : undefined,
        })),
      exists: true,
      error: undefined,
      path: typeof parsed?.path === 'string' && parsed.path.length > 0 ? parsed.path : undefined,
      title: typeof parsed?.title === 'string' && parsed.title.trim().length > 0 ? parsed.title.trim() : undefined,
    }
  } catch (error) {
    // A corrupt manifest must not take the prompt down with it.
    return {
      version: MANIFEST_VERSION,
      rulesets: [],
      exists: true,
      error: `${MANIFEST_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      path: undefined,
      title: undefined,
    }
  }
}

/** Write a directory's manifest atomically (write beside, then rename). */
export function writeManifestIn(directory, rulesets, extra = {}) {
  mkdirSync(directory, { recursive: true })
  const payload = {
    version: MANIFEST_VERSION,
    ...(extra.path === undefined ? {} : { path: extra.path }),
    ...(extra.title === undefined ? {} : { title: extra.title }),
    rulesets: rulesets.map((entry, index) => ({
      id: entry.id,
      title: entry.title,
      enabled: entry.enabled !== false,
      order: Number.isFinite(entry.order) ? entry.order : index,
    })),
  }
  const file = manifestPathIn(directory)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
  return payload
}

/** Read one rule-set file from a directory, bounded and tolerant. */
export function readRulesetIn(directory, id) {
  if (!isValidId(id)) return undefined
  return readBoundedText(rulesetPathIn(directory, id))
}

/** Write one rule-set file into a directory. */
export function writeRulesetIn(directory, id, content) {
  if (!isValidId(id)) throw new Error(`invalid rule set id "${id}"`)
  mkdirSync(directory, { recursive: true })
  const file = rulesetPathIn(directory, id)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, file)
  return file
}

/** Delete one rule-set file from a directory. */
export function deleteRulesetIn(directory, id) {
  if (!isValidId(id)) throw new Error(`invalid rule set id "${id}"`)
  const file = rulesetPathIn(directory, id)
  if (!existsSync(file)) return false
  rmSync(file)
  return true
}

/**
 * List one directory's rule sets: manifest order first, then untracked files.
 * @param directory - the store directory.
 * @param options - `{ legacyFile }` adopts a pre-store single file when no manifest exists.
 * @returns the ordered rule sets with their metadata and sizes.
 */
export function listRulesetsIn(directory, options = {}) {
  const manifest = readManifestIn(directory)

  if (!manifest.exists && typeof options.legacyFile === 'string') {
    const legacyText = readBoundedText(options.legacyFile)
    if (legacyText !== undefined) {
      return {
        directory,
        manifest,
        rulesets: [{
          id: 'global',
          title: options.legacyTitle ?? 'Global rules',
          enabled: true,
          order: 0,
          path: options.legacyFile,
          bytes: byteLength(legacyText),
          untracked: true,
          legacy: true,
        }],
      }
    }
  }

  let onDisk = []
  try {
    onDisk = readdirSync(directory)
      .filter(name => extname(name).toLowerCase() === RULESET_EXTENSION)
      .map(name => basename(name, extname(name)))
      .filter(isValidId)
  } catch { /* an absent directory is an empty store */ }

  const known = new Set(manifest.rulesets.map(entry => entry.id))
  const ordered = manifest.rulesets.map((entry, index) => ({
    ...entry,
    order: Number.isFinite(entry.order) ? entry.order : index,
    path: rulesetPathIn(directory, entry.id),
    bytes: byteLength(readRulesetIn(directory, entry.id)),
    untracked: false,
  }))
  const extra = onDisk
    .filter(id => !known.has(id))
    .sort()
    .map((id, offset) => ({
      id,
      title: id,
      enabled: true,
      order: ordered.length + offset,
      path: rulesetPathIn(directory, id),
      bytes: byteLength(readRulesetIn(directory, id)),
      untracked: true,
    }))
  return { directory, manifest, rulesets: [...ordered, ...extra] }
}

/* ── the store façade, keyed by config ───────────────────────────────────── */

/**
 * Bind the global store for a resolved configuration.
 * @param config - resolved plugin configuration.
 * @returns the store operations for that configuration's root.
 */
export function getStore(config) {
  const directory = storeDirectory(config)
  return {
    directory,
    readManifest: () => readManifestIn(directory),
    writeManifest: (rulesets, extra) => writeManifestIn(directory, rulesets, extra),
    readRuleset: id => readRulesetIn(directory, id),
    writeRuleset: (id, content) => writeRulesetIn(directory, id, content),
    deleteRuleset: id => deleteRulesetIn(directory, id),
    listRulesets: () => listRulesetsIn(directory, {
      legacyFile: config.legacyGlobalRulesFile,
      legacyTitle: config.legacyGlobalTitle,
    }),
  }
}

/* Back-compatible helpers, bound to the config's global store. */
export const readManifest = config => readManifestIn(storeDirectory(config))
export const writeManifest = (config, rulesets) => writeManifestIn(storeDirectory(config), rulesets)
export const readRuleset = (config, id) => readRulesetIn(storeDirectory(config), id)
export const writeRuleset = (config, id, content) => writeRulesetIn(storeDirectory(config), id, content)
export const deleteRuleset = (config, id) => deleteRulesetIn(storeDirectory(config), id)
export const listRulesets = config => listRulesetsIn(storeDirectory(config), {
  legacyFile: config.legacyGlobalRulesFile,
  legacyTitle: config.legacyGlobalTitle,
})
export const rulesetPath = (config, id) => rulesetPathIn(storeDirectory(config), id)
export const manifestPath = config => manifestPathIn(storeDirectory(config))

/**
 * The starter text and default title for a new rule set.
 *
 * Seeded content follows the configured language, so an English user does not open a
 * brand-new rule set onto Chinese boilerplate. Defined as one table rather than
 * per-call strings so the two scopes cannot drift apart.
 *
 * @param scope - `'global'` or `'workspace'`.
 * @param title - the display title to put in the heading.
 * @param lang - `'en'` or anything else for Chinese.
 * @returns `{ title, body }`.
 */
export function starterFor(scope, title, lang) {
  const english = String(lang ?? '').toLowerCase().startsWith('en')
  if (scope === 'workspace') {
    return {
      title: english ? 'Workspace rules' : '工作区规则',
      body: english
        ? `# ${title}\n\nRules here apply to this workspace only, and layer on top of the global ones.\nSaving takes effect on the next model step.\n`
        : `# ${title}\n\n这些规则只在该工作区生效，并叠加在全局规则之后。\n保存后下一个模型步生效。\n`,
    }
  }
  return {
    title: english ? 'Global rules' : '全局规则',
    body: english
      ? `# ${title}\n\nRules here apply to every workspace. Saving takes effect on the next model step.\n`
      : `# ${title}\n\n这些规则对所有工作区生效。保存后下一个模型步生效。\n`,
  }
}

/**
 * Create the global store on first use, adopting an earlier single-file setup so an
 * upgrade never drops the user's existing rules.
 * @param config - resolved plugin configuration.
 * @returns what was created.
 */
export function ensureStore(config) {
  const store = getStore(config)
  const manifest = store.readManifest()
  const created = []
  mkdirSync(store.directory, { recursive: true })
  if (manifest.exists) return { directory: store.directory, created, manifest }

  const legacy = config.legacyGlobalRulesFile
  const starter = starterFor('global', config.legacyGlobalTitle ?? 'Global rules', config.lang)
  const title = config.legacyGlobalTitle ?? starter.title
  if (typeof legacy === 'string' && existsSync(legacy)) {
    store.writeRuleset('global', readFileSync(legacy, 'utf8'))
    created.push({ id: 'global', adoptedFrom: legacy })
  } else {
    store.writeRuleset('global', starterFor('global', title, config.lang).body)
    created.push({ id: 'global', adoptedFrom: null })
  }
  store.writeManifest([{ id: 'global', title, enabled: true, order: 0 }])
  return { directory: store.directory, created, manifest: store.readManifest() }
}

/* ── workspace stores ────────────────────────────────────────────────────── */

/**
 * Create (or update) a workspace's store and record which workspace it belongs to.
 * @param config - resolved plugin configuration.
 * @param workspacePath - the absolute workspace directory.
 * @param options - an optional display title.
 * @returns the directory, the recorded path, and the title.
 */
export function ensureWorkspaceStore(config, workspacePath, options = {}) {
  const directory = workspaceDirectory(config, workspacePath)
  mkdirSync(directory, { recursive: true })
  const manifest = readManifestIn(directory)
  const path = typeof workspacePath === 'string' && workspacePath.length > 0 ? workspacePath : manifest.path
  const title = typeof options.title === 'string' && options.title.trim().length > 0
    ? options.title.trim()
    : (manifest.title ?? basename(path ?? '') ?? 'workspace')

  if (!manifest.exists) {
    // Seeded content follows the configured language, and is the same text the global
    // scope seeds, so a new workspace does not open onto boilerplate in another tongue.
    const starter = starterFor('workspace', title, config.lang)
    writeRulesetIn(directory, 'workspace', starter.body)
    writeManifestIn(
      directory,
      [{ id: 'workspace', title: options.rulesetTitle ?? starter.title, enabled: true, order: 0 }],
      { path, title },
    )
  } else {
    writeManifestIn(directory, manifest.rulesets, { path, title })
  }
  return { directory, path, title, slug: workspaceSlug(path ?? workspacePath) }
}

/** Remove a workspace's store from disk entirely. */
export function deleteWorkspaceStore(config, workspacePath) {
  const directory = workspaceDirectory(config, workspacePath)
  if (!existsSync(directory)) return false
  rmSync(directory, { recursive: true, force: true })
  return true
}

/**
 * List every per-workspace store that exists on disk.
 * @param config - resolved plugin configuration.
 * @returns each workspace store with its recorded path, title, and rule sets.
 */
export function listWorkspaceStores(config) {
  const base = join(storeDirectory(config), WORKSPACE_DIR)
  let names = []
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch { /* no workspace stores yet */ }

  const stores = []
  for (const name of names) {
    const directory = join(base, name)
    const manifest = readManifestIn(directory)
    if (manifest.path === undefined) continue
    stores.push({
      slug: name,
      directory,
      path: manifest.path,
      title: manifest.title ?? basename(manifest.path),
      rulesets: listRulesetsIn(directory).rulesets,
    })
  }
  return stores
}

/**
 * Resolve which workspace store applies to a session directory.
 *
 * Walk up from the session directory to the first ancestor that already has a
 * store, so a session started in a subdirectory still sees its project's rules.
 * The longest match wins; no match means the session gets global rules only.
 *
 * @param config - resolved plugin configuration.
 * @param workspacePath - the session working directory, when known.
 * @returns `{ directory, path, matchedFrom }` or `undefined`.
 */
export function resolveWorkspaceStore(config, workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath.length === 0) return undefined
  const start = normalizePath(workspacePath)
  let current = start
  for (let depth = 0; depth < 64; depth += 1) {
    const directory = join(storeDirectory(config), WORKSPACE_DIR, workspaceSlug(current))
    if (existsSync(manifestPathIn(directory))) {
      return {
        directory,
        path: current,
        matchedFrom: current === start ? undefined : current,
      }
    }
    const parent = current.slice(0, current.lastIndexOf('/'))
    if (parent.length === 0 || parent === current) break
    current = parent
  }
  return undefined
}

/* ── small helpers ───────────────────────────────────────────────────────── */

/** Read a bounded UTF-8 text file, tolerating failure. */
function readBoundedText(file) {
  try {
    const text = readFileSync(file, 'utf8')
    return text.length > MAX_RULESET_BYTES ? text.slice(0, MAX_RULESET_BYTES) : text
  } catch {
    return undefined
  }
}

/** UTF-8 byte length of a possibly-absent string. */
function byteLength(text) {
  return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0
}
