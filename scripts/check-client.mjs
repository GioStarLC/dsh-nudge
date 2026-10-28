/**
 * Client-half checks: the shipped bundle's delivery path and window state,
 * driven through the debug runtime the bundle exposes for exactly this purpose.
 *
 * The bundle is loaded in a VM with a stubbed module loader, React and Client
 * context, then the same `ask()` / `setDelivery()` / `moveTo()` calls the
 * rendered controls use are exercised.
 *
 * Run: node scripts/check-client.mjs
 */
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

let failures = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}
function includes(label, haystack, needle) {
  const ok = typeof haystack === 'string' && haystack.includes(needle)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(haystack)}${ok ? '' : ` (expected to include ${JSON.stringify(needle)})`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tick = () => sleep(20)

/** Depth-first search for one rendered element by CSS class. */
function findByClass(node, className) {
  if (!node || typeof node !== 'object') return null
  const classes = node.props && typeof node.props.className === 'string' ? node.props.className.split(/\s+/) : []
  if (classes.includes(className)) return node
  for (const child of node.children ?? []) {
    const hit = findByClass(child, className)
    if (hit) return hit
  }
  return null
}

/** Depth-first collection of every rendered element with one CSS class. */
function findAllByClass(node, className, out = []) {
  if (!node || typeof node !== 'object') return out
  const classes = node.props && typeof node.props.className === 'string' ? node.props.className.split(/\s+/) : []
  if (classes.includes(className)) out.push(node)
  for (const child of node.children ?? []) findAllByClass(child, className, out)
  return out
}

/** Depth-first search for one rendered element by prop value. */
function findByProp(node, key, value) {
  if (!node || typeof node !== 'object') return null
  if (node.props && node.props[key] === value) return node
  for (const child of node.children ?? []) {
    const hit = findByProp(child, key, value)
    if (hit) return hit
  }
  return null
}

/** One synthetic pointer event for the component wiring checks. */
function pointerAt(clientX, clientY, target) {
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

/** One observable store stub (getSnapshot/subscribe), like a Client store. */
function observable(initial) {
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

/** A minimal React stub: the factory only reads createElement and hooks. */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

/** A localStorage stub. */
function storageStub() {
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
 * @returns the sandbox handles used by the checks.
 */
async function boot(options = {}) {
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

// --- activation ---------------------------------------------------------

{
  const booted = await boot({})
  check('overlay slot injected', booted.injects.includes('shell.overlay'), true)
  check('settings slot injected', booted.injects.includes('settings.section'), true)
  check('composer slot injected', booted.injects.includes('conversation.input.overlay'), true)
  check('three slot entries', booted.registrations.length, 3)
  const overlay = booted.registrations.find((item) => item.entry.name === 'shell.overlay')
  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section')
  const bridge = booted.registrations.find((item) => item.entry.name === 'conversation.input.overlay')
  check('overlay entry id', overlay?.entry.id, 'dsh-nudge')
  check('settings entry id', settings?.entry.id, 'dsh-nudge')
  check('composer bridge entry id', bridge?.entry.id, 'dsh-nudge')
  check('composer bridge renders no DOM', bridge?.Component?.({}), null)
  check('settings label is lazy and localized', typeof settings?.entry.label, 'function')
  includes('settings label text', settings?.entry.label?.(), '状态')
  check('debug runtime exposed', typeof booted.runtime?.ask, 'function')
  check('default delivery is steer', booted.runtime.effectiveDelivery(), 'steer')
  check('initial phase', booted.runtime.getSnapshot().phase, 'idle')
  check('no session yet', booted.runtime.getSnapshot().target, undefined)
  check('built-in presets loaded', booted.runtime.getSnapshot().presets.length, 3)
}

// --- 1.3 no open conversation ------------------------------------------

{
  const booted = await boot({})
  booted.runtime.ask()
  const state = booted.runtime.getSnapshot()
  check('no session: error phase', state.phase, 'error')
  includes('no session: message', state.error, '没有打开的会话')
  check('no session: nothing delivered', booted.calls.prompt.length, 0)
}

// --- 1.1 / 2.3 delivery -------------------------------------------------

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '测试会话', retainedBy: { mainView: 1 } } } })
  await tick()
  const started = booted.runtime.ask()
  await tick()
  check('ask accepted', started, true)
  check('prompt sent once', booted.calls.prompt.length, 1)
  const request = booted.calls.prompt[0].request
  check('default maps to steer ("直接打断")', request.mode, 'steer')
  check('target session', request.sessionId, 'A')
  includes('answer goes to the selected preset text', request.content[0].text, '简述一下')
  check('request identity minted', /^nudge-/.test(request.requestId), true)
  check('waiting phase', booted.runtime.getSnapshot().phase, 'waiting')

  // 1.4 / 7.3.2 throttle: a second click while waiting delivers nothing.
  booted.runtime.ask()
  check('second click blocked while waiting', booted.calls.prompt.length, 1)

  // The turn runs and closes; the window reports 已返回 after the settle delay.
  booted.statusMap.set(new Map([['A', { running: true }]]))
  booted.statusMap.set(new Map([['A', { running: false }]]))
  await sleep(1400)
  check('running then idle: answered', booted.runtime.getSnapshot().phase, 'done')
  check('answered: timestamp recorded', typeof booted.runtime.getSnapshot().lastAt, 'number')
}

