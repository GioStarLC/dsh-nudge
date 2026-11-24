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
import { createComposerInsertion } from '../src/client/composer-insert.js'
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

console.log(`\nunit checks: ${checks - failures} passed, ${failures} failed`)
if (failures > 0) process.exit(1)
