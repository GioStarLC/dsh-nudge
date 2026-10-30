<p align="center">
  <img src="./icon.svg" width="72" alt="dsh-nudge">
</p>

<h1 align="center">dsh-nudge</h1>

> **nudge** /nʌdʒ/<br>
> *v.* 轻推；轻触。<br>
> *n.* 一次恰到好处的推动；不接管，只影响。

在 DSH 里，nudge 是你对 agent 的一次轻推。推什么、何时推，由你决定。

<p align="center"><img src="https://github.com/user-attachments/assets/e37dc710-a457-4ec7-ae01-ea2ce2e709c3" width="720" alt="批注与快速回复演示"></p>

## 批注

在窗口里打开「快速批注」，选中对话里的文字，松开鼠标后指针旁就会弹出卡片
（拖动选择的过程中不会弹，避免抢焦点打断选择）：

- 👍 同意、👎 不同意，或者自己写一句；卡片不重复原文，添加后原文标黄。
- 卡片弹出后按 `Ctrl+C`（macOS 是 `⌘C`）即可复制选中的原文，自动聚焦不会打断复制。
- 添加批注、同意或不同意之后，窗口里的批注栏自动展开，能立刻看到条数和后续动作。
- 批注按会话保存在本地，窗口里汇总当前会话的批注，再统一写入输入框或发送。
- 在窗口列表里点一条批注，可以修改或删除。
- 「自动粘贴」开关（批注栏标题行，设置里也有）：开启后点进输入框时，待发送的批注会自动写入草稿并清空待发送列表。

## 快速回复

- 窗口里的「快捷输入」把常用问法（口径）平铺成按钮：简述、快一点、四行；点一下就把这句发给 agent，回答落回对话。
- 光标在输入框时改为写入草稿，不发送。
- 按钮行末尾的「＋ 新增」就在窗口里加一条口径：填标题和正文，保存后立刻出现在按钮里。
- 口径可以在设置里改、停用、删除或恢复默认，条数不限；急速模式下双击口径直接执行。
- 设置页里每条口径默认只占一行、只显示标题：点标题展开只读正文，右上「全部展开」「全部折叠」一次管住所有条目；改内容点行尾的铅笔图标，展开成「名称 + 正文」两个框，按保存或取消生效。
- 行尾的「已启用 / 已停用」决定这条口径是否出现在窗口的快捷输入里；停用的留在设置里，选中它时自动换到第一条启用的口径。
- 排序靠拖动每行，拖过邻近行的中线就即时换位，也可以用 Tab 聚焦左侧 ⠿ 手柄后按 ↑/↓；顺序会立刻保存。
- 点「批量导入」可以一次贴进多条：每段之间空三行及以上分开，每段第一行是标题、其余行是正文；只有一行时这句就是标题也是正文。贴进来会跳过重复的，条数写在框下。
- 投递方式可选直接打断（默认）或排队，设置页里同样可以切。
- 界面上的每个开关（急速模式、快速批注、自动粘贴、投递方式）在设置页都有对应项。
- 设置存在浏览器本地，同时归档到 Host 侧的 `nudge-store.json`；应用重启或端口变化导致本地存储清空后，设置会自动恢复，旧版本写下的口径结构也会被识别并保留。

## 状态行文案

标题栏下面那行小字常驻（悬浮窗顶部），空闲时轮换显示提示文案：

- 切换开关时的提示会在这行停留 5 秒，之后继续轮换；空闲时每句文案也是停 5 秒再换下一句。
- 文案可以在设置页「状态行文案」里逐句编辑、新增、删除、拖动排序（至少保留一句），最多 20 句，也能一键恢复默认。
- 每条文案同样只占一行、显示成一句话，点行尾铅笔图标才展开输入框，保存或取消生效；顺序靠拖动左侧 ⠿ 手柄调整。
- 新增入口是一个多行框，放在列表上方：整段粘贴进去会立刻按行拆成一句一句（空行、与已有重复的行会跳过），并在框下提示加了几条、跳过了几行；手写时一行一句，`Ctrl+Enter` 提交。
- 文案和上面那些开关一样随设置持久化，同样归档到 Host 侧的 `nudge-store.json`。

窗口可拖动，也能收起成胶囊，位置记在本地；窄屏默认收起。标题栏、批注栏和快捷输入栏都不再有下拉箭头：点各自的标题文字就能折叠或展开对应的内容；标题栏整条都可以点，但栏内的小按钮（设置齿轮）仍只做自己的事。

设置齿轮会按“注册的命令 → 侧栏触发器 → 合成快捷键”的顺序依次尝试打开 DSH 的设置面板，每试一条都等面板真的出现（最多 0.6 秒）才继续，成功后再点到本插件这一节。命令被拒绝时不留副作用，所以排在最前；只有按下这一点仍未打开时才会去点侧栏触发器，而且只点能自证身份的按钮（标签写着设置，或挂着设置快捷键），绝不盲点侧栏里其它弹窗按钮——那样会先闪一个无关的弹层。如果当前壳层没有任何可达的入口（侧边栏入口被账户菜单占用、快捷键服务不可用、命令被模态框挡住），它就直接在悬浮窗里把同一份设置表单渲染出来，齿轮不再点了没反应。再点一次齿轮、点面板右上角的 × 或按 Esc 都能退回原窗口。

### 设置跳转层（`client.settings-jump.js`）

跳转逻辑不在主 bundle 里，而是同目录的包内 chunk `client.settings-jump.js`：按下齿轮时 `client.js` 用 `require.async('./client.settings-jump.js')` 把它取回来，取到后缓存复用。这是 DSH 加载器支持的形态——chunk 名必须匹配 `client.<名>.js`、与 `client.js` 同目录，host 会把该目录下的同批文件直接 serve 出去；`package.json` 的 `files` 必须带上它，否则 git 安装的副本里没有这个文件。

