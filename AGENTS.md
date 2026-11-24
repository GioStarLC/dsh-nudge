# AGENTS.md

dsh-nudge 是一个 DSH Web 插件：在悬浮窗里选一条快捷输入，让 agent 汇报当前状态，回答直接落在对话里。改浏览器半部前先读 `src/client/index.js` 头部的扩展点清单；发版流程见 [docs/RELEASE.md](docs/RELEASE.md)。

## 仓库布局

```
index.js                        宿主半部：设置持久化 + loopback 路由（inject: webServer）
src/client/index.js             浏览器半部入口：扩展点清单、apply、四个 slot 的注册
src/client/runtime.js           窗口状态机：投递、等待、批注、设置、统计
src/client/view.js              悬浮窗渲染树；settings-view.js 是设置页渲染树
src/client/composer.js          输入区桥；其余模块按职责拆分（设置、存储、词表、几何、CSS…）
src/client/delivery.js          投递与等待：probe 进对话、事件窗口关联、超时与回执
src/client/view-parts.js        视图叶子组件：批注卡片、就地编辑、批注栏、快捷输入表单
src/client/input-bar.js         输入框左下角那一行：钉住的快捷输入、更多菜单
src/client/stats-board.js       设置页看板：今日拆分、15 天趋势、快捷输入 Top 3
src/types/client.d.ts           ctx / 服务 / 运行时状态的形状（全局声明，JSDoc 引用）
src/types/react.d.ts            本插件用到的 React 面：createElement 与六个 hook
src/client.settings-jump.js     按需加载 chunk 的源码：设置跳转
client.js                       产物：浏览器半部 bundle（由 npm run build 生成，提交）
client.settings-jump.js         产物：按需加载的 chunk（同上）
cordis.patch.yml                bundle patch：一行插件注册，零配置
locale/{en,zh}.json             插件元数据文案
scripts/build.mjs               src/ → 两个产物（rollup）；--verify 比对已提交的产物
scripts/check-units.mjs         模块级校验：直接 import 纯函数模块，不启动 VM
scripts/check-client.mjs        浏览器半部校验（VM + stub React；含与宿主半部的桥接检查）
scripts/check-host.mjs          宿主半部校验（临时 profile 目录）
scripts/check-graph.mjs         代码图校验：project root 必须解析成仓库根
scripts/check-release.mjs       发版事实校验：tag、package.json、CHANGELOG 同名
scripts/harness.mjs             共享 VM harness（check 与 preview 共用）
scripts/preview.mjs             场景截图回路
scripts/changelog.mjs           CHANGELOG 生成器（按 git 历史）
scripts/release-notes/          每版手写说明 <tag>.md
docs/RELEASE.md                 发版流程
.githooks/pre-commit            提交守卫：npm run check
.github/workflows/check.yml     CI：推送/PR 跑 check，打 v* 标签再跑发版校验
```

`client.js` 与 `client.settings-jump.js` 是**要提交的生成物**：改 `src/` 后跑 `npm run build`，产物与源码同一条提交。不提交的生成物：`preview-out/`、`.agent/`、`graphify-out/`。

## 为什么有两个半部

Web GUI 每次启动换一个 loopback 端口，浏览器视角就是**新的 origin**，`localStorage` 随之清空。所以宿主半部持有 durable 副本，浏览器半部继续用 `localStorage` 当同步缓存，页面加载时按需回灌。改设置链路前先理解这一点，否则会把持久化逻辑又塞回前端。

## 命令

```sh
npm install              # 首次克隆后：两个 devDependency（rollup、typescript）
npm run build            # src/ → client.js + client.settings-jump.js（产物要提交）
npm run check            # 日常验证入口：产物核对 → tsc → 模块级 → client + host + graph
npm run check:types      # 只跑 tsc --checkJs（src/ 全量）
npm run check:units      # 只跑模块级校验（纯函数，直接 import 源码）
npm run check:client     # 只跑浏览器半部
npm run check:host       # 只跑宿主半部
npm run check:graph      # 只校验代码图的 project root（无图时跳过）
npm run check:release    # 仅在发布提交上跑：tag / 版本 / CHANGELOG 必须同名
npm run preview          # 一个场景截图到 preview-out/<scene>.png
npm run preview:all      # 所有场景，亮色 + 暗色
npm run changelog        # 预览未发布窗口
npm run changelog:write  # 重新生成 CHANGELOG.md（生成物，不手改）
npm run hooks:install    # 启用 .githooks/pre-commit

# 更新代码图（本会话改过代码后、或 graphify_status 报 STALE 时；纯本地、秒级、不花 token）
# 务必传绝对仓库根——传 `.` 会把 graphify-out/.graphify_root 写成 `.`，
# 插件把相对值拼到 graphify-out/ 上，所有 graphify_* 查询就找不到 graph.json 了。
# 已经写坏了就删掉该标记文件，规范布局（dirname(graphify-out)）即可恢复。
uv run --with "graphifyy[mcp]==0.9.57" graphify update "$PWD"
```

