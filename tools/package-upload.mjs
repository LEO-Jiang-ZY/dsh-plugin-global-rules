/**
 * Build an upload-ready package for someone who has no Git installed.
 *
 * GitHub's web uploader ignores dotfiles, so a plain upload of the checkout would
 * silently drop `.github/`, which carries the CI and release workflows. This script
 * stages two things instead:
 *
 *   dist/upload/plugin-files/   everything to drag into the repository
 *   dist/upload/dotfiles.zip    `.github/` and `.gitignore`, added in one more step
 *
 * Usage: node tools/package-upload.mjs [--out <dir>]
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const outIndex = process.argv.indexOf('--out')
const baseDir = outIndex === -1 ? join(root, 'dist', 'upload') : process.argv[outIndex + 1]
const filesDir = join(baseDir, 'plugin-files')

/** Directories never uploaded: build output, the extracted runtime, editor state. */
const SKIP_DIRS = new Set(['.git', '.github', '.vendor', 'dist', 'node_modules', '.dsh', 'docs'])
const SKIP_FILES = new Set(['.test-report.txt', '.gitignore'])

/** Collect every file to upload, as paths relative to the plugin root. */
function collect(dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collect(absolute, out)
      continue
    }
    if (SKIP_FILES.has(entry.name)) continue
    out.push(relative(root, absolute).split('\\').join('/'))
  }
  return out
}

/** Run a command, inheriting stdio so piping restrictions cannot bite. */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  return result.error === undefined && result.status === 0
}

rmSync(baseDir, { recursive: true, force: true })
mkdirSync(filesDir, { recursive: true })

const files = collect()
for (const file of files) {
  const target = join(filesDir, file)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(root, file), target)
}

// `.gitignore` and `.github/` share one archive, so adding them costs one more
// drag-and-drop rather than several rounds of creating folders in the web editor.
const dotStage = join(baseDir, '.dotstage')
mkdirSync(dotStage, { recursive: true })
cpSync(join(root, '.gitignore'), join(dotStage, '.gitignore'))
cpSync(join(root, '.github'), join(dotStage, '.github'), { recursive: true })

const dotfilesZip = join(baseDir, 'dotfiles.zip')
const dotfilesPackaged = process.platform === 'win32'
  ? run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath '${join(dotStage, '.github')}','${join(dotStage, '.gitignore')}' -DestinationPath '${dotfilesZip}' -Force`,
  ])
  : run('tar', ['-a', '-c', '-f', dotfilesZip, '-C', dotStage, '.github', '.gitignore'])
rmSync(dotStage, { recursive: true, force: true })

// A short note the user can keep beside the staging folder.
writeFileSync(join(baseDir, 'UPLOAD-NOTES.txt'), [
  `repository : https://github.com/LEO-Jiang-ZY/${pkg.name}`,
  `version    : ${pkg.version}`,
  `files      : ${files.length}`,
  '',
  '1. plugin-files/  -> drag the CONTENTS into the empty repository, then commit.',
  '2. dotfiles.zip   -> extract it, then drag .github/ into the repository and',
  '                     commit again. The web uploader cannot see dotfiles, so this',
  '                     second step is what puts CI and the release workflow in place.',
  '',
  'Both files stay inside the repository root: .github/ and .gitignore, not nested',
  'under a folder.',
  '',
].join('\n'))

process.stdout.write([
  `staged ${files.length} files for upload`,
  '  dist/upload/plugin-files/   drag the contents into the empty repository',
  dotfilesPackaged
    ? '  dist/upload/dotfiles.zip    add .github/ and .gitignore in a second step'
    : '  dotfiles.zip was NOT produced; add .github/ and .gitignore by hand',
  '  dist/upload/UPLOAD-NOTES.txt',
  '',
].join('\n'))
