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
import {
  source,
  sleep,
  tick,
  findByClass,
  findAllByClass,
  findByProp,
  observable,
  ReactStub,
  storageStub,
  boot,
  pointerAt,
  // boot/builds the VM instance; the rest are shared with scripts/preview.mjs
} from './harness.mjs'

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
/** Collect every rendered element with the given tag (`input`, `textarea`, ...). */
function findAllByTag(node, tag, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === tag) out.push(node)
  for (const child of node.children ?? []) findAllByTag(child, tag, out)
  return out
}
/** Expand nested function components (the React stub renders only what it is given). */
function expandTree(node) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expandTree)
  if (typeof node.type === 'function') return expandTree(node.type(node.props ?? {}))
  return { ...node, children: (node.children ?? []).map(expandTree) }
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
  check('switching delivery says so in words', booted.runtime.getSnapshot().flash, '方式：排队')
  check('turbo toggle says so in words', booted.runtime.setTurbo(true) && booted.runtime.getSnapshot().flash, '急速模式：开')
  check('quick toggle says so in words', booted.runtime.setQuick(true) && booted.runtime.getSnapshot().flash, '快速批注：开')
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

  // Every preset can go: an empty list is a real, reachable state now.
  booted.runtime.removePreset('fast')
  booted.runtime.removePreset('four-line')
  check('the second-to-last preset can be removed', booted.runtime.removePreset('brief'), true)
  check('an empty list is allowed', booted.runtime.getSnapshot().presets.length, 0)
  check('the empty list is persisted', JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).length, 0)
  check('adding works again from empty', booted.runtime.addPreset('重来', '再来一条').ok, true)
  check('the count comes back after re-adding', booted.runtime.getSnapshot().presets.length, 1)
}

// --- in-window quick add: chip opens a title + body form ----------------

{
  const booted = await boot({})
  const { runtime } = booted
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  check('quick add: button rendered', Boolean(findByClass(View(), 'dsh-nudge-chip-add')), true)
  check('quick add: presets come first', findAllByClass(View(), 'dsh-nudge-chip')[0]?.props?.className.includes('dsh-nudge-chip-add'), false)
  check('quick add: form closed at rest', findByClass(View(), 'dsh-nudge-quick-add'), null)
  check('quick add: opening accepted', runtime.startNudgeDraft(), true)
  check('quick add: form rendered', Boolean(findByClass(View(), 'dsh-nudge-quick-add')), true)
  check('quick add: title field rendered', Boolean(findByProp(View(), 'placeholder', '标题')), true)
  check('quick add: body field rendered', Boolean(findByProp(View(), 'placeholder', '正文')), true)
  runtime.setNudgeDraftLabel('日报')
  runtime.setNudgeDraftText('今天做了什么')
  check('quick add: saved', runtime.saveNudgeDraft().ok, true)
  check('quick add: form closed after save', findByClass(View(), 'dsh-nudge-quick-add'), null)
  const added = runtime.getSnapshot().presets.find((preset) => preset.label === '日报')
  check('quick add: preset stored', added?.text, '今天做了什么')
  check('quick add: count grows', runtime.getSnapshot().presets.length, 4)
  runtime.startNudgeDraft()
  runtime.setNudgeDraftLabel('空')
  runtime.setNudgeDraftText('  ')
  check('quick add: empty body refused', runtime.saveNudgeDraft().ok, false)
  check('quick add: error surfaced', Boolean(findByClass(View(), 'dsh-nudge-settings-error')), true)
  check('quick add: failed draft stays open', runtime.getSnapshot().nudgeDraftOpen, true)
  check('quick add: cancel closes', runtime.cancelNudgeDraft(), true)
  check('quick add: cancel discards', runtime.getSnapshot().presets.length, 4)
}

// --- preset on/off: disabled prompts stay in settings, leave the window --

{
  const booted = await boot({})
  const { runtime } = booted
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section').Component
  const tree = () => expandTree(settings())
  check('every preset starts enabled', runtime.getSnapshot().presets.every((preset) => preset.enabled !== false), true)
  check('the settings row offers a state switch', (findAllByClass(tree(), 'dsh-nudge-preset-state') ?? []).length, 3)

  const target = runtime.getSnapshot().presets[1].id
  runtime.setPreset(target)
  check('toggle accepted', runtime.togglePresetEnabled(target), true)
  check('the preset is disabled', runtime.getSnapshot().presets.find((preset) => preset.id === target).enabled, false)
  check(
    'the disabled state is persisted',
    JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).find((preset) => preset.id === target).enabled,
    false,
  )
  check('selection falls back off the disabled preset', runtime.getSnapshot().presetId === target, false)
  check(
    'the selection lands on an enabled preset',
    runtime.getSnapshot().presets.find((preset) => preset.id === runtime.getSnapshot().presetId).enabled !== false,
    true,
  )
  check('the row shows the disabled state', Boolean(findByClass(tree(), 'dsh-nudge-preset-row disabled')), false)
  check(
    'a disabled row is marked',
    (findAllByClass(tree(), 'dsh-nudge-preset-row') ?? []).filter((node) => node.props.className.includes('disabled')).length,
    1,
  )
  const chips = () => findAllByClass(View(), 'dsh-nudge-chip')
  check('the window hides the disabled chip', chips().length, 3)
  check('the add chip stays', Boolean(findByClass(View(), 'dsh-nudge-chip-add')), true)

  check('re-enable accepted', runtime.togglePresetEnabled(target), true)
  check('the preset is enabled again', runtime.getSnapshot().presets.find((preset) => preset.id === target).enabled, true)
  check('the window shows all chips again', chips().length, 4)

  for (const preset of runtime.getSnapshot().presets) runtime.setPresetEnabled(preset.id, false)
  check('every preset can be off', runtime.getSnapshot().presets.every((preset) => preset.enabled === false), true)
  check('the window explains the empty row', Boolean(findByClass(View(), 'dsh-nudge-presets-empty')), true)
  check('ask is refused with no enabled preset', runtime.ask(), false)
  runtime.setPresetEnabled(target, true)
  check('one enabled preset is enough', runtime.getSnapshot().presetId, target)
}

// --- settings presets: collapsed list, one editor, drag, bulk import ----

