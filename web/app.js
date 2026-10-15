/**
 * Rule manager page.
 *
 * Talks only to the plugin's own loopback API. All rule state lives on the host;
 * this script keeps one in-memory draft per scope, mirrors it into localStorage so
 * a reopened page does not lose work, and never leaves the user without a way out.
 *
 * Deliberate design notes, each one paying for a defect found in use:
 * - Exiting must never call `window.close()` unconditionally. Inside the desktop
 *   app's window that closes DSH itself. The exit path asks the embedding overlay
 *   to dismiss instead, and only falls back to `window.close()` for a window this
 *   script opened.
 * - No native `window.confirm`/`prompt`: the page runs inside the app window, where
 *   a native dialog cannot be styled, may be suppressed, and gives no way to report
 *   what just happened.
 * - No interactive control near the window's top-right corner: the desktop app
 *   draws its own minimize/close buttons there.
 * - Rendering is defensive, so one bad record can never blank the page and leave
 *   every button dead.
 */
'use strict'

const API = '/rules/api'
const DRAFT_PREFIX = 'dsh.global-rules.draft.'
/** Message the embedding overlay listens for. */
const CLOSE_MESSAGE = 'dsh-global-rules:close'

/* ── localization ────────────────────────────────────────────────────────── */

/**
 * Two tables, no fallback chain: an unknown language resolves to Chinese, the
 * plugin's original audience, rather than to a half-translated third state. The
 * language arrives as `?lang=`, set by the in-app overlay from the DSH locale.
 */
