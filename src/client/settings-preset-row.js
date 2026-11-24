/**
 * One preset row: name, expander, the two places, edit/delete and drag.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { React, h } from './react.js'
import { CHEVRON_DOWN, CHEVRON_RIGHT, PENCIL_PATH, TRASH_PATH, presetIcon } from './settings-icons.js'

    /**
     * Build the row over one runtime.
     *
     * @param runtime - the settings runtime.
     * @returns the row component.
     */
    function makePresetRow(runtime) {
      /** The preset being dragged, shared by the drag handlers of one list. */
      let draggingId = null
      /** Index of the idle line being dragged, or null. */
      let draggingTip = null

      /**
       * One preset row: a summary line (name, expander, edit, delete, drag),
       * an optional read-only body, and an editor that only writes on save.
       */
      function PresetRow(props) {
        const { preset, t, onError, index, total } = props
        const snapshot = runtime.getSnapshot()
        const open = snapshot.presetOpen.includes(preset.id)
        const editing = snapshot.presetEditingId === preset.id
        const [label, setLabel] = React.useState(preset.label)
        const [text, setText] = React.useState(preset.text)
        React.useEffect(() => {
          setLabel(preset.label)
          setText(preset.text)
        }, [preset.id, preset.label, preset.text])

        function save() {
          const result = runtime.updatePreset(preset.id, { label, text })
          onError(result.ok ? '' : result.error)
        }

        function cancel() {
          setLabel(preset.label)
          setText(preset.text)
          runtime.cancelPresetEdit()
          onError('')
        }

        const enabled = preset.enabled !== false
        const placed = enabled || preset.pinned === true

        /**
         * Live reorder while the pointer travels: the dragged row trades slots
         * with the row under the cursor as soon as the midpoint is crossed, so
         * the list follows the pointer instead of waiting for the drop.
         */
        function dragOverRow(event) {
          if (draggingId === null || draggingId === preset.id) return
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          if (event?.dataTransfer) {
            try {
              event.dataTransfer.dropEffect = 'move'
            } catch {
              /* best effort */
            }
          }
          const target = event?.currentTarget
          const rect = target && typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : undefined
          if (rect === undefined) return
          const after = Number(event.clientY) > rect.top + rect.height / 2
          const list = runtime.getSnapshot().presets
          const from = list.findIndex((item) => item.id === draggingId)
          if (from < 0) return
          const to = after ? (from < index ? index : index + 1) : from < index ? index - 1 : index
          if (to === from || to < 0 || to >= list.length) return
          if (runtime.movePresetTo(draggingId, to)) onError('')
        }

        function dropOn(event) {
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          draggingId = null
        }

        function nudge(delta) {
          if (runtime.movePresetTo(preset.id, index + delta)) onError('')
        }

        const summary = h(
          'div',
          {
            className: 'dsh-nudge-preset-summary',
            draggable: true,
            onDragStart: (event) => {
              draggingId = preset.id
              const row =
                event?.currentTarget && typeof event.currentTarget.closest === 'function'
                  ? event.currentTarget.closest('.dsh-nudge-preset-row')
                  : null
              if (row) row.classList.add('dragging')
              if (event?.dataTransfer) {
                try {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', preset.id)
                } catch {
                  /* best effort */
                }
              }
            },
            onDragEnd: (event) => {
              draggingId = null
              const row =
                event?.currentTarget && typeof event.currentTarget.closest === 'function'
                  ? event.currentTarget.closest('.dsh-nudge-preset-row')
                  : null
              if (row) row.classList.remove('dragging')
            },
          },
          h(
            'span',
            {
              className: 'dsh-nudge-preset-grip',
              title: t('dragPreset'),
              role: 'button',
              tabIndex: 0,
              'aria-label': t('dragPreset'),
              onKeyDown: (event) => {
                if (event.key === 'ArrowUp') nudge(-1)
                if (event.key === 'ArrowDown') nudge(1)
              },
            },
            '⠿',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-nudge-preset-toggle',
              title: open ? t('collapsePreset') : t('expandPreset'),
              'aria-label': open ? t('collapsePreset') : t('expandPreset'),
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => runtime.togglePresetOpen(preset.id),
            },
            h('span', { className: 'dsh-nudge-preset-name' }, preset.label),
            presetIcon(open ? CHEVRON_DOWN : CHEVRON_RIGHT),
          ),
          h(
            'div',
            { className: 'dsh-nudge-preset-tools' },
            h(
              'button',
              {
                type: 'button',
                className: `dsh-nudge-preset-place${enabled ? ' on' : ''}`,
                'data-place': 'window',
                title: enabled ? t('placeWindowHint') : t('placeWindowOffHint'),
                role: 'switch',
                'aria-checked': enabled ? 'true' : 'false',
                'aria-label': t('placeWindow'),
                onClick: () => {
                  runtime.togglePresetEnabled(preset.id)
                  onError('')
                },
              },
              h('span', { className: 'dsh-nudge-place-long' }, t('placeWindow')),
              h('span', { className: 'dsh-nudge-place-short', 'aria-hidden': 'true' }, t('placeWindowShort')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: `dsh-nudge-preset-place${preset.pinned === true ? ' on' : ''}`,
                'data-place': 'input',
                title: t('placeInputHint'),
                role: 'switch',
                'aria-checked': preset.pinned === true ? 'true' : 'false',
                'aria-label': t('placeInput'),
                onClick: () => {
                  runtime.setPresetPinned(preset.id, preset.pinned !== true)
                  onError('')
                },
              },
              h('span', { className: 'dsh-nudge-place-long' }, t('placeInput')),
              h('span', { className: 'dsh-nudge-place-short', 'aria-hidden': 'true' }, t('placeInputShort')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('editPreset'),
                'aria-label': t('editPreset'),
                'aria-pressed': editing ? 'true' : 'false',
                onClick: () => {
                  if (editing) cancel()
                  else {
                    onError('')
                    runtime.startPresetEdit(preset.id)
                  }
                },
              },
              presetIcon(PENCIL_PATH),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon danger',
                title: t('deletePreset'),
                'aria-label': t('deletePreset'),
                onClick: () => {
                  onError(runtime.removePreset(preset.id) ? '' : t('presetTextRequired'))
                },
              },
              presetIcon(TRASH_PATH),
            ),
          ),
        )

        const body =
          open && !editing
            ? h('div', { className: 'dsh-nudge-preset-body' }, h('div', { className: 'dsh-nudge-preset-text' }, preset.text))
            : null

        const editor = editing
          ? h(
              'div',
              { className: 'dsh-nudge-preset-editor' },
              h('input', {
                type: 'text',
                value: label,
                placeholder: t('presetLabel'),
                'aria-label': t('presetLabel'),
                onChange: (event) => setLabel(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') save()
                  if (event.key === 'Escape') cancel()
                },
              }),
              h('textarea', {
                value: text,
                placeholder: t('presetText'),
                'aria-label': t('presetText'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && event.shiftKey !== true) save()
                  if (event.key === 'Escape') cancel()
                },
              }),
              h(
                'div',
                { className: 'dsh-nudge-preset-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn primary', onClick: save },
                  t('savePreset'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn', onClick: cancel },
                  t('cancelPreset'),
                ),
              ),
            )
          : null

        return h(
          'div',
          {
            className: `dsh-nudge-preset-row${editing ? ' editing' : ''}${placed ? '' : ' disabled'}`,
            'data-preset-id': preset.id,
            'data-open': open ? 'true' : 'false',
            onDragOver: dragOverRow,
            onDragEnter: dragOverRow,
            onDrop: dropOn,
          },
          summary,
          body,
          editor,
        )
      }

      return PresetRow
    }

export { makePresetRow }