{
  const booted = await boot({})
  const { runtime } = booted
  const first = runtime.getSnapshot().presets[0].id
  check('presets start collapsed', runtime.getSnapshot().presetOpen.length, 0)
  check('one preset opens', runtime.togglePresetOpen(first), true)
  check('the open id is remembered', runtime.getSnapshot().presetOpen.join(','), first)
  check('the same preset closes again', runtime.togglePresetOpen(first), true)
  check('closing leaves nothing open', runtime.getSnapshot().presetOpen.length, 0)
  check('expand-all accepted', runtime.setPresetsOpen(true), true)
  check('expand-all opened every preset', runtime.getSnapshot().presetOpen.length, runtime.getSnapshot().presets.length)
  check('collapse-all accepted', runtime.setPresetsOpen(false), true)
  check('collapse-all closed every preset', runtime.getSnapshot().presetOpen.length, 0)

  runtime.startPresetEdit(first)
  check('the editor opens for one preset', runtime.getSnapshot().presetEditingId, first)
  const second = runtime.getSnapshot().presets[1].id
  runtime.startPresetEdit(second)
  check('only one editor is open at a time', runtime.getSnapshot().presetEditingId, second)
  check('cancel closes the editor', runtime.cancelPresetEdit(), true)
  check('cancel with no editor is refused', runtime.cancelPresetEdit(), false)
  runtime.startPresetEdit(first)
  runtime.updatePreset(first, { label: '改名', text: '改过的话' })
  check('saving closes the editor', runtime.getSnapshot().presetEditingId, null)

  // Drag and drop moves a row to an absolute slot.
  const ids = runtime.getSnapshot().presets.map((preset) => preset.id)
  check('drag to the top accepted', runtime.movePresetTo(ids[2], 0), true)
  check('drag moved the row', runtime.getSnapshot().presets[0].id, ids[2])
  check('drag to the same slot is refused', runtime.movePresetTo(ids[2], 0), false)
  check('drag past the end lands last', runtime.movePresetTo(ids[2], 99), true)
  check('the moved row is last', runtime.getSnapshot().presets.at(-1).id, ids[2])
  check('drag order is written to storage', JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).at(-1).id, ids[2])
}

{
  const booted = await boot({})
  const { runtime } = booted
  // Blocks are separated by three or more blank lines; line one names the block.
  const raw = ['甲\n甲正文第一行\n甲正文第二行', '乙\n乙正文', '丙'].join('\n\n\n\n')
  const result = runtime.importPresets(raw)
  check('bulk import accepted', result.ok, true)
  check('bulk import added three', result.added, 3)
  check('bulk import appended to the list', runtime.getSnapshot().presets.length, 6)
  const added = runtime.getSnapshot().presets.slice(3)
  check('the first line becomes the name', added[0].label, '甲')
  check('the remaining lines become the body', added[0].text, '甲正文第一行\n甲正文第二行')
  check('a one-line block names and fills itself', `${added[2].label}|${added[2].text}`, '丙|丙')
  check('bulk import is persisted', JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).length, 6)
  check('the same paste again is all duplicates', runtime.importPresets(raw).added, 0)
  check('an empty paste is refused', runtime.importPresets('   \n\n').ok, false)
  check('two blank lines are still one block', runtime.importPresets('丁\n正文\n\n\n戊\n正文二').added, 1)
  const before = runtime.getSnapshot().presets.length
  const big = Array.from({ length: 12 }, (_, index) => `批量${index}\n批量正文${index}`).join('\n\n\n\n')
  const unbounded = runtime.importPresets(big)
  check('bulk import has no cap', unbounded.added, 12)
  check('bulk import keeps everything', runtime.getSnapshot().presets.length, before + 12)
  check('nothing is reported as skipped', unbounded.skipped, 0)
  check('the list may exceed eight', runtime.getSnapshot().presets.length > 8, true)
}

{
  const booted = await boot({})
  const copied = []
  booted.sandbox.navigator.clipboard = { writeText: (value) => (copied.push(value), Promise.resolve()) }
  const result = await booted.runtime.exportPresets()
  check('bulk export accepted', result.ok, true)
  check('bulk export counts every entry', result.count, 3)
  check('bulk export copies once', copied.length, 1)
  const blocks = String(copied[0]).split('\n\n\n\n')
  check('bulk export writes one block per entry', blocks.length, 3)
  check('a block starts with the name', blocks[0].split('\n')[0], '简述')
  check('the remaining lines stay the body', blocks[0].split('\n').slice(1).join('\n'), '简述一下：目标、已完成、下一步、是否需要我。')
  check('the export is import-ready', booted.runtime.importPresets(copied[0]).added, 0)

  booted.runtime.addPreset('', '单行条目')
  copied.length = 0
  await booted.runtime.exportPresets()
  check('a name-only entry exports as one line', String(copied[0]).split('\n\n\n\n').at(-1), '单行条目')

  delete booted.sandbox.navigator.clipboard
  check('a missing clipboard reports a failure', (await booted.runtime.exportPresets()).ok, false)
}

{
  // An empty list reads back empty: the built-ins are not resurrected.
  const seeded = storageStub()
  seeded.setItem('dsh-nudge:presets', '[]')
  const booted = await boot({ storage: seeded })
  check('an empty stored list stays empty', booted.runtime.getSnapshot().presets.length, 0)
  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section').Component
  const tree = expandTree(settings())
  check('the empty state is reachable', (findAllByClass(tree, 'dsh-nudge-preset-empty') ?? []).length, 1)
  check('the add form is still offered from empty', (findAllByClass(tree, 'dsh-nudge-preset-add') ?? []).length, 1)
  const exportButton = (findAllByClass(tree, 'dsh-nudge-btn') ?? []).find(
    (node) => node.children?.[0] === '批量导出',
  )
  check('bulk export sits beside bulk import', exportButton !== undefined, true)
  check('bulk export is disabled while empty', exportButton?.props?.disabled, true)
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

  // A plain click on the titlebar no longer collapses the card.
  tree = View()
  const titleClick = findByClass(tree, 'dsh-nudge-title')
  titleClick.props.onPointerDown(pointerAt(300, 200))
  titleClick.props.onPointerUp()
  check('a plain titlebar click does not collapse', booted.runtime.getSnapshot().collapsed, false)
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
  check('open settings on an already open panel', await booted.runtime.openSettings(), true)
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
  check('open settings from the sidebar trigger', await booted.runtime.openSettings(), true)
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
  check('occupied settings seat uses the settings command', await booted.runtime.openSettings(), true)
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
  check('web shell falls back to the settings keystroke', await booted.runtime.openSettings(), true)
  check('settings keystroke dispatched', dispatched[0]?.code, 'Comma')
  check('settings keystroke modifiers', JSON.stringify([dispatched[0]?.ctrlKey, dispatched[0]?.altKey]), '[true,true]')
  check('settings section selected after keystroke', dispatched[1], 'nudge')
}

