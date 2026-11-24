/**
 * Settings navigation and the page events around it.
 *
 * The gear first tries the shell's own settings routes through a package-local
 * chunk; when the chunk cannot load, the in-window form opens instead. The
 * diagnostics of that path land in the durable UI record.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { ANCHOR_SELECTOR, DIAG_SAMPLES, UI_KEY } from './constants.js'
import { packedMapOf, packedText } from './dom.js'
import { clampPoint } from './geometry.js'
import { flushSettingsMirror } from './settings.js'
import { readJson, storage } from './storage.js'

    /**
     * Build the settings navigation over one runtime.
     *
     * @param deps - getState, setState, text, ctx, onPopupDismiss.
     * @returns the jump driver, the resize/page hooks and the diagnostics.
     */
    function createSettingsNav(deps) {
      const { getState, setState, text, ctx, onPopupDismiss } = deps

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
        if (getState().settingsOpen) setState({ settingsOpen: false })
      }

      /** Keep the window inside the viewport after a resize; the card closes. */
      function onResize() {
        setState({ pos: clampPoint(getState().pos, getState().collapsed) })
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

      return {
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
      }
    }

export { createSettingsNav }