`check` 的顺序是有意的：先 `build --verify`（`src/` 改了却没重新构建，这一步直接失败），再 `tsc --checkJs`（形状不对），再 `check-units`（纯逻辑），最后才是 client、host、graph 的行为校验。`test` 脚本不存在，也不要新增。

## 收尾推送

用户说「收尾推送」（或「总结未推送的内容并写到 changelog，推送到 git，不需要打 tag」）时，读并执行 [.dsh/skills/closeout-push/SKILL.md](.dsh/skills/closeout-push/SKILL.md)：盘点 → 摘要确认 → 一次提交 → 生成 CHANGELOG → 校验 → 推 `origin main`。不建 tag，不动版本号。

## graphify

项目根有 `graphify-out/`，但它是 gitignored——新 clone 或换机器时不存在，先按上面「命令」建图，别默默退回归 grep。

- **回答架构或代码库问题前，先读 `graphify-out/GRAPH_REPORT.md`**（枢纽节点 + 各社区的成员清单）。比一次 `query_graph` 便宜，也基本就是本仓库缺的那张模块地图。
- **存在 `graphify-out/wiki/index.md` 时先看它**，但结论仍回源码确认（本仓库当前没有 wiki）。
- **改过代码就重建图**：「命令」里那条 `graphify update`，AST-only、不花 API。
- **报告会落后于图。** `update` 只重写 `graph.json`，不重画 `GRAPH_REPORT.md`；要新的社区结构就补一次 `graphify cluster-only`。行号与边以 `graph.json` 为准。

## 查代码：grep 定位符号，graphify 看结构

浏览器半部按职责拆在 `src/client/` 下，但 `runtime.js`（约 2.9k 行）与 `view.js`、`settings-view.js`（各一千多行）仍是最大的三个文件。grep 能定位符号，答不出"这块功能散在哪、改这里会波及谁"；这类问题用图（`graphify_*`），逐符号定位用 grep。

- **什么时候上图。** "某功能散在哪些函数/模块""谁调用 X、X 又调了谁""改这里波及谁""两条链路怎么串起来"→ 先读 `GRAPH_REPORT.md`（见上），要精确边和行号再 `query_graph`（BFS 铺面、DFS 追线）、`god_nodes`、`get_neighbors`、`shortest_path`。只找定义、精确字符串、改文案、单点符号 → `grep`/读源码，一次就中，别绕路。**别用仓库级宽 grep 开场**（`"批注|annotation"` 一把梭）；查询词用代码里的词，不是界面的中文词。
- **调用一律带 `project_path`**（仓库根绝对路径）。不传时用的是 MCP 启动时缓存的 project root；`npm run check:graph` 守的就是这个不变量。
- **`HEALTHY` 不等于查得动。** `graphify_status` 报绿只说明 graph.json 在、不新，它不做真实查询。查询报错先补 `project_path` 重试一次；仍失败再说明图不可用，别默默退回归 grep。
- **过期图不算证据。** 报 `STALE` 就先重建（命令见「命令」）；拿着过期图写下"这个函数不存在"式的判断，比不查图更糟。工作区本来就脏时，"Working tree changed" 是常态。
- **INFERRED 边是推测。** 图里有一部分边是推断出来的（例如 `createRuntime()` → `syncComposerFocus` 的 `indirect_call`，实际是 `addEventListener` 的参数）。把它当线索，不当结论；写进汇报前用 `get_neighbors` 加读源码确认。
- **社区有名字，导航仍靠枢纽。** 社区按枢纽节点命名（例如 `createRuntime` 那个社区），`get_community` 可用；常用入口还是 `createRuntime()`、`factory()`、`setState()`、`makeView()`、`makeSettingsView()` 这些 hub 节点及其邻居。
- **图与源码冲突，以源码为准**，并在结论里注明引用了哪个节点，方便别人复核。

## 约定