chunk 导出 `createSettingsJump({ getShortcuts, getSlots, sectionTitle, onDiag, onFallback })`，返回 `{ open, cancel, probe }`。它不读插件自身的 state，也不写插件自己的存储——“跳到哪一节”由 `sectionTitle` 决定，“没有入口时怎么办”由 `onFallback` 决定，采样写到哪里由 `onDiag` 决定。本插件只是其中一份接线：`sectionTitle: () => text('settingsTitle')`、`onFallback` 渲染窗内表单、`onDiag` 落到 `nudge-store.json` 的 `ui.settingsDiag`。

以后要跳别的目标（别的设置节、插件的 Plugins 页），复制这个 chunk 再建一个实例即可：路线表、每路 0.6 秒的回执等待、“面板真的出现才算成功”的判定都不必重写。真要跨插件共用，则把它做成独立的 client 服务包（消费方 `inject` 后 `ctx.get(...)` 调用），代价是多一个包与版本配对。

因为 chunk 只能异步取回，`openSettings()` 返回 `Promise<boolean>`。文件缺失（旧安装副本）或壳层加载器不支持 chunk 时，齿轮退回窗内表单，不会变成死按钮。

## 安装

桌面端先退出应用，再按所用的那一端执行：

```sh
dsh plugin --profile desktop add github:GioStarLC/dsh-nudge   # 桌面端
dsh plugin --profile web     add github:GioStarLC/dsh-nudge   # dsh web
```

重启或刷新窗口，无需构建。

若启动时报 `dsh: failed to read overlay …\dsh-nudge\cordis.patch.yml: ENOENT`，说明安装副本里缺了包声明的 `dsh.bundle.patch`（插件行就是从这个文件插进去的，缺了它整条 `nudge` 行都不会注册）。把仓库里的 `cordis.patch.yml` 与 `icon.svg` 补进该安装目录再重启即可，不必重新安装。

## 开发

```sh
npm install
npm run hooks:install   # 首次克隆后执行，启用 .githooks/pre-commit
npm run check
npm run preview:all
```

`check` 跑 client 和 host 检查，提交钩子也会调用；`preview:all` 把界面场景渲染到 `preview-out/`。

仓库不含任何安装期钩子（没有 `prepare`、`postinstall`），所以以 git 方式安装的消费方不会触发 pnpm 的构建脚本审批。

## 更新日志与发布

`CHANGELOG.md` 由 `scripts/changelog.mjs` 从 git 历史生成，是"标签 + 提交"的纯函数：同一段历史跑两次得到同样的字节，因此不需要手工维护，也不会与提交记录脱节。

```sh
npm run changelog              # 预览"最近标签..HEAD"这一段，也就是下一个版本会写进去的内容
npm run changelog:all          # 预览整份文件
npm run changelog:write        # 重新生成 CHANGELOG.md
node scripts/changelog.mjs --since-push          # 已提交但还没推送的改动
node scripts/changelog.mjs --write --version v0.2.0  # 发版前给下一段贴版本号
node scripts/changelog.mjs --range HEAD~3..HEAD  # 任意区间
```

提交信息按 Conventional Commits 写，标题会自动归入对应分类：

| 前缀 | 分类 | 前缀 | 分类 |
| --- | --- | --- | --- |
| `feat(scope):` | 新增 | `test:` | 测试 |
| `fix(scope):` | 修复 | `build:` | 构建 |
| `perf:` | 性能 | `ci:` | CI |
| `refactor:` | 重构 | `revert:` | 回滚 |
| `docs:` | 文档 | `chore:` | 维护 |
| `style:` | 样式 | 其他写法 | 其他 |

不符合约定的提交（例如 `client.js: 按钮 tooltip`）不会被丢弃，会连同冒号前的部分一起落到"其他"，所以早期历史也照常可读。

提交正文里以 `- ` 开头的行会成为该条的子条目，所以一次提交可以带几句细节，更新日志不必只剩一行标题。

发布一个版本：

```sh
# 1. 功能改动按主题分成多次提交，每条提交信息写清分类和范围
git add client.js && git commit -m "feat(client): 批注气泡支持拖动"
git add index.js  && git commit -m "fix(host): 状态行在重连后丢失"

# 2. 升版本号（修复升 patch，新功能升 minor，破坏性改动升 major）
#    然后让"未发布"这一段直接以版本号命名
npm run changelog:write -- --version v0.2.0

# 3. 提交、打标签、推送
git add -A && git commit -m "chore(release): v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"
git push --follow-tags

# 4. 校验：此后重新生成应无 diff
npm run changelog:write && git status --short CHANGELOG.md
```

两个不变量让第 4 步成立：发布块按**最新一条真实提交的日期**命名，而不是标签创建时间；`chore(release):`、`changelog(release):` 这类提交被跳过。所以打标签前后生成的是同一份字节，标签里提交的 `CHANGELOG.md` 就是这个版本最终的样子。

`--version` 与已存在的标签重名时会直接报错——已发布的段落只由标签决定，不接受重命名。

工作区里未提交的改动不在任何区间内，脚本会用警告列出它们，避免以为已经记录。

要写给人看的版本说明，放 `scripts/release-notes/<tag>.md`，它会整段替换该版本的正文。完整的发版流程（拆提交、写版本说明的判据与反例、校验、对象库异常的处理）见 [docs/RELEASE.md](docs/RELEASE.md)。

## 许可

MIT