const STRINGS = {
  zh: {
    title: '规则管理器',
    loading: '正在读取…',
    loaded: count => `已载入 ${count} 个规则集 · ${new Date().toLocaleTimeString()}`,
    close: '关闭',
    reload: '重新载入',
    scopes: '生效范围',
    scopeHint: '全局规则对所有工作区生效；工作区规则在其之上叠加，越具体越优先。',
    scopesGlobal: '全局',
    scopesGlobalHint: '所有工作区',
    scopesWorkspace: '工作区',
    addWorkspace: '＋ 工作区',
    addWorkspaceHint: '为一个目录新增工作区规则',
    rulesets: '规则集',
    rulesetHint: '按列表顺序拼接；关掉的规则集不会注入。',
    newRulesetHint: '新建规则集',
    storeRoot: '存储位置',
    budget: '注入预算',
    effective: '当前注入',
    overrideNotice: '配置里设置了 rulesFiles，实际注入的是那些文件；本页改动不会生效。',
    emptyNotice: '这个范围还没有规则集。点「＋ 新建」写下第一条规则。',
    overrideBadge: '被 rulesFiles 覆盖',
    noRules: '未注入任何规则',
    explicitFiles: count => `${count} 个显式文件`,
    rulesetCount: (count, bytes) => `${count} 个规则集 · ${bytes} 字节`,
    name: '名称',
    enabled: '启用',
    enabledHint: '关掉后本规则集不会注入',
    content: '内容',
    bytes: n => `${n} 字节`,
    dirty: '有未保存的改动',
    save: '保存并生效',
    discard: '放弃修改',
    dryrun: '试运行预览',
    remove: '删除此规则集',
    preview: '试运行预览',
    previewHint: '这是模型在下一个模型步会看到的完整分段（未写入任何文件）。',
    copy: '复制',
    closePreview: '关闭',
    cancel: '取消',
    ok: '确定',
    closedTitle: '编辑器已经在自己的标签页里',
    closedText: '这个页面无法自行关闭。请直接关掉该标签页，或回到 DeepSeek Harness 继续工作。',
    closedBack: '返回上一页',
    closedDismiss: '继续编辑',
    untitled: '未命名规则集',
    enabledAction: '停用',
    disabledAction: '启用',
    up: '上移',
    down: '下移',
    hasDraft: '有未保存草稿',
    untracked: '未纳入清单',
    emptyList: '还没有规则集。',
    created: title => `已新建「${title}」· 写下内容后点保存`,
    nameRequired: '名称不能为空',
    saved: (title, bytes) => `已保存「${title}」· ${bytes} 字节 · 下一个模型步生效`,
    savedConflict: '（另一处也已修改，已按本页内容覆盖）',
    discarded: '已放弃未保存的改动',
    removed: title => `已删除「${title}」· 下一个模型步生效`,
    enabledOn: id => `已启用「${id}」· 下一个模型步生效`,
    enabledOff: id => `已停用「${id}」· 下一个模型步生效`,
    orderUpdated: '顺序已更新 · 下一个模型步生效',
    scopeSwitched: '已切换范围 · 保存会作用于该范围',
    dialogDiscardTitle: '有未保存的改动',
    dialogDiscardText: what => `${what}会丢弃这些改动，继续吗？`,
    dialogDiscardOk: '丢弃并继续',
    dialogNewTitle: '新建规则集',
    dialogNewText: '名称用于在界面上区分；中文名称会得到一个自动生成的英文 id 作为文件名。',
    dialogNewInput: '新规则集',
    dialogCreateOk: '创建',
    dialogDeleteTitle: title => `删除规则集「${title}」？`,
    dialogDeleteText: path => `文件 ${path} 会被删除，此操作不可撤销。`,
    dialogDeleteOk: '删除',
    dialogWorkspaceTitle: '新增工作区规则',
    dialogWorkspaceText: '填入工作区的绝对路径（例如项目根目录）。该目录及其子目录里的会话都会叠加这些规则。',
    dialogWorkspaceInput: 'C:\\path\\to\\project',
    dialogWorkspaceOk: '创建',
    dialogWorkspaceDeleteTitle: title => `删除工作区「${title}」的规则？`,
    dialogWorkspaceDeleteText: path => `${path} 的规则目录会被整个删除，此操作不可撤销。`,
    switching: '切换规则集',
    reloading: '重新载入',
    creating: '新建规则集',
    removing: '删除规则集',
    closing: '关闭编辑器',
    previewEmpty: '（按当前草稿不会注入任何内容）',
    overBudget: '超出预算',
    joinedBy: '、',
    saveHint: '保存此规则集，下一个模型步生效',
    fatalTitle: '页面初始化失败',
    fatalHint: '请把下面这行信息反馈给插件作者；界面上的按钮在此状态下不可用。',
    errors: {
      connect: detail => `无法连接插件接口（${detail}）`,
      invalidResponse: '插件接口返回了无效响应',
      notJson: status => `接口返回了非 JSON 内容（HTTP ${status}）`,
      http: (status, statusText) => `HTTP ${status} ${statusText}`,
      action: detail => `操作失败：${detail}`,
      load: detail => `载入失败：${detail}`,
      copyDenied: '复制失败：浏览器拒绝了剪贴板访问',
      copied: '预览已复制到剪贴板',
      manifest: detail => `清单损坏：${detail}`,
      override: '规则来自配置里的 rulesFiles，本页改动不会生效',
      missing: ids => `页面元素缺失：${ids}`,
      badShape: '这个页面与已加载的插件版本不一致，请重启 DeepSeek Harness 后刷新',
    },
  },
  en: {
    title: 'Rule manager',
    loading: 'Loading…',
    loaded: count => `Loaded ${count} rule sets · ${new Date().toLocaleTimeString()}`,
    close: 'Close',
    reload: 'Reload',
    scopes: 'Scopes',
    scopeHint: 'Global rules apply everywhere; workspace rules layer on top, most specific wins.',
    scopesGlobal: 'Global',
    scopesGlobalHint: 'Every workspace',
    scopesWorkspace: 'Workspace',
    addWorkspace: '＋ Workspace',
    addWorkspaceHint: 'Add workspace rules for a directory',
    rulesets: 'Rule sets',
    rulesetHint: 'Concatenated in list order; disabled sets are not injected.',
    newRulesetHint: 'New rule set',
    storeRoot: 'Store',
    budget: 'Budget',
    effective: 'Injected',
    overrideNotice: 'rulesFiles is configured, so those files are injected instead; edits here have no effect.',
    emptyNotice: 'No rule sets in this scope yet. Use "+ New" to write the first one.',
    overrideBadge: 'overridden by rulesFiles',
    noRules: 'nothing injected',
    explicitFiles: count => `${count} explicit file(s)`,
    rulesetCount: (count, bytes) => `${count} rule set(s) · ${bytes} bytes`,
    name: 'Name',
    enabled: 'Enabled',
    enabledHint: 'Disabled sets are not injected',
    content: 'Content',
    bytes: n => `${n} bytes`,
    dirty: 'Unsaved changes',
    save: 'Save',
    discard: 'Discard',
    dryrun: 'Dry run',
    remove: 'Delete this rule set',
    preview: 'Dry run preview',
    previewHint: 'Exactly what the model sees on the next step (nothing written to disk).',
    copy: 'Copy',
    closePreview: 'Close',
    cancel: 'Cancel',
    ok: 'OK',
    closedTitle: 'This editor is in its own tab',
    closedText: 'The page cannot close itself. Close the tab, or switch back to DeepSeek Harness.',
    closedBack: 'Go back',
    closedDismiss: 'Keep editing',
    untitled: 'Untitled rule set',
    enabledAction: 'Disable',
    disabledAction: 'Enable',
    up: 'Move up',
    down: 'Move down',
    hasDraft: 'unsaved draft',
    untracked: 'untracked',
    emptyList: 'No rule sets yet.',
    created: title => `Created "${title}" · write the content, then save`,
    nameRequired: 'A name is required',
    saved: (title, bytes) => `Saved "${title}" · ${bytes} bytes · takes effect next step`,
    savedConflict: ' (also changed elsewhere; this page overwrote it)',
    discarded: 'Discarded the unsaved changes',
    removed: title => `Deleted "${title}" · takes effect next step`,
    enabledOn: id => `Enabled "${id}" · takes effect next step`,
    enabledOff: id => `Disabled "${id}" · takes effect next step`,
    orderUpdated: 'Order updated · takes effect next step',
    scopeSwitched: 'Scope switched · the next save applies there',
    dialogDiscardTitle: 'Unsaved changes',
    dialogDiscardText: what => `${what} will discard them. Continue?`,
    dialogDiscardOk: 'Discard and continue',
    dialogNewTitle: 'New rule set',
    dialogNewText: 'The name labels the set; a file id is derived from it automatically.',
    dialogNewInput: 'New rule set',
    dialogCreateOk: 'Create',
    dialogDeleteTitle: title => `Delete rule set "${title}"?`,
    dialogDeleteText: path => `${path} will be deleted. This cannot be undone.`,
    dialogDeleteOk: 'Delete',
    dialogWorkspaceTitle: 'Add workspace rules',
    dialogWorkspaceText: 'Enter the absolute path of a workspace directory. Sessions in it and below get these rules.',
    dialogWorkspaceInput: 'C:\\path\\to\\project',
    dialogWorkspaceOk: 'Create',
    dialogWorkspaceDeleteTitle: title => `Delete the rules for "${title}"?`,
    dialogWorkspaceDeleteText: path => `The whole rule directory for ${path} will be deleted. This cannot be undone.`,
    switching: 'Switching rule set',
    reloading: 'Reloading',
    creating: 'Creating a rule set',
    removing: 'Deleting a rule set',
    closing: 'Closing the editor',
    previewEmpty: '(the current draft injects nothing)',
    overBudget: 'over budget',
    joinedBy: ', ',
    fatalTitle: 'Page initialization failed',
    fatalHint: 'Report the line below to the plugin author; the controls are unavailable in this state.',
    errors: {
      connect: detail => `Cannot reach the plugin API (${detail})`,
      invalidResponse: 'The plugin API returned an invalid response',
      notJson: status => `The API returned non-JSON content (HTTP ${status})`,
      http: (status, statusText) => `HTTP ${status} ${statusText}`,
      action: detail => `Action failed: ${detail}`,
      load: detail => `Load failed: ${detail}`,
      copyDenied: 'Copy failed: the browser denied clipboard access',
      copied: 'Preview copied to the clipboard',
      manifest: detail => `Manifest is corrupt: ${detail}`,
      override: 'Rules come from the configured rulesFiles; edits here have no effect',
      missing: ids => `Page markup is missing element(s): ${ids}`,
      badShape: 'This page does not match the loaded plugin version. Restart DeepSeek Harness, then reload.',
    },
  },
}

