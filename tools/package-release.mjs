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
 * The archives are produced by a real archiver (`Compress-Archive`, `tar`) rather than
 * a hand-rolled binary writer. A hand-written zip is easy to get subtly wrong, and a
 * corrupt release archive is the worst place to discover that.
 *
 * Usage: node tools/package-release.mjs [--out <dir>]
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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

/**
 * Run an external command, inheriting stdio.
 *
 * Stdio is inherited rather than piped on purpose: capturing another program's output
 * through a pipe is blocked in some sandboxes, while inheriting works everywhere.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`)
  }
}

/**
 * Copy the shipped files into a staging folder.
 *
 * Staging first is what gives both archives a single top-level directory, so
 * extracting one cannot scatter files into whatever directory is current.
 */
function stage(target) {
  mkdirSync(target, { recursive: true })
  for (const file of collect()) {
    const destination = join(target, file)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(join(root, file)))
  }
}

const files = collect()
if (files.length === 0) throw new Error('nothing to package')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const stageDir = join(outDir, '.stage')
stage(join(stageDir, folderName))

const zipPath = join(outDir, `${folderName}.zip`)
const isWindows = process.platform === 'win32'

if (isWindows) {
  // Compress-Archive is part of Windows PowerShell and writes a conventional zip.
  run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath '${join(stageDir, folderName)}' -DestinationPath '${zipPath}' -Force`,
  ])
} else {
  // bsdtar writes zip when the destination name ends in .zip.
  run('tar', ['-a', '-c', '-f', zipPath, '-C', stageDir, folderName])
}

const tarPath = join(outDir, `${folderName}.tar.gz`)
run('tar', ['-c', '-z', '-f', tarPath, '-C', stageDir, folderName])

rmSync(stageDir, { recursive: true, force: true })

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
