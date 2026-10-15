// Release hygiene: the things that make a repository uploadable and installable.
//
// These checks guard mistakes that are cheap to make and expensive to publish:
// a personal path in a public repo, a broken install entry point, a PowerShell
// script that only parses on the author's machine, or a shipped bundle patch that
// overrides the user's own configuration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Tracked files, excluding what is deliberately not shipped. */
function trackedFiles(dir = root, out = []) {
  const skip = new Set(['.git', '.vendor', 'dist', 'node_modules', '.dsh'])
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) trackedFiles(path, out)
    else out.push(relative(root, path).split('\\').join('/'))
  }
  return out
}

test('the install entry points a release must carry all exist', () => {
  // Files every tree needs, whether it is the repository or an extracted release.
  const required = [
    'package.json',
    'index.js',
    'cordis.patch.yml',
    'lib/rules.js',
    'lib/store.js',
    'lib/api.js',
    'lib/client.js',
    'web/index.html',
    'web/app.js',
    'web/app.css',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'install.ps1',
  ]
  // Repository-only files. A release archive intentionally leaves these out, so this
  // test has to pass in both trees.
  const repositoryOnly = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.gitignore',
    'CONTRIBUTING.md',
  ]
  const inRepository = existsSync(join(root, '.github'))

  const missing = required.filter(file => !existsSync(join(root, file)))
  assert.deepEqual(missing, [], 'every install entry point must be present')

  if (inRepository) {
    const absent = repositoryOnly.filter(file => !existsSync(join(root, file)))
    assert.deepEqual(absent, [], 'the repository must carry its contributor files')
  }
})

test('package.json declares everything DSH needs to install the bundle', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.license, 'MIT', 'the LICENSE file must match the declared license')
  // `inspect` refuses a package that declares no bundle, so this is load-bearing.
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.match(pkg.description, /DeepSeek Harness/)
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'the plugin ships no runtime dependency')
  for (const entry of ['index.js', 'lib', 'web', 'tools', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(entry), `package.json files[] must ship ${entry}`)
  }
})

test('the shipped bundle patch carries no config', () => {
  // A bundle-layer config cannot be overridden by the profile. A leftover
  // `rulesFiles` there once silently disabled every rule the manager saved.
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: global-rules/)
  assert.match(patch, /name: dsh-plugin-global-rules/)
  assert.doesNotMatch(patch, /^\s+(rulesFiles|maxBytes|applyToSubagents|storeDirectory):/m)
})

test('no personal path or credential is committed', () => {
  // The regexes are assembled from fragments on purpose. Writing them as literals
  // would put a personal-looking path in this file, and this file is one of the files
  // being scanned, so the check would report itself. Keeping the literals out means
  // the scan can cover everything, with no exemption list to forget to update.
  const WINDOWS_PROFILE = new RegExp('C:\\\\Users\\\\' + '(?!me[\\\\/]|<)[A-Za-z0-9._-]+', 'i')
  const POSIX_HOME = new RegExp('/home/' + '(?!runner/)[a-z0-9._-]+/', 'i')
  const API_KEY = new RegExp('\\bsk-' + '[A-Za-z0-9]{20,}\\b')
  const CLASSIC_TOKEN = new RegExp('\\bghp_' + '[A-Za-z0-9]{20,}\\b')
  const FINE_GRAINED_TOKEN = new RegExp('\\bgithub_pat_' + '[A-Za-z0-9_]{20,}\\b')
  const personal = [WINDOWS_PROFILE, POSIX_HOME, API_KEY, CLASSIC_TOKEN, FINE_GRAINED_TOKEN]

  const offenders = []
  for (const file of trackedFiles()) {
    if (!/\.(js|mjs|json|yml|yaml|md|ps1|html|css)$/i.test(file)) continue
    const text = readFileSync(join(root, file), 'utf8')
    for (const pattern of personal) {
      const match = text.match(pattern)
      if (match) offenders.push(`${file}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], 'a public repository must not carry local paths or secrets')
})

test('the test runner adapts to the Node version instead of assuming one', () => {
  // `--test-isolation=none` arrived in Node 24. Passing it on Node 22 makes the runner
  // exit with code 9 before a single test runs, which CI reported as a plain "bad
  // option". package.json allows Node 22, so the flag has to be conditional.
  const runner = readFileSync(join(root, 'tools/run-tests.mjs'), 'utf8')
  assert.match(runner, /process\.versions\.node/, 'the runner must inspect the runtime version')
  assert.match(runner, /--test-isolation=none/, 'the sandbox-friendly mode must still be available')

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const minimum = Number(String(pkg.engines?.node ?? '').replace(/[^\d]/g, '').slice(0, 2))
  assert.ok(minimum >= 22, 'the declared Node floor must be the version the code supports')
})

test('install.ps1 stays ASCII so Windows PowerShell 5.1 can parse it', () => {
  // PowerShell 5.1 reads a .ps1 without a byte-order mark as ANSI. Non-ASCII text then
  // becomes mojibake, which breaks the parser rather than merely looking wrong. This is
  // why the script's comments and messages are English while README.md carries the
  // Chinese documentation.
  //
  // Line endings are deliberately NOT asserted here: `.gitattributes` pins `*.ps1` to
  // CRLF, so a Windows checkout legitimately has them. The ASCII check is the whole
  // point of this test.
  const text = readFileSync(join(root, 'install.ps1'), 'utf8')
  const nonAscii = [...text].filter(character => character.codePointAt(0) > 0x7f)
  assert.deepEqual(nonAscii, [], 'install.ps1 must remain ASCII-only')
})

test('.gitattributes fixes line endings instead of relying on each machine', () => {
  // core.autocrlf is machine-specific, so without this file a Windows checkout rewrites
  // every LF and produces whole-file diffs. The repository normalises to LF, and the
  // Windows-only helper keeps CRLF because that is what Windows tooling expects.
  const text = readFileSync(join(root, '.gitattributes'), 'utf8')
  assert.match(text, /^\* text=auto eol=lf$/m, 'the default must normalise to LF')
  assert.match(text, /^\*\.ps1 text eol=crlf$/m, 'install.ps1 keeps CRLF by design')
  assert.match(text, /^\*\.sh text eol=lf$/m, 'shell scripts must never gain CRLF')
})


test('the release builder ships every file a fresh clone would need', () => {
  const source = readFileSync(join(root, 'tools/package-release.mjs'), 'utf8')
  for (const entry of ['index.js', 'cordis.patch.yml', 'lib', 'web', 'install.ps1', 'README.md', 'LICENSE']) {
    assert.ok(source.includes(`'${entry}'`), `the release must include ${entry}`)
  }
  // The extracted runtime and the archives themselves must stay out of the package.
  const excludeLine = source.match(/const EXCLUDE_DIRS = new Set\(\[([^\]]*)\]\)/)
  assert.ok(excludeLine, 'the builder must declare an exclude list')
  for (const entry of ['.vendor', 'dist', '.git', 'node_modules']) {
    assert.ok(excludeLine[1].includes(`'${entry}'`), `${entry} must be excluded from a release`)
  }
})


test('the repository ignores build output and local scratch', (t) => {
  const ignorePath = join(root, '.gitignore')
  // A release archive has no `.gitignore`, so this check only applies to the repository.
  if (!existsSync(ignorePath)) {
    t.skip('not a repository checkout')
    return
  }
  const ignore = readFileSync(ignorePath, 'utf8')
  for (const entry of ['.vendor/', 'dist/', '.test-report.txt', 'node_modules/']) {
    assert.ok(ignore.includes(entry), `.gitignore must list ${entry}`)
  }
})
