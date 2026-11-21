/**
 * Release facts: the tag, `package.json` and `CHANGELOG.md` must name the same
 * version, and the tag must sit on exactly the commit being checked.
 *
 * This is not part of `npm run check`: while a release is being prepared the
 * version may legitimately be ahead of the newest tag, so the daily gate must
 * not fail on it. CI runs this only for `v*` tags, and it can be run by hand
 * right before pushing one.
 *
 * Run: node scripts/check-release.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

function git(...argv) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** The exact tag on HEAD, or '' when HEAD is not tagged. */
function exactTag() {
  try {
    return git('describe', '--tags', '--exact-match')
  } catch {
    return ''
  }
}

/** The first `## ...` heading of the changelog, without the markdown marks. */
function firstChangelogHeading(source) {
  for (const line of source.split('\n')) {
    if (line.startsWith('## ')) return line.slice(3).trim()
  }
  return ''
}

const tag = exactTag()
check('HEAD is exactly one tag', tag !== '', true)
if (tag === '') {
  console.error('先在这个提交上打标签（git tag -a vX.Y.Z），或把标签指到发布提交上。')
  process.exit(1)
}
check('tag names a semantic version', /^v\d+\.\d+\.\d+$/.test(tag), true)

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
check('package.json version matches the tag', pkg.version, tag.slice(1))

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const heading = firstChangelogHeading(changelog)
check('CHANGELOG starts with this version', heading.split(' — ')[0], tag)

if (failures > 0) {
  console.error(`release checks: ${failures} failed`)
  process.exit(1)
}
console.log(`release checks: all passed (${relative(ROOT, join(ROOT, 'CHANGELOG.md'))})`)
