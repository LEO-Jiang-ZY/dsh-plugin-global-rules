// Verify the documentation pair.
//
// The documentation is split into one file per language, cross-linked at the top:
// README.md is Chinese and README.en.md is English. Two files drift: a section gets
// added on one side, a link only works on the other, a fence is left open, a badge goes
// stale. These are the structural invariants that are cheap to check and easy to break.
//
// Usage: node tools/check-readme.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const FILES = [
  { path: 'README.md', language: 'Chinese', other: 'README.en.md', switcherPrefix: '**中文**' },
  { path: 'README.en.md', language: 'English', other: 'README.md', switcherPrefix: '[中文]' },
]

const failures = []
const note = message => failures.push(message)

/**
 * GitHub's heading-to-anchor rule: lower case, drop punctuation, spaces to hyphens.
 * Close enough to match every heading this project actually uses.
 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff -]/g, '')
    .replace(/\s+/g, '-')
}

/** Collect the anchors a file makes available: headings plus explicit ids. */
function anchorsOf(lines) {
  const anchors = new Set()
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) anchors.add(slugify(heading[1]))
    for (const id of line.matchAll(/id="([^"]+)"/g)) anchors.add(id[1].toLowerCase())
  }
  return anchors
}

/** Read one documentation file and report its structure. */
function inspect(file) {
  const path = join(root, file.path)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    note(`${file.path} is missing`)
    return undefined
  }
  const lines = text.split('\n')

  const fences = lines.filter(line => /^\s*```/.test(line)).length
  if (fences % 2 !== 0) note(`${file.path} has an unclosed code fence (${fences} markers)`)

  const headings = lines
    .filter(line => /^##\s/.test(line))
    .map(line => line.replace(/^##\s+/, '').trim())

  const anchors = anchorsOf(lines)
  const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map(match => match[1].toLowerCase())
  const broken = [...new Set(links)].filter(target => !anchors.has(target))
  for (const target of broken) note(`${file.path} has a broken internal link #${target}`)

  const badge = text.match(/tests-(\d+)%20passing/)
  const script = text.match(/npm test\s+#\s*(\d+)/)

  return {
    ...file,
    lines: lines.length,
    fences,
    headings,
    anchors,
    links: [...new Set(links)],
    badge: badge?.[1],
    testCount: script?.[1],
    text,
  }
}

const inspected = FILES.map(inspect).filter(Boolean)
if (inspected.length !== FILES.length) {
  console.log('a documentation file is missing')
  for (const failure of failures) console.log('  -', failure)
  process.exit(1)
}

for (const file of inspected) {
  console.log(`\n=== ${file.path} (${file.language}) ===`)
  console.log(`  lines            : ${file.lines}`)
  console.log(`  code fences      : ${file.fences}${file.fences % 2 === 0 ? ' (balanced)' : ' (UNBALANCED)'}`)
  console.log(`  sections         : ${file.headings.length}`)
  console.log(`  internal anchors : ${file.anchors.size} declared, ${file.links.length} linked`)
  console.log(`  test badge       : ${file.badge ?? 'none'}`)
  console.log(`  npm test comment : ${file.testCount ?? 'none'}`)

  // The switcher has to point at the other file, not at an anchor. An anchor link
  // would silently do nothing now that each language lives in its own file.
  const switcher = file.text.split('\n').find(line => line.includes(file.switcherPrefix))
  if (!switcher) {
    note(`${file.path} has no language switcher starting with ${file.switcherPrefix}`)
    console.log('  switcher         : MISSING')
  } else {
    console.log(`  switcher         : ${switcher.trim()}`)
    if (!switcher.includes(`(${file.other})`)) {
      note(`${file.path} switcher must link to ${file.other}, found: ${switcher.trim()}`)
    }
    if (/\]\(#/.test(switcher)) {
      note(`${file.path} switcher links to an anchor instead of the other file`)
    }
  }
}

/* ── the two files must describe the same document ────────────────────────── */

const [chinese, english] = inspected
if (chinese.headings.length !== english.headings.length) {
  note(`section count differs: ${chinese.headings.length} Chinese vs ${english.headings.length} English`)
}

console.log('\n=== pairing ===')
console.log(`  sections   : ${chinese.headings.length} / ${english.headings.length}`)
for (let index = 0; index < Math.max(chinese.headings.length, english.headings.length); index += 1) {
  const left = chinese.headings[index] ?? '(missing)'
  const right = english.headings[index] ?? '(missing)'
  console.log(`    ${String(index).padStart(2)}  ${left}  |  ${right}`)
}

if (chinese.badge !== english.badge) {
  note(`test badges disagree: ${chinese.badge} vs ${english.badge}`)
}
if (chinese.testCount !== english.testCount) {
  note(`npm test counts disagree: ${chinese.testCount} vs ${english.testCount}`)
}
console.log(`  badge      : ${chinese.badge} / ${english.badge}`)
console.log(`  npm test   : ${chinese.testCount} / ${english.testCount}`)

/* ── the Chinese half must still be the maintainer's own text ────────────── */

// A few phrases from the maintainer's wording polish, kept as a tripwire: if this file
// is ever regenerated from a retyped copy, these are the first things to disappear.
// The list covers prose only; the wording is the maintainer's to change.
const mustKeep = [
  '并且可以选择性关闭',
  '这是因为插件源码不在 HMR 的监视范围内',
  '但该镜像提供的是 npm 注册表里的包',
  '在「添加插件」的输入框中，填入解压后的目录的绝对路径',
  '脚本会完成三件事',
]
console.log('\nmaintainer wording still present:')
for (const phrase of mustKeep) {
  const present = chinese.text.includes(phrase)
  console.log(`  ${present ? 'ok   ' : 'LOST '} ${phrase}`)
  if (!present) note(`lost the maintainer's wording: ${phrase}`)
}

/* ── the claimed test count must match the suite ─────────────────────────── */

// Both files claim a test count in a badge and in the `npm test` comment. A stale
// number is the easiest documentation error to make and the cheapest to catch: count
// the `test(` declarations instead of trusting the prose.
const { readdirSync } = await import('node:fs')
let declared = 0
for (const entry of readdirSync(join(root, 'tests'))) {
  if (!entry.endsWith('.test.mjs')) continue
  const source = readFileSync(join(root, 'tests', entry), 'utf8')
  declared += (source.match(/^test\(/gm) ?? []).length
  declared += (source.match(/^testCase\(/gm) ?? []).length
}
console.log(`\ndeclared tests in tests/ : ${declared}`)
for (const file of inspected) {
  if (file.badge !== undefined && Number(file.badge) !== declared) {
    note(`${file.path} badge says ${file.badge} but tests/ declares ${declared}`)
  }
  if (file.testCount !== undefined && Number(file.testCount) !== declared) {
    note(`${file.path} npm test comment says ${file.testCount} but tests/ declares ${declared}`)
  }
}

console.log('')
if (failures.length === 0) {
  console.log('documentation pair is consistent')
} else {
  console.log(`${failures.length} problem(s):`)
  for (const failure of failures) console.log('  -', failure)
}
process.exit(failures.length === 0 ? 0 : 1)
