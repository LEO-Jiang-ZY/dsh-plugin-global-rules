/**
 * Decode a DSH session log.
 *
 * The file is a sequence of **concatenated zstd frames**, one per append, not a single
 * frame. `zstdDecompressSync` stops after the first frame, so a naive read returns only
 * the session header — which silently looks like "the log has no prompts in it". This
 * module walks the frames using the zstd magic number.
 *
 * @module tools/session-log
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** zstd frame magic, little endian on disk. */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Read a session log into its records.
 * @param file - path to `session.v4.jsonl.zstd`.
 * @returns `{ records, frames, stoppedAt }`.
 */
export function readSessionLog(file) {
  const raw = readFileSync(file)
  const chunks = []
  let offset = 0
  let frames = 0

  for (let guard = 0; guard < 100_000 && offset < raw.length; guard += 1) {
    const remaining = raw.subarray(offset)
    try {
      chunks.push(zstdDecompressSync(remaining).toString('utf8'))
      frames += 1
    } catch {
      // A partially written tail frame: keep what decoded and stop.
      return { records: parse(chunks.join('')), frames, stoppedAt: offset }
    }
    const next = remaining.indexOf(MAGIC, 1)
    if (next === -1) break
    offset += next
  }
  return { records: parse(chunks.join('')), frames, stoppedAt: undefined }
}

/** Parse newline-delimited JSON, tolerating a truncated tail. */
function parse(text) {
  const records = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      malformed += 1
    }
  }
  return Object.assign(records, { malformed })
}
