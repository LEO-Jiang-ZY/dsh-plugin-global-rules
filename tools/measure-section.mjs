// Measure the injected section on real files: total size, the share spent on
// presentation, and what the removed long provenance headings would have cost.
//
// Usage: node tools/measure-section.mjs <dshHome> <sessionCwd>
import { readFileSync } from 'node:fs'
import { budgetedSection, renderSource, renderSourceIndex, resolveConfig, sectionHeader } from '../lib/rules.js'

const [dshHome, sessionCwd] = process.argv.slice(2)
const config = resolveConfig({ dshHome })
const reader = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const { text, state } = budgetedSection({ config, workspacePath: sessionCwd, isSubagent: false, readText: reader })
const bytes = Buffer.byteLength(text, 'utf8')

const shortSources = state.sources.map(source => renderSource(source))
const longSources = state.sources.map(source => renderSource(source, { verbose: true }))
const header = sectionHeader()
const ruleBytes = state.sources.reduce((sum, source) => sum + Buffer.byteLength(source.content.trim(), 'utf8'), 0)

const shortBytes = Buffer.byteLength(shortSources.join('\n\n'), 'utf8')
const longBytes = Buffer.byteLength(longSources.join('\n\n'), 'utf8')
const indexBytes = Buffer.byteLength(renderSourceIndex(state.sources), 'utf8')

console.log(`sources                : ${state.sources.length}`)
for (const source of state.sources) {
  console.log(`  [${source.source}] ${source.path} (${Buffer.byteLength(source.content.trim(), 'utf8')} bytes)`)
}
console.log('')
console.log(`rule text              : ${ruleBytes} bytes`)
console.log(`section total (now)    : ${bytes} bytes`)
console.log(`  header               : ${Buffer.byteLength(header, 'utf8')} bytes`)
console.log(`  provenance index     : ${indexBytes} bytes`)
console.log(`  headings + framing   : ${shortBytes - ruleBytes} bytes`)
console.log('')
console.log(`same section, long form: ${longBytes + Buffer.byteLength(header, 'utf8')} + index omitted`)
const saved = longBytes - shortBytes
console.log(`saved by short headings: ${saved} bytes (${ruleBytes > 0 ? ((saved / longBytes) * 100).toFixed(1) : '0'}% of the rule blocks)`)
console.log(`total overhead share   : ${bytes > 0 ? (((bytes - ruleBytes) / bytes) * 100).toFixed(1) : '0'}% of the section is not rule text`)
console.log('')
console.log('--- toggles ---')
const verbose = budgetedSection({ config: { ...config, verboseProvenance: true }, workspacePath: sessionCwd, isSubagent: false, readText: reader })
const announce = budgetedSection({ config: { ...config, announceRules: true }, workspacePath: sessionCwd, isSubagent: false, readText: reader })
console.log(`verboseProvenance: true -> ${Buffer.byteLength(verbose.text, 'utf8')} bytes (+${Buffer.byteLength(verbose.text, 'utf8') - bytes})`)
console.log(`announceRules: true     -> ${Buffer.byteLength(announce.text, 'utf8')} bytes (+${Buffer.byteLength(announce.text, 'utf8') - bytes})`)
console.log('')
console.log('--- rendered section ---')
console.log(text)
