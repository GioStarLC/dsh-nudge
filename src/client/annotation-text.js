/**
 * The annotation text layer: quotes, the answer line and block spacing.
 *
 * Pure formatting. The locale's answer label is passed in, so this module has
 * no state and no runtime.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */

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
      function annotationNoteLine(item, answerLabel) {
        const note = typeof item.note === 'string' ? item.note.trim() : ''
        return note === '' ? '' : `${answerLabel}${note}`
      }

      /**
       * One annotation as the Markdown block it becomes when it is sent: the
       * quote on its own lines, the answer on the line right below it.
       */
      function annotationBlock(item, answerLabel) {
        const quoted = quoteMarkdown(item.quote)
        const note = annotationNoteLine(item, answerLabel)
        return note === '' ? quoted : `${quoted}\n${note}`
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


export { tidyQuote, quoteMarkdown, annotationNoteLine, annotationBlock, blockBreak }