// --- 2.2 explicit queue mode --------------------------------------------

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  check('delivery switch accepted', booted.runtime.setDelivery('followup'), true)
  check('effective delivery', booted.runtime.effectiveDelivery(), 'followup')
  booted.runtime.ask()
  await tick()
  check('queue maps to queue', booted.calls.prompt[0].request.mode, 'queue')
  check('override persisted', booted.localStorage.getItem('dsh-nudge:delivery'), 'followup')
}

// --- 6.3 agent waiting for the user ------------------------------------

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  booted.statusMap.set(new Map([['A', { running: true, pendingInteraction: { kind: 'question' } }]]))
  await tick()
  booted.runtime.ask()
  const state = booted.runtime.getSnapshot()
  check('pending question: refused', state.phase, 'error')
  includes('pending question: reason', state.error, 'agent 正在等待你的回答')
  check('pending question: nothing delivered', booted.calls.prompt.length, 0)
}

// --- 6.1 / 6.2 failure reporting ---------------------------------------

{
  const booted = await boot({
    promptResult: { ok: false, error: { code: 'session/not-found', message: 'gone' } },
  })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  const state = booted.runtime.getSnapshot()
  check('closed session: error phase', state.phase, 'error')
  includes('closed session: reason', state.error, '会话已结束或已归档')
}

{
  const booted = await boot({
    promptResult: { ok: false, error: { code: 'gateway/internal', message: 'boom' } },
  })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  const state = booted.runtime.getSnapshot()
  includes('delivery failure: reason', state.error, '投递失败')
  includes('delivery failure: host detail kept', state.error, 'boom')
}

// --- probe presets: flat picker + settings CRUD -------------------------

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  check('selected preset accepted', booted.runtime.setPreset('four-line'), true)
  check('unknown preset refused', booted.runtime.setPreset('nope'), false)
  check('preset persisted', booted.localStorage.getItem('dsh-nudge:preset'), 'four-line')
  booted.runtime.ask()
  await tick()
  const text = booted.calls.prompt[0].request.content[0].text
  includes('preset text delivered', text, 'Goal / Done / Next / Needs you')
  check('preset labels are flat strings', typeof booted.runtime.getSnapshot().presets[0].label, 'string')
}

// --- settings CRUD ------------------------------------------------------

{
  const booted = await boot({})
  const added = booted.runtime.addPreset('播报', '说说现在的情况')
  check('add preset accepted', added.ok, true)
  check('preset count grows', booted.runtime.getSnapshot().presets.length, 4)
  const stored = JSON.parse(booted.localStorage.getItem('dsh-nudge:presets'))
  check('presets persisted', stored.length, 4)
  includes('new preset persisted text', JSON.stringify(stored), '说说现在的情况')
  check('selection follows the new preset', booted.runtime.getSnapshot().presetId, added.id)

  check('update preset accepted', booted.runtime.updatePreset(added.id, { label: '情况', text: '现在进展如何？' }).ok, true)
  const updated = booted.runtime.getSnapshot().presets.find((preset) => preset.id === added.id)
  check('update applied label', updated.label, '情况')
  check('update applied text', updated.text, '现在进展如何？')

  check('empty text refused', booted.runtime.addPreset('', '   ').ok, false)
  check('remove preset accepted', booted.runtime.removePreset(added.id), true)
  check('preset count back', booted.runtime.getSnapshot().presets.length, 3)

  check('reset presets', booted.runtime.resetPresets(), undefined)
  check('reset restores builtin ids', JSON.stringify(booted.runtime.getSnapshot().presets.map((preset) => preset.id)), '["brief","fast","four-line"]')

  // Removing the last preset is refused.
  booted.runtime.removePreset('fast')
  booted.runtime.removePreset('four-line')
  check('last preset cannot be removed', booted.runtime.removePreset('brief'), false)
}

