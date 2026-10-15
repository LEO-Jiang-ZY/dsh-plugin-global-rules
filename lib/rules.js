/**
 * Pure rule-resolution core for dsh-plugin-global-rules.
 *
 * Nothing here imports Cordis or Node I/O beyond `node:path`: the plugin entry
 * injects a read function, so every decision in this file is a deterministic
 * function of its inputs and can be unit-tested without a Harness process.
 *
 * @module dsh-plugin-global-rules
 */

import { basename, isAbsolute, join, resolve } from 'node:path'
import { getStore, resolveWorkspaceStore, storeDirectory } from './store.js'

/** Prompt section name; stable, so a profile can target it by name. */
export const SECTION_NAME = 'global:user-rules'

/**
 * Default prompt order. It deliberately lands in the "policy band" of
 * `@deepseek-ai/dsh-system-prompt`, after the harness identity (-1000) and the
 * deployment persona prefix (0), and before the first tool section (1000):
 * the model reads the user's standing rules before any tool documentation.
 */
export const DEFAULT_ORDER = 100

/** Names of the two rule sources, in precedence order (later wins). */
export const SOURCE_GLOBAL = 'global'
export const SOURCE_WORKSPACE = 'workspace'

/**
 * Normalize a configuration value that accepts one path or a list of paths.
 * @param value - the raw config value.
 * @returns a flat array of non-empty trimmed strings.
 */
export function toPathList(value) {
  const list = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]
  return list
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

/**
 * Normalize one path for comparison: absolute, separator-collapsed, and
 * case-folded on Windows. Resolution never touches the disk, so a path that
 * does not exist yet still compares consistently.
 * @param value - the path to normalize.
 * @param base - the base directory for relative paths.
 * @returns the comparable absolute path.
 */
export function normalizePath(value, base) {
  const absolute = isAbsolute(value) ? value : resolve(base ?? process.cwd(), value)
  const unified = absolute.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/**
 * Report whether an absolute path equals a root or lives underneath it.
 * @param candidate - the normalized absolute path under test.
 * @param root - the normalized absolute root.
 * @returns whether the candidate is the root itself or a descendant.
 */
export function isUnder(candidate, root) {
  if (candidate === root) return true
  return candidate.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/**
 * Decide whether the standing rules apply to one workspace.
 *
 * `allow` wins over `deny` when a path matches both, so an explicit entry can
 * rescue a directory that a broader deny pattern covers. An empty `allow` list
 * means "every workspace".
 *
 * @param workspacePath - the session working directory, or `undefined` when unknown.
 * @param options - the allow and deny lists (raw config values).
 * @returns whether the rules should be injected for this workspace.
 */
export function isWorkspaceAllowed(workspacePath, options = {}) {
  const allow = toPathList(options.allow).map(p => normalizePath(p))
  const deny = toPathList(options.deny).map(p => normalizePath(p))
  // An unknown working directory is not a reason to withhold globally scoped
  // rules: the user asked for every workspace, and the session is the scope.
  if (workspacePath === undefined || workspacePath === null || workspacePath === '') {
    return allow.length === 0
  }
  const candidate = normalizePath(workspacePath)
  if (allow.some(root => isUnder(candidate, root))) return true
  if (allow.length > 0) return false
  return !deny.some(root => isUnder(candidate, root))
}

/**
 * Build the ordered list of absolute rule-file paths to consider for one session.
 *
 * Precedence, broadest first — later wins:
 * 1. the global layer: the store's enabled rule sets in manifest order, or — when
 *    `rulesFiles` is set — exactly those files, which is an explicit operator choice;
 * 2. the store of the workspace this session runs in, when one exists. A store
 *    registered for an ancestor directory applies too, so a session started in a
 *    subdirectory still sees its project's rules;
 * 3. `workspaceRulesFiles`, a plain file in the session directory for anyone who
 *    prefers editing `.dsh/rules.md` in place.
 *
 * `rulesFiles` replaces step 1 **only**. It used to bypass the whole chain, so
 * setting it silently disabled every workspace rule — a per-workspace rule must not
 * be switchable off by an unrelated global setting.
 *
 * @param config - resolved plugin configuration.
 * @param workspacePath - the session working directory, when known.
 * @returns candidate descriptors in precedence order, broadest first.
 */
export function ruleFilePlan(config, workspacePath) {
  const plan = []
  const explicit = toPathList(config.rulesFiles)
  if (explicit.length > 0) {
    for (const path of explicit) {
      plan.push({
        source: SOURCE_GLOBAL,
        path: absoluteRulePath(path, config.dshHome),
        scope: 'global',
        explicit: true,
      })
    }
  } else {
    for (const ruleset of getStore(config).listRulesets().rulesets) {
      if (ruleset.enabled) {
        plan.push({ source: SOURCE_GLOBAL, path: ruleset.path, id: ruleset.id, title: ruleset.title, scope: 'global' })
      }
    }
  }
  const workspaceStore = resolveWorkspaceStore(config, workspacePath)
  if (workspaceStore !== undefined) {
    const inWorkspace = getStore({ ...config, storeDirectory: workspaceStore.directory }).listRulesets()
    for (const ruleset of inWorkspace.rulesets) {
      if (!ruleset.enabled) continue
      plan.push({
        source: SOURCE_WORKSPACE,
        path: ruleset.path,
        id: ruleset.id,
        title: ruleset.title,
        scope: 'workspace',
        workspacePath: workspaceStore.path,
        matchedFrom: workspaceStore.matchedFrom,
      })
    }
  }
  for (const path of toPathList(config.workspaceFiles)) {
    plan.push({ source: SOURCE_WORKSPACE, path: absoluteRulePath(path, workspacePath), scope: 'session' })
  }
  return plan
}

/**
 * Drop repeated sources while keeping the highest-precedence copy.
 *
 * Two files with identical trimmed content are one rule set the user happened
 * to reach twice (a symlinked copy, or a path listed in both lists), and the
 * later position wins because precedence is "later overrides earlier".
 *
 * @param sources - read sources in precedence order.
 * @returns deduplicated sources, still in precedence order.
 */
export function dedupeSources(sources) {
  const lastIndexByContent = new Map()
  sources.forEach((source, index) => {
    if (source.content.length > 0) lastIndexByContent.set(source.content, index)
  })
  const keptIndexes = new Set()
  const seenContent = new Set()
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index]
    if (source.content.length === 0) {
      keptIndexes.add(index)
      continue
    }
    if (lastIndexByContent.get(source.content) !== index) continue
    if (seenContent.has(source.content)) continue
    seenContent.add(source.content)
    keptIndexes.add(index)
  }
  return sources.filter((_, index) => keptIndexes.has(index))
}