/**
 * Pick the interface language.
 *
 * Three sources, in order:
 * 1. `?lang=` — set by the in-app overlay from the live DSH locale, so it tracks the
 *    locale even when the user changes it mid-session;
 * 2. `navigator.language` — the browser/Electron UI language, which is what both an
 *    ordinary browser visit and a plain in-app window load reflect;
 * 3. Chinese, the plugin's original language.
 *
 * Step 2 is what was missing. The document is served as a static asset, so it cannot
 * be localised on the server; without a query string the page had nothing to go on and
 * showed Chinese to an English user.
 *
 * @param queryLang - the `?lang=` value, when present.
 * @returns `'en'` or `'zh'`.
 */
function detectLanguage(queryLang) {
  if (typeof queryLang === 'string' && queryLang.length > 0) {
    return /^en\b/i.test(queryLang) ? 'en' : 'zh'
  }
  const candidates = [
    ...(Array.isArray(globalThis.navigator?.languages) ? globalThis.navigator.languages : []),
    globalThis.navigator?.language,
  ].filter(candidate => typeof candidate === 'string' && candidate.length > 0)
  // Any English variant selects English; anything else falls back to Chinese rather
  // than to a half-translated third state.
  return candidates.some(candidate => /^en\b/i.test(candidate)) ? 'en' : 'zh'
}

/** Query parameters, read once. */
const params = new URLSearchParams(globalThis.location?.search ?? '')
const LANG = detectLanguage(params.get('lang'))
const T = STRINGS[LANG]
const INITIAL_CWD = params.get('cwd') ?? ''
const EMBEDDED = params.get('embed') === '1'

/* ── elements ────────────────────────────────────────────────────────────── */

const el = id => document.getElementById(id)
const dom = {
  status: el('status'), storeDir: el('storeDir'), budget: el('budget'), effective: el('effective'),
  scopes: el('scopes'), list: el('list'),
  overrideNotice: el('overrideNotice'), emptyNotice: el('emptyNotice'), scopeBanner: el('scopeBanner'),
  title: el('title'), enabled: el('enabled'), content: el('content'), counter: el('counter'), dirty: el('dirty'),
  save: el('save'), discard: el('discard'), dryrun: el('dryrun'), remove: el('remove'),
  add: el('add'), addWorkspace: el('addWorkspace'), reload: el('reload'), close: el('close'),
  previewPanel: el('previewPanel'), preview: el('preview'), previewMeta: el('previewMeta'),
  closePreview: el('closePreview'), copyPreview: el('copyPreview'),
  modal: el('modal'), modalTitle: el('modalTitle'), modalText: el('modalText'),
  modalInput: el('modalInput'), modalOk: el('modalOk'), modalCancel: el('modalCancel'),
  closedHint: el('closedHint'), closedBack: el('closedBack'), closedDismiss: el('closedDismiss'),
}

/* ── state ───────────────────────────────────────────────────────────────── */

/** Host state as last read. */
let state = null
/** `{ scope: 'global' }` or `{ scope: 'workspace', path }` currently edited. */
let scope = { scope: 'global' }
/** The current scope's payload from the host. */
let scopeState = null
/** The rule set id the editor shows. */
let selectedId = null
/** `{ title, enabled, content }` — the unsaved draft, or null when clean. */
let draft = null
/** The revision the draft was based on, for conflict reporting. */
let baseRevision = null
/** Focus returns here when a dialog closes. */
let lastFocus = null

const byteLength = text => new TextEncoder().encode(String(text ?? '')).length
const scopeKey = value => (value.scope === 'global' ? 'global' : `workspace:${value.path ?? ''}`)

function setStatus(text, tone) {
  dom.status.textContent = text
  if (tone) dom.status.dataset.tone = tone
  else delete dom.status.dataset.tone
}

