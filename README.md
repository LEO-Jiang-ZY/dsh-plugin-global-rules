# dsh-plugin-global-rules

DeepSeek Harness 的规则管理器：把你自己的规则注入到每一个工作区的系统提示词里，
并用一个图形界面按「全局 / 单工作区」分层管理它们。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-143%20passing-brightgreen.svg)](#测试)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#设计取舍)

主要能力：

- 全局加每工作区。一份全局规则打底，任意多个工作区各自叠加自己的规则，越具体越优先。
  会话在工作区的子目录里也能命中它所属项目的规则。
- 规则进入 system prompt 的一个分段，而不是以仅供参考的历史消息形式注入，因此具有权威性。
- 一处设置，处处生效。Web、headless、SDK、ACP 共用同一份规则。
- 覆盖所有会话。主会话、子代理、Agent Teams 队友都注入，可以关闭。
- 改完即生效。保存后，正在运行的会话在下一个模型步就会看到新规则，无需重启，无需新开会话。
- 每个范围里可以有任意多个命名规则集，逐个开关、排序、按序拼接。
- 图形界面在应用内侧边栏打开，也可以在浏览器访问 `/rules`，带保存与放弃、未保存拦截、试运行预览。
- 界面文本跟随 DSH 的系统语言，支持中文与英文。
- 零第三方依赖，只用 Node 内置模块。

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [图形界面](#图形界面)
- [规则从哪里来](#规则从哪里来)
- [Token 与上下文开销](#token-与上下文开销)
- [配置项](#配置项)
- [语言](#语言)
- [HTTP 接口](#http-接口)
- [排障](#排障)
- [开发](#开发)
- [设计取舍](#设计取舍)
- [已知限制](#已知限制)

---

## 安装

插件装进 DSH 的入口在应用内：左侧栏选择「插件」，点击「添加插件」。
那个对话框接受四种输入，分别是包名、Git 地址、压缩包链接、本地绝对路径。下面三种方式任选一种。

三种方式都需要在安装完成后重启一次 DSH。插件源码不在 HMR 的监视范围内，
不重启不会加载进来。之后只改规则内容不需要重启。

### 方式一：直接在对话框里粘贴仓库地址

最简单的做法。打开「插件」页，点击「添加插件」，粘贴：

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules
```

也接受 `github:` 简写，以及指定版本的写法：

```
github:LEO-Jiang-ZY/dsh-plugin-global-rules
github:LEO-Jiang-ZY/dsh-plugin-global-rules#v1.0.0
```

点「安装」，完成后点「立即启用」，然后重启 DSH。

这个方式需要能访问 GitHub。如果弹出「无法访问 GitHub」或「连接 GitHub 超时」，
说明网络到不了 GitHub，请改用方式二或方式三。对话框此时会建议「改用国内镜像」，
但那个镜像提供的是 npm 注册表里的包，不能代替从 GitHub 仓库下载，所以对本插件无效。

### 方式二：下载压缩包，用本地绝对路径安装

适合网络到不了 GitHub 的情况，也是最可控的方式。

1. 打开 [Releases 页](https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/latest)，
   下载里面的 `dsh-plugin-global-rules-v<版本号>.zip`
2. 解压到任意目录，例如 `C:\Users\<你>\plugins\`
3. 在「添加插件」的输入框里填解压后那个目录的绝对路径：

```
C:\Users\<你>\plugins\dsh-plugin-global-rules-v<版本号>
```

压缩包里有一个顶层目录，解压不会把文件散落到当前目录。同一个 Release 里还有
`.tar.gz` 与 `.sha256`，后者可用来校验下载是否完整。

也可以不改动 DSH 的任何配置，只把插件装到磁盘上：

```powershell
# 已经下载了 zip 的情况下
.\install.ps1 -From .\dsh-plugin-global-rules-v<版本号>.zip

# 或者让脚本自己去 Releases 页取（需要能访问 GitHub）
.\install.ps1 -Repo LEO-Jiang-ZY/dsh-plugin-global-rules
```

脚本只做三件事：下载、解压到 `~/.dsh/plugins`、打印接下来要填进对话框的路径。
它不改动任何 DSH 配置文件，安装动作仍然由你在界面里确认。

### 方式三：粘贴 tar.gz 直链

「添加插件」也接受压缩包链接。把 Release 里 `tar.gz` 资产的下载地址粘进输入框即可。
这个地址形如：

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/download/v<版本号>/dsh-plugin-global-rules-v<版本号>.tar.gz
```

以当前版本 v1.0.0 为例，可以直接用这一条：

```
https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/download/v1.0.0/dsh-plugin-global-rules-v1.0.0.tar.gz
```

> 地址里必须写确切的文件名，不能用通配符，所以每个版本都要换成对应的版本号。
> 在 [Releases 页](https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/latest)
> 右键点该资产的「下载」即可复制到当前版本的准确地址。

这个方式同样需要能访问 GitHub，好处是不用自己解压。

### 关于升级

插件安装后暂不支持自动更新。升级要先卸载再安装新版本：在「插件」页打开本插件的卡片，
卸载，然后按上面的方式重新安装。规则内容存在 `~/.dsh/rules/` 下，与插件本身分开，
卸载重装不会动你的规则。

### 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | 22 或更高。插件只用内置模块，这个要求是针对 DSH 运行时的 |
| DSH | 任意现代版本。需要 Web 服务才有图形编辑器，headless、SDK、ACP 下规则注入照常工作 |
| 操作系统 | Windows、macOS、Linux |

---

## 快速开始

1. 按上面的方式安装并重启 DSH
2. 左侧栏底部出现「规则管理器」，点开
3. 写下你的规则，点「保存并生效」
4. 之后的每一次对话都会遵守它，包括子代理和 Agent Teams 队友

想在某个仓库里加只有它才适用的规则，就在编辑器左上「生效范围」里点「＋ 工作区」，
填入该仓库的根目录路径。该目录及其子目录里的会话都会叠加这些规则。

---

## 图形界面

打开方式任选其一：

| 方式 | 位置 |
|---|---|
| 应用内，推荐 | 左侧边栏底部「规则管理器」按钮，在当前窗口内以整页浮层打开 |
| 浏览器 | `http://127.0.0.1:19387/rules`，端口跟随你的 Web 服务 |

为什么做成应用内浮层：DSH 桌面端把 GUI 跑在应用窗口里，若在该窗口中调用 `window.close()`，
关掉的是整个 DSH。浮层是页面里的一个普通 DOM 节点，关闭只是收起它，永远碰不到窗口控件。

界面分区：

- 左上「生效范围」列出全局和每个已配置的工作区，点击切换。工作区条目上的叉号删除该工作区的
  整套规则，「＋ 工作区」录入一个绝对路径新建。
- 左下「规则集」列出当前范围内的规则集，按注入顺序排列。每个条目可以启用、停用、上移、下移，
  有未保存草稿的会标注出来。
- 中间编辑器有名称、启用开关、Markdown 内容，右下角实时显示字节数。
- 底部按钮是保存并生效、放弃修改、试运行预览、删除此规则集。
- 右上按钮是关闭与重新载入。关闭会先询问未保存改动；在应用内它收起浮层，
  在独立标签页则说明如何离开，不会尝试关闭 DSH 窗口。
- 试运行预览不写入任何文件，直接渲染出模型在下一个模型步会看到的完整分段，
  含标题、来源标注与预算截断结果，并可一键复制。
- 快捷键：`Ctrl` 或 `Cmd` 加 `S` 保存，`Esc` 先关预览，再收起浮层。

所有确认与输入都用页面内对话框，不使用浏览器原生的 `confirm` 与 `prompt`。
编辑器运行在 DSH 应用窗口里，原生对话框无法定制，可能被内嵌环境屏蔽，
也无法把结果回显到状态栏。

### 与桌面端窗口按钮的关系

DSH 桌面窗口自带的最小化、最大化、关闭占用右上角。编辑器的顶栏与浮层头部都不把可点控件
放在那一带：检测到 Electron 时会为窗口控件预留右侧宽度，并显式声明该区域不是窗口拖拽区
（`-webkit-app-region: no-drag`），否则按钮点击会被拖拽区吞掉。

### 草稿保护与并发修改

- 未保存内容会镜像到浏览器 `localStorage`，按范围分别保存，
  因此两个工作区里同名的规则集不会互相覆盖。切范围、切规则集、重新载入、关闭都会先询问；
  即使直接关掉页面，重新打开时草稿仍在，条目上会标注「有未保存草稿」。
- 每个范围带一个 `revision`。若在你编辑期间另一个标签页或编辑器改动了同一范围，
  保存时会在状态栏提示「另一处也已修改，已按本页内容覆盖」，覆盖不会是静默的。

---

## 规则从哪里来

规则按从宽到专的顺序读取，后面的覆盖前面的：

| 顺序 | 来源 | 路径 |
|---|---|---|
| 1 | 全局规则集，按清单顺序 | `<DSH_HOME>/rules/*.md` |
| 2 | 该工作区的规则集 | `<DSH_HOME>/rules/workspaces/<slug>~<digest>/*.md` |
| 3 | 会话目录里的覆盖文件，可选 | `<会话工作目录>/.dsh/rules.md` |

设了 `rulesFiles` 时，第 1 层换成那些文件，第 2 层和第 3 层不变。

工作区匹配的规则：会话的工作目录会向上逐级查找，第一个已有规则集的祖先目录生效。
因此从 `<项目>/src` 启动的会话同样命中 `<项目>` 的规则；没有匹配到就只有全局规则。
路径匹配使用绝对路径、归一化分隔符，Windows 下大小写不敏感。

- `<DSH_HOME>` 默认 `~/.dsh`，Windows 下是 `C:\Users\<你>\.dsh`，可用环境变量 `DSH_HOME` 覆盖。
- 第一次运行会自动创建 `<DSH_HOME>/rules/`，并收养你原有的 `<DSH_HOME>/global-rules.md`
  作为第一个全局规则集，不会丢内容。
- 每个范围各有一份 `manifest.json`，记录顺序、名称与启用状态；工作区的那份还记录
  `path`（它属于哪个工作区）与显示名。内容始终只写在 `*.md` 里，
  改顺序或开关不会重写你写的文本。
- 工作区目录名是可读 slug 加路径摘要，所以 `C:\a b` 与 `C:\a-b` 不会共用目录。
- 磁盘上存在但不在清单里的 `*.md` 也会被列出，标记为「未纳入清单」，停用或删除它即可处理。
- 支持任意多个文件，`rulesFiles` 与 `workspaceRulesFiles` 都接受数组。

### 注入后模型看到的样子

```markdown
## Standing rules from the user (apply in every workspace)
These rules override repository guidance and stay in force until the user changes them. Follow them unless the current request or a safety requirement overrides them. Do not announce them or cite the rule files; mention a rule only when it is the reason you are declining something, or when asked.

### [global]
<全局规则原文>

### [workspace]
<该工作区的规则原文>
```

- 每个来源只用一个 `### [global]` 或 `### [workspace]` 标签，不写绝对路径。路径对遵守规则没有帮助，
  却在每次请求里都要付费，Windows 路径尤其费 token。需要路径时可以打开 `sourceIndex` 或
  `verboseProvenance`。
- 头部明确要求模型不要汇报自己在用哪条规则。规则是被静静执行的，
  只有真正拒绝或推翻某事，或者你主动问起时才值得一提。打开 `announceRules: true` 可恢复旧措辞。
- 规则原文里若出现 `</system-reminder>` 或 `<system-reminder>` 会被转义，
  仓库里的文本无法伪造出插件框架的结束标记。

### 在仓库里放工作区规则

在项目根目录建 `.dsh/rules.md`，只写与全局规则不同的部分。它排在最后，因此优先。

---

## Token 与上下文开销

规则分段是一段静态文本，插在 system prompt 里。它确实占 token，但代价是可测量、可预测的。

以一份典型的双来源配置实测，全局 2021 字节加工作区 54 字节：

| 项目 | 字节 | 说明 |
|---|---|---|
| 规则正文 | 2075 | 你真正写的内容 |
| 头部 | 356 | 权威声明与不要汇报的指令 |
| 来源标签 | 31 | `### [global]` 与 `### [workspace]` |
| 分段合计 | 2463 | 非规则文本占 15.8% |

### 为什么不是每轮都付这份钱

它在 system prompt 的最前面，字节不变，因此落在提示词缓存的前缀里。实测数据：

| 会话规模 | 缓存命中 `cacheReadTokens` | 未命中 `inputTokens` |
|---|---|---|
| 短会话 | 1 408 | 7 786，首次，含系统提示词与工具 |
| 中等 | 逐步涨到 130 432 | 每步 150 到 8 900 |
| 长会话 | 逐步涨到 203 904 | 每步 148 到 937 |

命中部分按缓存价计费，通常远低于新 token；未命中部分只剩增量。
也就是说，这份规则的开销基本是每个会话开头一次，不是每一步一次。

### 真正需要控制开销的时候

| 情况 | 措施 |
|---|---|
| 规则很长，想设上限 | `maxBytes`，默认 32768。超限时按提示、来源索引、规则集标题、截断正文的顺序依次让步 |
| 用 Agent Teams，多个队友各自带一份 | `applyToSubagents: false` 让子代理与队友不注入 |
| 只想给部分工作区 | `workspaceAllow` 与 `workspaceDeny`，其余目录只保留全局层 |
| 想量自己的实际占用 | `node tools/measure-section.mjs "$env:USERPROFILE\.dsh" <某个工作区>` |
| 想量真实 token 账单 | `node tools/token-report.mjs "<会话日志>"` |

注意：`inputTokens` 是未命中部分，`cacheReadTokens` 才是命中部分。
把两者相加当成总输入，会把缓存命中率算成几万个百分点，这是字段语义问题，不是省钱。

---

## 配置项

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。设为 `false` 时该分段渲染为空字符串 |
| `storeDirectory` | `<DSH_HOME>/rules` | 规则集存储目录 |
| `rulesFiles` | `[]` | 只替换全局层。非空时全局层读这些文件，而不是规则集清单；工作区规则仍然生效。相对路径相对 `dshHome` 解析 |
| `workspaceRulesFiles` | `['.dsh/rules.md']` | 会话目录里的覆盖文件，相对会话工作目录或绝对路径 |
| `workspaceAllow` | `[]` | 允许清单。非空时仅这些目录及其子目录注入 |
| `workspaceDeny` | `[]` | 排除清单。这些目录及其子目录不注入 |
| `maxBytes` | `32768` | 注入文本的硬上限，单位字节。`0` 表示不注入 |
| `order` | `100` | 在 system prompt 中的排序位置 |
| `applyToSubagents` | `true` | 设为 `false` 时子代理与队友会话不注入 |
| `announceRules` | `false` | 默认要求模型不要汇报自己在遵循哪条规则 |
| `verboseProvenance` | `false` | 设为 `true` 时每个来源用完整路径标题，而不是紧凑的 `### [global]` |
| `sourceIndex` | `false` | 设为 `true` 时在分段末尾附一份来源清单，仅用于排障 |
| `diagnosticsFile` | 未设置 | 只用于排障。把挂载、解析、缓存命中、HTTP 路由写成 JSON Lines 追加到该文件 |

### 关于 `order`

DSH 的分段顺序中，`HARNESS_IDENTITY` 是 -1000，`DEPLOYMENT_PERSONA_PREFIX` 是 0，
`TOOL_BASH` 是 1000。默认值 100 落在策略带里，在身份与人设之后、工具说明之前。
模型在读到任何工具文档前就先读到你的规则。

### 不要在本插件自带的 `cordis.patch.yml` 里写配置

那一行由 bundle 层插入，profile 层无法覆盖它，写进去的值会变成硬性约定。
本仓库的 `cordis.patch.yml` 因此刻意不带任何 config。曾经因为那里遗留
`rulesFiles: [global-rules.md]`，导致规则管理器保存的一切都不进提示词。

要自定义，请把 config 写在你自己 profile 的 `cordis.patch.yml` 里那一行：

```yaml
- id: global-rules
  name: dsh-plugin-global-rules
  config:
    maxBytes: 16384
    applyToSubagents: false
```

---

## 语言

界面文本跟随 DSH 的系统语言。语言来源按优先级：

1. `?lang=`。应用内浮层从 `ctx.locale` 读到当前语言并传给编辑器，因此会话中切换语言也能跟上。
2. `navigator.language`。浏览器或 Electron 的界面语言。直接访问 `/rules`，
   或者浮层读不到 locale 时靠它。
3. 中文。插件最初的语言。

除英语外一律回退中文，不会出现中英混杂的半翻译状态。规则内容本身不受影响，
永远按你写的原样注入。新建规则集时预填的模板文本也跟随同一语言。

### 想让 DSH 整体切成英文

插件只能跟随，不能决定 DSH 自己的语言。DSH 的界面语言由 profile 的 locale 行决定：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: system   # 或 en / zh
```

- `preference: zh` 表示界面固定中文，与操作系统语言无关。这是最容易误判的情况：
  把系统切成英文后界面仍是中文，原因在这一行，不在插件。
- `preference: system` 表示跟随操作系统语言。
- 改完需要重启 DSH。

排查顺序是先看这一行，再看编辑器状态栏。状态栏显示的文案语言就是页面实际选中的语言。
`/rules?lang=en` 可以强制英文，用来区分页面没跟随和 DSH 本身是中文这两种情况。

---

## HTTP 接口

编辑器是普通 HTTP 页面，接口也全部走 loopback。所有操作都带一个范围：
`global`，或者一个工作区绝对路径。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/rules` | 编辑器页面 |
| GET | `/rules/api/state?cwd=<dir>` | 全部状态：全局、所有工作区、当前会话实际注入的计划 |
| GET | `/rules/api/scope?scope=workspace&path=<dir>` | 单个范围的规则集 |
| POST | `/rules/api/scope?scope=workspace&path=<dir>` | 新建或收养一个工作区范围 |
| DELETE | `/rules/api/scope?path=<dir>` | 删除一个工作区的整套规则 |
| GET 与 PUT | `/rules/api/ruleset?id=<id>` | 读取或保存一个规则集 |
| POST | `/rules/api/create` | 新建规则集 |
| POST | `/rules/api/delete` | 删除规则集 |
| PATCH | `/rules/api/manifest` | 启用、停用、上移、下移 |
| POST | `/rules/api/preview` | 试运行渲染，不写盘 |

安全姿态。这个页面能改写每次会话看到的提示词，所以不只是一层装饰：

- 仅接受 `127.0.0.1`、`::1`、`localhost` 的 peer
- 写操作要求同源。`Origin` 缺失或为 `"null"` 可接受，来自其他主机的一律拒绝
- 写操作要求 `application/json`，请求体上限 512 KiB
- 工作区范围必须是绝对路径，所有文件路径由服务端推导，绝不取用请求里的路径

没有鉴权：任何能在本机访问该 loopback 端口的程序都能改规则。这与 DSH 自身的
loopback 姿态一致。如需更强隔离，请把 `webserver.host` 保持为 `127.0.0.1` 并限制本机账号。

---

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 「插件」页里安装失败，提示无法访问 GitHub | 网络到不了 GitHub | 改用方式二，下载压缩包后用本地绝对路径安装 |
| 操作后提示「操作失败：这个页面与已加载的插件版本不一致」 | 编辑器页面已更新，但 host 插件还是启动时缓存的旧版本 | 重启 DSH，再刷新页面 |
| `/rules` 返回 404 | 同上的模块缓存；或运行的是没有 HTTP 服务的 profile，headless、SDK、ACP 都不提供 Web 编辑器 | 重启；或在有 Web 服务的 profile 里使用 |
| 侧边栏没有「规则管理器」按钮 | 客户端 bundle 未加载 | 重启；确认「插件」页里本插件处于启用状态 |
| 提示 `prompt section "global:user-rules" is already registered` | 插件被启用了两次，profile 补丁与 bundle 补丁各插入了一行 | 删掉 `cordis.patch.yml` 里重复的那一行 |
| 保存成功但模型行为没变 | 规则在下一个模型步生效；或配置里设了 `rulesFiles`，全局层被换成那些文件，界面顶部会显示横幅 | 继续对话即可；或去掉 `rulesFiles` |
| 界面显示规则已启用，但模型完全看不到 | 配置里的 `rulesFiles` 是相对路径，按进程工作目录解析。桌面端的工作目录是 `<profile>`，于是它指向一个不存在的文件，全局层就空了 | 去掉 `rulesFiles`，让规则集清单说了算；再用下面的自检命令确认 |
| 模型声称我的指令里没有语言要求 | 它说的是实话，规则没进提示词 | 用 `tools/find-in-session.mjs` 按原文搜一次即可判定 |
| 切成英文后界面仍是中文 | DSH 的 locale `preference` 设成了 `zh` | 见[语言](#语言)一节 |

### 自检命令

规则到底有没有进提示词，不该靠猜。这几个脚本直接用与提示词分段相同的代码路径来回答：

```powershell
# 某个会话目录现在会收到什么，含全局、工作区、会话三层，以及最终渲染文本
node tools/inspect-injection.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# 配置层是否被 rulesFiles 劫持、工作区规则是否仍然生效，打印 PASS 或 FAIL
node tools/verify-fix.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# 从会话日志里读回模型实际看到的规则分段，这是最硬的证据
node tools/probe-session.mjs "$env:USERPROFILE\.dsh\sessions\<工作区目录>\<会话>\session.v4.jsonl.zstd"

# 按原文搜索某段规则文字到底有没有进过模型，0 命中表示没生效
node tools/find-in-session.mjs "<上面的日志>" "始终使用简体中文回答"

# 量规则分段的体积与开销占比
node tools/measure-section.mjs "$env:USERPROFILE\.dsh" "D:\my-project"

# 量真实 token 账单与缓存命中
node tools/token-report.mjs "<上面的日志>"

# 把一个文本文件按字节判定编码，避免把控制台乱码当成文件损坏
node tools/check-encoding.mjs "$env:USERPROFILE\.dsh\global-rules.md"

# 把早期单文件模式的规则迁进规则集存储，幂等，先跑 --dry-run
node tools/adopt-legacy.mjs "$env:USERPROFILE\.dsh" --dry-run
```

排查编码问题时不要用 PowerShell 读写源文件。`Get-Content`、`Set-Content`、`Out-File`
会把 UTF-8 中文破坏成不可恢复的乱码；而控制台本身的显示也可能把完好的文件显示成乱码，
例如 `# 全局规则` 显示为 `# 鍏ㄥ眬瑙勫垯`。判断文件是否损坏，只看字节。

同样，会话日志是多个 zstd 帧拼接的。`zstdDecompressSync` 只解第一帧，会得到
只有一条 session 头的假象。「日志里没有提示词」往往是解码方式错了，不是真的没有。
请用 `tools/session-log.mjs` 逐帧解码。

---

## 开发

```bash
node tools/vendor-cordis.mjs      # 可选。从本机安装提取真实 Cordis 运行时，写入 .vendor/，已 gitignore
npm run verify                    # 跑全部测试，加页面标记校验
node tools/package-release.mjs    # 构建 Release 用的 zip 与 tar.gz
node tools/serve-editor.mjs 8799 <dshHome>   # 在临时端口独立跑编辑器，便于手工验收
```

### 测试

```bash
npm test        # 143 项
```

覆盖范围包括：路径归一化与前缀匹配、允许与排除优先级、作用域计划、去重、字节预算、
试运行不写入、并发修改冲突上报、越权与跨域拒绝、非 JSON 拒绝、坏 id 拒绝、原子写、
按 scope 的读写与创建；工作区存储的 slug 唯一性、manifest 记录所属路径、
无路径的目录不算工作区、祖先目录匹配、禁用不注入、删除目录、遗留文件二次收养；
客户端 bundle 的注册 id、Cordis 契约、只 require react、侧边栏注册、浮层而非新窗口、
浮层内关闭只收起浮层、只接受同源关闭消息、locale 已知才传 `lang`；
页面逻辑的加载与渲染、脏标记、保存含改名与开关、草稿按范围跨实例保留、试运行、
页面内对话框、删除最后一个规则集后仍可关闭与重载与新建、删除后自动选中剩余规则集、
应用窗口永不被关闭、嵌入态改为通知浮层关闭、语言三级回退、工作区范围的新建编辑删除、
相对路径被拒、后端故障的错误上报、后端版本不匹配时降级；
发行前的仓库卫生检查，含安装入口是否齐全、`package.json` 是否声明了组合包、
自带补丁是否没有写配置、仓库里是否混入个人路径或密钥、
`install.ps1` 是否保持纯 ASCII；
以及真实装配用例：装载官方 `SystemPrompt` 服务，验证规则分段排在
harness 身份与人设之后、所有工具分段之前。未提取运行时时这些用例自动跳过。

`tools/run-tests.mjs` 自带 `--test-isolation=none`。`node --test` 默认会为每个文件 fork
子进程并使用管道 stdio，在某些沙箱里会以 `EPERM` 失败，
即使传 `stdio: 'inherit'` 也一样，因为 fork 的是测试运行器本身。

---

## 设计取舍

为什么是 system prompt 分段，而不是历史消息。以 `<system-reminder>` 之类形式插入历史，
模型会把它当成仅供参考的上下文；进入 system prompt 才算规则，才有资格压过仓库里的指令。

为什么 `inject` 只有 `systemPrompt`。加上 `webServer` 会让 headless、SDK、ACP profile
因为缺这个服务而静默地不再注入规则。一个可选功能不该决定核心功能是否可用。
所以编辑器路由是晚绑定的：HTTP 服务出现后再注册，带 4 秒有界重试。

为什么全局与工作区用同一套存储代码。一个工作区规则集就是一个完整的规则集存储，
只是它的 `manifest.json` 多了 `path` 与 `title`。少一套分支，就少一类只在某一边出现的 bug。

为什么缓存靠指纹而不是文件监听。指纹覆盖每个候选文件、其父目录、`manifest.json`
以及存储目录的 mtime，因此改内容、新建或删除规则集、开关、排序、新建或删除工作区规则，
都会在下一个模型步被发现，不需要常驻监听器。

为什么失败要降级而不是抛错。单个规则文件读失败只产生一条提示；清单 JSON 损坏时
退化为只列出磁盘上的文件，并在界面上报错。插件绝不因规则文件的问题让模型请求失败。

为什么界面不静默失效。页面启动时先核对标记与脚本是否匹配，36 个元素 id 全部校验，
缺元素直接列出来；网络或接口失败会把原因连同 HTTP 状态与后端消息显示在状态栏。
一个会静默失效的配置界面，比一个明确报错的界面难用得多。

零运行时依赖。只用 Node 内置模块。唯一的第三方是 `.vendor/`，
它是从你自己机器上的 DSH 安装里提取的运行时，仅供集成测试使用，已 gitignore，
从不随本项目分发。

发行包用真实打包器生成。`tools/package-release.mjs` 调用 `Compress-Archive` 与 `tar`，
而不是手写二进制格式。手写 zip 很容易出现细微错误，而发行压缩包损坏是最糟糕的发现时机。
构建脚本会先解压再跑一遍测试来验证产物。

---

## 已知限制

- 规则文件通过宿主 `node:fs` 读取，因此 `DSH_HOME` 下的规则集在沙箱策略之外，
  它属于你的受信任配置。可选的会话覆盖文件位于项目内，克隆不可信仓库时请留意。
- 没有文件监听器，编辑在下一个模型步生效，而不是编辑瞬间。
- 不做摘要压缩，超出预算时按上述规则丢弃或截断，不会让模型去压缩规则。
- 改规则内容立即生效；改插件源码不会被 HMR 热加载，因为本插件以 profile 之外的目录挂载，
  不在 HMR 的模块根里。改源码后需要重启 DSH。
- 升级需要先卸载再安装新版本，DSH 的插件页目前不支持自动更新。
- 工作区匹配按路径字符串。移动或重命名一个已配置工作区的目录后，它的规则集不会自动跟随；
  在新路径下重新「＋ 工作区」即可，旧目录可以在界面上删除。
- 试运行预览渲染当前正在编辑的范围；其他范围例如祖先目录的工作区规则取决于会话目录，
  以「当前注入」一栏和状态栏为准。
- 编辑器没有鉴权，见 [HTTP 接口](#http-接口) 的安全姿态说明。
- `tools/` 下的诊断脚本假设 DSH 的默认存储布局，也就是 `~/.dsh`，
  自定义 `storeDirectory` 时需自行传参。

---

## 许可

[MIT](LICENSE)。本项目只包含插件自身源码。从本机 DSH 安装提取的运行时属于其各自权利人，
不会被本仓库分发。
