---
name: closeout-push
description: "「收尾推送」：把 dsh-nudge 工作区里当前这批改动总结进 CHANGELOG 并推送到 origin main，不建 tag、不动版本号。仅用于 dsh-nudge 仓库；其他项目规则不同，不要照搬。"
whenToUse: "用户说「收尾推送」，或「总结未推送的内容并写到 changelog」「推送到 git，不需要打 tag」时使用。"
---

# 收尾推送（dsh-nudge）

把工作区里当前这批改动收尾：一条提交、重新生成 CHANGELOG、校验、推 `origin main`。不建 tag，不动版本号。

## 前置

- 分支必须是 `main`，且上游是 `origin/main`；否则停止并报告。
- 只处理**工作区未提交的改动**；已提交未推送的 commit 只报告，不重写。

## 步骤

1. **盘点**，三者分开报告，不合并成一句“未推送”：
   - `git status --short`：工作区未提交（含未跟踪）
   - `git log --oneline origin/main..HEAD`：已提交未推送
   - 最近 tag 与 `package.json` 的 version
2. **摘要 + 确认门**：把工作区改动按**功能**归并成人话（不按文件），列出本次提交会包含的内容；疑似非本次任务产生或来源不明的改动单独列出。**未经用户确认，不提交、不写文件。**
3. **提交**：确认后一次提交，不按功能拆。标题用 Conventional Commits（`feat(scope): ...`），正文用 `- ` 行写功能级说明——这些行会进 CHANGELOG。
   - 不提交生成物：`.agent/`、`preview-out/`、`graphify-out/`。
4. **生成 CHANGELOG**：`npm run changelog:write`。
   - 若上一版没有 tag，生成器会把那个版本段并进「未发布」。这是既定前提：照常保留，**不补 tag**，但在报告里点名说明。
5. **校验**：再跑一次 `changelog:write`，确认 CHANGELOG 没有新 diff（幂等）；`npm run check` 必须通过（提交钩子也会跑）。
6. **提交生成物**：`chore(release): 未发布`。这个前缀会被生成器排除，保证下次生成字节不变。
7. **推送**：`git push origin main`，不带 `--follow-tags`，不建 tag。
8. **收尾报告**：提交 hash、CHANGELOG 版本块状态、检查结果、推送后 `main...origin/main` 的同步状态。

## 停止条件

命中任一就停，报告原因，不 force、不绕过钩子：

- 确认门未过；
- 分支不是 `main` 或没有上游；
- 提交钩子或 `npm run check` 失败；
- 推送被拒；
- 工作区有来源不明的改动且用户未确认。

## 边界

- 工作区没有改动：只报告，不生成、不提交、不推送。
- 版本号不动；不写 `scripts/release-notes/`；不创建 tag。
- 提交约定与生成规则见 [docs/RELEASE.md](docs/RELEASE.md)，不在这里重复。
