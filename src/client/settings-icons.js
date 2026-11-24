/**
 * The glyphs and path data the settings rows share.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { h } from './react.js'

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


export { presetIcon, PENCIL_PATH, CHEVRON_RIGHT, CHEVRON_DOWN, TRASH_PATH }
