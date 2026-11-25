/**
 * Reading the transcript: packed text and quote anchors.
 *
 * Selection anchors survive a repaint because they are found again by text, not by node.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANCHOR_SELECTOR, CONTEXT_CHARS, MAX_OCCURRENCES, WHOLE_PASSAGE_RATIO } from './constants.js'

    /** The element a DOM node belongs to, or null. */
    function elementOfNode(node) {
      if (!node) return null
      return node.nodeType === 1 ? node : (node.parentElement ?? null)
    }

    /** Tags whose text must not be projected. */
    const NON_TEXT_TAGS = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true }

    /** Whether an element's subtree is invisible and must not be walked. */
    function isHiddenElement(element) {
      if (NON_TEXT_TAGS[element.tagName] === true) return true
      if (element.hidden === true) return true
      try {
        const style = window.getComputedStyle?.(element)
        return style ? style.display === 'none' || style.visibility === 'hidden' : false
      } catch {
        return false
      }
    }

    /** Whitespace-free projection both sides of an anchor are compared on. */
    function packedText(value) {
      // The per-character `trim()` test this replaces kept exactly the
      // non-whitespace code units; one regular expression is much cheaper on
      // the long quotes and long rows this runs over.
      return (typeof value === 'string' ? value : '').replace(/\s+/g, '')
    }

    /** Every visible kept character under a root, with its (node, offset) pair. */
    function packedMapOf(root) {
      let packed = ''
      const map = []
      const walk = (node) => {
        const children = node.childNodes
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index]
          if (child.nodeType === 3) {
            const data = child.data
            for (let offset = 0; offset < data.length; offset += 1) {
              const ch = data.charAt(offset)
              if (ch.trim() === '') continue
              packed += ch
              map.push(child, offset)
            }
          } else if (child.nodeType === 1) {
            if (isHiddenElement(child)) continue
            walk(child)
          }
        }
      }
      walk(root)
      return { packed, map }
    }

    /**
     * Tags whose text reads as one passage. A selection inside one of these is
     * promoted to the whole block, so the highlight covers the paragraph the
     * words sit in rather than the words alone.
     */
    /** Tags whose phrase keeps the one-click 记为答案 shortcut. */
    const PHRASE_TAGS = {
      P: true,
      LI: true,
      H1: true,
      H2: true,
      H3: true,
      H4: true,
      H5: true,
      H6: true,
    }

    const PASSAGE_TAGS = {
      P: true,
      LI: true,
      H1: true,
      H2: true,
      H3: true,
      H4: true,
      H5: true,
      H6: true,
      BLOCKQUOTE: true,
      PRE: true,
      TD: true,
      TH: true,
      DT: true,
      DD: true,
      FIGCAPTION: true,
    }

    /** Whether a range touches one node; a node that cannot be asked is skipped. */
    function rangeTouches(range, node) {
      try {
        return typeof range.intersectsNode === 'function' && range.intersectsNode(node) === true
      } catch {
        return false
      }
    }

    /** The innermost passage tag between a node and its flow item. */
    function passageBlockOf(node, flowItem) {
      let element = elementOfNode(node)
      while (element !== null && element !== flowItem) {
        if (PASSAGE_TAGS[String(element.tagName ?? '').toUpperCase()] === true) return element
        element = element.parentElement ?? null
      }
      return flowItem
    }

    /** The text one block carries, with only its trailing whitespace dropped. */
    function blockTextOf(block) {
      let text = ''
      const walk = (node) => {
        for (const child of node.childNodes ?? []) {
          if (child.nodeType === 3) text += child.data ?? ''
          else if (child.nodeType === 1 && !isHiddenElement(child)) walk(child)
        }
      }
      walk(block)
      return text.replace(/\s+$/, '')
    }

    /** The innermost passage blocks a selection touches, in document order. */
    function passageBlocksOf(range) {
      const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
      const blocks = []
      for (const element of elements) {
        const walk = (node) => {
          for (const child of node.childNodes ?? []) {
            if (child.nodeType === 3) {
              if (!rangeTouches(range, child)) continue
              const block = passageBlockOf(child, element)
              if (!blocks.includes(block)) blocks.push(block)
            } else if (child.nodeType === 1 && !isHiddenElement(child)) {
              walk(child)
            }
          }
        }
        walk(element)
      }
      return blocks.filter(
        (block) => !blocks.some((other) => other !== block && block.contains?.(other) === true),
      )
    }

    /**
     * The whole passages a selection touches, in document order.
     *
     * A selection inside a paragraph names that paragraph; one crossing several
     * names all of them. The innermost block wins, so a list item wrapping a
     * paragraph contributes its words once, and a flow item that carries no
     * block of its own stands for its whole text.
     */
    function passagesOfRange(range) {
      const texts = passageBlocksOf(range).map(blockTextOf).filter((text) => text.trim() !== '')
      return texts.length === 0 ? '' : texts.join('\n\n')
    }

    /**
     * Whether a selection is a phrase picked out of one paragraph, heading or
     * list item.
     *
     * Only then does the 记为答案 button park under the release point: the
     * click that follows a phrase is usually meant to mark it. A whole
     * passage, a table cell, a code block, or a selection crossing several
     * blocks reads as something to copy or quote, so the card keeps off the
     * pointer there. A drag that stops a character or two short still reads as
     * the passage to the eye, hence the ratio rather than an exact match.
     */
    function phraseOfPassage(range, quote) {
      try {
        const blocks = passageBlocksOf(range)
        if (blocks.length !== 1) return false
        const block = blocks[0]
        if (PHRASE_TAGS[String(block.tagName ?? '').toUpperCase()] !== true) return false
        if (typeof block.closest === 'function' && block.closest('table') !== null) return false
        const total = packedText(blockTextOf(block)).length
        if (total === 0) return false
        return packedText(quote).length / total < WHOLE_PASSAGE_RATIO
      } catch {
        return false
      }
    }

    /** A DOM Range covering [start, end) of a packed map, or null. */
    function rangeFromPacked(full, start, end) {
      if (start < 0 || end <= start) return null
      const last = end - 1
      if (last * 2 + 1 >= full.map.length) return null
      try {
        const range = document.createRange()
        range.setStart(full.map[start * 2], full.map[start * 2 + 1])
        range.setEnd(full.map[last * 2], full.map[last * 2 + 1] + 1)
        return range
      } catch {
        return null
      }
    }

    /** Every start index of `needle` inside `haystack`, capped. */
    function occurrencesOf(haystack, needle, limit) {
      const out = []
      if (needle === '') return out
      let at = haystack.indexOf(needle)
      while (at !== -1 && out.length < limit) {
        out.push(at)
        at = haystack.indexOf(needle, at + 1)
      }
      return out
    }

    /** Centre-to-centre distance between two rects. */
    function rectDistance(left, right) {
      const dx = (left.left + left.right) / 2 - (right.left + right.right) / 2
      const dy = (left.top + left.bottom) / 2 - (right.top + right.bottom) / 2
      return Math.sqrt(dx * dx + dy * dy)
    }

    /** The anchor a live selection hangs on, or null outside a flow item. */
    function anchorFromRange(range, quote) {
      const element = elementOfNode(range.commonAncestorContainer)
      if (element === null || typeof element.closest !== 'function') return null
      const anchorElement = element.closest(ANCHOR_SELECTOR)
      if (anchorElement === null) return null
      const packed = packedText(quote)
      if (packed === '') return null
      const full = packedMapOf(anchorElement)
      const candidates = occurrencesOf(full.packed, packed, MAX_OCCURRENCES)
      if (candidates.length === 0) return null
      let target = null
      try {
        target = range.getBoundingClientRect()
      } catch {
        target = null
      }
      let best = null
      for (const index of candidates) {
        const candidateRange = rangeFromPacked(full, index, index + packed.length)
        if (candidateRange === null) continue
        let distance = 0
        if (target !== null) {
          try {
            distance = rectDistance(candidateRange.getBoundingClientRect(), target)
          } catch {
            distance = 0
          }
        }
        if (best === null || distance < best.distance) best = { index, distance }
      }
      if (best === null) return null
      return {
        key: anchorElement.getAttribute('data-chat-anchor-key'),
        quote: packed,
        prefix: full.packed.slice(Math.max(0, best.index - CONTEXT_CHARS), best.index),
        suffix: full.packed.slice(
          best.index + packed.length,
          best.index + packed.length + CONTEXT_CHARS,
        ),
        index: best.index,
      }
    }

    /**
     * The anchor a quote hangs on when no live selection is left: the innermost
     * flow item whose projection carries the passage.
     *
     * This is the recovery path, not the primary one — the anchor of a fresh
     * selection comes from the range. A passage carried by two unrelated flow
     * items stays unanchored, because painting the wrong one is worse than
     * painting none.
     */
    function anchorFromQuote(quote) {
      const packed = packedText(quote)
      if (packed === '') return null
      const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
      const matches = []
      for (const element of elements) {
        const key = element.getAttribute?.('data-chat-anchor-key')
        if (typeof key !== 'string' || key === '') continue
        const full = packedMapOf(element)
        const index = full.packed.indexOf(packed)
        if (index === -1) continue
        matches.push({ element, key, full, index })
      }
      // A turn-process row wraps its member rows, so the deepest match is the
      // one the passage really belongs to.
      const deepest = matches.filter(
        (match) =>
          !matches.some(
            (other) => other !== match && match.element.contains?.(other.element) === true,
          ),
      )
      if (deepest.length !== 1) return null
      const { key, full, index } = deepest[0]
      return {
        key,
        quote: packed,
        prefix: full.packed.slice(Math.max(0, index - CONTEXT_CHARS), index),
        suffix: full.packed.slice(index + packed.length, index + packed.length + CONTEXT_CHARS),
        index,
      }
    }

    /** Whether a painted highlight already covers exactly these ranges, in order. */
    function sameRanges(highlight, ranges) {
      if (!highlight || typeof highlight[Symbol.iterator] !== 'function') return false
      const current = [...highlight]
      if (current.length !== ranges.length) return false
      return current.every((range, index) => {
        const next = ranges[index]
        return (
          range.collapsed !== true &&
          range.startContainer === next.startContainer &&
          range.startOffset === next.startOffset &&
          range.endContainer === next.endContainer &&
          range.endOffset === next.endOffset
        )
      })
    }

    /** Where one stored anchor sits in an anchor element's current projection. */
    function locateAnchor(full, anchor) {
      if (anchor === null || typeof anchor !== 'object') return null
      if (typeof anchor.quote !== 'string' || anchor.quote === '') return null
      const prefix = typeof anchor.prefix === 'string' ? anchor.prefix : ''
      const suffix = typeof anchor.suffix === 'string' ? anchor.suffix : ''
      const candidates = occurrencesOf(full.packed, anchor.quote, MAX_OCCURRENCES)
      if (candidates.length === 0) return null
      let best = null
      for (const index of candidates) {
        let score = 0
        if (prefix !== '' && full.packed.slice(Math.max(0, index - prefix.length), index) === prefix) score += 4
        if (
          suffix !== '' &&
          full.packed.slice(index + anchor.quote.length, index + anchor.quote.length + suffix.length) === suffix
        ) {
          score += 4
        }
        if (typeof anchor.index === 'number') score += Math.max(0, 2 - Math.abs(index - anchor.index) / 200)
        if (best === null || score > best.score) best = { index, score }
      }
      if (best === null) return null
      if (best.score < 4 && candidates.length > 1) return null
      return { start: best.index, end: best.index + anchor.quote.length }
    }

export { elementOfNode, NON_TEXT_TAGS, isHiddenElement, packedText, packedMapOf, passagesOfRange, phraseOfPassage, rangeFromPacked, occurrencesOf, rectDistance, anchorFromRange, anchorFromQuote, sameRanges, locateAnchor }