/**
 * Apply a byte budget to a list of sources, dropping whole sources from the
 * broadest end first and truncating the most specific source only when it
 * alone exceeds the budget.
 *
 * @param sources - sources in precedence order, broadest first.
 * @param budgetBytes - maximum rendered bytes; `0` or negative disables rules.
 * @returns the kept sources plus the notices worth telling the user about.
 */
export function applyBudget(sources, budgetBytes) {
  const notices = []
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    if (sources.length > 0) notices.push('The rule budget is zero, so no rule file was injected.')
    return { sources: [], notices, truncated: false }
  }
  let kept = sources.slice()
  // Drop whole broader sources while the most specific one cannot fit.
  while (kept.length > 1) {
    const total = kept.reduce((sum, source) => sum + byteLength(renderSource(source)), 0)
    if (total <= budgetBytes) break
    const dropped = kept.shift()
    notices.push(`Omitted ${dropped.path}: the rendered rules exceeded ${budgetBytes} bytes.`)
  }
  if (kept.length === 0) return { sources: [], notices, truncated: false }
  const total = kept.reduce((sum, source) => sum + byteLength(renderSource(source)), 0)
  if (total <= budgetBytes) return { sources: kept, notices, truncated: false }
  const only = kept[kept.length - 1]
  const rendered = renderSource(only)
  const limit = budgetBytes - (kept.length > 1
    ? kept.slice(0, -1).reduce((sum, source) => sum + byteLength(renderSource(source)), 0)
    : 0)
  const truncatedText = truncateUtf8(rendered, Math.max(0, limit))
  notices.push(`Truncated ${only.path}: the rendered rules exceeded ${budgetBytes} bytes.`)
  return {
    sources: [...kept.slice(0, -1), { ...only, content: truncatedText, truncated: true }],
    notices,
    truncated: true,
  }
}