/** Apply the localized labels carried in the markup. */
function applyTranslations() {
  try {
    document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN'
    document.title = T.title
  } catch { /* a missing documentElement must not stop the page */ }
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = T[node.dataset.i18n]
    if (typeof value === 'string') node.textContent = value
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    const value = T[node.dataset.i18nTitle]
    if (typeof value === 'string') node.title = value
  }
}

/**
 * Fail loudly, once, if the markup and this script disagree.
 *
 * Every handler below dereferences an element, so a single missing id used to
 * surface as a dead button and a silent console error — the hardest kind of bug to
 * report. Naming the missing ids in the status line turns that into a message.
 */
function assertWiring() {
  const missing = Object.entries(dom).filter(([, element]) => element === null).map(([key]) => key)
  if (missing.length === 0) return
  console.error(`global-rules: page markup is missing element(s): ${missing.join(', ')}`)
  if (dom.status) {
    dom.status.textContent = T.errors.missing(missing.join(T.joinedBy))
    dom.status.dataset.tone = 'error'
  }
}

/* ── dialogs ─────────────────────────────────────────────────────────────── */

/**
 * Show the in-page dialog and resolve with the user's answer.
 * @param options - `{ title, text, ok, cancel, input }`; a defined `input` shows a text field.
 * @returns the entered string for an input dialog, `true` when confirmed, `false`/`null` when cancelled.
 */
function dialog(options = {}) {
  lastFocus = document.activeElement
  dom.modalTitle.textContent = options.title ?? ''
  dom.modalText.textContent = options.text ?? ''
  dom.modalOk.textContent = options.ok ?? T.ok
  dom.modalCancel.textContent = options.cancel ?? T.cancel
  const wantsInput = options.input !== undefined
  dom.modalInput.hidden = !wantsInput
  dom.modalInput.value = wantsInput ? String(options.input) : ''
  dom.modal.hidden = false
  if (wantsInput) {
    dom.modalInput.focus()
    dom.modalInput.select?.()
  } else {
    dom.modalOk.focus()
  }

  return new Promise((resolve) => {
    const finish = (value) => {
      dom.modal.hidden = true
      dom.modalOk.removeEventListener('click', onOk)
      dom.modalCancel.removeEventListener('click', onCancel)
      document.removeEventListener('keydown', onKey, true)
      try { lastFocus?.focus?.() } catch { /* focus is best effort */ }
      resolve(value)
    }
    const onOk = () => finish(wantsInput ? dom.modalInput.value : true)
    const onCancel = () => finish(wantsInput ? null : false)
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel() }
      else if (event.key === 'Enter' && wantsInput) { event.preventDefault(); onOk() }
    }
    dom.modalOk.addEventListener('click', onOk)
    dom.modalCancel.addEventListener('click', onCancel)
    document.addEventListener('keydown', onKey, true)
  })
}

const confirmDialog = (title, text, ok = T.ok) => dialog({ title, text, ok })

/* ── drafts ──────────────────────────────────────────────────────────────── */

/** Drafts are scoped, so the same id in two workspaces never collides. */
const draftKey = id => `${DRAFT_PREFIX}${scopeKey(scope)}::${id}`

function readStoredDraft(id) {
  try {
    const raw = globalThis.localStorage?.getItem(draftKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.content !== 'string') return null
    return { title: String(parsed.title ?? ''), enabled: parsed.enabled !== false, content: parsed.content }
  } catch {
    return null
  }
}

function writeStoredDraft(id, value) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(draftKey(id))
    else globalThis.localStorage?.setItem(draftKey(id), JSON.stringify(value))
  } catch { /* private mode or quota: the mirror is a convenience, not the record */ }
}

const currentRuleset = () => scopeState?.rulesets.find(entry => entry.id === selectedId) ?? null

function currentView() {
  const base = currentRuleset()
  if (!base) return null
  return draft ?? { title: base.title, enabled: base.enabled, content: base.content }
}

function isDirty() {
  const base = currentRuleset()
  if (!base || !draft) return false
  return draft.title !== base.title || draft.enabled !== base.enabled || draft.content !== base.content
}

const snapshotDraft = () => currentView() ?? { title: '', enabled: true, content: '' }

