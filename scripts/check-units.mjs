/**
 * Module-level checks for the pure part of the browser half.
 *
 * `check-client.mjs` boots the shipped bundle and drives it through the same
 * paths the window uses; that is the right level for behavior, but it can only
 * reach the functions the runtime happens to expose. These checks import the
 * modules directly, so edge cases in the normalizers, the geometry and the
 * text helpers are exercised as units — no VM, no React stub, no bundle.
 *
 * Run: node scripts/check-units.mjs
 */
import { MAX_TIP_LENGTH, MAX_TIPS, STATS_DAYS } from '../src/client/constants.js'
import { createAnnotations } from '../src/client/annotations.js'
import { createCardPlacement } from '../src/client/card-placement.js'
import { createComposerInsertion } from '../src/client/composer-insert.js'
import { createHighlights } from '../src/client/highlights.js'
import { createPopup } from '../src/client/popup.js'
import { createPresetActions } from '../src/client/preset-actions.js'
import { createQuoteWriting } from '../src/client/quote-writing.js'
import { createTipActions } from '../src/client/tip-actions.js'
import { occurrencesOf, rectDistance } from '../src/client/dom.js'
import { chipSlotAt, clamp, isPoint, rectValue } from '../src/client/geometry.js'
import {
  builtinPresets,
  normalizePresetList,
  presetListOf,
  presetOf,
  presetTextOf,
} from '../src/client/presets.js'
import { deliveryModeOf, isFrameWidth } from '../src/client/settings.js'
import { dayKey, normalizeStats, recentDayKeys } from '../src/client/stats.js'
import { builtinTips, normalizeTipList, tidyTip } from '../src/client/tips.js'

let failures = 0
let checks = 0

/** One scalar comparison; numbers, strings, booleans and undefined. */
function check(label, actual, expected) {
  checks += 1
  const ok = Object.is(actual, expected)
  if (!ok) failures += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`,
  )
}

/** One comparison for plain data: the normalizers return objects and lists. */
function same(label, actual, expected) {
  checks += 1
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  const ok = left === right
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${left}${ok ? '' : ` (expected ${right})`}`)
}

// --- geometry: clamping and snapping inputs ------------------------------

check('geometry: a value inside the range is kept', clamp(5, 0, 10), 5)
check('geometry: below the range clamps up', clamp(-1, 0, 10), 0)
check('geometry: above the range clamps down', clamp(11, 0, 10), 10)
check('geometry: swapped bounds still clamp', clamp(5, 10, 0), 5)
check('geometry: a stored point is a point', isPoint({ x: 1, y: 2 }), true)
check('geometry: a missing coordinate is not a point', isPoint({ x: 1 }), false)
check('geometry: null is not a point', isPoint(null), false)
check('geometry: a non-finite coordinate is not a point', isPoint({ x: Infinity, y: 0 }), false)
same('geometry: a DOMRect becomes plain numbers', rectValue({ left: 0, top: 0, right: 10, bottom: 20 }), {
  left: 0,
  top: 0,
  right: 10,
  bottom: 20,
  width: 10,
  height: 20,
})
same(
  'geometry: a missing width is derived from the edges',
  rectValue({ left: 0, top: 0, right: 10, bottom: 20, width: NaN }),
  { left: 0, top: 0, right: 10, bottom: 20, width: 10, height: 20 },
)
check('geometry: an unusable box reads as null', rectValue({}), null)
check('geometry: null reads as null', rectValue(null), null)

const boxes = [
  { id: 'a', left: 0, top: 0, width: 100, height: 20 },
  { id: 'b', left: 100, top: 0, width: 100, height: 20 },
]
check('chips: a pointer before the first chip asks for the first slot', chipSlotAt(boxes, null, 10, 10), 0)
check('chips: a pointer past the first chip asks for the second slot', chipSlotAt(boxes, null, 120, 10), 1)
check('chips: a pointer below every chip asks for the last slot', chipSlotAt(boxes, null, 10, 100), 2)
check('chips: the dragged chip is never a slot of its own', chipSlotAt(boxes, 'a', 151, 10), 1)

// --- presets: the legacy shapes and the normalization rules --------------