// --- settings view edits through the same store ------------------------

{
  const booted = await boot({})
  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section')
  check('settings component registered', typeof settings?.Component, 'function')
  check('flat picker reads the store', booted.runtime.getSnapshot().presets.length, 3)
}

// --- 7.1.3 / 7.1.4 in-place collapse + position memory -----------------

{
  const booted = await boot({})
  booted.runtime.moveTo(120, 180)
  booted.runtime.saveUi()
  booted.runtime.setCollapsed(true)
  const saved = JSON.parse(booted.localStorage.getItem('dsh-nudge:ui'))
  check('position persisted', saved.pos.x, 120)
  check('position persisted (y)', saved.pos.y, 180)
  check('collapse persisted', saved.collapsed, true)
  check('collapsed keeps the same anchor x', booted.runtime.getSnapshot().pos.x, 120)
  check('collapsed keeps the same anchor y', booted.runtime.getSnapshot().pos.y, 180)
  booted.runtime.setCollapsed(false)
  const reopened = JSON.parse(booted.localStorage.getItem('dsh-nudge:ui'))
  check('expand clears collapse', reopened.collapsed, false)
  check('expand stays in place (x)', booted.runtime.getSnapshot().pos.x, 120)
  check('expand stays in place (y)', booted.runtime.getSnapshot().pos.y, 180)

  // A card dragged to a new spot collapses exactly there.
  booted.runtime.moveTo(600, 300)
  booted.runtime.setCollapsed(true)
  check('in-place collapse x', booted.runtime.getSnapshot().pos.x, 600)
  check('in-place collapse y', booted.runtime.getSnapshot().pos.y, 300)
  booted.runtime.setCollapsed(false)
  check('in-place expand x', booted.runtime.getSnapshot().pos.x, 600)
  check('in-place expand y', booted.runtime.getSnapshot().pos.y, 300)

  // The collapsed pill is draggable too.
  booted.runtime.setCollapsed(true)
  booted.runtime.moveTo(420, 260)
  booted.runtime.saveUi()
  const movedWhileCollapsed = JSON.parse(booted.localStorage.getItem('dsh-nudge:ui'))
  check('pill drag persists x', movedWhileCollapsed.pos.x, 420)
  check('pill drag persists y', movedWhileCollapsed.pos.y, 260)
  booted.runtime.setCollapsed(false)
  check('expand after pill drag keeps spot', booted.runtime.getSnapshot().pos.x, 420)
}

// --- view wiring: the pill really drags, a plain click still expands ----

