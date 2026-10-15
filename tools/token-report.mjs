// Summarize provider token usage across one or more session logs, and attribute the
// plugin's share by measuring the injected section's byte size.
//
// Usage: node tools/token-report.mjs <log.zstd> [log.zstd ...]
import { readFileSync } from 'node:fs'
import { readSessionLog } from './session-log.mjs'

/** Depth-first walk yielding primitive leaves with their paths. */
function* walk(node, path = '', depth = 0) {
  if (depth > 16 || node === null || node === undefined) return
  if (typeof node !== 'object') {
    yield [path, node]
    return
  }
  for (const [key, value] of Object.entries(node)) {
    yield* walk(value, path ? `${path}.${key}` : key, depth + 1)
  }
}

const rows = []
for (const file of process.argv.slice(2)) {
  const { records } = readSessionLog(file)
  let first = null
  const steps = []
  for (const [index, record] of records.entries()) {
    let usage = null
    let promptChars = 0
    for (const [path, value] of walk(record)) {
      if (path.endsWith('.usage.inputTokens') && !path.includes('.chunk.')) {
        const base = path.slice(0, -'.inputTokens'.length)
        usage = {
          input: value,
          cacheRead: record.data?.usage?.cacheReadTokens ?? 0,
          cacheWrite: record.data?.usage?.cacheWriteTokens ?? 0,
          output: record.data?.usage?.outputTokens ?? 0,
        }
      }
      if (typeof value === 'string' && value.includes('You are an AI agent powered by DeepSeek Harness')) {
        promptChars = Math.max(promptChars, value.length)
      }
    }
    // Only the deepest conversation steps interest us; skip the title request.
    if (usage && record.type === 'assistant/message') {
      steps.push({ index, ...usage, promptChars })
      if (first === null) first = steps.length
    }
  }
  rows.push({ file, records: records.length, steps, promptChars: Math.max(0, ...steps.map(step => step.promptChars)) })
}

let totalIn = 0
let totalCacheRead = 0
let totalOut = 0
let totalSteps = 0

for (const row of rows) {
  const name = row.file.split('\\').slice(-2)[0]
  console.log(`\n=== ${name} ===`)
  console.log(`records ${row.records} | prompt ~${row.promptChars} chars | steps with usage: ${row.steps.length}`)
  if (row.steps.length === 0) continue
  console.log('  step  input  cacheRead  cacheWrite  output   cacheHit%')
  for (const step of row.steps) {
    const hit = step.input > 0 ? ((step.cacheRead / step.input) * 100).toFixed(1) : '0.0'
    console.log(`  ${String(step.index).padStart(4)}  ${String(step.input).padStart(5)}  ${String(step.cacheRead).padStart(9)}  ${String(step.cacheWrite).padStart(10)}  ${String(step.output).padStart(6)}   ${hit.padStart(7)}`)
    totalIn += step.input
    totalCacheRead += step.cacheRead
    totalOut += step.output
    totalSteps += 1
  }
}

console.log('\n=== totals ===')
console.log(`steps            : ${totalSteps}`)
console.log(`input tokens     : ${totalIn}`)
console.log(`  of which cached: ${totalCacheRead} (${totalIn > 0 ? ((totalCacheRead / totalIn) * 100).toFixed(1) : '0'}%)`)
console.log(`  billed as new  : ${totalIn - totalCacheRead}`)
console.log(`output tokens    : ${totalOut}`)
void readFileSync