same(
  'presets: the built-in ids are stable',
  builtinPresets('zh').map((preset) => preset.id),
  ['brief', 'fast', 'four-line'],
)
check('presets: the built-in labels follow the language', builtinPresets('en')[0].label, 'Brief')
check('presets: the first non-empty text alias wins', presetTextOf({ body: '  正文  ' }), '正文')
check('presets: an entry without text has none', presetTextOf({}), '')
check('presets: a non-list falls back to the built-ins', normalizePresetList('x', 'zh').length, 3)
same('presets: an empty list stays empty', normalizePresetList([], 'zh'), [])
const legacyPresets = normalizePresetList(['线上一句', '  ', null, { text: '  正文  ', name: '  名  ' }], 'zh')
check('presets: bare strings and legacy fields are accepted', legacyPresets.length, 2)
same(
  'presets: a bare string keeps its text and derives the label',
  [legacyPresets[0].label, legacyPresets[0].text],
  ['线上一句', '线上一句'],
)
same(
  'presets: the legacy name field becomes the label',
  [legacyPresets[1].label, legacyPresets[1].text],
  ['名', '正文'],
)
check('presets: a minted id is not the text', legacyPresets[0].id !== legacyPresets[0].text, true)
check(
  'presets: a duplicated id is re-minted',
  normalizePresetList([{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }], 'zh')[1].id !== 'x',
  true,
)
check(
  'presets: the disabled flag survives normalization',
  normalizePresetList([{ text: 'a', enabled: false }], 'zh')[0].enabled,
  false,
)
same('presets: a wrapper object exposes its list', presetListOf({ presets: ['a'] }), ['a'])
check('presets: a string has no list', presetListOf('x'), undefined)
check(
  'presets: lookup by id',
  presetOf([{ id: 'a' }, { id: 'b' }], 'b')?.id,
  'b',
)

// --- tips: trimming, de-duplication and the cap -------------------------

check('tips: whitespace collapses', tidyTip('  a \n  b  '), 'a b')
check('tips: a non-string reads empty', tidyTip(null), '')
check(
  'tips: a long line is capped',
  tidyTip('x'.repeat(MAX_TIP_LENGTH + 10)).length,
  MAX_TIP_LENGTH,
)
same('tips: an empty list falls back to the built-ins', normalizeTipList([], 'zh'), builtinTips('zh'))
same(
  'tips: blanks and duplicates are dropped',
  normalizeTipList(['a', '', 'a', ' b '], 'zh'),
  ['a', 'b'],
)
check(
  'tips: the list is capped',
  normalizeTipList(
    Array.from({ length: MAX_TIPS + 5 }, (_, index) => `line-${index}`),
    'zh',
  ).length,
  MAX_TIPS,
)

// --- stats: local days and the stored counter record --------------------

check('stats: one local day key', dayKey(new Date(2026, 0, 5)), '2026-01-05')
check('stats: the year boundary stays local', dayKey(new Date(2025, 11, 31)), '2025-12-31')
same(
  'stats: the window runs oldest first',
  recentDayKeys(3, new Date(2026, 0, 1)),
  ['2025-12-30', '2025-12-31', '2026-01-01'],
)
same(
  'stats: unknown fields and zero counters are dropped',
  normalizeStats({ days: { '2026-01-01': { send: 2, insert: 0, annotation: 1, other: 9 } } }),
  { days: { '2026-01-01': { send: 2, annotation: 1 } } },
)
same('stats: a malformed day key is dropped', normalizeStats({ days: { bad: { send: 1 } } }), { days: {} })
same('stats: a non-record reads empty', normalizeStats(null), { days: {} })
same('stats: a negative counter drops the day', normalizeStats({ days: { '2026-01-01': { send: -1 } } }), {
  days: {},
})
/** `count` consecutive local days starting 2025-01-01, oldest first. */
function localDays(count) {
  const days = {}
  for (let index = 0; index < count; index += 1) days[dayKey(new Date(2025, 0, 1 + index))] = { send: 1 }
  return days
}
const longStats = normalizeStats({ days: localDays(STATS_DAYS + 1) })
check('stats: only the newest days are kept', Object.keys(longStats.days).length, STATS_DAYS)
check(
  'stats: the oldest day of the window is the one dropped',
  Object.keys(longStats.days)[0] !== dayKey(new Date(2025, 0, 1)),
  true,
)
const protoPresets = normalizeStats({ days: { '2026-01-01': { presets: JSON.parse('{"__proto__":1,"ok":2}') } } })
same('stats: a prototype key is not a prompt id', protoPresets.days['2026-01-01'].presets, { ok: 2 })

