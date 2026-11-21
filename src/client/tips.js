/**
 * Idle lines: the built-ins and the shapes a stored list may take.
 *
 * One line shows at a time while nothing is happening; the list is editable.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { BUILTIN_TIPS, MAX_TIPS, MAX_TIP_LENGTH, TIPS_KEY } from './constants.js'
import { readJson } from './storage.js'

    /** The built-in idle lines, localized to one language. */
    function builtinTips(lang) {
      return BUILTIN_TIPS.map((tip) => (lang === 'zh' ? tip.zh : tip.en))
    }

    /** One idle line: whitespace collapsed, trimmed, length-capped for the row. */
    function tidyTip(value) {
      if (typeof value !== 'string') return ''
      const line = value.replace(/\s+/g, ' ').trim()
      return line.length > MAX_TIP_LENGTH ? line.slice(0, MAX_TIP_LENGTH) : line
    }

    /** Normalize a stored list: strings only, no blanks or duplicates, capped. */
    function normalizeTipList(value, lang) {
      const list = Array.isArray(value) ? value.map(tidyTip).filter((line) => line !== '') : []
      const unique = []
      for (const line of list) if (!unique.includes(line)) unique.push(line)
      const capped = unique.slice(0, MAX_TIPS)
      return capped.length > 0 ? capped : builtinTips(lang)
    }

    /** Read the idle lines; the built-in list is the fallback. */
    function readTips(lang) {
      return normalizeTipList(readJson(TIPS_KEY), lang)
    }

export { builtinTips, tidyTip, normalizeTipList, readTips }
