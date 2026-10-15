## 这个 PR 做了什么

<!-- 一句话 -->

## 类型

- [ ] 修 bug
- [ ] 新功能
- [ ] 重构 / 文档 / 测试

## 现象 / 原因 / 改法

**现象：**

**原因：**（要写到具体那行判断，不要停在"逻辑有问题"）

**改法：**

## 验证

- [ ] `npm run verify` 全绿（0 failing）
- [ ] 新增/修改了对应测试
- [ ] 修 bug 的 PR 附带了**能复现该 bug** 的用例

贴出关键命令与真实输出：

```text

```

## 硬性约束自查

改动前请读 [CONTRIBUTING](CONTRIBUTING.md) 的「硬性约束」。逐条确认：

- [ ] 规则仍是 system prompt 分段
- [ ] `index.js` 的 `inject` 仍只有 `systemPrompt`
- [ ] `cordis.patch.yml` 仍未写任何 config
- [ ] 退出路径仍不会无条件调用 `window.close()`
- [ ] `rulesFiles` 仍只替换全局层
- [ ] 界面失败仍会明确报错，没有新增静默失效路径

## 没有提交

- [ ] 个人绝对路径
- [ ] 令牌 / 密钥 / 会话日志
- [ ] `.vendor/`、`.test-report.txt`、`.dsh/`
