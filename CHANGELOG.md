# 更新日志

<!-- 本文件由 scripts/changelog.mjs 从 git 历史生成，请勿手工编辑。 -->
<!-- 重新生成：npm run changelog:write -->

## 未发布

### 新增

- **client**: 移植输入框下方快捷输入、批注定为答案与设置页位置开关 (70d93ef)
  - 输入框左下角新增一行钉住的快捷输入（conversation.input.left）：
  - 快捷输入新增 pinned 字段；设置页每条给出「悬浮窗」「输入框」两个位置
  - 批注卡片改版：复制收进输入区、「定为答案」居首、投票改用「同意这段 /
  - 定为答案会把选区提升为整段并单独用紫色高亮；弹窗改为在松手点上方向上
  - 一并移植上游文案、样式、行为断言与「收尾推送」技能

### 重构

- **client**: 补齐类型、模块级校验与运行时/视图拆分 (107800d)
  - 类型：tsc --checkJs 覆盖 src 全量；src/types/client.d.ts 命名 ctx、各服务与运行时状态，src/types/react.d.ts 只声明插件用到的 React 面
  - 模块级校验：scripts/check-units.mjs 直接 import 纯函数模块，覆盖几何、预设、提示、计数与纯设置读取；check 按 产物核对 → 类型 → 模块 → 行为 四层执行
  - 运行时：投递与等待拆到 delivery.js（createDelivery），事件窗口关联、超时、回执与运行态兜底都在其中；runtime 只留两个薄别名
  - 视图：view-parts.js 收纳批注卡片、就地编辑、批注栏与快捷输入表单；stats-board.js 收纳设置页看板
  - 钩子：产物只在工作区重建而未暂存时直接拦下（verify 只看工作区，提交只看索引）
  - 产物由 rollup 重新生成；859 条 client、59 条模块级、56 条 host 断言与 tsc 全部通过
- **client**: 把浏览器半部拆成 src/client 模块 (76c365a)
  - 常量、两份词表、转录锚点、窗口几何、页面存储、设置表与 Host 镜像、快捷输入、状态文案、每日计数、批注存储、Client 上下文各成一个模块
  - createRuntime / makeView / makeSettingsView / makeComposerBridge 各自独立，入口只留 apply 与两个加载字段
  - storage 与 settings 之间改为写入观察者，避免循环依赖；readPresets 的旧格式回写随设置表留在 settings.js
  - 包内 chunk 的源码移到 src/client.settings-jump.js，产物的 loader 注册仍由构建脚本生成
  - 产物由 rollup 重新生成；client 校验、host 校验与场景预览均通过
- **client**: 移出快捷输入拖拽的测量与落点 (304d77e)
  - 布局测量、位移计算、落点光标、拖拽对象构造、回弹动画改为 factory 作用域的纯函数，显式接收行节点与拖拽对象
  - 组件里只留开始、跟随、结束、提交的编排，不再自己实现几何
  - NudgeWindow 1224 → 1076 行；拖动、键盘换位、FLIP 动画的断言全部通过
- **client**: 抽出统计看板与快捷输入行 (8a26e14)
  - 统计看板（趋势、今日、Top 3）从设置组件移出，只依赖计数与预设，NudgeSettings 739 → 333 行
  - 快捷输入行（chips 与「＋ 新增」「✎ 编辑」）移出 NudgeWindow，ChipRow 只收数据和回调
  - NudgeWindow 1312 → 1224 行，最深缩进 42 → 26；DOM 结构与类名不变
- **client**: 抽出批注卡片、批注栏与快捷输入表单 (68c0643)
  - 两张批注卡片共用外框与备注框，CaptureCard / EditCard 只写差异
  - 批注栏整块移出 NudgeWindow，固定高度与行结构保持不变
  - 「＋ 新增」与「✎ 编辑」共用一个表单，输入法、Enter、Esc 行为不变
  - NudgeWindow 1685 → 1312 行，最深缩进 42 → 30，DOM 结构与类名不变

### 文档

- 补类型、模块级校验与新模块的说明 (863535b)
  - 布局补 delivery / view-parts / stats-board / src/types
  - 命令补 check:types 与 check:units，说明 check 的四层顺序
  - 约定增加"边界有名字，内部靠推断"，并更正工具链依赖为 rollup + typescript
- 把源码与产物的约定写进仓库 (7495de5)
  - AGENTS.md 的布局、命令、约定与反模式改为 src/ 源码 + 提交产物的说法
  - README 补 npm install / npm run build，并说明 rollup 为何只改 import/export
  - 发版流程增加"改过 src 先构建"这一条
  - build.mjs 遇到循环依赖直接失败，模块边界不留环
