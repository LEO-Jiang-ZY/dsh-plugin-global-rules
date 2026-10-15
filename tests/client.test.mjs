// The client half is a pre-built bundle, not a module DSH imports: it calls
// `window.__ModuleLoader__.load({id, factory})` and receives a `require` that
// resolves the seeded platform modules. The test text-imports the file into a
// sandbox so the exact registered export shape is checked without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(here, 'lib', 'client.js')

/** Evaluate the bundle against a minimal module-loader and React shim. */
function loadBundle() {
  const source = readFileSync(bundlePath, 'utf8')
  const loads = []
  const window = {
    __ModuleLoader__: {
      load(registration) {
        loads.push(registration)
      },
    },
    open: () => ({ closed: false }),
    setTimeout: () => 0,
    location: { href: 'http://127.0.0.1:19387/', assign: () => {} },
  }
  const requiredNames = []
  /** A React small enough to render this bundle: state, callbacks, effects. */
  const stateSlots = []
  let stateCursor = 0
  const react = {
    // `type` rides in props too, so the test can find a control without walking the tree.
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), type }, children: children.flat() }),
    useState: (initial) => {
      const index = stateCursor++
      if (!(index in stateSlots)) stateSlots[index] = typeof initial === 'function' ? initial() : initial
      return [stateSlots[index], (next) => {
        stateSlots[index] = typeof next === 'function' ? next(stateSlots[index]) : next
      }]
    },
    useCallback: fn => fn,
    useEffect: (effect) => { effect(); },
    Fragment: Symbol('react.fragment'),
  }
  const render = (component, props) => {
    stateCursor = 0
    return component(props)
  }
  const require = (name) => {
    requiredNames.push(name)
    if (name === 'react') return react
    throw new Error(`unexpected platform module: ${name}`)
  }
  // The bundle reads `window.__ModuleLoader__` and `globalThis`; evaluate it with
  // those bound, and hand the factory the platform require.
  const factoryRun = new Function('window', 'globalThis', source)
  factoryRun(window, window)
  return { loads, require, requiredNames, window, render }
}

test('the bundle registers exactly one module under the package name', () => {
  const { loads } = loadBundle()
  assert.equal(loads.length, 1)
  assert.equal(loads[0].id, 'dsh-plugin-global-rules')
  assert.equal(typeof loads[0].factory, 'function')
})

test('the factory exports the Cordis client contract and requires only react', () => {
  const { loads, require, requiredNames } = loadBundle()
  const plugin = loads[0].factory(require)
  assert.equal(plugin.name, 'global-rules')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(requiredNames, ['react'])
})

test('apply registers the sidebar action and publishes the overlay contract', () => {
  const { loads, require } = loadBundle()
  const plugin = loads[0].factory(require)
  const registrations = []
  const injections = []
  const provided = new Map()
  let disposed = 0
  const ctx = {
    effect(factory) {
      const disposer = factory()
      return () => { disposed += 1; disposer?.() }
    },
    get: () => undefined,
    provide(name, service) { provided.set(name, service) },
    slots: {
      inject(key, callback) {
        injections.push(key)
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(injections, ['sidebar.footer.action'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'sidebar.footer.action')
  assert.equal(registrations[0].options.id, 'global-rules')
  assert.equal(registrations[0].options.label, '规则管理器')
  assert.equal(typeof registrations[0].component, 'function')
  assert.equal(disposed, 0)
  // The overlay contract is published so a command can drive the same surface.
  assert.equal(provided.get('globalRulesOverlay').path, '/rules')
  assert.equal(provided.get('globalRulesOverlay').message, 'dsh-global-rules:close')
})

test('the action opens an in-app overlay instead of a new window', () => {
  const { loads, require, window, render } = loadBundle()
  const plugin = loads[0].factory(require)
  let component
  const opened = []
  window.open = (url, target) => { opened.push({ url, target }); return { closed: false } }
  window.location = { href: 'http://127.0.0.1:19387/', origin: 'http://127.0.0.1:19387' }
  window.addEventListener = () => {}
  window.removeEventListener = () => {}
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    get: () => undefined,
    provide: () => {},
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, registered) => { component = registered; return () => {} },
    },
  })

  // React is stubbed, so the tree is inspected as plain data.
  const before = render(component, {})
  const [action] = before.children
  assert.equal(action.type, 'button')
  assert.equal(action.props['aria-label'], '规则管理器')
  assert.equal(before.children[1], null, 'the overlay stays unmounted until the action is used')

  action.props.onClick()
  const after = render(component, {})
  const overlay = after.children[1]
  assert.ok(overlay, 'the overlay must mount in-page after the action is used')
  assert.equal(overlay.props.role, 'dialog')
  const frame = overlay.children[1]
  assert.equal(frame.type, 'iframe')
  assert.match(frame.props.src, /\/rules\?/)
  assert.match(frame.props.src, /embed=1/, 'the editor must know it is embedded')
  // The stub provides no locale, so the overlay must NOT pin a language: writing
  // `lang=zh` here is what previously overrode the page's browser-language fallback.
  assert.doesNotMatch(frame.props.src, /lang=/, 'an unknown locale must not be guessed')
  assert.equal(opened.length, 0, 'opening must never spawn a window')

  // The Close control dismisses the overlay and nothing else. The stub keeps
  // children in `children`, as React's runtime does, not inside `props`.
  const closeButton = overlay.children[0].children.find(child => child?.props?.type === 'button')
  assert.ok(closeButton, 'the overlay header must carry a Close button')
  assert.deepEqual(closeButton.children, ['关闭'])
  closeButton.props.onClick()
  assert.equal(render(component, {}).children[1], null, 'Close dismisses the overlay')
  assert.equal(opened.length, 0)
})