// --- settings: the two pure readers -------------------------------------

check('settings: the internal mode name is accepted', deliveryModeOf('followup'), 'followup')
check('settings: steer is accepted', deliveryModeOf('steer'), 'steer')
check('settings: the wire name is not a state value', deliveryModeOf('queue'), undefined)
check('settings: null names no mode', deliveryModeOf(null), undefined)
check('settings: a frame width is a whole choice', isFrameWidth(2), true)
check('settings: no border is a choice', isFrameWidth(0), true)
check('settings: an unlisted width is refused', isFrameWidth(4), false)
check('settings: a stringified width is refused', isFrameWidth('2'), false)

// --- dom: overlap counting and rect distance ----------------------------

same('dom: every overlapping occurrence is reported', occurrencesOf('aaaa', 'aa', 10), [0, 1, 2])
same('dom: the scan stops at the limit', occurrencesOf('aaaa', 'aa', 2), [0, 1])
same('dom: an empty needle has no occurrence', occurrencesOf('abc', '', 10), [])
check(
  'dom: distance is measured centre to centre',
  rectDistance({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }),
  10,
)


// --- composer insertion: the draft splice and the press counting ---------

{
  const state = {
    presets: [
      { id: 'p1', text: '第一条' },
      { id: 'p2', text: '第二条' },
    ],
    composerFocused: false,
    note: '',
    error: '',
  }
  const written = []
  const stats = []
  const sent = []
  let draft = ''
  const insertion = createComposerInsertion({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    text: (key) => key,
    countStat: (field, id) => stats.push([field, id]),
    deliver: (message) => {
      sent.push(message)
      return true
    },
    activePreset: () => state.presets[0],
    onFocus: () => {},
  })

  check('composer: inserting without a mounted handle is refused', insertion.insertPreset('p1'), false)
  check('composer: the refusal explains itself', state.note, 'insertUnavailable')

  insertion.attachComposer({
    readDraft: () => draft,
    setDraft: (value) => {
      draft = value
      written.push(value)
    },
  })

  check('composer: a blank draft takes the prompt alone', insertion.insertPreset('p1'), true)
  check('composer: the draft is the prompt', draft, '第一条')
  check('composer: the insert is counted once', stats.length, 1)

  check('composer: a filled draft is kept', insertion.insertPreset('p2'), true)
  check('composer: the prompt lands on its own line', draft, '第一条\n第二条')
  same('composer: the second insert is counted', stats[1], ['insert', 'p2'])

  draft = '已有内容\n'
  insertion.insertPreset('p1')
  check('composer: a trailing newline is not doubled', draft, '已有内容\n第一条')

  draft = ''
  check('composer: an unknown id is refused', insertion.insertPreset('nope'), false)

  // A double press: the reader has not caught up with the first press yet, so
  // the send has to compose the body itself and still send one whole message.
  draft = '第一条'
  stats.length = 0
  check('composer: the second press sends', insertion.sendDraft('p1'), true)
  same('composer: the sent draft is whole', sent, ['第一条'])
  check('composer: a send clears the draft', draft, '')
  same('composer: the pair counts as one send', stats, [['send', 'p1']])

  check('composer: a draft reader that lags still sends the body', (() => {
    draft = ''
    insertion.attachComposer({ readDraft: () => draft, setDraft: () => {} })
    return insertion.sendDraft('p2')
  })(), true)
  check('composer: composerHasText trims whitespace', (() => {
    insertion.attachComposer({ readDraft: () => '   ', setDraft: () => {} })
    return insertion.composerHasText()
  })(), false)
  insertion.detachComposer(undefined)
  insertion.dispose()
}


// --- preset actions: the list, its places and the paste reader -----------

