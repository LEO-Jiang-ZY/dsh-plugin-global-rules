# 参与贡献

感谢你愿意改进这个插件。下面是让改动顺利合入的最短路径。

## 开始之前

```bash
git clone https://github.com/LEO-Jiang-ZY/dsh-plugin-global-rules.git
cd dsh-plugin-global-rules

# 可选：从本机 DSH 安装提取真实 Cordis 运行时，让集成测试真正跑起来
node tools/vendor-cordis.mjs

npm run verify     # 全部测试 + 页面标记校验
```

`tools/vendor-cordis.mjs` 只在你的机器上读本机的 `app.asar`，产物写入 `.vendor/`（已 gitignore）。
不跑这一步也能开发：集成测试会自动跳过，其余测试照常运行。

## 硬性约束

这几条不是风格偏好，是踩过的坑，改动它们前请先读 [CHANGELOG](CHANGELOG.md)：

1. **规则必须是 system prompt 分段**，不能改成往历史里插 `<system-reminder>`。
   分段才有资格压过仓库里的指令。
2. **`index.js` 的 `inject` 只保留 `systemPrompt`。** 加上 `webServer` 会让 headless/SDK/ACP
   profile 因为没有该服务而**静默地不再注入规则**。编辑器路由必须是晚绑定。
3. **`cordis.patch.yml` 里不能写 config。** bundle 行无法被 profile 覆盖，写进去就是硬性约定。
   曾经因为遗留 `rulesFiles` 导致规则管理器保存的一切都不进提示词。
4. **永远不要无条件调用 `window.close()`。** 在 DSH 桌面窗口里那会关掉整个 DSH。
   退出路径必须是「嵌入态通知浮层 → 脚本打开的窗口才允许 close → 其余只说明」。
5. **`rulesFiles` 只替换全局层**，不能旁路工作区规则。
6. **界面不能静默失效。** 缺元素、接口报错、版本不匹配，都要在状态栏写清原因。

## 测试要求

- 任何行为改动都要有对应测试。修 bug 时优先写一个**能复现该 bug** 的用例。
- 提交前跑 `npm run verify`，确保 0 failing。
- 测试用 `tools/run-tests.mjs` 而不是直接 `node --test`：后者会为每个文件 fork 子进程并使用
  管道 stdio，在某些沙箱里以 `EPERM` 失败。执行器改用 `--test-isolation=none`。

## 代码风格

- 缩进 2 空格，换行 LF，编码 UTF-8。
- 只用 Node 内置模块，**不引入运行时依赖**。集成测试所需的运行时走 `.vendor/`。
- 注释解释「为什么」，而不是「做了什么」。这个仓库里不少注释记录的是**曾经的错误**，
  请保留它们的意图。
- 提交信息用中文：标题一行说清做了什么，正文说为什么。

## 不要提交

- 任何个人绝对路径（`C:\Users\<你>`、`/home/<你>`）
- 令牌、密钥、会话日志
- `.vendor/`、`.test-report.txt`、`.dsh/`

CI 会自动检查个人路径与疑似密钥，也会校验 `cordis.patch.yml` 没有 config。

## 提交 Pull Request

1. Fork 并开一个分支
2. 改动 + 测试
3. 在 PR 描述里写：**现象 / 原因 / 改法 / 怎么验证的**
4. 如果改动涉及上面的「硬性约束」，请说明理由

## 报告问题

请附上：

- DSH 版本与操作系统
- `node tools/inspect-injection.mjs "$env:USERPROFILE\.dsh" <你的工作区>` 的输出
- 如果问题是「规则没生效」，再加一条原文搜索结果：
  `node tools/find-in-session.mjs "<会话日志>" "<规则里的一句话>"`
- 界面问题的截图

「规则没生效」和「模型没遵守规则」是两件事，上面两条命令能把它们区分开。
