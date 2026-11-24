/**
 * The window state machine.
 *
 * Delivery, the wait for an answer, annotations, settings, counters and the debug surface.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANCHOR_SELECTOR, ANSWER_HIGHLIGHT, EDITABLE_SELECTOR, IDLE_ANNOTATION, IDLE_NUDGE_EDIT, MODAL_SELECTOR, CAPTURE_HIGHLIGHT, CONTEXT_CHARS, DEFAULT_DELIVERY, DEFAULT_PRESET, DIAG_SAMPLES, FLASH_HOLD_MS, HIGHLIGHT_NAME, MAX_STAT_PRESET_ID, MAX_TIPS, MISS_RESCAN_MS, PILL_SIZE, SELF_SELECTOR, UI_KEY } from './constants.js'
import { readLang, resolveTarget, statusOf } from './context.js'
import { CSS } from './css.js'
import { createAnnotations } from './annotations.js'
import { createComposerInsertion } from './composer-insert.js'
import { createDelivery } from './delivery.js'
import { createHighlights } from './highlights.js'
import { createPopup } from './popup.js'
import { createPresetActions } from './preset-actions.js'
import { createQuoteWriting } from './quote-writing.js'
import { createSelectionExtension } from './selection-extend.js'
import { createTipActions } from './tip-actions.js'
import { anchorFromQuote, anchorFromRange, locateAnchor, packedMapOf, packedText, passagesOfRange, rangeFromPacked, sameRanges } from './dom.js'
import { chipSlotAt, clampPoint, dockPosition, isPoint, rectValue, snapToEdge, viewport } from './geometry.js'
import { EN, ZH } from './locale.js'
import { notesOfSession, saveNotesOfSession } from './notes.js'
import { builtinPresets, mintPresetId, normalizePresetList, presetOf } from './presets.js'
import { SETTINGS, adoptFromHost, applySettingsStore, clearSetting, commitSettingsToHost, flushSettingsMirror, frameLabelKey, hasStoredSettings, isDelivery, isFrameWidth, loadStoreFromHost, markSettingsDirty, markSettingsRead, markSettingsSynced, persistSetting, readSettings, settingsSnapshot } from './settings.js'
import { STAT_FIELDS, dayKey, normalizeStats } from './stats.js'
import { readJson, storage, writeJson } from './storage.js'
import { builtinTips, normalizeTipList, tidyTip } from './tips.js'

    /**
     * Build the window runtime.
     *
     * The view is a thin renderer over this object; the checks drive the same
     * object without a browser renderer.
     * @param ctx - plugin context.
     * @returns the runtime handle.
     */
    function createRuntime(ctx) {
      const saved = readJson(UI_KEY) ?? {}
      const language = readLang(ctx)
      const initialTarget = resolveTarget(ctx)
      // Every persisted preference comes from the settings table, so the launch
      // state and a later restore cannot drift apart.
      // The settings table owns which fields exist; the reader fills every row.
      const savedSettings = /** @type {NudgeSettingsState} */ (
        readSettings({ lang: language, sessionId: initialTarget?.sessionId })
      )

      /** @type {NudgeRuntimeState} */
      let state = {
        phase: 'idle',
        note: '',
        error: '',
        /** Short-lived confirmation of a toggle, cleared on a timer. */
        flash: '',
        lastAt: undefined,
        lastSessionId: undefined,
        unread: false,
        // Every launch starts as the pill: the window is a reminder to look at
        // the conversation, not a panel to close first.
        collapsed: true,
        // One anchor for both shapes: collapsing keeps the window in place and
        // expanding returns it to the same spot. The stored record only says
        // how far down it sat and which side it was on.
        pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        /**
         * Every persisted preference — the three switches, the delivery mode,
         * the border width, the prompts and the chosen one, the idle lines, the
         * counters and the collected notes — arrives from the settings table by
         * field name, so the launch state cannot miss a row.
         */
        ...savedSettings,
        /** Ids whose body is expanded in the settings list. */
        presetOpen: [],
        /** The preset opened in the settings editor, or null. */
        presetEditingId: null,
        target: initialTarget,
        pendingQuestion: false,
        /** True while the conversation composer is mounted and holds the caret. */
        composerFocused: false,
        /** Which idle line is showing; not persisted, so the launch restarts at the first. */
        tipIndex: 0,
        /** The idle line opened in its editor, or null. */
        tipEditingIndex: null,
        /**
         * The annotation surface: the selection being annotated, whether its
         * card is stowed, the note being written, and the collected note opened
         * in the editor. A card and an editor never coexist.
         */
        ...IDLE_ANNOTATION,
        /** Whether the annotation module shows its body (row summary when false). */
        annotationExpanded: false,
        /** Whether the nudge module (prompts / mode / primary) shows its body. */
        nudgeExpanded: true,
        /** The in-window "new prompt" form (title + body). */
        nudgeDraftOpen: false,
        nudgeDraftLabel: '',
        nudgeDraftText: '',
        nudgeDraftError: '',
        ...IDLE_NUDGE_EDIT,
        /** Whether the window shows the settings form in place of its body. */
        settingsOpen: false,
        /** Timestamp of the last capture, used to restart the attention pulse. */
        attentionAt: 0,
        /** The window control whose explanation bubble is showing, or null. */
        tip: null,
        lang: language,
      }
      const listeners = new Set()
      /** One immutable snapshot per change, as `useSyncExternalStore` requires. */
      function getSnapshot() {
        return state
      }

      /**
       * Replace state and notify every renderer.
       * @param {Partial<NudgeRuntimeState>} patch
       */
      function setState(patch) {
        let changed = false
        for (const key of Object.keys(patch)) {
          if (!Object.is(state[key], patch[key])) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = { ...state, ...patch }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.warn('[dsh-nudge] listener failed', error)
          }
        }
      }

      /** Subscribe one renderer. */
      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      /** Visible text for the current locale. */
      function text(key) {
        const dict = state.lang === 'zh' ? ZH : EN
        return dict[key] ?? key
      }

      // --- delivery -------------------------------------------------------

      const delivery = createDelivery({
        ctx,
        getState: () => state,
        setState,
        text,
      })

      /** Deliver one message into the on-screen session. */
      function deliver(message) {
        return delivery.deliver(message)
      }

      /** End the in-flight wait; the delivery module owns its timers and watch. */
      function endWaiting() {
        delivery.endWaiting()
      }

      // --- composer insertion ---------------------------------------------

      /**
       * The mounted composer bridge and the draft splice. The module owns the
       * handle, the double-press counter and the write path; the runtime keeps
       * the side effects it needs: toast text, counters, delivery and the
       * auto-paste handoff on focus.
       */
      const insertion = createComposerInsertion({
        getState: () => state,
        setState,
        text,
        countStat,
        deliver,
        activePreset,
        onFocus: () => {
          // Auto-paste: the moment the caret lands in the composer, hand the
          // pending notes over and empty the tray. A failed write keeps them.
          if (state.autoPaste === true && state.annotations.length > 0) writeAnnotations()
        },
      })
      const {
        attachComposer,
        detachComposer,
        syncComposerFocus,
        canInsert,
        composerHasText,
        composerHandle,
        insertPreset,
        appendPrompt,
        sendDraft,
      } = insertion

      // --- annotations ----------------------------------------------------

      /**
       * The annotation surfaces and their timers. The module owns the state
       * machine; persistence, counters, toast text and the repaint come in as
       * callbacks, and the transcript subscription stays in highlights.
       */
      const annotations = createAnnotations({
        getState: () => state,
        setState,
        text,
        countStat,
        persistSetting,
        repaintHighlights: () => highlights.repaintHighlights(),
        sessionId: () => (resolveTarget(ctx) ?? state.target)?.sessionId,
        recordAnchorMiss,
      })
      const {
        tidyQuote,
        quoteMarkdown,
        annotationNoteLine,
        annotationBlock,
        pendingAnnotations,
        settleAnnotation,
        closeAnnotationSurface,
        commitAnnotations,
        isSelfNode,
        annotationsText,
        blockBreak,
        inEditable,
        readSelection,
        cancelPendingCapture,
        captureSelectionLater,
        onSelectionKeyup,
        onPointerGestureDown,
        onPointerGestureUp,
        onSelectionChange,
        pulse,
        notify,
        captureSelection,
        clearNativeSelection,
        setQuick,
        setAutoPaste,
        showTip,
        hideTip,
        setFrame,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        noteSessionId,
        persistNotes,
        addAnnotation,
        markAsAnswer,
        quickReply,
        dismissAnnotationDraft,
        startEditAnnotation,
        saveEditedAnnotation,
        cancelAnnotationEdit,
        removeAnnotation,
        copyDraftQuote,
        dispose: disposeAnnotations,
      } = annotations

      // --- painted highlights ---------------------------------------------

      /**
       * The painted marks and their anchor recovery. The module owns the caches
       * and the repaint pass; the runtime hands it the state and the two calls
       * that belong to annotations.
       */
      const highlights = createHighlights({
        getState: () => state,
        flowAnchorsChanged,
        startEditAnnotation,
        inEditable,
      })
      const { resetAnchorRecovery, repaintHighlights, scheduleRepaint, onTranscriptClick } = highlights

      // --- popup placement -------------------------------------------------

      /**
       * The annotation cards hang off the pointer or the quote box. The module
       * owns that geometry; closing the surface stays here, injected.
       */
      const popup = createPopup({
        getState: () => state,
        setState,
        closeAnnotationSurface,
        cancelPendingCapture,
      })
      const {
        pointerNearRect,
        popupPosition,
        placeOverRect,
        editPopupPosition,
        closePopup,
        onOuterPointerDown,
        onPopupDismiss,
      } = popup

      /**
       * Shift+drag to grow or shrink the captured passage. The module owns the
       * drag state; the card follows the live range.
       */
      const selectionExtension = createSelectionExtension({
        getState: () => state,
        settleAnnotation,
        closePopup,
        text,
        tidyQuote,
        notify,
        cancelAnnotationEdit,
        copyDraftQuote,
        closeSettings,
      })
      const {
        extending,
        extendAnchor,
        caretRangeAt,
        extendTo,
        onExtendPointerDown,
        onExtendPointerMove,
        onExtendPointerUp,
        fieldHasSelection,
        copyShortcutActive,
        onPopupKeydown,
      } = selectionExtension

      /**
       * The batch write into the composer, and the send that marks the notes
       * as written. The payload is the same Markdown block either way.
       */
      const quoteWriting = createQuoteWriting({
        getState: () => state,
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
      })
      const {
        spliceAtCaret,
        writeQuotedBatch,
        writeAnnotations,
        sendAnnotations,
      } = quoteWriting

      /** The preset a send/write uses: the chosen one when it is enabled. */
      function activePreset() {
        const chosen = presetOf(state.presets, state.presetId)
        if (chosen !== undefined && chosen.enabled !== false) return chosen
        return state.presets.find((preset) => preset.enabled !== false)
      }

      /** The primary button: write into the composer, or send the chosen preset. */
      function ask() {
        if (state.phase === 'waiting' && !canInsert()) return false
        // With the caret in the composer the same button writes the chosen
        // prompt into the draft instead of starting a turn.
        if (canInsert()) return insertPreset()
        const preset = activePreset()
        if (!preset) return false
        const delivered = deliver(preset.text)
        if (delivered) countStat('send', preset.id)
        return delivered
      }

      /**
       * Turbo double-click on a preset: switch to it and use it. A composer
       * that already holds text wins over sending — the prompt is appended,
       * even when the caret is elsewhere, so a half-written message is never
       * dropped just because the double-click did not land in the field.
       */
      function runPreset(id) {
        if (setPreset(id) !== true) return false
        if (composerHasText()) return insertPreset()
        return ask()
      }

      /** Switch the delivery mode for this browser and remember it. */
      function setDelivery(value) {
        if (!isDelivery(value)) return false
        persistSetting('delivery', value)
        setState({ deliveryOverride: value })
        notify(`${text('mode')}：${value === 'steer' ? text('steer') : text('queue')}`)
        return true
      }

      /** The delivery actually used: browser override, else the single default. */
      function effectiveDelivery() {
        if (isDelivery(state.deliveryOverride)) return state.deliveryOverride
        return DEFAULT_DELIVERY
      }

      /** Turbo mode: hide the primary button and run a prompt on double-click. */
      function setTurbo(value) {
        const next = value === true
        persistSetting('turbo', next)
        setState({ turbo: next })
        notify(`${text('turboTitle')}：${next ? text('switchOn') : text('switchOff')}`)
        return true
      }

      /** Switch the probe preset for this browser and remember it. */
      function setPreset(value) {
        if (presetOf(state.presets, value) === undefined) return false
        persistSetting('preset', value)
        setState({ presetId: value })
        return true
      }

      // --- presets ---------------------------------------------------------

      /**
       * The prompt list and its two places. The module owns the persisted list
       * and the in-window forms; the runtime keeps the store and the settings
       * writer, both injected.
       */
      const presetActions = createPresetActions({
        getState: () => state,
        setState,
        text,
        persistSetting,
        clearSetting,
      })
      const {
        commitPresets,
        addPreset,
        updatePreset,
        removePreset,
        setPresetEnabled,
        setPresetPinned,
        togglePresetEnabled,
        movePreset,
        movePresetTo,
        movePresetBeside,
        togglePresetOpen,
        setPresetsOpen,
        startPresetEdit,
        cancelPresetEdit,
        startNudgeDraft,
        cancelNudgeDraft,
        setNudgeDraftLabel,
        setNudgeDraftText,
        saveNudgeDraft,
        setNudgeEditing,
        startNudgeEdit,
        cancelNudgeEdit,
        setNudgeEditLabel,
        setNudgeEditText,
        saveNudgeEdit,
        presetFromBlock,
        importPresets,
        exportPresets,
        resetPresets,
      } = presetActions

      // --- idle lines ------------------------------------------------------

      /**
       * The idle lines and their rotation. The module owns the list; the store
       * and the settings writer stay here, injected.
       */
      const tipActions = createTipActions({
        getState: () => state,
        setState,
        text,
        persistSetting,
        clearSetting,
      })
      const {
        commitTips,
        updateTip,
        startTipEdit,
        cancelTipEdit,
        addTip,
        addTips,
        removeTip,
        moveTip,
        moveTipTo,
        resetTips,
        advanceTip,
      } = tipActions

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
        if (state.collapsed === value) return
        let pos = clampPoint(state.pos, value)
        if (value === true && isPoint(point)) {
          cardAnchor = state.pos
          pos = clampPoint({ x: point.x - PILL_SIZE / 2, y: point.y - PILL_SIZE / 2 }, true)
        }
        if (value === false) {
          if (cardAnchor !== null) pos = clampPoint(cardAnchor, false)
          cardAnchor = null
        }
        setState({
          collapsed: value,
          settingsOpen: value ? false : state.settingsOpen,
          unread: value ? state.unread : false,
          pos,
        })
        saveUi()
      }

      /** Move the window while dragging (not persisted until drop). */
      function moveTo(x, y) {
        // A pill dragged elsewhere is the anchor the next unfold starts from:
        // the spot the card was folded at no longer applies.
        if (state.collapsed) cardAnchor = null
        setState({ pos: clampPoint({ x, y }, state.collapsed) })
      }

      /** Persist the current window state. */
      function saveUi() {
        // Keep keys this build does not own (an older record may carry more).
        writeJson(UI_KEY, { ...(readJson(UI_KEY) ?? {}), collapsed: state.collapsed, pos: state.pos })
      }

      // --- durable settings (Host half) -----------------------------------

      /**
       * Read the Host half's durable record once per launch — and only then let
       * the mirror write. The two are ordered here and nowhere else: a POST
       * replaces the whole file, so writing before the read would erase the
       * very settings a restart is supposed to come back from.
       * @returns true when a restored record changed the state.
       */
      function hydrateFromHost() {
        return loadStoreFromHost()
          .then((remote) => {
            const adopted = adoptRemoteRecord(remote)
            markSettingsRead()
            return adopted
          })
          .catch(() => {
            // No Host half (preview page, plain harness): the page is the copy.
            markSettingsRead()
            return false
          })
      }

      /**
       * Adopt the fields of a record the page does not hold — per field, so a
       * page that already wrote its own geometry still gets the presets, and a
       * page that holds everything keeps its own copy (the user just changed
       * it) while the mirror refreshes the record from it.
       */
      function adoptRemoteRecord(remote) {
        if (remote === null || remote === undefined || typeof remote !== 'object') return false
        const pageHeldSomething = hasStoredSettings(settingsSnapshot())
        const adopted = adoptFromHost(() => applySettingsStore(remote, { merge: true }))
        if (!adopted) return false
        reloadFromStorage()
        // A page that held nothing is now exactly the record. A page that held
        // some fields holds the union, so the record is brought up to date.
        if (pageHeldSomething) markSettingsDirty()
        else markSettingsSynced()
        return true
      }

      /** Re-derive every persisted preference from the page storage. */
      function reloadFromStorage() {
        const saved = readJson(UI_KEY) ?? {}
        // The tray comes back from storage; the marks a write left behind in a
        // draft do not, because the draft they pointed at may be gone too.
        resetAnchorRecovery()
        // A reloaded window starts folded from its stored spot: no card anchor
        // outlives the page it was folded on.
        cardAnchor = null
        setState({
          ...readSettings({ lang: state.lang, sessionId: state.target?.sessionId }),
          tipIndex: 0,
          // The restore follows the same launch rule as the first paint.
          collapsed: true,
          pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        })
      }

      /**
       * Bump one of today's counters. The local calendar day is the bucket:
       * a click after midnight starts a fresh row, and the store keeps the
       * newest `STATS_DAYS` rows only. A preset send/write also bumps that
       * preset's own count so the settings board can rank the top prompts.
       */
      function countStat(field, presetId) {
        if (!STAT_FIELDS.includes(field)) return false
        const key = dayKey()
        const days = { ...state.stats.days }
        const today = { ...(days[key] ?? {}) }
        today[field] = (today[field] ?? 0) + 1
        if (
          typeof presetId === 'string' &&
          presetId.length > 0 &&
          presetId.length <= MAX_STAT_PRESET_ID &&
          presetId !== '__proto__' &&
          presetId !== 'constructor' &&
          presetId !== 'prototype'
        ) {
          const presets = { ...(today.presets ?? {}) }
          presets[presetId] = (presets[presetId] ?? 0) + 1
          today.presets = presets
        }
        days[key] = today
        const next = normalizeStats({ days })
        persistSetting('stats', next)
        setState({ stats: next })
        return true
      }

      // --- settings navigation --------------------------------------------

      /**
       * Append one sample to a diagnostic list in the persisted UI record.
       *
       * The shell's open seams report nothing when they fail — `invoke` returns
       * void, a blocked command returns silently, a click on the wrong button is
       * accepted — so the only place a failure can be observed is the running
       * page. The samples land in `nudge-store.json`, next to the other settings.
       */
      function recordUiDiag(name, entry) {
        const ui = readJson(UI_KEY) ?? {}
        const list = Array.isArray(ui[name]) ? ui[name].slice(-DIAG_SAMPLES) : []
        list.push({ at: Date.now(), ...entry })
        ui[name] = list
        storage()?.setItem(UI_KEY, JSON.stringify(ui))
      }

      /** One settings-navigation sample. */
      function recordSettingsDiag(entry) {
        try {
          recordUiDiag('settingsDiag', entry)
        } catch {
          /* diagnostics are best-effort and never block the gear */
        }
      }


      /**
       * Why a passage could not be anchored, as one sample.
       *
       * `flows` counts the anchor elements on the page, `hits` how many of them
       * carry the passage, and `inBody` whether the text is on the page at all:
       * together they separate "the transcript re-rendered" from "the passage
       * lives outside every flow item" without a debugger on the running app.
       */
      function recordAnchorMiss(quote) {
        try {
          const packed = packedText(quote)
          const flows = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
          let hits = 0
          for (const element of flows) {
            if (packedMapOf(element).packed.indexOf(packed) !== -1) hits += 1
          }
          const body = packedText(document.body?.textContent ?? '')
          recordUiDiag('anchorDiag', {
            event: 'no-anchor',
            length: packed.length,
            flows: flows.length,
            hits,
            inBody: packed !== '' && body.indexOf(packed) !== -1,
          })
        } catch {
          /* diagnostics are best-effort and never block the note */
        }
      }

      /**
       * The Settings jump driver lives in a package-local chunk
       * (`client.settings-jump.js`), fetched on the first press of the gear.
       *
       * The chunk is the reusable unit: it knows the shell's seams and nothing
       * about this plugin, so a second jump target is a second instance with a
       * different `sectionTitle` (and its own `onDiag` / `onFallback`) — the
       * routing, the receipts and the escalation order come for free.
       */
      let settingsJump
      let settingsJumpLoad

      /** Fetch (once) and wire the driver; a failed fetch is retried by the next press. */
      function loadSettingsJump() {
        if (settingsJump !== undefined) return Promise.resolve(settingsJump)
        if (settingsJumpLoad !== undefined) return settingsJumpLoad
        const fail = (error) => {
          settingsJumpLoad = undefined
          console.warn('[dsh-nudge] settings jump chunk unavailable', error)
          return undefined
        }
        try {
          if (typeof require?.async !== 'function') throw new Error('this shell has no chunk loader')
          settingsJumpLoad = require
            .async('./client.settings-jump.js')
            .then((chunk) => {
              settingsJump = chunk.createSettingsJump({
                getShortcuts: () => ctx.get?.('shortcuts'),
                getSlots: () => ctx.slots,
                sectionTitle: () => text('settingsTitle'),
                onDiag: (entry) => recordSettingsDiag(entry),
                onFallback: () => setState({ settingsOpen: true }),
              })
              return settingsJump
            })
            .catch(fail)
        } catch (error) {
          return Promise.resolve(fail(error))
        }
        return settingsJumpLoad
      }

      /**
       * Open Settings on this plugin's section.
       *
       * Resolves whether one of the shell's routes acted. When the chunk itself
       * cannot load — an install copy shipped without the file, or a shell whose
       * loader has no chunk support — the in-window form opens instead, so the
       * gear is never dead.
       */
      async function openSettings() {
        const jump = await loadSettingsJump()
        if (jump === undefined) {
          recordSettingsDiag({ event: 'chunk', error: 'unavailable' })
          setState({ settingsOpen: true })
          return false
        }
        return jump.open()
      }

      /** Drop a pending verification (dispose, or a second press of the gear). */
      function stopSettingsWait() {
        if (settingsJump !== undefined) settingsJump.cancel()
      }

      /** What the running page says about the shell's settings seams (diagnostics). */
      function probeSettings() {
        return settingsJump === undefined ? { pending: true } : settingsJump.probe()
      }

      /** Record the seam sample once the chunk has arrived (mount-time probe). */
      function probeSettingsSeams() {
        loadSettingsJump().then((jump) => {
          recordSettingsDiag(
            jump === undefined
              ? { event: 'mount', error: 'chunk-unavailable' }
              : { event: 'mount', ...jump.probe() },
          )
        })
      }

      /** Leave the in-window settings form and return to the normal body. */
      function closeSettings() {
        if (state.settingsOpen) setState({ settingsOpen: false })
      }

      /** Keep the window inside the viewport after a resize; the card closes. */
      function onResize() {
        setState({ pos: clampPoint(state.pos, state.collapsed) })
        onPopupDismiss()
      }

      /**
       * Leaving the page writes the pending settings now. The mirror waits
       * `STORE_SYNC_MS` for a burst of edits to settle, and a window closed in
       * that gap would otherwise drop the last change — on the very restart the
       * Host record exists for. It is best effort: a page torn down at once may
       * still cut the request short.
       */
      function onPageHide() {
        flushSettingsMirror()
      }

      /** A page that goes to the background may never come back: write now. */
      function onVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSettingsMirror()
      }

      // --- world subscriptions -------------------------------------------

      /** Refresh target/pending facts from the Client stores. */
      let lastTargetId
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

      const offs = []
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

      highlights.observe()
      refreshWorld()
      // The Host half holds the durable copy of every preference; adopting it
      // is what makes the settings survive an app restart (the GUI's loopback
      // port changes, so `localStorage` is a different origin after a restart).
      try {
        Promise.resolve(hydrateFromHost()).catch(() => {})
      } catch {
        /* no Host half (preview page, check harness) */
      }

      /** Release every subscription and in-flight request. */
      function dispose() {
        flushSettingsMirror()
        cancelPendingCapture()
        disposeAnnotations()
        endWaiting()
        for (const off of offs) {
          try {
            off?.()
          } catch {
            /* already disposed */
          }
        }
        offs.length = 0
        stopSettingsWait()
        window.removeEventListener('resize', onResize)
        window.removeEventListener('pagehide', onPageHide)
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
        insertion.dispose()
        highlights.dispose()
        try {
          window.CSS?.highlights?.delete(HIGHLIGHT_NAME)
          window.CSS?.highlights?.delete(ANSWER_HIGHLIGHT)
          window.CSS?.highlights?.delete(CAPTURE_HIGHLIGHT)
        } catch {
          /* no highlight registry */
        }
        resetAnchorRecovery()
        listeners.clear()
      }

      return {
        subscribe,
        getSnapshot,
        text,
        ask,
        /** Turbo double-click: append when a draft exists, else send. */
        runPreset,
        /** Append one prompt to the composer draft, on its own line. */
        insertPreset,
        /** One press on a bar chip: append, counting the insert unless a second press follows. */
        appendPrompt,
        /** Two presses on a bar chip: send the composed draft, clear it on success. */
        sendDraft,
        setDelivery,
        effectiveDelivery,
        setTurbo,
        setPreset,
        addPreset,
        updatePreset,
        removePreset,
        movePreset,
        movePresetTo,
        /** Window drag: drop one prompt before or after another. */
        movePresetBeside,
        resetPresets,
        togglePresetOpen,
        setPresetsOpen,
        startPresetEdit,
        cancelPresetEdit,
        /** Enable / disable one prompt without deleting it. */
        setPresetEnabled,
        togglePresetEnabled,
        /** Pin / unpin one prompt on the composer's own row. */
        setPresetPinned,
        /** In-window "new prompt" form (title + body). */
        startNudgeDraft,
        cancelNudgeDraft,
        setNudgeDraftLabel,
        setNudgeDraftText,
        saveNudgeDraft,
        /** In-window 编辑 mode: reorder by drag, change one prompt in place. */
        setNudgeEditing,
        startNudgeEdit,
        cancelNudgeEdit,
        setNudgeEditLabel,
        setNudgeEditText,
        saveNudgeEdit,
        importPresets,
        exportPresets,
        setCollapsed,
        moveTo,
        saveUi,
        openSettings,
        closeSettings,
        /** One sample of the shell's settings seams, kept in the durable record. */
        probeSettingsSeams,
        /** Note that the gear itself was reached, before any shell seam runs. */
        noteSettingsPress: () => recordSettingsDiag({ event: 'gear', ...probeSettings() }),
        /** Composer bridge hooks (session input overlay). */
        attachComposer,
        detachComposer,
        /** Annotation tray. */
        captureSelection,
        /** The notes still waiting to be written into a message. */
        pendingAnnotations,
        popupPosition,
        editPopupPosition,
        setQuick,
        setAutoPaste,
        setFrame,
        addTip,
        addTips,
        updateTip,
        removeTip,
        moveTip,
        moveTipTo,
        startTipEdit,
        cancelTipEdit,
        resetTips,
        advanceTip,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        /** Whether one DOM node belongs to this window's own chrome. */
        isSelfNode,
        showTip,
        hideTip,
        addAnnotation,
        markAsAnswer,
        quickReply,
        copyDraftQuote,
        startEditAnnotation,
        saveEditedAnnotation,
        cancelAnnotationEdit,
        dismissAnnotationDraft,
        removeAnnotation,
        writeAnnotations,
        sendAnnotations,
        dispose,
        /** @internal exposed for scripts/check-client.mjs */
        _debug: {
          state: () => state,
          chipSlotAt,
          syncComposerFocus,
          settingsSnapshot,
          applySettingsStore,
          commitSettingsToHost,
          hydrateFromHost,
          /** Every setting row's name: the fields the Host record must keep. */
          settingsNames: () => SETTINGS.map((row) => row.name),
          /** The two shipped dictionaries, for the key-set invariants. */
          locales: () => ({ zh: ZH, en: EN }),
        },
      }
    }

    // ---------------------------------------------------------------------
    // view
    // ---------------------------------------------------------------------

export { createRuntime }