{
  const booted = await boot({})
  const overlay = booted.registrations.find((item) => item.entry.name === 'shell.overlay')
  const View = overlay.Component
  booted.runtime.moveTo(400, 200)
  booted.runtime.saveUi()
  booted.runtime.setCollapsed(true)

  let tree = View()
  const pill = findByClass(tree, 'dsh-nudge-pill')
  check('pill rendered', Boolean(pill), true)
  pill.props.onPointerDown(pointerAt(500, 300))
  pill.props.onPointerMove(pointerAt(560, 340))
  const moved = booted.runtime.getSnapshot().pos
  check('pill drag moves x', moved.x, 460)
  check('pill drag moves y', moved.y, 240)
  pill.props.onPointerUp()
  pill.props.onClick()
  check('a drag does not expand the pill', booted.runtime.getSnapshot().collapsed, true)
  check('pill drag persisted', JSON.parse(booted.localStorage.getItem('dsh-nudge:ui')).pos.x, 460)

  // A click without movement expands.
  tree = View()
  const pillAgain = findByClass(tree, 'dsh-nudge-pill')
  pillAgain.props.onPointerDown(pointerAt(0, 0))
  pillAgain.props.onPointerUp()
  pillAgain.props.onClick()
  check('a plain pill click expands', booted.runtime.getSnapshot().collapsed, false)

  // The card titlebar drags through the same helpers.
  tree = View()
  const gear = findAllByClass(tree, 'dsh-nudge-icon').find((icon) => icon.props?.title === '打开设置')
  check('settings gear rendered', gear?.props?.title, '打开设置')
  const title = findByClass(tree, 'dsh-nudge-title')
  const before = booted.runtime.getSnapshot().pos
  title.props.onPointerDown(pointerAt(300, 200))
  title.props.onPointerMove(pointerAt(340, 230))
  title.props.onPointerUp()
  const after = booted.runtime.getSnapshot().pos
  check('titlebar drag moves x', after.x - before.x, 40)
  check('titlebar drag moves y', after.y - before.y, 30)
  check('titlebar drag does not collapse', booted.runtime.getSnapshot().collapsed, false)

  // A plain click on the titlebar collapses in place; a cancelled pointer does not.
  tree = View()
  const titleAgain = findByClass(tree, 'dsh-nudge-title')
  titleAgain.props.onPointerDown(pointerAt(300, 200))
  titleAgain.props.onPointerCancel()
  check('a cancelled titlebar press does not collapse', booted.runtime.getSnapshot().collapsed, false)

  tree = View()
  const titleClick = findByClass(tree, 'dsh-nudge-title')
  titleClick.props.onPointerDown(pointerAt(300, 200))
  titleClick.props.onPointerUp()
  check('a plain titlebar click collapses', booted.runtime.getSnapshot().collapsed, true)
  check('titlebar click persists collapse', JSON.parse(booted.localStorage.getItem('dsh-nudge:ui')).collapsed, true)
}

// --- settings gear: open the shell panel on this plugin's section ------
{
  const booted = await boot({})
  const clicked = []
  const panel = {
    querySelectorAll: () => [
      { textContent: '通用', click: () => clicked.push('general') },
      { textContent: '状态询问', click: () => clicked.push('nudge') },
    ],
  }
  booted.sandbox.document = {
    querySelector: (selector) =>
      selector === '[data-shortcut-modal="settings"]' ? panel : null,
  }
  check('open settings on an already open panel', booted.runtime.openSettings(), true)
  check('settings nav selects our section', JSON.stringify(clicked), '["nudge"]')
}

{
  const booted = await boot({})
  const calls = []
  let panel
  const trigger = {
    click: () => {
      calls.push('trigger')
      panel = {
        querySelectorAll: () => [
          { textContent: '状态询问', click: () => calls.push('nudge') },
        ],
      }
    },
  }
  const root = { querySelector: () => trigger }
  booted.sandbox.document = {
    querySelector: (selector) => {
      if (selector === '[data-shortcut-modal="settings"]') return panel ?? null
      if (selector === '[data-slot="sidebar.settings"]') return root
      return null
    },
  }
  check('open settings from the sidebar trigger', booted.runtime.openSettings(), true)
  check('sidebar settings trigger clicked', calls[0], 'trigger')
  check('settings section selected after opening', calls[1], 'nudge')
}

{
  const invoked = []
  const booted = await boot({
    shortcuts: {
      runtime: 'desktop',
      registry: {
        invoke: (id, context) => {
          invoked.push({ id, context })
          // The shell opens its panel asynchronously; model the panel appearing
          // by the time the retry timer fires.
          panel = {
            querySelectorAll: () => [
              { textContent: '状态询问', click: () => invoked.push('nudge') },
            ],
          }
        },
      },
    },
  })
  let panel
  const root = { querySelector: () => null }
  const teamTrigger = { click: () => invoked.push('team') }
  booted.sandbox.document = {
    querySelector: (selector) => {
      if (selector === '[data-shortcut-modal="settings"]') return panel ?? null
      if (selector === '[data-slot="sidebar.settings"]') return root
      // A stray dialog trigger earlier in the document (Agent Team members).
      if (selector === 'button[aria-haspopup="dialog"][aria-expanded]') return teamTrigger
      return null
    },
  }
  check('occupied settings seat uses the settings command', booted.runtime.openSettings(), true)
  check('settings command invoked', invoked[0]?.id, 'settings.open')
  check('settings command passes a modal context', invoked[0]?.context?.modal, null)
  check('stray team dialog trigger is never clicked', invoked.includes('team'), false)
  await sleep(80)
  check('section selected after the command opens the panel', invoked[1], 'nudge')
}

