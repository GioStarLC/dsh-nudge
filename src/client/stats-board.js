/**
 * The settings dashboard: today's split, the trend and the prompt ranking.
 *
 * Pure over the counters it is handed: the chart, the Top 3 and the empty
 * state are all derived from `stats` and `presets`, so it can be read (and
 * changed) without knowing anything about the settings form around it.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { h } from './react.js'
import { STAT_FIELDS, dayKey, recentDayKeys } from './stats.js'

      /** Fill `{n}` in a message template. */
      function fill(template, count) {
        return template.replace('{n}', String(count))
      }

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

export { StatsBoard, fill }
