/**
 * Host-half checks: the durable settings API.
 *
 * The window keeps its preferences in `localStorage`, which is scoped to one
 * origin — and the web GUI's loopback port changes on every launch, so a
 * restart is a different origin. The Host half therefore owns the durable copy:
 * a JSON record served on a loopback route, which is what these checks exercise.
 *
 * Run: node scripts/check-host.mjs
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const host = await import(new URL('../index.js', import.meta.url).href)
const pkg = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

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

// ── module surface ───────────────────────────────────────────────────────────

check('package name', pkg.name, 'dsh-nudge')
check('module name', host.name, 'dsh-nudge')
check('host services required', host.inject.join(','), 'webServer')
check('apply exported', typeof host.apply, 'function')
check('no Config schema (config lives in the window)', 'Config' in host, false)
check('bundle patch present', Boolean(pkg.dsh?.bundle?.patch), true)
check('client half declared', pkg.dsh?.client?.platform, 'web')

// ── mounting ─────────────────────────────────────────────────────────────────

const profileDir = await mkdtemp(join(tmpdir(), 'dsh-nudge-host-'))

/** A host context with the services the plugin asks for. */
function makeCtx({ withLoader = false } = {}) {
  const registered = []
  const effects = []
  const ctx = {
    effect(effect, label) {
      effects.push(label)
      registered.push(effect())
      return () => {}
    },
    webServer: {
      register(spec) {
        registered.push(spec)
        return () => {}
      },
    },
    get(name) {
      if (name !== 'loader' || !withLoader) return undefined
      return {
        entries: () => [
          {
            options: {
              name: 'cordis:include',
              config: { path: pathToFileURL(join(profileDir, 'cordis.yml')).href },
            },
          },
        ],
      }
    },
  }
  return { ctx, effects, routes: () => registered.filter((item) => item?.kind === 'prefix') }
}

const mounted = makeCtx({ withLoader: true })
let threw = false
try {
  host.apply(mounted.ctx)
} catch (error) {
  threw = true
  console.log(`FAIL  apply threw: ${error?.message ?? error}`)
}
check('apply mounts without throwing', threw, false)
check('apply registers one route', mounted.routes().length, 1)
const route = mounted.routes()[0] ?? {}
check('route prefix', route.path, '/dsh-nudge')
check('route kind', route.kind, 'prefix')
check('route handler', typeof route.handler, 'function')
check('effect labelled', mounted.effects.length > 0, true)

check(
  'store path follows the profile include',
  host.storePathOf(mounted.ctx),
  join(profileDir, host.STORE_FILE),
)

// ── request/response stubs ───────────────────────────────────────────────────