{
  const booted = await boot({
    shortcuts: {
      runtime: 'web',
      catalog: {
        getSnapshot: () => [
          {
            id: 'settings.open',
            binding: { code: 'Comma', modifiers: ['control', 'alt'] },
          },
        ],
      },
    },
  })
  const dispatched = []
  let panel
  const root = { querySelector: () => null }
  booted.sandbox.KeyboardEvent = class KeyboardEvent {
    constructor(type, init) {
      this.type = type
      Object.assign(this, init)
    }
  }
  booted.sandbox.document = {
    activeElement: {
      dispatchEvent: (event) => {
        dispatched.push(event)
        panel = {
          querySelectorAll: () => [
            { textContent: '状态询问', click: () => dispatched.push('nudge') },
          ],
        }
        return true
      },
    },
    querySelector: (selector) => {
      if (selector === '[data-shortcut-modal="settings"]') return panel ?? null
      if (selector === '[data-slot="sidebar.settings"]') return root
      return null
    },
  }
  check('web shell falls back to the settings keystroke', booted.runtime.openSettings(), true)
  check('settings keystroke dispatched', dispatched[0]?.code, 'Comma')
  check('settings keystroke modifiers', JSON.stringify([dispatched[0]?.ctrlKey, dispatched[0]?.altKey]), '[true,true]')
  check('settings section selected after keystroke', dispatched[1], 'nudge')
}

{
  const booted = await boot({})
  booted.sandbox.document = { querySelector: () => null }
  check('missing settings entry returns false', booted.runtime.openSettings(), false)
  check(
    'missing settings entry explains the fallback',
    booted.runtime.getSnapshot().note,
    '无法打开设置页面，请从侧边栏进入设置。',
  )
}

// --- write mode: caret in the composer appends instead of sending -------

/** The composer editor focus face used by the runtime's DOM probe. */
function composerFocus() {
  return {
    activeElement: {
      isContentEditable: true,
      getAttribute: () => null,
      closest: (selector) => (selector === '[data-slot="conversation.composer"]' ? {} : null),
    },
  }
}

{
  const booted = await boot({})
  const writes = []
  booted.sandbox.document = composerFocus()
  const bridge = booted.registrations.find((item) => item.entry.name === 'conversation.input.overlay')
  bridge.Component({
    inputActions: { setDraft: (value) => writes.push(value) },
    useInput: (selector) => selector({ draft: '' }),
  })
  check('write mode: empty draft writes the preset', booted.runtime.ask(), true)
  check('write mode: nothing is delivered', booted.calls.prompt.length, 0)
  check('write mode: preset text written', writes[0], '简述一下：目标、已完成、下一步、是否需要我。')
}

{
  const booted = await boot({})
  const writes = []
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '已有的草稿', setDraft: (value) => writes.push(value) })
  booted.runtime.ask()
  check(
    'write mode: newline separates existing text',
    writes[0],
    '已有的草稿\n简述一下：目标、已完成、下一步、是否需要我。',
  )
}

{
  const booted = await boot({})
  const writes = []
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '已有草稿\n', setDraft: (value) => writes.push(value) })
  booted.runtime.ask()
  check(
    'write mode: a trailing newline is not doubled',
    writes[0],
    '已有草稿\n简述一下：目标、已完成、下一步、是否需要我。',
  )
}

{
  const booted = await boot({})
  const writes = []
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '   ', setDraft: (value) => writes.push(value) })
  booted.runtime.ask()
  check('write mode: a blank draft gets no leading newline', writes[0], '简述一下：目标、已完成、下一步、是否需要我。')
}

{
  const booted = await boot({})
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '', setDraft: () => {} })
  check('write mode flag follows the caret', booted.runtime.getSnapshot().composerFocused, true)
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const askButton = findByClass(View(), 'dsh-nudge-ask')
  check('primary button relabels for write mode', askButton?.children?.[0], '写入输入框')
  const modeGroup = findByClass(View(), 'dsh-nudge-mode')
  check('delivery switch is inactive in write mode', modeGroup?.props?.['aria-disabled'], 'true')
}

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  const writes = []
  booted.sandbox.document = { activeElement: null }
  booted.runtime.attachComposer({ readDraft: () => 'draft', setDraft: (value) => writes.push(value) })
  booted.runtime.ask()
  await tick()
  check('caret elsewhere: nothing written', writes.length, 0)
  check('caret elsewhere: still sends', booted.calls.prompt.length, 1)
}