/** Count the UTF-8 bytes of a string without allocating a Buffer. */
function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/** Cut a string to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8(text, maxBytes) {
  if (maxBytes <= 0) return ''
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  let end = maxBytes
  // Back off continuation bytes so the slice stays valid UTF-8.
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.toString('utf8', 0, end)
}

/**
 * Render one source as the model sees it.
 *
 * Provenance is deliberately terse. The long form — `### Rules from <absolute path>
 * [global]` — spent roughly 110 bytes per source on text the model does not need in
 * order to obey, and path text is expensive: Windows paths tokenize badly. The short
 * scope tag keeps attribution possible without paying for the path on every request;
 * the full paths go in one compact reference line at the end of the section.
 *
 * @param source - the source to render.
 * @param options - `{ verbose: true }` restores the full path in each heading.
 * @returns the rendered block, ending without a trailing newline.
 */
export function renderSource(source, options = {}) {
  const label = source.source === SOURCE_GLOBAL ? 'global' : 'workspace'
  const suffix = source.truncated === true ? ' (truncated)' : ''
  const content = typeof source.content === 'string' ? source.content.trim() : ''
  if (options.verbose === true) {
    return `### Rules from ${source.path} [${label}]${suffix}\n${content}`
  }
  // A single heading per source is enough to attribute a conflicting rule, and the
  // scope alone is enough to tell which layer wins.
  return `### [${label}]${suffix}\n${content}`
}

/**
 * The reference line naming the files behind the section.
 *
 * Only rendered when `sourceIndex` is on. The model does not need absolute paths in
 * order to obey a rule — the plugin's own UI, `snapshot()`, and `effective` already
 * answer "which files were used" far better — so by default this cost is not paid.
 *
 * @param sources - the rendered sources, in precedence order.
 * @returns the reference block, or an empty string when there is nothing to name.
 */
export function renderSourceIndex(sources) {
  if (sources.length === 0) return ''
  const entries = sources.map((source, index) => {
    const label = source.source === SOURCE_GLOBAL ? 'global' : 'workspace'
    const name = typeof source.title === 'string' && source.title.trim().length > 0
      ? source.title.trim()
      : basenameOf(source.path)
    return `${index + 1}. [${label}] ${name} — ${source.path}`
  })
  return `Rules are read in this order; a later file overrides an earlier one:\n${entries.join('\n')}`
}

/**
 * Escape the plugin-owned framing tokens so rule text cannot close a frame.
 * @param text - raw rule text.
 * @returns text safe to embed in a framed section.
 */
export function escapeFraming(text) {
  return text
    .replace(/<\/system-reminder>/gi, '&lt;/system-reminder&gt;')
    .replace(/<system-reminder>/gi, '&lt;system-reminder&gt;')
}

/**
 * Render the complete prompt section text.
 * @param state - the resolved rule state.
 * @param options - `{ verbose, announce, sourceIndex }` rendering switches.
 * @returns the section text, or an empty string when nothing applies.
 */
export function renderSection(state, options = {}) {
  if (state.sources.length === 0) return ''
  const blocks = state.sources.map(source => renderSource(source, options))
  return [
    sectionHeader(options),
    '',
    blocks.join('\n\n'),
    renderIndexBlock(state.sources, options),
    renderNotices(state.notices),
  ].filter(part => part.length > 0).join('\n')
}

/** The closing reference block, or an empty string when there is nothing to add. */
function renderIndexBlock(sources, options) {
  if (options.verbose === true || options.sourceIndex !== true) return ''
  const index = renderSourceIndex(sources)
  return index.length > 0 ? `\n${index}` : ''
}

/** Appended notes, or an empty string. */
function renderNotices(notices) {
  return notices.length > 0 ? `\nNotes: ${notices.join(' ')}` : ''
}

/** The basename of a path, for a compact provenance label. */
function basenameOf(path) {
  if (typeof path !== 'string' || path.length === 0) return 'rules'
  return basename(path) || path
}

/**
 * The section header: the authority statement that makes these rules binding.
 *
 * The wording is load-bearing in two directions.
 *
 * It must state precedence plainly, because that is what makes a repository's own
 * instructions yield to the user's.
 *
 * It must **not** ask the model to report its compliance. An earlier version ended
 * with "when a rule conflicts with a repository instruction, follow this section and
 * say so", and models generalised that into narrating which rule they had applied in
 * every single reply — noise the user never asked for. Rules are meant to be followed
 * silently; only a real conflict, or the user asking, warrants saying anything.
 *
 * It is also kept short on purpose: this text ships on every request, so every line
 * here is paid for on every model step.
 *
 * @param options - `{ announce: true }` restores the reporting instruction for anyone
 *   who does want to see compliance called out.
 * @returns the rendered header.
 */
