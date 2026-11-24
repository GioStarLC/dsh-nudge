/**
 * Reading the Client context: language, target Session, status and event text.
 *
 * Every shell seam this plugin reads is narrowed here, so the runtime sees one shape.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
    /** Client-minted request identity persisted on the accepted user message. */
    function mintRequestId() {
      return `nudge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    /** The browser time zone, forwarded so the Host can record it. */
    function timeZoneOf() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return undefined
      }
    }

    /** Active locale id, with the browser language as the fallback. */
    function readLang(ctx) {
      try {
        const snapshot = ctx.get?.('locale')?.getLocale?.()
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
        if (/^zh/i.test(active)) return 'zh'
        if (active.length > 0) return 'en'
      } catch {
        /* locale service absent */
      }
      const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
      return /^zh/i.test(nav) ? 'zh' : 'en'
    }

    /** The conversation the main view retains — the session a click is about. */
    function resolveTarget(ctx) {
      const list = ctx.get?.('sessions')?.list?.getSnapshot?.()
      if (list === null || typeof list !== 'object' || !Array.isArray(list.ids)) return undefined
      for (const id of list.ids) {
        const row = list.byId?.[id]
        const retained = row?.retainedBy?.mainView ?? 0
        if (retained > 0) {
          const title = typeof row.title === 'string' && row.title.length > 0
            ? row.title
            : row.displayTitle
          return { sessionId: String(id), title: typeof title === 'string' ? title : String(id) }
        }
      }
      return undefined
    }

    /** The unified session status fact for one session. */
    function statusOf(ctx, sessionId) {
      try {
        return ctx.get?.('uiSession')?.sessionStatus?.getSnapshot?.()?.get(sessionId)
      } catch {
        return undefined
      }
    }

    /**
     * The shipped session Remote namespace, wherever the composition exposes it.
     *
     * Typert registers it both as its own service key (`remote.session`) and as
     * a property on the `remote` face; read whichever answers so a future
     * composition change does not take the button down silently.
     */
    function sessionRemoteOf(ctx) {
      const candidates = []
      try {
        candidates.push(ctx.get?.('remote.session'))
      } catch {
        /* unknown key */
      }
      try {
        candidates.push(ctx.get?.('remote')?.session)
      } catch {
        /* unknown key */
      }
      for (const candidate of candidates) {
        if (candidate && typeof candidate.prompt === 'function') return candidate
      }
      return undefined
    }

    /**
     * The durable event window of one session, when its binding is live.
     *
     * The window is what the Conversation assembler reads; the window here is
     * only used to observe *that* the probe was admitted and *that* the next
     * assistant message arrived — never to read or render its content.
     */
    function eventSourceOf(ctx, sessionId) {
      try {
        return ctx.get?.('sessions')?.binding?.(sessionId)?.eventSource
      } catch {
        return undefined
      }
    }

    /** Highest durable seq currently in one event window. */
    function lastDurableSeq(windowSnapshot) {
      let last = 0
      const entries = windowSnapshot?.entries
      if (!Array.isArray(entries)) return last
      for (const item of entries) {
        if (item?.type !== 'event') continue
        const seq = item.event?.seq
        if (typeof seq === 'number' && seq > last) last = seq
      }
      return last
    }

    /** Visible text blocks of one durable `user/message` event. */
    function userMessageText(event) {
      const content = event?.data?.content
      if (!Array.isArray(content)) return ''
      let text = ''
      for (const part of content) {
        if (part && part.type === 'text' && typeof part.text === 'string') text += part.text
      }
      return text
    }

    /** Visible text blocks of one durable `assistant/message` event. */
    function assistantMessageText(event) {
      const content = event?.data?.message?.content
      if (!Array.isArray(content)) return ''
      let text = ''
      for (const part of content) {
        if (part && part.type === 'text' && typeof part.text === 'string') text += part.text
      }
      return text
    }

    // ---------------------------------------------------------------------
    // geometry
    // ---------------------------------------------------------------------

export { readLang, resolveTarget, statusOf, sessionRemoteOf, eventSourceOf, lastDurableSeq, userMessageText, assistantMessageText, mintRequestId, timeZoneOf }