// --- annotations: selection -> tray -> send / write ---------------------

/** A window.getSelection() stub over one non-collapsed range. */
function selectionStub(text, element) {
  return () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => ({ commonAncestorContainer: element }),
  })
}

{
  const booted = await boot({})
  booted.sandbox.getSelection = selectionStub('原文内容', { nodeType: 1, closest: () => null })
  check('annotation: selection captured', booted.runtime.captureSelection(), true)
  check('annotation: quote stored', booted.runtime.getSnapshot().annotationDraft?.quote, '原文内容')
  check('annotation: note starts empty', booted.runtime.getSnapshot().annotationNote, '')
  booted.runtime.setAnnotationNote('我觉得可行')
  check('annotation: note accepted', booted.runtime.getSnapshot().annotationNote, '我觉得可行')
  check('annotation: added to the tray', booted.runtime.addAnnotation(), true)
  const state = booted.runtime.getSnapshot()
  check('annotation: draft cleared after add', state.annotationDraft, null)
  check('annotation: tray count', state.annotations.length, 1)
  check('annotation: tray quote', state.annotations[0].quote, '原文内容')
  check('annotation: tray note', state.annotations[0].note, '我觉得可行')
  check('annotation: removable', booted.runtime.removeAnnotation(state.annotations[0].id), true)
  check('annotation: tray empty again', booted.runtime.getSnapshot().annotations.length, 0)
}

{
  // Selections inside fields, modals and this window are ignored.
  const cases = [
    ['input', (selector) => (selector.includes('input') ? {} : null)],
    ['modal', (selector) => (selector.includes('aria-modal') ? {} : null)],
    ['nudge card', (selector) => (selector.includes('dsh-nudge-card') ? {} : null)],
  ]
  for (const [label, closest] of cases) {
    const booted = await boot({})
    booted.sandbox.getSelection = selectionStub('不该被引用', { nodeType: 1, closest })
    check(`annotation: ignores selection in ${label}`, booted.runtime.captureSelection(), false)
  }
}

