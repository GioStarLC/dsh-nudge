/**
 * Shift+drag: growing or shrinking the captured passage before it is saved.
 *
 * The extension works on the live DOM range the capture keeps, and the card
 * follows it; this module owns the drag state and the caret lookup.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { EDITABLE_SELECTOR, MODAL_SELECTOR, SELF_SELECTOR } from './constants.js'
import { anchorFromRange } from './dom.js'
import { viewport } from './geometry.js'

    /**
     * Build the extension drag over one runtime.
     *
     * @param deps - getState, settleAnnotation, closePopup, text.
     * @returns the pointer handlers, the caret probe and the key gate.
     */
    function createSelectionExtension(deps) {
      const {
        getState,
        settleAnnotation,
        closePopup,
        text,
        tidyQuote,
        notify,
        cancelAnnotationEdit,
        copyDraftQuote,
        closeSettings,
      } = deps

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
        const draft = getState().annotationDraft
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
        if (getState().quick !== true || event?.shiftKey !== true) return
        const draft = getState().annotationDraft
        if (draft === null || getState().annotationEditingId !== null) return
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
        if (getState().annotationDraft === null) return false
        if (event.ctrlKey !== true && event.metaKey !== true) return false
        if (event.altKey === true || event.shiftKey === true) return false
        return typeof event.key === 'string' && event.key.toLowerCase() === 'c'
      }

      function onPopupKeydown(event) {
        if (event?.key === 'Escape' && getState().settingsOpen) {
          event.preventDefault()
          closeSettings()
          return
        }
        if (event?.key === 'Escape' && getState().annotationDraft !== null) {
          event.preventDefault()
          closePopup()
          return
        }
        if (event?.key === 'Escape' && getState().annotationEditingId !== null) {
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

      return {
        extending,
        extendAnchor,
        caretRangeAt,
        extendTo,
        onExtendPointerDown,
        onExtendPointerMove,
        onExtendPointerUp,
        fieldHasSelection,
        copyShortcutActive,
        onPopupKeydown,
      }
    }

export { createSelectionExtension }
