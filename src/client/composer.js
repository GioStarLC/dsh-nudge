/**
 * The zero-DOM composer bridge.
 *
 * The input overlay hands the runtime the composer action face; the bridge holds it.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { React } from './react.js'

    /**
     * Zero-DOM registrant in the conversation input overlay. The slot composes
     * the composer's public action face (`inputActions`) and the input store
     * hook (`useInput`) into the entry's props; this bridge hands both to the
     * window runtime so the window can append a chosen prompt, or write notes
     * with the shell's own quote previews, instead of sending. The editor DOM
     * is never touched.
     * @param runtime - the window runtime.
     * @returns the slot component.
     */
    function makeComposerBridge(runtime) {
      return function NudgeComposerBridge(props) {
        const inputActions = props?.inputActions
        const useInput = props?.useInput
        const latest = React.useRef(undefined)
        if (typeof useInput === 'function') {
          latest.current = useInput((snapshot) => snapshot)
        }
        const handle = React.useRef(undefined)
        if (handle.current === undefined) {
          handle.current = {
            setDraft:
              typeof inputActions?.setDraft === 'function'
                ? (value) => inputActions.setDraft(value)
                : undefined,
            readDraft: () => latest.current?.draft ?? '',
            // The phase tells a sent message apart from a deleted quote; the
            // input state publishes it next to the draft.
            readPhase: () => latest.current?.phase,
            // Insertion at the caret: the shell's own splice, which leaves
            // the rest of the document (and its undo step) alone. The write
            // path prefers it over rebuilding the whole draft.
            captureInsertion:
              typeof inputActions?.captureInsertion === 'function'
                ? () => inputActions.captureInsertion()
                : undefined,
            insertText:
              typeof inputActions?.insertText === 'function'
                ? (text, span) => inputActions.insertText(text, span)
                : undefined,
            // The shell's own quote node: the passage is shown as its quote
            // preview (quote mark, hover for the full text, click to remove)
            // and still serializes to the Markdown a plain write produced.
            insertQuote:
              typeof inputActions?.insertQuote === 'function'
                ? (value, summary) => inputActions.insertQuote(value, summary)
                : undefined,
          }
        }
        // Render only stores the handle (no store update, so React never sees
        // a cross-component update during render); the effect activates it and
        // refreshes the focus flag, and releases it on unmount.
        runtime.attachComposer(handle.current, false)
        React.useEffect(() => {
          const current = handle.current
          runtime.attachComposer(current)
          return () => runtime.detachComposer(current)
        }, [inputActions])
        return null
      }
    }

    // ---------------------------------------------------------------------
    // module
    // ---------------------------------------------------------------------

export { makeComposerBridge }
