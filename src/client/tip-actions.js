/**
 * The idle lines under the window: the list, its editing and its rotation.
 *
 * The list is a persisted setting; the state and the writer arrive injected,
 * so this module owns no storage.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { MAX_TIPS } from './constants.js'
import { builtinTips, normalizeTipList, tidyTip } from './tips.js'

    /**
     * Build the idle-line actions over one runtime.
     *
     * @param deps - getState, setState, text, persistSetting.
     * @returns every action the settings section calls.
     */
    function createTipActions(deps) {
      const { getState, setState, text, persistSetting, clearSetting } = deps

      /** Commit one idle-line list: storage, state, back to the first line. */
      function commitTips(list) {
        const next = normalizeTipList(list, getState().lang)
        persistSetting('tips', next)
        setState({ tips: next, tipIndex: 0 })
        return next
      }

      /** Replace the line at `index`; a blank line is refused. */
      function updateTip(index, value) {
        if (index < 0 || index >= getState().tips.length) return false
        const line = tidyTip(value)
        if (line === '') return false
        const next = [...getState().tips]
        next[index] = line
        commitTips(next)
        if (getState().tipEditingIndex === index) setState({ tipEditingIndex: null })
        return true
      }

      /** Switch one idle line into its editor. */
      function startTipEdit(index) {
        if (index < 0 || index >= getState().tips.length) return false
        setState({ tipEditingIndex: index })
        return true
      }

      /** Leave the idle-line editor without saving. */
      function cancelTipEdit() {
        if (getState().tipEditingIndex === null) return false
        setState({ tipEditingIndex: null })
        return true
      }

      /** Append one idle line; the list is capped. */
      function addTip(value) {
        const line = tidyTip(value)
        if (line === '') return { ok: false, error: text('tipTextRequired') }
        if (getState().tips.length >= MAX_TIPS) return { ok: false, error: text('tipLimit') }
        const next = commitTips([...getState().tips, line])
        return { ok: true, index: Math.max(0, next.indexOf(line)) }
      }

      /**
       * Append pasted text as separate lines: every line break starts a new
       * idle line, so a whole list can be pasted at once. Blank lines,
       * duplicates and overflow past MAX_TIPS are dropped.
       */
      function addTips(raw) {
        if (typeof raw !== 'string') return { ok: false, added: 0, skipped: 0, error: text('tipTextRequired') }
        const lines = []
        for (const part of raw.split(/\r\n|\r|\n/)) {
          const line = tidyTip(part)
          if (line !== '') lines.push(line)
        }
        const incoming = []
        for (const line of lines) {
          if (getState().tips.includes(line) || incoming.includes(line)) continue
          incoming.push(line)
        }
        if (incoming.length === 0) {
          return { ok: false, added: 0, skipped: lines.length, error: text('tipTextRequired') }
        }
        const room = MAX_TIPS - getState().tips.length
        if (room <= 0) return { ok: false, added: 0, skipped: lines.length, error: text('tipLimit') }
        const added = incoming.slice(0, room)
        commitTips([...getState().tips, ...added])
        return {
          ok: true,
          added: added.length,
          skipped: lines.length - added.length,
          truncated: added.length < incoming.length,
          error: '',
        }
      }

      /** Remove one idle line; the last remaining line cannot be removed. */
      function removeTip(index) {
        if (getState().tips.length <= 1) return false
        if (index < 0 || index >= getState().tips.length) return false
        const next = [...getState().tips]
        next.splice(index, 1)
        commitTips(next)
        const editing = getState().tipEditingIndex
        if (editing === index) setState({ tipEditingIndex: null })
        else if (editing !== null && editing > index) setState({ tipEditingIndex: editing - 1 })
        return true
      }

      /** Move one idle line up (`delta` -1) or down (+1); order is persisted. */
      function moveTip(index, delta) {
        const count = getState().tips.length
        const to = index + (delta < 0 ? -1 : 1)
        if (index < 0 || index >= count || to < 0 || to >= count) return false
        return moveTipTo(index, to)
      }

      /** Move one idle line to an absolute slot (drag and drop). */
      function moveTipTo(from, index) {
        const count = getState().tips.length
        const target = Math.round(Number(index))
        if (!Number.isFinite(target) || from < 0 || from >= count) return false
        const to = Math.max(0, Math.min(count - 1, target))
        if (to === from) return false
        const next = [...getState().tips]
        const [line] = next.splice(from, 1)
        next.splice(to, 0, line)
        // The editor is keyed by position, so it has to move with its line:
        // the moved line lands on `to`, and every line between the two slots
        // shifts one step toward `from`. Missing the middle case leaves the
        // editor on a neighbour, and a save would overwrite that neighbour.
        const editing = getState().tipEditingIndex
        let editingNext = editing
        if (editing === from) editingNext = to
        else if (editing !== null && from < to && editing > from && editing <= to) editingNext = editing - 1
        else if (editing !== null && from > to && editing >= to && editing < from) editingNext = editing + 1
        commitTips(next)
        if (editingNext !== editing) setState({ tipEditingIndex: editingNext })
        return true
      }

      /** Restore the built-in idle lines. */
      function resetTips() {
        clearSetting('tips')
        setState({ tips: builtinTips(getState().lang), tipIndex: 0 })
      }

      /** Show the next idle line; the status row calls this on a timer. */
      function advanceTip() {
        const count = getState().tips.length
        if (count < 2) return
        // A confirmation line owns the row for its full hold, then the
        // rotation picks up again with the next line.
        if (getState().flash.length > 0) return
        setState({ tipIndex: (getState().tipIndex + 1) % count })
      }

      // --- window state ---------------------------------------------------

      return {
        commitTips,
        updateTip,
        startTipEdit,
        cancelTipEdit,
        addTip,
        addTips,
        removeTip,
        moveTip,
        moveTipTo,
        resetTips,
        advanceTip,
      }
    }

export { createTipActions }