function syncStoredDraft() {
  if (selectedId === null) return
  if (isDirty()) writeStoredDraft(selectedId, draft)
  else writeStoredDraft(selectedId, null)
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function renderScopes() {
  dom.scopes.textContent = ''
  if (!state) return
  const entries = [
    { label: T.scopesGlobal, hint: T.scopesGlobalHint, value: { scope: 'global' } },
    ...state.workspaces.map(entry => ({
      label: entry.title,
      hint: entry.path,
      value: { scope: 'workspace', path: entry.path },
      workspace: entry,
    })),
  ]

  for (const entry of entries) {
    const li = document.createElement('li')
    li.className = 'item scope-item'
    li.dataset.active = String(scopeKey(entry.value) === scopeKey(scope))

    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('span')
    title.className = 'item-title'
    title.textContent = entry.label
    const sub = document.createElement('span')
    sub.className = 'item-sub'
    sub.textContent = typeof entry.hint === 'function' ? entry.hint() : entry.hint
    main.append(title, sub)
    if (entry.workspace) {
      const note = document.createElement('span')
      note.className = 'item-note'
      note.textContent = T.rulesetCount(entry.workspace.enabledCount, entry.workspace.bytes)
      main.append(note)
    }
    li.append(main)

    if (entry.workspace) {
      const actions = document.createElement('div')
      actions.className = 'item-actions'
      const remove = document.createElement('button')
      remove.className = 'btn small danger'
      remove.type = 'button'
      remove.textContent = '✕'
      remove.title = T.dialogWorkspaceDeleteTitle(entry.label)
      remove.addEventListener('click', (event) => {
        event.stopPropagation()
        void run(() => removeWorkspace(entry.workspace))
      })
      actions.append(remove)
      li.append(actions)
    }

    li.addEventListener('click', () => { void run(() => selectScope(entry.value)) })
    dom.scopes.append(li)
  }
}

function renderList() {
  dom.list.textContent = ''
  // Defensive on purpose: a rendering crash used to blank the page and leave every
  // control dead, which reads as "the plugin is broken" with no clue why.
  const rulesets = Array.isArray(scopeState?.rulesets) ? scopeState.rulesets : []
  if (rulesets.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'hint'
    empty.textContent = T.emptyList
    dom.list.append(empty)
    return
  }
  rulesets.forEach((entry, index) => {
    const li = document.createElement('li')
    li.className = 'item'
    li.dataset.enabled = String(entry.enabled)
    if (entry.id === selectedId) li.setAttribute('aria-current', 'true')

    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('span')
    title.className = 'item-title'
    title.textContent = entry.title
    const sub = document.createElement('span')
    sub.className = 'item-sub'
    sub.textContent = `${T.bytes(entry.bytes)}${entry.untracked ? ` · ${T.untracked}` : ''}`
    main.append(title, sub)
    if (readStoredDraft(entry.id)) {
      const note = document.createElement('span')
      note.className = 'item-note'
      note.textContent = T.hasDraft
      main.append(note)
    }

    const actions = document.createElement('div')
    actions.className = 'item-actions'
    const toggle = document.createElement('button')
    toggle.className = 'btn small'
    toggle.type = 'button'
    toggle.textContent = entry.enabled ? T.enabledAction : T.disabledAction
    toggle.addEventListener('click', (event) => { event.stopPropagation(); void run(() => setEnabled(entry.id, !entry.enabled)) })
    const up = document.createElement('button')
    up.className = 'btn small'
    up.type = 'button'
    up.textContent = '↑'
    up.title = T.up
    up.disabled = index === 0
    up.addEventListener('click', (event) => { event.stopPropagation(); void run(() => move(entry.id, 'up')) })
    const down = document.createElement('button')
    down.className = 'btn small'
    down.type = 'button'
    down.textContent = '↓'
    down.title = T.down
    down.disabled = index === rulesets.length - 1
    down.addEventListener('click', (event) => { event.stopPropagation(); void run(() => move(entry.id, 'down')) })
    actions.append(toggle, up, down)

    li.append(main, actions)
    li.addEventListener('click', () => { void run(() => select(entry.id)) })
    dom.list.append(li)
  })
}

function renderEditor() {
  const view = currentView()
  const hasSelection = view !== null
  if (hasSelection) {
    dom.title.value = view.title
    dom.enabled.checked = view.enabled
    if (dom.content.value !== view.content) dom.content.value = view.content
  } else {
    dom.title.value = ''
    dom.enabled.checked = false
    dom.content.value = ''
  }
  for (const control of [dom.title, dom.enabled, dom.content]) control.disabled = !hasSelection
  dom.remove.disabled = !hasSelection
  dom.dryrun.disabled = !hasSelection
  // Closing, reloading, and creating stay available with nothing selected: a
  // dead-end page with no way out is exactly the failure this guards against.
  dom.close.disabled = false
  dom.reload.disabled = false
  dom.add.disabled = false
  dom.addWorkspace.disabled = false
  dom.emptyNotice.hidden = hasSelection
  renderDirty()
}

function renderDirty() {
  const dirty = isDirty()
  dom.dirty.hidden = !dirty
  dom.save.disabled = selectedId === null
  dom.discard.disabled = !dirty
  dom.counter.textContent = T.bytes(byteLength(snapshotDraft().content))
  dom.save.title = selectedId === null ? T.saveHint : ''
}

function renderMeta() {
  if (!state) return
  dom.storeDir.textContent = state.storeRoot
  dom.storeDir.title = scopeState?.storeDirectory ?? state.storeRoot
  const enabledSets = (Array.isArray(scopeState?.rulesets) ? scopeState.rulesets : []).filter(entry => entry.enabled)
  dom.budget.textContent = state.ignoredBecauseOverride
    ? T.overrideBadge
    : T.bytes(state.maxBytes)
  dom.effective.textContent = state.ignoredBecauseOverride
    ? T.explicitFiles(state.effective.length)
    : (enabledSets.length === 0
      ? T.noRules
      : T.rulesetCount(enabledSets.length, enabledSets.reduce((sum, entry) => sum + entry.bytes, 0)))

  dom.overrideNotice.hidden = !state.ignoredBecauseOverride
  if (state.manifestError) setStatus(T.errors.manifest(state.manifestError), 'error')
  else if (state.ignoredBecauseOverride) setStatus(T.errors.override, 'warn')

  // Name the scope being edited; a workspace says which directory it covers.
  if (scope.scope === 'workspace') {
    dom.scopeBanner.hidden = false
    dom.scopeBanner.textContent = `${T.scopesWorkspace}: ${scope.path}`
  } else {
    dom.scopeBanner.hidden = true
    dom.scopeBanner.textContent = ''
  }
}

/* ── API ─────────────────────────────────────────────────────────────────── */

async function api(path, options = {}) {
  const url = new URL(`${API}${path}`, globalThis.location?.href ?? 'http://127.0.0.1/')
  url.searchParams.set('lang', LANG)
  if (options.scope) {
    url.searchParams.set('scope', options.scope.scope)
    if (options.scope.path) url.searchParams.set('path', options.scope.path)
  }
  if (options.cwd) url.searchParams.set('cwd', options.cwd)

  let response
  try {
    // `fetch` is called through a resolved reference on purpose: a stubbed or
    // hostile fetch can throw synchronously, and inside an async function that
    // would reject past this try/catch and surface as an unhandled rejection
    // instead of the actionable status message below.
    const request = globalThis.fetch
    response = await Promise.resolve(request(url.href, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }))
  } catch (error) {
    throw new Error(T.errors.connect(error instanceof Error ? error.message : String(error)))
  }
  if (!response || typeof response.text !== 'function') throw new Error(T.errors.invalidResponse)
  const text = await response.text()
  let payload = {}
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error(T.errors.notJson(response.status))
    }
  }
  if (!response.ok) throw new Error(payload.error ?? T.errors.http(response.status, response.statusText))
  return payload
}

