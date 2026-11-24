/**
 * The page around the window: Client stores, listeners and the conversation
 * boundary.
 *
 * A target change is the one event that resets the whole annotation surface:
 * marks and the tray belong to the conversation that quoted them, and an ask
 * belongs to the conversation it was clicked in.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANCHOR_SELECTOR, IDLE_ANNOTATION } from './constants.js'
import { readLang, resolveTarget, statusOf } from './context.js'
import { notesOfSession } from './notes.js'

    /**
     * Build the world subscriptions over one runtime.
     *
     * @param deps - setState, ctx, delivery, endWaiting, settleAnnotation,
     *   resetAnchorRecovery, and the handlers the page hooks.
     * @returns the conversation refresh, the flow check and mount/dispose.
     */
    function createWorld(deps) {
      const {
        setState,
        ctx,
        delivery,
        endWaiting,
        settleAnnotation,
        resetAnchorRecovery,
        onResize,
        onPageHide,
        onVisibilityChange,
        syncComposerFocus,
        onPointerGestureDown,
        onPointerGestureUp,
        captureSelectionLater,
        onSelectionKeyup,
        onSelectionChange,
        onTranscriptClick,
        onExtendPointerDown,
        onExtendPointerMove,
        onExtendPointerUp,
        onOuterPointerDown,
        onPopupKeydown,
        scheduleRepaint,
        onPopupDismiss,
      } = deps

      /** The conversation the state currently describes, so a switch is noticed once. */
      let lastTargetId

      /** Refresh target/pending facts from the Client stores. */
      function refreshWorld() {
        const target = resolveTarget(ctx)
        const pendingQuestion = target
          ? Boolean(statusOf(ctx, target.sessionId)?.pendingInteraction)
          : false
        const targetId = target?.sessionId
        if (targetId !== lastTargetId) {
          lastTargetId = targetId
          // The marks belong to the conversation that quoted them.
          resetAnchorRecovery()
          // The ask is bound to the conversation it was clicked in (1.2); a
          // different conversation must not inherit its status or its wait.
          if (delivery.isWaiting()) endWaiting()
          // The tray belongs to the conversation it quotes: load that Session's
          // saved notes and drop any half-written one.
          settleAnnotation({
            target,
            pendingQuestion,
            note: '',
            error: '',
            phase: 'idle',
            annotations: notesOfSession(targetId),
            ...IDLE_ANNOTATION,
            annotationExpanded: false,
            nudgeExpanded: true,
            attentionAt: 0,
          })
          return
        }
        setState({ target, pendingQuestion })
      }

      /**
       * Whether one mutation batch touched a flow item: added one, removed one
       * or re-keyed it. Only those can bring back a passage whose row is gone,
       * so only they raise the generation the recovery search waits for.
       */
      function flowAnchorsChanged(records) {
        for (const record of records) {
          if (record?.type === 'attributes') return true
          for (const list of [record?.addedNodes, record?.removedNodes]) {
            if (!list) continue
            for (const node of list) {
              if (node?.nodeType !== 1) continue
              if (node.matches?.(ANCHOR_SELECTOR) === true) return true
              if (typeof node.querySelector === 'function' && node.querySelector(ANCHOR_SELECTOR) !== null) {
                return true
              }
            }
          }
        }
        return false
      }

      /** Everything the page told us it would send, so dispose can take it back. */
      const offs = []

      /** Subscribe to the Client stores and hang the window's listeners on the page. */
      function mount() {
        const sessions = ctx.get?.('sessions')
        if (typeof sessions?.list?.subscribe === 'function') {
          offs.push(sessions.list.subscribe(refreshWorld))
        }
        const statusSource = ctx.get?.('uiSession')?.sessionStatus
        if (typeof statusSource?.subscribe === 'function') {
          offs.push(
            statusSource.subscribe(() => {
              refreshWorld()
              delivery.onStatusChange()
            }),
          )
        }
        try {
          const locale = ctx.get?.('locale')
          if (typeof locale?.subscribe === 'function') {
            offs.push(locale.subscribe(() => setState({ lang: readLang(ctx) })))
          }
        } catch {
          /* locale absent */
        }
        window.addEventListener('resize', onResize)
        window.addEventListener('pagehide', onPageHide)
        // The primary button follows the caret: entering or leaving the composer
        // flips the write mode without polling.
        try {
          if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', onVisibilityChange)
            document.addEventListener('focusin', syncComposerFocus, true)
            document.addEventListener('focusout', syncComposerFocus, true)
            // Selection capture and painted-passage clicks.
            document.addEventListener('pointerdown', onPointerGestureDown, true)
            document.addEventListener('pointerup', onPointerGestureUp, true)
            document.addEventListener('pointercancel', onPointerGestureUp, true)
            window.addEventListener('blur', onPointerGestureUp)
            document.addEventListener('mouseup', captureSelectionLater, true)
            document.addEventListener('keyup', onSelectionKeyup, true)
            document.addEventListener('selectionchange', onSelectionChange, true)
            document.addEventListener('click', onTranscriptClick, true)
            // Shift+press extends the captured passage without the native anchor.
            document.addEventListener('mousedown', onExtendPointerDown, true)
            document.addEventListener('mousemove', onExtendPointerMove, true)
            document.addEventListener('mouseup', onExtendPointerUp, true)
            // A press outside the window or card dismisses it.
            document.addEventListener('pointerdown', onOuterPointerDown, true)
            document.addEventListener('keydown', onPopupKeydown, true)
            window.addEventListener('scroll', scheduleRepaint, true)
            // Scrolling or resizing closes the selection card, like the old popup.
            window.addEventListener('scroll', onPopupDismiss, true)
          }
        } catch {
          /* no document (checks drive the runtime directly) */
        }
        refreshWorld()
      }

      /** Drop every subscription and listener this module added. */
      function dispose() {
        for (const off of offs) {
          try {
            off?.()
          } catch {
            /* already disposed */
          }
        }
        offs.length = 0
        try {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('resize', onResize)
            window.removeEventListener('pagehide', onPageHide)
          }
        } catch {
          /* no window */
        }
        try {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange)
            document.removeEventListener('focusin', syncComposerFocus, true)
            document.removeEventListener('focusout', syncComposerFocus, true)
            document.removeEventListener('pointerdown', onPointerGestureDown, true)
            document.removeEventListener('pointerup', onPointerGestureUp, true)
            document.removeEventListener('pointercancel', onPointerGestureUp, true)
            window.removeEventListener('blur', onPointerGestureUp)
            document.removeEventListener('mouseup', captureSelectionLater, true)
            document.removeEventListener('keyup', onSelectionKeyup, true)
            document.removeEventListener('selectionchange', onSelectionChange, true)
            document.removeEventListener('click', onTranscriptClick, true)
            document.removeEventListener('mousedown', onExtendPointerDown, true)
            document.removeEventListener('mousemove', onExtendPointerMove, true)
            document.removeEventListener('mouseup', onExtendPointerUp, true)
            document.removeEventListener('pointerdown', onOuterPointerDown, true)
            document.removeEventListener('keydown', onPopupKeydown, true)
            window.removeEventListener('scroll', scheduleRepaint, true)
            window.removeEventListener('scroll', onPopupDismiss, true)
          }
        } catch {
          /* no document */
        }
      }

      return { refreshWorld, flowAnchorsChanged, mount, dispose }
    }

export { createWorld }