- **边界有名字，内部靠推断**：`src/types/client.d.ts` 用全局 interface 命名 `ctx`、各服务和运行时状态；模块在入口处用 JSDoc 标注参数与返回，内部不再重复。`tsc --checkJs`（`strict: false`）会核对属性名、参数个数和可空性，但不会要求全量注解。DSH 发布与安装版本匹配的 client 类型时，替换这个文件即可，调用点已经带好了注解。新增 `ctx.get('...')` 之前先在 `DshContextServices` 里登记形状。
- **`src/` 是源码，`client.js` / `client.settings-jump.js` 是提交的产物**：`npm run build` 用 rollup 把 `src/client/` 打成一个 CommonJS 包，再由 `scripts/build.mjs` 套上 `window.__ModuleLoader__.load({ id, factory(require) })`；源码里 `import 'react'`，产物里是 loader 的 `require('react')`。产物必须和源码一起提交，改了 src 不构建 `check` 会红。选 rollup 而不是 esbuild，是因为它只改 import/export，模板字符串里的 `\n`、注释和排版都原样保留——产物仍可逐行对照源码（见脚本头注释）。chunk 契约不变：与 `client.js` 同目录、名字匹配 `client.<name>.js`、注册为 `<owner id>/client.<name>.js`、导出纯函数（无 React、无插件状态），源码在 `src/client.settings-jump.js`。
- **设置有两份**：`localStorage` 的 `dsh-nudge:*` 是同步缓存；`index.js` 落在 profile 目录的 `nudge-store.json` 是跨重启、跨端口的真副本（`DSH_HOME` 可覆盖）。client 侧每个设置项都在 `src/client/settings.js` 的 `SETTINGS` 表里登记（存储键 / 解码 / 编码 / 线上名 / 回灌），启动态、回灌和镜像负载都从这张表派生，所以新增一项 = 表里加一行 + 界面 + Host 白名单（`STORE_KEYS` 与 `pickStore`）。`scripts/check-client.mjs` 会核对这两张表，漏写 host 侧会红。镜像有两步不可省：只在读到记录之后才写（`mirrorReady`），刚回灌的记录不回写。
- **host 安全不变量不可放宽**：只答 loopback；只保留 `STORE_KEYS` 内的键并校验结构（`pickStore`）；body ≤ 256KB；临时文件 + `rename` 原子写。
- **client 不解析回答**：回答只属于对话，插件不重复、不改写、不朗读。
- **校验优先行为**：加断言用 `check(label, actual, expected)`，走真实渲染树或真实 HTTP 往返，不 mock 内部函数。两张白名单（`SETTINGS` ↔ `STORE_KEYS`、ZH/EN 键集）另有一组显式的不变式断言，那是刻意的例外：它们测的正是"两边必须同名"这件事。
- **CHANGELOG.md 是生成物**：要改措辞就写 `scripts/release-notes/<tag>.md`，再 `npm run changelog:write`。
- **提交是 Conventional Commits**：`feat(client): ...`、`fix: ...` 等，否则整条落进日志的「其他」分类。一条提交一件事，拆分依据是用户能感知的变化，不是文件。
- **文案**：用户可见文案是中文，术语跟界面一致（悬浮窗、批注、快捷输入），不自创新词；`locale/en.json` 与 `locale/zh.json` 键集保持同步。
- **运行时零依赖，工具链只有两个 devDependency**：`package.json` 没有 dependencies，只有锁死版本的 `rollup`（构建）与 `typescript`（`--checkJs`）；脚本保持 node 原生。确需再加依赖时先说明为什么现有的不够。

## 反模式

| 反模式 | 正确做法 |
| --- | --- |
| 想装 jest / vitest 补测试 | 行为用 `scripts/check-client.mjs` 的 `check(...)`；纯函数用 `scripts/check-units.mjs` |
| 遇到类型错误就加 `@ts-ignore` | 先在 `src/types/client.d.ts` 里把形状写对，边界处才允许收窄 |
| 手改 `client.js` 或 `client.settings-jump.js` | 改 `src/client/`，再 `npm run build` |
| 提交了 src 却没提交重建的产物 | 跑 `npm run check`（先 verify 再校验） |
| 加设置项只改界面 | 先在 `src/client/settings.js` 的 `SETTINGS` 表加一行；Host 侧出现新形状再补 `pickStore`（`check-host` 核对 `STORE_KEYS`） |
| 手改 CHANGELOG.md | 改 release note，再 `changelog:write` |
| `git commit --no-verify` 跳过守卫 | 先修 `npm run check` |
| `git add -A` 一把梭 | 按"一件事"拆提交，见 `docs/RELEASE.md` |
| 加一个 `Config` schema 让宿主配置快捷输入 | 快捷输入属于窗口，宿主不持有（`check-host` 会拒） |

## 编辑本文件

加一条就删一条，同一事实只写一处。能从 `docs/RELEASE.md`、脚本头部注释或 `src/client/index.js` 头注释读到的，只放链接不复制。全局行为约定（自主推进、输出形态、符号先搜再改）在 `~/.dsh/AGENTS.md`，这里不重复。
