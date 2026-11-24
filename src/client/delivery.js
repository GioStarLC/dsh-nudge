/**
 * Delivery: putting one probe into the conversation, and settling the wait.
 *
 * The wait is correlated exactly: the probe carries a client-minted requestId,
 * the Host persists it on the user message, and the answer is the first
 * text-bearing assistant message of the step that consumes the probe. The
 * running-state path is only the fallback for a composition without a durable
 * event window.
 *
 * The factory receives the runtime's state accessors and its `text`; it never
 * touches the view or the DOM. Built into `client.js` by `scripts/build.mjs`;
 * edit this file, not the bundle.
 */
import { DEFAULT_DELIVERY, EVENT_RECEIPT_MS, IDLE_CONFIRM_MS, SETTLE_MS, WAIT_TIMEOUT_MS } from './constants.js'
import {
  assistantMessageText,
  eventSourceOf,
  lastDurableSeq,
  mintRequestId,
  resolveTarget,
  sessionRemoteOf,
  statusOf,
  timeZoneOf,
  userMessageText,
} from './context.js'
import { isDelivery } from './settings.js'

/**
 * One in-flight probe.
 * @param {object} deps
 * @param {DshClientContext} deps.ctx
 * @param {() => NudgeRuntimeState} deps.getState
 * @param {(patch: Partial<NudgeRuntimeState>) => void} deps.setState
 * @param {(key: string) => string} deps.text
 */
