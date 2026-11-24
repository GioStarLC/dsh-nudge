/**
 * The pinned prompts on the composer's own left row.
 *
 * A zero-DOM-free slot entry that renders the chips, folds the extra ones into
 * a "more" menu and hands every press to the runtime: one press appends, the
 * second half of a double press sends the draft the first press composed.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { React, h } from './react.js'

    /** How many pinned prompts the bar shows before it folds the rest. */
    const MAX_BAR_PROMPTS = 4

    /**
     * Style for the pinned prompts. It rides the entry itself: the bar lives in
     * the shell's input row, outside the window's own stylesheet.
     */
    const INPUT_BAR_CSS = `
.dsh-nudge-input-bar{display:inline-flex;align-items:center;gap:4px;min-width:0}
.dsh-nudge-bar-chip{max-width:9em;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dsh-nudge-bar-chip:hover{background:var(--dn-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-bar-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
.dsh-nudge-bar-more{position:relative;display:inline-flex}
.dsh-nudge-bar-more .dsh-nudge-bar-menu{display:none}
.dsh-nudge-bar-more:hover .dsh-nudge-bar-menu,.dsh-nudge-bar-more:focus-within .dsh-nudge-bar-menu{display:flex}
.dsh-nudge-bar-menu{position:absolute;left:0;bottom:calc(100% + 6px);z-index:60;flex-direction:column;min-width:132px;max-height:240px;overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 30px rgba(0,0,0,.16)}
.dsh-nudge-bar-menu-item{height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.dsh-nudge-bar-menu-item:hover{background:var(--dn-hover,rgba(127,127,127,.12))}
`

    /**
     * Pinned prompts on the composer's own left row. A click appends the prompt
     * to the draft on a new line; the bar never sends and never moves the window.
     * @param runtime - the window runtime.
     * @returns the slot component.
     */
    function makeInputBar(runtime) {
      const useSyncExternalStore =
        React.useSyncExternalStore ??
        function useSyncExternalStoreFallback(subscribe, getSnapshot) {
          return getSnapshot()
        }
      return function NudgeInputBar() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const presets = Array.isArray(state.presets) ? state.presets : []
        const pinned = presets.filter((preset) => preset.pinned === true)
        if (pinned.length === 0) return null
        const shown = pinned.slice(0, MAX_BAR_PROMPTS)
        const rest = pinned.slice(MAX_BAR_PROMPTS)
        // Keeping the press from moving focus keeps the caret and the native
        // selection in the composer while the click lands.
        const keepFocus = (event) => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
        }
        const chip = (preset) =>
          h(
            'button',
            {
              key: preset.id,
              type: 'button',
              className: 'dsh-nudge-bar-chip',
              title: preset.text,
              onMouseDown: keepFocus,
              // detail is 2 on the second press of a double click: send the
              // draft the first press already composed instead of appending twice.
              onClick: (event) => {
                if (Number(event?.detail) >= 2) runtime.sendDraft(preset.id)
                else runtime.appendPrompt(preset.id)
              },
            },
            preset.label,
          )
        return h(
          'div',
          { className: 'dsh-nudge-input-bar' },
          h('style', { key: 'dsh-nudge-bar-css' }, INPUT_BAR_CSS),
          ...shown.map(chip),
          rest.length === 0
            ? null
            : h(
                'span',
                { key: 'more', className: 'dsh-nudge-bar-more' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-bar-chip',
                    'aria-haspopup': 'menu',
                    'aria-label': runtime.text('morePrompts'),
                    onMouseDown: keepFocus,
                  },
                  runtime.text('morePrompts'),
                ),
                h(
                  'div',
                  { className: 'dsh-nudge-bar-menu', role: 'menu' },
                  ...rest.map((preset) =>
                    h(
                      'button',
                      {
                        key: preset.id,
                        type: 'button',
                        role: 'menuitem',
                        className: 'dsh-nudge-bar-menu-item',
                        title: preset.text,
                        onClick: () => runtime.insertPreset(preset.id),
                      },
                      preset.label,
                    ),
                  ),
                ),
              ),
        )
      }
    }

export { makeInputBar, MAX_BAR_PROMPTS }
