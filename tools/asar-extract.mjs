// Extract one file from app.asar so its install logic can be read directly.
// Usage: node tools/asar-extract.mjs <asar-path> <inner-path> [--grep <pattern>]
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [asarPath, innerPath, ...rest] = process.argv.slice(2)
const fd = readFileSync(asarPath)
const declared = fd.readUInt32LE(8)
const region = fd.toString('utf8', 16, 16 + declared + 64)
let header = null
let consumed = 0
for (let length = declared - 8; length <= declared + 64; length += 1) {
  try {
    header = JSON.parse(region.slice(0, length))
    consumed = Buffer.byteLength(region.slice(0, length), 'utf8')
    break
  } catch { /* extend until the header JSON parses */ }
}
if (header === null) throw new Error('could not locate the asar header JSON end')
const baseOffset = 16 + consumed

let node = header
for (const part of innerPath.split('/')) {
  node = node?.files?.[part]
  if (node === undefined) throw new Error(`not found in archive: ${innerPath}`)
}
if (node.files) throw new Error(`${innerPath} is a directory`)

const bytes = fd.subarray(baseOffset + Number(node.offset), baseOffset + Number(node.offset) + Number(node.size))
const text = bytes.toString('utf8')

if (rest[0] === '--grep') {
  const pattern = new RegExp(rest[1], 'g')
  const lines = text.split('\n')
  let shown = 0
  for (const [index, line] of lines.entries()) {
    if (!pattern.test(line)) continue
    pattern.lastIndex = 0
    console.log(`${index + 1}: ${line.trim().slice(0, 190)}`)
    shown += 1
    if (shown >= Number(rest[2] ?? 40)) break
  }
  console.log(`\n(${shown} matching lines shown, file is ${text.length} chars)`)
} else if (rest[0] === '--lines') {
  const from = Number(rest[1])
  const to = Number(rest[2])
  const lines = text.split('\n')
  for (let index = from - 1; index < to && index < lines.length; index += 1) {
    console.log(`${String(index + 1).padStart(4)}: ${lines[index].slice(0, 200)}`)
  }
} else {
  const target = join(tmpdir(), innerPath.split('/').pop())
  writeFileSync(target, text, 'utf8')
  console.log(`wrote ${target} (${text.length} chars)`)
}
