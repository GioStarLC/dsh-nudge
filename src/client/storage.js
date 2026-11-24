/**
 * The page storage facade.
 *
 * One guarded accessor pair for localStorage; writes tell the durable mirror there is news.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
    /**
     * Called after every stored string lands, so the durable mirror can arm.
     * The settings module registers its own hook; this layer only knows that a
     * write is news, not what the news is.
     */
    let writeObserver = () => {}

    /** Register the one observer a storage write notifies. */
    function setWriteObserver(observer) {
      writeObserver = observer
    }

    /** Tell the observer a write landed; a write that throws never gets here. */
    function notifyStorageWrite() {
      writeObserver()
    }

    /**
     * The page storage, or undefined when storage is unavailable (private mode).
     *
     * Every write is mirrored to the Host half. The durable copy lives in a
     * file inside the profile directory, because the web GUI's loopback port
     * changes on every launch and `localStorage` is isolated per origin — a
     * restart would otherwise look like a first run and silently reset the
     * presets, the switches and the delivery mode.
     */
    let storageFacade
    function storage() {
      if (storageFacade !== undefined) return storageFacade
      try {
        const raw = window.localStorage
        if (raw === undefined || raw === null) return undefined
        storageFacade = {
          getItem: (key) => raw.getItem(key),
          setItem: (key, value) => {
            raw.setItem(key, value)
            notifyStorageWrite()
          },
          removeItem: (key) => {
            raw.removeItem(key)
            notifyStorageWrite()
          },
        }
        return storageFacade
      } catch {
        return undefined
      }
    }

    /** One stored string, or null when the key is absent (never throws). */
    function readRaw(key) {
      try {
        const value = storage()?.getItem(key)
        return value === null || value === undefined ? null : String(value)
      } catch {
        return null
      }
    }

    /** Store one string; `undefined` removes the key. Never throws. */
    function writeRaw(key, value) {
      try {
        if (value === undefined) storage()?.removeItem(key)
        else storage()?.setItem(key, String(value))
        return true
      } catch {
        return false
      }
    }

    /** Read one JSON object; never throws. */
    function readJson(key) {
      const raw = readRaw(key)
      if (raw === null || raw === '') return undefined
      try {
        const value = JSON.parse(raw)
        return value !== null && typeof value === 'object' ? value : undefined
      } catch {
        return undefined
      }
    }

    /** Persist one JSON object; never throws. */
    function writeJson(key, value) {
      try {
        return writeRaw(key, JSON.stringify(value))
      } catch {
        /* a value that cannot be serialized is not worth a crash */
        return false
      }
    }

export { storageFacade, storage, readRaw, writeRaw, readJson, writeJson, setWriteObserver }
