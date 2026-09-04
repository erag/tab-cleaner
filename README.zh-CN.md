# Tab Cleaner

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-blue.svg)](./manifest.json)
[![No build step](https://img.shields.io/badge/build-none-lightgrey.svg)](#开发)

一个 Chrome 扩展（Manifest V3）：自动关闭那些你早就忘了、又空闲太久的标签页。

[English](./README.md) · **中文说明**（本页）

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [权限说明](#权限说明)
- [开发](#开发)
- [项目结构](#项目结构)
- [已知限制](#已知限制)
- [贡献](#贡献)
- [License](#license)

## 功能

- **空闲阈值** — 自定义多久没访问的 tab 会被判定为空闲（默认 30 分钟），可按分钟/小时设置。
- **清理阈值** — 只有当前打开的 tab 数超过这个数量（默认 10，最小 1）才会开始清理；数量不够时无论多空闲都不会
  被关闭。一旦超过阈值，会按最久未使用（LRU 缓存淘汰最旧条目那种顺序）优先关闭最旧的空闲 tab，一旦数量回落到
  阈值以内就立刻停止，不会关闭超过实际需要的数量。
- **域名白名单** — 最多添加 10 个域名（含子域名，比如 `google.com` 也会覆盖 `mail.google.com`），这些域名下
  的 tab 永远不会被自动关闭，不受空闲时间或 tab 数量阈值影响。
- **保护规则**
  - 有音频的 tab（正在播放视频/音乐）不会被关闭。
  - 有未提交表单输入的 tab 不会被关闭 —— 关闭前会注入检测脚本，确认页面里是否有已修改但未提交的输入框/文本域。
  - 每个窗口当前激活的 tab 永远不会被关闭。
- **实时状态** — 弹窗显示当前打开的 tab 总数，以及已经超过空闲阈值、下一轮清理会被处理的数量。
- **关闭历史** — 记录每一个被自动关闭的 tab（URL、标题、存活时长）。点击历史条目可直接重新打开。

## 安装

本项目没有构建步骤，直接加载源码即可：

1. Chrome 地址栏输入 `chrome://extensions` 并回车。
2. 打开右上角「开发者模式」开关。
3. 点击「加载已解压的扩展程序」。
4. 选择本仓库的根目录。
5. 完成 — 工具栏会出现 Tab Cleaner 图标。

之后拉取更新后，回到这个页面点扩展卡片上的刷新图标即可，不需要重新加载。

## 使用

点击工具栏图标打开弹窗：

- 右上角开关整体启用/禁用插件。
- 「空闲阈值」设置多久判定为空闲。
- 「保护规则」勾选是否保护有音频/有输入的 tab。
- 「关闭历史」查看最近被清理的 tab，点击可重新打开。

插件在后台每分钟检查一次，把符合条件（空闲超时、非当前激活、未被保护规则排除）的 tab 自动关闭。

## 权限说明

| 权限 | 用途 |
|---|---|
| `tabs` | 读取 tab 的 URL/标题/是否播放音频，以及执行关闭操作 |
| `alarms` | 每分钟触发一次空闲检查 |
| `storage` | 保存用户设置和关闭历史（本地持久化），以及 tab 活跃时间戳（仅会话期间） |
| `scripting` | 关闭前向页面注入脚本，检测是否有未提交的表单输入 |
| `host_permissions: <all_urls>` | 上述脚本注入需要覆盖任意网站 |

插件不会上传任何数据，所有信息都只保存在本地浏览器中。

## 开发

没有构建工具、包管理器或 linter — 就是直接被 Chrome 加载的原生 JS。

`scripts/history-utils.js` 是唯一一块纯逻辑代码（不依赖 `chrome.*` API），有对应的 Node 测试：

```bash
node --test tests/*.test.js
```

其余涉及 `chrome.tabs`/`chrome.storage`/`chrome.alarms` 的逻辑（`background.js`、`popup/popup.js`）需要在
Chrome 里手动验证 —— 按上面「安装」步骤加载后，通过扩展卡片上的「service worker」链接查看后台日志，或右键
工具栏图标「检查弹出内容」调试弹窗。

更详细的架构说明见 [`CLAUDE.md`](./CLAUDE.md)。

## 项目结构

```
manifest.json           扩展清单
background.js           后台 Service Worker：空闲检测与自动关闭逻辑
popup/                  工具栏弹窗界面
  popup.html / .js / .css
scripts/
  detect-input.js         注入页面检测未提交表单输入
  history-utils.js         纯逻辑辅助函数（关闭记录的构建/格式化），background.js 和 popup.js 共用
  domain-utils.js          域名白名单的纯逻辑辅助函数，background.js 和 popup.js 共用
tests/
  history-utils.test.js    history-utils.js 的 Node 测试
  domain-utils.test.js     domain-utils.js 的 Node 测试
icons/                   扩展图标
```

## 已知限制

- 弹窗里「即将清理」的数量会应用音频保护规则，但**不**应用输入保护规则 —— 因为检测表单输入需要往每个候选 tab
  注入脚本，如果在弹窗统计时也这么做，会把已经被 Chrome 自动"丢弃"（discarded）的后台 tab 强制唤醒，与插件
  本身省资源的目的相悖。所以这个数字有时会比实际真正被关闭的数量略高。
- 对于插件安装/浏览器启动前就已存在的 tab，其"存活时间"的起点是安装/启动那一刻（真实创建时间已不可知），而
  不是 tab 真正被打开的时间。

## License

MIT © Tab Cleaner Authors — 详见 [LICENSE](./LICENSE)。
