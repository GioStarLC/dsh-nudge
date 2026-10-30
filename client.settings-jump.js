/**
 * dsh-nudge — Settings jump driver, shipped as a package-local chunk.
 *
 * `client.js` fetches this file with `require.async('./client.settings-jump.js')`
 * the first time Settings is asked for, so the main bundle stays about the
 * window and an install that never opens Settings never pays for the jump
 * machinery. The chunk contract is the module loader's: the file sits next to
 * `client.js`, its name matches `client.<name>.js`, it registers itself as
 * `<owner id>/client.<name>.js`, and it exports plain functions — no React, no
 * plugin state.
 *
 * The driver is shell-facing only. Everything business-specific (which section
 * to land on, where diagnostics go, what to show when no seam answers) arrives
 * as options, so the same file serves any other section jump unchanged.
 *
 * Extension points the driver drives (never writes):
 *  - `[data-shortcut-modal="settings"]`  the shell's Settings panel.
 *  - `[data-slot="sidebar.settings"]`    the sidebar launcher seat.
 *  - `shortcuts.registry.invoke`         the shell's registered `settings.open`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-nudge',
  chunk: 'client.settings-jump.js',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    /** Stable DOM seams of the shell-owned settings panel (nothing is written here). */
    const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]'
    const SETTINGS_ROOT_SELECTOR = '[data-slot="sidebar.settings"]'
    /** How often a settings open route is checked for the panel it asked for. */
    const SETTINGS_POLL_MS = 50
    /** How long one open route gets to paint the panel before the next runs. */
    const SETTINGS_ROUTE_MS = 600
    /** Extra time the painted panel gets to render its nav rows. */
    const SETTINGS_SECTION_MS = 1000

    /**
     * A reusable "open DSH Settings and land on a section" driver.
     *
     * The shell exposes no plugin-facing API for this: the panel's open state
     * lives inside the shell component, `settings.open` returns void and is
     * refused silently while another modal owns the page, and the sidebar
     * trigger shares its seat with other plugins' popovers. The only
     * trustworthy receipt is the panel itself, so the jump is a small state
     * machine — ask a route, wait for the panel to paint, escalate — and
     * everything business-specific is injected:
     *
     *   getShortcuts  the `shortcuts` service (`registry.invoke`, `catalog`)
     *   getSlots      the `slots` service, read only by `probe()`
     *   sectionTitle  the nav row to click once the panel is up
     *   onDiag        where to record what the page looked like
     *   onFallback    what to show when no route painted the panel
     *
     * Nothing below reads this plugin's state, so the same driver serves any
     * other jump of the same shape (another settings section, another shell
     * panel) unchanged.
     */
    function createSettingsJump(options) {
      const { getShortcuts, getSlots, sectionTitle, onDiag, onFallback } = options

      let timer
      /** The routes of the current press, and the one being verified. */
      let routes = []
      let index = 0

      /** Cancel a pending verification (dispose, or a second press of the gear). */
      function cancel() {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      }

      /** The settings dialog, tolerating shell versions with slightly different seams. */
      function findPanel() {
        return (
          document.querySelector?.(SETTINGS_PANEL_SELECTOR) ??
          document.querySelector?.('[role="dialog"][aria-modal="true"]')
        )
      }

      /** Click the settings nav row that owns the requested section. */
      function selectSection(panel) {
        if (typeof panel?.querySelectorAll !== 'function') return false
        const target = sectionTitle()
        const buttons = [...panel.querySelectorAll('button')]
        const textOf = (button) => (button.textContent ?? '').replace(/\s+/g, '')
        const labelOf = (button) => (button.getAttribute?.('aria-label') ?? '').replace(/\s+/g, '')
        const match =
          buttons.find((button) => textOf(button) === target) ??
          buttons.find((button) => textOf(button).includes(target)) ??
          buttons.find((button) => labelOf(button).includes(target))
        if (!match || typeof match.click !== 'function') return false
        match.click()
        return true
      }

      /** The modal id the shortcuts adapter would report, so the command's own guard applies. */
      function currentModalId() {
        try {
          const dialogs = document.querySelectorAll?.(
            '[data-shortcut-modal], [role="dialog"][aria-modal="true"]',
          )
          const top = dialogs?.[dialogs.length - 1]
          if (!top) return null
          return top.getAttribute?.('data-shortcut-modal') ?? 'other'
        } catch {
          return null
        }
      }

      /**
       * What the running page says about the shell's settings seams: whether
       * the sidebar launcher exists, what `settings.open` looks like from here,
       * and (when a panel is up) which nav rows it painted. Every value is
       * optional, because a shell build may miss any of them.
       */
      function probe() {
        const facts = {}
        try {
          const root = document.querySelector?.(SETTINGS_ROOT_SELECTOR) ?? null
          facts.root = root !== null
          const scoped = root?.querySelector?.('button[aria-haspopup="dialog"]') ?? null
          facts.scoped = scoped === null ? null : {
            label: scoped.getAttribute?.('aria-label') ?? null,
            keys: scoped.getAttribute?.('aria-keyshortcuts') ?? null,
          }
          facts.global = document.querySelectorAll?.('button[aria-haspopup="dialog"]')?.length ?? -1
          facts.comma = document.querySelectorAll?.('button[aria-keyshortcuts*="omma"]')?.length ?? -1
          facts.slots = document.querySelectorAll?.('[data-slot]')?.length ?? -1
          facts.modal = currentModalId()
          const shortcuts = getShortcuts()
          facts.shortcuts = shortcuts === undefined ? null : Object.keys(shortcuts)
          facts.invoke = typeof shortcuts?.registry?.invoke
          facts.catalog = shortcuts?.catalog?.getSnapshot?.()?.length ?? -1
          const slots = getSlots()
          facts.slotNames = typeof slots?.entries === 'function'
            ? (slots.entries() ?? [])
              .map((entry) => entry.name)
              .filter((name) => typeof name === 'string' && name.includes('settings'))
            : null
          const seat = typeof slots?.entries === 'function' ? slots.entries('sidebar.settings') : undefined
          facts.seat = Array.isArray(seat) && seat.length > 0 ? Object.keys(seat[0]?.options ?? {}) : null
          const panel = findPanel()
          facts.panel = Boolean(panel)
          if (panel) {
            facts.nav = [...panel.querySelectorAll('button')]
              .map((button) => (button.textContent ?? '').replace(/\s+/g, ''))
              .slice(0, 16)
          }
        } catch (error) {
          facts.error = String(error?.message ?? error)
        }
        return facts
      }

      /**
       * Ask the shell's registered `settings.open` command. This is the shell's
       * own entry point and works for either launcher seat and for both
       * runtimes; it reports nothing back, so the panel is the receipt.
       */
      function invokeCommand() {
        try {
          const registry = getShortcuts()?.registry
          if (typeof registry?.invoke !== 'function') return false
          registry.invoke('settings.open', { region: 'page', modal: currentModalId() })
          return true
        } catch (error) {
          console.warn('[dsh-nudge] settings command failed', error)
          return false
        }
      }

      /** Synthesize the registered `settings.open` keystroke; Web shells only. */
      function pressShortcut() {
        try {
          if (typeof KeyboardEvent === 'undefined') return false
          const row = getShortcuts()?.catalog
            ?.getSnapshot?.()
            ?.find((entry) => entry.id === 'settings.open')
          const binding = row?.binding
          if (!binding) return false
          const modifiers = new Set(binding.modifiers ?? [])
          const event = new KeyboardEvent('keydown', {
            code: binding.code,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.has('control'),
            altKey: modifiers.has('alt'),
            shiftKey: modifiers.has('shift'),
            metaKey: modifiers.has('meta'),
          })
          const target = document.activeElement ?? document.body ?? window
          target.dispatchEvent(event)
          return true
        } catch (error) {
          console.warn('[dsh-nudge] settings shortcut failed', error)
          return false
        }
      }

      /**
       * Text that names the shell's Settings trigger. The shell labels it with
       * its own locale ("设置" / "Settings"), so match loosely.
       */
      const TRIGGER_TEXT = /设置|設定|偏好|settings?|preferences?/i

      /** Whether `button` carries a mark that identifies it as the Settings trigger. */
      function looksLikeTrigger(button) {
        const shortcut = button.getAttribute?.('aria-keyshortcuts') ?? ''
        if (/comma/i.test(shortcut)) return true
        const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title')]
          .filter((value) => typeof value === 'string')
          .join(' ')
        return TRIGGER_TEXT.test(label)
      }

      /**
       * The plain Settings trigger, wherever the shell renders it. A button is
       * only ever clicked here when it is *positively* identified as that
       * trigger — the sidebar seat holds other dialog buttons too (a usage
       * popover, an account menu), and clicking one of those is a visible side
       * effect for a jump that then has to escalate anyway.
       */
      function findTrigger() {
        const root = document.querySelector?.(SETTINGS_ROOT_SELECTOR)
        const scoped = root?.querySelector?.('button[aria-haspopup="dialog"]')
        if (scoped) return scoped
        // The launcher seat is shared: when the account menu owns it the plain
        // trigger is not rendered in the sidebar at all, so fall back to any
        // dialog button whose own marks name Settings. Prefer the closed one, so
        // the click opens instead of closes.
        const candidates = [
          ...(document.querySelectorAll?.('button[aria-haspopup="dialog"]') ?? []),
        ].filter((button) => looksLikeTrigger(button))
        const closed = candidates.find(
          (button) => button.getAttribute?.('aria-expanded') !== 'true',
        )
        return closed ?? candidates[0] ?? null
      }

      /**
       * The ways the shell can open Settings, in the order they are tried: the
       * registered command first (it carries no side effect when it is refused),
       * then the trigger button (it drives the shell's own chrome, but clicking
       * it is a real click), then a synthesized keystroke for Web shells.
       *
       * Every one of these fails silently on some shell build — a modal guard
       * refuses the command, the launcher seat belongs to the account menu, an
       * older shell has no command at all — so a route only reports that it
       * *asked*. The panel is the receipt, and the next route runs only when the
       * previous one painted nothing.
       */
      function routesOf() {
        return [
          { id: 'command', run: () => invokeCommand() },
          {
            id: 'trigger',
            run() {
              const trigger = findTrigger()
              if (trigger === null || typeof trigger.click !== 'function') return false
              trigger.click()
              return true
            },
          },
          { id: 'keystroke', run: () => pressShortcut() },
        ]
      }

      /** Run the next route; false once they are exhausted and the fallback ran. */
      function advance() {
        for (;;) {
          // A route may open the panel just after its budget expired; checking
          // before every route also stops the next one from closing a panel
          // that is already up (`settings.open` toggles when Settings owns the
          // modal).
          const open = findPanel()
          if (open !== null && open !== undefined) {
            awaitSection(open, Date.now() + SETTINGS_SECTION_MS)
            return true
          }
          if (index >= routes.length) break
          const route = routes[index]
          let acted = false
          try {
            acted = route.run() === true
          } catch (error) {
            console.warn('[dsh-nudge] settings route failed', route.id, error)
          }
          onDiag({ event: 'route', id: route.id, acted, ...probe() })
          if (acted) {
            awaitPanel(Date.now() + SETTINGS_ROUTE_MS)
            return true
          }
          index += 1
        }
        // No seam answered: hand over to the host's fallback so the gear is
        // never dead.
        console.warn('[dsh-nudge] no settings seam answered; showing the form in the window')
        onDiag({ event: 'fallback', ...probe() })
        onFallback()
        return false
      }

      /** Wait for the panel a route asked for; hand over to the next route if it never comes. */
      function awaitPanel(deadline) {
        cancel()
        const panel = findPanel()
        if (panel !== null && panel !== undefined) {
          awaitSection(panel, Date.now() + SETTINGS_SECTION_MS)
          return
        }
        if (Date.now() >= deadline) {
          index += 1
          advance()
          return
        }
        timer = setTimeout(() => {
          timer = undefined
          awaitPanel(deadline)
        }, SETTINGS_POLL_MS)
      }

      /** Land on the requested section once the panel painted its nav rows. */
      function awaitSection(panel, deadline) {
        if (selectSection(panel)) {
          onDiag({ event: 'landed' })
          return
        }
        if (Date.now() >= deadline) {
          // Some shells paint the panel before its rows. Keeping Settings open
          // beats closing it: the user can still pick the row by hand.
          console.warn('[dsh-nudge] settings panel painted no row for this plugin')
          onDiag({ event: 'no-row', ...probe() })
          return
        }
        timer = setTimeout(() => {
          timer = undefined
          awaitSection(findPanel() ?? panel, deadline)
        }, SETTINGS_POLL_MS)
      }

      /**
       * Open Settings, landing on the requested section.
       *
       * The shell exposes no public "open settings and navigate" service, so
       * the routes in `routesOf` are tried until one of them actually paints
       * the panel, and only then is the section row clicked. When no route
       * paints it — an older shell, or a launcher seat and shortcuts service
       * that are both unavailable — `onFallback` runs instead. Returns whether
       * a shell route acted.
       */
      function open() {
        cancel()
        routes = routesOf()
        index = 0
        try {
          return advance()
        } catch (error) {
          console.warn('[dsh-nudge] open settings failed', error)
          onDiag({ event: 'error', error: String(error?.message ?? error) })
          onFallback()
          return false
        }
      }

      return { open, cancel, probe }
    }

    exports.createSettingsJump = createSettingsJump
    return module.exports
  },
})