{
  const booted = await boot({})
  booted.sandbox.getSelection = selectionStub('第二行\n\n第四行', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  booted.runtime.addAnnotation()
  booted.runtime.attachComposer({ readDraft: () => '已有草稿', setDraft: () => {} })
  const writes = []
  booted.runtime.attachComposer({ readDraft: () => '已有草稿', setDraft: (value) => writes.push(value) })
  check('annotation: written to the composer', booted.runtime.writeAnnotations(), true)
  check(
    'annotation: quote block keeps paragraphs, newline separates the draft',
    writes[0],
    '已有草稿\n> 第二行\n>\n> 第四行',
  )
  check('annotation: tray emptied after write', booted.runtime.getSnapshot().annotations.length, 0)
}

{
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.sandbox.getSelection = selectionStub('同一段文字', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  booted.runtime.setAnnotationNote('这里我不同意')
  booted.runtime.addAnnotation()
  check('annotation: send delivers once', booted.runtime.sendAnnotations(), true)
  const request = booted.calls.prompt[0]?.request
  check('annotation: sent as one message', request?.content?.[0]?.text, '> 同一段文字\n我的回答：这里我不同意')
  check('annotation: send starts waiting', booted.runtime.getSnapshot().phase, 'waiting')
  check('annotation: tray emptied after send', booted.runtime.getSnapshot().annotations.length, 0)
}

{
  // Without an open conversation a send is refused and the tray survives.
  const booted = await boot({})
  booted.sandbox.getSelection = selectionStub('保留我', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  booted.runtime.addAnnotation()
  check('annotation: send without session refused', booted.runtime.sendAnnotations(), false)
  check('annotation: tray survives a failed send', booted.runtime.getSnapshot().annotations.length, 1)
}

{
  // The repository advertises the selection gesture, and a capture opens the
  // beside-selection card instead of a box inside the window.
  const booted = await boot({})
  booted.runtime.setQuick(true)
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const hint = findByClass(View(), 'dsh-nudge-annotation-hint')
  includes('annotation: repository explains the gesture', hint?.children?.[0], '选中对话里的文字')
  booted.sandbox.getSelection = selectionStub('原文内容', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  const popup = findByClass(View(), 'dsh-nudge-popup')
  check('annotation: capture opens the beside card', Boolean(popup), true)
  check('annotation: card shows the quote', popup?.children?.[0]?.children?.[0], '原文内容')
  check('annotation: window keeps no compose box', findByClass(View(), 'dsh-nudge-annotation-compose'), null)
}

// --- turbo mode: no primary button, double-click runs a prompt ----------

{
  const booted = await boot({})
  check('turbo defaults off', booted.runtime.getSnapshot().turbo, false)
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  check('primary button visible by default', Boolean(findByClass(View(), 'dsh-nudge-ask')), true)

  check('turbo can be enabled', booted.runtime.setTurbo(true), true)
  check('turbo flag stored', booted.localStorage.getItem('dsh-nudge:turbo'), '1')
  check('turbo state published', booted.runtime.getSnapshot().turbo, true)
  const tree = View()
  check('turbo hides the primary button', findByClass(tree, 'dsh-nudge-ask'), null)
  check('turbo shows the double-click hint', findByClass(tree, 'dsh-nudge-turbo-hint')?.children?.[0], '双击口径直接询问状态')
  check('turbo prompt exposes double-click', typeof findByClass(tree, 'dsh-nudge-chip')?.props?.onDoubleClick, 'function')

  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section')
  const toggle = findByProp(settings.Component(), 'type', 'checkbox')
  check('settings renders the turbo switch', Boolean(toggle), true)
  check('settings switch reflects turbo', toggle?.props?.checked, true)
  toggle.props.onChange({ target: { checked: false } })
  check('settings switch turns turbo off', booted.runtime.getSnapshot().turbo, false)
  check('turbo flag cleared', booted.localStorage.getItem('dsh-nudge:turbo'), null)
}

{
  // Double-click sends when the caret is not in the composer.
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.setTurbo(true)
  booted.runtime.setPreset('fast')
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const fastChip = findAllByClass(View(), 'dsh-nudge-chip').find((chip) => chip.children?.[0] === '快一点')
  fastChip.props.onDoubleClick()
  await tick()
  check('turbo double-click sends once', booted.calls.prompt.length, 1)
  includes('turbo double-click sends the chosen prompt', booted.calls.prompt[0]?.request?.content?.[0]?.text, '快一点')
}

{
  // Double-click writes into the draft while the composer has the caret.
  const booted = await boot({})
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  const writes = []
  booted.runtime.setTurbo(true)
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '', setDraft: (value) => writes.push(value) })
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  check('turbo write hint follows the caret', findByClass(View(), 'dsh-nudge-turbo-hint')?.children?.[0], '双击口径写入输入框')
  findByClass(View(), 'dsh-nudge-chip').props.onDoubleClick()
  check('turbo double-click writes instead of sending', writes.length, 1)
  check('turbo double-click delivers nothing', booted.calls.prompt.length, 0)
}

// --- 7.4.3 narrow screens default collapsed ----------------------------

{
  const booted = await boot({ innerWidth: 480, innerHeight: 720 })
  check('narrow screen defaults collapsed', booted.runtime.getSnapshot().collapsed, true)
}

// --- 5.x zero configuration works without any stored values -------------

{
  const booted = await boot({})
  check('works with zero configuration', booted.runtime.getSnapshot().phase, 'idle')
  check('effective delivery defaults to steer', booted.runtime.effectiveDelivery(), 'steer')
  check('default preset', booted.runtime.getSnapshot().presetId, 'brief')
}

// --- stop button throttle after a failure ------------------------------

{
  const booted = await boot({
    language: 'en-US',
  })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: 'Session A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  check('english language picked up', booted.runtime.getSnapshot().lang, 'en')
  check('waiting again after retry', booted.runtime.getSnapshot().phase, 'waiting')
}

// --- durable event route: exact probe correlation and answer detection ---

/** One durable client event-window entry. */
const durable = (type, seq, data) => ({ type: 'event', event: { type, seq, time: Date.now(), data } })

{
  const source = observable({ entries: [] })
  const booted = await boot({ bindings: { A: source } })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  const request = booted.calls.prompt[0].request
  const probeText = request.content[0].text
  const step = { turn: 2, step: 1 }
  check('events: still waiting before admission', booted.runtime.getSnapshot().phase, 'waiting')

  source.set({
    entries: [durable('assistant/message', 5, { ...step, message: { content: [{ type: 'text', text: '更早一步' }] } })],
  })
  check('events: pre-probe assistant ignored', booted.runtime.getSnapshot().phase, 'waiting')

  source.set({
    entries: [
      durable('assistant/message', 5, { ...step, message: { content: [{ type: 'text', text: '更早一步' }] } }),
      durable('user/message', 6, { content: [{ type: 'text', text: probeText }], source: { kind: 'user', rpcId: request.requestId } }),
      durable('step/start', 7, step),
    ],
  })
  check('events: probe admitted, still waiting', booted.runtime.getSnapshot().phase, 'waiting')

  source.set({
    entries: [
      durable('assistant/message', 5, { ...step, message: { content: [{ type: 'text', text: '更早一步' }] } }),
      durable('user/message', 6, { content: [{ type: 'text', text: probeText }], source: { kind: 'user', rpcId: request.requestId } }),
      durable('step/start', 7, step),
      durable('assistant/message', 8, { ...step, message: { content: [{ type: 'text', text: 'Goal: …' }] } }),
    ],
  })
  check('events: answer detected at its durable message', booted.runtime.getSnapshot().phase, 'done')
  check('events: result remembers its session', booted.runtime.getSnapshot().lastSessionId, 'A')
}

// --- steer: the in-flight step's message is not the answer ----------------

{
  const source = observable({
    entries: [durable('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '进行中' }] } })],
  })
  const booted = await boot({ bindings: { A: source } })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  const request = booted.calls.prompt[0].request
  const probeText = request.content[0].text
  source.set({
    entries: [
      durable('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '进行中' }] } }),
      durable('user/message', 6, { content: [{ type: 'text', text: probeText }], source: { kind: 'user', rpcId: request.requestId } }),
      durable('assistant/message', 7, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '当前步的旧回复' }] } }),
    ],
  })
  check('events: in-flight step message ignored', booted.runtime.getSnapshot().phase, 'waiting')
  source.set({
    entries: [
      durable('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '进行中' }] } }),
      durable('user/message', 6, { content: [{ type: 'text', text: probeText }], source: { kind: 'user', rpcId: request.requestId } }),
      durable('assistant/message', 7, { turn: 1, step: 1, message: { content: [{ type: 'text', text: '当前步的旧回复' }] } }),
      durable('step/start', 8, { turn: 1, step: 2 }),
      durable('assistant/message', 9, { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'Goal: …' }] } }),
    ],
  })
  check('events: steering answer detected after the next step opens', booted.runtime.getSnapshot().phase, 'done')
}

