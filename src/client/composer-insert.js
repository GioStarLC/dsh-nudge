/**
 * Writing into the composer: the mounted bridge, the draft splice and the
 * pinned-prompt presses.
 *
 * The window never touches the editor DOM. It holds the handle the input
 * bridge hands over (`setDraft`/`readDraft`), appends a prompt on its own line
 * and — on a double press — sends the draft the first press composed.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { presetOf } from './presets.js'

    /**
     * Build the composer side of the runtime.
     *
     * Every collaborator is injected: the state is read through `getState`,
     * prompts come from `activePreset`/`state.presets`, and the effects that
     * belong to the window (toast text, counters, delivery, auto-paste) stay
     * callbacks, so this module has no DOM and no store of its own.
     *
     * @param deps - getState, setState, text, countStat, deliver, activePreset, onFocus.
     * @returns the composer handle surface and the three insertion entry points.
     */
    function createComposerInsertion(deps) {
      const { getState, setState, text, countStat, deliver, activePreset, onFocus } = deps

      /** The mounted composer bridge, when a conversation input is on screen. */
      let composer
      /**
       * A bar press counts its insert only when no second press follows: the
       * pair is one send, not an insert plus a send.
       */
      let barInsertTimer
      let barInsertId = ''

      /** The focused composer editor element, when the caret is inside it. */
      function composerNode() {
        try {
          const active = /** @type {HTMLElement | null} */ (document.activeElement)
          if (!active) return undefined
          const editable =
            active.isContentEditable === true ||
            active.getAttribute?.('contenteditable') === 'true'
          if (!editable) return undefined
          // The DSH composer editor marks itself `data-composer-input`; Lexical
          // marks its root too, and the slot host covers older shells.
          if (typeof active.hasAttribute === 'function' && active.hasAttribute('data-composer-input')) return active
          if (active.getAttribute?.('data-lexical-editor') === 'true') return active
          if (typeof active.closest === 'function' && active.closest('[data-slot="conversation.composer"]')) {
            return active
          }
          return undefined
        } catch {
          return undefined
        }
      }

      /** Write mode is available only while a composer is mounted and focused. */
      function canInsert() {
        return composer !== undefined && composerNode() !== undefined
      }

      /** Keep the visible mode flag (the primary button label) in sync with focus. */
      function syncComposerFocus() {
        const focused = canInsert()
        if (focused === getState().composerFocused) return
        setState({ composerFocused: focused })
        if (focused && typeof onFocus === 'function') onFocus()
      }

      /**
       * Attach the live composer handle handed over by the input bridge.
       * `sync: false` stores it without a store update, for React's render
       * phase; the bridge's effect then attaches with the focus refresh.
       */
      function attachComposer(handle, sync = true) {
        composer = handle
        if (sync) syncComposerFocus()
      }

      /** Detach only when the released handle is still the mounted one. */
      function detachComposer(handle) {
        if (composer !== handle) return
        composer = undefined
        syncComposerFocus()
      }

      /** Whether the mounted composer already holds text. */
      function composerHasText() {
        if (composer === undefined) return false
        try {
          const draft = composer.readDraft?.()
          return typeof draft === 'string' && draft.trim() !== ''
        } catch {
          return false
        }
      }

      /**
       * Append the selected preset to the composer draft instead of sending it.
       * The caret ends up past the written text; existing content is kept and
       * separated by one newline (a blank draft gets no leading newline).
       */
      function insertPreset(id, count = true) {
        const handle = composer
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        const preset = id === undefined ? activePreset() : presetOf(getState().presets, id)
        if (!preset) return false
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        const next =
          draft.trim() === ''
            ? preset.text
            : `${draft}${draft.endsWith('\n') ? '' : '\n'}${preset.text}`
        try {
          handle.setDraft(next)
        } catch (error) {
          console.warn('[dsh-nudge] composer insert failed', error)
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        setState({ note: '', error: '' })
        if (count === true) countStat('insert', preset.id)
        return true
      }

      /**
       * A single press on a pinned prompt: append it now, and count the insert
       * only if the press is not followed by the second half of a double click.
       */
      function appendPrompt(id) {
        if (barInsertTimer !== undefined) {
          clearTimeout(barInsertTimer)
          barInsertTimer = undefined
          if (barInsertId !== '') countStat('insert', barInsertId)
          barInsertId = ''
        }
        if (!insertPreset(id, false)) return false
        barInsertId = id
        barInsertTimer = setTimeout(() => {
          barInsertTimer = undefined
          const pending = barInsertId
          barInsertId = ''
          if (pending !== '') countStat('insert', pending)
        }, 260)
        return true
      }

      /**
       * A double press on a pinned prompt: send the draft the first press
       * composed. That press's insert count is dropped, so the pair counts as
       * one send; a failed send keeps the draft as it was.
       */
      function sendDraft(id) {
        const handle = composer
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        if (barInsertTimer !== undefined) {
          clearTimeout(barInsertTimer)
          barInsertTimer = undefined
          barInsertId = ''
        }
        const preset = presetOf(getState().presets, id)
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        const body = preset?.text ?? ''
        // The first press writes through the shell's input store; if that write
        // has not reached the reader yet, compose it here so the send is whole.
        if (body !== '' && !draft.replace(/\s+$/, '').endsWith(body.trim())) {
          draft = draft.trim() === '' ? body : `${draft}${draft.endsWith('\n') ? '' : '\n'}${body}`
        }
        if (draft.trim() === '') return false
        if (!deliver(draft)) return false
        try {
          handle.setDraft('')
        } catch {
          /* the text stays if the shell refuses the clear */
        }
        countStat('send', id)
        return true
      }

      /** The live handle, for the batch writer that needs the same action face. */
      function composerHandle() {
        return composer
      }

      /** Drop the pending double-press timer when the runtime goes away. */
      function dispose() {
        if (barInsertTimer === undefined) return
        clearTimeout(barInsertTimer)
        barInsertTimer = undefined
        barInsertId = ''
      }

      return {
        composerNode,
        canInsert,
        syncComposerFocus,
        attachComposer,
        detachComposer,
        composerHasText,
        composerHandle,
        insertPreset,
        appendPrompt,
        sendDraft,
        dispose,
      }
    }

export { createComposerInsertion }
