// Search a session log for literal content markers. Answers "did this text reach the
// model?" without depending on any heading or record shape.
//
// Usage: node tools/find-in-session.mjs <log.zstd> <marker> [marker...]
import { readSessionLog } from './session-log.mjs'

const [file, ...markers] = process.argv.slice(2)
if (!file || markers.length === 0) {
  console.error('usage: node tools/find-in-session.mjs <log.zstd> <marker> [marker...]')
  process.exit(2)
}

const { records, frames } = readSessionLog(file)
console.log(`${records.length} records across ${frames} frames\n`)

const collect = (node, out = [], depth = 0) => {
  if (depth > 16 || node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { for (const item of node) collect(item, out, depth + 1); return out }
  if (typeof node === 'object') { for (const value of Object.values(node)) collect(value, out, depth + 1) }
  return out
}

const strings = records.map((record, index) => ({ index, values: collect(record) }))

for (const marker of markers) {
  const hits = []
  for (const { index, values } of strings) {
    for (const value of values) {
      if (value.includes(marker)) hits.push(index)
    }
  }
  const unique = [...new Set(hits)]
  console.log(`${JSON.stringify(marker)}: ${unique.length} record(s)${unique.length ? ` -> ${unique.slice(0, 6).join(', ')}` : ''}`)
}