export function createDelivery({ ctx, getState, setState, text }) {
      // --- delivery -------------------------------------------------------

      /** @type {NudgeWaitEntry | null} */
      let waiting = null

      function clearWaitTimers(entry) {
        if (!entry) return
        if (entry.settleTimer !== undefined) clearTimeout(entry.settleTimer)
        if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
        if (entry.receiptTimer !== undefined) clearTimeout(entry.receiptTimer)
        if (entry.timeoutTimer !== undefined) clearTimeout(entry.timeoutTimer)
        entry.settleTimer = undefined
        entry.idleTimer = undefined
        entry.receiptTimer = undefined
        entry.timeoutTimer = undefined
      }

      function endWaiting() {
        if (waiting) {
          clearWaitTimers(waiting)
          if (typeof waiting.unsubscribeEvents === 'function') {
            try {
              waiting.unsubscribeEvents()
            } catch {
              /* already released */
            }
          }
          waiting.unsubscribeEvents = undefined
          waiting = null
        }
      }

      function finishDone(note) {
        if (!waiting) return
        const sessionId = waiting.sessionId
        endWaiting()
        setState({
          phase: 'done',
          note: note ?? '',
          error: '',
          lastAt: Date.now(),
          lastSessionId: sessionId,
          unread: getState().collapsed ? true : getState().unread,
        })
      }

      function finishError(message) {
        endWaiting()
        setState({ phase: 'error', error: message, note: '' })
      }

      /** Map one Host/transport failure to the visible reason (6.1 / 6.2). */
      function describeFailure(failure) {
        const code = failure && typeof failure.code === 'string' ? failure.code : ''
        const message = failure && typeof failure.message === 'string' ? failure.message : ''
        if (code === 'session/not-found') return text('sessionClosed')
        if (code === 'gateway/bad-request') return text('badRequest')
        return message.length > 0 ? `${text('deliveryFailed')}：${message}` : text('deliveryFailed')
      }

      /** Unwrap the generated RemoteResult wrapper (bare payloads pass through). */
      function unwrapResult(result) {
        if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
          return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }
        }
        if (result !== null && typeof result === 'object' && result.accepted === true) {
          return { ok: true, value: result }
        }
        return { ok: false, error: { message: 'unexpected prompt result' } }
      }

      /**
       * Classify a durable turn boundary that closed after the probe.
       * @param kind - `turn/end` reason kind.
       * @returns true when the wait was settled by the boundary.
       */
      function settleByTurnEnd(kind) {
        if (kind === 'blocked') {
          finishError(text('turnBlockedNote'))
          return true
        }
        if (kind === 'failed') {
          finishError(text('turnFailedNote'))
          return true
        }
        if (kind === 'aborted') {
          finishError(text('turnAbortedNote'))
          return true
        }
        if (kind === 'completed') {
          finishError(text('noAnswerNote'))
          return true
        }
        return false
      }

      /**
       * Read the durable window and settle the wait on the probe's own turn.
       *
       * Correlation is exact: the probe carries a client-minted `requestId`, the
       * Host persists it as the user message's `source.rpcId`, and the answer is
       * the first text-bearing assistant message of the step that consumes it.
       * The plugin only looks at event types and seq — never at the reply text.
       */
      function onSessionEvents(entry) {
        if (waiting !== entry) return
        const snapshot = entry.eventSource?.getSnapshot?.()
        const entries = snapshot?.entries
        if (!Array.isArray(entries)) return
        if (entry.probeSeq === undefined) {
          for (const item of entries) {
            if (item?.type !== 'event') continue
            const event = item.event
            if (!event || event.seq <= entry.sinceSeq) continue
            if (event.type !== 'user/message') continue
            const source = event.data?.source
            if (source && source.rpcId === entry.requestId) {
              entry.probeSeq = event.seq
              break
            }
            if (entry.probeText.length > 0 && userMessageText(event) === entry.probeText) {
              entry.probeSeq = event.seq
              break
            }
          }
        }
        if (entry.probeSeq === undefined) return
        // The step that consumes a steering message starts at the next boundary;
        // for a queued turn it is the turn's first step. A message produced by
        // the step already in flight is not the answer, so the reply is the
        // first text-bearing assistant message after that step opens.
        if (entry.stepSeq === undefined) {
          for (const item of entries) {
            if (item?.type !== 'event') continue
            const event = item.event
            if (!event || event.seq <= entry.probeSeq) continue
            if (event.type === 'step/start') {
              entry.stepSeq = event.seq
              break
            }
          }
        }
        for (const item of entries) {
          if (item?.type !== 'event') continue
          const event = item.event
          if (!event || event.seq <= entry.probeSeq) continue
          if (event.type === 'assistant/message') {
            if (entry.stepSeq === undefined || event.seq <= entry.stepSeq) continue
            if (assistantMessageText(event).trim().length > 0) {
              finishDone('')
              return
            }
            continue
          }
          if (event.type === 'turn/end') {
            const kind = event.data?.reason?.kind
            // A blocked end names the archived gate itself, so it needs no step
            // to prove the boundary belongs to this probe. Every other outcome
            // only explains the step that consumed the probe.
            if (kind === 'blocked') {
              if (settleByTurnEnd(kind)) return
              continue
            }
            if (entry.stepSeq === undefined || event.seq <= entry.stepSeq) continue
            if (settleByTurnEnd(kind)) return
          }
        }
      }

      /**
       * Watch one session's durable window for this probe's turn.
       * @returns whether the event route is available (otherwise the running
       *   state heuristic remains the fallback).
       */
      function beginEventWatch(entry) {
        const source = eventSourceOf(ctx, entry.sessionId)
        if (!source || typeof source.subscribe !== 'function' || typeof source.getSnapshot !== 'function') {
          return false
        }
        entry.eventSource = source
        entry.sinceSeq = lastDurableSeq(source.getSnapshot())
        entry.unsubscribeEvents = source.subscribe(() => onSessionEvents(entry))
        onSessionEvents(entry)
        return true
      }

      /** True when the session's last turn closed while a wait was in flight. */
      /** Settle a wait the running-state heuristic closed, when no event window exists. */
      function onStatusChange() {
        const entry = waiting
        if (!entry) return
        // The event route knows exactly when the probe's turn opens and closes;
        // running-state transitions would settle it too early or too late.
        if (entry.eventSource !== undefined) return
        const running = statusOf(ctx, entry.sessionId)?.running === true
        if (running) {
          entry.sawRunning = true
          if (entry.settleTimer !== undefined) {
            clearTimeout(entry.settleTimer)
            entry.settleTimer = undefined
          }
          return
        }
        // An idle session may answer before ever publishing `running`; the
        // idle timer settles that case. A turn observed running must close
        // once and stay closed: the queue mode may close and reopen a turn.
        if (!entry.sawRunning || entry.settleTimer !== undefined) return
        entry.settleTimer = setTimeout(() => {
          entry.settleTimer = undefined
          if (!waiting || waiting !== entry) return
          if (statusOf(ctx, entry.sessionId)?.running === true) return
          finishDone('')
        }, SETTLE_MS)
      }

      /** Deliver one message into the on-screen session. */
      function deliver(message) {
        if (typeof message !== 'string' || message.trim() === '') return false
        const target = resolveTarget(ctx) ?? getState().target
        if (!target) {
          setState({ phase: 'error', error: text('noSession'), note: '' })
          return false
        }
        // 6.3: the agent's ball is in the user's court; a second request would
        // only stack two pending inputs, so refuse with the reason.
        if (statusOf(ctx, target.sessionId)?.pendingInteraction) {
          setState({ phase: 'error', error: text('waitingQuestion'), note: '' })
          return false
        }
        const remote = sessionRemoteOf(ctx)
        if (!remote) {
          setState({ phase: 'error', error: text('transportMissing'), note: '' })
          return false
        }
        const chosenMode = isDelivery(getState().deliveryOverride)
          ? getState().deliveryOverride
          : DEFAULT_DELIVERY
        const mode = chosenMode === 'steer' ? 'steer' : 'queue'
        const requestId = mintRequestId()
        const controller = new AbortController()
        const entry = {
          sessionId: target.sessionId,
          requestId,
          probeText: message,
          sawRunning: statusOf(ctx, target.sessionId)?.running === true,
          settleTimer: undefined,
          idleTimer: undefined,
          receiptTimer: undefined,
          timeoutTimer: undefined,
          eventSource: undefined,
          unsubscribeEvents: undefined,
          sinceSeq: 0,
          probeSeq: undefined,
          stepSeq: undefined,
        }
        waiting = entry
        setState({ phase: 'waiting', note: '', error: '', target })
        const eventRoute = beginEventWatch(entry)

        entry.timeoutTimer = setTimeout(function onTimeout() {
          if (!waiting || waiting !== entry) return
          // A long turn is the normal case for a follow-up nudge: keep waiting
          // while the agent is still running instead of declaring it late.
          if (statusOf(ctx, entry.sessionId)?.running === true) {
            setState({ note: text('stillRunningNote') })
            entry.timeoutTimer = setTimeout(onTimeout, WAIT_TIMEOUT_MS)
            return
          }
          if (eventRoute) finishError(text('timeoutNote'))
          else finishDone(text('timeoutNote'))
        }, WAIT_TIMEOUT_MS)
        if (eventRoute) {
          entry.receiptTimer = setTimeout(function onReceipt() {
            if (!waiting || waiting !== entry) return
            if (entry.probeSeq !== undefined) return
            if (statusOf(ctx, entry.sessionId)?.running === true) {
              entry.receiptTimer = setTimeout(onReceipt, EVENT_RECEIPT_MS)
              return
            }
            finishError(text('noReceiptNote'))
          }, EVENT_RECEIPT_MS)
        } else {
          // No durable window to watch: fall back to the running-state heuristic.
          entry.idleTimer = setTimeout(() => {
            if (!waiting || waiting !== entry) return
            if (entry.sawRunning) return
            // The unified status may still report the turn: trust it over the timer.
            if (statusOf(ctx, entry.sessionId)?.running === true) {
              entry.sawRunning = true
              return
            }
            finishDone(text('unconfirmedNote'))
          }, IDLE_CONFIRM_MS)
        }

        let request
        try {
          request = remote.prompt(
            {
              requestId,
              sessionId: target.sessionId,
              mode,
              content: [{ type: 'text', text: message }],
              clientTimeZone: timeZoneOf(),
            },
            controller.signal,
          )
        } catch (error) {
          finishError(describeFailure(error))
          return false
        }
        Promise.resolve(request).then(
          (result) => {
            if (!waiting || waiting !== entry) return
            const outcome = unwrapResult(result)
            if (!outcome.ok) finishError(describeFailure(outcome.error))
          },
          (error) => {
            if (!waiting || waiting !== entry) return
            finishError(describeFailure(error))
          },
        )
        return true
      }

  return {
    deliver,
    endWaiting,
    onStatusChange,
    /** Whether a probe is waiting for its answer. */
    isWaiting: () => waiting !== null,
  }
}
