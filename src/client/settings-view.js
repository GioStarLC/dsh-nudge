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

      /** Fill `{n}` in a message template. */
      function fill(template, count) {
        return template.replace('{n}', String(count))
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
      /**
       * The settings dashboard: today's split, a 15-day trend and the prompts
       * used in the same window. Pure over the counters, so it reads on its own.
       */
      function StatsBoard(props) {
        const { t } = props
        const today = dayKey()
        const statsDays = props.stats?.days ?? {}
        /** The trend window, oldest first; the chart and Top 3 share it. */
        const windowKeys = recentDayKeys(15)
        const windowTotals = { send: 0, insert: 0, annotation: 0 }
        for (const key of windowKeys) {
          for (const field of STAT_FIELDS) windowTotals[field] += statsDays[key]?.[field] ?? 0
        }
        const windowTotal = STAT_FIELDS.reduce((sum, field) => sum + windowTotals[field], 0)
        const windowInputs = windowTotals.send + windowTotals.insert
        // Two series: everything typed into or sent to the composer is one
        // prompt use; notes stay separate because they answer a different
        // question ("how much did I annotate?").
        const inputSeries = windowKeys.map((key) => (statsDays[key]?.send ?? 0) + (statsDays[key]?.insert ?? 0))
        const noteSeries = windowKeys.map((key) => statsDays[key]?.annotation ?? 0)
        // Today splits the same two ways as the chart: a quick input counts
        // once whether it was sent or written, and notes stay their own number.
        const todayInputs = inputSeries[windowKeys.length - 1] ?? 0
        const todayNotes = noteSeries[windowKeys.length - 1] ?? 0
        const hasActivity = inputSeries.some((value) => value > 0) || noteSeries.some((value) => value > 0)
        /** Tallest value in either series; both lines share one scale. */
        const peak = Math.max(1, ...inputSeries, ...noteSeries)

        // Rank the prompts used in this same window. Counts live beside the
        // daily totals, so deleted prompts simply fall out of the list.
        const presetTotals = new Map()
        for (const key of windowKeys) {
          const presets = statsDays[key]?.presets
          if (presets === null || typeof presets !== 'object') continue
          for (const [id, count] of Object.entries(presets)) {
            presetTotals.set(id, (presetTotals.get(id) ?? 0) + count)
          }
        }
        const topPresets = [...presetTotals.entries()]
          .map(([id, total]) => ({ preset: props.presets.find((item) => item.id === id), total }))
          .filter((item) => item.preset !== undefined)
          .sort((a, b) => b.total - a.total || String(a.preset.id).localeCompare(String(b.preset.id)))
          .slice(0, 3)
        const topTotal = topPresets.reduce((sum, item) => sum + item.total, 0)

        // Hand-rolled SVG: the plugin ships no chart dependency. The days are
        // discrete, so the line runs straight between them and every day that
        // actually carries a count gets a marker: no invented smooth curve, and
        // the reader can still see where the data really is.
        const CHART_W = 320
        const CHART_H = 168
        const CHART_PAD_X = 6
        const CHART_PAD_TOP = 12
        const CHART_PAD_BOTTOM = 8
        const round = (value) => Math.round(value * 10) / 10
        const baseline = CHART_H - CHART_PAD_BOTTOM
        const plotHeight = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM
        /** The scale tops out at the busiest day; the top padding is the headroom. */
        const scaleMax = Math.max(1, peak)
        const xAt = (index) =>
          windowKeys.length <= 1
            ? CHART_PAD_X
            : CHART_PAD_X + (index * (CHART_W - CHART_PAD_X * 2)) / (windowKeys.length - 1)
        const yAt = (value) => baseline - (Math.max(0, value) / scaleMax) * plotHeight
        /** Straight segments between days: the value between two days is unknown. */
        function linePath(series) {
          return series
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${round(xAt(index))} ${round(yAt(value))}`)
            .join(' ')
        }
        /** The same line closed down to the baseline, for the soft fill. */
        function areaPath(series) {
          const first = round(xAt(0))
          const last = round(xAt(series.length - 1))
          return `${linePath(series)} L ${last} ${baseline} L ${first} ${baseline} Z`
        }
        /** One marker per day that really carries a count. */
        function pointsOf(series, className) {
          return series.flatMap((value, index) =>
            value <= 0
              ? []
              : [
                  h('circle', {
                    key: `point-${className}-${index}`,
                    className: `dsh-nudge-chart-point ${className}`,
                    cx: round(xAt(index)),
                    cy: round(yAt(value)),
                    r: className === 'input' ? '2.9' : '2.5',
                  }),
                ],
          )
        }
        /** Gridlines at half and full height, so the scale is readable. */
        const gridValues = [1, 0.5]
        const inputLine = linePath(inputSeries)
        const noteLine = linePath(noteSeries)
        const inputArea = areaPath(inputSeries)
        const noteArea = areaPath(noteSeries)
        const todayIndex = windowKeys.length - 1

        // The dashboard leads the settings page: it answers "am I using this?"
        // before the switches that change how it behaves.
        // before the switches that change how it behaves.
        return h(
          'div',
          { key: 'stats', className: 'dsh-nudge-stats-group' },
          h(
            'div',
            { className: 'dsh-nudge-stats-head' },
            h('span', { className: 'dsh-nudge-toggle-title' }, t('statsTitle')),
          ),
          h('span', { className: 'dsh-nudge-toggle-desc' }, t('statsHint')),
          h(
            'div',
            { className: 'dsh-nudge-stats-board' },
            h(
              'div',
              { className: 'dsh-nudge-stats-chart-pane' },
              h(
                'div',
                { className: 'dsh-nudge-stats-trend-head' },
                h('span', { className: 'dsh-nudge-chart-peak' }, fill(t('statsPeak'), peak)),
                h('span', { className: 'dsh-nudge-stats-total' }, fill(t('statsTimes'), windowTotal)),
              ),
              h(
                'div',
                { className: 'dsh-nudge-chart-wrap' },
                h(
                  'svg',
                  {
                    className: 'dsh-nudge-chart-svg',
                    viewBox: `0 0 ${CHART_W} ${CHART_H}`,
                    preserveAspectRatio: 'none',
                    'aria-hidden': 'true',
                  },
                  h(
                    'defs',
                    null,
                    h(
                      'linearGradient',
                      { id: 'dsh-nudge-fill-input', x1: '0', y1: '0', x2: '0', y2: '1' },
                      h('stop', { offset: '0%', stopColor: 'var(--dsw-static-deepseek-450,#5686fe)', stopOpacity: '0.14' }),
                      h('stop', { offset: '100%', stopColor: 'var(--dsw-static-deepseek-450,#5686fe)', stopOpacity: '0' }),
                    ),
                    h(
                      'linearGradient',
                      { id: 'dsh-nudge-fill-note', x1: '0', y1: '0', x2: '0', y2: '1' },
                      h('stop', { offset: '0%', stopColor: 'var(--dn-note)', stopOpacity: '0.10' }),
                      h('stop', { offset: '100%', stopColor: 'var(--dn-note)', stopOpacity: '0' }),
                    ),
                  ),
                  ...gridValues.map((fraction) =>
                    h('line', {
                      key: `grid-${fraction}`,
                      className: 'dsh-nudge-chart-grid',
                      x1: '0',
                      y1: round(baseline - fraction * plotHeight),
                      x2: CHART_W,
                      y2: round(baseline - fraction * plotHeight),
                      vectorEffect: 'non-scaling-stroke',
                    }),
                  ),
                  h('line', {
                    className: 'dsh-nudge-chart-axis-line',
                    x1: '0',
                    y1: baseline,
                    x2: CHART_W,
                    y2: baseline,
                    vectorEffect: 'non-scaling-stroke',
                  }),
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-area note',
                        d: noteArea,
                        fill: 'url(#dsh-nudge-fill-note)',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-area input',
                        d: inputArea,
                        fill: 'url(#dsh-nudge-fill-input)',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-line note',
                        d: noteLine,
                        fill: 'none',
                        stroke: 'var(--dn-note)',
                        strokeWidth: '1.6',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        vectorEffect: 'non-scaling-stroke',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-line input',
                        d: inputLine,
                        fill: 'none',
                        stroke: 'var(--dsw-static-deepseek-450,#5686fe)',
                        strokeWidth: '1.8',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        vectorEffect: 'non-scaling-stroke',
                      })
                    : null,
                  ...(hasActivity ? pointsOf(noteSeries, 'note') : []),
                  ...(hasActivity ? pointsOf(inputSeries, 'input') : []),
                ),
                hasActivity
                  ? null
                  : h('div', { className: 'dsh-nudge-chart-empty' }, t('statsEmpty')),
                h(
                  'div',
                  { className: 'dsh-nudge-chart-hits' },
                  ...windowKeys.map((key, index) =>
                    h(
                      'div',
                      { key, className: 'dsh-nudge-chart-hit' },
                      h(
                        'span',
                        { className: 'dsh-nudge-chart-tip' },
                        h(
                          'span',
                          { className: 'dsh-nudge-chart-tip-date' },
                          key === today ? t('statsToday') : key.slice(5),
                        ),
                        h(
                          'span',
                          { className: 'dsh-nudge-chart-tip-values' },
                          `${t('statsLegendInput')} ${inputSeries[index]} · ${t('statsAnnotation')} ${noteSeries[index]}`,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsh-nudge-stats-axis' },
                h('span', null, windowKeys[0].slice(5)),
                h('span', null, windowKeys[7].slice(5)),
                h('span', null, t('statsToday')),
              ),
              h(
                'div',
                { className: 'dsh-nudge-chart-legend' },
                h(
                  'span',
                  { className: 'dsh-nudge-chart-legend-item' },
                  h('i', { className: 'dsh-nudge-chart-dot input' }),
                  t('statsLegendInput'),
                ),
                h(
                  'span',
                  { className: 'dsh-nudge-chart-legend-item' },
                  h('i', { className: 'dsh-nudge-chart-dot note' }),
                  t('statsAnnotation'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-nudge-stats-side' },
              h(
                'div',
                { className: 'dsh-nudge-stats-today' },
                h(
                  'div',
                  { className: 'dsh-nudge-stats-today-head' },
                  h('span', { className: 'dsh-nudge-stats-today-label' }, t('statsToday')),
                  h('span', { className: 'dsh-nudge-stats-today-date' }, today.slice(5)),
                ),
                h(
                  'div',
                  { className: 'dsh-nudge-stats' },
                  ...[
                    { key: 'input', value: todayInputs, label: t('statsLegendInput') },
                    { key: 'note', value: todayNotes, label: t('statsAnnotation') },
                  ].map((item) =>
                    h(
                      'div',
                      { key: item.key, className: 'dsh-nudge-stat' },
                      h('span', { className: 'dsh-nudge-stat-value' }, String(item.value)),
                      h('span', { className: 'dsh-nudge-stat-label' }, item.label),
                    ),
                  ),
                ),
              ),
              h('div', { className: 'dsh-nudge-stats-side-head' }, h('span', null, t('statsTopTitle'))),
              topPresets.length === 0
                ? h(
                    'div',
                    { className: 'dsh-nudge-stats-side-empty' },
                    windowInputs > 0 ? t('statsTopSince') : t('statsTopEmpty'),
                  )
                : h(
                    'ol',
                    { className: 'dsh-nudge-top-list' },
                    ...topPresets.map((item, index) =>
                      h(
                        'li',
                        { key: item.preset.id, className: 'dsh-nudge-top-item' },
                        h('span', { className: 'dsh-nudge-top-rank' }, String(index + 1)),
                        h('span', { className: 'dsh-nudge-top-label', title: item.preset.text }, item.preset.label),
                        h('span', { className: 'dsh-nudge-top-count' }, fill(t('statsCountUnit'), item.total)),
                      ),
                    ),
                  ),
              topPresets.length > 0
                ? h('div', { className: 'dsh-nudge-stats-share' }, fill(t('statsTopShare'), topTotal))
                : null,
            ),
          ),
        )
      }


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
