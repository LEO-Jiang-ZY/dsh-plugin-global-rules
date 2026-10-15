// Workspace stores: naming, path matching, and precedence in the injection plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ruleFilePlan, resolveConfig } from '../lib/rules.js'
import {
  MANIFEST_NAME,
  deleteWorkspaceStore,
  ensureStore,
  ensureWorkspaceStore,
  getStore,
  listRulesetsIn,
  listWorkspaceStores,
  readManifestIn,
  resolveWorkspaceStore,
  workspaceDirectory,
  workspaceSlug,
  writeManifestIn,
  writeRulesetIn,
} from '../lib/store.js'

/** A temp DSH home with one global rule set. */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'gr-ws-'))
  const config = resolveConfig({ dshHome: home })
  ensureStore(config)
  return { home, config, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

test('a workspace slug is readable and path-specific', () => {
  const a = workspaceSlug('C:\\work\\project')
  const b = workspaceSlug('C:\\work\\project-2')
  assert.notEqual(a, b, 'different paths must never share a directory')
  assert.match(a, /project/, 'the slug keeps a readable tail')
  // Two paths that differ only by separator style are the same workspace.
  assert.equal(workspaceSlug('C:/work/project'), a)
  // Characters Windows forbids never reach the directory name.
  assert.doesNotMatch(workspaceSlug('C:\\work\\a:b?c'), /[:?]/)
  assert.ok(workspaceSlug('C:\\work\\a:b?c').includes('~'), 'a digest separates the slug from the path')
})

test('a workspace store records the workspace it belongs to', () => {
  const f = fixture()
  try {
    const workspace = join(f.home, 'project')
    const created = ensureWorkspaceStore(f.config, workspace)
    const manifest = readManifestIn(created.directory)
    assert.equal(manifest.path, workspace)
    assert.equal(manifest.rulesets.length, 1, 'a starter rule set is written')

    const stores = listWorkspaceStores(f.config)
    assert.equal(stores.length, 1)
    assert.equal(stores[0].path, workspace)
    assert.equal(stores[0].rulesets.length, 1)
  } finally {
    f.cleanup()
  }
})

test('a store without a recorded path is ignored as a workspace', () => {
  const f = fixture()
  try {
    // A stray directory that happens to sit under workspaces/ is not a workspace.
    const stray = join(f.config.storeDirectory, 'workspaces', 'stray')
    writeRulesetIn(stray, 'global', 'x')
    writeManifestIn(stray, [{ id: 'global', title: 'g', enabled: true, order: 0 }])
    assert.deepEqual(listWorkspaceStores(f.config), [], 'a manifest with no path is not a workspace store')
  } finally {
    f.cleanup()
  }
})

test('workspace rules layer on top of the global ones', () => {
  const f = fixture()
  try {
    const workspace = join(f.home, 'project')
    ensureWorkspaceStore(f.config, workspace)

    const plan = ruleFilePlan(f.config, workspace)
    const scopes = plan.map(entry => entry.scope ?? entry.source)
    assert.equal(scopes[0], 'global', 'global rules come first')
    assert.ok(scopes.includes('workspace'), 'the workspace store contributes')

    const globalIndex = scopes.indexOf('global')
    const workspaceIndex = scopes.indexOf('workspace')
    assert.ok(globalIndex < workspaceIndex, 'workspace rules override the global ones')

    const workspaceEntries = plan.filter(entry => (entry.scope ?? entry.source) === 'workspace' && entry.id)
    assert.ok(workspaceEntries.every(entry => entry.path.includes('workspaces')), 'workspace rules come from the workspace store')
  } finally {
    f.cleanup()
  }
})

test('a session in a subdirectory still finds its workspace rules', () => {
  const f = fixture()
  try {
    const workspace = join(f.home, 'project')
    ensureWorkspaceStore(f.config, workspace)
    const nested = join(workspace, 'src', 'deep')

    const resolved = resolveWorkspaceStore(f.config, nested)
    assert.ok(resolved, 'an ancestor store applies to a nested session')
    // The match reports the normalized ancestor path it climbed to.
    assert.equal(
      resolved.matchedFrom.replace(/\\/g, '/').toLowerCase(),
      workspace.replace(/\\/g, '/').toLowerCase(),
      'the match names the ancestor it came from',
    )

    const plan = ruleFilePlan(f.config, nested)
    assert.ok(
      plan.some(entry => (entry.scope ?? '') === 'workspace'),
      'the nested session inherits the workspace rules',
    )
  } finally {
    f.cleanup()
  }
})

test('a workspace with no store leaves only the global rules', () => {
  const f = fixture()
  try {
    const elsewhere = join(f.home, 'unrelated')
    assert.equal(resolveWorkspaceStore(f.config, elsewhere), undefined)
    const plan = ruleFilePlan(f.config, elsewhere)
    assert.ok(plan.every(entry => (entry.scope ?? entry.source) !== 'workspace' || entry.path.includes('.dsh')), 'no workspace store contributes')
  } finally {
    f.cleanup()
  }
})

test('an unknown working directory contributes no workspace rules', () => {
  const f = fixture()
  try {
    const plan = ruleFilePlan(f.config, undefined)
    assert.equal(resolveWorkspaceStore(f.config, undefined), undefined)
    assert.ok(plan.every(entry => (entry.scope ?? '') !== 'workspace'))
  } finally {
    f.cleanup()
  }
})

test('deleting a workspace store removes its directory', () => {
  const f = fixture()
  try {
    const workspace = join(f.home, 'project')
    const created = ensureWorkspaceStore(f.config, workspace)
    assert.equal(existsSync(created.directory), true)
    assert.equal(deleteWorkspaceStore(f.config, workspace), true)
    assert.equal(existsSync(created.directory), false)
    assert.equal(deleteWorkspaceStore(f.config, workspace), false, 'a second delete is a no-op')
    assert.deepEqual(listWorkspaceStores(f.config), [])
  } finally {
    f.cleanup()
  }
})

test('an explicit rulesFiles list must not disable workspace rules', () => {
  // The reported defect: the profile carried `rulesFiles: [global-rules.md]` from an
  // earlier single-file setup, and that branch bypassed the entire chain — every
  // workspace rule was silently ignored while the editor happily saved them.
  const home = mkdtempSync(join(tmpdir(), 'gr-explicit-'))
  try {
    const withExplicit = resolveConfig({ dshHome: home, rulesFiles: ['global-rules.md'] })
    ensureStore(withExplicit)
    const workspace = join(home, 'my-project')
    ensureWorkspaceStore(withExplicit, workspace)

    const plan = ruleFilePlan(withExplicit, workspace)
    assert.ok(plan.some(entry => entry.scope === 'workspace'), 'workspace rules must survive an explicit rulesFiles')

    // The global layer is the explicit file, resolved against DSH_HOME rather than
    // the process working directory — a relative path used to point nowhere.
    const globalEntries = plan.filter(entry => entry.scope === 'global')
    assert.equal(globalEntries.length, 1)
    assert.equal(globalEntries[0].explicit, true)
    assert.equal(
      globalEntries[0].path.replace(/\\/g, '/').toLowerCase(),
      join(home, 'global-rules.md').replace(/\\/g, '/').toLowerCase(),
      'a relative rulesFiles entry resolves against DSH_HOME',
    )
    assert.equal(globalEntries[0].id, undefined, 'the global store is not consulted while overridden')
    assert.ok(plan.some(entry => entry.scope === 'workspace' && entry.id === 'workspace'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a shipped bundle patch must not pin rulesFiles', async () => {
  // The config that caused the defect lived in this very file. It is read live at
  // startup, so a regression here would silently disable the whole manager again.
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: global-rules/, 'the patch still inserts the row')
  assert.doesNotMatch(patch, /^\s+rulesFiles:/m, 'a bundle patch must not override the store')
  assert.doesNotMatch(patch, /^\s+maxBytes:/m, 'defaults belong in the profile, not the shipped patch')
  assert.doesNotMatch(patch, /^\s+applyToSubagents:/m, 'defaults belong in the profile, not the shipped patch')
})

test('a retired legacy file is not adopted a second time', () => {
  // The migration path: an existing store means `ensureStore` returns immediately, so
  // the legacy file must be moved aside by the operator's migration step. If it stayed
  // under its old name, a later fresh store would adopt it again under a second id.
  const home = mkdtempSync(join(tmpdir(), 'gr-legacy-'))
  try {
    const config = resolveConfig({ dshHome: home })
    const store = getStore(config)

    // First run with the legacy file present: it is adopted as `global`.
    writeFileSync(config.legacyGlobalRulesFile, '# legacy rules\nBODY', 'utf8')
    const first = ensureStore(config)
    assert.deepEqual(first.created, [{ id: 'global', adoptedFrom: config.legacyGlobalRulesFile }])
    assert.equal(store.readRuleset('global'), '# legacy rules\nBODY')

    // A second run must not adopt it again once the store exists.
    const second = ensureStore(config)
    assert.deepEqual(second.created, [], 'an existing store is left alone')
    assert.deepEqual(store.listRulesets().rulesets.map(entry => entry.id), ['global'])

    // Retiring the file (as the migration does) keeps it out of the store listing,
    // because only `*.md` is collected.
    renameSync(config.legacyGlobalRulesFile, `${config.legacyGlobalRulesFile}.migrated`)
    const listed = listRulesetsIn(config.storeDirectory)
    assert.deepEqual(listed.rulesets.map(entry => entry.id), ['global'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a disabled workspace rule set is not injected', () => {
  const f = fixture()
  try {
    const workspace = join(f.home, 'project')
    const created = ensureWorkspaceStore(f.config, workspace)
    const manifest = readManifestIn(created.directory)
    writeRulesetIn(created.directory, 'workspace', 'WORKSPACE-RULE')
    writeRulesetIn(created.directory, 'off', 'DISABLED-RULE')
    writeManifestIn(created.directory, [
      ...manifest.rulesets,
      { id: 'off', title: 'off', enabled: false, order: 1 },
    ], { path: workspace })

    const plan = ruleFilePlan(f.config, workspace)
    const ids = plan.map(entry => entry.id).filter(Boolean)
    assert.ok(ids.includes('workspace'))
    assert.equal(ids.includes('off'), false, 'a disabled workspace set must not be injected')
    assert.equal(workspaceDirectory(f.config, workspace), created.directory, 'the directory is stable')
    assert.equal(MANIFEST_NAME, 'manifest.json')
  } finally {
    f.cleanup()
  }
})
