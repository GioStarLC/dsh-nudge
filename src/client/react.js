/**
 * React, as the bundle sees it.
 *
 * The DSH client module loader hands the factory a `require`; rollup turns
 * the import into `require("react")` and the wrapper in `scripts/build.mjs`
 * supplies it. Every module that renders imports `h` (and `React` when it
 * needs a hook) from here, so the peer dependency is declared once.
 */
import React from 'react'

export { React }
export const h = React.createElement