test('a known locale is passed to the editor, and an unreadable one is not guessed', () => {
  const { loads, require, window, render } = loadBundle()
  let component

  /** Mount with a locale service whose snapshot says the given language. */
  const mountWith = (localeId) => {
    const plugin = loads[0].factory(require)
    window.location = { href: 'http://127.0.0.1:19387/', origin: 'http://127.0.0.1:19387' }
    window.addEventListener = () => {}
    window.removeEventListener = () => {}
    plugin.apply({
      effect: (factory) => { factory(); return () => {} },
      get: (name) => (name === 'locale'
        ? { getLocale: () => (localeId === undefined ? undefined : { active: localeId }) }
        : undefined),
      provide: () => {},
      slots: {
        inject: (_key, callback) => callback(),
        register: (_options, registered) => { component = registered; return () => {} },
      },
    })
    const [action] = render(component, {}).children
    action.props.onClick()
    return render(component, {}).children[1]
  }

  // A readable locale is forwarded, so the editor matches DSH exactly.
  const english = mountWith('en')
  const englishFrame = english.children[1]
  assert.match(englishFrame.props.src, /lang=en/)
  assert.deepEqual(english.children[0].children.find(child => child?.props?.type === 'button').children, ['Close'])

  // An unreadable locale leaves the parameter out, so the page resolves it from the
  // browser — the fault that pinned English users to Chinese.
  const unknown = mountWith(undefined)
  assert.doesNotMatch(unknown.children[1].props.src, /lang=/)

  // A `ctx.get` that throws (service not injected) must not break the overlay.
  const plugin = loads[0].factory(require)
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    get: () => { throw new Error('service "locale" is not available to this plugin') },
    provide: () => {},
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, registered) => { component = registered; return () => {} },
    },
  })
  const [action] = render(component, {}).children
  action.props.onClick()
  assert.ok(render(component, {}).children[1], 'a throwing ctx.get must not break the overlay')
})

test('the overlay dismisses on the editor\'s close message, and only from this origin', () => {
  const { loads, require, window, render } = loadBundle()
  const plugin = loads[0].factory(require)
  let component
  const listeners = new Map()
  window.location = { href: 'http://127.0.0.1:19387/', origin: 'http://127.0.0.1:19387' }
  window.addEventListener = (type, handler) => { listeners.set(type, handler) }
  window.removeEventListener = () => {}
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    get: () => undefined,
    provide: () => {},
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, registered) => { component = registered; return () => {} },
    },
  })

  const [action] = render(component, {}).children
  action.props.onClick()
  assert.ok(render(component, {}).children[1], 'the overlay is open')

  const onMessage = listeners.get('message')
  assert.equal(typeof onMessage, 'function', 'the overlay must listen for the close message')

  // A message from another origin is ignored.
  onMessage({ origin: 'https://evil.example', data: { type: 'dsh-global-rules:close' } })
  assert.ok(render(component, {}).children[1], 'a foreign origin must not dismiss the overlay')

  onMessage({ origin: 'http://127.0.0.1:19387', data: { type: 'dsh-global-rules:close' } })
  assert.equal(render(component, {}).children[1], null, 'the editor can dismiss its own overlay')
})

test('the bundle never throws before the loader is present', () => {
  const source = readFileSync(bundlePath, 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.doesNotMatch(source, /^\s*import\s/m, 'a built client bundle must not use static ESM imports')
  assert.doesNotMatch(source, /export\s+default/, 'a built client bundle must not use ESM exports')
})
