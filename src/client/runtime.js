/**
 * The window runtime: state, wiring and the public action surface.
 *
 * This module is the composition root. Every feature lives in its own module
 * (the map is in AGENTS.md); what stays here is the state object, the order in
 * which the modules are built, and the object the view and the slots call.
 *
 * Build order matters: a module only receives what is already constructed. A
 * few collaborators are passed as lazy arrows — countStat, repaintHighlights,
 * recordAnchorMiss, flowAnchorsChanged, closeSettings — because their owner is
 * built later in this function. Call them at event time, never while building,
 * and keep any new lazy name on this list.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANSWER_HIGHLIGHT, IDLE_ANNOTATION, IDLE_NUDGE_EDIT, CAPTURE_HIGHLIGHT, DEFAULT_DELIVERY, HIGHLIGHT_NAME, UI_KEY } from './constants.js'
import { readLang, resolveTarget } from './context.js'
import { CSS } from './css.js'
import { createAnnotations } from './annotations.js'
import { createCardPlacement } from './card-placement.js'
import { createComposerInsertion } from './composer-insert.js'
import { createDelivery } from './delivery.js'
import { createHighlights } from './highlights.js'
import { createHostSync } from './host-sync.js'
import { createPopup } from './popup.js'
import { createPresetActions } from './preset-actions.js'
import { createQuoteWriting } from './quote-writing.js'
import { createSelectionExtension } from './selection-extend.js'
import { createSettingsNav } from './settings-nav.js'
import { createTipActions } from './tip-actions.js'
import { createWorld } from './world.js'
import { chipSlotAt, dockPosition, isPoint, snapToEdge } from './geometry.js'
import { EN, ZH } from './locale.js'
import { presetOf } from './presets.js'
import { SETTINGS, applySettingsStore, clearSetting, commitSettingsToHost, flushSettingsMirror, isDelivery, persistSetting, readSettings, settingsSnapshot } from './settings.js'
import { readJson } from './storage.js'

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
        countStat: (field, id) => hostSync.countStat(field, id),
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
        countStat: (field, id) => hostSync.countStat(field, id),
        persistSetting,
        repaintHighlights: () => highlights.repaintHighlights(),
        sessionId: () => (resolveTarget(ctx) ?? state.target)?.sessionId,
        recordAnchorMiss: (quote) => settingsNav.recordAnchorMiss(quote),
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
        flowAnchorsChanged: (records) => world.flowAnchorsChanged(records),
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
        closeSettings: () => settingsNav.closeSettings(),
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
        countStat: (field, id) => hostSync.countStat(field, id),
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

      /**
       * Folding into the pill and moving the window. The module owns the anchor
       * of a pointer fold; the persisted record keeps only collapsed and pos.
       */
      const cardPlacement = createCardPlacement({
        getState: () => state,
        setState,
      })
      const {
        setCollapsed,
        moveTo,
        saveUi,
        resetCardAnchor,
      } = cardPlacement

      // --- durable settings (Host half) -----------------------------------

      /**
       * The Host record, the page reload and the counters. The runtime owns the
       * state; the two anchor resets come in as callbacks so this module does
       * not reach into the neighbouring layers.
       */
      const hostSync = createHostSync({
        getState: () => state,
        setState,
        resetAnchorRecovery,
        resetCardAnchor,
      })
      const {
        hydrateFromHost,
        adoptRemoteRecord,
        reloadFromStorage,
        countStat,
      } = hostSync

      // --- settings navigation --------------------------------------------

      /**
       * The gear's route into the shell settings, the resize/page hooks and the
       * diagnostic samples. The module owns the chunk driver; the runtime hands
       * it the context and the popup dismissal.
       */
      const settingsNav = createSettingsNav({
        getState: () => state,
        setState,
        text,
        ctx,
        onPopupDismiss,
      })
      const {
        settingsJump,
        settingsJumpLoad,
        recordUiDiag,
        recordSettingsDiag,
        recordAnchorMiss,
        loadSettingsJump,
        openSettings,
        stopSettingsWait,
        probeSettings,
        probeSettingsSeams,
        closeSettings,
        onResize,
        onPageHide,
        onVisibilityChange,
      } = settingsNav

      // --- world subscriptions --------------------------------------------

      /**
       * The page around the window: Client stores, listeners and the conversation
       * boundary. The module owns the subscriptions and the target switch; the
       * runtime keeps the state, the lifecycle and the ordering here.
       */
      const world = createWorld({
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
      })
      const { refreshWorld } = world

      highlights.observe()
      world.mount()
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
        world.dispose()
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
