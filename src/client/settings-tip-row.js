/**
 * One idle line: the text as a row, an editor behind the pencil, drag order.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { React, h } from './react.js'
import { PENCIL_PATH, TRASH_PATH, presetIcon } from './settings-icons.js'

    /**
     * Build the row over one runtime.
     *
     * @param runtime - the settings runtime.
     * @returns the row component.
     */
    function makeTipRow(runtime) {
      /** Index of the idle line being dragged, or null. */
      let draggingTip = null

      /**
       * One idle line: the text as a row, an editor behind the pencil icon,
       * and drag (or ↑ ↓ on the handle) for order. No body of its own.
       */
      function TipRow(props) {
        const { value, t, onError, index } = props
        const snapshot = runtime.getSnapshot()
        const editing = snapshot.tipEditingIndex === index
        const [line, setLine] = React.useState(value)
        React.useEffect(() => {
          setLine(value)
        }, [value])

        function save() {
          if (!runtime.updateTip(index, line)) {
            setLine(value)
            onError(t('tipTextRequired'))
            return
          }
          onError('')
        }

        function cancel() {
          setLine(value)
          runtime.cancelTipEdit()
          onError('')
        }

        function nudge(delta) {
          if (runtime.moveTipTo(index, index + delta)) onError('')
        }

        function dropOn(event) {
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          const from = draggingTip
          draggingTip = null
          if (from === null || from === index) return
          if (runtime.moveTipTo(from, index)) onError('')
        }

        const summary = h(
          'div',
          {
            className: 'dsh-nudge-preset-summary',
            draggable: true,
            onDragStart: () => {
              draggingTip = index
            },
            onDragEnd: () => {
              draggingTip = null
            },
            onDragOver: (event) => {
              if (draggingTip === null) return
              if (typeof event.preventDefault === 'function') event.preventDefault()
            },
            onDrop: dropOn,
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
          h('span', { className: 'dsh-nudge-tip-name' }, value),
          h(
            'div',
            { className: 'dsh-nudge-preset-tools' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('editTip'),
                'aria-label': t('editTip'),
                'aria-pressed': editing ? 'true' : 'false',
                onClick: () => {
                  if (editing) cancel()
                  else {
                    onError('')
                    runtime.startTipEdit(index)
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
                title: t('deleteTip'),
                'aria-label': t('deleteTip'),
                onClick: () => {
                  onError(runtime.removeTip(index) ? '' : t('tipLast'))
                },
              },
              presetIcon(TRASH_PATH),
            ),
          ),
        )

        const editor = editing
          ? h(
              'div',
              { className: 'dsh-nudge-preset-editor' },
              h('input', {
                type: 'text',
                value: line,
                placeholder: t('tipsPlaceholder'),
                'aria-label': t('tipsPlaceholder'),
                onChange: (event) => setLine(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') save()
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
          { className: 'dsh-nudge-preset-row dsh-nudge-tip-row', 'data-tip-index': index },
          summary,
          editor,
        )
      }

      return TipRow
    }

export { makeTipRow }
