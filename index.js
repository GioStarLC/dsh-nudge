/**
 * dsh-nudge — Host half.
 *
 * The floating window is browser-side, but the settings it collects (prompt
 * presets, the three switches, the delivery mode, the window geometry and the
 * per-Session annotations) have to survive an app restart. The browser keeps
 * them in `localStorage`, which is scoped to one origin — and the Harness web
 * GUI picks a fresh loopback port on every launch, so a restart is a different
 * origin and everything the user configured is gone. That is the bug this half
 * fixes.
 *
 * This module therefore owns the durable copy: one JSON file inside the
 * profile directory, served over a loopback HTTP route that the browser half
 * calls with `fetch` (same origin, no credentials). The browser keeps using
 * `localStorage` as the instant, synchronous cache, so nothing about the
 * window's behaviour changes; the file is only read back when the page loads
 * on an origin that has no record of its own.
 *
 * Safety rules:
 * - Only loopback requests are answered.
 * - A write keeps only the keys this plugin owns, and each one must have the
 *   expected shape, so a bad payload can never grow or corrupt the file.
 * - Writes are atomic (temporary file + rename), so a crash mid-write cannot
 *   leave a half-written record for the next boot to read.
 *
 * @module dsh-nudge
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

/** Loader-facing plugin name. Must equal the package name. */
export const name = 'dsh-nudge'

/** The durable settings API rides on the harness web server. */
export const inject = ['webServer']

/** Route prefix for this plugin's settings API. */
const API_PREFIX = '/dsh-nudge'

/** File name of the durable settings record inside the profile directory. */
export const STORE_FILE = 'nudge-store.json'

/** Shape version of the record; a future build may need to migrate it. */
const STORE_VERSION = 1

/** Upper bound on a settings payload, in bytes. */
const BODY_LIMIT_BYTES = 256 * 1024

/** Every key the browser half may persist; anything else is dropped. */
const STORE_KEYS = ['ui', 'delivery', 'turbo', 'quick', 'autoPaste', 'preset', 'presets', 'tips', 'notes']

/** Cap on the idle lines a record may carry, in entries. */
const MAX_STORE_TIPS = 50

/** The harness home, honouring a `DSH_HOME` override. */
function dshHome() {
  const override = process.env.DSH_HOME
  return override !== undefined && override.trim() !== '' ? override : join(homedir(), '.dsh')
}

/** The `--profile` argument the process was started with, when present. */
function argvProfile() {
  const argv = process.argv
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--profile') {
      const next = argv[index + 1]
      if (typeof next === 'string' && next.trim() !== '' && !next.startsWith('-')) return next.trim()
      return undefined
    }
    if (typeof value === 'string' && value.startsWith('--profile=')) {
      const next = value.slice('--profile='.length).trim()
      return next === '' ? undefined : next
    }
  }
  return undefined
}

/** Resolve a `file://` URL to a native path; a plain path is returned untouched. */
function fromFileUrl(value) {
  if (!value.startsWith('file://')) return value
  try {
    return fileURLToPath(value)
  } catch {
    return value
  }
}

/**
 * The directory holding this profile's durable files.
 *
 * The loader's `cordis:include` entry names the profile's `cordis.yml`, which is
 * the one path that is always correct — even when the process was started from
 * a different working directory or without `--profile`. Installed plugins
 * resolve their profile directory the same way.
 */
function profileDirOf(ctx) {
  try {
    const loader = ctx?.get?.('loader')
    if (loader !== undefined && typeof loader.entries === 'function') {
      for (const entry of loader.entries()) {
        const options = entry?.options ?? {}
        if (options.name !== 'cordis:include') continue
        const config = options.config
        if (config === null || typeof config !== 'object') continue
        const path = config.path
        if (typeof path !== 'string' || !path.includes('cordis.yml')) continue
        return dirname(fromFileUrl(path))
      }
    }
  } catch {
    /* loader absent: fall back to the default location */
  }
  return join(dshHome(), 'profiles', argvProfile() ?? 'web')
}

/** Absolute path of the durable settings record. */
export function storePathOf(ctx) {
  return join(profileDirOf(ctx), STORE_FILE)
}

/** One plain object, or undefined for anything else. */
function plainObjectOr(value, fallback) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

/**
 * Keep only the keys this plugin owns and only the values it understands.
 * An unknown or malformed value is dropped rather than written through, so the
 * file always reads back as a valid record.
 */
function pickStore(value) {
  const source = plainObjectOr(value, undefined)
  if (source === undefined) return undefined
  const store = { version: STORE_VERSION }
  const ui = plainObjectOr(source.ui, undefined)
  if (ui !== undefined) store.ui = ui
  if (source.delivery === 'steer' || source.delivery === 'queue') store.delivery = source.delivery
  for (const key of ['turbo', 'quick', 'autoPaste']) {
    if (source[key] === true) store[key] = true
  }
  if (typeof source.preset === 'string' && source.preset !== '') store.preset = source.preset
  if (Array.isArray(source.presets)) store.presets = source.presets
  if (Array.isArray(source.tips)) {
    const tips = source.tips
      .filter((line) => typeof line === 'string' && line.trim() !== '')
      .map((line) => line.trim())
      .slice(0, MAX_STORE_TIPS)
    if (tips.length > 0) store.tips = tips
  }
  const notes = plainObjectOr(source.notes, undefined)
  if (notes !== undefined) store.notes = notes
  return store
}

/** The persisted record, or undefined when there is none (yet). */
export function readStore(ctx) {
  const path = storePathOf(ctx)
  if (!existsSync(path)) return { store: undefined, path }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const store = pickStore(parsed)
    return { store, path }
  } catch (error) {
    return { store: undefined, path, error: String(error?.message ?? error) }
  }
}

/** Write the record atomically; returns the saved value. */
export function writeStore(ctx, value) {
  const store = pickStore(value)
  if (store === undefined) throw new Error('store must be a JSON object')
  store.savedAt = new Date().toISOString()
  const path = storePathOf(ctx)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
  return store
}

/** Whether a request originated on the loopback interface. */
function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? ''
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  )
}

/** Write one JSON response. */
function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/** Read a JSON request body, refusing anything over the limit. */
async function readJsonBody(req, limitBytes = BODY_LIMIT_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limitBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`request body is not valid JSON: ${String(error?.message ?? error)}`)
  }
}

/** The route path below the API prefix, without the query string. */
function routeOf(url) {
  const path = typeof url === 'string' ? url.split('?')[0] : ''
  const rest = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path
  return rest === '' ? '/' : rest.replace(/\/+$/u, '') || '/'
}

/**
 * Register the durable-settings API on the harness web server.
 * @param ctx - host context carrying `webServer`.
 */
export function apply(ctx) {
  const handler = async (req, res) => {
    if (!isLoopback(req)) {
      sendJson(res, 403, { error: 'loopback requests only' })
      return
    }
    const route = routeOf(req?.url)
    try {
      if (route === '/store' && (req.method === 'GET' || req.method === 'HEAD')) {
        const { store, path } = readStore(ctx)
        sendJson(res, 200, { ok: true, store: store ?? null, path })
        return
      }
      if (route === '/store' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const store = writeStore(ctx, body?.store ?? body)
        sendJson(res, 200, { ok: true, store, path: storePathOf(ctx) })
        return
      }
      sendJson(res, 404, { error: `unknown route ${route}` })
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
    }
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler,
      }),
    'dsh-nudge: durable settings API',
  )
}

export default { name, inject, apply }
