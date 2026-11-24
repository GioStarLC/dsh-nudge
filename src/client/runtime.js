/**
 * The window state machine.
 *
 * Delivery, the wait for an answer, annotations, settings, counters and the debug surface.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANCHOR_SELECTOR, ANSWER_HIGHLIGHT, IDLE_NUDGE_EDIT, CAPTURE_HIGHLIGHT, CONTEXT_CHARS, DEFAULT_DELIVERY, DEFAULT_PRESET, DIAG_SAMPLES, FLASH_HOLD_MS, HIGHLIGHT_NAME, MAX_STAT_PRESET_ID, MAX_TIPS, MISS_RESCAN_MS, PILL_SIZE, SELF_SELECTOR, UI_KEY } from './constants.js'
import { readLang, resolveTarget, statusOf } from './context.js'
import { CSS } from './css.js'
import { createComposerInsertion } from './composer-insert.js'
import { createDelivery } from './delivery.js'
import { createPopup } from './popup.js'
import { createPresetActions } from './preset-actions.js'
import { createTipActions } from './tip-actions.js'
import { anchorFromQuote, anchorFromRange, locateAnchor, packedMapOf, packedText, passagesOfRange, rangeFromPacked, sameRanges } from './dom.js'
import { chipSlotAt, clampPoint, dockPosition, isPoint, rectValue, snapToEdge, viewport } from './geometry.js'
import { EN, ZH } from './locale.js'
import { notesOfSession, saveNotesOfSession } from './notes.js'
import { builtinPresets, mintPresetId, normalizePresetList, presetOf } from './presets.js'
import { SETTINGS, adoptFromHost, applySettingsStore, clearSetting, commitSettingsToHost, flushSettingsMirror, frameLabelKey, hasStoredSettings, isDelivery, isFrameWidth, loadStoreFromHost, markSettingsDirty, markSettingsRead, markSettingsSynced, persistSetting, readSettings, settingsSnapshot } from './settings.js'
import { STAT_FIELDS, dayKey, normalizeStats } from './stats.js'
import { readJson, storage, writeJson } from './storage.js'
import { builtinTips, normalizeTipList, tidyTip } from './tips.js'

    /**
     * Build the window runtime.
     *
     * The view is a thin renderer over this object; the checks drive the same
     * object without a browser renderer.
     * @param ctx - plugin context.
     * @returns the runtime handle.
     */
    function createRuntime(ctx) {
      const saved = readJson(UI_KEY) ?? {}
      const language = readLang(ctx)
      const initialTarget = resolveTarget(ctx)
      // Every persisted preference comes from the settings table, so the launch
      // state and a later restore cannot drift apart.
      // The settings table owns which fields exist; the reader fills every row.
      const savedSettings = /** @type {NudgeSettingsState} */ (
        readSettings({ lang: language, sessionId: initialTarget?.sessionId })
      )

      /**
       * The annotation surface at rest: no draft, nothing stowed, no editor, no
       * half-typed note. The launch state and every closing transition spread
       * this instead of listing the fields again, so a field added to the
       * surface is reset in one place.
       */
      const IDLE_ANNOTATION = {
        annotationDraft: null,
        annotationCardHidden: false,
        annotationNote: '',
        annotationEditingId: null,
        annotationEditRect: null,
      }
      /** @type {NudgeRuntimeState} */
      let state = {
        phase: 'idle',
        note: '',
        error: '',
        /** Short-lived confirmation of a toggle, cleared on a timer. */
        flash: '',
        lastAt: undefined,
        lastSessionId: undefined,
        unread: false,
        // Every launch starts as the pill: the window is a reminder to look at
        // the conversation, not a panel to close first.
        collapsed: true,
        // One anchor for both shapes: collapsing keeps the window in place and
        // expanding returns it to the same spot. The stored record only says
        // how far down it sat and which side it was on.
        pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        /**
         * Every persisted preference — the three switches, the delivery mode,
         * the border width, the prompts and the chosen one, the idle lines, the
         * counters and the collected notes — arrives from the settings table by
         * field name, so the launch state cannot miss a row.
         */
        ...savedSettings,
        /** Ids whose body is expanded in the settings list. */
        presetOpen: [],
        /** The preset opened in the settings editor, or null. */
        presetEditingId: null,
        target: initialTarget,
        pendingQuestion: false,
        /** True while the conversation composer is mounted and holds the caret. */
        composerFocused: false,
        /** Which idle line is showing; not persisted, so the launch restarts at the first. */
        tipIndex: 0,
        /** The idle line opened in its editor, or null. */
        tipEditingIndex: null,
        /**
         * The annotation surface: the selection being annotated, whether its
         * card is stowed, the note being written, and the collected note opened
         * in the editor. A card and an editor never coexist.
         */
        ...IDLE_ANNOTATION,
        /** Whether the annotation module shows its body (row summary when false). */
        annotationExpanded: false,
        /** Whether the nudge module (prompts / mode / primary) shows its body. */
        nudgeExpanded: true,
        /** The in-window "new prompt" form (title + body). */
        nudgeDraftOpen: false,
        nudgeDraftLabel: '',
        nudgeDraftText: '',
        nudgeDraftError: '',
        ...IDLE_NUDGE_EDIT,
        /** Whether the window shows the settings form in place of its body. */
        settingsOpen: false,
        /** Timestamp of the last capture, used to restart the attention pulse. */
        attentionAt: 0,
        /** The window control whose explanation bubble is showing, or null. */
        tip: null,
        lang: language,
      }
      const listeners = new Set()
      /** One immutable snapshot per change, as `useSyncExternalStore` requires. */
      function getSnapshot() {
        return state
      }

      /**
       * Replace state and notify every renderer.
       * @param {Partial<NudgeRuntimeState>} patch
       */
      function setState(patch) {
        let changed = false
        for (const key of Object.keys(patch)) {
          if (!Object.is(state[key], patch[key])) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = { ...state, ...patch }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.warn('[dsh-nudge] listener failed', error)
          }
        }
      }

      /** Subscribe one renderer. */
      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      /** Visible text for the current locale. */
      function text(key) {
        const dict = state.lang === 'zh' ? ZH : EN
        return dict[key] ?? key
      }

      // --- delivery -------------------------------------------------------

      const delivery = createDelivery({
        ctx,
        getState: () => state,
        setState,
        text,
      })

      /** Deliver one message into the on-screen session. */
      function deliver(message) {
        return delivery.deliver(message)
      }

      /** End the in-flight wait; the delivery module owns its timers and watch. */
      function endWaiting() {
        delivery.endWaiting()
      }

      // --- composer insertion ---------------------------------------------

      /**
       * The mounted composer bridge and the draft splice. The module owns the
       * handle, the double-press counter and the write path; the runtime keeps
       * the side effects it needs: toast text, counters, delivery and the
       * auto-paste handoff on focus.
       */
      const insertion = createComposerInsertion({
        getState: () => state,
        setState,
        text,
        countStat,
        deliver,
        activePreset,
        onFocus: () => {
          // Auto-paste: the moment the caret lands in the composer, hand the
          // pending notes over and empty the tray. A failed write keeps them.
          if (state.autoPaste === true && state.annotations.length > 0) writeAnnotations()
        },
      })
      const {
        attachComposer,
        detachComposer,
        syncComposerFocus,
        canInsert,
        composerHasText,
        composerHandle,
        insertPreset,
        appendPrompt,
        sendDraft,
      } = insertion

      // --- annotations ----------------------------------------------------

      /** A field being edited, a modal, and this window are never quoted. */
      const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [data-shortcut-modal]'

      /** Trim only the trailing whitespace a selection picks up. */
      function tidyQuote(value) {
        return String(value ?? '').replace(/\s+$/, '')
      }

      /**
       * One passage as the Markdown blockquote the shell serializes a quote
       * node to; text copied out of the composer keeps this form.
       */
      function quoteMarkdown(value) {
        const lines = tidyQuote(value).split('\n')
        return lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
      }

      /** The answer line under a passage, or '' when the passage stands alone. */
      function annotationNoteLine(item) {
        const note = typeof item.note === 'string' ? item.note.trim() : ''
        return note === '' ? '' : `${text('answerLabel')}${note}`
      }

      /**
       * One annotation as the Markdown block it becomes when it is sent: the
       * quote on its own lines, the answer on the line right below it.
       */
      function annotationBlock(item) {
        const quoted = quoteMarkdown(item.quote)
        const note = annotationNoteLine(item)
        return note === '' ? quoted : `${quoted}\n${note}`
      }

      /** The annotations still waiting to be written into a message. */
      function pendingAnnotations() {
        return state.annotations.filter((item) => item.written !== true)
      }

      // --- the annotation lifecycle ---------------------------------------
      //
      // Three surfaces share one state: the selection card (a draft), the
      // in-place editor (one stored note) and the tray (the Session's notes). A
      // card and an editor never coexist, and every path that ends one of them
      // returns the same fields to rest — so the resting surface is written
      // down once here, and a tray change is persisted and repainted in one
      // step, instead of each transition spelling out its own subset.

      /** One surface change: show it, then repaint the marks it implies. */
      function settleAnnotation(patch) {
        setState(patch)
        repaintHighlights()
      }

      /** Return the surface to rest; the tray list is left as it is. */
      function closeAnnotationSurface(extra) {
        settleAnnotation({ ...IDLE_ANNOTATION, ...(extra ?? {}) })
        return true
      }

      /**
       * Replace the tray: persist it, show it, repaint its marks. A mark belongs
       * to the conversation rather than to a draft, so the list and its painting
       * can never drift apart.
       */
      function commitAnnotations(next, extra) {
        persistNotes(next)
        settleAnnotation({ annotations: next, ...IDLE_ANNOTATION, ...(extra ?? {}) })
        return next
      }

      /** Whether one DOM node belongs to this window rather than to the page. */
      function isSelfNode(node) {
        if (!node || typeof node.closest !== 'function') return false
        try {
          return node.closest(SELF_SELECTOR) !== null
        } catch {
          return false
        }
      }

      /** One write or send batch as one message body, notes two blank lines apart. */
      function annotationsText(list) {
        const items = Array.isArray(list) ? list : pendingAnnotations()
        return items.map(annotationBlock).join('\n\n\n')
      }

      /**
       * The break a Markdown block needs in front of it: two blank lines, so a
       * note reads as a block of its own in the draft instead of running on from
       * whatever it is appended to. A draft already ending with them gets no more.
       */
      function blockBreak(before) {
        if (before === '') return ''
        if (before.endsWith('\n\n\n')) return ''
        if (before.endsWith('\n\n')) return '\n'
        return before.endsWith('\n') ? '\n\n' : '\n\n\n'
      }

      /** Whether a node belongs to a text field rather than the transcript. */
      function inEditable(node) {
        if (!node || typeof node.closest !== 'function') return false
        try {
          return node.closest(EDITABLE_SELECTOR) !== null
        } catch {
          return false
        }
      }

      /** The selection worth annotating: quote + its flow-item anchor. */
      function readSelection() {
        try {
          if (typeof window.getSelection !== 'function') return null
          const selection = window.getSelection()
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
          const quote = tidyQuote(selection.toString())
          if (quote.trim() === '') return null
          const range = selection.getRangeAt(0)
          const node = range.commonAncestorContainer
          const element = /** @type {Element | null} */ (
            node && node.nodeType === 1 ? node : node?.parentElement
          )
          if (!element || typeof element.closest !== 'function') return null
          if (element.closest(EDITABLE_SELECTOR)) return null
          if (element.closest(MODAL_SELECTOR)) return null
          if (element.closest(SELF_SELECTOR)) return null
          // The browser keeps two ends: `anchor` is where the gesture started,
          // `focus` is where it ended. The native Shift+click grows from the
          // anchor, so a downward drag extends forward and an upward drag
          // extends backward. Both are kept while the range still points at
          // live nodes.
          let anchorPoint = null
          let focusPoint = null
          try {
            if (selection.anchorNode) {
              anchorPoint = { node: selection.anchorNode, offset: selection.anchorOffset }
            }
            if (selection.focusNode) {
              focusPoint = { node: selection.focusNode, offset: selection.focusOffset }
            }
          } catch {
            anchorPoint = null
            focusPoint = null
          }
          return { quote, range, anchorPoint, focusPoint }
        } catch {
          return null
        }
      }

      let selectionTimer
      let attentionTimer
      let flashTimer
      let repaintTimer
      let highlightObserver
      /** Ranges painted for the current notes, used to hit-test clicks. */
      let highlighted = []
      /**
       * Anchors recovered by quote instead of by key, keyed by note id.
       *
       * A stored key stops naming an element when the row is recycled under
       * another key; the healed anchor keeps the next repaint on the direct path
       * instead of re-walking every flow item again.
       */
      const resolvedAnchors = new Map()
      /**
       * Bumped when flow items are added, removed or re-keyed.
       *
       * A note whose stored row is gone can only find its passage again after
       * one of those, so the whole-transcript search waits for this to change
       * instead of running on every repaint of a streaming turn.
       */
      let anchorEpoch = 0
      /** Flow-item generation of the last search, and when it ran. */
      let searchEpoch = -1
      let searchAt = 0
      /** Quote → `{ anchor, epoch, at }` for notes that carry no anchor of their own. */
      const quoteAnchors = new Map()
      /** True while a pointer gesture is down, so no card opens mid-drag. */
      let pointerHeld = false

      /** Forget every recovered anchor; the next repaint starts from the stored ones. */
      function resetAnchorRecovery() {
        resolvedAnchors.clear()
        quoteAnchors.clear()
        searchEpoch = -1
        searchAt = 0
      }

      /** Cancel a capture that has not fired yet (a new press is starting). */
      function cancelPendingCapture() {
        if (selectionTimer !== undefined) {
          clearTimeout(selectionTimer)
          selectionTimer = undefined
        }
      }

      /**
       * Read the selection once it has settled. A short debounce is what keeps
       * double-click word selection and drag-then-adjust smooth: the browser's
       * own finalisation, the second click and the following mouseup all land
       * before the draft appears, and focus is not stolen mid-gesture.
       * The pointer's own position is kept so the card can open right at the cursor.
       */
      function captureSelectionLater(event) {
        if (state.quick !== true) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        const pointer =
          event && typeof event.clientX === 'number' && typeof event.clientY === 'number'
            ? { x: event.clientX, y: event.clientY }
            : null
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined
          captureSelection(pointer)
        }, 200)
      }

      /**
       * Keyboard selections end on a shifted keyup — in the transcript only.
       *
       * Shift+Enter makes a newline and Shift+<letter> capitalises, so a keyup
       * inside a text field is typing, not a selection gesture. Capturing it
       * would read a caret as a passage and pull the card (and the focus) over
       * the field the user is typing in.
       */
      function onSelectionKeyup(event) {
        if (state.quick !== true) return
        if (event?.shiftKey !== true) return
        if (inEditable(event?.target)) return
        if (inEditable(document.activeElement)) return
        captureSelectionLater()
      }

      /**
       * A card must never open while the button is still down: dragging a
       * selection keeps firing `selectionchange`, and opening then would steal
       * the focus (and the caret) in the middle of the gesture. The pointer
       * path and the safety net both wait for the release.
       */
      function onPointerGestureDown() {
        pointerHeld = true
        cancelPendingCapture()
      }

      function onPointerGestureUp() {
        pointerHeld = false
      }

      /**
       * Safety net for a settled selection that never reaches the pointer path:
       * a drag that ends outside the transcript, a double-click on a boundary,
       * or a second selection whose mouseup was swallowed by a re-render. It
       * shares the debounce timer, so the pointer path always wins, and
       * `captureSelection` itself refuses the quote that is already captured.
       */
      function onSelectionChange() {
        if (state.quick !== true) return
        if (pointerHeld) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined
          captureSelection()
        }, 260)
      }

      /** One short pulse so a capture is noticed wherever the eye is. */
      function pulse() {
        setState({ attentionAt: Date.now() })
        if (attentionTimer !== undefined) clearTimeout(attentionTimer)
        attentionTimer = setTimeout(() => {
          attentionTimer = undefined
          setState({ attentionAt: 0 })
        }, 900)
      }

      /**
       * Show one short confirmation line after a toggle, so a icon-only button
       * still says in words what it just switched to.
       */
      function notify(message) {
        const line = typeof message === 'string' ? message : ''
        if (line === '') return false
        setState({ flash: line })
        if (flashTimer !== undefined) clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
          flashTimer = undefined
          setState({ flash: '' })
        }, FLASH_HOLD_MS)
        return true
      }

      /** Turn the current selection into the pending annotation draft. */
      function captureSelection(pointer = null) {
        const selection = readSelection()
        if (selection === null) return false
        if (
          state.annotationDraft !== null &&
          state.annotationDraft.quote === selection.quote &&
          state.annotationEditingId === null
        ) {
          return false
        }
        // The card hangs next to the selection; the nudge window does not move
        // and keeps no focus, so the browser's own selection stays untouched.
        let rect = null
        try {
          rect = selection.range.getBoundingClientRect()
        } catch {
          rect = null
        }
        if (rect !== null && rect.width === 0 && rect.height === 0) rect = null
        // Anchor now, while the range still points at the nodes the user just
        // selected. Waiting for the click would gamble on the page not having
        // re-rendered in between, and a lost anchor means no highlight ever.
        let anchor = null
        try {
          anchor = anchorFromRange(selection.range, selection.quote)
        } catch {
          anchor = null
        }
        settleAnnotation({
          ...IDLE_ANNOTATION,
          annotationDraft: {
            quote: selection.quote,
            anchor,
            range: selection.range,
            // The gesture's start end: Shift+press grows away from it, so an
            // upward selection keeps its lower edge and an upward press extends
            // further up instead of dropping the rows already selected.
            anchorPoint: selection.anchorPoint,
            rect: rect
              ? {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                }
              : null,
            pointer,
          },
          note: '',
          error: '',
        })
        return true
      }

      /** Drop the browser selection only when it is still our captured quote. */
      function clearNativeSelection(quote) {
        try {
          const selection = window.getSelection?.()
          if (!selection || selection.rangeCount === 0) return
          if (typeof quote === 'string' && quote !== '' && selection.toString() === quote) {
            selection.removeAllRanges()
          }
        } catch {
          /* no selection object */
        }
      }

      /** Quick-annotation master switch. */
      function setQuick(value) {
        const next = value === true
        persistSetting('quick', next)
        settleAnnotation({
          quick: next,
          // The switch no longer unfolds the tray (its open state belongs to the
          // user); turning it off still drops whatever the tray was holding.
          ...(next ? null : { ...IDLE_ANNOTATION, annotationExpanded: false }),
        })
        notify(next ? text('quickOn') : text('quickOff'))
        return true
      }

      /** Auto-paste switch: when on, pending notes flow into the composer on focus. */
      function setAutoPaste(value) {
        const next = value === true
        persistSetting('autoPaste', next)
        setState({ autoPaste: next })
        notify(next ? text('autoPasteOn') : text('autoPasteOff'))
        return true
      }

      /**
       * Show the explanation bubble for one window control. `rect` is the
       * control's viewport box, kept as numbers so the renderer only has to
       * place the bubble; the text is derived from the live state, so a toggle
       * updates the bubble without moving the pointer.
       */
      function showTip(key, rect) {
        if (typeof key !== 'string' || key === '') return false
        const box = rect && typeof rect === 'object' ? rect : null
        const left = box === null ? NaN : Number(box.left)
        const top = box === null ? NaN : Number(box.top)
        const right = box === null ? NaN : Number(box.right)
        const bottom = box === null ? NaN : Number(box.bottom)
        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
          return false
        }
        setState({ tip: { key, left, top, right, bottom } })
        return true
      }

      /** Hide the explanation bubble. */
      function hideTip() {
        if (state.tip !== null) setState({ tip: null })
        return true
      }

      /** Border width of the floating window, in px; the default is not stored. */
      function setFrame(value) {
        const width = Number(value)
        if (!isFrameWidth(width)) return false
        persistSetting('frame', width)
        setState({ frame: width })
        notify(`${text('frameTitle')}：${text(frameLabelKey(width))}`)
        return true
      }

      /** Whether the annotation module shows its body. */
      function setAnnotationExpanded(value) {
        setState({ annotationExpanded: value === true })
      }

      /** Whether the nudge module shows its body. */
      function setNudgeExpanded(value) {
        setState({ nudgeExpanded: value === true })
      }

      /** Update the note for the pending annotation draft (or the edit). */
      function setAnnotationNote(value) {
        setState({ annotationNote: typeof value === 'string' ? value : '' })
      }

      /** The Session the annotation tray belongs to. */
      function noteSessionId() {
        return (resolveTarget(ctx) ?? state.target)?.sessionId
      }

      /** Persist the tray of the owning Session. */
      function persistNotes(list) {
        saveNotesOfSession(noteSessionId(), Array.isArray(list) ? list : state.annotations)
      }

      /** Commit the pending quote + note into the tray. */
      function addAnnotation(noteOverride) {
        const draft = state.annotationDraft
        if (!draft || typeof draft.quote !== 'string' || draft.quote.trim() === '') return false
        const note =
          typeof noteOverride === 'string'
            ? noteOverride
            : typeof state.annotationNote === 'string'
              ? state.annotationNote.trim()
              : ''
        // The capture already anchored the passage; the two retries cover a page
        // that re-rendered between the selection and this click. Whatever still
        // fails leaves a diagnostic sample, because a note without an anchor
        // shows up only as a highlight that never appears.
        let anchor = typeof draft.anchor?.key === 'string' ? draft.anchor : null
        if (anchor === null && draft.range != null) {
          try {
            anchor = anchorFromRange(draft.range, draft.quote)
          } catch {
            anchor = null
          }
        }
        if (anchor === null) anchor = anchorFromQuote(draft.quote)
        if (anchor === null) recordAnchorMiss(draft.quote)
        const annotation = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          quote: draft.quote,
          note,
          anchor,
        }
        const next = [...state.annotations, annotation]
        clearNativeSelection(draft.quote)
        // Only the text clears. A note landing never opens or resizes the tray:
        // the window keeps its shape while several passages are annotated.
        commitAnnotations(next, { note: '', error: '' })
        countStat('annotation')
        return true
      }

      /**
       * Commit the captured passage as an answer.
       *
       * The highlight covers the whole paragraph(s) the selection sits in, and
       * the selected words become the note itself — the note says "this is the
       * answer" without the user retyping it.
       */
      function markAsAnswer() {
        const draft = state.annotationDraft
        if (!draft || typeof draft.quote !== 'string' || draft.quote.trim() === '') return false
        let quote = draft.quote
        if (draft.range != null) {
          try {
            quote = passagesOfRange(draft.range) || draft.quote
          } catch {
            quote = draft.quote
          }
        }
        let anchor = null
        if (draft.range != null) {
          try {
            anchor = anchorFromRange(draft.range, quote)
          } catch {
            anchor = null
          }
        }
        if (anchor === null) anchor = anchorFromQuote(quote)
        if (anchor === null) recordAnchorMiss(quote)
        // Where the marked words sit inside the highlighted paragraph, in the
        // same whitespace-free projection the anchor uses. The purple span is
        // measured from it, so the mark survives a note edit.
        const packed = packedText(quote)
        const packedAnswer = packedText(draft.quote)
        const at = packedAnswer === '' ? -1 : packed.indexOf(packedAnswer)
        const annotation = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          quote,
          note: draft.quote,
          anchor,
          answer: at === -1 ? true : { start: at, length: packedAnswer.length },
        }
        // One answer per passage: marking the same block again replaces the
        // earlier note instead of stacking an identical highlight.
        const next = [
          ...state.annotations.filter((item) => packedText(item.quote) !== packed),
          annotation,
        ]
        clearNativeSelection(draft.quote)
        commitAnnotations(next, { note: '', error: '' })
        countStat('annotation')
        return true
      }

      /**
       * Add the captured passage with the 同意 / 不同意 answer. A remark typed
       * in the card is kept: the verdict comes first, then the remark.
       */
      function quickReply(kind) {
        const verdict = kind === 'agree' ? text('agree') : text('disagree')
        const remark = typeof state.annotationNote === 'string' ? state.annotationNote.trim() : ''
        return addAnnotation(remark === '' || remark === verdict ? verdict : `${verdict}，${remark}`)
      }

      /** Drop the pending annotation draft without adding it. */
      function dismissAnnotationDraft() {
        return closeAnnotationSurface()
      }

      /**
       * Open one collected annotation in the in-place bubble.
       *
       * `rect` is the viewport box the bubble hangs off: the clicked passage,
       * or the tray row that was clicked. The window itself is left alone —
       * editing a mark must never resize or unfold it.
       */
      function startEditAnnotation(id, rect = null) {
        const item = state.annotations.find((candidate) => candidate.id === id)
        if (item === undefined) return false
        const box = rectValue(rect)
        if (state.annotationEditingId === id) {
          // Clicking the same mark again only moves the bubble: whatever is
          // already typed stays in the field.
          settleAnnotation({ annotationEditRect: box })
          return true
        }
        settleAnnotation({
          ...IDLE_ANNOTATION,
          annotationEditingId: id,
          annotationEditRect: box,
          annotationNote: typeof item.note === 'string' ? item.note : '',
          note: '',
          error: '',
        })
        pulse()
        return true
      }

      /** Persist the edited note. */
      function saveEditedAnnotation() {
        if (state.annotationEditingId === null) return false
        const note = typeof state.annotationNote === 'string' ? state.annotationNote.trim() : ''
        const next = state.annotations.map((item) =>
          item.id === state.annotationEditingId ? { ...item, note } : item,
        )
        commitAnnotations(next, { note: '', error: '' })
        return true
      }

      /** Leave the edit without saving. */
      function cancelAnnotationEdit() {
        return closeAnnotationSurface()
      }

      /** Remove one collected annotation (also used from the edit body). */
      function removeAnnotation(id) {
        const next = state.annotations.filter((item) => item.id !== id)
        if (next.length === state.annotations.length) return false
        // Removing the note under the editor closes it; removing any other note
        // leaves the editor and whatever was typed in it alone.
        persistNotes(next)
        if (state.annotationEditingId === id) closeAnnotationSurface({ annotations: next })
        else settleAnnotation({ annotations: next })
        return true
      }

      /**
       * Copy the captured passage. Resolves to whether the clipboard took it;
       * the card reports that in place, the way ds-popup's copy button does.
       */
      function copyDraftQuote() {
        const quote = state.annotationDraft?.quote
        if (typeof quote !== 'string' || quote === '') return Promise.resolve(false)
        try {
          const clipboard = navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') return Promise.resolve(false)
          return Promise.resolve(clipboard.writeText(quote)).then(
            () => true,
            () => false,
          )
        } catch {
          return Promise.resolve(false)
        }
      }

      // --- painted highlights ---------------------------------------------


      /**
       * Whether this pass may search the whole transcript for a passage whose
       * row is gone.
       *
       * The transcript re-renders per token, so a repaint runs every 120 ms
       * while the agent streams. Searching every flow item's text on each one
       * is what made a long conversation stutter: the search is allowed once
       * per generation of flow items, and at most once per MISS_RESCAN_MS.
       */
      function canSearchAnchors(now) {
        return anchorEpoch !== searchEpoch || now - searchAt >= MISS_RESCAN_MS
      }

      /** Record that this pass searched; later passes wait for the next change. */
      function noteAnchorSearch(now) {
        searchEpoch = anchorEpoch
        searchAt = now
      }

      /**
       * The anchor of a note that carries none of its own, resolved by quote.
       * Cached per flow-item generation, so a passage that is still absent is
       * not looked for again on every repaint.
       */
      function anchorOfQuote(quote, canSearch, now) {
        const cached = quoteAnchors.get(quote)
        // A result is good for one flow-item generation, and no longer than the
        // retry window: the passage can appear inside a row that already exists.
        const fresh =
          cached !== undefined && cached.epoch === anchorEpoch && now - cached.at < MISS_RESCAN_MS
        if (fresh) return cached.anchor
        if (!canSearch) return cached === undefined ? null : cached.anchor
        const anchor = anchorFromQuote(quote)
        quoteAnchors.set(quote, { anchor, epoch: anchorEpoch, at: now })
        noteAnchorSearch(now)
        return anchor
      }

      /**
       * Paint a note whose stored offsets went stale while its text still sits
       * in the same row. Only an unambiguous passage is painted here; an
       * ambiguous one falls through to the recovery pass, which can prove the
       * row is the only carrier.
       */
      function spanWithinElement(entry, key, full) {
        const packed = packedText(entry.anchor.quote)
        if (packed === '') return null
        const at = full.packed.indexOf(packed)
        if (at === -1) return null
        if (full.packed.indexOf(packed, at + 1) !== -1) return null
        if (rangeFromPacked(full, at, at + packed.length) === null) return null
        if (entry.note !== null && typeof entry.note?.id === 'string') {
          resolvedAnchors.set(entry.note.id, {
            key,
            quote: packed,
            prefix: full.packed.slice(Math.max(0, at - CONTEXT_CHARS), at),
            suffix: full.packed.slice(at + packed.length, at + packed.length + CONTEXT_CHARS),
            index: at,
          })
        }
        return { start: at, end: at + packed.length }
      }

      /** Recompute which spans carry a note and repaint the CSS highlight. */
      function repaintHighlights() {
        highlighted = []
        const registry = window.CSS?.highlights
        if (registry === undefined) return
        try {
          const captureDraft = state.annotationDraft
          const captureAnchor =
            captureDraft !== null && captureDraft.anchor != null ? captureDraft.anchor : null
          const sources = state.annotations
          if (state.quick !== true || (sources.length === 0 && captureDraft === null)) {
            registry.delete(HIGHLIGHT_NAME)
            registry.delete(ANSWER_HIGHLIGHT)
            registry.delete(CAPTURE_HIGHLIGHT)
            return
          }
          const byKey = new Map()
          const now = Date.now()
          const canSearch = canSearchAnchors(now)
          // Notes saved before this build (or while the page was mid-stream) can
          // carry no anchor. The quote still identifies the passage, so resolve
          // it once per distinct quote and never draw a guess.
          const recovered = new Map()
          for (const note of sources) {
            let anchor = resolvedAnchors.get(note.id) ?? note.anchor
            if (typeof anchor?.key !== 'string') {
              const quote = typeof note.quote === 'string' ? note.quote : ''
              if (!recovered.has(quote)) recovered.set(quote, anchorOfQuote(quote, canSearch, now))
              anchor = recovered.get(quote)
            }
            if (anchor === null || typeof anchor !== 'object' || typeof anchor.key !== 'string') continue
            // A note without an anchor of its own keeps the one found here, so
            // the next repaint takes the direct path instead of asking again.
            if (typeof note.id === 'string') resolvedAnchors.set(note.id, anchor)
            if (!byKey.has(anchor.key)) byKey.set(anchor.key, [])
            byKey.get(anchor.key).push({ note, anchor, capture: false })
          }
          if (captureAnchor !== null && typeof captureAnchor.key === 'string') {
            if (!byKey.has(captureAnchor.key)) byKey.set(captureAnchor.key, [])
            byKey.get(captureAnchor.key).push({ note: null, anchor: captureAnchor, capture: true })
          }
          if (byKey.size === 0) {
            registry.delete(HIGHLIGHT_NAME)
            registry.delete(ANSWER_HIGHLIGHT)
            let painted = false
            const fallback = captureDraft?.range
            try {
              if (fallback && fallback.collapsed !== true) {
                registry.set(CAPTURE_HIGHLIGHT, new window.Highlight(fallback))
                painted = true
              }
            } catch {
              painted = false
            }
            if (!painted) registry.delete(CAPTURE_HIGHLIGHT)
            return
          }
          const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
          const maps = new Map()
          const ranges = []
          const answerRanges = []
          const captureRanges = []
          const misses = []
          /**
           * Put one note's passage into the paint lists.
           *
           * An answer note splits its paragraph around the words that were
           * marked: the paragraph stays yellow before and after them, and only
           * that span is purple. Splitting instead of stacking two highlights
           * keeps the result independent of registry paint order.
           */
          function paintNote(entry, full, start, end) {
            const painted = []
            const answer = entry.note?.answer
            const from = typeof answer?.start === 'number' ? answer.start : -1
            const length = typeof answer?.length === 'number' ? answer.length : 0
            if (from < 0 || length <= 0) {
              const range = rangeFromPacked(full, start, end)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
              return painted
            }
            const answerStart = Math.max(start, Math.min(start + from, end))
            const answerEnd = Math.max(answerStart, Math.min(answerStart + length, end))
            if (answerStart > start) {
              const range = rangeFromPacked(full, start, answerStart)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
            }
            if (answerEnd < end) {
              const range = rangeFromPacked(full, answerEnd, end)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
            }
            const purple = rangeFromPacked(full, answerStart, answerEnd)
            if (purple !== null) {
              answerRanges.push(purple)
              painted.push(purple)
            }
            return painted
          }
          for (const element of elements) {
            const key = element.getAttribute?.('data-chat-anchor-key')
            const wanted = byKey.get(key)
            if (wanted === undefined) continue
            let full = maps.get(key)
            if (full === undefined) {
              full = packedMapOf(element)
              maps.set(key, full)
            }
            for (const entry of wanted) {
              // The row is here but the stored offsets drifted: the passage is
              // still inside it, so heal it without searching the transcript.
              const span = locateAnchor(full, entry.anchor) ?? spanWithinElement(entry, key, full)
              if (span === null) {
                misses.push({ entry, quote: entry.anchor.quote })
                continue
              }
              if (entry.capture === true) {
                const range = rangeFromPacked(full, span.start, span.end)
                if (range === null) {
                  misses.push({ entry, quote: entry.anchor.quote })
                  continue
                }
                captureRanges.push(range)
                continue
              }
              for (const range of paintNote(entry, full, span.start, span.end)) {
                highlighted.push({ note: entry.note, range })
              }
            }
          }
          // A key that names no element is the other half of the same problem:
          // the row was re-keyed between the click and this repaint. Both cases
          // fall through to one recovery pass over the quotes — the passage is
          // identified by its text, not by the row that happened to hold it.
          for (const [key, wanted] of byKey) {
            if (maps.has(key)) continue
            for (const entry of wanted) misses.push({ entry, quote: entry.anchor.quote })
          }
          // The search is the expensive pass: one per flow-item generation (or
          // per retry window), never once per repaint.
          if (canSearch && misses.length > 0) noteAnchorSearch(now)
          const searchable = canSearch ? misses : []
          for (const miss of searchable) {
            const packed = packedText(miss.quote)
            if (packed === '') continue
            const holders = []
            for (const element of elements) {
              const key = element.getAttribute?.('data-chat-anchor-key')
              if (typeof key !== 'string') continue
              let full = maps.get(key)
              if (full === undefined) {
                full = packedMapOf(element)
                maps.set(key, full)
              }
              if (full.packed.indexOf(packed) === -1) continue
              holders.push({ key, full })
            }
            // One holder or none: painting the wrong row is worse than letting
            // the mark wait for the render that brings its passage back.
            if (holders.length !== 1) continue
            const index = holders[0].full.packed.indexOf(packed)
            if (index === -1) continue
            if (miss.entry.capture === true) {
              const range = rangeFromPacked(holders[0].full, index, index + packed.length)
              if (range !== null) captureRanges.push(range)
              continue
            }
            for (const range of paintNote(miss.entry, holders[0].full, index, index + packed.length)) {
              highlighted.push({ note: miss.entry.note, range })
            }
            // Heal the anchor so the next repaint takes the direct path.
            if (miss.entry.note !== null && typeof miss.entry.note?.id === 'string') {
              resolvedAnchors.set(miss.entry.note.id, {
                key: holders[0].key,
                quote: packed,
                prefix: holders[0].full.packed.slice(Math.max(0, index - CONTEXT_CHARS), index),
                suffix: holders[0].full.packed.slice(index + packed.length, index + packed.length + CONTEXT_CHARS),
                index,
              })
            }
          }
          // An unchanged set keeps its Highlight: replacing it makes the browser
          // repaint every mark on the page for nothing.
          if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
          else if (!sameRanges(registry.get(HIGHLIGHT_NAME), ranges)) {
            registry.set(HIGHLIGHT_NAME, new window.Highlight(...ranges))
          }
          // Answer passages keep their own registry, so the stylesheet can give
          // them a different colour without touching a plain note's mark.
          if (answerRanges.length === 0) registry.delete(ANSWER_HIGHLIGHT)
          else if (!sameRanges(registry.get(ANSWER_HIGHLIGHT), answerRanges)) {
            registry.set(ANSWER_HIGHLIGHT, new window.Highlight(...answerRanges))
          }
          if (captureAnchor === null && captureDraft !== null && captureDraft.range) {
            try {
              if (captureDraft.range.collapsed !== true) captureRanges.push(captureDraft.range)
            } catch {
              /* stale range */
            }
          }
          if (captureRanges.length === 0) registry.delete(CAPTURE_HIGHLIGHT)
          else if (!sameRanges(registry.get(CAPTURE_HIGHLIGHT), captureRanges)) {
            registry.set(CAPTURE_HIGHLIGHT, new window.Highlight(...captureRanges))
          }
        } catch (error) {
          console.warn('[dsh-nudge] highlight repaint failed', error)
        }
      }

      /** Coalesce repaint triggers into one frame-ish task. */
      function scheduleRepaint() {
        if (repaintTimer !== undefined || state.quick !== true) return
        // Nothing painted and nothing being captured: a streaming transcript
        // mutates the DOM constantly, and this runs on every mutation.
        if (state.annotations.length === 0 && state.annotationDraft === null) return
        repaintTimer = setTimeout(() => {
          repaintTimer = undefined
          repaintHighlights()
        }, 120)
      }

      /**
       * Whether a painted mark lost its text. A mark is a live Range over the
       * transcript's text nodes; when the shell re-renders that row it swaps
       * in fresh nodes with the same text, the old range collapses, and the
       * passage shows unpainted until the next repaint.
       */
      function paintedMarkBroken() {
        for (const entry of highlighted) {
          try {
            const range = entry.range
            if (range.collapsed === true) return true
            if (range.startContainer?.isConnected === false) return true
          } catch {
            return true
          }
        }
        return false
      }

      /**
       * Whether one mutation record touches the transcript. A change that sits
       * in a flow item, or that brings one in or takes one away, can move a
       * mark; a change outside every flow item — this window, the shell's own
       * chrome — cannot, so it must not repaint.
       */
      function transcriptChanged(record) {
        let touched = false
        const target = record?.target
        const element = target?.nodeType === 1 ? target : (target?.parentElement ?? null)
        if (typeof element?.closest === 'function' && element.closest(ANCHOR_SELECTOR) !== null) {
          touched = true
        }
        for (const list of [record?.addedNodes, record?.removedNodes]) {
          for (const node of list ?? []) {
            if (node?.nodeType !== 1) continue
            if (node.matches?.(ANCHOR_SELECTOR) || node.querySelector?.(ANCHOR_SELECTOR)) touched = true
          }
        }
        return touched
      }

      /**
       * The page changed. Only a change to the transcript can move a mark, so
       * nothing else repaints. A broken mark is repainted right here: an
       * observer callback runs before the browser paints the frame, so the
       * passage never shows unpainted. Any other transcript change keeps the
       * debounce.
       */
      function onTranscriptMutation(records) {
        // A row that arrives, leaves or is re-keyed is also the only thing that
        // can bring back a passage whose row is gone.
        if (flowAnchorsChanged(records)) anchorEpoch += 1
        if (state.quick !== true) return
        let relevant = false
        for (const record of records ?? []) {
          if (transcriptChanged(record)) relevant = true
        }
        if (!relevant) return
        if (!paintedMarkBroken()) {
          scheduleRepaint()
          return
        }
        if (repaintTimer !== undefined) {
          clearTimeout(repaintTimer)
          repaintTimer = undefined
        }
        repaintHighlights()
      }

      /**
       * The annotated passage under a viewport point and the box the point hit,
       * or null. The box is what the in-place editor hangs off.
       */
      function noteAtPoint(x, y) {
        for (let index = highlighted.length - 1; index >= 0; index -= 1) {
          const entry = highlighted[index]
          let rects
          try {
            rects = entry.range.getClientRects()
          } catch {
            continue
          }
          for (const rect of rects) {
            if (rect.width === 0 && rect.height === 0) continue
            if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) {
              return { note: entry.note, rect: rectValue(rect) }
            }
          }
        }
        return null
      }

      /** Clicking a painted passage reopens its note for editing. */
      function onTranscriptClick(event) {
        if (state.quick !== true || highlighted.length === 0) return
        // Only a click that lands on a transcript row can reopen a note. A
        // click in the composer, a menu or a control belongs to something
        // else: taking its focus would put the next Enter in our editor.
        const target = event?.target
        if (!target || typeof target.closest !== 'function') return
        if (target.closest(ANCHOR_SELECTOR) === null) return
        if (inEditable(target)) return
        if (target.closest(MODAL_SELECTOR) !== null) return
        if (target.closest('button, a, input, textarea, select, [role="button"]') !== null) return
        try {
          const selection = window.getSelection?.()
          if (selection && selection.isCollapsed === false) return
        } catch {
          /* no selection object */
        }
        const hit = noteAtPoint(event.clientX, event.clientY)
        if (hit === null) return
        startEditAnnotation(hit.note.id, hit.rect)
      }

      // --- popup placement -------------------------------------------------

      /**
       * The annotation cards hang off the pointer or the quote box. The module
       * owns that geometry; closing the surface stays here, injected.
       */
      const popup = createPopup({
        getState: () => state,
        setState,
        closeAnnotationSurface,
        cancelPendingCapture,
      })
      const {
        pointerNearRect,
        popupPosition,
        placeOverRect,
        editPopupPosition,
        closePopup,
        onOuterPointerDown,
        onPopupDismiss,
      } = popup

      /** True while a Shift+drag is extending the captured passage. */
      let extending = false
      /** The leading edge the extension grows from, or null. */
      let extendAnchor = null

      /** The caret under a viewport point, or null when the browser cannot say. */
      function caretRangeAt(x, y) {
        try {
          if (typeof document.caretRangeFromPoint === 'function') {
            return document.caretRangeFromPoint(x, y) ?? null
          }
          if (typeof document.caretPositionFromPoint === 'function') {
            const position = document.caretPositionFromPoint(x, y)
            if (!position) return null
            const range = document.createRange()
            range.setStart(position.offsetNode, position.offset)
            range.collapse(true)
            return range
          }
        } catch {
          return null
        }
        return null
      }

      /**
       * Grow the captured passage away from the gesture's start end to the
       * pointer.
       *
       * The card holds the focus, and focusing it collapsed the native selection,
       * so the browser's own Shift+click has no anchor left. The end the gesture
       * started from is the anchor (it is the lower edge for an upward drag), and
       * the pointer is turned into a caret range; the resulting selection is
       * written back into the draft so the card follows.
       */
      function extendTo(x, y) {
        const draft = state.annotationDraft
        if (draft === null || extendAnchor === null) return false
        const caret = caretRangeAt(x, y)
        if (caret === null) return false
        const selection = window.getSelection?.()
        if (!selection) return false
        try {
          selection.removeAllRanges()
          selection.setBaseAndExtent(
            extendAnchor.node,
            extendAnchor.offset,
            caret.startContainer,
            caret.startOffset,
          )
        } catch {
          return false
        }
        if (selection.isCollapsed) return false
        const range = selection.getRangeAt(0)
        const quote = tidyQuote(selection.toString())
        if (quote.trim() === '') return false
        let rect = null
        try {
          rect = range.getBoundingClientRect()
        } catch {
          rect = null
        }
        if (rect !== null && rect.width === 0 && rect.height === 0) rect = null
        let anchor = null
        try {
          anchor = anchorFromRange(range, quote)
        } catch {
          anchor = null
        }
        // Only the draft changes: the note already typed and the editor stay.
        settleAnnotation({
          annotationDraft: {
            quote,
            anchor,
            range,
            // Keep the gesture's original start end: consecutive Shift+presses
            // grow away from it, whichever direction the first drag ran.
            anchorPoint: draft.anchorPoint,
            rect: rect
              ? {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                }
              : null,
            pointer: null,
          },
          annotationCardHidden: false,
        })
        return true
      }

      /** Shift+press on the transcript keeps extending the captured passage. */
      function onExtendPointerDown(event) {
        if (state.quick !== true || event?.shiftKey !== true) return
        const draft = state.annotationDraft
        if (draft === null || state.annotationEditingId !== null) return
        const target = event.target
        if (target && typeof target.closest === 'function') {
          if (target.closest(EDITABLE_SELECTOR)) return
          if (target.closest(MODAL_SELECTOR)) return
          if (target.closest(SELF_SELECTOR)) return
        }
        let anchor = null
        if (draft.anchorPoint && draft.anchorPoint.node) {
          anchor = draft.anchorPoint
        } else {
          // Drafts captured before this build carry only the range.
          try {
            const range = draft.range && typeof draft.range.cloneRange === 'function' ? draft.range.cloneRange() : null
            if (range !== null) {
              range.collapse(true)
              anchor = { node: range.startContainer, offset: range.startOffset }
            }
          } catch {
            anchor = null
          }
        }
        if (anchor === null) return
        extendAnchor = anchor
        extending = true
        // Keep the caret in the card and stop the browser from starting a fresh
        // selection at the press point.
        event.preventDefault?.()
        extendTo(event.clientX, event.clientY)
      }

      function onExtendPointerMove(event) {
        if (!extending) return
        if (typeof event?.buttons === 'number' && (event.buttons & 1) === 0) {
          extending = false
          extendAnchor = null
          return
        }
        extendTo(event.clientX, event.clientY)
      }

      function onExtendPointerUp() {
        extending = false
        extendAnchor = null
      }

      /**
       * True when the focused node is one of our own text fields and it holds a
       * real (non-empty) text selection: there the browser's own copy wins.
       */
      function fieldHasSelection() {
        try {
          const active = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (document.activeElement)
          if (!active || typeof active.selectionStart !== 'number') return false
          if (typeof active.closest !== 'function' || active.closest(SELF_SELECTOR) === null) return false
          return active.selectionStart !== active.selectionEnd
        } catch {
          return false
        }
      }

      /** Ctrl/Cmd+C while a card is open, with no selection inside our fields. */
      function copyShortcutActive(event) {
        if (state.annotationDraft === null) return false
        if (event.ctrlKey !== true && event.metaKey !== true) return false
        if (event.altKey === true || event.shiftKey === true) return false
        return typeof event.key === 'string' && event.key.toLowerCase() === 'c'
      }

      function onPopupKeydown(event) {
        if (event?.key === 'Escape' && state.settingsOpen) {
          event.preventDefault()
          closeSettings()
          return
        }
        if (event?.key === 'Escape' && state.annotationDraft !== null) {
          event.preventDefault()
          closePopup()
          return
        }
        if (event?.key === 'Escape' && state.annotationEditingId !== null) {
          event.preventDefault()
          cancelAnnotationEdit()
          return
        }
        if (!copyShortcutActive(event)) return
        if (fieldHasSelection()) return
        // Focusing the note field drops the editor's native selection, so the
        // browser has nothing left to copy. The card owns the passage: copy it
        // ourselves and keep Ctrl+C working, which is the point of the card.
        event.preventDefault()
        copyDraftQuote().then((ok) => notify(ok ? text('copiedShort') : text('copyFailedShort')))
      }

      /** Put one text block in at the caret; false when the shell refused it. */
      function spliceAtCaret(handle, value) {
        if (value === '') return true
        if (typeof handle.insertText !== 'function' || typeof handle.captureInsertion !== 'function') return false
        try {
          const span = handle.captureInsertion()
          if (!span || typeof span.start !== 'number' || typeof span.end !== 'number') return false
          return handle.insertText(value, span) === true
        } catch {
          return false
        }
      }

      /**
       * Write the pending annotations as the shell's own quote previews: one
       * quote node per passage, the answer as plain text on the line below it.
       * This is the node DSH inserts for a quoted selection, so the draft shows
       * the quote mark instead of a run of `>` lines — and the node serializes
       * back to the very Markdown a sent message carries.
       *
       * Reports how far it got and the blank-line break it already placed, so
       * a shell that stops taking quotes mid-batch can finish the rest as text
       * without doubling the gap. `attempted: false` means the shell has no
       * quote face (or is not idle): the caller keeps its text path.
       */
      function writeQuotedBatch(handle, pending, draft) {
        const skipped = { attempted: false, written: 0, lead: '', gap: false }
        if (typeof handle.insertQuote !== 'function') return skipped
        if (typeof handle.insertText !== 'function' || typeof handle.captureInsertion !== 'function') return skipped
        // The shell only takes a quote into a plain composer; a sending or
        // decided composer is the text path's business.
        let phase = ''
        try {
          phase = handle.readPhase?.() ?? ''
        } catch {
          phase = ''
        }
        if (phase !== '' && phase !== 'plain') return skipped
        const result = { attempted: true, written: 0, lead: '', gap: false }
        const caret = () => {
          try {
            const span = handle.captureInsertion()
            return span && typeof span.start === 'number' ? span : undefined
          } catch {
            return undefined
          }
        }
        try {
          const first = caret()
          if (first === undefined) {
            result.attempted = false
            return result
          }
          const lead = blockBreak(draft.slice(0, first.start))
          if (lead !== '' && handle.insertText(lead, first) !== true) {
            result.attempted = false
            return result
          }
          result.lead = lead
          for (let index = 0; index < pending.length; index += 1) {
            const item = pending[index]
            const quote = tidyQuote(item.quote)
            if (quote.trim() === '') break
            // A refused quote leaves the last written note where it is; the
            // separator for this slot is what `gap` reports.
            if (handle.insertQuote(quote) !== true) {
              result.gap = index > 0
              break
            }
            result.written += 1
            const note = annotationNoteLine(item)
            if (note !== '') {
              const span = caret()
              if (span === undefined || handle.insertText(`\n${note}`, span) !== true) break
            }
            if (index === pending.length - 1) break
            const span = caret()
            if (span === undefined || handle.insertText('\n\n\n', span) !== true) break
            result.gap = true
          }
        } catch {
          return result
        }
        return result
      }

      /** Append every pending annotation to the composer draft. */
      function writeAnnotations() {
        const pending = pendingAnnotations()
        if (pending.length === 0) return false
        const handle = composerHandle()
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        const body = annotationsText(pending)
        if (body === '') return false
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        // Preferred: the shell's quote preview per passage. Whatever it could
        // not take stays pending; the rest of the batch is written as text.
        const quoted = writeQuotedBatch(handle, pending, draft)
        let writtenCount = quoted.written
        if (writtenCount < pending.length && writtenCount > 0) {
          const rest = annotationsText(pending.slice(writtenCount))
          if (spliceAtCaret(handle, (quoted.gap ? '' : '\n\n\n') + rest)) writtenCount = pending.length
        }
        if (writtenCount < pending.length && writtenCount === 0) {
          // The text path: splice at the caret first, then rebuild. `setDraft`
          // rebuilds every paragraph and drops the caret at the end, which is
          // exactly what a write in the middle of typing must not do; the
          // rebuild stays as the fallback for a shell without the insertion
          // face, or for a draft that moved. A leading break the quote path
          // already placed is not put in twice.
          let written = false
          if (typeof handle.insertText === 'function' && typeof handle.captureInsertion === 'function') {
            try {
              const span = handle.captureInsertion()
              if (span && typeof span.start === 'number' && typeof span.end === 'number') {
                const lead = quoted.lead !== '' ? '' : blockBreak(draft.slice(0, span.start))
                written = handle.insertText(lead + body, span) === true
              }
            } catch {
              written = false
            }
          }
          if (written) {
            writtenCount = pending.length
          } else {
            const next = draft.trim() === '' ? body : `${draft}${blockBreak(draft)}${body}`
            try {
              handle.setDraft(next)
            } catch (error) {
              console.warn('[dsh-nudge] annotation write failed', error)
              setState({ note: text('insertUnavailable'), error: '' })
              return false
            }
            writtenCount = pending.length
          }
        }
        if (writtenCount === 0) {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        // The note leaves the pending set but stays in the tray and keeps its
        // passage painted: a mark belongs to the conversation, not to the
        // draft. Clearing the input box no longer takes it away — only
        // deleting the note does.
        const ids = new Set(pending.slice(0, writtenCount).map((item) => item.id))
        const marked = state.annotations.map((item) =>
          ids.has(item.id) ? { ...item, written: true } : item,
        )
        commitAnnotations(marked, { note: '', error: '' })
        return true
      }

      /** Send the pending annotations as one user message. */
      function sendAnnotations() {
        if (state.phase === 'waiting') return false
        const pending = pendingAnnotations()
        if (pending.length === 0) return false
        const body = annotationsText(pending)
        if (body === '') return false
        if (!deliver(body)) return false
        // What was just sent lives in the conversation now; the notes already
        // written into the draft keep their marks.
        const ids = new Set(pending.map((item) => item.id))
        const next = state.annotations.filter((item) => !ids.has(item.id))
        commitAnnotations(next)
        return true
      }

      /** The preset a send/write uses: the chosen one when it is enabled. */
      function activePreset() {
        const chosen = presetOf(state.presets, state.presetId)
        if (chosen !== undefined && chosen.enabled !== false) return chosen
        return state.presets.find((preset) => preset.enabled !== false)
      }

      /** The primary button: write into the composer, or send the chosen preset. */
      function ask() {
        if (state.phase === 'waiting' && !canInsert()) return false
        // With the caret in the composer the same button writes the chosen
        // prompt into the draft instead of starting a turn.
        if (canInsert()) return insertPreset()
        const preset = activePreset()
        if (!preset) return false
        const delivered = deliver(preset.text)
        if (delivered) countStat('send', preset.id)
        return delivered
      }

      /**
       * Turbo double-click on a preset: switch to it and use it. A composer
       * that already holds text wins over sending — the prompt is appended,
       * even when the caret is elsewhere, so a half-written message is never
       * dropped just because the double-click did not land in the field.
       */
      function runPreset(id) {
        if (setPreset(id) !== true) return false
        if (composerHasText()) return insertPreset()
        return ask()
      }

      /** Switch the delivery mode for this browser and remember it. */
      function setDelivery(value) {
        if (!isDelivery(value)) return false
        persistSetting('delivery', value)
        setState({ deliveryOverride: value })
        notify(`${text('mode')}：${value === 'steer' ? text('steer') : text('queue')}`)
        return true
      }

      /** The delivery actually used: browser override, else the single default. */
      function effectiveDelivery() {
        if (isDelivery(state.deliveryOverride)) return state.deliveryOverride
        return DEFAULT_DELIVERY
      }

      /** Turbo mode: hide the primary button and run a prompt on double-click. */
      function setTurbo(value) {
        const next = value === true
        persistSetting('turbo', next)
        setState({ turbo: next })
        notify(`${text('turboTitle')}：${next ? text('switchOn') : text('switchOff')}`)
        return true
      }

      /** Switch the probe preset for this browser and remember it. */
      function setPreset(value) {
        if (presetOf(state.presets, value) === undefined) return false
        persistSetting('preset', value)
        setState({ presetId: value })
        return true
      }

      // --- presets ---------------------------------------------------------

      /**
       * The prompt list and its two places. The module owns the persisted list
       * and the in-window forms; the runtime keeps the store and the settings
       * writer, both injected.
       */
      const presetActions = createPresetActions({
        getState: () => state,
        setState,
        text,
        persistSetting,
        clearSetting,
      })
      const {
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
      } = presetActions

      // --- idle lines ------------------------------------------------------

      // --- idle lines ------------------------------------------------------

      /**
       * The idle lines and their rotation. The module owns the list; the store
       * and the settings writer stay here, injected.
       */
      const tipActions = createTipActions({
        getState: () => state,
        setState,
        text,
        persistSetting,
        clearSetting,
      })
      const {
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
      } = tipActions

      // --- card placement --------------------------------------------------

      /** Where the card hangs when collapsed: the point of the last drag. */
      let cardAnchor = null


      /**
       * Collapse or expand the window.
       *
       * A fold that came from a pointer puts the pill where that pointer is —
       * centred on it and clamped into the viewport — so the button lands under
       * the hand that folded the window instead of jumping to the card's corner.
       * The card keeps its own spot, so the unfold returns it where it was. A
       * fold with no pointer (the keyboard) keeps the shared anchor as before.
       */
      function setCollapsed(value, point) {
        if (state.collapsed === value) return
        let pos = clampPoint(state.pos, value)
        if (value === true && isPoint(point)) {
          cardAnchor = state.pos
          pos = clampPoint({ x: point.x - PILL_SIZE / 2, y: point.y - PILL_SIZE / 2 }, true)
        }
        if (value === false) {
          if (cardAnchor !== null) pos = clampPoint(cardAnchor, false)
          cardAnchor = null
        }
        setState({
          collapsed: value,
          settingsOpen: value ? false : state.settingsOpen,
          unread: value ? state.unread : false,
          pos,
        })
        saveUi()
      }

      /** Move the window while dragging (not persisted until drop). */
      function moveTo(x, y) {
        // A pill dragged elsewhere is the anchor the next unfold starts from:
        // the spot the card was folded at no longer applies.
        if (state.collapsed) cardAnchor = null
        setState({ pos: clampPoint({ x, y }, state.collapsed) })
      }

      /** Persist the current window state. */
      function saveUi() {
        // Keep keys this build does not own (an older record may carry more).
        writeJson(UI_KEY, { ...(readJson(UI_KEY) ?? {}), collapsed: state.collapsed, pos: state.pos })
      }

      // --- durable settings (Host half) -----------------------------------

      /**
       * Read the Host half's durable record once per launch — and only then let
       * the mirror write. The two are ordered here and nowhere else: a POST
       * replaces the whole file, so writing before the read would erase the
       * very settings a restart is supposed to come back from.
       * @returns true when a restored record changed the state.
       */
      function hydrateFromHost() {
        return loadStoreFromHost()
          .then((remote) => {
            const adopted = adoptRemoteRecord(remote)
            markSettingsRead()
            return adopted
          })
          .catch(() => {
            // No Host half (preview page, plain harness): the page is the copy.
            markSettingsRead()
            return false
          })
      }

      /**
       * Adopt the fields of a record the page does not hold — per field, so a
       * page that already wrote its own geometry still gets the presets, and a
       * page that holds everything keeps its own copy (the user just changed
       * it) while the mirror refreshes the record from it.
       */
      function adoptRemoteRecord(remote) {
        if (remote === null || remote === undefined || typeof remote !== 'object') return false
        const pageHeldSomething = hasStoredSettings(settingsSnapshot())
        const adopted = adoptFromHost(() => applySettingsStore(remote, { merge: true }))
        if (!adopted) return false
        reloadFromStorage()
        // A page that held nothing is now exactly the record. A page that held
        // some fields holds the union, so the record is brought up to date.
        if (pageHeldSomething) markSettingsDirty()
        else markSettingsSynced()
        return true
      }

      /** Re-derive every persisted preference from the page storage. */
      function reloadFromStorage() {
        const saved = readJson(UI_KEY) ?? {}
        // The tray comes back from storage; the marks a write left behind in a
        // draft do not, because the draft they pointed at may be gone too.
        resetAnchorRecovery()
        // A reloaded window starts folded from its stored spot: no card anchor
        // outlives the page it was folded on.
        cardAnchor = null
        setState({
          ...readSettings({ lang: state.lang, sessionId: state.target?.sessionId }),
          tipIndex: 0,
          // The restore follows the same launch rule as the first paint.
          collapsed: true,
          pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        })
      }

      /**
       * Bump one of today's counters. The local calendar day is the bucket:
       * a click after midnight starts a fresh row, and the store keeps the
       * newest `STATS_DAYS` rows only. A preset send/write also bumps that
       * preset's own count so the settings board can rank the top prompts.
       */
      function countStat(field, presetId) {
        if (!STAT_FIELDS.includes(field)) return false
        const key = dayKey()
        const days = { ...state.stats.days }
        const today = { ...(days[key] ?? {}) }
        today[field] = (today[field] ?? 0) + 1
        if (
          typeof presetId === 'string' &&
          presetId.length > 0 &&
          presetId.length <= MAX_STAT_PRESET_ID &&
          presetId !== '__proto__' &&
          presetId !== 'constructor' &&
          presetId !== 'prototype'
        ) {
          const presets = { ...(today.presets ?? {}) }
          presets[presetId] = (presets[presetId] ?? 0) + 1
          today.presets = presets
        }
        days[key] = today
        const next = normalizeStats({ days })
        persistSetting('stats', next)
        setState({ stats: next })
        return true
      }

      // --- settings navigation --------------------------------------------

      /**
       * Append one sample to a diagnostic list in the persisted UI record.
       *
       * The shell's open seams report nothing when they fail — `invoke` returns
       * void, a blocked command returns silently, a click on the wrong button is
       * accepted — so the only place a failure can be observed is the running
       * page. The samples land in `nudge-store.json`, next to the other settings.
       */
      function recordUiDiag(name, entry) {
        const ui = readJson(UI_KEY) ?? {}
        const list = Array.isArray(ui[name]) ? ui[name].slice(-DIAG_SAMPLES) : []
        list.push({ at: Date.now(), ...entry })
        ui[name] = list
        storage()?.setItem(UI_KEY, JSON.stringify(ui))
      }

      /** One settings-navigation sample. */
      function recordSettingsDiag(entry) {
        try {
          recordUiDiag('settingsDiag', entry)
        } catch {
          /* diagnostics are best-effort and never block the gear */
        }
      }


      /**
       * Why a passage could not be anchored, as one sample.
       *
       * `flows` counts the anchor elements on the page, `hits` how many of them
       * carry the passage, and `inBody` whether the text is on the page at all:
       * together they separate "the transcript re-rendered" from "the passage
       * lives outside every flow item" without a debugger on the running app.
       */
      function recordAnchorMiss(quote) {
        try {
          const packed = packedText(quote)
          const flows = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
          let hits = 0
          for (const element of flows) {
            if (packedMapOf(element).packed.indexOf(packed) !== -1) hits += 1
          }
          const body = packedText(document.body?.textContent ?? '')
          recordUiDiag('anchorDiag', {
            event: 'no-anchor',
            length: packed.length,
            flows: flows.length,
            hits,
            inBody: packed !== '' && body.indexOf(packed) !== -1,
          })
        } catch {
          /* diagnostics are best-effort and never block the note */
        }
      }

      /**
       * The Settings jump driver lives in a package-local chunk
       * (`client.settings-jump.js`), fetched on the first press of the gear.
       *
       * The chunk is the reusable unit: it knows the shell's seams and nothing
       * about this plugin, so a second jump target is a second instance with a
       * different `sectionTitle` (and its own `onDiag` / `onFallback`) — the
       * routing, the receipts and the escalation order come for free.
       */
      let settingsJump
      let settingsJumpLoad

      /** Fetch (once) and wire the driver; a failed fetch is retried by the next press. */
      function loadSettingsJump() {
        if (settingsJump !== undefined) return Promise.resolve(settingsJump)
        if (settingsJumpLoad !== undefined) return settingsJumpLoad
        const fail = (error) => {
          settingsJumpLoad = undefined
          console.warn('[dsh-nudge] settings jump chunk unavailable', error)
          return undefined
        }
        try {
          if (typeof require?.async !== 'function') throw new Error('this shell has no chunk loader')
          settingsJumpLoad = require
            .async('./client.settings-jump.js')
            .then((chunk) => {
              settingsJump = chunk.createSettingsJump({
                getShortcuts: () => ctx.get?.('shortcuts'),
                getSlots: () => ctx.slots,
                sectionTitle: () => text('settingsTitle'),
                onDiag: (entry) => recordSettingsDiag(entry),
                onFallback: () => setState({ settingsOpen: true }),
              })
              return settingsJump
            })
            .catch(fail)
        } catch (error) {
          return Promise.resolve(fail(error))
        }
        return settingsJumpLoad
      }

      /**
       * Open Settings on this plugin's section.
       *
       * Resolves whether one of the shell's routes acted. When the chunk itself
       * cannot load — an install copy shipped without the file, or a shell whose
       * loader has no chunk support — the in-window form opens instead, so the
       * gear is never dead.
       */
      async function openSettings() {
        const jump = await loadSettingsJump()
        if (jump === undefined) {
          recordSettingsDiag({ event: 'chunk', error: 'unavailable' })
          setState({ settingsOpen: true })
          return false
        }
        return jump.open()
      }

      /** Drop a pending verification (dispose, or a second press of the gear). */
      function stopSettingsWait() {
        if (settingsJump !== undefined) settingsJump.cancel()
      }

      /** What the running page says about the shell's settings seams (diagnostics). */
      function probeSettings() {
        return settingsJump === undefined ? { pending: true } : settingsJump.probe()
      }

      /** Record the seam sample once the chunk has arrived (mount-time probe). */
      function probeSettingsSeams() {
        loadSettingsJump().then((jump) => {
          recordSettingsDiag(
            jump === undefined
              ? { event: 'mount', error: 'chunk-unavailable' }
              : { event: 'mount', ...jump.probe() },
          )
        })
      }

      /** Leave the in-window settings form and return to the normal body. */
      function closeSettings() {
        if (state.settingsOpen) setState({ settingsOpen: false })
      }

      /** Keep the window inside the viewport after a resize; the card closes. */
      function onResize() {
        setState({ pos: clampPoint(state.pos, state.collapsed) })
        onPopupDismiss()
      }

      /**
       * Leaving the page writes the pending settings now. The mirror waits
       * `STORE_SYNC_MS` for a burst of edits to settle, and a window closed in
       * that gap would otherwise drop the last change — on the very restart the
       * Host record exists for. It is best effort: a page torn down at once may
       * still cut the request short.
       */
      function onPageHide() {
        flushSettingsMirror()
      }

      /** A page that goes to the background may never come back: write now. */
      function onVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSettingsMirror()
      }

      // --- world subscriptions -------------------------------------------

      /** Refresh target/pending facts from the Client stores. */
      let lastTargetId
      function refreshWorld() {
        const target = resolveTarget(ctx)
        const pendingQuestion = target
          ? Boolean(statusOf(ctx, target.sessionId)?.pendingInteraction)
          : false
        const targetId = target?.sessionId
        if (targetId !== lastTargetId) {
          lastTargetId = targetId
          // The marks belong to the conversation that quoted them.
          resetAnchorRecovery()
          // The ask is bound to the conversation it was clicked in (1.2); a
          // different conversation must not inherit its status or its wait.
          if (delivery.isWaiting()) endWaiting()
          // The tray belongs to the conversation it quotes: load that Session's
          // saved notes and drop any half-written one.
          settleAnnotation({
            target,
            pendingQuestion,
            note: '',
            error: '',
            phase: 'idle',
            annotations: notesOfSession(targetId),
            ...IDLE_ANNOTATION,
            annotationExpanded: false,
            nudgeExpanded: true,
            attentionAt: 0,
          })
          return
        }
        setState({ target, pendingQuestion })
      }

      const offs = []
      const sessions = ctx.get?.('sessions')
      if (typeof sessions?.list?.subscribe === 'function') {
        offs.push(sessions.list.subscribe(refreshWorld))
      }
      const statusSource = ctx.get?.('uiSession')?.sessionStatus
      if (typeof statusSource?.subscribe === 'function') {
        offs.push(
          statusSource.subscribe(() => {
            refreshWorld()
            delivery.onStatusChange()
          }),
        )
      }
      try {
        const locale = ctx.get?.('locale')
        if (typeof locale?.subscribe === 'function') {
          offs.push(locale.subscribe(() => setState({ lang: readLang(ctx) })))
        }
      } catch {
        /* locale absent */
      }
      window.addEventListener('resize', onResize)
      window.addEventListener('pagehide', onPageHide)
      // The primary button follows the caret: entering or leaving the composer
      // flips the write mode without polling.
      try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibilityChange)
          document.addEventListener('focusin', syncComposerFocus, true)
          document.addEventListener('focusout', syncComposerFocus, true)
          // Selection capture and painted-passage clicks.
          document.addEventListener('pointerdown', onPointerGestureDown, true)
          document.addEventListener('pointerup', onPointerGestureUp, true)
          document.addEventListener('pointercancel', onPointerGestureUp, true)
          window.addEventListener('blur', onPointerGestureUp)
          document.addEventListener('mouseup', captureSelectionLater, true)
          document.addEventListener('keyup', onSelectionKeyup, true)
          document.addEventListener('selectionchange', onSelectionChange, true)
          document.addEventListener('click', onTranscriptClick, true)
          // Shift+press extends the captured passage without the native anchor.
          document.addEventListener('mousedown', onExtendPointerDown, true)
          document.addEventListener('mousemove', onExtendPointerMove, true)
          document.addEventListener('mouseup', onExtendPointerUp, true)
          // A press outside the window or card dismisses it.
          document.addEventListener('pointerdown', onOuterPointerDown, true)
          document.addEventListener('keydown', onPopupKeydown, true)
          window.addEventListener('scroll', scheduleRepaint, true)
          // Scrolling or resizing closes the selection card, like the old popup.
          window.addEventListener('scroll', onPopupDismiss, true)
        }
      } catch {
        /* no document (checks drive the runtime directly) */
      }
      /**
       * Whether one mutation batch touched a flow item: added one, removed one
       * or re-keyed it. Only those can bring back a passage whose row is gone,
       * so only they raise the generation the recovery search waits for.
       */
      function flowAnchorsChanged(records) {
        for (const record of records) {
          if (record?.type === 'attributes') return true
          for (const list of [record?.addedNodes, record?.removedNodes]) {
            if (!list) continue
            for (const node of list) {
              if (node?.nodeType !== 1) continue
              if (node.matches?.(ANCHOR_SELECTOR) === true) return true
              if (typeof node.querySelector === 'function' && node.querySelector(ANCHOR_SELECTOR) !== null) {
                return true
              }
            }
          }
        }
        return false
      }

      try {
        if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
          highlightObserver = new MutationObserver(onTranscriptMutation)
          highlightObserver.observe(document.documentElement ?? document.body, {
            childList: true,
            subtree: true,
            // A streamed answer edits text in place: that changes a row's text too.
            characterData: true,
            // Rows are re-keyed in place when a turn stops streaming.
            attributes: true,
            attributeFilter: ['data-chat-anchor-key'],
          })
        }
      } catch {
        /* no observer */
      }
      refreshWorld()
      // The Host half holds the durable copy of every preference; adopting it
      // is what makes the settings survive an app restart (the GUI's loopback
      // port changes, so `localStorage` is a different origin after a restart).
      try {
        Promise.resolve(hydrateFromHost()).catch(() => {})
      } catch {
        /* no Host half (preview page, check harness) */
      }

      /** Release every subscription and in-flight request. */
      function dispose() {
        flushSettingsMirror()
        cancelPendingCapture()
        pointerHeld = false
        endWaiting()
        for (const off of offs) {
          try {
            off?.()
          } catch {
            /* already disposed */
          }
        }
        offs.length = 0
        stopSettingsWait()
        window.removeEventListener('resize', onResize)
        window.removeEventListener('pagehide', onPageHide)
        try {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange)
            document.removeEventListener('focusin', syncComposerFocus, true)
            document.removeEventListener('focusout', syncComposerFocus, true)
            document.removeEventListener('pointerdown', onPointerGestureDown, true)
            document.removeEventListener('pointerup', onPointerGestureUp, true)
            document.removeEventListener('pointercancel', onPointerGestureUp, true)
            window.removeEventListener('blur', onPointerGestureUp)
            document.removeEventListener('mouseup', captureSelectionLater, true)
            document.removeEventListener('keyup', onSelectionKeyup, true)
            document.removeEventListener('selectionchange', onSelectionChange, true)
            document.removeEventListener('click', onTranscriptClick, true)
            document.removeEventListener('mousedown', onExtendPointerDown, true)
            document.removeEventListener('mousemove', onExtendPointerMove, true)
            document.removeEventListener('mouseup', onExtendPointerUp, true)
            document.removeEventListener('pointerdown', onOuterPointerDown, true)
            document.removeEventListener('keydown', onPopupKeydown, true)
            window.removeEventListener('scroll', scheduleRepaint, true)
            window.removeEventListener('scroll', onPopupDismiss, true)
          }
        } catch {
          /* no document */
        }
        insertion.dispose()
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        if (attentionTimer !== undefined) clearTimeout(attentionTimer)
        if (repaintTimer !== undefined) clearTimeout(repaintTimer)
        try {
          highlightObserver?.disconnect()
        } catch {
          /* already gone */
        }
        try {
          window.CSS?.highlights?.delete(HIGHLIGHT_NAME)
          window.CSS?.highlights?.delete(ANSWER_HIGHLIGHT)
          window.CSS?.highlights?.delete(CAPTURE_HIGHLIGHT)
        } catch {
          /* no highlight registry */
        }
        highlighted = []
        resetAnchorRecovery()
        listeners.clear()
      }

      return {
        subscribe,
        getSnapshot,
        text,
        ask,
        /** Turbo double-click: append when a draft exists, else send. */
        runPreset,
        /** Append one prompt to the composer draft, on its own line. */
        insertPreset,
        /** One press on a bar chip: append, counting the insert unless a second press follows. */
        appendPrompt,
        /** Two presses on a bar chip: send the composed draft, clear it on success. */
        sendDraft,
        setDelivery,
        effectiveDelivery,
        setTurbo,
        setPreset,
        addPreset,
        updatePreset,
        removePreset,
        movePreset,
        movePresetTo,
        /** Window drag: drop one prompt before or after another. */
        movePresetBeside,
        resetPresets,
        togglePresetOpen,
        setPresetsOpen,
        startPresetEdit,
        cancelPresetEdit,
        /** Enable / disable one prompt without deleting it. */
        setPresetEnabled,
        togglePresetEnabled,
        /** Pin / unpin one prompt on the composer's own row. */
        setPresetPinned,
        /** In-window "new prompt" form (title + body). */
        startNudgeDraft,
        cancelNudgeDraft,
        setNudgeDraftLabel,
        setNudgeDraftText,
        saveNudgeDraft,
        /** In-window 编辑 mode: reorder by drag, change one prompt in place. */
        setNudgeEditing,
        startNudgeEdit,
        cancelNudgeEdit,
        setNudgeEditLabel,
        setNudgeEditText,
        saveNudgeEdit,
        importPresets,
        exportPresets,
        setCollapsed,
        moveTo,
        saveUi,
        openSettings,
        closeSettings,
        /** One sample of the shell's settings seams, kept in the durable record. */
        probeSettingsSeams,
        /** Note that the gear itself was reached, before any shell seam runs. */
        noteSettingsPress: () => recordSettingsDiag({ event: 'gear', ...probeSettings() }),
        /** Composer bridge hooks (session input overlay). */
        attachComposer,
        detachComposer,
        /** Annotation tray. */
        captureSelection,
        /** The notes still waiting to be written into a message. */
        pendingAnnotations,
        popupPosition,
        editPopupPosition,
        setQuick,
        setAutoPaste,
        setFrame,
        addTip,
        addTips,
        updateTip,
        removeTip,
        moveTip,
        moveTipTo,
        startTipEdit,
        cancelTipEdit,
        resetTips,
        advanceTip,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        /** Whether one DOM node belongs to this window's own chrome. */
        isSelfNode,
        showTip,
        hideTip,
        addAnnotation,
        markAsAnswer,
        quickReply,
        copyDraftQuote,
        startEditAnnotation,
        saveEditedAnnotation,
        cancelAnnotationEdit,
        dismissAnnotationDraft,
        removeAnnotation,
        writeAnnotations,
        sendAnnotations,
        dispose,
        /** @internal exposed for scripts/check-client.mjs */
        _debug: {
          state: () => state,
          chipSlotAt,
          syncComposerFocus,
          settingsSnapshot,
          applySettingsStore,
          commitSettingsToHost,
          hydrateFromHost,
          /** Every setting row's name: the fields the Host record must keep. */
          settingsNames: () => SETTINGS.map((row) => row.name),
          /** The two shipped dictionaries, for the key-set invariants. */
          locales: () => ({ zh: ZH, en: EN }),
        },
      }
    }

    // ---------------------------------------------------------------------
    // view
    // ---------------------------------------------------------------------

export { createRuntime }