- 修正发版流程与过期表述 (4b21c7d)
  - 发版步骤补上 package.json 版本号，标签改为在发布提交上本地创建、推送前可删
  - 幂等校验拆成打标签前后两步，并说明它只在发布提交即 HEAD 时成立
  - README 示例版本号改用 vX.Y.Z，避免撞已有标签；删掉无意义的 npm install
  - 修正齿轮二次点击、check 组成等与代码不符的说法

### 测试

- 用条件等待替掉固定的 sleep (dcd9477)
  - harness 新增 waitFor：真实定时器轮询结果，到达即返回，超时只让这一条断言失败
  - 选字、锚点恢复、启动回灌、设置镜像与宿主桥接改为等状态，不再猜一个毫秒数
  - 「不该发生」的断言保留真实等待并留出余量（260ms 防抖改成 400ms）
  - 保留 1500ms 重扫窗口本身；client 校验 13.4s → 10.8s
- **client**: 核对设置表与文案键集 (9408dad)
  - 设置表的每一行都要有 host 的 STORE_KEYS 对应项，反之亦然，漏写一侧会红
  - ZH/EN 键集必须一致；没有任何字面量引用的文案键直接判失败
  - 删掉 7 对已无人引用的文案键，_debug 暴露两张字典与设置名列表供校验

### 构建

- 用 rollup 从 src 生成浏览器产物 (ba95bf7)
  - src/client/index.js 成为手写来源，client.js 与 client.settings-jump.js 由 scripts/build.mjs 生成
  - rollup 只重写 import/export，其余字节原样保留，模板字符串里的 \n 不会被改成真实换行
  - npm run check 先跑 build --verify：改了 src 忘了构建会直接失败，CI 用同样一步防产物漂移
  - CI 增加 npm ci，构建依赖固定在 lockfile

### CI

- 推送与打标签时自动校验 (b78b9c6)
  - push / PR 跑 npm run check，不再依赖本机是否装过 pre-commit
  - 打 v* 标签时额外跑 check:release：tag、package.json、CHANGELOG 必须同名
  - 同一 job 里重新生成 CHANGELOG，确认标签上的文件与生成器一致

### 维护

- 忽略本地录屏素材 (f2e0b2b)

## v0.4.0 — 2026-11-21

### 新增

- 窗口按钮行末尾多了「✎ 编辑」：不进设置就能改快捷输入
- 点一下某条快捷输入，就地在窗口里改它的名称和内容，保存后这一排立刻用新的
- 编辑模式下按住条目拖动就能排序：拖动时条目跟着手走，落点用一条竖线标出，松手才换位
- 编辑模式下聚焦条目后按 ← → 也能换位，Enter 打开修改

## v0.3.0 — 2026-10-30

### 新增

- 窗口按钮行末尾多了「＋ 新增」：不进设置，填标题和正文就加好一条口径
- 每条口径能单独停用：停用的不占窗口那排按钮，但留在设置里，想用再打开
- 口径条数不再封顶，批量导入贴多少进多少

### 改动

- 设置页里的口径和状态行文案都收成一行一条，点标题才展开正文；改内容点行尾的铅笔图标
- 拖动排序跟着手走：拖过哪行中线，列表当场换位，松手就完成
- 批量导入框挪到列表上方，条数直接写在标题旁

## v0.2.1 — 2026-10-30

### 改动

- 设置齿轮的跳转逻辑改为点击时才加载；取不到时直接在悬浮窗里打开设置，不会再点了没反应

## v0.2.0 — 2026-10-30

### 新增

- 设置会记住了：重启 Harness 或换了端口，问法、开关、窗口位置都不再回到默认
- 悬浮窗标题栏下面那行小字可以自己写：逐句改、加、删、排序，最多 20 句；整段粘贴自动按行拆开
- 批注不再打断选字：松开鼠标才弹卡片，弹出后 Ctrl/⌘+C 直接复制原文
- 自动粘贴：打开后点进输入框，待发送的批注自动写进草稿
- 快捷问法支持 ↑/↓ 排序、删除、恢复默认
- 点设置齿轮不会再没反应：优先开 DSH 设置面板，打不开就在窗内显示同一份设置

### 改动

- 折叠栏去掉下拉箭头，点标题文字即可折叠；标题栏整条可点，栏内按钮不误触
- 添加批注后批注栏自动展开
- 窗口里每个开关，设置页都有对应项

## v0.1.0 — 2026-10-29

### 修复

- 去掉安装期 prepare 钩子，改用 hooks:install (741a002)

### 其他

- **README**: 精简重写，突出批注与快速回复 (960fcf9)
- 补齐预览回路与提交守卫：preview.mjs + 共享 harness + pre-commit (ab31a20)
- **client.js**: 按钮 tooltip、急速开关文案、已复制提示与收起提示调整 (f3a51ce)
- **Initial commit**: dsh-nudge DSH web plugin (b944291)
