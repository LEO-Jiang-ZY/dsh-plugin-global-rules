// Move the pre-store single-file rule set into the store as a first-class rule set.
//
// Why: an earlier install left `rulesFiles: [global-rules.md]` in the shipped bundle
// patch, so the model read that one file and the store was ignored. That config is now
// removed, which makes the store authoritative — but `ensureStore` adopts the legacy
// file only on first run, and this store already exists. Without this migration the
// user's real rules would fall out of the prompt the moment the fix takes effect.
//
// Usage: node tools/adopt-legacy.mjs <dshHome> [--dry-run]
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureStore,
  getStore,
  isValidId,
  listRulesetsIn,
} from '../lib/store.js'
import { resolveConfig } from '../lib/rules.js'

const dshHome = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!dshHome) {
  console.error('usage: node tools/adopt-legacy.mjs <dshHome> [--dry-run]')
  process.exit(2)
}

const config = resolveConfig({ dshHome })
const store = getStore(config)
const mounted = ensureStore(config)

const legacyFile = config.legacyGlobalRulesFile
if (!existsSync(legacyFile)) {
  console.log(`nothing to adopt: ${legacyFile} does not exist`)
  process.exit(0)
}

const content = readFileSync(legacyFile, 'utf8')
const listed = store.listRulesets()
const ids = new Set(listed.rulesets.map(entry => entry.id))

// Pick a free id for the adopted rule set.
let id = 'global-rules'
for (let n = 2; ids.has(id); n += 1) id = `global-rules-${n}`
if (!isValidId(id)) throw new Error(`refusing to write rule set with unsafe id "${id}"`)

console.log(`store root     : ${config.storeDirectory}`)
console.log(`legacy file    : ${legacyFile} (${Buffer.byteLength(content, 'utf8')} bytes)`)
console.log(`existing sets  : ${listed.rulesets.map(entry => `${entry.id}${entry.enabled ? '' : ' (disabled)'}`).join(', ') || '(none)'}`)
console.log(`adopting as    : ${id}`)

if (dryRun) {
  console.log('\n--dry-run: nothing written')
  process.exit(0)
}

// Write the content, enable it, and disable the small test set so the prompt does not
// carry two overlapping global rule sets.
store.writeRuleset(id, content)
const next = listed.rulesets
  .filter(entry => entry.id !== id)
  .map(entry => ({ ...entry, enabled: false }))
next.push({ id, title: '全局规则', enabled: true, order: next.length })
store.writeManifest(next)
console.log(`\nwritten: ${join(config.storeDirectory, `${id}.md`)}`)

// Move the legacy file aside. It must stop existing under its old name, or the next
// `ensureStore` on a fresh store would adopt it a second time as `global`.
const retired = `${legacyFile}.migrated`
renameSync(legacyFile, retired)
console.log(`retired: ${legacyFile} -> ${retired}`)

const after = listRulesetsIn(config.storeDirectory)
console.log('\nresulting manifest:')
for (const entry of after.rulesets) {
  console.log(`  ${entry.enabled ? 'on ' : 'off'}  ${entry.id}  "${entry.title}"  ${entry.bytes} bytes`)
}
void mounted
