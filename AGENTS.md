# AGENTS.md

dsh-nudge 是一个 DSH Web 插件：在悬浮窗里选一个问法，让 agent 汇报当前状态，回答直接落在对话里。改 `client.js` 前先读它头部的扩展点清单；发版流程见 [docs/RELEASE.md](docs/RELEASE.md)。

## 仓库布局

```
index.js                        宿主半部：设置持久化 + loopback 路由（inject: webServer）
client.js                       浏览器半部：悬浮窗、设置面板、输入区入口（手写单文件，即产物）
client.settings-jump.js         按需加载的 chunk：跳转到设置页
cordis.patch.yml                bundle patch：一行插件注册，零配置
locale/{en,zh}.json             插件元数据文案
scripts/check-client.mjs        浏览器半部校验（VM + stub loader/React）
scripts/check-host.mjs          宿主半部校验（临时 profile 目录）
scripts/check-graph.mjs         代码图校验：project root 必须解析成仓库根
scripts/harness.mjs             共享 VM harness（check 与 preview 共用）
scripts/preview.mjs             场景截图回路
scripts/changelog.mjs           CHANGELOG 生成器（按 git 历史）
scripts/release-notes/          每版手写说明 <tag>.md
docs/RELEASE.md                 发版流程
.githooks/pre-commit            提交守卫：npm run check
```

生成物不提交：`preview-out/`、`.agent/`、`graphify-out/`。

## 为什么有两个半部

Web GUI 每次启动换一个 loopback 端口，浏览器视角就是**新的 origin**，`localStorage` 随之清空。所以宿主半部持有 durable 副本，浏览器半部继续用 `localStorage` 当同步缓存，页面加载时按需回灌。改设置链路前先理解这一点，否则会把持久化逻辑又塞回前端。

## 命令

```sh
npm run check            # 唯一验证入口：client + host + graph 校验；零依赖、不编译
npm run check:client     # 只跑浏览器半部
npm run check:host       # 只跑宿主半部
npm run check:graph      # 只校验代码图的 project root（无图时跳过）
npm run preview          # 一个场景截图到 preview-out/<scene>.png
npm run preview:all      # 所有场景，亮色 + 暗色
npm run changelog        # 预览未发布窗口
npm run changelog:write  # 重新生成 CHANGELOG.md（生成物，不手改）
npm run hooks:install    # 启用 .githooks/pre-commit

# 重建代码图（仅在 graphify_status 报 STALE 时需要；纯本地、秒级、不花 token）
uv run --with "graphifyy[mcp]==0.9.57" graphify update .
```

`check` 是本项目的"单测"，不是构建：不编译、不下载、不装 `node_modules`。可以直接跑，不受全局「构建约束」限制。`test` 脚本不存在，也不要新增。

## 查代码：grep 定位符号，graphify 看结构

`client.js` 是一个 5,300 行的单文件，grep 能定位符号，但答不出"这块功能散在哪、改这里会波及谁"。这类问题用图（`graphify_*`），逐符号定位用 grep。

- **什么时候上图。** "某功能散在哪些函数/模块""谁调用 X、X 又调了谁""改这里波及谁""两条链路怎么串起来"→ `query_graph`（BFS 铺面、DFS 追线）、`god_nodes`、`get_neighbors`、`shortest_path`。只找定义、精确字符串、改文案、单点符号 → `grep`/读源码，一次就中，别绕路。
- **调用一律带 `project_path`**（仓库根绝对路径）。不传时用的是 MCP 启动时缓存的 project root，曾因 `.graphify_root` 被解析成 `graphify-out/` 而让所有查询报 `graphify-out/graphify-out/graph.json`；`npm run check:graph` 守的就是这个不变量。
- **`HEALTHY` 不等于查得动。** `graphify_status` 报绿只说明 graph.json 在、不新，它不做真实查询。查询报错先补 `project_path` 重试一次；仍失败再说明图不可用，别默默退回归 grep。
- **过期图不算证据。** `graphify_status` 报 `STALE` 就先重建（命令见上），`MISSING` 就先建图。拿着过期图写下"这个函数不存在"式的判断，比不查图更糟。工作区本来就脏时，"Working tree changed" 是常态；跑一次 `/graphify update` 让插件记下索引元数据后不再误报。
- **INFERRED 边是推测。** 图里约 13% 的边是推断出来的（例如 `createRuntime()` → `syncComposerFocus` 的 `indirect_call`，实际是 `addEventListener` 的参数）。把它当线索，不当结论；写进汇报前用 `get_neighbors` 加读源码确认。
- **导航靠 god nodes 与邻居，不靠社区。** 社区只有 `Community 0..15` 编号、没有语义名，`get_community` 的收益低。真正常用的入口是 `createRuntime()`、`factory()`、`setState()`、`makeView()`、`makeSettingsView()` 这些 hub 节点及其邻居。
- **图与源码冲突，以源码为准**，并在结论里注明引用了哪个节点，方便别人复核。