/**
 * Normalize a scope payload from the host.
 *
 * The page and the host plugin are installed separately: a host that has not been
 * restarted yet still answers with the previous shape. Rather than throwing
 * "cannot read properties of undefined" at the user, accept every shape this page
 * has ever seen and fill in what is missing. A payload with no rule sets at all is
 * a real mismatch, and it is reported as one.
 *
 * @param payload - whatever the host returned.
 * @param what - a label for the error message.
 * @returns a usable scope payload.
 */
function normalizeScope(payload, what) {
  const candidates = [payload, payload?.global, payload?.state, payload?.state?.global]
  const found = candidates.find(entry => Array.isArray(entry?.rulesets))
  if (!found) {
    throw new Error(`${what}: ${T.errors.badShape}`)
  }
  return {
    ...found,
    scope: found.scope ?? (found === payload ? 'global' : scope.scope),
    rulesets: found.rulesets,
    revision: found.revision ?? null,
    workspacePath: found.workspacePath ?? null,
    storeDirectory: found.storeDirectory ?? state?.storeRoot ?? '',
    manifestError: found.manifestError ?? null,
    defaultTitle: found.defaultTitle ?? T.untitled,
  }
}

/** Run an action, reporting any failure in the status line instead of dying. */
async function run(action) {
  try {
    return await action()
  } catch (error) {
    setStatus(T.errors.action(error instanceof Error ? error.message : String(error)), 'error')
    return undefined
  }
}

/** Adopt a fresh host state plus the scope payload it belongs to. */
function applyState(next, nextScopeState) {
  state = next
  scopeState = normalizeScope(nextScopeState ?? next, 'state')
  if (selectedId !== null && !scopeState.rulesets.some(entry => entry.id === selectedId)) selectedId = null
  if (selectedId === null && scopeState.rulesets.length > 0) selectedId = scopeState.rulesets[0].id
  draft = selectedId === null ? null : readStoredDraft(selectedId)
  baseRevision = scopeState.revision ?? null
  renderScopes()
  renderList()
  renderEditor()
  renderMeta()
}

async function load() {
  const payload = await api('/state', { cwd: INITIAL_CWD })
  const fallbackScope = normalizeScope(payload, 'state')
  const initial = payload.activeWorkspacePath
    ? { scope: 'workspace', path: payload.activeWorkspacePath }
    : { scope: 'global' }
  scope = initial
  const scoped = initial.scope === 'workspace'
    ? await api('/scope', { scope: initial })
      .then(response => normalizeScope(response, 'scope'))
      .catch(() => fallbackScope)
    : fallbackScope
  selectedId = null
  applyState(payload, scoped)
  setStatus(T.loaded(scopeState.rulesets.length), 'ok')
}

/* ── actions ─────────────────────────────────────────────────────────────── */

async function confirmDiscard(what) {
  if (!isDirty()) return true
  return confirmDialog(T.dialogDiscardTitle, T.dialogDiscardText(what), T.dialogDiscardOk)
}

/** Re-read the current scope's payload, keeping the selection when it still exists. */
async function refreshScope() {
  const fresh = await api('/scope', { scope })
  const keep = selectedId
  scopeState = normalizeScope(fresh, 'scope')
  if (keep !== null && fresh.rulesets.some(entry => entry.id === keep)) selectedId = keep
  else if (!fresh.rulesets.some(entry => entry.id === selectedId)) selectedId = fresh.rulesets[0]?.id ?? null
  if (!isDirty()) draft = selectedId === null ? null : readStoredDraft(selectedId)
  baseRevision = fresh.revision ?? null
  renderList(); renderEditor(); renderMeta()
  return fresh
}

async function selectScope(next) {
  if (scopeKey(next) === scopeKey(scope)) return
  if (!(await confirmDiscard(T.scopeSwitched))) return
  syncStoredDraft()
  scope = next
  selectedId = null
  draft = null
  scopeState = normalizeScope(await api('/scope', { scope }), 'scope')
  if (scopeState.rulesets.length > 0) selectedId = scopeState.rulesets[0].id
  draft = selectedId === null ? null : readStoredDraft(selectedId)
  baseRevision = scopeState.revision ?? null
  renderScopes(); renderList(); renderEditor(); renderMeta()
  setStatus(T.scopeSwitched, 'ok')
}

