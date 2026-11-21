/**
 * The Settings section's render tree.
 *
 * Counters, prompts, idle lines, switches and the appearance row.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { FRAME_CHOICES } from './constants.js'
import { viewCss } from './css.js'
import { React, h } from './react.js'
import { StatsBoard, fill } from './stats-board.js'
import { frameLabelKey } from './settings.js'
import { STAT_FIELDS, dayKey, recentDayKeys } from './stats.js'

    /**
     * Build the plugin's settings section: edit, add, delete and reset the probe
     * presets. This is the only place a preset is authored; the floating window
     * is just a flat picker over the same list.
     * @param runtime - the window runtime (same store the window reads).
     * @returns the settings-slot component.
     */
    function makeSettingsView(runtime) {
      const useSyncExternalStore =
        React.useSyncExternalStore ??
        function useSyncExternalStoreFallback(subscribe, getSnapshot) {
          const [value, setValue] = React.useState(getSnapshot)
          React.useEffect(() => {
            setValue(getSnapshot())
            return subscribe(() => setValue(getSnapshot()))
          }, [subscribe, getSnapshot])
          return value
        }

      /**
       * One labelled checkbox row, shared by every boolean setting.
       * Built eagerly (a plain element, not a component) so the settings tree
       * stays directly inspectable by the checks.
       */
      function toggleRow(props) {
        const { title, desc, checked, onChange } = props
        return h(
          'label',
          { className: 'dsh-nudge-toggle', title: desc, 'data-setting': props.key },
          h('input', {
            type: 'checkbox',
            checked: checked === true,
            onChange: (event) => onChange(event.target.checked),
          }),
          h(
            'span',
            { className: 'dsh-nudge-toggle-text' },
            h('span', { className: 'dsh-nudge-toggle-title' }, title),
            h('span', { className: 'dsh-nudge-toggle-desc' }, desc),
          ),
        )
      }

      /** A small 16px stroke icon, matching the window's own icons. */
      function presetIcon(pathData) {
        return h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          h('path', { d: pathData }),
        )
      }

      const PENCIL_PATH = 'M10.6 2.4l3 3-8.2 8.2-3.4.6.6-3.4 8-8.4z'
      const CHEVRON_RIGHT = 'M6 4l4 4-4 4'
      const CHEVRON_DOWN = 'M4 6.5l4 4 4-4'
      const TRASH_PATH = 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8'

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
                className: `dsh-nudge-preset-state${enabled ? ' on' : ''}`,
                title: enabled ? t('presetEnabledHint') : t('presetDisabledHint'),
                role: 'switch',
                'aria-checked': enabled ? 'true' : 'false',
                'aria-label': enabled ? t('presetEnabledHint') : t('presetDisabledHint'),
                onClick: () => {
                  runtime.togglePresetEnabled(preset.id)
                  onError('')
                },
              },
              enabled ? t('presetEnabled') : t('presetDisabled'),
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
            ? h('div', { className: 'dsh-nudge-preset-body' }, preset.text)
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
            className: `dsh-nudge-preset-row${editing ? ' editing' : ''}${enabled ? '' : ' disabled'}`,
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

      return function NudgeSettings() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const [error, setError] = React.useState('')
        /** What the last paste into each list did, shown under that list's own box. */
        const [presetNote, setPresetNote] = React.useState('')
        const [tipNote, setTipNote] = React.useState('')
        const [draftLabel, setDraftLabel] = React.useState('')
        const [draftText, setDraftText] = React.useState('')
        const [draftTip, setDraftTip] = React.useState('')
        const [importOpen, setImportOpen] = React.useState(false)
        const [draftImport, setDraftImport] = React.useState('')
        const [copyNote, setCopyNote] = React.useState('')
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()
        function add() {
          const result = runtime.addPreset(draftLabel, draftText)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setDraftLabel('')
          setDraftText('')
          setError('')
        }

        /** Take one paste (or one typed block) and report what landed. */
        function addTipLines(raw) {
          const result = runtime.addTips(raw)
          if (!result.ok) {
            setError(result.error)
            setTipNote('')
            return false
          }
          const parts = [fill(t('tipsAdded'), result.added)]
          if (result.skipped > 0) parts.push(fill(t('tipsSkipped'), result.skipped))
          setError('')
          setTipNote(parts.join('，'))
          setDraftTip('')
          return true
        }

        function addTipLine() {
          addTipLines(draftTip)
        }

        /** Take one pasted block list and report what landed. */
        function importLines(raw) {
          const result = runtime.importPresets(raw)
          if (!result.ok) {
            setError(result.error)
            setPresetNote('')
            return false
          }
          const parts = [fill(t('importAdded'), result.added)]
          if (result.skipped > 0) parts.push(fill(t('importSkipped'), result.skipped))
          setError('')
          setPresetNote(parts.join('，'))
          setDraftImport('')
          return true
        }

        /** Copy every configured prompt and report the outcome in place. */
        function exportLines() {
          Promise.resolve(runtime.exportPresets()).then((result) => {
            if (result?.ok !== true) {
              setError(result?.error ?? t('exportFailed'))
              setCopyNote('')
              return
            }
            setError('')
            setCopyNote(fill(t('exportDone'), result.count))
          })
        }

        /** A pasted list is split right away: no extra click needed. */
        function onTipPaste(event) {
          const text = event?.clipboardData?.getData?.('text')
          if (typeof text !== 'string' || text.trim() === '') return
          event.preventDefault?.()
          addTipLines(text)
        }

        /**
         * One settings block with the same heading rhythm as a floating-window
         * module: accent bar, title, optional one-line description.
         */
        function settingsSection(key, title, desc, children, options) {
          const collapsible = options?.collapsible === true
          const head = h(
            collapsible ? 'summary' : 'div',
            { className: 'dsh-nudge-settings-section-head' },
            h('span', { className: 'dsh-nudge-settings-section-title' }, title),
            options?.meta ? h('span', { className: 'dsh-nudge-settings-section-meta' }, options.meta) : null,
          )
          return h(
            collapsible ? 'details' : 'section',
            { key, className: `dsh-nudge-settings-section${collapsible ? ' collapsible' : ''}` },
            head,
            desc ? h('div', { className: 'dsh-nudge-settings-section-desc' }, desc) : null,
            ...children,
          )
        }

        /** A nested, closed-by-default editor (the long prompt list). */
        function foldGroup(key, title, meta, children, hint) {
          return h(
            'details',
            { key, className: 'dsh-nudge-settings-fold' },
            h(
              'summary',
              {
                className: 'dsh-nudge-settings-fold-head',
                ...(typeof hint === 'string' && hint !== '' ? { title: hint } : null),
              },
              h('span', null, title),
              meta ? h('span', { className: 'dsh-nudge-settings-fold-meta' }, meta) : null,
            ),
            ...children,
          )
        }

        const statsSection = StatsBoard({ stats: state.stats, presets: state.presets, t })

        return h(
          'div',
          { className: 'dsh-nudge-settings' },
          h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
          statsSection,
          // The settings page follows the floating window: notes, quick input,
          // then appearance (border and status line). Both long editors start
          // folded so the switches stay in view.
          settingsSection('annotations', t('annotationsTitle'), null, [
            toggleRow({
              key: 'quick',
              title: t('quickTitle'),
              desc: t('quickHint'),
              checked: state.quick === true,
              onChange: (value) => runtime.setQuick(value),
            }),
            toggleRow({
              key: 'autopaste',
              title: t('autoPasteTitle'),
              desc: t('autoPasteDesc'),
              checked: state.autoPaste === true,
              onChange: (value) => runtime.setAutoPaste(value),
            }),
          ]),
          settingsSection('quickinput', t('nudgeModule'), t('presetsHint'), [
            foldGroup('presets', t('presetList'), t('presetCount').replace('{n}', String(state.presets.length)), [
            // The list is a table of contents: names only, bodies on demand.
            h(
              'div',
              { className: 'dsh-nudge-preset-toolbar' },
              h('span', { className: 'dsh-nudge-preset-count' }, t('presetCount').replace('{n}', String(state.presets.length))),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  disabled: state.presets.length === 0,
                  onClick: () => runtime.setPresetsOpen(true),
                },
                t('expandAllPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  disabled: state.presetOpen.length === 0,
                  onClick: () => runtime.setPresetsOpen(false),
                },
                t('collapseAllPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  'aria-expanded': importOpen ? 'true' : 'false',
                  onClick: () => setImportOpen(importOpen !== true),
                },
                t('importPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  title: t('exportHint'),
                  disabled: state.presets.length === 0,
                  onClick: exportLines,
                },
                t('exportPresets'),
              ),
            ),
            copyNote.length > 0
              ? h('div', { key: 'preset-copy-note', className: 'dsh-nudge-settings-note' }, copyNote)
              : null,
            state.presets.length === 0
              ? h('div', { className: 'dsh-nudge-preset-empty' }, t('presetsEmpty'))
              : null,
            ...state.presets.map((preset, index) =>
              h(PresetRow, {
                key: preset.id,
                preset,
                t,
                onError: setError,
                index,
                total: state.presets.length,
              }),
            ),
            h(
              'div',
              { className: 'dsh-nudge-preset-row dsh-nudge-preset-add' },
              h(
                'div',
                { className: 'dsh-nudge-preset-line' },
                h('input', {
                  type: 'text',
                  value: draftLabel,
                  placeholder: t('presetLabel'),
                  'aria-label': t('presetLabel'),
                  onChange: (event) => setDraftLabel(event.target.value),
                }),
              ),
              h('textarea', {
                value: draftText,
                placeholder: t('presetText'),
                'aria-label': t('presetText'),
                onChange: (event) => setDraftText(event.target.value),
              }),
              h(
                'div',
                { className: 'dsh-nudge-preset-actions' },
                h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: add }, t('addPreset')),
              ),
            ),
            importOpen
              ? h(
                  'div',
                  { className: 'dsh-nudge-preset-import' },
                  h('div', { className: 'dsh-nudge-settings-hint' }, t('importHint')),
                  h('textarea', {
                    value: draftImport,
                    placeholder: t('importPlaceholder'),
                    'aria-label': t('importPresets'),
                    onChange: (event) => setDraftImport(event.target.value),
                  }),
                  h(
                    'div',
                    { className: 'dsh-nudge-preset-actions' },
                    h(
                      'button',
                      { type: 'button', className: 'dsh-nudge-btn primary', onClick: () => importLines(draftImport) },
                      t('importSubmit'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-nudge-btn',
                        onClick: () => {
                          setImportOpen(false)
                          setDraftImport('')
                          setPresetNote('')
                          setError('')
                        },
                      },
                      t('cancelPreset'),
                    ),
                  ),
                )
              : null,
            // The import count belongs under the import box, not under the
            // idle-line box further down the page.
            presetNote.length > 0
              ? h('div', { key: 'preset-import-note', className: 'dsh-nudge-settings-note' }, presetNote)
              : null,
            h(
              'div',
              { className: 'dsh-nudge-preset-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  onClick: () => {
                    runtime.resetPresets()
                    setPresetNote('')
                    setError('')
                  },
                },
                t('resetPresets'),
              ),
            ),
            ]),
            h(
              'div',
              {
                key: 'delivery',
                className: 'dsh-nudge-settings-group dsh-nudge-settings-inline',
                title: t('deliveryDesc'),
              },
              h('span', { className: 'dsh-nudge-toggle-title' }, t('deliveryTitle')),
              h(
                'div',
                { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('deliveryTitle') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-chip${delivery === 'steer' ? ' active' : ''}`,
                    title: t('deliveryTipSteer'),
                    'aria-pressed': delivery === 'steer' ? 'true' : 'false',
                    onClick: () => runtime.setDelivery('steer'),
                  },
                  t('steer'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-chip${delivery === 'steer' ? '' : ' active'}`,
                    title: t('deliveryTipQueue'),
                    'aria-pressed': delivery === 'steer' ? 'false' : 'true',
                    onClick: () => runtime.setDelivery('followup'),
                  },
                  t('queue'),
                ),
              ),
            ),
            toggleRow({
              key: 'turbo',
              title: t('turboTitle'),
              desc: t('turboDesc'),
              checked: state.turbo === true,
              onChange: (value) => runtime.setTurbo(value),
            }),
          ]),
          settingsSection('appearance', t('appearanceTitle'), null, [
            h(
              'div',
              {
                key: 'frame',
                className: 'dsh-nudge-settings-group dsh-nudge-settings-inline',
                title: t('frameDesc'),
              },
              h('span', { className: 'dsh-nudge-toggle-title' }, t('frameTitle')),
              h(
                'div',
                { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('frameTitle') },
                ...FRAME_CHOICES.map((width) =>
                  h(
                    'button',
                    {
                      key: `frame-${width}`,
                      type: 'button',
                      className: `dsh-nudge-chip${state.frame === width ? ' active' : ''}`,
                      'aria-pressed': state.frame === width ? 'true' : 'false',
                      onClick: () => runtime.setFrame(width),
                    },
                    t(frameLabelKey(width)),
                  ),
                ),
              ),
            ),
            // The status row belongs to how the window looks, so it lives with
            // the border. Its list is long: the editor starts folded.
            foldGroup('tips', t('tipsTitle'), t('tipsCount').replace('{n}', String(state.tips.length)), [
              // The paste box sits above the list: it is the way in, so it must
              // not hide under a dozen existing lines.
              h(
                'div',
                { key: 'tip-draft', className: 'dsh-nudge-tip-draft' },
                h('textarea', {
                  value: draftTip,
                  placeholder: t('tipsPastePlaceholder'),
                  'aria-label': t('tipsPastePlaceholder'),
                  onChange: (event) => setDraftTip(event.target.value),
                  onPaste: onTipPaste,
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && (event.ctrlKey === true || event.metaKey === true)) {
                      addTipLine()
                    }
                  },
                }),
                h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: addTipLine }, t('addTip')),
              ),
              tipNote.length > 0 ? h('div', { key: 'tips-note', className: 'dsh-nudge-settings-note' }, tipNote) : null,
              // Keyed by the line (the list holds no duplicates), not by the slot:
              // a row that moves keeps its own half-typed text instead of handing
              // it to whichever line lands where it used to be.
              ...state.tips.map((line, index) =>
                h(TipRow, {
                  key: `tip:${line}`,
                  value: line,
                  t,
                  onError: setError,
                  index,
                }),
              ),
              h(
                'div',
                { key: 'tips-reset', className: 'dsh-nudge-preset-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-btn',
                    onClick: () => {
                      runtime.resetTips()
                      setError('')
                      setTipNote('')
                    },
                  },
                  t('resetTips'),
                ),
              ),
            ], t('tipsHint')),
          ]),
          error.length > 0 ? h('div', { className: 'dsh-nudge-settings-error' }, error) : null,
        )
      }
    }

    // ---------------------------------------------------------------------
    // composer bridge
    // ---------------------------------------------------------------------

export { makeSettingsView }
