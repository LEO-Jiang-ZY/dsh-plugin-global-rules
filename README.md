<a id="chinese"></a>

# dsh-plugin-global-rules

**中文** · [English](#english)

DeepSeek Harness 的规则管理器：把你自己的规则注入到每一个工作区的系统提示词里，
并用一个图形界面按「全局 / 单工作区」分层管理它们。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-149%20passing-brightgreen.svg)](#测试)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#设计取舍)

主要能力：

- 全局加每工作区。一份全局规则打底，任意多个工作区各自叠加自己的规则，越具体越优先。
  会话在工作区的子目录里也能命中它所属项目的规则。
- 规则进入 system prompt 的一个分段，而不是以仅供参考的历史消息形式注入，因此具有权威性。
- 一处设置，处处生效。Web、headless、SDK、ACP 共用同一份规则。
- 覆盖所有会话。主会话、子代理、Agent Teams 队友都注入，并且可以选择性关闭。
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

三种方式都需要在安装完成后重启一次 DSH。这是因为插件源码不在 HMR 的监视范围内，
不重启不会加载进来。之后的工作中只需要改规则内容的情况，则不需要重启。

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

这种方式需要能直接访问 GitHub。如果弹出「无法访问 GitHub」或「连接 GitHub 超时」，
说明当前网络无法直连 GitHub，请改用方式二或方式三。对话框此时会建议「改用国内镜像」，
但该镜像提供的是 npm 注册表里的包，不能代替从 GitHub 仓库下载，所以对本插件无效。

### 方式二：下载压缩包，用本地绝对路径安装

这种方式适合网络无法直接连接到 GitHub 的情况。

1. 打开 [Releases 页](https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/latest)，
   下载里面的 `dsh-plugin-global-rules-v<版本号>.zip`
2. 解压到任意目录，例如 `C:\Users\<你>\plugins\`
3. 在「添加插件」的输入框中，填入解压后的目录的绝对路径：

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

脚本会完成三件事：下载、解压到 `~/.dsh/plugins`、打印接下来要填进对话框的路径。


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
npm test        # 149 项
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

---

<a id="english"></a>

# dsh-plugin-global-rules

[中文](#chinese) · **English**

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
npm run verify                    # run every test plus the page-markup and bilingual-structure checks
node tools/package-release.mjs    # build the release zip and tar.gz
node tools/serve-editor.mjs 8799 <dshHome>   # run the editor standalone on a scratch port for manual acceptance
```

This README carries the same documentation in two language blocks.
`tools/check-readme.mjs` checks that they stay structurally consistent: the same number of
sections on both sides, every internal anchor present, and no code fence left open. Run it
after editing either half, otherwise the other one drifts out of date.

### Tests

```bash
npm test        # 149 tests
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
