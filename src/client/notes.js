/**
 * The per-Session annotation store.
 *
 * Every note is keyed by the Session it quotes, so switching conversations keeps each tray.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { MAX_NOTES, MAX_NOTE_SESSIONS, NOTES_KEY } from './constants.js'
import { storage, writeJson } from './storage.js'

    /** Every stored annotation set, keyed by Session id. */
    function readNoteStore() {
      try {
        const raw = storage()?.getItem(NOTES_KEY)
        if (typeof raw !== 'string' || raw === '') return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch {
        return {}
      }
    }

    /** One Session's stored annotations, degraded to [] when malformed. */
    function notesOfSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      const list = readNoteStore()[sessionId]
      if (!Array.isArray(list)) return []
      return list.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.quote === 'string' &&
          typeof item.id === 'string',
      )
    }

    /** Persist one Session's annotations, dropping empty sets and old Sessions. */
    function saveNotesOfSession(sessionId, list) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const store = readNoteStore()
      if (!Array.isArray(list) || list.length === 0) delete store[sessionId]
      else store[sessionId] = list.slice(-MAX_NOTES)
      const keys = Object.keys(store)
      if (keys.length > MAX_NOTE_SESSIONS) {
        for (const key of keys.slice(0, keys.length - MAX_NOTE_SESSIONS)) delete store[key]
      }
      writeJson(NOTES_KEY, store)
    }

export { readNoteStore, notesOfSession, saveNotesOfSession }
