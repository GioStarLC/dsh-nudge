/**
 * Changelog generator: rebuilds CHANGELOG.md as a pure function of git history.
 *
 * Every run regenerates the *whole* file from two inputs — the tag list and the
 * commits between tags — so the changelog never drifts from the history it
 * describes and never needs hand-editing. `/changelog:write` is idempotent: run
 * it twice with the same history and you get the same bytes.
 *
 *   node scripts/changelog.mjs                  # preview the current (unreleased) window
 *   node scripts/changelog.mjs --all            # preview the full file
 *   node scripts/changelog.mjs --write          # regenerate CHANGELOG.md
 *   node scripts/changelog.mjs --write --version v0.2.0   # name the top block instead of 未发布
 *   node scripts/changelog.mjs --range A..B     # any window, e.g. origin/main..HEAD
 *   node scripts/changelog.mjs --since-push     # commits not yet pushed (upstream..HEAD)
 *
 * Commit subjects are read as Conventional Commits (`feat(scope): subject`).
 * Anything else still lands in the file under 其他 — history written before the
 * convention was adopted is never silently dropped. Body lines that start with
 * `- ` become sub-bullets, so one commit can describe a bundled change in more
 * than its subject line.
 *
 * A version with a hand-written `scripts/release-notes/<tag>.md` uses that file
 * as its body instead of the commit list: commit messages answer "why this
 * code", a release note answers "what changed for me". Both are kept, neither
 * has to be bent to serve the other's reader.
 *
 * Working-tree changes are *not* commits and cannot appear here; a dirty tree is
 * reported as a warning so the gap is visible instead of surprising.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = join(ROOT, 'CHANGELOG.md')
const GIT = ['-c', 'core.quotepath=false']

/** Hand-written prose for released versions, one `<tag>.md` per version. */
const NOTES = join(HERE, 'release-notes')

/** Section order and headings; `type` keys are Conventional Commit types. */
const SECTIONS = [
  ['feat', '新增'],
  ['fix', '修复'],
  ['perf', '性能'],
  ['refactor', '重构'],
  ['docs', '文档'],
  ['style', '样式'],
  ['test', '测试'],
  ['build', '构建'],
  ['ci', 'CI'],
  ['revert', '回滚'],
  ['chore', '维护'],
  ['other', '其他'],
]
const typeOf = (key) => SECTIONS.find(([type]) => type === key)?.[1] ?? '其他'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1] ?? null
}

const git = (...argv) =>
  execFileSync('git', [...GIT, ...argv], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const tryGit = (...argv) => {
  try {
    return git(...argv)
  } catch {
    return ''
  }
}

/**
 * The bullet lines of a commit body. Only `- ` lines count, so a commit message
 * can explain itself in prose without any of it leaking into the changelog.
 */
function detailOf(body) {
  return (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
}

/** Commits in `range` (or all commits reachable from `rev`), oldest first. */
function commits(range) {
  const raw = git(
    'log',
    '--no-merges',
    '--date=short',
    '--format=%h%x1f%ad%x1f%s%x1f%b%x1e',
    ...(range ? [range] : ['HEAD']),
  )
  if (!raw) return []
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, date, subject, body] = record.split('\x1f')
      return { hash, date, subject, details: detailOf(body) }
    })
    .filter((commit) => commit.subject && !/^[a-z]+\(release\)/i.test(commit.subject))
}

/**
 * `feat(client): 按钮 tooltip` -> { type: 'feat', scope: 'client', text: '按钮 tooltip' }
 * `client.js: 按钮 tooltip`     -> { type: 'other', scope: 'client.js', text: '按钮 tooltip' }
 * `some bare subject`            -> { type: 'other', scope: '', text: 'some bare subject' }
 */
function parse(subject) {
  const conventional = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?!?:\s*(?<text>.+)$/.exec(subject)
  if (conventional && SECTIONS.some(([type]) => type === conventional.groups.type.toLowerCase())) {
    return { conventional: true, type: conventional.groups.type.toLowerCase(), scope: conventional.groups.scope ?? '', text: conventional.groups.text }
  }
  const prefixed = /^(?<scope>[^:]{1,40}):\s*(?<text>.+)$/.exec(subject)
  if (prefixed) return { conventional: false, type: 'other', scope: prefixed.groups.scope, text: prefixed.groups.text }
  return { conventional: false, type: 'other', scope: '', text: subject }
}

/**
 * Hand-written prose for one released version, when the file exists. The commit
 * list is a fallback for a version nobody explained, not a substitute for a
 * sentence someone wrote on purpose.
 */
