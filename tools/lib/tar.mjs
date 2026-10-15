/**
 * Tar writing, implemented here for the same reason as the zip writer: the archive a
 * release publishes should be byte-identical on every platform and verifiable locally,
 * not dependent on whichever `tar` happens to be installed.
 *
 * The output is a POSIX ustar archive compressed with gzip, which is what
 * `plugin_manager` fetches when it is handed a `.tar.gz` URL.
 *
 * @module tools/lib/tar
 */
import { deflateRawSync } from 'node:zlib'

import { crc32 } from './zip.mjs'

/** Write an octal field the way ustar expects: zero padded, NUL terminated. */
function writeOctal(header, value, offset, length) {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, 'ascii')
}

/**
 * Wrap a buffer in a gzip container.
 *
 * Assembled by hand rather than with `gzipSync` because the trailer's CRC and length
 * have to describe the uncompressed tar, and `gzipSync` writes its trailer as part of
 * producing the stream. Building both ends here is simpler than patching bytes
 * afterwards.
 *
 * @param input - the uncompressed data.
 * @returns the gzip stream.
 */
function gzip(input) {
  const header = Buffer.from([
    0x1f, 0x8b, // magic
    0x08,       // compression method: deflate
    0x00,       // flags: no name, no comment
    0x00, 0x00, 0x00, 0x00, // mtime: zero for reproducible output
    0x00,       // extra flags
    0xff,       // OS: unknown
  ])
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(crc32(input), 0)
  trailer.writeUInt32LE(input.length, 4)
  return Buffer.concat([header, deflateRawSync(input, { level: 9 }), trailer])
}

/**
 * Build a gzipped tar archive.
 *
 * @param entries - `[{ name, content }]`, names using forward slashes.
 * @param options - `{ modified, mode }`; the timestamp defaults to now.
 * @returns the archive bytes.
 */
export function buildTarGz(entries, options = {}) {
  const modified = Math.floor((options.modified ?? new Date()).getTime() / 1000)
  const blocks = []

  for (const entry of entries) {
    const content = entry.content
    const header = Buffer.alloc(512)

    // ustar splits long paths into a prefix and a name; anything else must be refused
    // rather than silently truncated, because a truncated path extracts to the wrong
    // place.
    const name = Buffer.from(entry.name, 'utf8')
    if (name.length > 100) {
      const cut = entry.name.lastIndexOf('/', 155)
      const prefix = cut === -1 ? '' : entry.name.slice(0, cut)
      const rest = cut === -1 ? entry.name : entry.name.slice(cut + 1)
      if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(rest) > 100) {
        throw new Error(`path is too long for a ustar archive: ${entry.name}`)
      }
      header.write(prefix, 345, 'utf8')
      header.write(rest, 0, 'utf8')
    } else {
      name.copy(header, 0)
    }

    writeOctal(header, options.mode ?? 0o644, 100, 8)   // mode
    writeOctal(header, 0, 108, 8)                       // uid
    writeOctal(header, 0, 116, 8)                       // gid
    writeOctal(header, content.length, 124, 12)         // size
    writeOctal(header, modified, 136, 12)               // mtime
    header.write('        ', 148, 'ascii')              // checksum placeholder: 8 spaces
    header.write('0', 156, 'ascii')                     // type: regular file
    header.write('ustar\0', 257, 'ascii')               // magic
    header.write('00', 263, 'ascii')                    // version

    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')

    blocks.push(header, content)
    const padding = (512 - (content.length % 512)) % 512
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }

  // Two zero blocks terminate the archive.
  blocks.push(Buffer.alloc(1024))

  return gzip(Buffer.concat(blocks))
}
