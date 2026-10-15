// Report what rules a session's prompts actually carried, by walking every zstd frame.
//
// Usage: node tools/probe-session.mjs <log.zstd> [dshHome]
import { readSessionLog } from './session-log.mjs'

const file = process.argv[2]
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? ''
const { records, frames, stoppedAt } = readSessionLog(file)

console.log(`records: ${records.length} across ${frames} zstd frames${stoppedAt === undefined ? '' : ` (stopped at byte ${stoppedAt})`}`)
if (records.malformed > 0) console.log(`malformed lines skipped: ${records.malformed}`)

const collect = (node, out = [], depth = 0) => {
  if (depth > 16 || node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { for (const item of node) collect(item, out, depth + 1); return out }
  if (typeof node === 'object') { for (const value of Object.values(node)) collect(value, out, depth + 1) }
  return out
}

const HEADER = 'Standing rules from the user'
const sources = new Map()
const headingRecords = new Set()
let longest = { index: -1, length: 0, sample: '' }

records.forEach((record, index) => {
  for (const value of collect(record)) {
    if (value.length > longest.length) longest = { index, length: value.length, sample: value.slice(0, 260) }
    if (value.includes(HEADER)) headingRecords.add(index)
    for (const match of value.matchAll(/### Rules from (.+?) \[([a-z]+)\]/g)) {
      const key = `${match[2]} :: ${match[1].trim()}`
      sources.set(key, (sources.get(key) ?? 0) + 1)
    }
  }
})

console.log(`\nlongest string value: record ${longest.index}, ${longest.length} chars`)
if (longest.length > 0) console.log(`  starts: ${JSON.stringify(longest.sample.slice(0, 200))}`)

console.log(`\nrecords carrying the rule heading: ${[...headingRecords].join(', ') || '(none)'}`)

if (sources.size > 0) {
  console.log('\nrule sources present in prompts:')
  for (const [key, count] of [...sources].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}x  ${key}`)
  }
} else {
  console.log('\nno rule section found in any prompt')
  // Distinguish "no prompts logged" from "prompts logged without rules".
  const promptLike = records.filter(record => collect(record).some(value => value.includes('You are an AI agent powered by DeepSeek Harness')))
  console.log(`records containing a harness system prompt: ${promptLike.length}`)
  if (promptLike.length > 0) {
    for (const record of promptLike.slice(0, 1)) {
      for (const value of collect(record)) {
        if (!value.includes('You are an AI agent')) continue
        const at = value.indexOf('Agent Teams is available')
        console.log('\n--- prompt around where the rule section would sit ---')
        console.log(value.slice(Math.max(0, at - 600), at + 200))
        break
      }
    }
  }
}

if (dshHome.length > 0) {
  const mentioned = new Set()
  for (const record of records) {
    for (const value of collect(record)) {
      for (const match of value.matchAll(/([A-Za-z]:\\[^\s"'`)]*?\.md)/g)) {
        if (match[1].toLowerCase().startsWith(dshHome.toLowerCase())) mentioned.add(match[1])
      }
    }
  }
  console.log(`\nrule-ish .md paths under DSH home mentioned: ${mentioned.size}`)
  for (const path of [...mentioned].slice(0, 8)) console.log(`  ${path}`)
}
