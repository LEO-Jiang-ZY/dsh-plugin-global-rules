// Verify the bilingual README stays in step.
//
// The file carries the same documentation twice, once in Chinese and once in English.
// Two copies drift: a section gets added on one side, a link only works on the other,
// a code fence is left open. This checks the structural invariants that are cheap to
// verify and easy to break.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const text = readFileSync(join(root, 'README.md'), 'utf8')
const lines = text.split('\n')

const failures = []
const note = (message) => failures.push(message)

/* ── fence balance ───────────────────────────────────────────────────────── */

const fences = lines.filter(line => /^\s*```/.test(line)).length
console.log(`code fences: ${fences}${fences % 2 === 0 ? ' (balanced)' : ' (UNBALANCED)'}`)
if (fences % 2 !== 0) note('an unclosed code fence')

/* ── the two language halves ─────────────────────────────────────────────── */

const englishAnchor = lines.findIndex(line => line.includes('id="english"'))
const chineseAnchor = lines.findIndex(line => line.includes('id="chinese"'))
console.log(`anchors: chinese at line ${chineseAnchor + 1}, english at line ${englishAnchor + 1}`)
if (chineseAnchor === -1) note('missing the Chinese anchor')
if (englishAnchor === -1) note('missing the English anchor')

const chinese = lines.slice(chineseAnchor, englishAnchor).join('\n')
const english = lines.slice(englishAnchor).join('\n')

/* ── headings: the same set on both sides ────────────────────────────────── */

const headings = (block) =>
  block.split('\n')
    .filter(line => /^##\s/.test(line))
    .map(line => line.replace(/^##\s+/, '').trim())

const zhHeadings = headings(chinese)
const enHeadings = headings(english)
console.log(`\nChinese sections: ${zhHeadings.length}`)
console.log(`English sections: ${enHeadings.length}`)
if (zhHeadings.length !== enHeadings.length) {
  note(`section count differs: ${zhHeadings.length} vs ${enHeadings.length}`)
}
console.log('\n  #  Chinese                     English')
const width = Math.max(...zhHeadings.map(h => [...h].length))
for (let i = 0; i < Math.max(zhHeadings.length, enHeadings.length); i += 1) {
  const zh = zhHeadings[i] ?? '(missing)'
  const en = enHeadings[i] ?? '(missing)'
  console.log(`  ${String(i).padStart(2)} ${zh.padEnd(width + 4)} ${en}`)
}

/* ── every link target exists ────────────────────────────────────────────── */

const slugs = new Set(
  lines
    .filter(line => /^#{1,3}\s/.test(line))
    .map(line => line.replace(/^#+\s+/, '').trim().toLowerCase().replace(/[^\w\u4e00-\u9fff -]/g, '').replace(/\s+/g, '-')),
)
for (const line of lines) {
  if (!line.includes('id="')) continue
  const id = line.match(/id="([^"]+)"/)[1]
  slugs.add(id)
}

const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map(match => match[1])
const broken = [...new Set(links)].filter(target => !slugs.has(target.toLowerCase()))
console.log(`\ninternal links: ${new Set(links).size} distinct, broken: ${broken.length}`)
if (broken.length > 0) {
  for (const target of broken) note(`broken link #${target}`)
  console.log('  ' + broken.join(', '))
}

/* ── the Chinese half must still be the author's own text ────────────────── */

// A few phrases from the maintainer's wording polish, kept as a tripwire: if a
// regeneration of this file ever replaces the Chinese half with a retyped copy, these
// are the first things to disappear.
//
// This list is deliberately short and only covers prose. It is not a request to keep
// any particular sentence: the wording is the maintainer's to change.
const mustKeep = [
  '并且可以选择性关闭',
  '这是因为插件源码不在 HMR 的监视范围内',
  '但该镜像提供的是 npm 注册表里的包',
  '在「添加插件」的输入框中，填入解压后的目录的绝对路径',
  '脚本会完成三件事',
]
console.log('\nmaintainer wording still present:')
for (const phrase of mustKeep) {
  const present = chinese.includes(phrase)
  console.log(`  ${present ? 'ok   ' : 'LOST '} ${phrase}`)
  if (!present) note(`lost the maintainer's wording: ${phrase}`)
}

console.log('')
if (failures.length === 0) {
  console.log('README structure is consistent')
} else {
  console.log(`${failures.length} problem(s):`)
  for (const failure of failures) console.log('  -', failure)
}
process.exit(failures.length === 0 ? 0 : 1)
