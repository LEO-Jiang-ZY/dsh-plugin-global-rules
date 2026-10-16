/**
 * Build the distributable archives a GitHub release publishes.
 *
 *   dist/dsh-plugin-global-rules-v<version>.zip       Windows-friendly, one top-level folder
 *   dist/dsh-plugin-global-rules-v<version>.tar.gz    what `plugin_manager` fetches by URL
 *   dist/dsh-plugin-global-rules-v<version>.sha256    checksums for both
 *
 * Both archives are installable as-is: extract the zip and point DSH at the folder by
 * absolute path, or hand `plugin_manager` the `.tar.gz` URL. Nothing has to be built
 * first, because `lib/client.js` is written by hand rather than generated.
 *
 * The archives are written by `tools/lib/zip.mjs` and `tools/lib/tar.mjs` rather than by
 * a platform tool. Both reasons are concrete failures this project hit:
 * `bsdtar -a -c -f out.zip` silently writes a *tar* on Linux, so the release asset was
 * not a zip at all, and a hand-written zip with the wrong general purpose flags read as
 * "split or spanned" to Windows' extractor. Doing the container here gives identical
 * bytes everywhere and lets the output be verified locally.
 *
 * Usage: node tools/package-release.mjs [--out <dir>]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTarGz } from './lib/tar.mjs'
import { buildZip } from './lib/zip.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const outIndex = process.argv.indexOf('--out')
const outDir = outIndex === -1 ? join(root, 'dist') : process.argv[outIndex + 1]
const folderName = `${pkg.name}-v${pkg.version}`

/** Everything the plugin needs at runtime, plus the docs and tests a user may want. */
const INCLUDE = [
  'index.js',
  'package.json',
  'cordis.patch.yml',
  'install.ps1',
  'lib',
  'web',
  'examples',
  'tools',
  'tests',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
]

/** Never shipped, even when present in the checkout. */
const EXCLUDE_DIRS = new Set(['.git', '.github', '.vendor', 'dist', 'node_modules', '.dsh', 'docs'])
const EXCLUDE_FILES = new Set(['.test-report.txt'])

/** Every file to ship, as paths relative to the plugin root. */
function collect() {
  const files = []
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(join(absolute, entry.name))
        continue
      }
      if (EXCLUDE_FILES.has(entry.name) || entry.name.startsWith('.')) continue
      files.push(relative(root, join(absolute, entry.name)).split('\\').join('/'))
    }
  }
  for (const entry of INCLUDE) {
    const absolute = join(root, entry)
    if (!existsSync(absolute)) {
      process.stderr.write(`warning: ${entry} is missing and will not be packaged\n`)
      continue
    }
    if (statSync(absolute).isDirectory()) walk(absolute)
    else files.push(entry)
  }
  return files.sort()
}

const files = collect()
if (files.length === 0) throw new Error('nothing to package')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// One top-level folder inside both archives, so extracting one cannot scatter files
// into whatever directory happens to be current.
const entries = files.map(file => ({
  name: `${folderName}/${file}`,
  content: readFileSync(join(root, file)),
}))

// A fixed timestamp keeps the archives reproducible: two builds of the same commit
// produce the same checksum, so a published checksum actually means something.
const modified = new Date(Date.UTC(1980, 0, 1))

const zipPath = join(outDir, `${folderName}.zip`)
writeFileSync(zipPath, buildZip(entries, { modified }))

const tarPath = join(outDir, `${folderName}.tar.gz`)
writeFileSync(tarPath, buildTarGz(entries, { modified }))

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(outDir, `${folderName}.sha256`), [
  `${sha256(zipPath)}  ${folderName}.zip`,
  `${sha256(tarPath)}  ${folderName}.tar.gz`,
  '',
].join('\n'))

process.stdout.write([
  `packaged ${files.length} files as ${pkg.name} v${pkg.version}`,
  `  dist/${folderName}.zip       ${(statSync(zipPath).size / 1024).toFixed(0)} KiB`,
  `  dist/${folderName}.tar.gz    ${(statSync(tarPath).size / 1024).toFixed(0)} KiB`,
  `  dist/${folderName}.sha256`,
  '',
  `archive root: ${folderName}/`,
  ...files.slice(0, 10).map(file => `  ${file}`),
  files.length > 10 ? `  ... and ${files.length - 10} more` : '',
  '',
].filter(Boolean).join('\n'))
