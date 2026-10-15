// Report exactly what the plugin injects today, for any DSH home and session
// directory. This is the operator's ground truth when a rule "does not apply":
// it runs the same plan and render path the prompt section uses.
//
// Usage: node tools/inspect-injection.mjs [dshHome] [cwd]
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, ruleFilePlan, SECTION_NAME } from '../lib/rules.js'
import { budgetedSection } from '../lib/rules.js'
import { readFileSync } from 'node:fs'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
void here

const dshHome = process.argv[2] ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '.', '.dsh')
const cwd = process.argv[3] ?? process.cwd()
const config = resolveConfig({ dshHome })

console.log(`DSH home      : ${dshHome}`)
console.log(`store root    : ${config.storeDirectory}`)
console.log(`session cwd   : ${cwd}`)
console.log('')

const plan = ruleFilePlan(config, cwd)
console.log(`plan entries  : ${plan.length}`)
for (const entry of plan) {
  let bytes = 'missing'
  try {
    bytes = `${readFileSync(entry.path, 'utf8').length} chars`
  } catch { /* reported as missing */ }
  console.log(`  [${entry.scope ?? entry.source}] ${entry.id ?? '-'} -> ${entry.path} (${bytes})`)
}

const { text, state } = budgetedSection({
  config,
  workspacePath: cwd,
  isSubagent: false,
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
})

console.log('')
console.log(`sources kept  : ${state.sources.length}`)
for (const source of state.sources) {
  console.log(`  ${source.path} (${Buffer.byteLength(source.content, 'utf8')} bytes)`)
}
if (state.notices.length > 0) console.log(`notices       : ${state.notices.join(' | ')}`)
if (state.skipped) console.log(`skipped       : ${state.skipped}`)
console.log('')
console.log(`section ${SECTION_NAME} renders ${Buffer.byteLength(text, 'utf8')} bytes`)
console.log('---')
console.log(text.length > 0 ? text : '(nothing would be injected)')