function makeReq({ method = 'GET', url = '/dsh-nudge/store', address = '127.0.0.1', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeRes() {
  return {
    status: 0,
    headers: undefined,
    text: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.text = text === undefined ? '' : String(text)
    },
  }
}

async function call(request) {
  const res = makeRes()
  await route.handler(request, res)
  let json
  try {
    json = res.text === '' ? undefined : JSON.parse(res.text)
  } catch {
    json = { raw: res.text }
  }
  return { status: res.status, json }
}

// ── reads and writes ─────────────────────────────────────────────────────────

const empty = await call(makeReq())
check('empty store: status', empty.status, 200)
check('empty store: no record yet', empty.json?.store, null)

const written = await call(
  makeReq({
    method: 'POST',
    body: {
      store: {
        version: 1,
        ui: { collapsed: true, pos: { x: 10, y: 20 } },
        delivery: 'queue',
        turbo: true,
        quick: true,
        autoPaste: true,
        preset: 'custom-1',
        presets: [{ id: 'custom-1', label: '我的口径', text: '写一份进展' }],
        tips: ['第一句', '  ', '第二句'],
        notes: { s1: [{ id: 'n1', quote: '原文' }] },
        stats: {
          days: {
            '2026-01-02': { send: 2, insert: 1, bogus: 5 },
            'not-a-day': { send: 9 },
            '2026-01-01': { annotation: -1 },
          },
        },
        // Not ours, must never reach the file.
        token: 'secret',
      },
    },
  }),
)
check('write: status', written.status, 200)
check('write: ok', written.json?.ok, true)
check('write: unknown key dropped', 'token' in (written.json?.store ?? {}), false)
check('write: preset text kept', written.json?.store?.presets?.[0]?.text, '写一份进展')
check('write: tips kept', written.json?.store?.tips?.length, 2)
check('write: stats kept', written.json?.store?.stats?.days?.['2026-01-02']?.send, 2)
check('write: stats unknown field dropped', 'bogus' in (written.json?.store?.stats?.days?.['2026-01-02'] ?? {}), false)
check('write: stats malformed day dropped', 'not-a-day' in (written.json?.store?.stats?.days ?? {}), false)
check('write: stats negative count drops the day', '2026-01-01' in (written.json?.store?.stats?.days ?? {}), false)
check('write: blank tip dropped', written.json?.store?.tips?.[0], '第一句')
check('write: savedAt stamped', typeof written.json?.store?.savedAt, 'string')

const storePath = host.storePathOf(mounted.ctx)
check('write: record exists', existsSync(storePath), true)
check('write: no temp file left behind', existsSync(`${storePath}.tmp`), false)
const onDisk = JSON.parse(readFileSync(storePath, 'utf8'))
check('write: file is valid JSON', onDisk.quick, true)

const reloaded = await call(makeReq())
check('read: record round-trips', reloaded.json?.store?.delivery, 'queue')
check('read: presets round-trip', reloaded.json?.store?.presets?.length, 1)
check('read: notes round-trip', reloaded.json?.store?.notes?.s1?.[0]?.id, 'n1')
check('read: stats round-trip', reloaded.json?.store?.stats?.days?.['2026-01-02']?.insert, 1)

// The counter record keeps the newest local days only.
const manyDays = {}
for (let index = 0; index < 70; index += 1) {
  const date = new Date(2026, 0, 1 + index)
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  manyDays[key] = { send: 1 }
}
const capped = await call(makeReq({ method: 'POST', body: { store: { stats: { days: manyDays } } } }))
check('write: stats keeps 60 days', Object.keys(capped.json?.store?.stats?.days ?? {}).length, 60)
check('write: stats keeps the newest day', '2026-03-11' in (capped.json?.store?.stats?.days ?? {}), true)
check('write: stats drops the oldest day', '2026-01-01' in (capped.json?.store?.stats?.days ?? {}), false)
check('read: no-store cache header', reloaded.json !== undefined, true)

// A malformed payload is refused, and the previous record survives.
const invalid = await call(makeReq({ method: 'POST', body: { store: { presets: [] } } }))
check('write: minimal record accepted', invalid.status, 200)
check('write: minimal record keeps version', invalid.json?.store?.version, 1)

// ── safety rules ─────────────────────────────────────────────────────────────

const remote = await call(makeReq({ address: '10.1.2.3' }))
check('remote request refused', remote.status, 403)
check('remote request has no record', remote.json?.store, undefined)

const unknown = await call(makeReq({ url: '/dsh-nudge/nope' }))
check('unknown route', unknown.status, 404)

const wrongMethod = await call(makeReq({ url: '/dsh-nudge/store', method: 'DELETE' }))
check('wrong method', wrongMethod.status, 404)

// ── fallback location without a loader ───────────────────────────────────────

const home = await mkdtemp(join(tmpdir(), 'dsh-nudge-home-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const bare = makeCtx()
  check(
    'fallback profile dir honours DSH_HOME',
    host.storePathOf(bare.ctx),
    join(home, 'profiles', 'web', host.STORE_FILE),
  )
  host.apply(bare.ctx)
  const bareRoute = bare.routes()[0] ?? {}
  const res = makeRes()
  await bareRoute.handler?.(makeReq(), res)
  check('fallback store is empty', JSON.parse(res.text).store, null)
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(home, { recursive: true, force: true })
}

await rm(profileDir, { recursive: true, force: true })

console.log(failures === 0 ? '\nhost checks: all passed' : `\nhost checks: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