// --- blocked / archived delivery is an error, not 已返回 -------------------

{
  const source = observable({ entries: [] })
  const booted = await boot({ bindings: { A: source } })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  const request = booted.calls.prompt[0].request
  source.set({
    entries: [
      durable('user/message', 6, { content: [{ type: 'text', text: request.content[0].text }], source: { kind: 'user', rpcId: request.requestId } }),
      durable('turn/end', 7, { turn: 1, reason: { kind: 'blocked' } }),
    ],
  })
  const state = booted.runtime.getSnapshot()
  check('events: blocked turn is an error', state.phase, 'error')
  includes('events: blocked turn reason', state.error, '归档')
}

// --- 1.2 session switch resets the window status --------------------------

{
  const source = observable({ entries: [] })
  const booted = await boot({ bindings: { A: source } })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.ask()
  await tick()
  source.set({
    entries: [
      durable('user/message', 6, { content: [{ type: 'text', text: booted.calls.prompt[0].request.content[0].text }] }),
      durable('step/start', 7, { turn: 1, step: 1 }),
      durable('assistant/message', 8, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Goal: …' }] } }),
    ],
  })
  check('switch: answered in A first', booted.runtime.getSnapshot().phase, 'done')
  booted.sessionsList.set({ ids: ['B'], byId: { B: { title: '会话 B', retainedBy: { mainView: 1 } } } })
  await tick()
  const state = booted.runtime.getSnapshot()
  check('switch: status reset for the new conversation', state.phase, 'idle')
  check('switch: new target', state.target?.sessionId, 'B')
  check('switch: previous result stays bound to A', state.lastSessionId, 'A')
}

console.log(failures === 0 ? '\nclient checks: all passed' : `\nclient checks: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
