// Diagnostic: every element id app.js looks up must exist in index.html.
// A missing id used to mean a silently dead control, so this is worth checking
// directly. (web.test.mjs also asserts the markup contract.)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const app = readFileSync(join(here, 'web', 'app.js'), 'utf8')
const html = readFileSync(join(here, 'web', 'index.html'), 'utf8')

const ids = [...new Set([...app.matchAll(/el\('([A-Za-z0-9_]+)'\)/g)].map(match => match[1]))]
const missing = ids.filter(id => !html.includes(`id="${id}"`))

console.log(`${ids.length} ids referenced by app.js`)
console.log(missing.length === 0 ? 'all present in index.html' : `MISSING: ${missing.join(', ')}`)
process.exit(missing.length === 0 ? 0 : 1)
