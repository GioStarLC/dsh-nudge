/**
 * The durable record: hydration from the Host half, adoption and counters.
 *
 * The page keeps a synchronous cache; the Host file is the copy that survives
 * a restart and a new loopback port. Reading once per launch is what orders
 * the two: a POST replaces the whole record, so the mirror may only write
 * after the read.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { MAX_STAT_PRESET_ID, UI_KEY } from './constants.js'
import { dockPosition, isPoint, snapToEdge } from './geometry.js'
import {
  adoptFromHost,
  applySettingsStore,
  hasStoredSettings,
  loadStoreFromHost,
  markSettingsDirty,
  markSettingsRead,
  markSettingsSynced,
  persistSetting,
  readSettings,
  settingsSnapshot,
} from './settings.js'
import { STAT_FIELDS, dayKey, normalizeStats } from './stats.js'
import { readJson } from './storage.js'

    /**
     * Build the durable-record side over one runtime.
     *
     * @param deps - getState, setState, resetAnchorRecovery, resetCardAnchor.
     * @returns hydration, the storage reload and the counters.
     */
    function createHostSync(deps) {
      const { getState, setState, resetAnchorRecovery, resetCardAnchor } = deps

      /**
       * Read the Host half's durable record once per launch — and only then let
       * the mirror write. The two are ordered here and nowhere else: a POST
       * replaces the whole file, so writing before the read would erase the
       * very settings a restart is supposed to come back from.
       * @returns true when a restored record changed the getState().
       */
      function hydrateFromHost() {
        return loadStoreFromHost()
          .then((remote) => {
            const adopted = adoptRemoteRecord(remote)
            markSettingsRead()
            return adopted
          })
          .catch(() => {
            // No Host half (preview page, plain harness): the page is the copy.
            markSettingsRead()
            return false
          })
      }

      /**
       * Adopt the fields of a record the page does not hold — per field, so a
       * page that already wrote its own geometry still gets the presets, and a
       * page that holds everything keeps its own copy (the user just changed
       * it) while the mirror refreshes the record from it.
       */
      function adoptRemoteRecord(remote) {
        if (remote === null || remote === undefined || typeof remote !== 'object') return false
        const pageHeldSomething = hasStoredSettings(settingsSnapshot())
        const adopted = adoptFromHost(() => applySettingsStore(remote, { merge: true }))
        if (!adopted) return false
        reloadFromStorage()
        // A page that held nothing is now exactly the record. A page that held
        // some fields holds the union, so the record is brought up to date.
        if (pageHeldSomething) markSettingsDirty()
        else markSettingsSynced()
        return true
      }

      /** Re-derive every persisted preference from the page storage. */
      function reloadFromStorage() {
        const saved = readJson(UI_KEY) ?? {}
        // The tray comes back from storage; the marks a write left behind in a
        // draft do not, because the draft they pointed at may be gone too.
        resetAnchorRecovery()
        // A reloaded window starts folded from its stored spot: no card anchor
        // outlives the page it was folded on.
        resetCardAnchor()
        setState({
          ...readSettings({ lang: getState().lang, sessionId: getState().target?.sessionId }),
          tipIndex: 0,
          // The restore follows the same launch rule as the first paint.
          collapsed: true,
          pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        })
      }

      /**
       * Bump one of today's counters. The local calendar day is the bucket:
       * a click after midnight starts a fresh row, and the store keeps the
       * newest `STATS_DAYS` rows only. A preset send/write also bumps that
       * preset's own count so the settings board can rank the top prompts.
       */
      function countStat(field, presetId) {
        if (!STAT_FIELDS.includes(field)) return false
        const key = dayKey()
        const days = { ...getState().stats.days }
        const today = { ...(days[key] ?? {}) }
        today[field] = (today[field] ?? 0) + 1
        if (
          typeof presetId === 'string' &&
          presetId.length > 0 &&
          presetId.length <= MAX_STAT_PRESET_ID &&
          presetId !== '__proto__' &&
          presetId !== 'constructor' &&
          presetId !== 'prototype'
        ) {
          const presets = { ...(today.presets ?? {}) }
          presets[presetId] = (presets[presetId] ?? 0) + 1
          today.presets = presets
        }
        days[key] = today
        const next = normalizeStats({ days })
        persistSetting('stats', next)
        setState({ stats: next })
        return true
      }

      return {
        hydrateFromHost,
        adoptRemoteRecord,
        reloadFromStorage,
        countStat,
      }
    }

export { createHostSync }
