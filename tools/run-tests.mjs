/**
 * Test harness for confined Windows sessions.
 *
 * `node --test` normally forks a child per file and hands it piped stdio, which a
 * sandbox that forbids named pipes refuses with EPERM — and passing
 * `stdio: 'inherit'` does not help, because the runner itself forks.
 *
 * `--test-isolation=none` is the working configuration: the runner executes every
 * case in one in-process batch, so no child is ever spawned. `--test-concurrency=1`
 * keeps the output ordered and the failures readable.
 *
 * Usage (from the plugin root):
 *   node tools/run-tests.mjs
 *   DSH_TEST_TIMEOUT_MS  per-case deadline passed to the runner (default 30000)
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testsDir = join(root, 'tests')

const targets = readdirSync(testsDir)
  .filter(file => file.endsWith('.test.mjs'))
  .sort()
  .map(file => join(testsDir, file))

if (targets.length === 0) {
  console.error('no test files found in tests/')
  process.exit(1)
}

const timeout = Number(process.env.DSH_TEST_TIMEOUT_MS ?? 30_000)

// `stdio: 'inherit'` is permitted here and keeps the runner's own output intact;
// nothing is captured through a pipe.
const child = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-isolation=none',
    '--test-concurrency=1',
    `--test-timeout=${timeout}`,
    '--test-reporter=spec',
    ...targets,
  ],
  { cwd: root, timeout: timeout * targets.length + 60_000, stdio: 'inherit' },
)

if (child.error) {
  console.error(`FAIL could not run the test runner: ${child.error.message}`)
  process.exit(1)
}
if (child.signal !== null || child.status === null) {
  console.error('FAIL the test runner was killed before it reported')
  process.exit(1)
}
process.exit(child.status)
