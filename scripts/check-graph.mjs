/**
 * Graph checks: the knowledge graph the agent is told to query must resolve to
 * the repo root, not to `graphify-out/`.
 *
 * `graphify-out/` is generated and gitignored, so a checkout with no graph
 * skips these checks instead of failing.
 *
 * Why this exists: dsh-graphify reads `graphify-out/.graphify_root` and, for a
 * relative value, resolves it against `graphify-out/` itself
 * (`detector.js` readValidGraphifyRoot, which runs ahead of the canonical
 * `dirname(graphDir)` rule). A marker holding `.` therefore makes the project
 * root `graphify-out/`, and every query tool then looks for
 * `graphify-out/graphify-out/graph.json` and errors out — while
 * `graphify_status` still reports HEALTHY, because it stats the graph.json path
 * that was already resolved. Graphify itself writes an absolute scan root, so
 * the marker must be absolute (or absent, so the canonical rule applies).
 *
 * Run: node scripts/check-graph.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphDir = join(repoRoot, 'graphify-out')
const graphJson = join(graphDir, 'graph.json')
const marker = join(graphDir, '.graphify_root')

let failures = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`,
  )
}

if (!existsSync(graphJson)) {
  console.log('ok    no graphify-out/graph.json — graph checks skipped')
  process.exit(0)
}

let nodes = 0
try {
  const graph = JSON.parse(readFileSync(graphJson, 'utf8'))
  nodes = (graph.nodes ?? []).length
} catch (error) {
  console.log(`FAIL  graph.json parses: ${error.message}`)
  failures += 1
}
check('graph.json has nodes', nodes > 0, true)

// No marker → dsh-graphify falls back to the canonical layout rule, which is
// the repo root by construction. A present marker must agree with that.
if (existsSync(marker)) {
  const raw = readFileSync(marker, 'utf8').replace(/^\uFEFF/, '').trim()
  check('graphify_root is non-empty', raw.length > 0, true)
  // As the plugin reads it: relative values are joined onto `graphify-out/`.
  check('project root the plugin resolves', resolve(graphDir, raw), repoRoot)
  // As graphify writes it: absolute scan root, or relative to the invocation cwd.
  check('scan root graphify records', resolve(repoRoot, raw), repoRoot)
} else {
  check('no graphify_root marker — canonical layout resolves the root', dirname(graphDir), repoRoot)
}

console.log(failures === 0 ? '\ngraph checks: all passed' : `\ngraph checks: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
