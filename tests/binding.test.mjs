// Late route binding: a composition may mount its HTTP server after this row,
// and profiles without one must keep working. These tests drive that ordering
// directly instead of hoping the real startup order covers it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'

/** A Cordis-shaped context whose `webServer` can appear on demand. */
function fakeContext({ withWebServer = true, logger = { warn: () => {} } } = {}) {
  const sections = []
  const provided = new Map()
  const disposers = []
  const server = {
    routes: [],
    register(route) {
      this.routes.push(route)
      return () => {}
    },
  }
  let serverMounted = withWebServer
  const ctx = {
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    get(service) {
      if (service === 'webServer') return serverMounted ? server : undefined
      return undefined
    },
    provide(service, value) {
      provided.set(service, value)
    },
    logger,
  }
  return {
    ctx, sections, provided, server, disposers,
    mountServer() { serverMounted = true },
    unmountServer() { serverMounted = false },
  }
}

function homeWithRules() {
  const home = mkdtempSync(join(tmpdir(), 'gr-bind-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('routes register immediately when the HTTP server is already mounted', () => {
  const home = homeWithRules()
  try {
    const f = fakeContext({ withWebServer: true })
    apply(f.ctx, { dshHome: home })
    assert.equal(f.server.routes.length, 10, 'all editor routes must be registered')
    assert.equal(f.sections.length, 1, 'rule injection must still be registered')
  } finally {
    home.cleanup()
  }
})

test('a profile without an HTTP server still injects rules', async () => {
  const rules = homeWithRules()
  const home = rules.home
  try {
    const warnings = []
    const f = fakeContext({ withWebServer: false, logger: { warn: (message) => warnings.push(message) } })
    apply(f.ctx, { dshHome: home })

    // Rule injection is the point of the plugin and must be live regardless.
    assert.equal(f.sections.length, 1)
    assert.equal(f.sections[0].name, 'global:user-rules')
    assert.equal(f.server.routes.length, 0)

    // The retry gives up quietly and explains itself once.
    await new Promise(resolve => setTimeout(resolve, 4500))
    assert.equal(f.server.routes.length, 0)
    assert.ok(
      warnings.some(message => /no HTTP server appeared/.test(message)),
      `expected one explanatory warning, got: ${JSON.stringify(warnings)}`,
    )
    // A store was still prepared, so rule injection works headlessly.
    assert.ok(existsSync(join(home, 'rules')), 'the rule-set store must exist without a webserver')
  } finally {
    rules.cleanup()
  }
})

test('a late-mounting HTTP server still gets the editor routes', async () => {
  const home = homeWithRules()
  try {
    const f = fakeContext({ withWebServer: false })
    apply(f.ctx, { dshHome: home })

    // Rules are live immediately; the editor is not, yet.
    assert.equal(f.sections.length, 1)
    assert.equal(f.server.routes.length, 0)

    f.mountServer()
    // The retry runs every 200 ms; give it one tick.
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(f.server.routes.length, 10, 'the editor must bind once a server appears')
  } finally {
    home.cleanup()
  }
})

test('binding does not fire twice once it succeeds', async () => {
  const home = homeWithRules()
  try {
    const f = fakeContext({ withWebServer: false })
    apply(f.ctx, { dshHome: home })
    f.mountServer()
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(f.server.routes.length, 10)
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(f.server.routes.length, 10, 'the retry must stop after a successful bind')
  } finally {
    home.cleanup()
  }
})
