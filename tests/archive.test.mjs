// The release archives must be the format their names claim.
//
// This guards a failure that reached the release workflow: `bsdtar -a -c -f out.zip`
// writes a *tar* on Linux, because libarchive reads zip but does not write it. The file
// has a .zip name and `tar -tf` lists it happily, so only a real zip reader notices.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildTarGz } from '../tools/lib/tar.mjs'
import { buildZip, crc32 } from '../tools/lib/zip.mjs'

const sample = [
  { name: 'folder/a.txt', content: Buffer.from('hello\n', 'utf8') },
  { name: 'folder/nested/b.md', content: Buffer.from('# 中文内容\n', 'utf8') },
  // Long enough that deflate actually shrinks it, exercising the compressed path.
  { name: 'folder/big.txt', content: Buffer.from('abcdefghij\n'.repeat(500), 'utf8') },
]

test('the zip writer produces an archive a zip reader accepts', () => {
  const buffer = buildZip(sample)
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, 'must start with a local file header')

  // The end-of-central-directory record must exist and describe the central directory.
  let eocd = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  assert.ok(eocd > 0, 'an end-of-central-directory record is required')
  assert.equal(buffer.readUInt16LE(eocd + 10), sample.length, 'the entry count must match')
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50, 'the recorded offset must point at the central directory')

  // Bit 3 claims a trailing data descriptor. Setting it makes Windows' extractor reject
  // the archive as "split or spanned", so it must stay clear.
  assert.equal(buffer.readUInt16LE(6) & 0x0008, 0, 'the data descriptor flag must not be set')
  // Bit 11 marks UTF-8 names, which the Chinese path relies on.
  assert.equal(buffer.readUInt16LE(6) & 0x0800, 0x0800, 'file names are UTF-8')

  // Walk the local headers by offset rather than searching for the names: the same name
  // appears twice (local header and central directory), and a plain search can land on
  // the wrong one, where the fields sit at different offsets.
  let offset = 0
  for (const entry of sample) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50, `expected a local header for ${entry.name}`)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength)
    assert.equal(name, entry.name)
    assert.equal(buffer.readUInt32LE(offset + 14), crc32(entry.content), `CRC mismatch for ${entry.name}`)
    assert.equal(buffer.readUInt32LE(offset + 22), entry.content.length, `size mismatch for ${entry.name}`)
    offset += 30 + nameLength + extraLength + buffer.readUInt32LE(offset + 18)
  }
})

test('the zip writer round-trips through a real extractor', () => {
  // A real extraction, not just header inspection. PowerShell is used on Windows,
  // `unzip -t` elsewhere; both are what a user would actually run.
  const dir = mkdtempSync(join(tmpdir(), 'gr-zip-'))
  try {
    const archive = join(dir, 'sample.zip')
    writeFileSync(archive, buildZip(sample))
    const target = join(dir, 'out')
    mkdirSync(target)

    if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`,
      ], { stdio: 'inherit' })
    } else {
      execFileSync('unzip', ['-q', archive, '-d', target], { stdio: 'inherit' })
    }

    for (const entry of sample) {
      const extracted = join(target, entry.name)
      assert.ok(existsSync(extracted), `${entry.name} must extract`)
      assert.deepEqual(readFileSync(extracted), entry.content, `${entry.name} must survive the round trip`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the tar writer produces a gzip stream a tar reader accepts', () => {
  const buffer = buildTarGz(sample)
  assert.equal(buffer[0], 0x1f, 'gzip magic byte 1')
  assert.equal(buffer[1], 0x8b, 'gzip magic byte 2')
  assert.equal(buffer[2], 0x08, 'the compression method must be deflate')

  const dir = mkdtempSync(join(tmpdir(), 'gr-tar-'))
  try {
    const archive = join(dir, 'sample.tar.gz')
    writeFileSync(archive, buffer)
    const target = join(dir, 'out')
    mkdirSync(target)
    execFileSync('tar', ['-x', '-z', '-f', archive, '-C', target], { stdio: 'inherit' })

    for (const entry of sample) {
      const extracted = join(target, entry.name)
      assert.ok(existsSync(extracted), `${entry.name} must extract`)
      assert.deepEqual(readFileSync(extracted), entry.content, `${entry.name} must survive the round trip`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the release builder depends on no platform archiver', () => {
  // The whole point of writing the containers here: `tar` on Windows and `tar` on Linux
  // do not agree, and `bsdtar` cannot write zip at all.
  const source = readFileSync(new URL('../tools/package-release.mjs', import.meta.url), 'utf8')
  assert.match(source, /from '\.\/lib\/zip\.mjs'/)
  assert.match(source, /from '\.\/lib\/tar\.mjs'/)
  assert.doesNotMatch(source, /spawnSync|execFileSync|Compress-Archive/, 'no external archiver')
  assert.doesNotMatch(source, /'tar'|"tar"|powershell/, 'no platform tool may be invoked')
})
