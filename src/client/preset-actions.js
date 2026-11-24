/**
 * The prompt list: CRUD, order, the two places and the in-window forms.
 *
 * Everything here edits the persisted preset list; the state and the settings
 * store arrive injected, so the module owns no storage and no DOM.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { DEFAULT_PRESET, IDLE_NUDGE_EDIT } from './constants.js'
import { builtinPresets, mintPresetId, normalizePresetList, presetOf } from './presets.js'

    /**
     * Build the preset actions over one runtime.
     *
     * @param deps - getState, setState, text, persistSetting, clearSetting.
     * @returns every action the window and the settings section call.
     */
    function createPresetActions(deps) {
      const { getState, setState, text, persistSetting, clearSetting } = deps

      /** Store one preset list, keeping the selection on an enabled preset. */
      function commitPresets(next, preferredId) {
        const list = normalizePresetList(next, getState().lang)
        persistSetting('presets', list)
        let presetId = preferredId ?? getState().presetId
        const chosen = presetOf(list, presetId)
        if (chosen === undefined || chosen.enabled === false) {
          presetId = list.find((preset) => preset.enabled !== false)?.id ?? list[0]?.id ?? DEFAULT_PRESET
        }
        persistSetting('preset', presetId)
        setState({ presets: list, presetId })
      }

      /** Add one user preset; returns the new id, or an error text. */
      function addPreset(label, body) {
        const value = typeof body === 'string' ? body.trim() : ''
        if (value.length === 0) return { ok: false, error: text('presetTextRequired') }
        const preset = {
          id: mintPresetId(),
          label: typeof label === 'string' && label.trim().length > 0 ? label.trim() : value.slice(0, 8),
          text: value,
          enabled: true,
        }
        commitPresets([...getState().presets, preset], preset.id)
        return { ok: true, id: preset.id }
      }

      /** Update one preset's label/text; empty text is refused. */
      function updatePreset(id, patch) {
        const current = presetOf(getState().presets, id)
        if (current === undefined) return { ok: false, error: text('presetTextRequired') }
        const value = patch && typeof patch.text === 'string' ? patch.text.trim() : current.text
        if (value.length === 0) return { ok: false, error: text('presetTextRequired') }
        const label =
          patch && typeof patch.label === 'string'
            ? patch.label.trim().length > 0
              ? patch.label.trim()
              : value.slice(0, 8)
            : current.label
        commitPresets(
          getState().presets.map((preset) =>
            preset.id === id
              ? { ...preset, id, label, text: value, enabled: preset.enabled !== false }
              : preset,
          ),
          getState().presetId,
        )
        if (getState().presetEditingId === id) setState({ presetEditingId: null })
        return { ok: true }
      }

      /** Remove one preset; the list may legitimately become empty. */
      function removePreset(id) {
        const next = getState().presets.filter((preset) => preset.id !== id)
        if (next.length === getState().presets.length) return false
        commitPresets(next, getState().presetId === id ? next[0]?.id : getState().presetId)
        setState({
          presetEditingId: getState().presetEditingId === id ? null : getState().presetEditingId,
          presetOpen: getState().presetOpen.filter((open) => open !== id),
        })
        return true
      }

      /**
       * Enable or disable one preset. Disabled presets stay in settings but
       * leave the window's prompt row, so the row only carries live prompts.
       */
      function setPresetEnabled(id, value) {
        const current = presetOf(getState().presets, id)
        if (current === undefined) return false
        const enabled = value === true
        if ((current.enabled !== false) === enabled) return false
        commitPresets(
          getState().presets.map((preset) => (preset.id === id ? { ...preset, enabled } : preset)),
          getState().presetId,
        )
        return true
      }

      /**
       * Pin or unpin one preset on the composer's own left row. Disabled
       * presets can stay pinned in the record but never render there.
       */
      function setPresetPinned(id, value) {
        const current = presetOf(getState().presets, id)
        if (current === undefined) return false
        const pinned = value === true
        if ((current.pinned === true) === pinned) return false
        commitPresets(
          getState().presets.map((preset) => (preset.id === id ? { ...preset, pinned } : preset)),
          getState().presetId,
        )
        return true
      }

      /** Flip one preset between enabled and disabled. */
      function togglePresetEnabled(id) {
        const current = presetOf(getState().presets, id)
        if (current === undefined) return false
        return setPresetEnabled(id, current.enabled === false)
      }

      /** Move one preset one slot up (`delta` -1) or down (+1); order persists. */
      function movePreset(id, delta) {
        const from = getState().presets.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const step = delta < 0 ? -1 : 1
        const to = from + step
        if (to < 0 || to >= getState().presets.length) return false
        const next = [...getState().presets]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        commitPresets(next, getState().presetId)
        return true
      }

      /** Move one preset to an absolute slot (drag and drop); order persists. */
      function movePresetTo(id, index) {
        const from = getState().presets.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const target = Math.round(Number(index))
        if (!Number.isFinite(target)) return false
        const to = Math.max(0, Math.min(getState().presets.length - 1, target))
        if (to === from) return false
        const next = [...getState().presets]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        commitPresets(next, getState().presetId)
        return true
      }

      /**
       * Move one preset next to another (window drag): before it, or after it.
       * Anchoring on the neighbour rather than on an index keeps the disabled
       * entries — which never appear in the window — in their own slots.
       */
      function movePresetBeside(id, anchorId, after) {
        if (id === anchorId) return false
        const list = getState().presets
        const from = list.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const next = list.filter((preset) => preset.id !== id)
        const anchor = next.findIndex((preset) => preset.id === anchorId)
        if (anchor < 0) return false
        next.splice(anchor + (after === true ? 1 : 0), 0, list[from])
        if (next.every((preset, index) => preset.id === list[index].id)) return false
        commitPresets(next, getState().presetId)
        return true
      }

      /** Open or close one preset body in the settings list. */
      function togglePresetOpen(id) {
        if (presetOf(getState().presets, id) === undefined) return false
        const open = getState().presetOpen.includes(id)
          ? getState().presetOpen.filter((item) => item !== id)
          : [...getState().presetOpen, id]
        setState({ presetOpen: open })
        return true
      }

      /** Open every preset body, or close them all. */
      function setPresetsOpen(open) {
        setState({ presetOpen: open ? getState().presets.map((preset) => preset.id) : [] })
        return true
      }

      /** Switch one preset into the editor (only one editor is open at a time). */
      function startPresetEdit(id) {
        if (presetOf(getState().presets, id) === undefined) return false
        setState({ presetEditingId: id })
        return true
      }

      /** Leave the editor without saving. */
      function cancelPresetEdit() {
        if (getState().presetEditingId === null) return false
        setState({ presetEditingId: null })
        return true
      }

      /** Open the in-window "new prompt" form (title + body). */
      function startNudgeDraft() {
        setState({
          nudgeExpanded: true,
          nudgeDraftOpen: true,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
          ...IDLE_NUDGE_EDIT,
        })
        return true
      }

      /** Close the in-window form without saving. */
      function cancelNudgeDraft() {
        if (getState().nudgeDraftOpen !== true) return false
        setState({ nudgeDraftOpen: false, nudgeDraftLabel: '', nudgeDraftText: '', nudgeDraftError: '' })
        return true
      }

      /** Write the draft title without saving it. */
      function setNudgeDraftLabel(value) {
        setState({ nudgeDraftLabel: typeof value === 'string' ? value : '' })
      }

      /** Write the draft body without saving it. */
      function setNudgeDraftText(value) {
        setState({ nudgeDraftText: typeof value === 'string' ? value : '' })
      }

      /** Save the in-window form through the same preset store the settings use. */
      function saveNudgeDraft() {
        const result = addPreset(getState().nudgeDraftLabel, getState().nudgeDraftText)
        if (result.ok !== true) {
          setState({ nudgeDraftError: result.error })
          return result
        }
        setState({ nudgeDraftOpen: false, nudgeDraftLabel: '', nudgeDraftText: '', nudgeDraftError: '' })
        return result
      }

      /**
       * Arm or leave the window's direct-edit mode. The same row that adds a
       * quick input then lets each one be dragged and edited in place, so fixing
       * an entry no longer means walking into the settings page.
       */
      function setNudgeEditing(value) {
        const next = value === true
        if (next === (getState().nudgeEditing === true)) return false
        setState({
          ...IDLE_NUDGE_EDIT,
          nudgeEditing: next,
          nudgeExpanded: next ? true : getState().nudgeExpanded,
          nudgeDraftOpen: false,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
        })
        return true
      }

      /** Open one quick input in the window's own editor, pre-filled. */
      function startNudgeEdit(id) {
        const preset = presetOf(getState().presets, id)
        if (preset === undefined || preset.enabled === false) return false
        setState({
          ...IDLE_NUDGE_EDIT,
          nudgeExpanded: true,
          nudgeEditing: true,
          nudgeDraftOpen: false,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
          nudgeEditId: preset.id,
          nudgeEditLabel: preset.label,
          nudgeEditText: preset.text,
        })
        return true
      }

      /** Close the window's editor without saving. */
      function cancelNudgeEdit() {
        if (getState().nudgeEditId === null) return false
        setState({ nudgeEditId: null, nudgeEditLabel: '', nudgeEditText: '', nudgeEditError: '' })
        return true
      }

      /** Write the editor's title without saving it. */
      function setNudgeEditLabel(value) {
        setState({ nudgeEditLabel: typeof value === 'string' ? value : '' })
      }

      /** Write the editor's body without saving it. */
      function setNudgeEditText(value) {
        setState({ nudgeEditText: typeof value === 'string' ? value : '' })
      }

      /** Save the window's editor through the same preset store the settings use. */
      function saveNudgeEdit() {
        if (getState().nudgeEditId === null) return { ok: false, error: text('presetTextRequired') }
        const result = updatePreset(getState().nudgeEditId, {
          label: getState().nudgeEditLabel,
          text: getState().nudgeEditText,
        })
        if (result.ok !== true) {
          setState({ nudgeEditError: result.error })
          return result
        }
        setState({ nudgeEditId: null, nudgeEditLabel: '', nudgeEditText: '', nudgeEditError: '' })
        return result
      }

      /** One pasted block: the first line is the label, the rest is the body. */
      function presetFromBlock(block) {
        const lines = block.split('\n')
        const label = lines[0].trim()
        const text = lines.slice(1).join('\n').trim()
        return { label, text: text.length > 0 ? text : label }
      }

      /**
       * Bulk-add pasted presets: blocks are separated by three or more blank
       * lines. Mirrors `addTips` — dedupe by body and report what was skipped.
       */
      function importPresets(raw) {
        const blocks = String(raw ?? '')
          .replace(/\r\n/g, '\n')
          .split(/\n(?:[ \t]*\n){3,}/)
          .map((block) => block.trim())
          .filter((block) => block.length > 0)
        if (blocks.length === 0) return { ok: false, added: 0, skipped: 0, error: text('importEmpty') }
        const seen = new Set(getState().presets.map((preset) => preset.text))
        const next = [...getState().presets]
        let added = 0
        let skipped = 0
        for (const block of blocks) {
          const preset = presetFromBlock(block)
          if (preset.text.length === 0 || seen.has(preset.text)) {
            skipped += 1
            continue
          }
          seen.add(preset.text)
          next.push({ id: mintPresetId(), label: preset.label, text: preset.text, enabled: true })
          added += 1
        }
        if (added === 0) {
          return { ok: false, added, skipped, error: text('importEmpty') }
        }
        commitPresets(next, getState().presetId)
        return { ok: true, added, skipped }
      }

      /**
       * Copy every configured preset to the clipboard in the same block format
       * `importPresets` reads, so an export can be pasted back. Disabled
       * presets are included: they are configured, just not shown in the
       * window. The clipboard is async, so the outcome resolves.
       */
      function exportPresets() {
        const count = getState().presets.length
        if (count === 0) return Promise.resolve({ ok: false, count, error: text('exportEmpty') })
        const value = getState().presets
          .map((preset) =>
            preset.label === preset.text ? preset.label : `${preset.label}\n${preset.text}`,
          )
          .join('\n\n\n\n')
        try {
          const clipboard = navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') {
            return Promise.resolve({ ok: false, count, error: text('exportFailed') })
          }
          return Promise.resolve(clipboard.writeText(value)).then(
            () => ({ ok: true, count }),
            () => ({ ok: false, count, error: text('exportFailed') }),
          )
        } catch {
          return Promise.resolve({ ok: false, count, error: text('exportFailed') })
        }
      }

      /** Restore the built-in presets (and forget the settings storage). */
      function resetPresets() {
        clearSetting('presets')
        commitPresets(builtinPresets(getState().lang), DEFAULT_PRESET)
        setState({ presetOpen: [], presetEditingId: null })
      }

      return {
        commitPresets,
        addPreset,
        updatePreset,
        removePreset,
        setPresetEnabled,
        setPresetPinned,
        togglePresetEnabled,
        movePreset,
        movePresetTo,
        movePresetBeside,
        togglePresetOpen,
        setPresetsOpen,
        startPresetEdit,
        cancelPresetEdit,
        startNudgeDraft,
        cancelNudgeDraft,
        setNudgeDraftLabel,
        setNudgeDraftText,
        saveNudgeDraft,
        setNudgeEditing,
        startNudgeEdit,
        cancelNudgeEdit,
        setNudgeEditLabel,
        setNudgeEditText,
        saveNudgeEdit,
        presetFromBlock,
        importPresets,
        exportPresets,
        resetPresets,
      }
    }

export { createPresetActions }
