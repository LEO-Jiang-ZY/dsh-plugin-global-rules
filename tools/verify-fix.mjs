// End-to-end verification of the fix, against the user's real files.
//
// Simulates the layer composition the runtime uses — the shipped bundle patch (now
// config-free) plus the profile row — and reports what a session in a given directory
// would actually receive.
//
// Usage: node tools/verify-fix.mjs <dshHome> <sessionCwd>
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, ruleFilePlan } from '../lib/rules.js'
import { ensureStore } from '../lib/store.js'
import { budgetedSection } from '../lib/rules.js'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const dshHome = process.argv[2]
const sessionCwd = process.argv[3]
if (!dshHome || !sessionCwd) {
  console.error('usage: node tools/verify-fix.mjs <dshHome> <sessionCwd>')
  process.exit(2)
}

// 1. The shipped patch must carry no config, or it would override the store again.
const patch = readFileSync(join(here, 'cordis.patch.yml'), 'utf8')
const pinsStore = /^\s+rulesFiles:/m.test(patch)
console.log('shipped bundle patch pins rulesFiles:', pinsStore, pinsStore ? '(FAIL)' : '(ok)')

// 2. Compose the effective config exactly as the runtime would: no `rulesFiles`.
const config = resolveConfig({ dshHome })
ensureStore(config)
console.log('effective rulesFiles:', JSON.stringify(config.rulesFiles), config.rulesFiles.length === 0 ? '(ok, store is authoritative)' : '(FAIL)')

// 3. What this session directory receives.
const plan = ruleFilePlan(config, sessionCwd)
console.log(`\nplan for ${sessionCwd}:`)
for (const entry of plan) {
  let exists = false
  let bytes = 0
  try {
    const text = readFileSync(entry.path, 'utf8')
    exists = true
    bytes = Buffer.byteLength(text, 'utf8')
  } catch { /* missing is reported */ }
  console.log(`  [${(entry.scope ?? entry.source).padEnd(9)}] ${exists ? `${String(bytes).padStart(5)}B` : 'missing '}  ${entry.id ?? '-'}`)
}

const { text, state } = budgetedSection({
  config,
  workspacePath: sessionCwd,
  isSubagent: false,
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
})

console.log(`\ninjected sources: ${state.sources.length}`)
for (const source of state.sources) console.log(`  ${source.path}`)
console.log(`\nrendered section: ${Buffer.byteLength(text, 'utf8')} bytes`)
const scopes = [...text.matchAll(/### Rules from (.+?) \[([a-z]+)\]/g)].map(m => `${m[2]} :: ${m[1]}`)
console.log('sections rendered:')
for (const scope of scopes) console.log(`  ${scope}`)

const hasWorkspace = scopes.some(scope => scope.startsWith('workspace'))
const hasGlobal = scopes.some(scope => scope.startsWith('global'))
console.log(`\nVERDICT: global=${hasGlobal ? 'yes' : 'NO'} workspace=${hasWorkspace ? 'yes' : 'NO'}`)
console.log(hasGlobal && hasWorkspace ? 'PASS — global and workspace rules both reach the model' : 'FAIL')
