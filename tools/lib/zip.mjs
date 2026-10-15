/**
 * Zip writing, implemented here rather than delegated to a platform tool.
 *
 * The reason is a real failure: `bsdtar -a -c -f out.zip` writes a *tar* on Linux,
 * because libarchive reads zip but does not write it. The result still passes a
 * casual `tar -tf`, and only `unzip` catches it, which is exactly what happened in
 * this project's release workflow.
 *
 * Writing the container directly gives the same bytes on every platform and makes the
 * output verifiable here, with the same tool a user would use.
 *
 * Format notes that matter, and that an earlier attempt in this repository got wrong:
 * - Local file header is 30 bytes, signature `PK\x03\x04`.
 * - Central directory entry is 46 bytes, signature `PK\x01\x02`.
 * - End of central directory is 22 bytes, signature `PK\x05\x06`, and its fields must
 *   describe the central directory that precedes it.
 * - General purpose flags: bit 11 (0x0800) marks UTF-8 file names. Do not set bit 3,
 *   which claims a data descriptor follows — that is what made an earlier archive read
 *   as "split or spanned" to Windows' extractor.
 *
 * @module tools/lib/zip
 */
import { deflateRawSync } from 'node:zlib'

/** CRC-32 lookup table, built once. */
let crcTable

/** CRC-32 of a buffer, as the zip format requires. */
export function crc32(buffer) {
  if (crcTable === undefined) {
    crcTable = new Int32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      crcTable[index] = value
    }
  }
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/** MS-DOS date and time, which the zip header stores in two 16-bit fields. */
function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f)
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
  return { time, day }
}

/**
 * Build a zip archive.
 *
 * @param entries - `[{ name, content }]`, names using forward slashes.
 * @param options - `{ modified }` timestamp for reproducible output; defaults to now.
 * @returns the archive bytes.
 */
export function buildZip(entries, options = {}) {
  const modified = options.modified ?? new Date()
  const { time, day } = dosDateTime(modified)

  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const content = entry.content
    const crc = crc32(content)

    // Compress, but keep the stored form when deflate does not help: a tiny file can
    // grow, and storing it keeps the archive honest about its size.
    const deflated = deflateRawSync(content, { level: 9 })
    const useDeflate = deflated.length < content.length
    const payload = useDeflate ? deflated : content
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)             // local file header signature
    local.writeUInt16LE(20, 4)                     // version needed to extract
    local.writeUInt16LE(0x0800, 6)                 // UTF-8 names; no data descriptor
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)        // compressed size
    local.writeUInt32LE(content.length, 22)        // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)                     // extra field length
    locals.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)           // central directory signature
    central.writeUInt16LE(0x031e, 4)               // version made by: unix, 3.0
    central.writeUInt16LE(20, 6)                   // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)                   // extra field length
    central.writeUInt16LE(0, 32)                   // comment length
    central.writeUInt16LE(0, 34)                   // disk number
    central.writeUInt16LE(0, 36)                   // internal attributes
    // External attributes hold the Unix mode in the high 16 bits.
    // `0o100644 << 16` overflows into a negative int32, which writeUInt32LE rejects,
    // so the pre-shifted constant is used directly.
    central.writeUInt32LE(0x81a40000, 38)          // mode 0644
    central.writeUInt32LE(offset, 42)              // offset of the local header
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + payload.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)                 // end of central directory signature
  end.writeUInt16LE(0, 4)                          // this disk
  end.writeUInt16LE(0, 6)                          // disk with central directory
  end.writeUInt16LE(entries.length, 8)             // entries on this disk
  end.writeUInt16LE(entries.length, 10)            // entries total
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)                    // central directory offset
  end.writeUInt16LE(0, 20)                         // comment length

  return Buffer.concat([...locals, centralBuffer, end])
}
