// The editor page is a static asset, so nothing imports it. These cases evaluate
// web/app.js against a minimal DOM shim and a fetch backed by the real API
// handlers, which exercises the page's own logic: loading, editing, saving,
// previewing, in-page dialogs, and the exit paths.
//
// They are regression tests for the defects found in real use:
// - the page had no way to close itself, and a refused window.close() was silent;
// - deleting a rule set could leave the user with nothing selected and no exit;
// - the page's own controls sat under the desktop window's minimize/close corner.
//
// Every case prints its name first and carries a deadline, so a case that waits on
// a promise the page never resolves fails by name instead of stalling the file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { ROUTE_PREFIX, registerRoutes } from '../lib/api.js'
import { resolveConfig } from '../lib/rules.js'
import { writeManifest, writeRuleset } from '../lib/store.js'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const appSource = readFileSync(join(here, 'web', 'app.js'), 'utf8')
const htmlSource = readFileSync(join(here, 'web', 'index.html'), 'utf8')
const cssSource = readFileSync(join(here, 'web', 'app.css'), 'utf8')

let caseNumber = 0
function testCase(name, body) {
  caseNumber += 1
  const label = `[${String(caseNumber).padStart(2, '0')}] ${name}`
  return test(label, { timeout: 10_000 }, async () => {
    process.stderr.write(`  ... ${label}\n`)
    await body()
  })
}

/* ── DOM shim ────────────────────────────────────────────────────────────── */

/** Elements that carry `hidden` in index.html must start hidden here too. */
const HIDDEN_BY_DEFAULT = ['modal', 'closedHint', 'overrideNotice', 'emptyNotice', 'previewPanel', 'dirty']

const IDS = [
  'status', 'list', 'storeDir', 'budget', 'effective', 'applied',
  'overrideNotice', 'emptyNotice',
  'title', 'enabled', 'content', 'counter', 'dirty',
  'save', 'discard', 'dryrun', 'remove', 'add', 'reload', 'close',
  'previewPanel', 'preview', 'previewMeta', 'closePreview', 'copyPreview',
  'modal', 'modalTitle', 'modalText', 'modalInput', 'modalOk', 'modalCancel',
  'closedHint', 'closedBack', 'closedDismiss',
]

function makePage() {
  const elements = new Map()

  const makeElement = (id, tag = 'div') => {
    const own = new Map()
    const element = {
      tagName: String(tag).toUpperCase(),
      id,
      children: [],
      dataset: {},
      style: {},
      hidden: false,
      disabled: false,
      checked: false,
      value: '',
      textContent: '',
      className: '',
      attributes: {},
      classList: { add() {}, remove() {} },
      append(...nodes) { element.children.push(...nodes) },
      appendChild(node) { element.children.push(node); return node },
      addEventListener(type, handler) {
        if (!own.has(type)) own.set(type, [])
        own.get(type).push(handler)
      },
      removeEventListener(type, handler) {
        const list = own.get(type)
        if (list) own.set(type, list.filter(entry => entry !== handler))
      },
      setAttribute(name, value) { element.attributes[name] = String(value) },
      getAttribute(name) { return element.attributes[name] ?? null },
      focus() {},
      select() {},
      scrollIntoView() {},
      click() {
        for (const handler of [...(own.get('click') ?? [])]) {
          handler({ target: element, preventDefault() {}, stopPropagation() {} })
        }
      },
      dispatch(type, event = {}) {
        for (const handler of [...(own.get(type) ?? [])]) {
          handler({ target: element, preventDefault() {}, stopPropagation() {}, ...event })
        }
      },
      handlers: type => (own.get(type) ?? []).length,
    }
    return element
  }

  const documentListeners = new Map()
  const document = {
    activeElement: null,
    body: { dataset: {} },
    documentElement: { lang: '' },
    title: '',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id))
      return elements.get(id)
    },
    createElement: tag => makeElement('', tag),
    /** The page localizes itself by walking `[data-i18n]`; the shim has no markup. */
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, [])
      documentListeners.get(type).push(handler)
    },
    removeEventListener(type, handler) {
      const list = documentListeners.get(type)
      if (list) documentListeners.set(type, list.filter(entry => entry !== handler))
    },
    dispatch(type, event = {}) {
      for (const handler of [...(documentListeners.get(type) ?? [])]) {
        handler({ preventDefault() {}, stopPropagation() {}, target: null, ...event })
      }
    },
  }

  for (const id of IDS) document.getElementById(id)
  for (const id of HIDDEN_BY_DEFAULT) document.getElementById(id).hidden = true

  return document
}