function notesOf(version) {
  if (!version) return ''
  const path = join(NOTES, `${version}.md`)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

/** Render one release block (a heading plus its populated sections). */
function renderBlock({ version, fallbackDate = '', commits: entries }) {
  // A release block is dated by its newest real commit, not by the tag object, so
  // `--version vX` before tagging and the tag block afterwards render identically.
  const stamp = entries.at(-1)?.date || fallbackDate || ''
  const heading = version ? `## ${version}${stamp ? ` — ${stamp}` : ''}` : '## 未发布'
  const written = notesOf(version)
  if (written) return `${heading}\n\n${written}\n`
  if (!entries.length) return `${heading}\n\n_无提交。_\n`

  const groups = new Map()
  for (const entry of entries) {
    const parsed = parse(entry.subject)
    const key = typeOf(parsed.type)
    if (!groups.has(key)) groups.set(key, [])
    const label = parsed.scope ? `**${parsed.scope}**: ${parsed.text}` : parsed.text
    groups.get(key).push(`- ${label} (${entry.hash})`)
    // Only commits written to the convention get their body expanded: an older
    // free-form body is a note to other developers, not release prose.
    if (parsed.conventional) for (const detail of entry.details ?? []) groups.get(key).push(`  - ${detail}`)
  }

  const body = SECTIONS.map(([, key]) => key)
    .filter((key) => groups.has(key))
    .map((key) => `### ${key}\n\n${groups.get(key).join('\n')}\n`)
    .join('\n')
  return `${heading}\n\n${body}`
}

/** Tags oldest -> newest, with their commit dates. */
function tags() {
  const raw = tryGit('for-each-ref', '--sort=creatordate', '--format=%(refname:short)%09%(creatordate:short)', 'refs/tags')
  if (!raw) return []
  return raw.split('\n').map((line) => {
    const [name, date] = line.split('\t')
    return { name, date }
  })
}

/** The full document: unreleased window on top, then one block per tag. */
function renderAll() {
  const list = tags()
  const head = commits(list.length ? `${list.at(-1).name}..HEAD` : 'HEAD')
  // An empty 未发布 block is dropped rather than printed as "无提交": after tagging,
  // the same history must still render the same bytes as the pre-tag --version run.
  const blocks = head.length ? [renderBlock({ version: valueOf('--version') ?? '', commits: head })] : []

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const tag = list[i]
    const previous = list[i - 1]
    blocks.push(renderBlock({ version: tag.name, fallbackDate: tag.date, commits: commits(previous ? `${previous.name}..${tag.name}` : tag.name) }))
  }

  return [
    '# 更新日志',
    '',
    '<!-- 本文件由 scripts/changelog.mjs 从 git 历史生成，请勿手工编辑。 -->',
    '<!-- 重新生成：npm run changelog:write -->',
    '',
    ...blocks.flatMap((block) => [block, '']),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** Dirty-tree warning: uncommitted work is invisible to every range below. */
function dirtyNotice() {
  const dirty = tryGit('status', '--porcelain')
  if (!dirty) return ''
  const files = dirty.split('\n').filter(Boolean)
  const lines = [
    `注意：工作区有 ${files.length} 个文件未提交，这些改动不在任何提交里，因此不会出现在下列内容中。`,
    ...files.slice(0, 5).map((line) => `  ${line}`),
  ]
  if (files.length > 5) lines.push(`  …还有 ${files.length - 5} 个`)
  lines.push('先提交（可分多次），再重新生成，改动才会进入更新日志。')
  return lines.join('\n')
}

const unreleased = () => {
  const list = tags()
  return renderBlock({ version: '', date: '', commits: commits(list.length ? `${list.at(-1).name}..HEAD` : 'HEAD') })
}

const named = valueOf('--version')
if (named && tags().some((tag) => tag.name === named)) {
  console.error(`标签 ${named} 已存在；已发布的内容由标签自动生成，不要用 --version 重命名。`)
  process.exit(1)
}

let body
if (has('--write')) {
  await writeFile(OUT, renderAll(), 'utf8')
  body = `已写入 ${relative(ROOT, OUT)}`
} else if (has('--since-push') || has('--range')) {
  const upstream = tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  const range = has('--since-push') ? (upstream ? '@{u}..HEAD' : '') : valueOf('--range')
  if (!range) {
    console.error('当前分支没有上游（尚未推送过），无法计算 --since-push；请改用 --range <from>..<to>。')
    process.exit(1)
  }
  const entries = commits(range)
  body = entries.length ? renderBlock({ version: '', date: '', commits: entries }) : `范围 ${range} 内没有提交。`
} else if (has('--all')) {
  body = renderAll()
} else {
  body = unreleased()
}

const notice = dirtyNotice()
if (notice) console.log(`${notice}\n`)
console.log(body)

// Version + tag state, so the next release number is decided from facts.
if (!has('--write')) {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const latest = tags().at(-1)
  console.error(`package.json: ${pkg.version}   最近标签: ${latest?.name ?? '(无)'}`)
}
