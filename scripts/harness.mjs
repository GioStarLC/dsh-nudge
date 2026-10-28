/**
 * Shared client-half harness: load the shipped `client.js` bundle in a VM with
 * a stubbed module loader (React + Client context) and return the debug runtime
 * the bundle exposes. Used by both the check script and the preview script so
 * both drive the *same* code path the rendered controls use.
 *
 * Not an entry point on its own — import it from scripts/check-client.mjs or
 * scripts/preview.mjs.
 */
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

export const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const tick = () => sleep(20)

/** Depth-first search for one rendered element by CSS class. */
export function findByClass(node, className) {
  if (!node || typeof node !== 'object') return null
  const classes = node.props && typeof node.props.className === 'string' ? node.props.className.split(/\s+/) : []
  if (classes.includes(className)) return node
  for (const child of node.children ?? []) {
    const hit = findByClass(child, className)
    if (hit) return hit
  }
  return null
}

/** Collect every rendered element carrying a CSS class. */
export function findAllByClass(node, className, out = []) {
  if (!node || typeof node !== 'object') return out
  const classes = node.props && typeof node.props.className === 'string' ? node.props.className.split(/\s+/) : []
  if (classes.includes(className)) out.push(node)
  for (const child of node.children ?? []) findAllByClass(child, className, out)
  return out
}

/** The first rendered element whose prop equals a value. */
export function findByProp(node, key, value) {
  if (!node || typeof node !== 'object') return null
  if (node.props && node.props[key] === value) return node
  for (const child of node.children ?? []) {
    const hit = findByProp(child, key, value)
    if (hit) return hit
  }
  return null
}

/** One observable store stub (getSnapshot/subscribe), like a Client store. */
export function observable(initial) {
  const listeners = new Set()
  return {
    value: initial,
    getSnapshot() {
      return this.value
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      this.value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** One synthetic pointer event for the component wiring checks. */
export function pointerAt(clientX, clientY, target) {
  return {
    button: 0,
    pointerId: 7,
    clientX,
    clientY,
    preventDefault() {},
    target: target ?? { closest: () => null },
    currentTarget: { setPointerCapture() {} },
  }
}

/** A minimal React stub: the factory only reads createElement and hooks. */
export const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

/** A localStorage stub. */
export function storageStub() {
  const data = new Map()
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}

/**
 * Boot one bundle instance.
 * @param options - `{ bindings, promptResult, language, innerWidth, innerHeight }`.
 * @returns the sandbox handles used by the checks and the preview renderer.
 */
export async function boot(options = {}) {
  const calls = { prompt: [] }
  const injects = []
  const registrations = []
  const effects = []
  const sessionsList = observable({ ids: [], byId: {} })
  const statusMap = observable(new Map())
  const remoteSession = {
    prompt(request, signal) {
      calls.prompt.push({ request, signal })
      return Promise.resolve(options.promptResult ?? { ok: true, value: { accepted: true } })
    },
  }
  const binds = options.bindings ?? {}
  const services = {
    sessions: {
      list: sessionsList,
      binding: (id) => (binds[id] ? { eventSource: binds[id] } : undefined),
    },
    uiSession: { sessionStatus: statusMap },
    'remote.session': remoteSession,
    remote: { session: remoteSession },
    locale: undefined,
    shortcuts: options.shortcuts,
  }
  const ctx = {
    get: (name) => services[name],
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    slots: {
      inject(name, callback) {
        injects.push(name)
        return callback()
      },
      register(entry, Component) {
        registrations.push({ entry, Component })
        return () => {
          const index = registrations.findIndex((item) => item.Component === Component)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
  }

  const localStorage = storageStub()
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Intl,
    JSON,
    Promise,
    AbortController,
    navigator: { language: options.language ?? 'zh-CN' },
    document: { querySelector: () => null },
    localStorage,
    innerWidth: options.innerWidth ?? 1440,
    innerHeight: options.innerHeight ?? 900,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  sandbox.window = sandbox
  sandbox.__ModuleLoader__ = {
    load(definition) {
      sandbox.__module = definition.factory((id) => {
        if (id === 'react') return ReactStub
        throw new Error(`unexpected require: ${id}`)
      })
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  sandbox.__module.apply(ctx)
  return { sandbox, runtime: sandbox.__dshNudge, calls, injects, registrations, effects, sessionsList, statusMap, localStorage }
}

// --- JSX-tree -> HTML serialization (for the preview renderer) -----------

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source'])
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch])

/** Flatten nested children arrays into a single list. */
function flattenChildren(children) {
  const out = []
  for (const child of children ?? []) {
    if (Array.isArray(child)) out.push(...flattenChildren(child))
    else out.push(child)
  }
  return out
}

/**
 * Serialize a React-stub element tree to an HTML string.
 * - string/number children become text (escaped)
 * - `style` objects become inline styles
 * - className passes through
 * - function/event props are dropped
 * Unknown element types render as <div>.
 */
export function renderToHtml(node) {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(renderToHtml).join('')
  if (typeof node !== 'object') return ''

  const { type, props, children } = node
  if (type === 'Fragment' || type == null) return flattenChildren(children).map(renderToHtml).join('')

  const tag = typeof type === 'string' ? type : 'div'
  const attrs = []
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue
    if (typeof value === 'function' || key === 'children' || key === 'key' || key === 'ref') continue
    if (key === 'style' && typeof value === 'object') {
      const css = Object.entries(value)
        .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
        .join(';')
      attrs.push(`style="${escapeHtml(css)}"`)
    } else if (key === 'className') {
      attrs.push(`class="${escapeHtml(value)}"`)
    } else if (key === 'dangerouslySetInnerHTML' && value?.__html) {
      // handled below
    } else if (typeof value !== 'object') {
      attrs.push(`${key}="${escapeHtml(value)}"`)
    }
  }
  const attrText = attrs.length ? ' ' + attrs.join(' ') : ''

  if (props?.dangerouslySetInnerHTML?.__html) {
    return `<${tag}${attrText}>${props.dangerouslySetInnerHTML.__html}</${tag}>`
  }
  if (VOID_TAGS.has(tag)) return `<${tag}${attrText}>`
  const inner = flattenChildren(children).map(renderToHtml).join('')
  return `<${tag}${attrText}>${inner}</${tag}>`
}