/* ── API bridge ──────────────────────────────────────────────────────────── */

function makeServer() {
  const routes = []
  return {
    service: { register: route => { routes.push(route); return () => {} } },
    find(path) {
      const exact = routes.find(route => route.kind === 'exact' && route.path === path)
      if (exact) return exact
      return routes
        .filter(route => route.kind === 'prefix' && path.startsWith(route.path))
        .sort((a, b) => b.path.length - a.path.length)[0]
    },
  }
}

/** A fetch that answers from the real route handlers. */
function makeFetch(server, options = {}) {
  const prefix = `${ROUTE_PREFIX}/api`
  return async (input, init = {}) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const path = url.pathname.startsWith(prefix) ? url.pathname : `${prefix}${url.pathname}`
    const route = server.find(path)
    if (!route) throw new Error(`no route for ${path}`)
    const payload = init.body === undefined ? '' : init.body
    const request = Readable.from(payload.length > 0 ? [Buffer.from(payload, 'utf8')] : [])
    Object.assign(request, {
      method: init.method ?? 'GET',
      url: `${path}${url.search}`,
      headers: init.headers ?? {},
      socket: { remoteAddress: '127.0.0.1' },
    })
    let finish
    const answered = new Promise(resolve => { finish = resolve })
    const response = {
      status: 0,
      body: '',
      writeHead(status) { response.status = status },
      end(chunk) { response.body += chunk === undefined ? '' : String(chunk); finish(response) },
    }
    await route.handler(request, response)
    const settled = await answered
    let body = settled.body
    if (options.stripGlobal === true && settled.status < 300 && body.length > 0) {
      // Impersonate a host that predates the scope feature: the response has the
      // rule sets at the top level and no nested `global`.
      try {
        const parsed = JSON.parse(body)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          delete parsed.global
          if (parsed.state && typeof parsed.state === 'object') delete parsed.state.global
          body = JSON.stringify(parsed)
        }
      } catch { /* a non-JSON body passes through untouched */ }
    }
    return {
      ok: settled.status >= 200 && settled.status < 300,
      status: settled.status,
      statusText: '',
      text: async () => body,
    }
  }
}

function makeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    size: () => map.size,
  }
}

/* ── fixture ─────────────────────────────────────────────────────────────── */

const TWO_RULESETS = [
  { id: 'global', title: '全局规则', content: '# 全局规则\n- 始终使用简体中文回答。' },
  { id: 'style', title: '代码风格', content: '# 代码风格\n- 遵循项目已有风格。' },
]

/** A fresh copy each time, so a case that mutates one cannot leak into the next. */
const makeTwoRulesets = () => TWO_RULESETS.map(entry => ({ ...entry }))

