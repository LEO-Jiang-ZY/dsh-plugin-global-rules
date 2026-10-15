/**
 * Extract the shipped Cordis runtime from app.asar into .vendor/node_modules, so
 * the integration test can boot a real Cordis Context and the real system-prompt
 * service without network access.
 *
 * The shipped app is the only place these packages exist on a normal install, so
 * this reads the asar archive directly (a small, self-contained reader; no external
 * dependency). Nothing is written outside this repository, and nothing is uploaded:
 * the extracted code is loaded from your own installation.
 *
 * Usage: node tools/vendor-cordis.mjs [destination]
 *
 *   DSH_ASAR   the archive to read. When unset, the usual install locations are tried,
 *              then the DSH home recorded in DSH_HOME / ~/.dsh.
 *
 * The integration tests skip when the runtime is absent, so this step is optional —
 * it only turns "skipped" into "actually verified against the real prompt registry".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DEST = process.argv[2] ?? join(root, '.vendor')

/** Candidate archive locations, most specific first. */
function asarCandidates() {
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  const candidates = []
  if (process.env.DSH_ASAR) candidates.push(process.env.DSH_ASAR)

  const relative = join('resources', 'app.asar')
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeekHarness'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'DeepSeekHarness'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'DeepSeekHarness'),
    process.env.ProgramData && join(process.env.ProgramData, 'DeepSeekHarness'),
    'D:\\DeepSeekHarness',
    'C:\\Program Files\\DeepSeekHarness',
    '/Applications/DeepSeekHarness.app/Contents',
    '/opt/DeepSeekHarness',
    home && join(home, 'DeepSeekHarness'),
  ].filter(Boolean)
  for (const base of roots) candidates.push(join(base, relative))

  // An unpacked install mentioned by DSH_APP_DIR.
  if (process.env.DSH_APP_DIR) candidates.push(join(process.env.DSH_APP_DIR, 'resources', 'app.asar'))
  return candidates
}

/** The first existing candidate, or `undefined`. */
function findAsar() {
  for (const candidate of asarCandidates()) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

const ASAR = findAsar()
if (ASAR === undefined) {
  process.stderr.write([
    'Could not find the DeepSeek Harness app.asar.',
    '',
    'Point this script at it explicitly:',
    '  $env:DSH_ASAR = "D:\\DeepSeekHarness\\resources\\app.asar"; node tools/vendor-cordis.mjs',
    '',
    'Tried:',
    ...asarCandidates().map(candidate => `  ${candidate}`),
    '',
    'This step is optional: without it the integration tests skip, and every other',
    'test still runs.',
    '',
  ].join('\n'))
  process.exit(1)
}
process.stdout.write(`reading ${ASAR}\n`)

/** Packages the integration test imports, plus their runtime dependencies. */
const WANTED = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@standard-schema/spec',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/schemastery',
]

const PREFIX = 'dsh/node_modules/'

const fd = readFileSync(ASAR)
// A real app.asar starts with a 16-byte header record. Anything else means the path
// is wrong (an unpacked directory, a partial download), so say that instead of
// failing later on a nonsense length.
if (fd.length < 32 || fd.readUInt32LE(0) !== 4) {
  process.stderr.write(`${ASAR} does not look like an asar archive (bad header).\n`)
  process.exit(1)
}
const declared = fd.readUInt32LE(8)
const region = fd.toString('utf8', 16, 16 + declared + 64)
let header = null
let consumed = 0
for (let length = declared - 8; length <= declared + 64; length += 1) {
  try {
    header = JSON.parse(region.slice(0, length))
    consumed = Buffer.byteLength(region.slice(0, length), 'utf8')
    break
  } catch { /* extend until the header JSON parses */ }
}
if (header === null) throw new Error('could not locate the asar header JSON end')
const baseOffset = 16 + consumed

const files = []
const stack = [[header, '']]
while (stack.length > 0) {
  const [node, prefix] = stack.pop()
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) stack.push([entry, path])
    else files.push({ path, size: Number(entry.size), offset: Number(entry.offset) })
  }
}

let written = 0
for (const wanted of WANTED) {
  const prefix = `${PREFIX}${wanted}/`
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue
    const target = join(DEST, 'node_modules', file.path.slice(PREFIX.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, fd.subarray(baseOffset + file.offset, baseOffset + file.offset + file.size))
    written += 1
  }
}
process.stdout.write(`vendored ${written} files into ${join(DEST, 'node_modules')}\n`)
