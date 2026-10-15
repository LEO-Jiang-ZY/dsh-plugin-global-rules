// Integration check: boot a real Cordis Context, mount the real
// @deepseek-ai/dsh-system-prompt service, register this plugin, and assert that
// the user's rules come out of an actual prompt assembly in the right position.
//
// The DSH runtime is loaded from wherever it is available:
//   DSH_VENDOR_DIR  a scratch node_modules tree extracted from app.asar (default: .vendor)
//   DSH_APP_DIR     an unpacked app tree that carries node_modules/@deepseek-ai
// When neither is present the checks skip instead of failing the suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { apply, SECTION_NAME } from '../index.js'
import { resolveConfig, ruleFilePlan } from '../lib/rules.js'
import { listRulesets, writeManifest, writeRuleset } from '../lib/store.js'

const here = dirname(dirname(fileURLToPath(import.meta.url)))

/** Import a module by absolute path, or `undefined` when it is not installed. */
async function tryImport(path) {
  if (!existsSync(path)) return undefined
  try {
    return await import(pathToFileURL(path).href)
  } catch {
    return undefined
  }
}

const vendor = process.env.DSH_VENDOR_DIR ?? join(here, '.vendor', 'node_modules')
const app = process.env.DSH_APP_DIR
const roots = [vendor, app === undefined ? undefined : join(app, 'node_modules')].filter(Boolean)

const cordis = await roots.reduce(async (found, root) => {
  if (await found) return found
  return tryImport(join(root, '@deepseek-ai', 'cordis', 'lib', 'index.js'))
}, Promise.resolve(undefined))

const systemPromptModule = await roots.reduce(async (found, root) => {
  if (await found) return found
  return tryImport(join(root, '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js'))
}, Promise.resolve(undefined))

const available = typeof cordis?.Context === 'function' && typeof systemPromptModule?.SystemPrompt === 'function'

test('the real prompt registry accepts the section and renders it right after identity and persona', async (t) => {
  if (!available) {
    t.skip('the shipped Cordis runtime is unavailable; set DSH_VENDOR_DIR or DSH_APP_DIR')
    return
  }
  const { SystemPrompt } = systemPromptModule
  const dir = mkdtempSync(join(tmpdir(), 'gr-integration-'))
  try {
    const config = resolveConfig({ dshHome: dir })
    writeRuleset(config, 'global', 'ALWAYS-ANSWER-IN-CHINESE')
    writeManifest(config, [{ id: 'global', title: '全局规则', enabled: true, order: 0 }])

    const root = new cordis.Context()
    const service = new SystemPrompt(root, { personaPrefix: 'PERSONA-MARKER', includeHarnessIdentity: true })
    // `ctx.effect` and `ctx.provide` come from Cordis; the plugin uses both.
    apply(root, { dshHome: dir })

    const agent = { id: 'session-integration', session: { header: { cwd: dir } } }
    const assembly = await service.assemble({ agent, scope: agent })

    const rules = assembly.sections.find(section => section.name === SECTION_NAME)
    assert.ok(rules, `assembled sections must include ${SECTION_NAME}: ${assembly.sections.map(s => s.name).join(', ')}`)
    assert.match(rules.text, /ALWAYS-ANSWER-IN-CHINESE/)
    assert.match(rules.text, /Standing rules from the user/)

    // The ordering contract, read from the registry rather than hard-coded.
    assert.ok(service.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') < 100)
    assert.ok(100 < service.getSectionOrder('TOOL_BASH'))

    const nonEmpty = assembly.sections.filter(section => section.text.length > 0).map(section => section.name)
    assert.deepEqual(
      nonEmpty.slice(0, 3),
      ['harness:identity', 'deployment:persona-prefix', SECTION_NAME],
      'rules must render third, right after identity and persona',
    )
    const firstTool = nonEmpty.findIndex(name => name.startsWith('tool:'))
    assert.ok(firstTool === -1 || nonEmpty.indexOf(SECTION_NAME) < firstTool, 'rules must render before every tool section')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the real registry renders the seeded rule set on a first mount', async (t) => {
  if (!available) {
    t.skip('the shipped Cordis runtime is unavailable; set DSH_VENDOR_DIR or DSH_APP_DIR')
    return
  }
  const { SystemPrompt } = systemPromptModule
  const dir = mkdtempSync(join(tmpdir(), 'gr-integration-'))
  try {
    const root = new cordis.Context()
    const service = new SystemPrompt(root, {})
    apply(root, { dshHome: dir })
    const agent = { id: 'session-empty', session: { header: { cwd: dir } } }
    const assembly = await service.assemble({ agent, scope: agent })
    const rules = assembly.sections.find(section => section.name === SECTION_NAME)
    assert.ok(rules.text.length > 0, 'first mount must seed an editable rule set')
    assert.match(rules.text, /Standing rules from the user/)
    const config = resolveConfig({ dshHome: dir })
    assert.deepEqual(listRulesets(config).rulesets.map(entry => entry.id), ['global'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real assembly resolves the workspace override for the session directory', async (t) => {
  if (!available) {
    t.skip('the shipped Cordis runtime is unavailable; set DSH_VENDOR_DIR or DSH_APP_DIR')
    return
  }
  const { SystemPrompt } = systemPromptModule
  const dir = mkdtempSync(join(tmpdir(), 'gr-integration-'))
  try {
    const config = resolveConfig({ dshHome: dir })
    writeRuleset(config, 'global', 'GLOBAL-LAYER')
    writeManifest(config, [{ id: 'global', title: '全局规则', enabled: true, order: 0 }])

    const workspace = join(dir, 'project')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(workspace, '.dsh'), { recursive: true })
    writeFileSync(join(workspace, '.dsh', 'rules.md'), 'PROJECT-LAYER', 'utf8')

    const root = new cordis.Context()
    const service = new SystemPrompt(root, {})
    apply(root, { dshHome: dir })

    const agent = { id: 'session-project', session: { header: { cwd: workspace } } }
    const assembly = await service.assemble({ agent, scope: agent })
    const text = assembly.sections.find(section => section.name === SECTION_NAME).text
    assert.match(text, /GLOBAL-LAYER/)
    assert.match(text, /PROJECT-LAYER/)
    assert.ok(text.indexOf('GLOBAL-LAYER') < text.indexOf('PROJECT-LAYER'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

