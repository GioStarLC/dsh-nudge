/**
 * The settings table, its storage shapes, and the Host mirror.
 *
 * One row per setting holds the three shapes it takes: page storage, runtime state, Host field.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { AUTOPASTE_KEY, DEFAULT_FRAME, DELIVERY_KEY, FRAME_CHOICES, FRAME_KEY, NOTES_KEY, PRESETS_KEY, PRESET_KEY, QUICK_KEY, STATS_KEY, STORE_ROUTE, STORE_SYNC_MS, STORE_VERSION, TIPS_KEY, TURBO_KEY, UI_KEY } from './constants.js'
import { notesOfSession, saveNotesOfSession } from './notes.js'
import { builtinPresets, normalizePresetList, presetListOf, readPresetId } from './presets.js'
import { readStats } from './stats.js'
import { readJson, readRaw, setWriteObserver, storage, writeJson, writeRaw } from './storage.js'
import { readTips } from './tips.js'

    /**
     * One on/off setting: stored as '1', absent when off.
     * @param name - the state field, and the field the Host record carries.
     * @param key - the storage key.
     * @param read - the reader that turns the stored string into the state value.
     */
    function switchSetting(name, key, read) {
      return {
        name,
        field: name,
        key,
        decode: () => read(),
        encode: (on) => (on === true ? '1' : undefined),
        toWire: () => (readRaw(key) === '1' ? true : undefined),
        fromWire: (value) => value === true && writeRaw(key, '1'),
      }
    }

    /**
     * Every setting this build persists, one row each.
     *
     * A row knows the three shapes one setting takes — the string in the page
     * storage, the value in the runtime state, and the field in the Host record
     * — and the translations between them. The launch state, the reload after a
     * Host restore, the mirror payload and the restore itself are all read from
     * this table, so a new setting is one row plus its control, not six copies
     * a later change can leave out of step.
     *
     * - `decode(raw, env)`  stored string → state value
     * - `encode(value, env)` state value → stored string; `undefined` drops the key
     * - `toWire()`         the field the Host record carries, read from the page
     * - `fromWire(value)`  adopt one record field into the page; true when it landed
     * - `persist(value, env)` only where a write is not a plain `encode`: the
     *   annotation tray is stored per Session, so its state value is one
     *   Session's list while its storage value is the whole store
     */
    const SETTINGS = [
      switchSetting('turbo', TURBO_KEY, readTurbo),
      switchSetting('quick', QUICK_KEY, readQuick),
      switchSetting('autoPaste', AUTOPASTE_KEY, readAutoPaste),
      {
        name: 'delivery',
        field: 'deliveryOverride',
        key: DELIVERY_KEY,
        decode: () => readDeliveryOverride(),
        encode: (mode) => (isDelivery(mode) ? mode : undefined),
        // The record says "queue" — how that mode reads in the settings page —
        // while the state machine calls the same mode `followup`. The two halves
        // disagreeing here is what used to drop this setting on every restart,
        // so the translation lives in this one pair of functions.
        toWire: () => {
          const mode = readRaw(DELIVERY_KEY)
          if (!isDelivery(mode)) return undefined
          return mode === 'followup' ? 'queue' : mode
        },
        fromWire: (value) => {
          const mode = value === 'queue' ? 'followup' : isDelivery(value) ? value : undefined
          return mode !== undefined && writeRaw(DELIVERY_KEY, mode)
        },
      },
      {
        name: 'frame',
        field: 'frame',
        key: FRAME_KEY,
        decode: () => readFrame(),
        // The default is not stored: an absent key reads as the default, and a
        // page that never touched the setting must not look configured — only a
        // page that holds nothing adopts the Host record.
        encode: (width) => (isFrameWidth(width) && width !== DEFAULT_FRAME ? String(width) : undefined),
        toWire: () => {
          const raw = readRaw(FRAME_KEY)
          if (raw === null) return undefined
          const width = Number(raw)
          return isFrameWidth(width) ? width : undefined
        },
        fromWire: (value) => isFrameWidth(value) && writeRaw(FRAME_KEY, String(value)),
      },
      {
        name: 'preset',
        field: null,
        key: PRESET_KEY,
        encode: (id) => (typeof id === 'string' && id !== '' ? id : undefined),
        toWire: () => {
          const id = readRaw(PRESET_KEY)
          return id === null || id === '' ? undefined : id
        },
        fromWire: (value) => typeof value === 'string' && value !== '' && writeRaw(PRESET_KEY, value),
      },
      {
        name: 'presets',
        field: 'presets',
        key: PRESETS_KEY,
        // The reader stays the one owner of "legacy shape, normalized once".
        decode: (raw, env) => readPresets(env.lang),
        encode: (list) => JSON.stringify(list),
        toWire: () => readJson(PRESETS_KEY),
        fromWire: (value) => Array.isArray(value) && writeJson(PRESETS_KEY, value),
      },
      {
        name: 'tips',
        field: 'tips',
        key: TIPS_KEY,
        decode: (raw, env) => readTips(env.lang),
        encode: (list) => JSON.stringify(list),
        toWire: () => {
          const stored = readJson(TIPS_KEY)
          return Array.isArray(stored) ? stored : undefined
        },
        fromWire: (value) => Array.isArray(value) && writeJson(TIPS_KEY, value),
      },
      {
        name: 'stats',
        field: 'stats',
        key: STATS_KEY,
        decode: () => readStats(),
        encode: (stats) => JSON.stringify(stats),
        toWire: () => readJson(STATS_KEY),
        fromWire: (value) =>
          value !== null && typeof value === 'object' && !Array.isArray(value) && writeJson(STATS_KEY, value),
      },
      {
        name: 'notes',
        field: 'annotations',
        key: NOTES_KEY,
        decode: (raw, env) => notesOfSession(env.sessionId),
        persist: (list, env) => saveNotesOfSession(env.sessionId, list),
        toWire: () => readJson(NOTES_KEY),
        fromWire: (value) =>
          value !== null && typeof value === 'object' && !Array.isArray(value) && writeJson(NOTES_KEY, value),
      },
      {
        // The window geometry lives beside the diagnostic samples, so it has no
        // state field of its own: the position is derived from it on read.
        name: 'ui',
        field: null,
        key: UI_KEY,
        toWire: () => readJson(UI_KEY),
        fromWire: (value) =>
          value !== null && typeof value === 'object' && !Array.isArray(value) && writeJson(UI_KEY, value),
      },
    ]

    /** The row for one setting, or undefined for a name this build does not keep. */
    function settingRow(name) {
      for (const row of SETTINGS) {
        if (row.name === name) return row
      }
      return undefined
    }

    /**
     * Every persisted setting as one state patch.
     * `env` carries what the readers need beyond storage: the active language,
     * and the Session whose annotation tray is loaded.
     */
    function readSettings(env) {
      const patch = {}
      for (const row of SETTINGS) {
        if (typeof row.field !== 'string') continue
        patch[row.field] = row.decode(readRaw(row.key), env)
      }
      // The chosen prompt is the one cross-row rule: an id that no longer names
      // an enabled prompt falls back to the first one that does.
      patch.presetId = readPresetId(patch.presets)
      return patch
    }

    /** Write one setting; the write also arms the Host mirror. */
    function persistSetting(name, value, env) {
      const row = settingRow(name)
      if (row === undefined) return false
      if (typeof row.persist === 'function') {
        row.persist(value, env)
        return true
      }
      if (typeof row.encode !== 'function') return false
      return writeRaw(row.key, row.encode(value, env))
    }

    /** Drop one setting: the next read falls back to its default. */
    function clearSetting(name) {
      const row = settingRow(name)
      return row === undefined ? false : writeRaw(row.key, undefined)
    }

    /** The settings, in the shape the Host half keeps them. */
    function settingsSnapshot() {
      if (storage() === undefined) return undefined
      const snapshot = { version: STORE_VERSION }
      for (const row of SETTINGS) {
        const value = row.toWire()
        if (value !== undefined) snapshot[row.name] = value
      }
      return snapshot
    }

    /** Whether a snapshot carries any setting at all (the version always counts). */
    function hasStoredSettings(snapshot) {
      return snapshot !== undefined && snapshot !== null && Object.keys(snapshot).length > 1
    }

    /**
     * Write a Host-supplied record into the page storage.
     *
     * `merge` adopts only the fields the page does not hold yet: a field that
     * is already here is the fresher copy — the user changed it on this origin,
     * or a previous session here wrote it. That is decided per field rather than
     * per record because the page can hold a few settings before the record has
     * even been read: the window geometry is written on the first collapse, and
     * a page holding only geometry must still adopt the presets in the record.
     *
     * @param value - the Host record.
     * @param options - `{ merge }` keeps the fields the page already holds.
     * @returns true when at least one known field was adopted.
     */
    function applySettingsStore(value, options) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      if (storage() === undefined) return false
      const merge = options !== null && typeof options === 'object' && options.merge === true
      let adopted = false
      for (const row of SETTINGS) {
        const field = value[row.name]
        if (field === undefined) continue
        if (merge && readRaw(row.key) !== null) continue
        try {
          if (row.fromWire(field) === true) adopted = true
        } catch {
          /* one unusable field must not stop the rest */
        }
      }
      return adopted
    }

    // --- the durable mirror ----------------------------------------------
    //
    // The page is the writer and the Host record is the copy. Three rules keep
    // the copy honest:
    //
    //  - one write per burst of edits: a switch, a drag and a form save are one
    //    POST, not three;
    //  - nothing is posted before the record has been read, because a POST
    //    replaces the whole file — an early write would erase the settings this
    //    origin has not seen yet, which is exactly the record a restart on a
    //    fresh loopback port is meant to come back from;
    //  - a record that was just adopted is not posted back, because the page
    //    then holds what the file already says.

    /** True once the Host record has been read (or found absent). */
    let mirrorReady = false
    /** True while the page holds settings the Host record does not. */
    let mirrorDirty = false
    /** True while a Host record is being adopted: its writes are not news. */
    let mirrorAdopting = false
    let mirrorTimer

    /** Note one settings write and arm the mirror. */
    function noteSettingsWrite() {
      if (mirrorAdopting) return
      mirrorDirty = true
      armSettingsMirror()
    }

    // The storage layer reports every write; the mirror decides whether it is news.
    setWriteObserver(noteSettingsWrite)

    /** Arm (or re-arm) the write; a mirror that has not read the record waits. */
    function armSettingsMirror() {
      if (!mirrorReady || !mirrorDirty || typeof fetch !== 'function') return
      try {
        if (mirrorTimer !== undefined) clearTimeout(mirrorTimer)
      } catch {
        /* no timers */
      }
      try {
        mirrorTimer = setTimeout(commitSettingsToHost, STORE_SYNC_MS)
      } catch {
        mirrorTimer = undefined
      }
    }

    /** The Host record has been read: the copy may be written from now on. */
    function markSettingsRead() {
      mirrorReady = true
      armSettingsMirror()
    }

    /** Run `apply` while its writes are known to come from the record itself. */
    function adoptFromHost(apply) {
      mirrorAdopting = true
      try {
        return apply()
      } finally {
        mirrorAdopting = false
      }
    }

    /** The page holds something the record does not: post it once it is safe. */
    function markSettingsDirty() {
      mirrorDirty = true
      armSettingsMirror()
    }

    /** The page and the record agree again: nothing left to post. */
    function markSettingsSynced() {
      mirrorDirty = false
    }

    /** Drop a pending write. */
    function cancelSettingsMirror() {
      try {
        if (mirrorTimer !== undefined) clearTimeout(mirrorTimer)
      } catch {
        /* no timers */
      }
      mirrorTimer = undefined
    }

    /** Send the current settings to the Host half; a missing Host half is fine. */
    function commitSettingsToHost() {
      mirrorTimer = undefined
      const snapshot = settingsSnapshot()
      if (snapshot === undefined || typeof fetch !== 'function') return
      mirrorDirty = false
      try {
        Promise.resolve(
          fetch(STORE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ store: snapshot }),
            // No `keepalive`: the desktop shell serves this page from its own
            // dsh-app:// scheme, which refuses keepalive requests ("Failed to
            // fetch"), so every mirror write was lost and the Host record went
            // stale.
          }),
        ).catch(() => {})
      } catch {
        /* preview page or check harness: nothing to sync to */
      }
    }

    /** Write the record now: an unmount must not swallow the last edit. */
    function flushSettingsMirror() {
      cancelSettingsMirror()
      if (!mirrorReady || !mirrorDirty) return
      commitSettingsToHost()
    }

    /** The Host half's durable record, or undefined when it has none. */
    function loadStoreFromHost() {
      if (typeof fetch !== 'function') return Promise.resolve(undefined)
      try {
        return Promise.resolve(fetch(STORE_ROUTE, { headers: { accept: 'application/json' } }))
          .then((response) => (response?.ok === true ? response.json() : undefined))
          .then((payload) =>
            payload !== null && typeof payload === 'object' ? payload.store : undefined,
          )
          .catch(() => undefined)
      } catch {
        return Promise.resolve(undefined)
      }
    }

    /** Whether a value is one of the two accepted delivery modes. */
    function isDelivery(value) {
      return value === 'followup' || value === 'steer'
    }

    /**
     * Read the persisted presets; the built-in list is the fallback.
     * A legacy shape (wrapper object, bare strings, other field names) is
     * normalized and rewritten once, so an update never silently drops the
     * prompts a user authored in an older build.
     */
    function readPresets(lang) {
      const stored = readJson(PRESETS_KEY)
      const raw = presetListOf(stored)
      if (raw === undefined) return builtinPresets(lang)
      const list = normalizePresetList(raw, lang)
      if (!Array.isArray(stored)) persistSetting('presets', list)
      return list
    }

    /** Read the browser delivery override; an invalid stored value is ignored with a warning. */
    function readDeliveryOverride() {
      try {
        const raw = storage()?.getItem(DELIVERY_KEY)
        if (raw === null || raw === undefined) return undefined
        if (isDelivery(raw)) return raw
        console.warn(`[dsh-nudge] 忽略非法 delivery 覆盖值 ${JSON.stringify(raw)}`)
        return undefined
      } catch {
        return undefined
      }
    }

    /** Read the turbo-mode flag; anything but the stored on-value is off. */
    function readTurbo() {
      try {
        return storage()?.getItem(TURBO_KEY) === '1'
      } catch {
        return false
      }
    }

    /** Read the quick-annotation master switch. */
    function readQuick() {
      try {
        return storage()?.getItem(QUICK_KEY) === '1'
      } catch {
        return false
      }
    }

    /** Read the auto-paste switch: notes flow into the composer on focus. */
    function readAutoPaste() {
      try {
        return storage()?.getItem(AUTOPASTE_KEY) === '1'
      } catch {
        return false
      }
    }


    /** Whether a value is one of the frame widths the settings offer. */
    function isFrameWidth(value) {
      return FRAME_CHOICES.includes(value)
    }

    /** Read the floating-window border width; anything else falls back. */
    function readFrame() {
      try {
        const text = storage()?.getItem(FRAME_KEY)
        const width = text === null || text === undefined ? NaN : Number(text)
        return isFrameWidth(width) ? width : DEFAULT_FRAME
      } catch {
        return DEFAULT_FRAME
      }
    }

    /** The label key for one frame width, shared by the chips and the notice. */
    function frameLabelKey(width) {
      if (width === 0) return 'frameNone'
      if (width === 1) return 'frameThin'
      return width === 3 ? 'frameThick' : 'frameNormal'
    }

export { switchSetting, SETTINGS, settingRow, readSettings, persistSetting, clearSetting, settingsSnapshot, hasStoredSettings, applySettingsStore, mirrorReady, mirrorDirty, mirrorAdopting, mirrorTimer, noteSettingsWrite, armSettingsMirror, markSettingsRead, adoptFromHost, markSettingsDirty, markSettingsSynced, cancelSettingsMirror, commitSettingsToHost, flushSettingsMirror, loadStoreFromHost, isDelivery, readDeliveryOverride, readTurbo, readQuick, readAutoPaste, isFrameWidth, readFrame, frameLabelKey, readPresets }
