/**
 * Per-day usage counters.
 *
 * Local dates, a bounded window, and the three counters one action can credit.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { MAX_STAT_PRESETS, MAX_STAT_PRESET_ID, STATS_DAYS, STATS_KEY } from './constants.js'
import { readJson } from './storage.js'

    /** Local calendar day, the bucket the counters roll over on. */
    function dayKey(date = new Date()) {
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }

    /** Local date keys for the newest `count` days, oldest first. */
    function recentDayKeys(count, now = new Date()) {
      const keys = []
      for (let offset = count - 1; offset >= 0; offset -= 1) {
        keys.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)))
      }
      return keys
    }

    /** The counters this build owns; anything else is dropped. */
    const STAT_FIELDS = ['send', 'insert', 'annotation']

    /**
     * Normalize a stored counter record: `{ days: { 'YYYY-MM-DD': { send, insert,
     * annotation } } }`. Unknown fields, malformed rows and days outside the
     * local-date shape are dropped, and only the newest days are kept.
     */
    function normalizeStats(value) {
      const days = {}
      const source = value !== null && typeof value === 'object' ? value.days : undefined
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return { days }
      let keys = Object.keys(source).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
      keys = keys.sort().slice(-STATS_DAYS)
      for (const key of keys) {
        const raw = source[key]
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
        const entry = {}
        for (const field of STAT_FIELDS) {
          const count = raw[field]
          if (Number.isInteger(count) && count > 0) entry[field] = count
        }
        // Per-preset use is kept beside the daily totals, so the Top 3 list
        // follows the same window and ages out with it.
        const rawPresets = raw.presets
        if (rawPresets !== null && typeof rawPresets === 'object' && !Array.isArray(rawPresets)) {
          const presets = {}
          let kept = 0
          for (const id of Object.keys(rawPresets)) {
            if (kept >= MAX_STAT_PRESETS) break
            const count = rawPresets[id]
            if (id.length === 0 || id.length > MAX_STAT_PRESET_ID) continue
            if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue
            if (!Number.isInteger(count) || count <= 0) continue
            presets[id] = count
            kept += 1
          }
          if (kept > 0) entry.presets = presets
        }
        if (Object.keys(entry).length > 0) days[key] = entry
      }
      return { days }
    }

    /** Read the daily counters; an absent or malformed record reads as empty. */
    function readStats() {
      return normalizeStats(readJson(STATS_KEY))
    }

export { dayKey, recentDayKeys, STAT_FIELDS, normalizeStats, readStats }