{
  const state = {
    lang: 'zh',
    presets: [
      { id: 'a', label: '甲', text: '甲', enabled: true, pinned: false },
      { id: 'b', label: '乙', text: '乙', enabled: false, pinned: false },
    ],
    presetId: 'a',
    presetOpen: [],
    presetEditingId: null,
  }
  const persisted = []
  const cleared = []
  const api = createPresetActions({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    text: (key) => key,
    persistSetting: (name, value) => persisted.push([name, value]),
    clearSetting: (name) => cleared.push(name),
  })

  check('presets: pinning an unknown id is refused', api.setPresetPinned('nope', true), false)
  check('presets: pinning flips the flag', api.setPresetPinned('a', true), true)
  check('presets: the pin is written down', persisted.some(([name]) => name === 'presets'), true)
  check('presets: pinning the same value twice is a no-op', api.setPresetPinned('a', true), false)
  check('presets: unpinning is accepted', api.setPresetPinned('a', false), true)

  api.commitPresets(
    [
      { id: 'x', label: '丙', text: '丙', enabled: false },
      { id: 'y', label: '丁', text: '丁', enabled: true },
    ],
    'x',
  )
  check('presets: a disabled pick falls back to the first enabled', state.presetId, 'y')
  same(
    'presets: the stored list keeps the shape the window reads',
    state.presets.map((preset) => [preset.id, preset.enabled, preset.pinned]),
    [
      ['x', false, false],
      ['y', true, false],
    ],
  )

  const imported = api.importPresets('新的一条')
  check('presets: a pasted line is accepted', imported.ok, true)
  check('presets: the pasted line is counted', imported.added, 1)
  check('presets: the pasted line joins the list', state.presets.length, 3)

  const duplicate = api.importPresets('丙')
  check('presets: a body already in the list is skipped', duplicate.added, 0)
  check('presets: the skipped body is reported', duplicate.skipped, 1)

  check('presets: an empty paste is refused', api.importPresets('   ').error, 'importEmpty')
  check('presets: no preset sends the editor away', api.cancelPresetEdit(), false)
}


// --- idle lines: the list, the cap and the rotation ----------------------

{
  const state = {
    lang: 'zh',
    tips: ['甲', '乙'],
    tipIndex: 0,
    flash: '',
    tipEditingIndex: null,
  }
  const persisted = []
  const cleared = []
  const api = createTipActions({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    text: (key) => key,
    persistSetting: (name, value) => persisted.push([name, value]),
    clearSetting: (name) => cleared.push(name),
  })

  const appended = api.addTip('  丙  ')
  check('tips: a trimmed line is accepted', appended.ok, true)
  check('tips: the line joins the list', state.tips.join('|'), '甲|乙|丙')
  check('tips: a blank line is refused', api.addTip('   ').error, 'tipTextRequired')

  const pasted = api.addTips('甲\n\n丁\n')
  check('tips: a pasted block adds only the new lines', pasted.added, 1)
  check('tips: the duplicate is reported as skipped', pasted.skipped, 1)
  check('tips: the pasted line landed', state.tips.includes('丁'), true)

  state.tips = ['唯一']
  check('tips: the last line cannot be removed', api.removeTip(0), false)
  state.tips = ['甲', '乙']
  check('tips: a line can be removed', api.removeTip(0), true)
  check('tips: the removal is written down', persisted.some(([name]) => name === 'tips'), true)

  state.tips = ['甲', '乙', '丙']
  state.tipEditingIndex = 0
  check('tips: a line moves down', api.moveTipTo(0, 2), true)
  check('tips: the editor follows its line', state.tipEditingIndex, 2)

  state.tipIndex = 0
  state.flash = ''
  api.advanceTip()
  check('tips: the rotation takes the next line', state.tipIndex, 1)
  state.tipIndex = 2
  api.advanceTip()
  check('tips: the rotation wraps', state.tipIndex, 0)
  state.flash = '已复制'
  api.advanceTip()
  check('tips: a confirmation line holds the rotation', state.tipIndex, 0)

  api.resetTips()
  check('tips: reset clears the stored list', cleared.includes('tips'), true)
  check('tips: reset restores the built-ins', state.tips.length > 1, true)
}


// --- popup placement: the pointer, the box and the edge ------------------

