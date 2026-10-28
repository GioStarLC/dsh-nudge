/**
 * Host-half checks: the row must mount without configuration and must not
 * carry the probe presets or the delivery default (those live in the browser
 * half, where the window can change them).
 *
 * Run: node scripts/check-host.mjs
 */
const host = await import(new URL('../index.js', import.meta.url).href)
const pkg = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json', import.meta.url), 'utf8'))

let failures = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

check('package name', pkg.name, 'dsh-nudge')
check('module name', host.name, 'dsh-nudge')
check('no host services required', Array.isArray(host.inject) && host.inject.length, 0)
check('apply exported', typeof host.apply, 'function')

// A Host-only bundle with no imports: mounting must be a no-op for any config.
let threw = false
try {
  host.apply({ on() { throw new Error('host half must not register listeners') } }, { delivery: 'steer' })
  host.apply(undefined, undefined)
} catch (error) {
  threw = true
  console.log(`FAIL  apply threw: ${error?.message ?? error}`)
}
check('apply mounts without touching the context', threw, false)
check('no Config schema (config lives in the window)', 'Config' in host, false)
check('bundle patch present', Boolean(pkg.dsh?.bundle?.patch), true)
check('client half declared', pkg.dsh?.client?.platform, 'web')

console.log(failures === 0 ? '\nhost checks: all passed' : `\nhost checks: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
