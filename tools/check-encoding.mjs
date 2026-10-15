// Byte-level check of a text file: is it valid UTF-8, and is its content mojibake
// produced by decoding UTF-8 bytes as GBK and re-encoding as UTF-8?
//
// Usage: node tools/check-encoding.mjs <file> [utf8|utf16le|gbk]
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
const mode = process.argv[3] ?? 'utf8'
const bytes = readFileSync(file)

console.log(`file        : ${file}`)
console.log(`bytes       : ${bytes.length}`)
console.log(`BOM         : ${bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'none'}`)

const utf8 = bytes.toString('utf8')
const roundTrip = Buffer.from(utf8, 'utf8').equals(bytes)
console.log(`valid UTF-8 : ${roundTrip}`)
console.log(`first line  : ${JSON.stringify(utf8.split('\n')[0])}`)

// Code-point histogram: CJK means real Chinese; the U+FFFD replacement char means
// the bytes were not UTF-8; a wall of rare CJK in the U+9000-U+9FFF block mixed with
// Latin-1 punctuation is the signature of UTF-8-read-as-GBK mojibake.
let cjk = 0
let replacement = 0
let latin = 0
for (const character of utf8) {
  const code = character.codePointAt(0)
  if (code === 0xfffd) replacement += 1
  else if (code >= 0x4e00 && code <= 0x9fff) cjk += 1
  else if (code < 0x80) latin += 1
}
console.log(`code points : cjk=${cjk} ascii=${latin} replacement=${replacement}`)

/** Reverse the classic corruption: utf8 -> (bytes read as gbk) -> utf8. */
function undo() {
  const gbk = new TextDecoder('gbk', { fatal: true })
  // The corrupted text's bytes, interpreted as GBK, reproduce the original UTF-8 bytes.
  const original = gbk.decode(Buffer.from(utf8, 'utf8'))
  return original
}

try {
  const repaired = undo()
  console.log(`\nGBK round-trip SUCCEEDS -> the file is recoverable`)
  console.log(`--- repaired ---`)
  console.log(repaired.slice(0, 700))
  if (process.argv[4] === '--write') {
    const target = process.argv[5]
    if (target) {
      writeFileSync(target, repaired, 'utf8')
      console.log(`\nwritten to ${target}`)
    }
  }
} catch (error) {
  console.log(`\nGBK round-trip failed: ${error.message}`)
  console.log('the file is NOT simple GBK mojibake; a preview follows')
  console.log(utf8.slice(0, 500))
}
void mode
