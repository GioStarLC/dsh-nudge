/**
 * Writing the pending annotations into the composer, or sending them.
 *
 * The payload is a batch of Markdown blocks; the write prefers the shell's own
 * quote preview and falls back to text. Counters and the tray update are the
 * only side effects.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
    /**
     * Build the batch writer over one runtime.
     *
     * @param deps - getState, setState, text, pendingAnnotations, annotationsText,
     *   tidyQuote, annotationNoteLine, blockBreak, countStat, deliver,
     *   composerHandle, commitAnnotations.
     * @returns the write path, the send path and the caret splice they share.
     */
    function createQuoteWriting(deps) {
      const {
        getState,
        setState,
        text,
        pendingAnnotations,
        annotationsText,
        tidyQuote,
        annotationNoteLine,
        blockBreak,
        countStat,
        deliver,
        composerHandle,
        commitAnnotations,
      } = deps

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
        const marked = getState().annotations.map((item) =>
          ids.has(item.id) ? { ...item, written: true } : item,
        )
        commitAnnotations(marked, { note: '', error: '' })
        return true
      }

      /** Send the pending annotations as one user message. */
      function sendAnnotations() {
        if (getState().phase === 'waiting') return false
        const pending = pendingAnnotations()
        if (pending.length === 0) return false
        const body = annotationsText(pending)
        if (body === '') return false
        if (!deliver(body)) return false
        // What was just sent lives in the conversation now; the notes already
        // written into the draft keep their marks.
        const ids = new Set(pending.map((item) => item.id))
        const next = getState().annotations.filter((item) => !ids.has(item.id))
        commitAnnotations(next)
        return true
      }

      return {
        spliceAtCaret,
        writeQuotedBatch,
        writeAnnotations,
        sendAnnotations,
      }
    }

export { createQuoteWriting }
