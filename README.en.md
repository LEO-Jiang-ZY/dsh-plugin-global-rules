<a id="english"></a>

# dsh-plugin-global-rules

[中文](README.md) · **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-150%20passing-brightgreen.svg)](#tests)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#design-decisions)

A rule manager for DeepSeek Harness: it injects your own rules into the system prompt of
every workspace, and gives you a graphical interface to manage them in layers, global and
per workspace.

What it does:

- Global plus per workspace. One global set is the baseline, and any number of workspaces
  layer their own rules on top, most specific wins. A session started in a subdirectory of
  a workspace still picks up that project's rules.
- Rules become a section of the system prompt rather than a "for reference only" history
  message, which is what gives them authority.
- Configure once, applies everywhere. Web, headless, SDK and ACP all read the same rules.
- Covers every session. Main sessions, subagents and Agent Teams teammates all receive the
  rules, and this can be turned off.
- Edits take effect immediately. After saving, a running session sees the new rules on its
  next model step, with no restart and no new session.
- Any number of named rule sets per scope, each one switchable, reorderable and
  concatenated in order.
- A graphical editor inside the app, or at `/rules` in a browser, with save and discard,
  unsaved-change protection and a dry-run preview.
- The interface follows the DSH system language, Chinese and English.
- No third-party dependencies, only Node built-ins.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Interface](#interface)
- [Where rules come from](#where-rules-come-from)
- [Token and context cost](#token-and-context-cost)
- [Configuration](#configuration)
- [Language](#language)
- [HTTP API](#http-api)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)

---

## Install

Plugins are installed from inside DSH: choose **Plugins** in the left sidebar, then click
**Add plugin**. That dialog accepts four kinds of input: a package name, a Git address, an
archive URL, or a local absolute path. Pick one of the three methods below.

All three require one restart of DSH after installing. The plugin source sits outside the
HMR watch roots, so it is not loaded until the next start. Once installed, changing rule
content does not need a restart.

### Method 1: paste the repository address into the dialog

The simplest route. Open the Plugins page, click Add plugin, and paste:

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules
```

The `github:` shorthand and a pinned version also work:

```
github:LEO-Jiang-ZY/dsh-plugin-global-rules
github:LEO-Jiang-ZY/dsh-plugin-global-rules#v1.0.0
```

Click Install, then Enable now, then restart DSH.

This method needs direct access to GitHub. If you see "cannot reach GitHub" or a connection
timeout, your network cannot reach GitHub directly, so use method 2 or 3 instead. The dialog
may suggest switching to a domestic mirror, but that mirror serves npm registry packages and
cannot stand in for downloading a GitHub repository, so it does not help this plugin.

### Method 2: download an archive and install from a local absolute path

This is the right choice when the network cannot reach GitHub directly.

1. Open the [Releases page](https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/latest)
   and download `dsh-plugin-global-rules-v<version>.zip`
2. Extract it anywhere, for example `C:\Users\<you>\plugins\`
3. In the Add plugin field, enter the absolute path of the extracted directory:

```
C:\Users\<you>\plugins\dsh-plugin-global-rules-v<version>
```

The archive contains one top-level directory, so extracting it will not scatter files into
your current directory. The same release also carries a `.tar.gz` and a `.sha256`, the latter
for checking that the download is complete.

You can also install it to disk without touching any DSH configuration file:

```powershell
# from an archive you already downloaded
.\install.ps1 -From .\dsh-plugin-global-rules-v<version>.zip

# or let the script fetch it from the Releases page (needs GitHub access)
.\install.ps1 -Repo LEO-Jiang-ZY/dsh-plugin-global-rules
```

The script does three things: download, extract into `~/.dsh/plugins`, and print the path to
paste into the dialog. It never edits a DSH configuration file; installing stays a decision
you confirm in the interface.

### Method 3: paste a tar.gz URL

Add plugin also accepts an archive URL. Paste the download address of the `tar.gz` asset:

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/download/v<version>/dsh-plugin-global-rules-v<version>.tar.gz
```

For the current version v1.0.0, this one works as is:

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/download/v1.0.0/dsh-plugin-global-rules-v1.0.0.tar.gz
```

> The address must name the exact file, with no wildcards, so each version needs its own
> version number. On the [Releases page](https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/latest),
> right-click the asset's download link to copy the exact address for the current version.

This method also needs GitHub access, and saves you from extracting anything yourself.

### Upgrading

Plugins do not support automatic updates yet. To upgrade, uninstall and then install the new
version: open this plugin's card on the Plugins page, uninstall, then install again using any
method above. Your rules live in `~/.dsh/rules/`, separate from the plugin itself, so
uninstalling and reinstalling does not touch them.

### Requirements

| Item | Requirement |
|---|---|
| Node.js | 22 or newer. The plugin uses only built-in modules; this requirement is about the DSH runtime |
| DSH | Any modern version. The graphical editor needs a Web server; rule injection works normally under headless, SDK and ACP |
| Operating system | Windows, macOS, Linux |

---

## Quick start

1. Install using any method above and restart DSH
2. A "Rule manager" entry appears at the bottom of the left sidebar; open it
3. Write your rules and click Save
4. Every later conversation follows them, including subagents and Agent Teams teammates

To add rules that apply to one repository only, click "＋ Workspace" in the Scopes panel at
the top left and enter that repository's root directory. Sessions in it and in its
subdirectories layer those rules on top.

---

## Interface

Open it either way:

| Route | Location |
|---|---|
| In-app, recommended | The "Rule manager" button at the bottom of the left sidebar, opening as a full-page overlay in the current window |
| Browser | `http://127.0.0.1:19387/rules`, the port follows your Web server |

Why an in-app overlay: the DSH desktop app runs its GUI inside the application window, so
calling `window.close()` from a page in that window closes DSH itself. An overlay is a plain
DOM node, and dismissing it only collapses the overlay; it can never reach the window's own
controls.

The screen is divided as follows:

- Scopes, top left, lists global plus every configured workspace. Click to switch. The cross
  on a workspace entry deletes that workspace's whole rule set, and "＋ Workspace" adds one
  from an absolute path.
- Rule sets, bottom left, lists the sets in the current scope in injection order. Each entry
  can be enabled, disabled, moved up or moved down, and entries with unsaved drafts are marked.
- The editor in the middle has a name, an enabled switch and the Markdown content, with a live
  byte count at the bottom right.
- The bottom buttons are Save, Discard, Dry run and Delete this rule set.
- The top-right buttons are Close and Reload. Close asks about unsaved changes first; in-app it
  collapses the overlay, and in a standalone tab it explains how to leave. It never tries to
  close the DSH window.
- The dry run preview writes no files. It renders the exact section the model will see on the
  next step, including the heading, source markers and budget truncation, and can be copied
  with one click.
- Shortcuts: `Ctrl` or `Cmd` plus `S` saves, `Esc` closes the preview first and then the overlay.

Every confirmation and input uses an in-page dialog rather than the browser's native `confirm`
and `prompt`. The editor runs inside the DSH application window, where native dialogs cannot
be styled, may be suppressed by the embedding environment, and cannot report their result to
the status line.

### Relationship to the desktop window buttons

The DSH desktop window's own minimize, maximize and close controls occupy the top right. The
editor's top bar and overlay header place no clickable control in that band: when Electron is
detected the layout reserves width for the window controls and explicitly declares that area
as not a drag region (`-webkit-app-region: no-drag`), otherwise clicks would be swallowed by
the drag region.

### Draft protection and concurrent edits

- Unsaved content is mirrored into browser `localStorage`, stored per scope, so a rule set with
  the same name in two workspaces cannot overwrite the other. Switching scope, switching rule
  set, reloading and closing all ask first. Even if you close the page outright, the draft is
  still there when you reopen the editor, marked "unsaved draft" on the entry.
- Each scope carries a `revision`. If another tab or editor changes the same scope while you are
  editing, saving reports in the status line that the other change was overwritten by this page.
  An overwrite is never silent.

---

## Where rules come from

Rules are read broad to specific, and later overrides earlier:

| Order | Source | Path |
|---|---|---|
| 1 | Global rule sets, in manifest order | `<DSH_HOME>/rules/*.md` |
| 2 | That workspace's rule sets | `<DSH_HOME>/rules/workspaces/<slug>~<digest>/*.md` |
| 3 | An override file in the session directory, optional | `<session working directory>/.dsh/rules.md` |

When `rulesFiles` is set, layer 1 becomes those files; layers 2 and 3 are unchanged.

How workspace matching works: the session's working directory is walked upward, and the first
ancestor directory that already has rule sets wins. So a session started in `<project>/src`
still finds `<project>`'s rules. No match means global rules only. Matching uses absolute
paths, normalised separators, and is case-insensitive on Windows.

- `<DSH_HOME>` defaults to `~/.dsh`, on Windows `C:\Users\<you>\.dsh`, and can be overridden with
  the `DSH_HOME` environment variable.
- The first run creates `<DSH_HOME>/rules/` and adopts your existing
  `<DSH_HOME>/global-rules.md` as the first global rule set, so nothing is lost.
- Each scope has its own `manifest.json` recording order, names and enabled state; a workspace's
  manifest also records `path` (which workspace it belongs to) and a display name. Content is
  only ever written in the `*.md` files, so reordering or toggling never rewrites your text.
- A workspace directory name is a readable slug plus a path digest, so `C:\a b` and `C:\a-b`
  never share a directory.
- A `*.md` file that exists on disk but is not in the manifest is still listed, marked
  "untracked"; disable or delete it to deal with it.
- Any number of files is supported; `rulesFiles` and `workspaceRulesFiles` both accept arrays.

### What the model sees

```markdown
## Standing rules from the user (apply in every workspace)
These rules override repository guidance and stay in force until the user changes them. Follow them unless the current request or a safety requirement overrides them. Do not announce them or cite the rule files; mention a rule only when it is the reason you are declining something, or when asked.

### [global]
<global rules here>

### [workspace]
<this workspace's rules here>
```

- Each source gets a single `### [global]` or `### [workspace]` tag, with no absolute path. A path
  does not help the model obey a rule, yet it is paid for on every request, and Windows paths
  are especially expensive to tokenise. Turn on `sourceIndex` or `verboseProvenance` when you do
  want the paths.
- The heading explicitly tells the model not to report which rule it is following. Rules are
  meant to be followed quietly; only a genuine refusal or override, or you asking, is worth
  mentioning. `announceRules: true` restores the older wording.
- If the rule text contains `</system-reminder>` or `<system-reminder>`, it is escaped, so text
  from a repository cannot forge the plugin's own closing marker.

### Putting workspace rules in a repository

Create `.dsh/rules.md` at the project root and write only what differs from the global rules.
It is read last, so it wins.

---

## Token and context cost

The rules section is static text inserted into the system prompt. It does cost tokens, but the
cost is measurable and predictable.

Measured on a typical two-source configuration, 2021 bytes global plus 54 bytes workspace:

| Item | Bytes | Note |
|---|---|---|
| Rule text | 2075 | what you actually wrote |
| Heading | 356 | the authority statement and the do-not-announce instruction |
| Source tags | 31 | `### [global]` and `### [workspace]` |
| Section total | 2463 | 15.8% of it is not rule text |

### Why you do not pay this on every turn

It sits at the very front of the system prompt and its bytes never change, so it falls inside
the prompt cache prefix. Measured:

| Session size | Cached `cacheReadTokens` | Uncached `inputTokens` |
|---|---|---|
| Short | 1 408 | 7 786, first step, including the system prompt and tools |
| Medium | climbs to 130 432 | 150 to 8 900 per step |
| Long | climbs to 203 904 | 148 to 937 per step |

Cached tokens are billed at the cache rate, usually far below fresh tokens, and the uncached
part is only the increment. In other words the cost of these rules is essentially once per
session, not once per step.

### When you do need to control the cost

| Situation | Measure |
|---|---|
| Rules are long and you want a ceiling | `maxBytes`, default 32768. Over budget it sheds in order: notices, then the source index, then the rule-set headings, then truncates the body |
| Agent Teams, where each teammate carries a copy | `applyToSubagents: false` keeps subagents and teammates from receiving them |
| Only some workspaces should get rules | `workspaceAllow` and `workspaceDeny`; other directories keep only the global layer |
| Measure your own footprint | `node tools/measure-section.mjs "$env:USERPROFILE\.dsh" <a workspace>` |
| Measure the real token bill | `node tools/token-report.mjs "<session log>"` |

Note: `inputTokens` is the uncached part and `cacheReadTokens` is the cached part. Adding the
two and calling it total input produces a cache hit rate of tens of thousands of percent, which
is a field-semantics mistake, not a saving.

---

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. Set to `false` and the section renders as an empty string |
| `storeDirectory` | `<DSH_HOME>/rules` | Rule-set storage directory |
| `rulesFiles` | `[]` | Replaces the global layer only. When non-empty the global layer reads these files instead of the rule-set manifest, and workspace rules still apply. Relative paths resolve against `dshHome` |
| `workspaceRulesFiles` | `['.dsh/rules.md']` | Override files in the session directory, relative to the session working directory or absolute |
| `workspaceAllow` | `[]` | Allow list. When non-empty only these directories and their subdirectories are injected |
| `workspaceDeny` | `[]` | Deny list. These directories and their subdirectories are not injected |
| `maxBytes` | `32768` | Hard ceiling on the injected text, in bytes. `0` means inject nothing |
| `order` | `100` | Position in the system prompt |
| `applyToSubagents` | `true` | Set to `false` and subagent and teammate sessions are not injected |
| `announceRules` | `false` | By default the model is told not to report which rule it is following |
| `verboseProvenance` | `false` | Set to `true` to use full-path headings per source instead of the compact `### [global]` |
| `sourceIndex` | `false` | Set to `true` to append a source list to the section, for troubleshooting only |
| `diagnosticsFile` | unset | Troubleshooting only. Appends mount, resolve, cache-hit and HTTP-route events as JSON Lines |

### About `order`

In the DSH section order, `HARNESS_IDENTITY` is -1000, `DEPLOYMENT_PERSONA_PREFIX` is 0 and
`TOOL_BASH` is 1000. The default of 100 lands in the policy band: after the identity and
persona, before the tool documentation. The model reads your rules before it reads any tool
docs.

### Do not write configuration into this plugin's own `cordis.patch.yml`

That row is inserted at the bundle layer, and the profile layer cannot override it, so any value
written there becomes a hard commitment. This repository's `cordis.patch.yml` therefore carries
no config on purpose. A leftover `rulesFiles: [global-rules.md]` there once kept everything the
rule manager saved out of the prompt.

To customise, put the config on the row in your own profile's `cordis.patch.yml`:

```yaml
- id: global-rules
  name: dsh-plugin-global-rules
  config:
    maxBytes: 16384
    applyToSubagents: false
```

---

## Language

The interface follows the DSH system language. Sources, in priority order:

1. `?lang=`. The in-app overlay reads the current locale from `ctx.locale` and passes it to the
   editor, so switching language mid-session is picked up.
2. `navigator.language`. The browser or Electron UI language. This is what a direct visit to
   `/rules` uses, and what the overlay falls back to when it cannot read the locale.
3. Chinese, the plugin's original language.

Anything other than English falls back to Chinese, so there is never a half-translated mix. Rule
content is unaffected and is always injected exactly as you wrote it. The template text seeded
into a new rule set follows the same language.

### Making DSH itself English

The plugin can only follow; it cannot decide DSH's own language. That is set by the locale row in
the profile:

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: system   # or en / zh
```

- `preference: zh` pins the interface to Chinese regardless of the operating system language.
  This is the easiest case to misread: switching the system to English and still seeing Chinese
  is caused by this line, not by the plugin.
- `preference: system` follows the operating system language.
- A restart of DSH is needed after changing it.

Check this line first, then the editor's status line: the language of the status text is the
language the page actually selected. `/rules?lang=en` forces English, which distinguishes "the
page is not following" from "DSH itself is Chinese".

---

## HTTP API

The editor is an ordinary HTTP page and every endpoint goes over loopback. Every operation
carries a scope: `global`, or a workspace absolute path.

| Method | Path | Purpose |
|---|---|---|
| GET | `/rules` | The editor page |
| GET | `/rules/api/state?cwd=<dir>` | Full state: global, all workspaces, and the plan this session actually injects |
| GET | `/rules/api/scope?scope=workspace&path=<dir>` | The rule sets of one scope |
| POST | `/rules/api/scope?scope=workspace&path=<dir>` | Create or adopt a workspace scope |
| DELETE | `/rules/api/scope?path=<dir>` | Delete a workspace's whole rule set |
| GET and PUT | `/rules/api/ruleset?id=<id>` | Read or save one rule set |
| POST | `/rules/api/create` | Create a rule set |
| POST | `/rules/api/delete` | Delete a rule set |
| PATCH | `/rules/api/manifest` | Enable, disable, move up, move down |
| POST | `/rules/api/preview` | Dry-run render, writes nothing |

Security posture. This page can rewrite the prompt every session sees, so these are not
decoration:

- Only `127.0.0.1`, `::1` and `localhost` peers are accepted
- Mutating calls must be same-origin. A missing `Origin` or `"null"` is accepted; anything from
  another host is refused
- Mutating calls must be `application/json`, with a 512 KiB body limit
- A workspace scope must be an absolute path, and every file path is derived on the server; a
  path from the request is never used

There is no authentication: any program on this machine that can reach the loopback port can
change the rules. That matches DSH's own loopback posture. For stronger isolation, keep
`webserver.host` at `127.0.0.1` and restrict local accounts.

---

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| Install fails on the Plugins page saying GitHub is unreachable | The network cannot reach GitHub | Use method 2 and install from an extracted local absolute path |
| "Action failed: this page does not match the loaded plugin version" | The editor page updated but the host plugin is still the version cached at startup | Restart DSH, then reload the page |
| `/rules` returns 404 | The same module cache; or this profile has no HTTP server, since headless, SDK and ACP provide no Web editor | Restart, or use a profile that has a Web server |
| No "Rule manager" button in the sidebar | The client bundle did not load | Restart, and confirm the plugin is enabled on the Plugins page |
| `prompt section "global:user-rules" is already registered` | The plugin is enabled twice, once by the profile patch and once by the bundle patch | Remove the duplicate row in `cordis.patch.yml` |
| Saved successfully but the model's behaviour is unchanged | Rules apply on the next model step; or `rulesFiles` is set, so the global layer is those files instead, and the interface shows a banner at the top | Just continue the conversation, or remove `rulesFiles` |
| The interface says the rules are enabled but the model cannot see them at all | `rulesFiles` is a relative path, resolved against the process working directory. On the desktop the working directory is `<profile>`, so it points at a file that does not exist and the global layer is empty | Remove `rulesFiles` and let the rule-set manifest decide, then confirm with the commands below |
| The model claims it has no language instruction | It is telling the truth: the rules never reached the prompt | Search the session log for the exact text with `tools/find-in-session.mjs` |
| The interface is still Chinese after switching to English | DSH's locale `preference` is set to `zh` | See [Language](#language) |

### Self-check commands

Whether the rules reached the prompt should not be a guess. These scripts answer it using the
same code path as the prompt section:

```powershell
# what a session directory receives now, across global, workspace and session layers
node tools/inspect-injection.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# whether the config layer is hijacked by rulesFiles and workspace rules still apply; prints PASS or FAIL
node tools/verify-fix.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# read back the rule section the model actually saw, the hardest evidence available
node tools/probe-session.mjs "$env:USERPROFILE\.dsh\sessions\<workspace>\<session>\session.v4.jsonl.zstd"

# search for exact rule text; zero hits means it never applied
node tools/find-in-session.mjs "<the log above>" "始终使用简体中文回答"

# measure the section size and its overhead share
node tools/measure-section.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# measure the real token bill and cache hits
node tools/token-report.mjs "<the log above>"

# judge a text file's encoding by its bytes, so console mojibake is not mistaken for damage
node tools/check-encoding.mjs "$env:USERPROFILE\.dsh\global-rules.md"

# migrate pre-store single-file rules into the rule-set store; idempotent, run --dry-run first
node tools/adopt-legacy.mjs "$env:USERPROFILE\.dsh" --dry-run
```

Do not use PowerShell to read or write source files when diagnosing encoding problems.
`Get-Content`, `Set-Content` and `Out-File` destroy UTF-8 Chinese into unrecoverable mojibake,
and the console itself can display a perfectly intact file as mojibake, for example `# 全局规则`
appearing as `# 鍏ㄥ眬瑙勫垯`. To judge whether a file is damaged, look at its bytes.

Similarly, a session log is several zstd frames concatenated. `zstdDecompressSync` decodes only
the first frame and gives the false impression of a log holding nothing but a session header.
"the log has no prompt in it" is usually a decoding mistake, not an absence. Use
`tools/session-log.mjs`, which walks every frame.

---

## Development

```bash
node tools/vendor-cordis.mjs      # optional: extract the real Cordis runtime from a local install into .vendor/, git-ignored
npm run verify                    # run every test plus the page-markup and documentation-consistency checks
node tools/package-release.mjs    # build the release zip and tar.gz
node tools/serve-editor.mjs 8799 <dshHome>   # run the editor standalone on a scratch port for manual acceptance
```

### Documentation

The documentation is two separate files, cross-linked at the top: [README.md](README.md) is
Chinese and this file is English. Keeping both languages in one file produced a page over a
thousand lines long, which is tiring to scroll through and to review.

`tools/check-readme.mjs` checks that the pair stays in step: the same number of sections, a
language switcher that points at the other file, every internal anchor present, no code fence
left open, and the test count in the badges and the `npm test` comment matching the number of
tests actually declared under `tests/`. Run it after editing either file, otherwise the other
one drifts out of date.

Adding a test leaves four numbers stale across the two files. `node tools/sync-test-count.mjs`
rewrites them from the suite; add `--check` to report without writing.

### Tests

```bash
npm test        # 150 tests
```

Coverage includes: path normalisation and prefix matching, allow and deny precedence, scope
planning, deduplication, the byte budget, dry-run writing nothing, concurrent-edit conflict
reporting, unauthorised and cross-origin refusal, non-JSON refusal, bad id refusal, atomic
writes, and per-scope read, write and create; workspace storage slug uniqueness, manifests
recording their workspace, directories without a path not counting as workspaces, ancestor
matching, disabled sets not being injected, deleting a directory, and a legacy file not being
adopted twice; the client bundle's registration id, Cordis contract, requiring only react,
sidebar registration, an overlay rather than a new window, closing inside the overlay collapsing
only the overlay, accepting close messages only from the same origin, and passing `lang` only
when the locale is known; page logic for loading and rendering, the dirty flag, saving with a
rename and a toggle, drafts surviving across instances per scope, the dry run, in-page dialogs,
being able to close, reload and create after deleting the last rule set, selecting the remaining
set after a delete, the application window never being closed, the embedded case notifying the
overlay instead, three-step language fallback, creating, editing and deleting a workspace scope,
relative paths being refused, backend failures being reported, and degrading when the backend
version does not match; release hygiene checks for install entry points, the bundle declaration
in `package.json`, the shipped patch carrying no config, no personal paths or credentials in the
repository, and `install.ps1` staying pure ASCII; archive format checks for magic bytes, the
central directory offset and each entry's CRC, with a real round trip through the system
extractor; plus real assembly cases that mount the official `SystemPrompt` service and assert the
rules section sits after the harness identity and persona and before every tool section. Those
cases skip themselves when the runtime has not been extracted.

`tools/run-tests.mjs` uses `--test-isolation=none` by default so every case runs in a single
process. By default `node --test` forks a child per file with piped stdio, which some sandboxes
refuse with `EPERM`; passing `stdio: 'inherit'` does not help because the runner itself does the
forking. That flag only exists on Node 24, so the runner decides from the runtime version whether
to add it.

---

## Design decisions

Why a system prompt section rather than a history message. Inserted into history as a
`<system-reminder>` or similar, the model treats it as for-reference-only context. Only inside
the system prompt does it count as a rule with the standing to override a repository's own
instructions.

Why `inject` contains only `systemPrompt`. Adding `webServer` would make headless, SDK and ACP
profiles stop injecting rules silently, because they lack that service. An optional feature
should not decide whether the core feature works. That is why the editor routes are late-bound:
registered once the HTTP server appears, with a bounded 4-second retry.

Why global and workspace share one storage implementation. A workspace rule set is a complete
rule-set store whose `manifest.json` additionally carries `path` and `title`. One fewer branch is
one fewer class of bug that can appear on only one side.

Why caching uses fingerprints rather than a file watcher. The fingerprint covers every candidate
file, its parent directory, `manifest.json` and the store directory mtime, so content edits,
creating or deleting a rule set, toggling, reordering, and creating or deleting workspace rules
are all noticed on the next model step without a resident watcher.

Why failures degrade rather than throw. One unreadable rule file produces a notice and the rest
still inject. A corrupt manifest degrades to listing whatever files are on disk and reports the
problem in the interface. The plugin never lets a rule-file problem fail a model request.

Why the interface never fails silently. On startup the page checks that the markup and the script
agree, validating all 36 element ids and naming any that are missing. Network or API failures put
the reason, including the HTTP status and the backend message, in the status line. A configuration
interface that fails silently is far worse than one that reports an error clearly.

No runtime dependencies. Only Node built-ins. The only third party is `.vendor/`, a runtime
extracted from the DSH installation on your own machine, used solely by the integration tests, git
ignored, and never redistributed by this project.

Archives are written under `tools/lib/` rather than by any platform archiver. Two failures led
here: `bsdtar -a -c -f out.zip` actually writes a tar on Linux while naming it `.zip`, and a
hand-written zip with the wrong general purpose flags is rejected by Windows' extractor as a
"split or spanned archive". Writing the container directly makes all three platforms produce the
same bytes and lets the result be verified locally with the system extractor.

---

## Known limitations

- Rule files are read through the host's `node:fs`, so rule sets under `DSH_HOME` sit outside
  sandbox policy; they are your trusted configuration. The optional session override file lives
  inside a project, so take care when cloning untrusted repositories.
- There is no file watcher: edits apply on the next model step, not the instant you save.
- There is no summarisation: over budget, rules are dropped or truncated as described, and the
  model is never asked to compress them.
- Rule content applies immediately; plugin source changes are not hot-reloaded by HMR, because
  this plugin is mounted from a directory outside the profile and therefore outside the HMR
  module roots. Source changes need a DSH restart.
- Upgrading means uninstalling and installing the new version; the DSH Plugins page does not
  support automatic updates yet.
- Workspace matching is by path string. After moving or renaming a configured workspace
  directory, its rule sets do not follow; add "＋ Workspace" at the new path, and delete the old
  directory in the interface.
- The dry-run preview renders the scope you are currently editing. Other scopes, such as an
  ancestor directory's workspace rules, depend on the session directory; use the "Injected"
  field and the status line as the reference.
- The editor has no authentication; see the security posture under [HTTP API](#http-api).
- The diagnostic scripts under `tools/` assume DSH's default storage layout, `~/.dsh`; pass
  arguments explicitly when `storeDirectory` is customised.

---

## License

[MIT](LICENSE). This project contains only its own plugin source. Runtimes extracted from a local
DSH installation belong to their respective owners and are not redistributed by this repository.
