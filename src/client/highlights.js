/**
 * The painted marks: anchors, the repaint pass and the transcript hooks.
 *
 * Anchors found again by text, one repaint per frame-ish task, answers in their
 * own registry — all of it lives here. The window state is read through
 * `getState`; the runtime keeps the annotations and the diagnostics.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import {
  ANCHOR_SELECTOR,
  ANSWER_HIGHLIGHT,
  CAPTURE_HIGHLIGHT,
  CONTEXT_CHARS,
  HIGHLIGHT_NAME,
  MISS_RESCAN_MS,
  MODAL_SELECTOR,
} from './constants.js'
import { anchorFromQuote, locateAnchor, packedMapOf, packedText, rangeFromPacked, sameRanges } from './dom.js'
import { rectValue } from './geometry.js'

    /**
     * Build the highlight layer over one runtime.
     *
     * @param deps - getState, flowAnchorsChanged, startEditAnnotation, inEditable.
     * @returns the repaint entry points and the transcript subscriptions.
     */
    function createHighlights(deps) {
      const { getState, flowAnchorsChanged, startEditAnnotation, inEditable } = deps

      let repaintTimer
      let handle
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

      /** Forget every recovered anchor; the next repaint starts from the stored ones. */
      function resetAnchorRecovery() {
        resolvedAnchors.clear()
        quoteAnchors.clear()
        searchEpoch = -1
        searchAt = 0
      }

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
          const captureDraft = getState().annotationDraft
          const captureAnchor =
            captureDraft !== null && captureDraft.anchor != null ? captureDraft.anchor : null
          const sources = getState().annotations
          if (getState().quick !== true || (sources.length === 0 && captureDraft === null)) {
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
        if (repaintTimer !== undefined || getState().quick !== true) return
        // Nothing painted and nothing being captured: a streaming transcript
        // mutates the DOM constantly, and this runs on every mutation.
        if (getState().annotations.length === 0 && getState().annotationDraft === null) return
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
        if (getState().quick !== true) return
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
        if (getState().quick !== true || highlighted.length === 0) return
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


      /** Watch the transcript for the renders that move a passage. */
      function observe() {
        if (handle !== undefined) return
        try {
          if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return
          handle = new MutationObserver(onTranscriptMutation)
          handle.observe(document.documentElement ?? document.body, {
            childList: true,
            subtree: true,
            // A streamed answer edits text in place: that changes a row's text too.
            characterData: true,
            // Rows are re-keyed in place when a turn stops streaming.
            attributes: true,
            attributeFilter: ['data-chat-anchor-key'],
          })
        } catch {
          handle = undefined
        }
      }

      /** Stop the observer and the pending repaint when the runtime goes away. */
      function dispose() {
        if (repaintTimer !== undefined) {
          clearTimeout(repaintTimer)
          repaintTimer = undefined
        }
        try {
          handle?.disconnect()
        } catch {
          /* already gone */
        }
        handle = undefined
        highlighted = []
      }

      return {
        resetAnchorRecovery,
        repaintHighlights,
        scheduleRepaint,
        onTranscriptClick,
        observe,
        dispose,
      }
    }

export { createHighlights }