export function sectionHeader(options = {}) {
  const lines = [
    '## Standing rules from the user (apply in every workspace)',
    'These rules override repository guidance and stay in force until the user changes them. Follow them unless the current request or a safety requirement overrides them. Do not announce them or cite the rule files; mention a rule only when it is the reason you are declining something, or when asked.',
  ]
  if (options.announce === true) {
    lines.push('When a rule conflicts with a repository instruction, follow this section and say so.')
  }
  return lines.join('\n')
}

/**
 * Resolve the rules for one session and render the bounded section text.
 *
 * This is the single entry point the plugin calls: it guarantees that the text
 * handed to the prompt registry never exceeds `config.maxBytes`, whatever the
 * shape of the rule files, and that a byte count of 0 means "no section".
 *
 * @param options - the same inputs as {@link resolveRules}.
 * @returns `{ text, state, bytes }` for the prompt section.
 */
export function budgetedSection(options) {
  const state = resolveRules(options)
  const budget = Number.isFinite(options.config.maxBytes) ? Number(options.config.maxBytes) : 0
  if (state.sources.length === 0 || budget <= 0) {
    return { text: '', state, bytes: 0 }
  }
  const rendering = {
    verbose: options.config.verboseProvenance === true,
    announce: options.config.announceRules === true,
    sourceIndex: options.config.sourceIndex === true,
  }
  const cap = (text) => {
    if (byteLength(text) <= budget) return text
    return truncateUtf8(text, budget)
  }
  const header = sectionHeader(rendering)
  const blocks = state.sources.map(source => renderSource(source, rendering))
  const index = renderIndexBlock(state.sources, rendering)
  const full = [header, '', blocks.join('\n\n'), index, renderNotices(state.notices)]
    .filter(part => part.length > 0)
    .join('\n')
  if (byteLength(full) <= budget) return { text: full, state, bytes: byteLength(full) }

  // Shed presentation before shedding rules: notices, then the provenance index,
  // which is traceability rather than instruction.
  const withoutNotices = [header, '', blocks.join('\n\n'), index].filter(part => part.length > 0).join('\n')
  if (byteLength(withoutNotices) <= budget) {
    return { text: withoutNotices, state, bytes: byteLength(withoutNotices) }
  }
  const withoutIndex = [header, '', blocks.join('\n\n')].filter(part => part.length > 0).join('\n')
  if (byteLength(withoutIndex) <= budget) {
    return { text: withoutIndex, state, bytes: byteLength(withoutIndex) }
  }
  // The rule text alone overflows: keep the header and as much rule text as fits.
  const text = cap(`${header}\n\n${state.sources.map(source => source.content).join('\n\n')}`)
  return { text, state, bytes: byteLength(text) }
}

/**
 * Resolve the complete rule state for one session.
 *
 * @param options - the resolution inputs.
 * @param options.config - resolved plugin configuration.
 * @param options.workspacePath - the session working directory, when known.
 * @param options.isSubagent - whether this session is a subagent/teammate session.
 * @param options.readText - sync reader returning file content, or `undefined` when absent.
 * @param options.sources - pre-resolved sources, used by the dry-run preview so it can
 *   render a draft without touching the disk.
 * @param options.notices - pre-resolved notices, likewise.
 * @returns the rule state to render.
 */
