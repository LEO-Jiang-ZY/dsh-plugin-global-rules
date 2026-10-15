/**
 * Test harness that works both in CI and in a sandbox that forbids pipes.
 *
 * `node --test` normally forks a child process per file and hands it piped stdio.
 * A sandbox that forbids named pipes refuses that with EPERM, and passing
 * `stdio: 'inherit'` does not help, because the runner itself does the forking.
 *
 * `--test-isolation=none` is the configuration that works there: the runner executes
 * every case in one in-process batch, so no child is ever spawned. That flag is only
 * available on recent Node versions, so it is applied when supported and skipped
 * otherwise — on an older runtime the tests still run correctly, just with isolation.
 *
 * Usage (from the plugin root):
 *   node tools/run-tests.mjs
 *
 * Environment:
 *   DSH_TEST_TIMEOUT_MS   per-case deadline passed to the runner (default 30000)
 *   DSH_TEST_ISOLATION    force the isolation mode: none, process, or auto (default)
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

/**
 * Whether `--test-isolation` exists on this runtime.
 *
 * Reading the version is cheaper and more reliable than running the flag and parsing
 * the failure: `node --test --test-isolation=none` on an unsupported version exits
 * with code 9 and prints "bad option", which is easy to mistake for a test failure.
 * The flag arrived in Node 24; this machine and CI both agree with that boundary.
 */
function supportsIsolationFlag() {
  const [major] = process.versions.node.split('.').map(Number)
  return major >= 24
}

const requested = process.env.DSH_TEST_ISOLATION ?? 'auto'
const useIsolationFlag = requested === 'auto' ? supportsIsolationFlag() : requested === 'none'
if (requested === 'none' && !supportsIsolationFlag()) {
  console.error(`DSH_TEST_ISOLATION=none was requested, but Node ${process.versions.node} has no --test-isolation flag.`)
  process.exit(2)
}

const args = [
  '--test',
  ...(useIsolationFlag ? ['--test-isolation=none'] : []),
  '--test-concurrency=1',
  `--test-timeout=${timeout}`,
  '--test-reporter=spec',
  ...targets,
]

// `stdio: 'inherit'` is permitted here and keeps the runner's own output intact;
// nothing is captured through a pipe.
const child = spawnSync(process.execPath, args, {
  cwd: root,
  timeout: timeout * targets.length + 60_000,
  stdio: 'inherit',
})

if (child.error) {
  console.error(`FAIL could not run the test runner: ${child.error.message}`)
  process.exit(1)
}

if (child.signal !== null || child.status === null) {
  console.error('FAIL the test runner was killed before it reported')
  process.exit(1)
}

// Exit code 9 with no output is how an unsupported flag surfaces, and it is also how
// a pipe-blocked runner can die silently. Say which one it is instead of leaving a
// bare number.
if (child.status === 9 && !useIsolationFlag) {
  console.error([
    '',
    `FAIL the runner exited with 9 before running anything (Node ${process.versions.node}).`,
    'This usually means the process could not be started, for example because the',
    'sandbox forbids the pipes the default test isolation uses.',
    '',
    'Try a Node version that has --test-isolation (24 or newer), or run the files',
    'through node --test directly outside the restricted environment.',
    '',
  ].join('\n'))
  process.exit(9)
}

process.exit(child.status)
