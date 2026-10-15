/**
 * Replace the `OWNER` placeholder with your GitHub account name.
 *
 * The repository ships with `OWNER` in the URLs users are told to paste: the README
 * install instructions, the package metadata, the changelog links, and the issue
 * template link. Each of those must name the real account for the install paths to
 * work, and hand-editing several files is how one of them gets missed.
 *
 * Usage:
 *   node tools/set-owner.mjs <owner>            # replace OWNER with <owner>
 *   node tools/set-owner.mjs <owner> --check    # report only, change nothing
 *   node tools/set-owner.mjs --status           # show what is currently configured
 *
 * `<owner>` is either `account` or `account/repository`; the repository name defaults
 * to the directory name, which is also the package name.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Files that carry a user-facing URL. */
const FILES = [
  'README.md',
  'package.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'install.ps1',
  '.github/ISSUE_TEMPLATE/config.yml',
]

/** A GitHub account name, optionally with a repository. */
const OWNER_PATTERN = /^(?<owner>[A-Za-z0-9][A-Za-z0-9-]{0,38})(?:\/(?<repo>[A-Za-z0-9._-]+))?$/

const args = process.argv.slice(2)
const check = args.includes('--check')
const status = args.includes('--status')
const value = args.find(argument => !argument.startsWith('--'))

if (status) {
  const sample = readFileSync(join(root, 'README.md'), 'utf8')
  const found = sample.match(/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)/)
  if (found) console.log(`configured: ${found[1]}/${found[2]}`)
  else if (sample.includes('OWNER')) console.log('not configured yet: the placeholder OWNER is still in place')
  else console.log('no GitHub URL found in README.md')
  process.exit(0)
}

if (!value) {
  console.error('usage: node tools/set-owner.mjs <owner>[/<repository>] [--check]')
  process.exit(2)
}

const match = OWNER_PATTERN.exec(value)
if (!match) {
  console.error(`"${value}" is not a GitHub account name`)
  process.exit(2)
}
const owner = match.groups.owner
const repo = match.groups.repo ?? pkg.name

const changes = []
for (const file of FILES) {
  const path = join(root, file)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  const before = text
  const count = (before.match(/OWNER/g) ?? []).length
  if (count === 0) continue
  // Replace every mention, not just whole URLs: the placeholder also appears in prose
  // and in shell comments, and a leftover "OWNER" in an instruction users follow is
  // exactly the kind of thing that looks like a bug in the project.
  const next = before.split('OWNER').join(owner)
  changes.push({ file, count })
  if (!check) writeFileSync(path, next, 'utf8')
}

if (changes.length === 0) {
  console.log('nothing to change: no placeholder left in any file')
  process.exit(0)
}

const total = changes.reduce((sum, change) => sum + change.count, 0)
console.log(`${check ? 'would replace' : 'replaced'} ${total} placeholder(s) with ${owner}/${repo}:`)
for (const change of changes) console.log(`  ${change.file}  (${change.count})`)

// A repository name other than the package name also affects the URLs.
if (repo !== pkg.name && !check) {
  for (const file of FILES) {
    const path = join(root, file)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (!text.includes(pkg.name)) continue
    writeFileSync(path, text.split(pkg.name).join(repo), 'utf8')
    console.log(`  ${file}: repository name ${pkg.name} -> ${repo}`)
  }
}

if (check) {
  console.log('\nrun again without --check to apply')
  process.exit(0)
}

console.log('\nNext:')
console.log('  git init && git add -A && git commit -m "首个公开版本"')
console.log(`  git remote add origin https://github.com/${owner}/${repo}.git`)
console.log('  git push -u origin main')
console.log('  git tag v' + pkg.version + ' && git push origin v' + pkg.version)
console.log('\nThe tag push lets .github/workflows/release.yml publish the archives, after which')
console.log('the install instructions in README.md work as written.')