export function resolveRules(options) {
  const { config, workspacePath, isSubagent, readText } = options
  // A caller that already resolved the sources (the preview) supplies them directly;
  // everything downstream still runs through the same rendering and budget path.
  if (Array.isArray(options.sources)) {
    return {
      sources: options.sources,
      notices: Array.isArray(options.notices) ? options.notices : [],
      skipped: undefined,
    }
  }
  const notices = []
  if (isSubagent === true && config.applyToSubagents === false) {
    return { sources: [], notices, skipped: 'subagent' }
  }
  if (!isWorkspaceAllowed(workspacePath, { allow: config.workspaceAllow, deny: config.workspaceDeny })) {
    return { sources: [], notices, skipped: 'workspace' }
  }
  const read = typeof readText === 'function' ? readText : () => undefined
  const readSources = []
  for (const candidate of ruleFilePlan(config, workspacePath)) {
    let raw
    try {
      raw = read(candidate.path)
    } catch (error) {
      notices.push(`Could not read ${candidate.path}: ${error instanceof Error ? error.message : String(error)}.`)
      continue
    }
    if (typeof raw !== 'string') continue
    const content = raw.replace(/^\uFEFF/, '').trim()
    if (content.length === 0) continue
    readSources.push({ ...candidate, content })
  }
  const deduped = dedupeSources(readSources)
  const budgeted = applyBudget(deduped, config.maxBytes)
  return {
    sources: budgeted.sources,
    notices: [...notices, ...budgeted.notices],
    truncated: budgeted.truncated,
  }
}

/** Resolve the effective configuration from raw plugin config. */
export function resolveConfig(raw = {}) {
  const dshHome = typeof raw.dshHome === 'string' && raw.dshHome.trim().length > 0
    ? raw.dshHome.trim()
    : (process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0
      ? process.env.DSH_HOME.trim()
      : join(process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(), '.dsh'))
  const configuredStore = typeof raw.storeDirectory === 'string' && raw.storeDirectory.trim().length > 0
    ? raw.storeDirectory.trim()
    : join(dshHome, 'rules')
  return {
    enabled: raw.enabled !== false,
    dshHome,
    // `rulesFiles` is an explicit override. When it is empty the rule-set store
    // is authoritative, so a set the user enables in the UI takes effect at once.
    rulesFiles: toPathList(raw.rulesFiles ?? raw.globalRulesFiles),
    storeDirectory: isAbsolute(configuredStore) ? configuredStore : resolve(dshHome, configuredStore),
    // Adopted on first run so an earlier single-file setup keeps working.
    legacyGlobalRulesFile: join(dshHome, 'global-rules.md'),
    // The default title is written into the store's first rule set, so it follows
    // the same language as the UI rather than surprising an English user.
    legacyGlobalTitle: isEnglish(raw.lang) ? 'Global rules' : '全局规则',
    lang: isEnglish(raw.lang) ? 'en' : 'zh',
    workspaceFiles: toPathList(raw.workspaceRulesFiles).length > 0
      ? toPathList(raw.workspaceRulesFiles)
      : ['.dsh/rules.md'],
    workspaceAllow: toPathList(raw.workspaceAllow),
    workspaceDeny: toPathList(raw.workspaceDeny),
    maxBytes: Number.isFinite(raw.maxBytes) ? Number(raw.maxBytes) : 32_768,
    order: Number.isFinite(raw.order) ? Number(raw.order) : DEFAULT_ORDER,
    applyToSubagents: raw.applyToSubagents !== false,
    // Off by default: rules are followed quietly, and the long provenance heading is
    // replaced by a bare scope tag. Each flag is one line of config away for anyone
    // who wants the model to cite its rules or needs per-source paths in the prompt.
    announceRules: raw.announceRules === true,
    verboseProvenance: raw.verboseProvenance === true,
    sourceIndex: raw.sourceIndex === true,
    diagnosticsFile: typeof raw.diagnosticsFile === 'string' && raw.diagnosticsFile.trim().length > 0
      ? raw.diagnosticsFile.trim()
      : undefined,
  }
}

/**
 * Resolve one workspace-relative rule file against the session directory.
 * @param relativePath - the configured path, absolute or workspace-relative.
 * @param workspacePath - the session working directory, when known.
 * @returns the absolute path to read.
 */
export function absoluteRulePath(relativePath, workspacePath) {
  if (isAbsolute(relativePath)) return relativePath
  return resolve(workspacePath ?? process.cwd(), relativePath)
}

/**
 * Report whether a language tag selects English.
 *
 * The editor follows the DSH UI language, so anything that is not English falls
 * back to Chinese — the plugin's original audience — rather than to a third
 * half-translated state.
 *
 * @param tag - a BCP 47-style tag such as `en`, `en-US`, or `zh-CN`.
 * @returns whether English should be used.
 */
export function isEnglish(tag) {
  return typeof tag === 'string' && /^en\b/i.test(tag.trim())
}
