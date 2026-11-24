/**
 * Probe presets: built-ins, normalization and the chosen one.
 *
 * The list an install starts with, the legacy shapes it may have been stored in, and the pick.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { BUILTIN_PRESETS, DEFAULT_PRESET, PRESET_KEY } from './constants.js'
import { storage } from './storage.js'

    /** One preset by id, `undefined` for an unknown value. */
    function presetOf(list, id) {
      for (const preset of list) {
        if (preset.id === id) return preset
      }
      return undefined
    }

    /** Identity for a user-added preset. */
    function mintPresetId() {
      return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    }

    /** The built-in presets, labelled for the active language. */
    function builtinPresets(lang) {
      return BUILTIN_PRESETS.map((preset) => ({
        id: preset.id,
        label: lang === 'zh' ? preset.labelZh : preset.labelEn,
        text: preset.text,
        enabled: true,
        pinned: false,
      }))
    }

    /** The first non-empty string among a stored preset's text aliases. */
    function presetTextOf(item) {
      for (const key of ['text', 'body', 'content', 'prompt']) {
        const value = item[key]
        if (typeof value === 'string' && value.trim() !== '') return value.trim()
      }
      return ''
    }

    /**
     * Normalize one stored/edited preset list; invalid entries are dropped.
     * An empty array stays empty: the user may delete every prompt, and the
     * settings page then shows its empty state.
     */
    function normalizePresetList(value, lang) {
      if (!Array.isArray(value)) return builtinPresets(lang)
      const list = []
      const seen = new Set()
      for (const raw of value) {
        // An older build could store a bare line of text per entry.
        const item = typeof raw === 'string' ? { text: raw } : raw
        if (item === null || typeof item !== 'object') continue
        const text = presetTextOf(item)
        if (text.length === 0) continue
        let id = typeof item.id === 'string' && item.id.length > 0 ? item.id : mintPresetId()
        if (seen.has(id)) id = mintPresetId()
        seen.add(id)
        const rawLabel =
          typeof item.label === 'string'
            ? item.label.trim()
            : typeof item.name === 'string'
              ? item.name.trim()
              : typeof item.title === 'string'
                ? item.title.trim()
                : ''
        list.push({
          id,
          label: rawLabel.length > 0 ? rawLabel : text.slice(0, 8),
          text,
          enabled: item.enabled !== false,
          pinned: item.pinned === true,
        })
      }
      return list
    }

    /** The list inside a legacy wrapper object, or undefined. */
    function presetListOf(value) {
      if (Array.isArray(value)) return value
      if (value === null || typeof value !== 'object') return undefined
      for (const key of ['presets', 'items', 'list']) {
        if (Array.isArray(value[key])) return value[key]
      }
      return undefined
    }

    /** Read the chosen preset id, falling back to the first enabled preset. */
    function readPresetId(presets) {
      const firstEnabled = presets.find((preset) => preset.enabled !== false)
      try {
        const raw = storage()?.getItem(PRESET_KEY)
        if (raw !== null && raw !== undefined) {
          const chosen = presetOf(presets, raw)
          if (chosen !== undefined) {
            if (chosen.enabled === false) return firstEnabled?.id ?? chosen.id
            return raw
          }
          console.warn(`[dsh-nudge] 忽略非法快捷输入 ${JSON.stringify(raw)}，改用第一条`)
        }
      } catch {
        /* storage unavailable */
      }
      return firstEnabled?.id ?? presets[0]?.id ?? DEFAULT_PRESET
    }

export { presetOf, mintPresetId, builtinPresets, presetTextOf, normalizePresetList, presetListOf, readPresetId }
