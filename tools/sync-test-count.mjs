// Keep the documented test count equal to the real one.
//
// Both documentation files state the count in two places: a badge and an `npm test`
// comment. Adding a test therefore leaves four numbers stale at once, and a stale number
// is the easiest documentation error to make. This rewrites them from the suite itself.
//
// Usage:
//   node tools/sync-test-count.mjs           rewrite the counts
//   node tools/sync-test-count.mjs --check   report only, non-zero exit when stale
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const check = process.argv.includes('--check')

/** Count the test cases the suite declares. */
function declaredTests() {
  let total = 0
  for (const entry of readdirSync(join(root, 'tests'))) {
    if (!entry.endsWith('.test.mjs')) continue
    const source = readFileSync(join(root, 'tests', entry), 'utf8')
    total += (source.match(/^test\(/gm) ?? []).length
    total += (source.match(/^testCase\(/gm) ?? []).length
  }
  return total
}

const expected = declaredTests()
if (expected === 0) {
  console.error('no tests were found; refusing to write a count of zero')
  process.exit(1)
}

const FILES = ['README.md', 'README.en.md']
const stale = []

for (const file of FILES) {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  // A badge link and an `npm test` comment, in both languages.
  const after = before
    .replace(/(tests-)\d+(%20passing)/g, `$1${expected}$2`)
    .replace(/(npm test\s+#\s*)\d+/g, `$1${expected}`)
    .replace(/(npm test\s+#\s*)\d+(\s*(?:tests|项))/g, `$1${expected}$2`)
  if (after !== before) {
    stale.push(file)
    if (!check) writeFileSync(path, after, 'utf8')
  }
}

if (stale.length === 0) {
  console.log(`test count is current: ${expected}`)
  process.exit(0)
}

if (check) {
  console.error(`the documented test count is stale; the suite declares ${expected}`)
  for (const file of stale) console.error(`  ${file}`)
  console.error('run: node tools/sync-test-count.mjs')
  process.exit(1)
}

console.log(`updated the documented test count to ${expected}:`)
for (const file of stale) console.log(`  ${file}`)
