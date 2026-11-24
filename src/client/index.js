/**
 * dsh-nudge — Client half.
 *
 * A floating control over the conversation: pick one of the built-in probe
 * presets (or the delivery mode), press 询问状态, and the agent answers in the
 * conversation. The plugin owns the trigger, the presets and the visible
 * outcome; it never parses or repeats the answer, because the conversation
 * already is the place where the answer belongs.
 *
 * Extension points used:
 *  - `shell.overlay`            — frame-wide floating layer, outside every scroll container.
 *  - `ctx.sessions.list`        — which session the main view retains (the click target).
 *  - `ctx.uiSession.sessionStatus` — running / pending-interaction facts for the wait state.
 *  - `ctx.remote.session.prompt` — the composer's own delivery path (mode: queue = followup, steer).
 *  - `conversation.input.left`   — the composer's left row: the pinned prompts ride it.
 *
 * Nothing is written to the page outside this component's own root, and the
 * bundle keeps no DOM of its own: unmounting the slot removes the window.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { makeComposerBridge } from './composer.js'
import { COMPOSER_SLOT, ENTRY, INPUT_BAR_SLOT, SETTINGS_SLOT, SLOT } from './constants.js'
import { makeInputBar } from './input-bar.js'
import { EN, ZH } from './locale.js'
import { createRuntime } from './runtime.js'
import { makeSettingsView } from './settings-view.js'
import { makeView } from './view.js'

    const name = ENTRY
    const inject = ['slots', 'sessions', 'uiSession', 'remote', 'locale', 'shortcuts']

    /**
     * Mount the Client half.
     * @param {DshClientContext} ctx - Client plugin context.
     */
    function apply(ctx) {
      const runtime = createRuntime(ctx)

      // Locale dictionaries ride the Client locale service; the visible language
      // is read from its snapshot (browser language before the service answers).
      try {
        const locale = ctx.get?.('locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register('dsh-nudge', { zh: ZH, en: EN }), 'dsh-nudge: locale')
        }
      } catch (error) {
        console.warn('[dsh-nudge] locale registration failed', error)
      }

      const View = makeView(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register({ name: SLOT, id: ENTRY, order: 40 }, View),
          ),
        'dsh-nudge: overlay',
      )

      // Editing/adding presets lives in Settings, not in the floating window.
      const SettingsView = makeSettingsView(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(SETTINGS_SLOT, () =>
            ctx.slots.register(
              {
                name: SETTINGS_SLOT,
                id: ENTRY,
                order: 60,
                label: () => runtime.text('settingsTitle'),
              },
              SettingsView,
            ),
          ),
        'dsh-nudge: settings',
      )

      // The window cannot reach the composer from its overlay slot; a zero-DOM
      // registrant in the input overlay hands the composer's public action face
      // to the runtime (write into the draft instead of sending).
      const ComposerBridge = makeComposerBridge(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(COMPOSER_SLOT, () =>
            ctx.slots.register({ name: COMPOSER_SLOT, id: ENTRY, order: 70 }, ComposerBridge),
          ),
        'dsh-nudge: composer bridge',
      )

      // The pinned prompts ride the input bar's own left row, next to the
      // attach mark and the permission chip (dsh-vim uses the same seat).
      const InputBar = makeInputBar(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(INPUT_BAR_SLOT, () =>
            ctx.slots.register({ name: INPUT_BAR_SLOT, id: ENTRY, order: 60 }, InputBar),
          ),
        'dsh-nudge: input bar',
      )

      // Debug/test handle: scripts/check-client.mjs drives this without a renderer.
      window.__dshNudge = runtime

      // The shell's settings seams fail silently, so read them once after the
      // sidebar painted: the sample lands in the durable record next to the
      // other settings, where a page that cannot be inspected can still report
      // which seam is missing on that build.
      ctx.effect(() => {
        const timer = /** @type {ReturnType<typeof setTimeout> & { unref?: () => void }} */ (setTimeout(() => {
          try {
            runtime.probeSettingsSeams()
          } catch {
            /* diagnostics never break the plugin */
          }
        }, 3000))
        timer?.unref?.()
        return () => clearTimeout(timer)
      }, 'dsh-nudge: settings seams')
      ctx.effect(
        () => () => {
          runtime.dispose()
          if (window.__dshNudge === runtime) delete window.__dshNudge
        },
        'dsh-nudge: teardown',
      )
    }

export { name, inject, apply }