{
  const state = { annotationDraft: null, annotationEditingId: null }
  const api = createPopup({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    closeAnnotationSurface: () => true,
    cancelPendingCapture: () => {},
  })

  check(
    'popup: a pointer just outside the box still counts as near',
    api.pointerNearRect({ x: 120, y: 50 }, { left: 0, top: 0, right: 100, bottom: 100 }),
    true,
  )
  check(
    'popup: a pointer far past the slack is not near',
    api.pointerNearRect({ x: 300, y: 50 }, { left: 0, top: 0, right: 100, bottom: 100 }),
    false,
  )
  check('popup: no pointer never matches a box', api.pointerNearRect(null, { left: 0, top: 0, right: 1, bottom: 1 }), false)

  // The card is placed with the viewport in hand; a stub stands in for the page.
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 800, innerHeight: 600 }
  try {
    state.annotationDraft = {
      pointer: { x: 400, y: 300 },
      rect: { left: 380, top: 290, right: 420, bottom: 310, width: 40, height: 20 },
    }
    const above = api.popupPosition()
    check('popup: a pointer far enough down opens the card upward', above.transform, 'translateY(-100%)')
    check('popup: the first button is centred on the release point', above.left, '356px')

    state.annotationDraft = { pointer: { x: 400, y: 60 }, rect: null }
    const fallback = api.popupPosition()
    check('popup: a pointer too high falls back to the parked card', fallback.transform, 'none')

    state.annotationDraft = null
    const parked = api.popupPosition()
    check('popup: with no draft the card parks at the top right', parked.left, '452px')
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}


// --- highlights: the repaint guard ---------------------------------------

{
  const state = { quick: false, annotations: [] }
  const api = createHighlights({
    getState: () => state,
    flowAnchorsChanged: () => false,
    startEditAnnotation: () => {},
    inEditable: () => false,
  })
  const timers = []
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const cleared = []
  globalThis.setTimeout = (fn) => {
    timers.push(fn)
    return 7
  }
  globalThis.clearTimeout = (id) => cleared.push(id)
  try {
    api.scheduleRepaint()
    check('highlights: nothing is scheduled while quick notes are off', timers.length, 0)

    state.quick = true
    api.scheduleRepaint()
    api.scheduleRepaint()
    check('highlights: one repaint per frame-ish task', timers.length, 1)

    api.dispose()
    check('highlights: dispose clears the pending repaint', cleared.includes(7), true)
    check('highlights: dispose is safe to repeat', (() => { api.dispose(); return true })(), true)
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }

  check('highlights: a click while quick notes are off is ignored', api.onTranscriptClick({ target: null }) === undefined, true)
}


// --- annotation text: quotes, answers and block breaks -------------------

{
  const api = createAnnotations({
    getState: () => ({ annotations: [] }),
    setState: () => {},
    text: (key) => (key === 'answerLabel' ? '我的回答：' : key),
    countStat: () => {},
    persistSetting: () => {},
    repaintHighlights: () => {},
    sessionId: () => undefined,
    recordAnchorMiss: () => {},
  })

  check('annotations: trailing whitespace is dropped', api.tidyQuote('  原文  \n'), '  原文')
  check('annotations: a non-string reads as empty', api.tidyQuote(null), '')
  check('annotations: every quote line is marked', api.quoteMarkdown('甲\n\n乙'), '> 甲\n>\n> 乙')
  check('annotations: a lone quote has no answer line', api.annotationBlock({ quote: '甲', note: '' }), '> 甲')
  check(
    'annotations: the answer sits right under its quote',
    api.annotationBlock({ quote: '甲', note: ' 是的 ' }),
    '> 甲\n我的回答：是的',
  )
  check('annotations: nothing in front of a block at the start', api.blockBreak(''), '')
  check('annotations: three newlines open a block', api.blockBreak('abc'), '\n\n\n')
  check('annotations: two existing newlines need one more', api.blockBreak('abc\n\n'), '\n')
  check('annotations: a block already open needs nothing', api.blockBreak('abc\n\n\n'), '')
}


// --- quote writing: the caret splice, the batch and the send -------------

