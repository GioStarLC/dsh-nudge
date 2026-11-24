/**
 * Where the annotation cards hang: the pointer, the viewport box, the close.
 *
 * The card is fixed to the release point or the quote box; this module owns
 * only the geometry of that placement and the outside-click dismissal.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { SELF_SELECTOR } from './constants.js'
import { viewport } from './geometry.js'

    /**
     * Build the popup placement over one runtime.
     *
     * @param deps - getState, setState, closeAnnotationSurface.
     * @returns the two placement styles and the dismissal handlers.
     */
    function createPopup(deps) {
      const { getState, setState, closeAnnotationSurface, cancelPendingCapture } = deps

      /**
       * Whether a pointer that ended a selection is plausibly next to it.
       *
       * A `mouseup` is document-wide, so it can belong to a click that has
       * nothing to do with the live selection (a sidebar click that does not
       * collapse it, a drag that ends outside the transcript). Anchoring the
       * card to such a pointer puts it wherever that click happened; the quote
       * box is the only trustworthy anchor then.
       */
      function pointerNearRect(pointer, rect, slack = 24) {
        if (!pointer || !rect) return false
        return (
          pointer.x >= rect.left - slack &&
          pointer.x <= rect.right + slack &&
          pointer.y >= rect.top - slack &&
          pointer.y <= rect.bottom + slack
        )
      }

      /**
       * Viewport box for the selection card.
       *
       * A mouse selection ends on the release point, so the card opens above it
       * with its first button — 定为答案 — centred on that point: the next click
       * lands without moving the mouse. When the card does not fit above the
       * point, or the pointer belongs to a click elsewhere, it falls back to the
       * quote box, centred above/below it.
       */
      function popupPosition() {
        const draft = getState().annotationDraft
        const width = 340
        const margin = 8
        const approxHeight = 280
        // Border + padding + half the first button: the button's centre sits
        // this far inside the card. The card is pinned by its bottom edge, so
        // the same measure vertically needs no card height.
        const answerInsetX = 44
        const answerInsetY = 24
        const vw = viewport().width
        const boxWidth = Math.min(width, vw - margin * 2)
        const rect = draft?.rect ?? null
        const pointer = pointerNearRect(draft?.pointer, rect) ? draft.pointer : null
        const clampX = (value) => Math.max(margin, Math.min(value, vw - boxWidth - margin))
        if (pointer) {
          const { x, y } = pointer
          const leftValue = clampX(x - answerInsetX)
          const top = y + answerInsetY
          if (top - approxHeight >= margin) {
            return {
              left: `${Math.round(leftValue)}px`,
              top: `${Math.round(top)}px`,
              transformOrigin: `${Math.round(Math.max(0, Math.min(x - leftValue, boxWidth)))}px 100%`,
              transform: 'translateY(-100%)',
            }
          }
        }
        return placeOverRect(rect, approxHeight)
      }

      /**
       * Place a 340-wide card over one viewport box: centred on it, above when
       * there is room, otherwise below and clamped into the viewport. Without a
       * box it parks in the top-right corner.
       */
      function placeOverRect(rect, approxHeight) {
        const width = 340
        const margin = 8
        const gap = 10
        const vw = viewport().width
        const vh = viewport().height
        const boxWidth = Math.min(width, vw - margin * 2)
        const clampX = (value) => Math.max(margin, Math.min(value, vw - boxWidth - margin))
        if (!rect) {
          return {
            left: `${Math.max(margin, vw - boxWidth - margin)}px`,
            top: '96px',
            transformOrigin: '0px 0px',
            transform: 'none',
          }
        }
        // A stored quote box may lack width (an older draft); NaN here would
        // invalidate `left` and leave the card at the overlay's origin.
        const rectWidth = Number.isFinite(rect.width) ? rect.width : rect.right - rect.left
        const anchorX = rect.left + rectWidth / 2
        const left = clampX(anchorX - boxWidth / 2)
        const origin = {
          transformOrigin: `${Math.round(Math.max(0, Math.min(anchorX - left, boxWidth)))}px 0px`,
        }
        if (rect.top - gap - approxHeight >= margin) {
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(rect.top - gap)}px`,
            ...origin,
            transform: 'translateY(-100%)',
          }
        }
        const below = rect.bottom + gap
        const top = Math.min(below, Math.max(margin, vh - approxHeight - margin))
        return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, ...origin, transform: 'none' }
      }

      /** Where the in-place note editor hangs: over the box that opened it. */
      function editPopupPosition() {
        return placeOverRect(getState().annotationEditRect, 220)
      }

      /**
       * Close the selection card, dropping its draft. The native selection is
       * left alone: a press outside the card is not a request to stop selecting.
       * Committing a note clears the native selection in addAnnotation().
       */
      function closePopup() {
        const draft = getState().annotationDraft
        if (draft === null && getState().annotationEditingId === null) return false
        if (typeof document !== 'undefined' && document.activeElement?.closest?.(SELF_SELECTOR)) {
          try {
            /** @type {HTMLElement} */ (document.activeElement).blur()
          } catch {
            /* nothing focused */
          }
        }
        return closeAnnotationSurface()
      }

      /**
       * A press anywhere outside the card closes it: the popup owns no focus
       * until its own field is clicked, so a click elsewhere is just the
       * reader moving on. A Shift+press is the exception: it extends the
       * captured passage, so the draft and its anchor must survive.
       */
      function onOuterPointerDown(event) {
        cancelPendingCapture()
        if (getState().quick !== true) return
        if (getState().annotationDraft === null && getState().annotationEditingId === null) return
        if (event?.shiftKey === true && getState().annotationDraft !== null) return
        const target = event.target
        if (target && typeof target.closest === 'function' && target.closest(SELF_SELECTOR)) return
        closePopup()
      }

      /** Scroll and Escape close the selection card, like the old popup did. */
      function onPopupDismiss(event) {
        // Scrolling inside the card's own field/list must not dismiss it.
        if (
          event &&
          event.target &&
          typeof event.target.closest === 'function' &&
          event.target.closest(SELF_SELECTOR)
        ) {
          return
        }
        // A scroll that trails the release (smooth scrolling, auto-scroll while
        // dragging) is not a request to stop: a pending capture is left alone.
        // A card that is already open stows itself instead of dropping the
        // passage, so a following Shift+press can still extend it.
        if (getState().annotationDraft === null) return
        if (getState().annotationCardHidden === true) return
        setState({ annotationCardHidden: true })
      }

      return {
        pointerNearRect,
        popupPosition,
        placeOverRect,
        editPopupPosition,
        closePopup,
        onOuterPointerDown,
        onPopupDismiss,
      }
    }

export { createPopup }
