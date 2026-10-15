# Changelog

本项目的所有重要变更都记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] — 2026-10-13

首个公开版本。

### 新增

- **规则管理器**：全局规则集与按工作区规则集，分层叠加，越具体越优先
- **system prompt 分段**：规则进入 `global:user-rules` 分段，而不是历史消息，因此具有权威性
- **覆盖所有会话**：主会话、子代理、Agent Teams 队友默认都注入（`applyToSubagents: false` 可关）
- **应用内图形界面**：侧边栏入口 + 整页浮层；也可在浏览器访问 `/rules`
- **按范围管理**：每个范围可含任意多个命名规则集，逐个启用/停用、上移/下移，按序拼接
- **试运行预览**：不写盘，直接渲染模型将会看到的完整分段，含预算截断结果
- **草稿保护**：按范围镜像到 `localStorage`；切换/重载/关闭前询问；并发修改冲突上报
- **祖先目录匹配**：从 `<项目>/src` 启动的会话同样命中 `<项目>` 的工作区规则
- **多语言界面**：跟随 DSH 语言，来源依次为 `?lang=`、`navigator.language`、中文
- **零运行时依赖**：只用 Node 内置模块
- **发行与安装**：`tools/package-release.mjs` 构建 zip 与 tar.gz 并附校验和；
  `install.ps1` 可一键下载解压；推送标签由 `release.yml` 自动发布到 Releases 页；
  `ci.yml` 在两个操作系统与两个 Node 版本上跑测试，并检查仓库卫生

### 修复

开发过程中修复的真实缺陷，按发现顺序：

- 「关闭编辑器」曾调用 `window.close()`，在 DSH 桌面窗口中会**关掉整个 DSH**。
  改为应用内浮层：关闭只是收起一个 DOM 节点，并在嵌入态通过同源 `postMessage` 通知父页面
- `rulesFiles` 曾**旁路整个作用域链**，一个与工作区无关的全局设置会静默关掉所有工作区规则。
  现在只替换全局层；相对路径改为相对 `DSH_HOME` 解析，不再看进程工作目录
- 自带的 `cordis.patch.yml` 曾遗留 `rulesFiles: [global-rules.md]`。bundle 补丁无法被 profile
  覆盖，导致规则管理器保存的一切都不进提示词。现已不带任何 config
- 删除规则集后选中项变 `null`，编辑器空白：`remove()` 直接渲染而没过状态归一化
- 工作区草稿与全局草稿同键，同名规则集跨范围互相覆盖
- 页面在**没有 `?lang=` 时写死中文**，英文系统下界面仍是中文
- 浮层在 locale 读不到时**强行写 `?lang=zh`**，反而覆盖了页面本可做的浏览器语言检测
- `ctx.get('locale')` 在服务未注入时会**抛异常**，不是返回 `undefined`
- 异步函数里的同步 `fetch` 抛出会绕过 `try/catch`，变成未处理拒绝
- 路由在 HTTP 服务之前注册时会静默失去整个编辑器 → 改为 4 秒有界重试的晚绑定
- 页面与 host 版本不匹配时报 `Cannot read properties of undefined` → 现在归一化所有历史响应形状，
  无法识别时明确提示「页面与已加载的插件版本不一致」
- 头部文案曾要求模型「与仓库指令冲突时说明」，被泛化成**每轮都汇报自己用了哪条规则**；
  已删除该指令并明确要求安静执行
- 每个来源标题里塞完整绝对路径，每次请求都要付费 → 改为紧凑的 `### [global]` 标签

### 备注

- 插件源码在 HMR 的模块根之外，**改源码需要重启 DSH**；改规则内容不需要
- 集成测试需要从本机 DSH 安装提取运行时（`node tools/vendor-cordis.mjs`），未提取时自动跳过

[Unreleased]: https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules/releases/tag/v1.0.0