{
  const state = {
    annotations: [{ id: 'n1', quote: '甲', note: '是的', written: false }],
    phase: 'idle',
    note: '',
    error: '',
  }
  const writes = []
  const committed = []
  const delivered = []
  let handle = { setDraft: (value) => writes.push(value), readDraft: () => '' }
  const api = createQuoteWriting({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    text: (key) => key,
    pendingAnnotations: () => state.annotations.filter((item) => item.written !== true),
    annotationsText: (list) => list.map((item) => (item.note ? `我的回答：${item.note}` : '')).join('\n\n\n'),
    tidyQuote: (value) => String(value ?? '').replace(/\s+$/, ''),
    annotationNoteLine: (item) => (item.note ? `我的回答：${item.note}` : ''),
    blockBreak: (before) => (before === '' ? '' : '\n\n\n'),
    countStat: () => {},
    deliver: (message) => {
      delivered.push(message)
      return true
    },
    composerHandle: () => handle,
    commitAnnotations: (list) => {
      committed.push(list)
      state.annotations = list
    },
  })

  check('writing: a handle without the caret face cannot splice', api.spliceAtCaret({}, 'x'), false)
  check('writing: an empty value never touches the handle', api.spliceAtCaret({}, ''), true)
  const spans = { captureInsertion: () => ({ start: 1, end: 1 }), insertText: () => true }
  check('writing: a shell with the caret face takes the text', api.spliceAtCaret(spans, 'x'), true)

  const skipped = api.writeQuotedBatch({ setDraft: () => {} }, [{ id: 'n1' }], '')
  check('writing: no quote face means no quote attempt', skipped.attempted, false)
  const sending = api.writeQuotedBatch(
    { insertQuote: () => {}, insertText: () => {}, captureInsertion: () => ({ start: 0, end: 0 }), readPhase: () => 'sending' },
    [{ id: 'n1' }],
    '',
  )
  check('writing: a sending composer is left alone', sending.attempted, false)

  check('writing: the batch reaches the draft', api.writeAnnotations(), true)
  check('writing: the payload is the answer line', writes[0], '我的回答：是的')
  check('writing: the note is marked written', state.annotations[0].written, true)

  state.annotations = [{ id: 'n2', quote: '乙', note: '乙的批注', written: false }]
  state.phase = 'waiting'
  check('writing: nothing is sent while waiting for an answer', api.sendAnnotations(), false)
  state.phase = 'idle'
  check('writing: the pending batch is sent', api.sendAnnotations(), true)
  check('writing: the sent message is the batch', delivered[0], '我的回答：乙的批注')
  check('writing: the sent note leaves the tray', state.annotations.length, 0)

  handle = undefined
  state.annotations = [{ id: 'n3', quote: '丙', note: 'x', written: false }]
  check('writing: without a composer the write is refused', api.writeAnnotations(), false)
  check('writing: the refusal explains itself', state.note, 'insertUnavailable')
}


// --- card placement: the fold anchor -------------------------------------

{
  const state = { collapsed: false, pos: { x: 100, y: 120 }, settingsOpen: true, unread: true }
  const api = createCardPlacement({
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
  })
  const previousWindow = globalThis.window
  globalThis.window = { innerWidth: 800, innerHeight: 600 }
  try {
    api.setCollapsed(true, { x: 400, y: 300 })
    check('placement: the fold collapses the card', state.collapsed, true)
    same('placement: the pill lands under the pointer', [state.pos.x, state.pos.y], [382, 282])
    same('placement: settings fold away, unread waits for the unfold', [state.settingsOpen, state.unread], [false, true])

    api.setCollapsed(false)
    check('placement: the unfold is expanded', state.collapsed, false)
    check('placement: the unfold clears the unread mark', state.unread, false)
    same('placement: the unfold returns to the stored spot', [state.pos.x, state.pos.y], [100, 88])

    api.setCollapsed(true)
    api.moveTo(40, 50)
    same('placement: a dragged pill is clamped into the viewport', [state.pos.x, state.pos.y], [40, 50])
    api.setCollapsed(false)
    same('placement: a dragged pill wins over the old anchor', [state.pos.x, state.pos.y], [40, 50])

    api.resetCardAnchor()
    check('placement: the anchor can be forgotten', state.collapsed, false)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

console.log(`\nunit checks: ${checks - failures} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
