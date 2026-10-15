---
name: Bug 报告
about: 规则没生效、界面异常、崩溃
title: '[Bug] '
labels: bug
---

## 现象

<!-- 你期望发生什么，实际发生了什么 -->

## 这属于哪一类

- [ ] 规则**没有进提示词**（模型完全看不到）
- [ ] 规则进了提示词但**模型没遵守**
- [ ] 图形界面异常
- [ ] 安装/加载失败
- [ ] 其他

## 环境

- DSH 版本：
- 操作系统：
- Node 版本（`node --version`）：
- 插件版本 / commit：

## 复现步骤

1.
2.
3.

## 诊断输出

**必填**，这两条能把「没进提示词」和「没遵守」区分开：

```text
# 1. 该工作区现在会收到什么
node tools/inspect-injection.mjs "$env:USERPROFILE\.dsh" "<你的工作区路径>"

# 2. 规则原文是否真的到过模型（0 命中 = 没生效）
node tools/find-in-session.mjs "<会话日志路径>" "<规则里的一句话>"
```

<details>
<summary>点开粘贴输出</summary>

```text

```

</details>

界面问题请附截图；控制台报错请附原文。