async function select(id) {
  if (id === selectedId) return
  if (!(await confirmDiscard(T.switching))) return
  syncStoredDraft()
  selectedId = id
  draft = readStoredDraft(id)
  renderList(); renderEditor()
}

async function setEnabled(id, enabled) {
  const payload = await api('/manifest', { method: 'PATCH', body: { id, enabled }, scope })
  const keepSelection = selectedId
  const keepDraft = draft
  applyState(payload.state, payload.scopeState)
  selectedId = keepSelection
  draft = keepDraft
  renderList(); renderEditor()
  setStatus(enabled ? T.enabledOn(id) : T.enabledOff(id), 'ok')
}

async function move(id, direction) {
  const payload = await api('/manifest', { method: 'PATCH', body: { id, move: direction }, scope })
  const keepSelection = selectedId
  const keepDraft = draft
  applyState(payload.state, payload.scopeState)
  selectedId = keepSelection
  draft = keepDraft
  renderList(); renderEditor()
  setStatus(T.orderUpdated, 'ok')
}

async function save() {
  if (selectedId === null) return
  const id = selectedId
  const view = snapshotDraft()
  dom.save.disabled = true
  const result = await api(`/ruleset?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { content: view.content, title: view.title, enabled: view.enabled, baseRevision },
    scope,
  })
  writeStoredDraft(id, null)
  draft = null
  applyState(result.state, result.scopeState)
  if (result.scopeState.rulesets.some(entry => entry.id === id)) selectedId = id
  draft = null
  renderList(); renderEditor(); renderMeta()
  const conflict = result.conflict === true ? T.savedConflict : ''
  setStatus(`${T.saved(view.title, result.bytes)}${conflict}`, 'ok')
}

function discard() {
  if (selectedId !== null) writeStoredDraft(selectedId, null)
  draft = null
  renderEditor(); renderList()
  setStatus(T.discarded, 'ok')
}

async function dryRun() {
  if (selectedId === null) return
  const view = snapshotDraft()
  const rulesets = scopeState.rulesets.map(entry => entry.id === selectedId
    ? { id: entry.id, title: view.title, enabled: view.enabled, content: view.content, scope: scope.scope }
    : { id: entry.id, title: entry.title, enabled: entry.enabled, content: entry.content, scope: scope.scope })
  const payload = await api('/preview', { method: 'POST', body: { rulesets }, cwd: INITIAL_CWD })
  dom.preview.textContent = payload.text.length > 0 ? payload.text : T.previewEmpty
  const parts = [`${payload.bytes} / ${payload.budgetBytes}`]
  if (payload.overBudget) parts.push(T.overBudget)
  if (payload.omitted.length > 0) parts.push(...payload.omitted)
  dom.previewMeta.textContent = parts.join(' · ')
  dom.previewPanel.hidden = false
  dom.previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function create() {
  if (!(await confirmDiscard(T.creating))) return
  const name = await dialog({
    title: T.dialogNewTitle,
    text: T.dialogNewText,
    input: T.dialogNewInput,
    ok: T.dialogCreateOk,
  })
  if (name === null) return
  const trimmed = String(name).trim()
  if (trimmed.length === 0) {
    setStatus(T.nameRequired, 'warn')
    return
  }
  const payload = await api('/create', { method: 'POST', body: { title: trimmed }, scope })
  // The response carries the whole host state; the current scope's payload comes
  // from the API so the list matches the scope the user is editing.
  state = payload.state
  scopeState = normalizeScope(await api('/scope', { scope }), 'scope')
  selectedId = payload.id
  draft = null
  renderScopes(); renderList(); renderEditor(); renderMeta()
  setStatus(T.created(trimmed), 'ok')
  dom.content.focus()
}

async function remove() {
  const base = currentRuleset()
  if (!base) return
  const ok = await confirmDialog(T.dialogDeleteTitle(base.title), T.dialogDeleteText(base.path), T.dialogDeleteOk)
  if (!ok) return
  const payload = await api('/delete', { method: 'POST', body: { id: base.id }, scope })
  writeStoredDraft(base.id, null)
  // Drop the selection before refreshing so `applyState` picks the next available
  // rule set; rendering directly here is what once left the page with no selection.
  selectedId = null
  draft = null
  state = payload.state
  scopeState = normalizeScope(await api('/scope', { scope }), 'scope')
  applyState(state, scopeState)
  setStatus(T.removed(base.title), 'ok')
}

async function addWorkspace() {
  if (!(await confirmDiscard(T.creating))) return
  const path = await dialog({
    title: T.dialogWorkspaceTitle,
    text: T.dialogWorkspaceText,
    input: INITIAL_CWD || T.dialogWorkspaceInput,
    ok: T.dialogWorkspaceOk,
  })
  if (path === null) return
  const trimmed = String(path).trim()
  if (trimmed.length === 0) return
  const created = await api('/scope', {
    method: 'POST',
    scope: { scope: 'workspace', path: trimmed },
    cwd: INITIAL_CWD,
  })
  scope = { scope: 'workspace', path: created.workspacePath }
  selectedId = null
  draft = null
  state = await api('/state', { cwd: INITIAL_CWD })
  scopeState = normalizeScope(await api('/scope', { scope }), 'scope')
  if (scopeState.rulesets.length > 0) selectedId = scopeState.rulesets[0].id
  draft = selectedId === null ? null : readStoredDraft(selectedId)
  baseRevision = scopeState.revision ?? null
  renderScopes(); renderList(); renderEditor(); renderMeta()
  setStatus(T.scopeSwitched, 'ok')
}

async function removeWorkspace(workspace) {
  const ok = await confirmDialog(
    T.dialogWorkspaceDeleteTitle(workspace.title),
    T.dialogWorkspaceDeleteText(workspace.path),
    T.dialogDeleteOk,
  )
  if (!ok) return
  const payload = await api('/scope', {
    method: 'DELETE',
    scope: { scope: 'workspace', path: workspace.path },
    cwd: INITIAL_CWD,
  })
  if (scopeKey(scope) === `workspace:${workspace.path}`) {
    scope = { scope: 'global' }
    selectedId = null
    draft = null
  }
  state = payload.state
  scopeState = normalizeScope(scope.scope === 'global' ? payload.state : await api('/scope', { scope }), 'scope')
  renderScopes(); renderList(); renderEditor(); renderMeta()
  setStatus(T.removed(workspace.title), 'ok')
}

/**
 * Leave the editor — without ever closing the application window.
 *
 * Three cases, in order of what is safe:
 * 1. Embedded in the in-app overlay: ask the parent to dismiss the overlay.
 * 2. A window this script opened (`window.opener` is set): `close()` is allowed.
 * 3. Anything else — including the desktop app's own window: explain instead.
 *    Calling `close()` here would terminate DSH, which is the defect this replaces.
 */
async function closeEditor() {
  if (!(await confirmDiscard(T.closing))) return
  syncStoredDraft()

  if (EMBEDDED || globalThis.self !== globalThis.top) {
    try {
      globalThis.parent?.postMessage?.({ type: CLOSE_MESSAGE }, globalThis.location?.origin ?? '*')
      return
    } catch { /* fall through to the hint */ }
  }

  if (globalThis.opener) {
    try { globalThis.window?.close?.() } catch { /* treat as refused */ }
    await new Promise(resolve => globalThis.setTimeout(resolve, 120))
  }
  dom.closedHint.hidden = false
  try { dom.closedDismiss?.focus?.() } catch { /* focus is best effort */ }
}

/* ── wiring ──────────────────────────────────────────────────────────────── */

function bindEditor() {
  dom.title.addEventListener('input', () => {
    if (selectedId === null) return
    draft = { ...snapshotDraft(), title: dom.title.value }
    syncStoredDraft(); renderDirty(); renderList()
  })
  dom.enabled.addEventListener('change', () => {
    if (selectedId === null) return
    draft = { ...snapshotDraft(), enabled: dom.enabled.checked }
    syncStoredDraft(); renderDirty(); renderList()
  })
  dom.content.addEventListener('input', () => {
    if (selectedId === null) return
    draft = { ...snapshotDraft(), content: dom.content.value }
    syncStoredDraft(); renderDirty(); renderList()
  })

  dom.save.addEventListener('click', () => { void run(save) })
  dom.discard.addEventListener('click', discard)
  dom.dryrun.addEventListener('click', () => { void run(dryRun) })
  dom.add.addEventListener('click', () => { void run(create) })
  dom.addWorkspace.addEventListener('click', () => { void run(addWorkspace) })
  dom.remove.addEventListener('click', () => { void run(remove) })
  dom.close.addEventListener('click', () => { void run(closeEditor) })
  dom.reload.addEventListener('click', () => { void run(async () => {
    if (!(await confirmDiscard(T.reloading))) return
    await load()
  }) })
  dom.closePreview.addEventListener('click', () => { dom.previewPanel.hidden = true })
  dom.copyPreview.addEventListener('click', () => { void run(async () => {
    try {
      await globalThis.navigator?.clipboard?.writeText(dom.preview.textContent ?? '')
      setStatus(T.errors.copied, 'ok')
    } catch {
      setStatus(T.errors.copyDenied, 'warn')
    }
  }) })

  dom.closedBack.addEventListener('click', () => {
    dom.closedHint.hidden = true
    try { globalThis.history?.back?.() } catch { /* nothing else to do */ }
  })
  dom.closedDismiss.addEventListener('click', () => { dom.closedHint.hidden = true })

  globalThis.addEventListener?.('beforeunload', (event) => {
    if (!isDirty()) return
    syncStoredDraft()
    event.preventDefault()
    event.returnValue = ''
  })

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void run(save)
      return
    }
    if (event.key !== 'Escape' || !dom.modal.hidden) return
    const typing = event.target === dom.content || event.target === dom.title
    if (!dom.previewPanel.hidden) dom.previewPanel.hidden = true
    else if (!typing) void run(closeEditor)
  })
}

/** Mark the page as running inside the desktop app, whose window controls own the top-right corner. */
function detectHost() {
  try {
    if (/electron/i.test(String(globalThis.navigator?.userAgent ?? ''))) document.body.dataset.host = 'desktop'
  } catch { /* the default layout is fine */ }
}

/* ── entry point ─────────────────────────────────────────────────────────── */

/**
 * Start the page, and leave a readable trace if it cannot start.
 *
 * A page that fails during setup previously left the user with controls that
 * silently did nothing. Naming the failure in the status line is the difference
 * between a reportable bug and a mystery.
 */
async function start() {
  applyTranslations()
  assertWiring()
  detectHost()
  bindEditor()
  await run(load)
}

void start()