// A shell with no reachable settings entry (launcher seat owned by the account
// menu, no shortcuts service) used to leave the gear doing nothing at all. The
// window now shows the same form itself, so this is the regression guard.
{
  const booted = await boot({})
  booted.sandbox.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const overlay = booted.registrations.find((item) => item.entry.name === 'shell.overlay')
  const tree = () => overlay.Component()
  check('settings gear still rendered', Boolean(findByProp(tree(), 'aria-label', '打开设置')), true)
  check('no shell route reports false', await booted.runtime.openSettings(), false)
  check('no shell route opens the in-window form', booted.runtime.getSnapshot().settingsOpen, true)
  check('the window renders the settings panel', Boolean(findByClass(tree(), 'dsh-nudge-settings-panel')), true)
  // The form is a component element, so the walker sees it, not its insides;
  // the shell section test above already proves what it renders.
  check('the in-window form is the settings section', Boolean(findByProp(tree(), 'key', 'settings-form')), true)
  booted.runtime.closeSettings()
  check('closing the panel restores the body', booted.runtime.getSnapshot().settingsOpen, false)
  check('closing the panel brings the modules back', Boolean(findByClass(tree(), 'dsh-nudge-content')), true)
}

// The shell accepted `settings.open` but never painted a panel: the retry gives
// up and the window shows the form instead of leaving the gear dead.
{
  const booted = await boot({
    shortcuts: {
      runtime: 'desktop',
      registry: { invoke: () => {} },
    },
  })
  booted.sandbox.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  check('command route is accepted', await booted.runtime.openSettings(), true)
  check('no panel yet, nothing shown', booted.runtime.getSnapshot().settingsOpen, false)
  await sleep(1500)
  check('a shell that never paints the panel falls back to the window', booted.runtime.getSnapshot().settingsOpen, true)
}

// The trigger is found by the marks the shell ships on it — a Settings label or
// the settings keybinding — even when the sidebar seat is elsewhere and the shell
// omits `aria-keyshortcuts` (it does whenever the binding is unavailable).
{
  const calls = []
  let panel
  const booted = await boot({ shortcuts: { runtime: 'desktop' } })
  const trigger = {
    getAttribute: (name) => {
      if (name === 'aria-expanded') return 'false'
      if (name === 'aria-label') return '设置'
      return null
    },
    click: () => {
      calls.push('trigger')
      panel = {
        querySelectorAll: () => [
          { textContent: '状态询问', click: () => calls.push('nudge') },
        ],
      }
    },
  }
  booted.sandbox.document = {
    querySelector: (selector) => {
      if (selector === '[data-shortcut-modal="settings"]') return panel ?? null
      return null
    },
    querySelectorAll: (selector) =>
      selector === 'button[aria-haspopup="dialog"]' ? [trigger] : [],
  }
  check('a labelled trigger without aria-keyshortcuts is still found', await booted.runtime.openSettings(), true)
  check('that trigger is clicked', calls[0], 'trigger')
  check('the section is selected after it opens the panel', calls[1], 'nudge')
  check('the in-window form stays closed', booted.runtime.getSnapshot().settingsOpen, false)
}

// Some other dialog button in the sidebar (a usage popover) is not the Settings
// trigger: clicking it would flash an unrelated popup on the way to Settings.
{
  const calls = []
  const booted = await boot({ shortcuts: { runtime: 'desktop' } })
  const usage = {
    getAttribute: (name) => {
      if (name === 'aria-expanded') return 'false'
      if (name === 'aria-label') return '本轮用量'
      return null
    },
    click: () => calls.push('usage'),
  }
  booted.sandbox.document = {
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === 'button[aria-haspopup="dialog"]' ? [usage] : [],
  }
  check('an unrelated dialog button is not clicked', await booted.runtime.openSettings(), false)
  check('no popup is opened on the way', calls.length, 0)
}

// A shell that accepts `settings.open` but paints nothing must not swallow the
// gear: the next route runs and the section is selected from the panel it opens.
{
  const calls = []
  let panel
  const booted = await boot({
    shortcuts: {
      runtime: 'desktop',
      registry: { invoke: () => {} },
    },
  })
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
  check('a silent settings command is not trusted', await booted.runtime.openSettings(), true)
  check('nothing is shown while the command is being verified', booted.runtime.getSnapshot().settingsOpen, false)
  await sleep(900)
  check('the next route clicks the settings trigger', calls[0], 'trigger')
  check('the section is selected from that panel', calls[1], 'nudge')
  check('the in-window form stays closed', booted.runtime.getSnapshot().settingsOpen, false)
}

// The jump driver is a package-local chunk, not part of the main bundle: the
// gear must still have an outcome when that file is missing from an install.
{
  const booted = await boot({})
  check('the jump driver ships as a chunk', source.includes(".async('./client.settings-jump.js')"), true)
  check('the main bundle carries no inlined driver', source.includes('function createSettingsJump'), false)
}