function mount(rulesets = makeTwoRulesets(), options = {}) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'gr-web-'))
  const config = resolveConfig({ dshHome: home })
  rulesets.forEach(entry => writeRuleset(config, entry.id, entry.content))
  writeManifest(config, rulesets.map((entry, index) => ({
    id: entry.id,
    title: entry.title,
    enabled: entry.enabled !== false,
    order: index,
  })))

  const server = makeServer()
  registerRoutes(
    { get: () => server.service, effect: factory => { factory(); return () => {} } },
    { config, invalidate: () => {}, snapshot: () => ({ bytes: 0, sources: [] }) },
  )
  const bridgeFetch = makeFetch(server, { stripGlobal: options.stripGlobal === true })

  const document = makePage()
  const storage = options.storage ?? makeStorage()
  const closes = []
  const posts = []
  // `lang: null` models a page opened with no query string, which is exactly the case
  // where the browser language has to decide.
  const langQuery = options.lang === null ? '' : `?lang=${options.lang ?? 'zh'}`
  const embedQuery = options.embedded ? `${langQuery.length > 0 ? '&' : '?'}embed=1` : ''
  const fakeWindow = {
    addEventListener: () => {},
    setTimeout: fn => { fn(); return 0 },
    close: () => { if (options.closeWorks !== false) closes.push(true) },
    history: { back: () => {} },
    navigator: {
      userAgent: options.userAgent ?? '',
      language: options.navigatorLanguage ?? 'zh-CN',
      languages: options.navigatorLanguages,
      clipboard: { writeText: async () => {} },
    },
    localStorage: storage,
    location: {
      href: `http://127.0.0.1:19387/rules${langQuery}${embedQuery}`,
      search: `${langQuery}${embedQuery}`,
      origin: 'http://127.0.0.1:19387',
    },
    parent: { postMessage: (message) => { posts.push(message) } },
    // A window this script opened has an opener; the desktop window does not.
    opener: options.openedByScript === true ? {} : null,
    /** Embedded mode is detected as `self !== top`; the desktop window has them equal. */
    self: { name: 'self' },
    top: options.embedded ? { name: 'top' } : undefined,
  }
  fakeWindow.top = options.embedded ? fakeWindow.top : fakeWindow.self
  // The page resolves its own globals through `globalThis`, and reaches the window
  // as `globalThis.window`; without these the fake global would silently no-op.
  fakeWindow.window = fakeWindow
  fakeWindow.fetch = bridgeFetch

  const api = new Function(
    'document', 'window', 'globalThis', 'fetch', 'TextEncoder', 'setTimeout', 'URLSearchParams',
    `${appSource}
     return { load, save, select, create, remove, dryRun, discard, closeEditor, addWorkspace, removeWorkspace,
              isDirty, state: () => state, scope: () => scope, scopeState: () => scopeState,
              selected: () => selectedId, run }`,
  )(document, fakeWindow, fakeWindow, bridgeFetch, TextEncoder, fakeWindow.setTimeout, URLSearchParams)

  const element = id => document.getElementById(id)
  const flush = async (rounds = 6) => {
    for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve))
  }

  return {
    home, config, api, flush, element, storage, closes, posts,
    dialogVisible: () => element('modal').hidden === false,
    dialogText: () => element('modalText').textContent,
    dialogTitle: () => element('modalTitle').textContent,
    dialogInput: value => { element('modalInput').value = value },
    clickOk: () => element('modalOk').click(),
    clickCancel: () => element('modalCancel').click(),
    hintVisible: () => element('closedHint').hidden === false,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

/* ── markup contract ─────────────────────────────────────────────────────── */

testCase('the markup carries an exit control, an in-page dialog, and no native dialog', () => {
  assert.match(htmlSource, /id="close"/, 'an explicit exit control is required')
  assert.match(htmlSource, /id="modal"/, 'dialogs must be in-page, not native')
  assert.match(htmlSource, /id="closedHint"/, 'a refused window.close() needs an explanation')
  assert.doesNotMatch(appSource, /window\.confirm\(/)
  assert.doesNotMatch(appSource, /window\.prompt\(/)
})

testCase('nothing interactive occupies the window-control corner', () => {
  assert.match(cssSource, /body\[data-host="desktop"\] \.topbar \{[^}]*padding-right:\s*168px/)
  assert.match(cssSource, /-webkit-app-region: no-drag/)
})

/* ── loading and editing ─────────────────────────────────────────────────── */

testCase('the page loads state, renders the list, and shows the first rule set', async () => {
  const f = mount()
  try {
    await f.flush()
    assert.match(f.element('status').textContent, /已载入 2 个规则集/)
    assert.equal(f.api.selected(), 'global')
    assert.equal(f.element('title').value, '全局规则')
    assert.match(f.element('content').value, /始终使用简体中文回答/)
    assert.equal(f.element('budget').textContent, '32768 字节')
    assert.match(f.element('effective').textContent, /2 个规则集/)

    const list = f.element('list')
    assert.equal(list.children.length, 2)
    assert.equal(list.children[0].children[0].children[0].textContent, '全局规则')
    assert.equal(f.element('emptyNotice').hidden, true)
    assert.equal(f.element('overrideNotice').hidden, true)
  } finally {
    f.cleanup()
  }
})

testCase('an empty store keeps every exit and creation control alive', async () => {
  const f = mount([])
  try {
    await f.flush()
    assert.equal(f.api.selected(), null)
    assert.equal(f.element('emptyNotice').hidden, false)
    for (const id of ['close', 'reload', 'add']) {
      assert.equal(f.element(id).disabled, false, `${id} must stay usable`)
    }
    assert.equal(f.element('remove').disabled, true)
    assert.equal(f.element('dryrun').disabled, true)
    assert.equal(f.element('content').disabled, true)
    await f.api.closeEditor()
    assert.equal(f.hintVisible(), true, 'closing with no selection must still leave the page')
  } finally {
    f.cleanup()
  }
})

testCase('editing marks the draft dirty and discard restores it', async () => {
  const f = mount()
  try {
    await f.flush()
    assert.equal(f.element('dirty').hidden, true)
    f.element('content').value = '# 改过的规则'
    f.element('content').dispatch('input')
    assert.equal(f.api.isDirty(), true, 'the page must consider the draft dirty')
    assert.equal(f.element('dirty').hidden, false)
    assert.equal(f.element('discard').disabled, false)

    f.api.discard()
    assert.equal(f.api.isDirty(), false)
    assert.equal(f.element('dirty').hidden, true)
    assert.match(f.element('content').value, /始终使用简体中文回答/)
  } finally {
    f.cleanup()
  }
})

testCase('save writes the draft, clears the dirty flag, and keeps a rename and toggle', async () => {
  const f = mount()
  try {
    await f.flush()
    f.element('content').value = '# 保存测试\n- 一二三'
    f.element('content').dispatch('input')
    f.element('title').value = '新名字'
    f.element('title').dispatch('input')
    await f.api.save()
    await f.flush()

    assert.equal(f.api.isDirty(), false)
    assert.equal(f.element('dirty').hidden, true)
    assert.match(f.element('status').textContent, /已保存/)
    assert.equal(readFileSync(join(f.config.storeDirectory, 'global.md'), 'utf8'), '# 保存测试\n- 一二三')
    assert.equal(f.api.state().global.rulesets.find(entry => entry.id === 'global').title, '新名字')
  } finally {
    f.cleanup()
  }
})

testCase('a draft survives reopening the editor', async () => {
  const storage = makeStorage()
  const home = mkdtempSync(join(tmpdir(), 'gr-web-'))
  const first = mount(makeTwoRulesets(), { storage, home })
  try {
    await first.flush()
    first.element('content').value = '半途而废的内容'
    first.element('content').dispatch('input')
    assert.ok(storage.size() > 0, 'the draft must be mirrored')
  } finally {
    first.cleanup()
  }

  // A second instance over the same store and the same storage: a page reload.
  const second = mount(makeTwoRulesets(), { storage, home })
  try {
    await second.flush()
    assert.equal(second.api.isDirty(), true, 'the reopened editor must show the draft')
    assert.equal(second.element('content').value, '半途而废的内容')
    // The list marks the rule set so the user knows where the draft lives.
    const item = second.element('list').children[0]
    const label = item.children[0].children.map(child => child.textContent).join(' ')
    assert.match(label, /有未保存草稿/, `the list must mark the draft, got ${JSON.stringify(label)}`)
  } finally {
    second.cleanup()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ── dry run ─────────────────────────────────────────────────────────────── */

testCase('dry run renders the preview without touching the files', async () => {
  const f = mount()
  try {
    await f.flush()
    const before = readFileSync(join(f.config.storeDirectory, 'global.md'), 'utf8')
    f.element('content').value = 'DRAFT-ONLY-TEXT'
    f.element('content').dispatch('input')
    await f.api.dryRun()
    await f.flush()

    assert.equal(f.element('previewPanel').hidden, false)
    assert.match(f.element('preview').textContent, /DRAFT-ONLY-TEXT/)
    assert.match(f.element('preview').textContent, /Standing rules from the user/)
    assert.match(f.element('previewMeta').textContent, /\d+ \/ \d+/, 'the preview reports bytes against the budget')
    assert.equal(readFileSync(join(f.config.storeDirectory, 'global.md'), 'utf8'), before, 'a dry run must not write')
    assert.equal(f.api.isDirty(), true, 'a dry run must not clear the draft')
  } finally {
    f.cleanup()
  }
})

testCase('dry run reflects a disabled draft by leaving it out', async () => {
  const f = mount()
  try {
    await f.flush()
    f.element('enabled').checked = false
    f.element('enabled').dispatch('change')
    await f.api.dryRun()
    await f.flush()
    const preview = f.element('preview').textContent
    assert.doesNotMatch(preview, /始终使用简体中文回答/)
    assert.match(preview, /遵循项目已有风格/)
  } finally {
    f.cleanup()
  }
})

/* ── in-page dialogs ─────────────────────────────────────────────────────── */

testCase('switching rule sets with edits asks through the in-page dialog', async () => {
  const f = mount()
  try {
    await f.flush()
    f.element('content').value = 'dirty'
    f.element('content').dispatch('input')

    const switching = f.api.select('style')
    await f.flush()
    assert.equal(f.dialogVisible(), true, 'a native confirm must not be used')
    assert.match(f.dialogText(), /丢弃/)
    f.clickCancel()
    await switching
    assert.equal(f.api.selected(), 'global', 'cancelling keeps the current rule set')

    const again = f.api.select('style')
    await f.flush()
    f.clickOk()
    await again
    assert.equal(f.api.selected(), 'style')
    assert.equal(f.dialogVisible(), false)
  } finally {
    f.cleanup()
  }
})

testCase('creating asks for a name through the in-page dialog', async () => {
  const f = mount()
  try {
    await f.flush()
    const creating = f.api.create()
    // `create()` runs its own confirmation step first, so the dialog appears a tick
    // later — it is not synchronous.
    await f.flush()
    assert.equal(f.dialogVisible(), true, 'a dialog must be shown instead of a native prompt')
    assert.equal(f.element('modalInput').hidden, false)
    f.dialogInput('评审规则')
    f.clickOk()
    await creating
    await f.flush()
    assert.equal(f.api.state().global.rulesets.length, 3)
    assert.match(f.element('status').textContent, /已新建/)
  } finally {
    f.cleanup()
  }
})

testCase('cancelling creation changes nothing', async () => {
  const f = mount()
  try {
    await f.flush()
    const creating = f.api.create()
    await f.flush()
    f.clickCancel()
    await creating
    assert.equal(f.api.state().global.rulesets.length, 2)
  } finally {
    f.cleanup()
  }
})

/* ── deletion and the exit paths ─────────────────────────────────────────── */

testCase('deleting the last rule set leaves a usable page, not a dead end', async () => {
  const f = mount([{ id: 'only', title: '唯一', content: 'ONLY' }])
  try {
    await f.flush()
    const removing = f.api.remove()
    await f.flush()
    assert.equal(f.dialogVisible(), true)
    f.clickOk()
    await removing
    await f.flush()

    assert.deepEqual(f.api.state().global.rulesets.map(entry => entry.id), [])
    assert.equal(f.api.selected(), null)
    assert.equal(f.element('emptyNotice').hidden, false)
    for (const id of ['close', 'reload', 'add']) {
      assert.equal(f.element(id).disabled, false, `${id} must stay usable after a delete`)
    }

    await f.api.closeEditor()
    assert.equal(f.hintVisible(), true, 'the page can still be left')

    const creating = f.api.create()
    await f.flush()
    assert.equal(f.dialogVisible(), true)
    f.dialogInput('重建')
    f.clickOk()
    await creating
    await f.flush()
    assert.equal(f.api.state().global.rulesets.length, 1)
  } finally {
    f.cleanup()
  }
})

testCase('deleting one of several keeps the editor on a valid selection', async () => {
  const f = mount()
  try {
    await f.flush()
    const removing = f.api.remove()
    await f.flush()
    f.clickOk()
    await removing
    await f.flush()
    assert.deepEqual(f.api.scopeState().rulesets.map(entry => entry.id), ['style'])
    assert.equal(f.api.selected(), 'style', 'the editor falls back to the remaining rule set')
    assert.equal(f.element('content').disabled, false)
    assert.match(f.element('content').value, /遵循项目已有风格/)
    assert.equal(f.element('close').disabled, false)
  } finally {
    f.cleanup()
  }
})

testCase('cancelling a delete keeps the rule set', async () => {
  const f = mount()
  try {
    await f.flush()
    const removing = f.api.remove()
    await f.flush()
    f.clickCancel()
    await removing
    assert.equal(f.api.state().global.rulesets.length, 2)
  } finally {
    f.cleanup()
  }
})

testCase('closing asks before dropping edits, and a cancelled close stays open', async () => {
  const f = mount()
  try {
    await f.flush()
    f.element('content').value = 'unsaved'
    f.element('content').dispatch('input')

    const cancelled = f.api.closeEditor()
    await f.flush()
    assert.equal(f.dialogVisible(), true, 'closing must not silently drop edits')
    assert.match(f.dialogText(), /丢弃/)
    f.clickCancel()
    await cancelled
    assert.equal(f.closes.length, 0, 'a cancelled close must not close')
    assert.equal(f.hintVisible(), false)
    assert.ok(f.storage.size() > 0, 'the draft stays mirrored')

    const closing = f.api.closeEditor()
    await f.flush()
    f.clickOk()
    await closing
    // The desktop window is never closed; the page explains how to leave instead.
    assert.equal(f.closes.length, 0, 'the app window must never be closed')
    assert.equal(f.hintVisible(), true)
  } finally {
    f.cleanup()
  }
})

testCase('a clean editor closes without asking', async () => {
  const f = mount()
  try {
    await f.flush()
    const closing = f.api.closeEditor()
    await closing
    assert.equal(f.dialogVisible(), false, 'a clean editor must not prompt')
    assert.equal(f.closes.length, 0, 'the app window must never be closed')
    assert.equal(f.hintVisible(), true, 'the user is told how to leave')
  } finally {
    f.cleanup()
  }
})

testCase('an embedded editor asks the overlay to dismiss instead of closing the window', async () => {
  const f = mount(makeTwoRulesets(), { embedded: true })
  try {
    await f.flush()
    const closing = f.api.closeEditor()
    await closing
    // The regression this guards: `window.close()` here used to terminate DSH.
    assert.equal(f.closes.length, 0, 'an embedded editor must never close the window')
    assert.deepEqual(f.posts, [{ type: 'dsh-global-rules:close' }], 'the overlay is asked to dismiss')
    assert.equal(f.hintVisible(), false, 'no hint is needed when the overlay can dismiss')
  } finally {
    f.cleanup()
  }
})

testCase('a window this script opened may close itself', async () => {
  const f = mount(makeTwoRulesets(), { openedByScript: true })
  try {
    await f.flush()
    const closing = f.api.closeEditor()
    await closing
    assert.equal(f.closes.length, 1, 'a script-opened window may close')
  } finally {
    f.cleanup()
  }
})

testCase('a refused window.close() explains what to do instead of doing nothing', async () => {
  const f = mount(makeTwoRulesets(), { openedByScript: true, closeWorks: false })
  try {
    await f.flush()
    const closing = f.api.closeEditor()
    await closing
    assert.equal(f.closes.length, 0, 'the simulated browser refused to close')
    assert.equal(f.hintVisible(), true, 'the user must be told how to leave')
    f.element('closedDismiss').click()
    assert.equal(f.hintVisible(), false)
  } finally {
    f.cleanup()
  }
})

testCase('the desktop window is never closed, even when it refuses nothing', async () => {
  // The DSH desktop window has no opener and is not embedded: closing it would
  // terminate the application, so the page must only explain.
  const f = mount(makeTwoRulesets())
  try {
    await f.flush()
    const closing = f.api.closeEditor()
    await closing
    assert.equal(f.closes.length, 0, 'the app window must not be asked to close')
    assert.equal(f.hintVisible(), true)
  } finally {
    f.cleanup()
  }
})

/* ── language ────────────────────────────────────────────────────────────── */

testCase('the interface follows the requested language', async () => {
  const f = mount(makeTwoRulesets(), { lang: 'en' })
  try {
    await f.flush()
    assert.match(f.element('status').textContent, /Loaded 2 rule sets/, 'English strings must be selected')
  } finally {
    f.cleanup()
  }

  const zh = mount(makeTwoRulesets(), { lang: 'zh' })
  try {
    await zh.flush()
    assert.match(zh.element('status').textContent, /已载入 2 个规则集/, 'Chinese strings must be selected')
  } finally {
    zh.cleanup()
  }

  // An unknown language falls back to Chinese rather than a half-translated state.
  const other = mount(makeTwoRulesets(), { lang: 'fr' })
  try {
    await other.flush()
    assert.match(other.element('status').textContent, /已载入/, 'an unknown language falls back to Chinese')
  } finally {
    other.cleanup()
  }
})

/* ── workspace scopes ────────────────────────────────────────────────────── */

testCase('a workspace scope can be added, edited, and removed', async () => {
  const f = mount()
  try {
    await f.flush()
    const workspacePath = join(f.home, 'project-a')

    const adding = f.api.addWorkspace()
    await f.flush()
    assert.equal(f.dialogVisible(), true)
    f.dialogInput(workspacePath)
    f.clickOk()
    await adding
    await f.flush()

    // The scope switched to the new workspace and it has a starter rule set.
    assert.equal(f.api.scope().scope, 'workspace')
    assert.equal(f.api.scope().path, workspacePath)
    assert.equal(f.api.scopeState().rulesets.length, 1)
    assert.equal(f.api.state().workspaces.length, 1)
    assert.equal(f.api.state().workspaces[0].path, workspacePath)

    // Editing and saving inside the workspace scope writes that store, not the global one.
    f.element('content').value = 'WORKSPACE-ONLY-RULE'
    f.element('content').dispatch('input')
    await f.api.save()
    await f.flush()
    assert.match(f.api.scopeState().rulesets[0].content, /WORKSPACE-ONLY-RULE/)
    assert.equal(f.api.state().global.rulesets[0].content.includes('WORKSPACE-ONLY-RULE'), false,
      'a workspace edit must not leak into the global store')

    // Removing the workspace store drops it from the sidebar and returns to global.
    const removing = f.api.removeWorkspace(f.api.state().workspaces[0])
    await f.flush()
    f.clickOk()
    await removing
    await f.flush()
    assert.equal(f.api.state().workspaces.length, 0)
    assert.equal(f.api.scope().scope, 'global')
  } finally {
    f.cleanup()
  }
})

testCase('a workspace scope refuses a relative path', async () => {
  const f = mount()
  try {
    await f.flush()
    const adding = f.api.addWorkspace()
    await f.flush()
    assert.equal(f.dialogVisible(), true)
    f.dialogInput('relative/path')
    f.clickOk()
    // The action rejects; `run` is what turns that into a status message.
    await f.api.run(() => adding)
    await f.flush()
    assert.match(f.element('status').textContent, /操作失败/, 'a relative path must be refused')
    assert.equal(f.api.state().workspaces.length, 0, 'nothing may be created for a bad path')
  } finally {
    f.cleanup()
  }
})

/* ── language ────────────────────────────────────────────────────────────── */

testCase('the interface follows the browser language when no lang is requested', async () => {
  // The reported defect: opening the editor with no query string showed Chinese even
  // on an English system, because the page had nothing to go on.
  const english = mount(makeTwoRulesets(), { lang: null, navigatorLanguage: 'en-US' })
  try {
    await english.flush()
    assert.match(english.element('status').textContent, /Loaded 2 rule sets/, 'an English browser gets English')
  } finally {
    english.cleanup()
  }

  const chinese = mount(makeTwoRulesets(), { lang: null, navigatorLanguage: 'zh-CN' })
  try {
    await chinese.flush()
    assert.match(chinese.element('status').textContent, /已载入/, 'a Chinese browser gets Chinese')
  } finally {
    chinese.cleanup()
  }

  // A language the plugin does not ship falls back to Chinese, not to a mix.
  const other = mount(makeTwoRulesets(), { lang: null, navigatorLanguage: 'ja-JP' })
  try {
    await other.flush()
    assert.match(other.element('status').textContent, /已载入/, 'an unsupported language falls back to Chinese')
  } finally {
    other.cleanup()
  }

  // `?lang=` still wins, because the in-app overlay reads the live DSH locale.
  const pinned = mount(makeTwoRulesets(), { lang: 'en', navigatorLanguage: 'zh-CN' })
  try {
    await pinned.flush()
    assert.match(pinned.element('status').textContent, /Loaded/, 'the explicit lang wins over the browser')
  } finally {
    pinned.cleanup()
  }
})

testCase('seeded rule sets follow the configured language', async () => {
  const store = await import('../lib/store.js')
  const rules = await import('../lib/rules.js')

  const englishHome = mkdtempSync(join(tmpdir(), 'gr-lang-en-'))
  try {
    const config = rules.resolveConfig({ dshHome: englishHome, lang: 'en' })
    store.ensureStore(config)
    const globalText = store.getStore(config).readRuleset('global')
    assert.match(globalText, /Rules here apply to every workspace/)
    assert.doesNotMatch(globalText, /[\u4e00-\u9fff]/, 'no Chinese boilerplate in an English store')

    const created = store.ensureWorkspaceStore(config, join(englishHome, 'proj'))
    const workspaceText = store.getStore({ ...config, storeDirectory: created.directory }).readRuleset('workspace')
    assert.match(workspaceText, /workspace only/)
    assert.doesNotMatch(workspaceText, /[\u4e00-\u9fff]/, 'no Chinese boilerplate in an English workspace')
    assert.equal(store.readManifestIn(created.directory).rulesets[0].title, 'Workspace rules')
  } finally {
    rmSync(englishHome, { recursive: true, force: true })
  }

  const chineseHome = mkdtempSync(join(tmpdir(), 'gr-lang-zh-'))
  try {
    const config = rules.resolveConfig({ dshHome: chineseHome })
    store.ensureStore(config)
    assert.match(store.getStore(config).readRuleset('global'), /这些规则对所有工作区生效/)
    assert.equal(store.readManifestIn(config.storeDirectory).rulesets[0].title, '全局规则')
  } finally {
    rmSync(chineseHome, { recursive: true, force: true })
  }
})

/* ── version skew ────────────────────────────────────────────────────────── */

testCase('a host from before the scope change still works', async () => {
  // The bug this guards: the page and the host are installed separately, so a host
  // that has not been restarted answers with the previous shape. That used to fail
  // with "Cannot read properties of undefined (reading 'rulesets')".
  const f = mount(makeTwoRulesets(), { stripGlobal: true, embedded: false })
  try {
    await f.flush()
    assert.match(f.element('status').textContent, /已载入 2 个规则集/, 'the page must load anyway')
    assert.equal(f.api.selected(), 'global')
    // The older shape is normalized into the scope payload the page expects.
    assert.equal(f.api.scopeState().rulesets.length, 2)
    assert.equal(f.element('list').children.length, 2)
    // The sidebar names the global scope even without a workspace list.
    assert.equal(f.element('scopes').children.length, 1)
  } finally {
    f.cleanup()
  }
})

testCase('an unrecognizable reply names the version mismatch instead of crashing', async () => {
  const page = makePage()
  const shapes = [
    '{}',
    '{"rulesets":null}',
    '{"global":{}}',
  ]
  for (const body of shapes) {
    const document = makePage()
    void page
    const brokenFetch = async () => ({
      ok: true,
      status: 200,
      statusText: '',
      text: async () => body,
    })
    const fakeWindow = {
      addEventListener: () => {},
      setTimeout: fn => { fn(); return 0 },
      navigator: { userAgent: '' },
      localStorage: makeStorage(),
      location: { href: 'http://127.0.0.1:19387/rules?lang=zh', search: '?lang=zh', origin: 'http://127.0.0.1:19387' },
      self: {},
    }
    fakeWindow.window = fakeWindow
    fakeWindow.top = fakeWindow.self
    fakeWindow.fetch = brokenFetch
    const api = new Function(
      'document', 'window', 'globalThis', 'fetch', 'TextEncoder', 'setTimeout', 'URLSearchParams',
      `${appSource}\nreturn { run, load, state: () => state }`,
    )(document, fakeWindow, fakeWindow, brokenFetch, TextEncoder, fakeWindow.setTimeout, URLSearchParams)

    await api.run(api.load)
    const status = document.getElementById('status').textContent
    assert.match(status, /操作失败/, `a reply of ${body} must be reported`)
    assert.match(status, /版本不一致|version/, `the message must name the mismatch, got: ${status}`)
    assert.doesNotMatch(status, /Cannot read properties/, 'no raw TypeError may reach the user')
  }
})

/* ── failure handling ────────────────────────────────────────────────────── */

testCase('a backend that fails every call reports the reason instead of crashing', async () => {
  const document = makePage()
  const failingFetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => '{"error":"disk is full"}',
  })
  const fakeWindow = {
    addEventListener: () => {},
    setTimeout: fn => { fn(); return 0 },
    navigator: { userAgent: '' },
    localStorage: makeStorage(),
  }
  fakeWindow.window = fakeWindow
  fakeWindow.fetch = failingFetch
  const api = new Function(
    'document', 'window', 'globalThis', 'fetch', 'TextEncoder', 'setTimeout',
    `${appSource}\nreturn { load, run }`,
  )(document, fakeWindow, fakeWindow, failingFetch, TextEncoder, fakeWindow.setTimeout)

  // `run` is the page's own reporting wrapper — the one every handler uses.
  await api.run(api.load)
  const status = document.getElementById('status').textContent
  assert.match(status, /操作失败/, 'a failed call must be visible in the status line')
  assert.match(status, /disk is full/, 'the status must carry the reason, not a generic message')
})
