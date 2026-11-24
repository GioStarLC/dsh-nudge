/**
 * Window geometry: docks, clamping, edge snapping and chip slots.
 *
 * Pure math over the viewport and measured boxes; no state and no DOM writes.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { CARD_WIDTH, COMPOSER_RESERVE, DOCK_TOP, EDGE, PILL_SIZE } from './constants.js'

    /** Clamp a number into an inclusive range. */
    function clamp(value, min, max) {
      const low = Math.min(min, max)
      const high = Math.max(min, max)
      return Math.min(high, Math.max(low, value))
    }

    /**
     * The insertion point a pointer at (`x`, `y`) asks for among `boxes`,
     * counting every box it has passed in reading order: top to bottom, then
     * left to right. The boxes must be frozen for the whole drag — re-reading
     * them after a reorder is what made a wide chip re-wrap the row and flip the
     * slot back and forth under a still pointer.
     * @param boxes - `{ id, left, top, width, height }` in reading order.
     * @param id - the dragged chip, which is not a slot of its own.
     */
    function chipSlotAt(boxes, id, x, y) {
      let index = 0
      for (const box of boxes) {
        if (box.id === id) continue
        const below = y > box.top + box.height
        const sameRow = y >= box.top && y <= box.top + box.height
        if (below || (sameRow && x > box.left + box.width / 2)) index += 1
      }
      return index
    }

    /** Current viewport, with sane minimums for the first paint. */
    function viewport() {
      return {
        width: Math.max(320, window.innerWidth || 1280),
        height: Math.max(320, window.innerHeight || 800),
      }
    }

    /**
     * Horizontal inset reserved on the right.
     *
     * The right sidebar (shipped column) is an absolutely positioned panel over
     * the conversation's right edge; a floating window docked at the viewport
     * edge would cover it while it is open. The panel publishes its own width
     * as `--dsh-sidebar-width`, so the first dock position steps left of it.
     * This is host layout chrome, not another plugin's DOM: when the query or
     * the variable is unavailable the dock simply stays at the plain margin.
     */
    function rightInset() {
      let inset = EDGE
      try {
        const panel = document.querySelector('[data-sidebar-right-open]')
        if (panel) {
          const raw = window.getComputedStyle(panel).getPropertyValue('--dsh-sidebar-width').trim()
          const width = Number.parseFloat(raw)
          if (Number.isFinite(width) && width > 0) inset += width
        }
      } catch {
        /* layout unavailable: keep the plain margin */
      }
      return inset
    }

    /** First-run dock position: right, above the composer, clear of the right sidebar. */
    function dockPosition(collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const height = collapsed ? PILL_SIZE : 220
      return {
        x: Math.round(clamp(vp.width - width - rightInset(), 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(DOCK_TOP, 8, Math.max(8, vp.height - height - 8))),
      }
    }

    /** Clamp one stored position into the current viewport. */
    function clampPoint(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const height = collapsed ? PILL_SIZE : Math.min(360, Math.max(180, vp.height - COMPOSER_RESERVE - 16))
      const maxY = collapsed
        ? Math.max(8, vp.height - height - 8)
        : Math.max(8, vp.height - height - COMPOSER_RESERVE)
      return {
        x: Math.round(clamp(point.x, 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(point.y, 8, maxY)),
      }
    }

    /** Whether the window sits closer to the left edge than to the right one. */
    function nearestEdge(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      return point.x + width / 2 <= vp.width / 2 ? 'left' : 'right'
    }

    /**
     * Pin a stored point to the side it belongs to.
     *
     * Only the vertical spot is the user's: the horizontal one is the edge, so
     * a window left somewhere in the middle of a wider or narrower screen still
     * comes back on a side instead of floating over the conversation.
     */
    function snapToEdge(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const edge = nearestEdge(point, collapsed)
      const x = edge === 'left' ? EDGE : vp.width - width - rightInset()
      return clampPoint({ x, y: point.y }, collapsed)
    }

    /** Whether a stored value looks like a point. */
    function isPoint(point) {
      return (
        point !== null &&
        typeof point === 'object' &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      )
    }

    /**
     * A DOMRect-like box as plain numbers, or null when it is not a usable box.
     * The in-place editor keeps one of these instead of a live DOMRect, so a
     * re-render never reads geometry off a detached node.
     */
    function rectValue(box) {
      if (box === null || typeof box !== 'object') return null
      const left = Number(box.left)
      const top = Number(box.top)
      const right = Number(box.right)
      const bottom = Number(box.bottom)
      const width = Number.isFinite(Number(box.width)) ? Number(box.width) : right - left
      const height = Number.isFinite(Number(box.height)) ? Number(box.height) : bottom - top
      const values = [left, top, right, bottom, width, height]
      if (values.some((value) => Number.isFinite(value) === false)) return null
      return { left, top, right, bottom, width, height }
    }

    // ---------------------------------------------------------------------
    // runtime: state + delivery, independent of the view
    // ---------------------------------------------------------------------

export { clamp, chipSlotAt, viewport, rightInset, dockPosition, clampPoint, nearestEdge, snapToEdge, isPoint, rectValue }
