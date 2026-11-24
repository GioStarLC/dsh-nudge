/**
 * Where the floating window sits and how it folds into the pill.
 *
 * The anchor of a pointer fold lives here, not in the persisted record: a
 * reload starts from the pill's own spot.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { PILL_SIZE, UI_KEY } from './constants.js'
import { clampPoint, isPoint } from './geometry.js'
import { readJson, writeJson } from './storage.js'

    /**
     * Build the card placement over one runtime.
     *
     * @param deps - getState, setState.
     * @returns collapse/move and the UI write.
     */
    function createCardPlacement(deps) {
      const { getState, setState } = deps

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
        if (getState().collapsed === value) return
        let pos = clampPoint(getState().pos, value)
        if (value === true && isPoint(point)) {
          cardAnchor = getState().pos
          pos = clampPoint({ x: point.x - PILL_SIZE / 2, y: point.y - PILL_SIZE / 2 }, true)
        }
        if (value === false) {
          if (cardAnchor !== null) pos = clampPoint(cardAnchor, false)
          cardAnchor = null
        }
        setState({
          collapsed: value,
          settingsOpen: value ? false : getState().settingsOpen,
          unread: value ? getState().unread : false,
          pos,
        })
        saveUi()
      }

      /** Move the window while dragging (not persisted until drop). */
      function moveTo(x, y) {
        // A pill dragged elsewhere is the anchor the next unfold starts from:
        // the spot the card was folded at no longer applies.
        if (getState().collapsed) cardAnchor = null
        setState({ pos: clampPoint({ x, y }, getState().collapsed) })
      }

      /** Persist the current window state. */
      function saveUi() {
        // Keep keys this build does not own (an older record may carry more).
        writeJson(UI_KEY, { ...(readJson(UI_KEY) ?? {}), collapsed: getState().collapsed, pos: getState().pos })
      }

      /** Forget the fold's anchor: a reloaded window starts from the pill. */
      function resetCardAnchor() {
        cardAnchor = null
      }

      return {
        setCollapsed,
        moveTo,
        saveUi,
        resetCardAnchor,
      }
    }

export { createCardPlacement }