## 约定

- **手写单文件就是产物**：`client.js` 由 `window.__ModuleLoader__.load({ id, factory(require) })` 加载，peer 依赖只能 `require(...)`。不改成 ESM `import`、不拆模块、不加 bundler 或 TypeScript。`client.settings-jump.js` 同样受 chunk 契约约束：与 `client.js` 同目录、名字匹配 `client.<name>.js`、注册为 `<owner id>/client.<name>.js`、导出纯函数（无 React、无插件状态）。
- **设置有两份**：`localStorage` 的 `dsh-nudge:*` 是同步缓存；`index.js` 落在 profile 目录的 `nudge-store.json` 是跨重启、跨端口的真副本（`DSH_HOME` 可覆盖）。新增一个设置键必须同时改三处——client 的 key 常量、`index.js` 的 `STORE_KEYS`、host 的读取逻辑。
- **host 安全不变量不可放宽**：只答 loopback；只保留 `STORE_KEYS` 内的键并校验结构（`pickStore`）；body ≤ 256KB；临时文件 + `rename` 原子写。
- **client 不解析回答**：回答只属于对话，插件不重复、不改写、不朗读。
- **校验是行为校验**：加断言用 `check(label, actual, expected)`，走真实渲染树或真实 HTTP 往返，不 mock 内部函数、不测实现细节。
- **CHANGELOG.md 是生成物**：要改措辞就写 `scripts/release-notes/<tag>.md`，再 `npm run changelog:write`。
- **提交是 Conventional Commits**：`feat(client): ...`、`fix: ...` 等，否则整条落进日志的「其他」分类。一条提交一件事，拆分依据是用户能感知的变化，不是文件。
- **文案**：用户可见文案是中文，术语跟界面一致（悬浮窗、批注、快捷问法），不自创新词；`locale/en.json` 与 `locale/zh.json` 键集保持同步。
- **不引依赖**：`package.json` 没有 dependencies 与 devDependencies，脚本保持 node 原生。确需引入时先说明为什么现有的不够。

## 反模式

| 反模式 | 正确做法 |
| --- | --- |
| 想装 jest / vitest 补测试 | 在 `scripts/check-*.mjs` 加 `check(...)` |
| 把 `client.js` 改成 ESM 或拆多模块 | 保持单文件 + `__ModuleLoader__` factory |
| 加设置键只改 client | 三处一起改：key 常量 / `STORE_KEYS` / 读取逻辑 |
| 手改 CHANGELOG.md | 改 release note，再 `changelog:write` |
| `git commit --no-verify` 跳过守卫 | 先修 `npm run check` |
| `git add -A` 一把梭 | 按"一件事"拆提交，见 `docs/RELEASE.md` |
| 加一个 `Config` schema 让宿主配置预置问法 | 预置问法属于窗口，宿主不持有（`check-host` 会拒） |

## 编辑本文件

加一条就删一条，同一事实只写一处。能从 `docs/RELEASE.md`、脚本头部注释或 `client.js` 头注释读到的，只放链接不复制。全局行为约定（自主推进、输出形态、符号先搜再改）在 `~/.dsh/AGENTS.md`，这里不重复。
