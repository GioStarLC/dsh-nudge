/**
 * The annotation surfaces: the selection card, the in-place editor and the tray.
 *
 * One state machine over three surfaces is the whole point of this module: a
 * card and an editor never coexist, and every closing path returns the same
 * fields to rest. The window state arrives through `getState`; persistence,
 * counters, toast text and the repaint stay callbacks.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import {
  ANCHOR_SELECTOR,
  EDITABLE_SELECTOR,
  IDLE_ANNOTATION,
  MODAL_SELECTOR,
  FLASH_HOLD_MS,
  SELF_SELECTOR,
} from './constants.js'
import { anchorFromQuote, anchorFromRange, packedText, passagesOfRange, phraseOfPassage } from './dom.js'
import { rectValue, viewport } from './geometry.js'
import { annotationBlock, annotationNoteLine, blockBreak, quoteMarkdown, tidyQuote } from './annotation-text.js'
import { saveNotesOfSession } from './notes.js'
import { frameLabelKey, isFrameWidth } from './settings.js'

    /**
     * Build the annotation surfaces over one runtime.
     *
     * @param deps - getState, setState, text, countStat, persistSetting,
     *   repaintHighlights, sessionId.
     * @returns every action the window, the tray and the key handlers call.
     */
    function createAnnotations(deps) {
      const { getState, setState, text, countStat, persistSetting, repaintHighlights, sessionId, recordAnchorMiss } = deps

      // --- annotations ----------------------------------------------------

      /** The text helpers take the label; the callers of this module don't. */
      const noteLine = (item) => annotationNoteLine(item, text('answerLabel'))
      const markdownBlock = (item) => annotationBlock(item, text('answerLabel'))


      /** The annotations still waiting to be written into a message. */
      function pendingAnnotations() {
        return getState().annotations.filter((item) => item.written !== true)
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
        return items.map(markdownBlock).join('\n\n\n')
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
      /** True while a pointer gesture is down, so no card opens mid-drag. */
      let pointerHeld = false
      /** Clicks behind the live selection: 2 is a double-click word pick. */
      let clickCount = 0

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
        if (getState().quick !== true) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        const pointer =
          event && typeof event.clientX === 'number' && typeof event.clientY === 'number'
            ? { x: event.clientX, y: event.clientY }
            : null
        // Kept until the capture runs: the pointer path and the safety net both
        // read it, and the safety net has no event of its own.
        if (event && typeof event.detail === 'number') clickCount = event.detail
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
        if (getState().quick !== true) return
        if (event?.shiftKey !== true) return
        if (inEditable(event?.target)) return
        if (inEditable(document.activeElement)) return
        clickCount = 0
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
        clickCount = 0
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
        if (getState().quick !== true) return
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
          getState().annotationDraft !== null &&
          getState().annotationDraft.quote === selection.quote &&
          getState().annotationEditingId === null
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
        // Whether the selection is a phrase of one paragraph, heading or list
        // item: only then does the card park its first button under the release point.
        // A whole passage, a code block, a table cell, a multi-block selection
        // or a double-clicked word keeps the card off the pointer.
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
            phrasePassage: clickCount < 2 && phraseOfPassage(selection.range, selection.quote),
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
        if (getState().tip !== null) setState({ tip: null })
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
        return sessionId()
      }

      /** Persist the tray of the owning Session. */
      function persistNotes(list) {
        saveNotesOfSession(noteSessionId(), Array.isArray(list) ? list : getState().annotations)
      }

      /** Commit the pending quote + note into the tray. */
      function addAnnotation(noteOverride) {
        const draft = getState().annotationDraft
        if (!draft || typeof draft.quote !== 'string' || draft.quote.trim() === '') return false
        const note =
          typeof noteOverride === 'string'
            ? noteOverride
            : typeof getState().annotationNote === 'string'
              ? getState().annotationNote.trim()
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
        const next = [...getState().annotations, annotation]
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
        const draft = getState().annotationDraft
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
          ...getState().annotations.filter((item) => packedText(item.quote) !== packed),
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
        const remark = typeof getState().annotationNote === 'string' ? getState().annotationNote.trim() : ''
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
        const item = getState().annotations.find((candidate) => candidate.id === id)
        if (item === undefined) return false
        const box = rectValue(rect)
        if (getState().annotationEditingId === id) {
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
        if (getState().annotationEditingId === null) return false
        const note = typeof getState().annotationNote === 'string' ? getState().annotationNote.trim() : ''
        const next = getState().annotations.map((item) =>
          item.id === getState().annotationEditingId ? { ...item, note } : item,
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
        const next = getState().annotations.filter((item) => item.id !== id)
        if (next.length === getState().annotations.length) return false
        // Removing the note under the editor closes it; removing any other note
        // leaves the editor and whatever was typed in it alone.
        persistNotes(next)
        if (getState().annotationEditingId === id) closeAnnotationSurface({ annotations: next })
        else settleAnnotation({ annotations: next })
        return true
      }

      /**
       * Copy the captured passage. Resolves to whether the clipboard took it;
       * the card reports that in place, the way ds-popup's copy button does.
       */
      function copyDraftQuote() {
        const quote = getState().annotationDraft?.quote
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

      /** Drop the pending timers when the runtime goes away. */
      function dispose() {
        pointerHeld = false
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        if (attentionTimer !== undefined) clearTimeout(attentionTimer)
        if (flashTimer !== undefined) clearTimeout(flashTimer)
        selectionTimer = undefined
        attentionTimer = undefined
        flashTimer = undefined
      }

      return {
        tidyQuote,
        quoteMarkdown,
        annotationNoteLine: noteLine,
        annotationBlock: markdownBlock,
        pendingAnnotations,
        settleAnnotation,
        closeAnnotationSurface,
        commitAnnotations,
        isSelfNode,
        annotationsText,
        blockBreak,
        inEditable,
        readSelection,
        cancelPendingCapture,
        captureSelectionLater,
        onSelectionKeyup,
        onPointerGestureDown,
        onPointerGestureUp,
        onSelectionChange,
        pulse,
        notify,
        captureSelection,
        clearNativeSelection,
        setQuick,
        setAutoPaste,
        showTip,
        hideTip,
        setFrame,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        noteSessionId,
        persistNotes,
        addAnnotation,
        markAsAnswer,
        quickReply,
        dismissAnnotationDraft,
        startEditAnnotation,
        saveEditedAnnotation,
        cancelAnnotationEdit,
        removeAnnotation,
        copyDraftQuote,
        dispose,
      }
    }

export { createAnnotations }