{
  // The loader only registers a chunk whose file names itself under the package
  // id and whose name matches `client.<name>.js`.
  const chunk = await readFile(new URL('../client.settings-jump.js', import.meta.url), 'utf8')
  check(
    'the chunk registers itself under the package id',
    /__ModuleLoader__\.load\(\{\s*id: 'dsh-nudge',\s*chunk: 'client\.settings-jump\.js'/.test(chunk),
    true,
  )
  check('the chunk exports the driver factory', chunk.includes('exports.createSettingsJump = createSettingsJump'), true)
}

{
  const booted = await boot({ chunks: false })
  booted.sandbox.document = { querySelector: () => null, querySelectorAll: () => [] }
  check('a missing jump chunk reports failure', await booted.runtime.openSettings(), false)
  check('a missing jump chunk still opens the form', booted.runtime.getSnapshot().settingsOpen, true)
}

// The gear button itself must reach the form, not only the runtime call.
{
  const booted = await boot({})
  booted.sandbox.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const overlay = booted.registrations.find((item) => item.entry.name === 'shell.overlay')
  const gear = findByProp(overlay.Component(), 'aria-label', '打开设置')
  gear.props.onClick()
  // The jump driver is a package-local chunk: the press resolves after it loads.
  await tick()
  check('the gear opens the in-window form', booted.runtime.getSnapshot().settingsOpen, true)
  const gearAgain = findByProp(overlay.Component(), 'aria-label', '打开设置')
  gearAgain.props.onClick()
  check('the gear closes it again', booted.runtime.getSnapshot().settingsOpen, false)
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
  const deliveryToggle = findByClass(View(), 'dsh-nudge-delivery-toggle')
  check('delivery switch is inactive in write mode', deliveryToggle?.props?.disabled, true)
  check(
    'delivery switch is an icon on the quick-input row',
    deliveryToggle?.props?.className?.includes('dsh-nudge-head-icon'),
    true,
  )
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
function selectionStub(text, element, rect) {
  return () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => ({
      commonAncestorContainer: element,
      getBoundingClientRect: () => rect ?? { left: 100, top: 300, right: 300, bottom: 320, width: 200, height: 20 },
    }),
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
  const tree = View()
  const popup = findByClass(tree, 'dsh-nudge-popup')
  check('annotation: capture opens the selection card', Boolean(popup), true)
  check(
    'annotation: card no longer repeats the quoted text',
    findByClass(popup, 'dsh-nudge-popup-quote'),
    null,
  )
  check(
    'annotation: card carries its own close button',
    Boolean(findByClass(popup, 'dsh-nudge-popup-close')),
    true,
  )
  check(
    'annotation: card keeps the single quick-action row',
    (findAllByClass(popup, 'dsh-nudge-popup-quick') ?? []).length,
    2,
  )
  check(
    'annotation: card offers save and copy',
    Boolean(findByClass(popup, 'dsh-nudge-popup-save')) &&
      Boolean(findByClass(popup, 'dsh-nudge-popup-copy')),
    true,
  )
  check(
    'annotation: copy reports its own result',
    await booted.runtime.copyDraftQuote(),
    false,
  )
  check(
    'annotation: card spells out the keys',
    findByClass(popup, 'dsh-nudge-popup-hint')?.children?.[0]?.children?.[0]?.children?.[0],
    'Enter',
  )
  check(
    'annotation: card is placed over the quote, not beside it',
    popup?.props?.style?.transform,
    'translateY(-100%)',
  )
  check('annotation: window keeps no compose box', findByClass(tree, 'dsh-nudge-annotation-compose'), null)
}

{
  // A document-wide mouseup can belong to a click elsewhere (a sidebar click
  // that does not collapse the selection). That pointer must not drag the card
  // away from the passage the card is about.
  const booted = await boot({})
  booted.runtime.setQuick(true)
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const quoteRect = { left: 100, top: 300, right: 300, bottom: 320, width: 200, height: 20 }
  booted.sandbox.getSelection = selectionStub('选中的一段话', { nodeType: 1, closest: () => null }, quoteRect)
  check('annotation: a far pointer still captures', booted.runtime.captureSelection({ x: 900, y: 500 }), true)
  let popup = findByClass(View(), 'dsh-nudge-popup')
  check('annotation: a far click does not move the card', popup?.props?.style?.left, '30px')
  check(
    'annotation: a far click falls back to the quote box',
    popup?.props?.style?.transform,
    'translateY(-100%)',
  )

  // A pointer that ended the selection itself stays the anchor.
  const near = await boot({})
  near.runtime.setQuick(true)
  near.sandbox.getSelection = selectionStub('选中的一段话', { nodeType: 1, closest: () => null }, quoteRect)
  near.runtime.captureSelection({ x: 150, y: 310 })
  const nearView = near.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  popup = findByClass(nearView(), 'dsh-nudge-popup')
  check('annotation: the selection pointer stays the anchor', popup?.props?.style?.left, '162px')
  check('annotation: the card sits below the pointer', popup?.props?.style?.top, '322px')
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
  check('turbo shows no double-click hint line', findByClass(tree, 'dsh-nudge-turbo-hint'), null)
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
  check('turbo keeps no hint line in write mode either', findByClass(View(), 'dsh-nudge-turbo-hint'), null)
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

// --- annotation: second note, copy shortcut, auto-expand ------------------

{
  const booted = await boot({})
  booted.runtime.setQuick(true)
  booted.sandbox.getSelection = selectionStub('第一段', { nodeType: 1, closest: () => null })
  check('annotation: first note captured', booted.runtime.captureSelection(), true)
  booted.runtime.addAnnotation()
  check('annotation: tray opens after adding', booted.runtime.getSnapshot().annotationExpanded, true)
  booted.sandbox.getSelection = selectionStub('第二段', { nodeType: 1, closest: () => null })
  check('annotation: a second capture is accepted', booted.runtime.captureSelection(), true)
  booted.runtime.addAnnotation()
  check('annotation: two notes collected', booted.runtime.getSnapshot().annotations.length, 2)

  // The card folded itself away: a settled selection has to bring it back even
  // when the pointer path never fires again (drag ending outside, re-render).
  booted.runtime.setAnnotationExpanded(false)
  booted.sandbox.getSelection = selectionStub('第三段', { nodeType: 1, closest: () => null })
  check('annotation: selectionchange listener wired', booted.dispatch('selectionchange', {}), true)
  await sleep(320)
  check('annotation: settled selection reopens the card', booted.runtime.getSnapshot().annotationDraft?.quote, '第三段')
}

{
  // The card waits for the release: `selectionchange` keeps firing while the
  // button is still down, and opening mid-drag would steal the caret and the
  // focus in the middle of the gesture.
  const booted = await boot({})
  booted.runtime.setQuick(true)
  booted.sandbox.getSelection = selectionStub('拖出来的原文', { nodeType: 1, closest: () => null })
  check('drag: pointerdown listener wired', booted.dispatch('pointerdown', {}), true)
  booted.dispatch('selectionchange', {})
  await sleep(320)
  check('drag: no card while the button is down', booted.runtime.getSnapshot().annotationDraft, null)
  check('drag: pointerup listener wired', booted.dispatch('pointerup', {}), true)
  booted.dispatch('selectionchange', {})
  await sleep(320)
  check('drag: settled selection opens after the release', booted.runtime.getSnapshot().annotationDraft?.quote, '拖出来的原文')
}

// --- copy: Ctrl+C keeps working while the card holds the focus -----------

{
  const booted = await boot({})
  const copied = []
  let prevented = 0
  booted.sandbox.navigator.clipboard = { writeText: (value) => (copied.push(value), Promise.resolve()) }
  booted.runtime.setQuick(true)
  booted.sandbox.getSelection = selectionStub('要复制的原文', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  check('copy: card holds the passage', booted.runtime.getSnapshot().annotationDraft?.quote, '要复制的原文')
  check(
    'copy: keydown listener wired',
    booted.dispatch('keydown', {
      key: 'c',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      preventDefault: () => (prevented += 1),
    }),
    true,
  )
  await tick()
  check('copy: ctrl+c writes the passage', copied[0], '要复制的原文')
  check('copy: ctrl+c stands in for the browser copy', prevented, 1)

  // While the caret sits in our own note field with a real selection, the
  // browser's own copy must win — that is the text the user highlighted.
  booted.sandbox.document = {
    querySelector: () => null,
    activeElement: {
      selectionStart: 0,
      selectionEnd: 3,
      closest: (selector) => (selector === '.dsh-nudge-card, .dsh-nudge-pill, .dsh-nudge-popup' ? {} : null),
    },
  }
  copied.length = 0
  prevented = 0
  booted.dispatch('keydown', {
    key: 'c',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault: () => (prevented += 1),
  })
  await tick()
  check('copy: a field selection is left to the browser', prevented, 0)
  check('copy: nothing copied over it', copied.length, 0)
}

// --- auto-paste: pending notes flow into the composer on focus -----------

{
  const booted = await boot({})
  check('auto-paste: off by default', booted.runtime.getSnapshot().autoPaste, false)
  check('auto-paste: switch accepted', booted.runtime.setAutoPaste(true), true)
  check('auto-paste: persisted', booted.localStorage.getItem('dsh-nudge:autopaste'), '1')
  booted.runtime.setQuick(true)
  booted.sandbox.getSelection = selectionStub('待粘贴的批注', { nodeType: 1, closest: () => null })
  booted.runtime.captureSelection()
  booted.runtime.addAnnotation()
  const writes = []
  booted.sandbox.document = composerFocus()
  booted.runtime.attachComposer({ readDraft: () => '', setDraft: (value) => writes.push(value) })
  await tick()
  check('auto-paste: focused composer receives the note', writes[0], '> 待粘贴的批注')
  check('auto-paste: tray emptied after pasting', booted.runtime.getSnapshot().annotations.length, 0)
  check('auto-paste: switch back off', booted.runtime.setAutoPaste(false), true)
  check('auto-paste: off clears the stored flag', booted.localStorage.getItem('dsh-nudge:autopaste'), null)
}

// --- preset order: the arrows move a row and the order survives ----------

{
  const booted = await boot({})
  const ids = () => booted.runtime.getSnapshot().presets.map((preset) => preset.id)
  check('presets: builtin order', JSON.stringify(ids()), '["brief","fast","four-line"]')
  check('presets: move down accepted', booted.runtime.movePreset('brief', 1), true)
  check('presets: order after the move', JSON.stringify(ids()), '["fast","brief","four-line"]')
  check(
    'presets: order persisted',
    JSON.stringify(JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).map((preset) => preset.id)),
    '["fast","brief","four-line"]',
  )
  check('presets: cannot move past the top', booted.runtime.movePreset('fast', -1), false)
  check('presets: cannot move past the bottom', booted.runtime.movePreset('four-line', 1), false)
  check('presets: unknown id refused', booted.runtime.movePreset('nope', 1), false)
}

// --- settings survive an update that wrote an older preset shape ---------

{
  const storage = storageStub()
  storage.setItem('dsh-nudge:presets', JSON.stringify({ presets: ['旧版快捷回复', { name: '旧名', body: '旧版正文' }] }))
  storage.setItem('dsh-nudge:ui', JSON.stringify({ collapsed: true, position: { x: 40, y: 60 } }))
  const booted = await boot({ storage })
  const state = booted.runtime.getSnapshot()
  check('update: a wrapped legacy list is still read', state.presets.length, 2)
  check('update: a bare-string entry keeps its text', state.presets[0].text, '旧版快捷回复')
  check('update: a legacy body field keeps its text', state.presets[1].text, '旧版正文')
  check('update: a legacy name field keeps its label', state.presets[1].label, '旧名')
  check(
    'update: the legacy shape is rewritten as a plain list',
    JSON.stringify(JSON.parse(booted.localStorage.getItem('dsh-nudge:presets')).map((preset) => preset.text)),
    '["旧版快捷回复","旧版正文"]',
  )
  check('update: the window position survives', state.collapsed, true)
}

// --- settings section mirrors every switch on the window -----------------

{
  const booted = await boot({})
  const Settings = booted.registrations.find((item) => item.entry.name === 'settings.section').Component
  const tree = expandTree(Settings())
  check('settings: one row per window switch', (findAllByClass(tree, 'dsh-nudge-toggle') ?? []).length, 3)
  const arrowNodes = (node) =>
    (findAllByClass(node, 'dsh-nudge-btn') ?? []).filter(
      (item) => item.children?.[0] === '↑' || item.children?.[0] === '↓',
    )
  check('settings: reorder buttons are gone', arrowNodes(tree).length, 0)
  const tipRows = findAllByClass(tree, 'dsh-nudge-tip-row') ?? []
  check('settings: one row per idle line', tipRows.length, booted.runtime.getSnapshot().tips.length)
  check(
    'settings: idle rows show the line as text',
    tipRows.every((row) => (findAllByClass(row, 'dsh-nudge-tip-name') ?? []).length === 1),
    true,
  )
  check(
    'settings: idle rows carry no field until asked',
    tipRows.reduce((sum, row) => sum + findAllByTag(row, 'input').length, 0),
    0,
  )
  check(
    'settings: idle rows keep a handle and tools',
    tipRows.every(
      (row) =>
        (findAllByClass(row, 'dsh-nudge-preset-grip') ?? []).length === 1 &&
        (findAllByClass(row, 'dsh-nudge-preset-tools') ?? []).length === 1,
    ),
    true,
  )
  const presetRows = findAllByClass(tree, 'dsh-nudge-preset-row') ?? []
  const rows = presetRows.filter((row) => row.props['data-preset-id'] !== undefined)
  check('settings: one collapsed row per preset', rows.length, 3)
  check('settings: rows start collapsed', rows.every((row) => row.props['data-open'] === 'false'), true)
  check('settings: no body while collapsed', (findAllByClass(tree, 'dsh-nudge-preset-body') ?? []).length, 0)
  check('settings: no editor until asked', (findAllByClass(tree, 'dsh-nudge-preset-editor') ?? []).length, 0)
  check(
    'settings: collapsed rows carry no field',
    rows.reduce((sum, row) => sum + findAllByTag(row, 'input').length + findAllByTag(row, 'textarea').length, 0),
    0,
  )
  check('settings: only the add form keeps fields', (findAllByClass(tree, 'dsh-nudge-preset-add') ?? []).length, 1)
  check(
    'settings: every row offers edit and delete',
    rows.reduce((sum, row) => sum + (findAllByClass(row, 'dsh-nudge-preset-tools') ?? []).length, 0),
    3,
  )
  const toolbar = findAllByClass(tree, 'dsh-nudge-preset-toolbar')[0]
  check('settings: the toolbar carries expand, collapse, import and export', (findAllByClass(toolbar, 'dsh-nudge-btn') ?? []).length, 4)
  check('settings: delivery group rendered', (findAllByClass(tree, 'dsh-nudge-settings-group') ?? []).length, 1)
  check('settings: delivery offers both modes', (findAllByClass(tree, 'dsh-nudge-chip') ?? []).length, 2)

  // Opening a row paints its read-only body; editing swaps in two fields.
  const openedId = booted.runtime.getSnapshot().presets[0].id
  booted.runtime.togglePresetOpen(openedId)
  const opened = expandTree(Settings())
  const bodies = findAllByClass(opened, 'dsh-nudge-preset-body') ?? []
  check('settings: an open row paints its body', bodies.length, 1)
  const bodyText = JSON.stringify(bodies[0]?.children ?? [])
  includes('settings: the body is the bare preset text', bodyText, booted.runtime.getSnapshot().presets[0].text.split('\n')[0])
  booted.runtime.startPresetEdit(openedId)
  const editing = expandTree(Settings())
  const editors = findAllByClass(editing, 'dsh-nudge-preset-editor') ?? []
  check('settings: editing paints one editor', editors.length, 1)
  check(
    'settings: the editor is a name field and a text field',
    findAllByTag(editors[0], 'input').length + findAllByTag(editors[0], 'textarea').length,
    2,
  )
  const textBefore = booted.runtime.getSnapshot().presets[0].text
  booted.runtime.cancelPresetEdit()
  check('settings: cancel leaves the editor', booted.runtime.getSnapshot().presetEditingId, null)
  check('settings: cancel leaves the preset text alone', booted.runtime.getSnapshot().presets[0].text, textBefore)
}

// --- idle lines share the preset chrome, one line at a time ---------------

{
  const booted = await boot({})
  const Settings = booted.registrations.find((item) => item.entry.name === 'settings.section').Component
  const before = booted.runtime.getSnapshot().tips[0]
  check('tips: editing needs an index in range', booted.runtime.startTipEdit(-1), false)
  check('tips: cancel without an editor is a no-op', booted.runtime.cancelTipEdit(), false)
  check('tips: the first line opens its editor', booted.runtime.startTipEdit(0), true)
  check('tips: the editor follows the state', booted.runtime.getSnapshot().tipEditingIndex, 0)
  const editing = expandTree(Settings())
  const rows = findAllByClass(editing, 'dsh-nudge-tip-row') ?? []
  const openRow = rows.filter((row) => findAllByTag(row, 'input').length > 0)
  check('tips: only the edited row carries a field', openRow.length, 1)
  const actions = findAllByClass(openRow[0], 'dsh-nudge-preset-actions') ?? []
  check('tips: the editor counts one field', findAllByTag(openRow[0], 'input').length, 1)
  check('tips: the editor offers save and cancel', (findAllByClass(actions[0], 'dsh-nudge-btn') ?? []).length, 2)
  check('tips: saving an edit closes the editor', booted.runtime.updateTip(0, `${before}改`), true)
  check('tips: the edit is closed after saving', booted.runtime.getSnapshot().tipEditingIndex, null)
  check('tips: the edit is persisted', booted.runtime.getSnapshot().tips[0], `${before}改`)
  check('tips: a blank line is still refused', booted.runtime.updateTip(0, '   '), false)
  check('tips: cancel drops the draft edit state', booted.runtime.cancelTipEdit(), false)

  // Drag and drop moves a line to an absolute slot and keeps the editor on it.
  const tips = [...booted.runtime.getSnapshot().tips]
  booted.runtime.startTipEdit(0)
  check('tips: move to a later slot', booted.runtime.moveTipTo(0, 1), true)
  check('tips: the line landed at index 1', booted.runtime.getSnapshot().tips[1], tips[0])
  check('tips: the editor followed the line', booted.runtime.getSnapshot().tipEditingIndex, 1)
  check('tips: a move onto itself changes nothing', booted.runtime.moveTipTo(1, 1), false)
  check('tips: an out-of-range source is refused', booted.runtime.moveTipTo(99, 0), false)
  check(
    'tips: the order is persisted',
    JSON.parse(booted.localStorage.getItem('dsh-nudge:tips'))[1],
    tips[0],
  )
  check('tips: moving back restores the order', booted.runtime.moveTipTo(1, 0), true)
  check('tips: the editor followed it back', booted.runtime.getSnapshot().tipEditingIndex, 0)
  booted.runtime.cancelTipEdit()
  check(
    'tips: removing a line before the editor shifts it up',
    (() => {
      booted.runtime.startTipEdit(2)
      booted.runtime.removeTip(0)
      return booted.runtime.getSnapshot().tipEditingIndex
    })(),
    1,
  )
}

// --- the whole annotation round trip, in the order a user runs it ---------
//   select → add → select again → add → agree / disagree → edit → delete →
//   write / send → Esc → click outside. The painted-passage click needs the
//   real CSS Custom Highlight API, so it stays a live-window check.
{
  const booted = await boot({})
  const writes = []
  booted.runtime.attachComposer({ readDraft: () => '', setDraft: (value) => writes.push(value) })
  booted.sessionsList.set({ ids: ['A'], byId: { A: { title: '会话 A', retainedBy: { mainView: 1 } } } })
  await tick()
  booted.runtime.setQuick(true)
  const plain = { nodeType: 1, closest: () => null }
  const capture = (passage) => {
    booted.sandbox.getSelection = selectionStub(passage, plain)
    return booted.runtime.captureSelection()
  }

  // 1–2. two passages in a row: the second capture must not be swallowed.
  check('chain: passage one captured', capture('引用一'), true)
  check('chain: passage one added', booted.runtime.addAnnotation(), true)
  check('chain: passage two captured', capture('引用二'), true)
  check('chain: passage two added', booted.runtime.addAnnotation(), true)
  check('chain: two annotations in the tray', booted.runtime.getSnapshot().annotations.length, 2)

  // 3. agree / disagree are annotations too.
  capture('引用三')
  check('chain: agree accepted', booted.runtime.quickReply('agree'), true)
  check('chain: agree note recorded', booted.runtime.getSnapshot().annotations[2].note, '同意')
  capture('引用四')
  check('chain: disagree accepted', booted.runtime.quickReply('disagree'), true)
  check('chain: disagree note recorded', booted.runtime.getSnapshot().annotations[3].note, '不同意')

  // 4. edit an existing annotation, then abandon a second edit.
  const first = booted.runtime.getSnapshot().annotations[0].id
  check('chain: edit opens', booted.runtime.startEditAnnotation(first), true)
  check('chain: edit targets the row', booted.runtime.getSnapshot().annotationEditingId, first)
  booted.runtime.setAnnotationNote('改过的批注')
  check('chain: edit saved', booted.runtime.saveEditedAnnotation(), true)
  check('chain: edit text stored', booted.runtime.getSnapshot().annotations[0].note, '改过的批注')
  booted.runtime.startEditAnnotation(first)
  booted.runtime.setAnnotationNote('丢掉这段')
  booted.runtime.cancelAnnotationEdit()
  check('chain: abandoned edit leaves no target', booted.runtime.getSnapshot().annotationEditingId, null)
  check('chain: abandoned edit leaves the text alone', booted.runtime.getSnapshot().annotations[0].note, '改过的批注')

  // 5. delete one.
  const second = booted.runtime.getSnapshot().annotations[1].id
  check('chain: delete accepted', booted.runtime.removeAnnotation(second), true)
  check('chain: deleted from the tray', booted.runtime.getSnapshot().annotations.length, 3)

  // 6. write the rest into the composer.
  check('chain: write accepted', booted.runtime.writeAnnotations(), true)
  check('chain: one draft written', writes.length, 1)
  check('chain: draft keeps the surviving passages', writes[0].includes('引用一') && writes[0].includes('不同意'), true)
  check('chain: draft carries the edited note', writes[0].includes('改过的批注'), true)
  check('chain: tray emptied after write', booted.runtime.getSnapshot().annotations.length, 0)

  // 7. send one, straight away.
  check('chain: send passage captured', capture('引用五'), true)
  booted.runtime.addAnnotation()
  check('chain: send accepted', booted.runtime.sendAnnotations(), true)
  check('chain: one prompt delivered', booted.calls.prompt.length, 1)
  check('chain: prompt carries the passage', booted.calls.prompt[0].request.content[0].text.includes('引用五'), true)
  check('chain: tray emptied after send', booted.runtime.getSnapshot().annotations.length, 0)
  check('chain: waiting after send', booted.runtime.getSnapshot().phase, 'waiting')

  // 8. Esc closes the card.
  capture('Esc 前的引用')
  let prevented = 0
  booted.dispatch('keydown', { key: 'Escape', preventDefault: () => (prevented += 1) })
  check('chain: Esc closes the card', booted.runtime.getSnapshot().annotationDraft, null)
  check('chain: Esc is consumed', prevented, 1)

  // 9. a click outside closes it; a click on our own card does not.
  capture('点外前的引用')
  booted.dispatch('pointerdown', { target: { closest: () => null } })
  check('chain: outside click closes the card', booted.runtime.getSnapshot().annotationDraft, null)
  capture('点卡片时的引用')
  booted.dispatch('pointerdown', { target: { closest: (selector) => (selector ? {} : null) } })
  check('chain: click on the card keeps it open', booted.runtime.getSnapshot().annotationDraft?.quote, '点卡片时的引用')
}

// --- the status row is a permanent bar, not a transient line --------------

{
  const booted = await boot({})
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const idle = findByClass(View(), 'dsh-nudge-flash')
  check('status bar is mounted while idle', Boolean(idle), true)
  check('status bar shows an idle line while idle', typeof idle?.children?.[0], 'string')
  check('status bar idle line is not empty', (idle?.children?.[0] ?? '').length > 0, true)
  check(
    'status bar keeps a fixed line box (toggling cannot resize the window)',
    source.includes('.dsh-nudge-flash{margin:8px 14px 0;font-size:11.5px;line-height:1.4;min-height:16px'),
    true,
  )
  booted.runtime.setQuick(true)
  const active = findByClass(View(), 'dsh-nudge-flash')
  check('status bar shows the toggle message', typeof active?.children?.[0], 'string')
  check('status bar marks itself active', active?.props?.className, 'dsh-nudge-flash active')
  check('status bar announces politely', active?.props?.['aria-live'], 'polite')
  check(
    'status bar keeps its text to one line (a long idle line cannot wrap)',
    source.includes('white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'),
    true,
  )
  check('status bar holds a toggle message for 5 seconds', source.includes('const FLASH_HOLD_MS = 5000'), true)
  check(
    'status bar rotates a line every 5 seconds too',
    source.includes('const TIP_ROTATE_MS = FLASH_HOLD_MS'),
    true,
  )
}

// --- idle lines: rotation, editing, reset --------------------------------

{
  const booted = await boot({})
  const { runtime } = booted
  const start = runtime._debug.state().tips.slice()
  check('tips: built-in lines are loaded', start.length >= 2, true)
  runtime.advanceTip()
  check('tips: rotation moves to the next line', runtime._debug.state().tipIndex, 1)
  runtime.setQuick(true) // writes a confirmation line into the same row
  const held = runtime._debug.state().tipIndex
  check('tips: a confirmation line takes over the row', runtime._debug.state().flash.length > 0, true)
  runtime.advanceTip()
  check('tips: rotation pauses while that line is held', runtime._debug.state().tipIndex, held)
  const added = runtime.addTip('  一句自定义提示  ')
  check('tips: a line can be added', added.ok, true)
  check('tips: the added line is trimmed', runtime._debug.state().tips.at(-1), '一句自定义提示')
  check(
    'tips: the list is written to storage',
    JSON.parse(booted.localStorage.getItem('dsh-nudge:tips')).length,
    runtime._debug.state().tips.length,
  )
  check('tips: one line can be rewritten', runtime.updateTip(0, '改过的第一句'), true)
  check('tips: the rewrite is visible', runtime._debug.state().tips[0], '改过的第一句')
  check('tips: a blank line is refused', runtime.updateTip(0, '   '), false)
  check('tips: one line can be removed', runtime.removeTip(0), true)
  const beforeMove = runtime._debug.state().tips.slice(0, 2)
  check('tips: a line can be moved down', runtime.moveTip(0, 1), true)
  check('tips: the order is swapped', runtime._debug.state().tips[1], beforeMove[0])
  check('tips: the order is written to storage', JSON.parse(booted.localStorage.getItem('dsh-nudge:tips'))[1], beforeMove[0])
  check('tips: moving past the top is refused', runtime.moveTip(0, -1), false)
  const pasted = runtime.addTips('粘贴一\n粘贴二\r\n粘贴三\n\n粘贴一\n')
  check('tips: a pasted block is split into lines', pasted.added, 3)
  check('tips: the pasted lines keep their order', runtime._debug.state().tips.slice(-3).join('|'), '粘贴一|粘贴二|粘贴三')
  check('tips: a duplicate in the paste is refused', runtime.addTips('粘贴二').ok, false)
  check('tips: an empty paste is refused', runtime.addTips('  \n \n').ok, false)
  while (runtime._debug.state().tips.length > 1) runtime.removeTip(0)
  check('tips: the last line cannot be removed', runtime.removeTip(0), false)
  runtime.resetTips()
  check('tips: reset restores the built-ins', runtime._debug.state().tips[0], start[0])
  const settings = booted.registrations.find((item) => item.entry.name === 'settings.section')
  const pasteBox = findByProp(settings.Component(), 'placeholder', '整段粘贴会自动拆成一句一句；也可以手写，一行一句（Ctrl+Enter 提交）')
  check('tips: the paste box is a textarea', pasteBox?.type, 'textarea')
  check('tips: the paste box starts empty', pasteBox?.props?.value, '')
  pasteBox?.props?.onPaste?.({
    clipboardData: { getData: () => '批量一\n批量二\n批量一' },
    preventDefault() {},
  })
  check('tips: pasting a list adds its lines straight away', runtime._debug.state().tips.slice(-2).join('|'), '批量一|批量二')
}

// --- the fold arrows are gone; the titles do the folding ------------------

{
  check('no fold-arrow button is left in the bundle', source.includes('module-chevron'), false)
  const booted = await boot({})
  const View = booted.registrations.find((item) => item.entry.name === 'shell.overlay').Component
  const name = findByClass(View(), 'dsh-nudge-name')
  check('the window title is a control', name?.props?.role, 'button')
  name?.props?.onClick?.()
  check('clicking the window title folds the window', booted.runtime._debug.state().collapsed, true)
  // Dragging the bar captures the pointer, which retargets the click to the
  // bar itself: folding has to work from there too.
  booted.runtime.setCollapsed(false)
  const bar = findByClass(View(), 'dsh-nudge-title')
  bar?.props?.onClick?.({ target: bar, currentTarget: bar })
  check('clicking the title bar itself folds the window', booted.runtime._debug.state().collapsed, true)
  booted.runtime.setCollapsed(false)
  const buttonOrigin = { closest: (selector) => (selector === 'button' ? { tag: 'BUTTON' } : null) }
  bar?.props?.onClick?.({ target: buttonOrigin, currentTarget: bar })
  check('a click on a title-bar button does not fold the window', booted.runtime._debug.state().collapsed, false)
  booted.runtime.setCollapsed(false)
  const heads = findAllByClass(View(), 'dsh-nudge-module-main')
  check('both module titles are controls', heads.length, 2)
  const before = booted.runtime._debug.state().annotationExpanded
  heads[0].props.onClick()
  check(
    'clicking the annotation title folds its section',
    booted.runtime._debug.state().annotationExpanded,
    !before,
  )
}

// --- durable settings: the Host half owns the restart-proof copy ---------

/** A fetch stub for the Host route: answers the record, records every call. */
function hostStub({ store } = {}) {
  const calls = []
  const fetch = (url, init) => {
    calls.push({ url, init })
    const isRead = (init?.method ?? 'GET') === 'GET'
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(isRead ? { ok: true, store: store ?? null } : { ok: true }),
    })
  }
  return { calls, fetch }
}

{
  // A restart lands on a new loopback port, i.e. an empty `localStorage`; the
  // record the Host half kept is the only way the settings come back.
  const storage = storageStub()
  const host = hostStub({
    store: {
      version: 1,
      ui: { collapsed: true, pos: { x: 12, y: 34 } },
      delivery: 'queue',
      turbo: true,
      quick: true,
      autoPaste: true,
      preset: 'custom-9',
      presets: [{ id: 'custom-9', label: '恢复的口径', text: '恢复正文' }],
    },
  })
  const booted = await boot({ storage, fetch: host.fetch })
  await sleep(20)
  const state = booted.runtime.getSnapshot()
  check('restore: quick switch comes back', state.quick, true)
  check('restore: auto-paste switch comes back', state.autoPaste, true)
  check('restore: turbo switch comes back', state.turbo, true)
  check('restore: delivery mode comes back', booted.runtime.effectiveDelivery(), 'followup')
  check('restore: the authored preset comes back', state.presets[0]?.text, '恢复正文')
  check('restore: the chosen preset comes back', state.presetId, 'custom-9')
  check('restore: the window position comes back', state.pos?.x, 12)
  check('restore: the page storage is refilled', booted.localStorage.getItem('dsh-nudge:quick'), '1')
  check('restore: the record is read over the Host route', host.calls[0]?.url, '/dsh-nudge/store')
}

{
  // Every write is mirrored, so the next launch has something to restore.
  const storage = storageStub()
  const host = hostStub({ store: null })
  const booted = await boot({ storage, fetch: host.fetch })
  await sleep(20)
  booted.runtime.setQuick(true)
  booted.runtime.moveTo(120, 240)
  booted.runtime.saveUi()
  await sleep(400)
  const posts = host.calls.filter((call) => call.init?.method === 'POST')
  check('mirror: a burst of edits becomes one write', posts.length, 1)
  const payload = JSON.parse(posts[0]?.init?.body ?? '{}')
  check('mirror: the payload carries the switch', payload.store?.quick, true)
  check('mirror: the payload carries the window geometry', payload.store?.ui?.pos?.x, 120)
  check('mirror: the payload is versioned', payload.store?.version, 1)
  check('mirror: the write goes to the Host route', posts[0]?.url, '/dsh-nudge/store')
}

{
  // Same origin restarted: the page is fresher than the file, so the file is
  // refreshed from it instead of clobbering what the user just changed.
  const storage = storageStub()
  storage.setItem('dsh-nudge:quick', '1')
  const host = hostStub({ store: { version: 1, delivery: 'queue' } })
  const booted = await boot({ storage, fetch: host.fetch })
  await sleep(400)
  check('restart: the local record still wins', booted.runtime.getSnapshot().quick, true)
  check('restart: the delivery default is kept', booted.runtime.effectiveDelivery(), 'steer')
  check('restart: the local record is pushed up', host.calls.some((call) => call.init?.method === 'POST'), true)
}

{
  // No Host half at all (preview page, plain harness): nothing throws.
  let threw = false
  try {
    const booted = await boot({})
    booted.runtime.setQuick(true)
    await sleep(400)
  } catch (error) {
    threw = true
    console.log(`FAIL  boot without a Host half threw: ${error?.message ?? error}`)
  }
  check('no Host half: settings still work', threw, false)
}

console.log(failures === 0 ? '\nclient checks: all passed' : `\nclient checks: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
