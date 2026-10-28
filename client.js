/**
 * dsh-nudge — Client half.
 *
 * A floating control over the conversation: pick one of the built-in probe
 * presets (or the delivery mode), press 询问状态, and the agent answers in the
 * conversation. The plugin owns the trigger, the presets and the visible
 * outcome; it never parses or repeats the answer, because the conversation
 * already is the place where the answer belongs.
 *
 * Extension points used:
 *  - `shell.overlay`            — frame-wide floating layer, outside every scroll container.
 *  - `ctx.sessions.list`        — which session the main view retains (the click target).
 *  - `ctx.uiSession.sessionStatus` — running / pending-interaction facts for the wait state.
 *  - `ctx.remote.session.prompt` — the composer's own delivery path (mode: queue = followup, steer).
 *
 * Nothing is written to the page outside this component's own root, and the
 * bundle keeps no DOM of its own: unmounting the slot removes the window.
 */
window.__ModuleLoader__.load({
  id: 'dsh-nudge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** The slot that renders above every column and does not scroll with messages. */
    const SLOT = 'shell.overlay'
    /** The settings section that edits the probe presets. */
    const SETTINGS_SLOT = 'settings.section'
    /**
     * The conversation input overlay slot: its entries receive the composer's
     * `inputActions` and `useInput` props, which is how the window writes into
     * the draft without touching the editor DOM.
     */
    const COMPOSER_SLOT = 'conversation.input.overlay'
    /** Stable DOM seams of the shell-owned settings panel (nothing is written here). */
    const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]'
    const SETTINGS_ROOT_SELECTOR = '[data-slot="sidebar.settings"]'
    const ENTRY = 'dsh-nudge'
    const UI_KEY = 'dsh-nudge:ui'
    const DELIVERY_KEY = 'dsh-nudge:delivery'
    const TURBO_KEY = 'dsh-nudge:turbo'
    const QUICK_KEY = 'dsh-nudge:quick'
    const NOTES_KEY = 'dsh-nudge:notes'
    /** Flow item attribute the shell uses for stable transcript anchors. */
    const ANCHOR_SELECTOR = '[data-chat-anchor-key]'
    /** Registry name for the annotated-passage highlight. */
    const HIGHLIGHT_NAME = 'dsh-nudge-notes'
    /** Registry name for the passage currently being annotated. */
    const CAPTURE_HIGHLIGHT = 'dsh-nudge-capture'
    /** How much context one anchor keeps on each side of its quote. */
    const CONTEXT_CHARS = 24
    const MAX_NOTES = 200
    const MAX_NOTE_SESSIONS = 40
    /** Upper bound on painted quote candidates per anchor. */
    const MAX_OCCURRENCES = 40
    const PRESET_KEY = 'dsh-nudge:preset'
    const PRESETS_KEY = 'dsh-nudge:presets'

    /** The single source of the delivery default: "直接打断" (steer) is first. */
    const DEFAULT_DELIVERY = 'steer'

    /**
     * Built-in probe presets; the settings section can edit, add and reset them,
     * and the edited list persists in this browser.
     */
    const BUILTIN_PRESETS = [
      {
        id: 'brief',
        labelZh: '简述',
        labelEn: 'Brief',
        text: '简述一下：目标、已完成、下一步、是否需要我。',
      },
      {
        id: 'fast',
        labelZh: '快一点',
        labelEn: 'Faster',
        text: '快一点，别先急着测试，先开发完。',
      },
      {
        id: 'four-line',
        labelZh: '四行',
        labelEn: 'Four lines',
        text: '按固定四行汇报当前状态：Goal / Done / Next / Needs you；无内容写「无」；不复述工具调用、不贴日志。',
      },
    ]
    const DEFAULT_PRESET = 'brief'
    /** Cap on presets so the flat row in the window stays usable. */
    const MAX_PRESETS = 8

    const CARD_WIDTH = 320
    const PILL_WIDTH = 104
    const EDGE = 16
    const DOCK_TOP = 56
    const COMPOSER_RESERVE = 152
    /**
     * Ordering inside the `shell.overlay` layer only (that layer owns its own
     * stacking context). The layer is a pass-through surface in the host shell,
     * so every interactive child restores `pointer-events` itself.
     */
    const Z_INDEX = 40

    /** Give up confirming the outcome after this long; the agent may still be running. */
    const WAIT_TIMEOUT_MS = 10 * 60 * 1000
    /** A turn that closes and stays closed for this long counts as answered. */
    const SETTLE_MS = 1200
    /** An idle session that answers without ever reporting `running` settles this way. */
    const IDLE_CONFIRM_MS = 8000
    /** Wait this long for the probe to appear in the durable log before calling it unadmitted. */
    const EVENT_RECEIPT_MS = 15000

    const ZH = {
      title: 'dsh-nudge',
      ask: '询问状态',
      askHint: '向 agent 询问当前状态',
      insert: '写入输入框',
      insertHint: '把选中的口径追加到输入框末尾',
      insertUnavailable: '输入框未就绪，暂时无法写入文案。',
      modeInactive: '写入输入框时不需要投递方式',
      turboTitle: '急速模式',
      turboDesc: '隐藏底部按钮：双击口径直接执行（光标在输入框就写入，否则发送）。',
      turboAskHint: '双击口径直接询问状态',
      turboInsertHint: '双击口径写入输入框',
      answerLabel: '我的回答：',
      annotationsTitle: '批注',
      annotationPlaceholder: '对这段内容说点什么…',
      annotationsHint: '选中对话里的文字，选区旁会弹出批注卡片；批注汇总在这里。',
      addAnnotation: '添加批注',
      dismissAnnotation: '取消',
      deleteAnnotation: '删除',
      writeAnnotations: '写入输入框',
      sendAnnotations: '发送',
      quickOn: '快速批注：开',
      quickOff: '快速批注：关',
      nudgeModule: '快捷输入',
      collapseAnnotations: '收起批注',
      expandAnnotations: '展开批注',
      collapseNudge: '收起快捷输入',
      expandNudge: '展开快捷输入',
      agree: '同意',
      disagree: '不同意',
      copyQuote: '复制',
      copied: '引用已复制到剪贴板。',
      copyFailed: '复制失败，请手动选中后复制。',
      saveAnnotation: '保存',
      asking: '等待回答…',
      again: '再问一次',
      collapse: '收起',
      collapseHint: '点击标题栏收起；拖动可移动',
      expand: '展开 dsh-nudge 窗口',
      statusIdle: '未询问',
      statusWaiting: '等待中',
      statusDone: '已返回',
      statusError: '失败',
      mode: '方式',
      queue: '排队',
      steer: '直接打断',
      queueHint: '排到当前任务之后，作为下一轮发出',
      steerHint: '立即插入当前任务，下一个 step 边界生效',
      preset: '口径',
      noSession: '没有打开的会话，无法询问。',
      waitingQuestion: 'agent 正在等待你的回答',
      transportMissing: '当前界面没有投递通道，无法发起询问。',
      deliveryFailed: '投递失败',
      sessionClosed: '会话已结束或已归档，无法询问。',
      badRequest: '投递内容被拒绝，无法询问。',
      timeoutNote: '等待回答超时（agent 可能仍在运行）。',
      stillRunningNote: 'agent 仍在运行，继续等待回答。',
      unconfirmedNote: '未能确认是否已回答，请查看对话。',
      noReceiptNote: '未收到询问的投递确认（会话可能已归档或已结束）。',
      turnBlockedNote: '会话已归档或被阻止运行，本轮没有回答。',
      turnFailedNote: '本轮执行失败，没有拿到回答。',
      turnAbortedNote: '本轮被中止，没有拿到回答。',
      noAnswerNote: '本轮没有产生回答。',
      newResult: '有新结果',
      settings: '方式',
      presetsHint: '口径保存在这个浏览器里，只影响当前客户端。窗口里点一下就能切换。',
      presetsEmpty: '还没有口径，点「新增口径」加一条。',
      presetLabel: '名称',
      presetText: '发给 agent 的话',
      addPreset: '新增口径',
      resetPresets: '恢复默认',
      deletePreset: '删除',
      presetLimit: '最多 8 条口径，先删一条再新增。',
      presetTextRequired: '内容不能为空。',
      presetLast: '至少保留一条口径。',
      settingsTitle: '状态询问',
      openSettings: '打开设置',
      settingsUnavailable: '无法打开设置页面，请从侧边栏进入设置。',
    }

    const EN = {
      title: 'dsh-nudge',
      ask: 'Ask status',
      askHint: 'Ask the agent for a status update',
      insert: 'Insert text',
      insertHint: 'Append the chosen prompt to the end of the input box',
      insertUnavailable: 'The input box is not ready; cannot insert the text.',
      modeInactive: 'Delivery mode does not apply when inserting text',
      turboTitle: 'Turbo mode',
      turboDesc: 'Hide the primary button: double-click a prompt to run it right away (insert when the caret is in the input box, send otherwise).',
      turboAskHint: 'Double-click a prompt to ask',
      turboInsertHint: 'Double-click a prompt to insert',
      answerLabel: 'My answer: ',
      annotationsTitle: 'Notes',
      annotationPlaceholder: 'Say something about this passage…',
      annotationsHint: 'Select text in the conversation and a note card opens beside it; notes are collected here.',
      addAnnotation: 'Add note',
      dismissAnnotation: 'Cancel',
      deleteAnnotation: 'Delete',
      writeAnnotations: 'Write to input',
      sendAnnotations: 'Send',
      quickOn: 'Quick notes: on',
      quickOff: 'Quick notes: off',
      nudgeModule: 'Quick input',
      collapseAnnotations: 'Collapse notes',
      expandAnnotations: 'Expand notes',
      collapseNudge: 'Collapse quick input',
      expandNudge: 'Expand quick input',
      agree: 'Agree',
      disagree: 'Disagree',
      copyQuote: 'Copy',
      copied: 'The passage was copied to the clipboard.',
      copyFailed: 'Could not copy; select and copy it manually.',
      saveAnnotation: 'Save',
      asking: 'Waiting…',
      again: 'Ask again',
      collapse: 'Collapse',
      collapseHint: 'Click the title bar to collapse; drag to move',
      expand: 'Expand the dsh-nudge window',
      statusIdle: 'Not asked',
      statusWaiting: 'Waiting',
      statusDone: 'Answered',
      statusError: 'Failed',
      mode: 'Mode',
      queue: 'Queue',
      steer: 'Interrupt',
      queueHint: 'Queued after the current task, sent as the next turn',
      steerHint: 'Interjects into the current task at the next step boundary',
      preset: 'Prompt',
      noSession: 'No open conversation to ask.',
      waitingQuestion: 'The agent is waiting for your answer',
      transportMissing: 'This page has no delivery channel, so the request cannot be sent.',
      deliveryFailed: 'Delivery failed',
      sessionClosed: 'This session has ended or been archived; it cannot be asked.',
      badRequest: 'The request content was rejected.',
      timeoutNote: 'Timed out waiting for the answer (the agent may still be running).',
      stillRunningNote: 'The agent is still running; still waiting for the answer.',
      unconfirmedNote: 'Could not confirm whether the answer arrived; check the conversation.',
      noReceiptNote: 'The request was not admitted (the session may be archived or closed).',
      turnBlockedNote: 'This session is archived or blocked, so the turn produced no answer.',
      turnFailedNote: 'The turn failed, so no answer arrived.',
      turnAbortedNote: 'The turn was aborted, so no answer arrived.',
      noAnswerNote: 'The turn produced no answer.',
      newResult: 'New result',
      settings: 'Mode',
      presetsHint: 'Prompts are stored in this browser and only affect this client. Click one in the window to switch.',
      presetsEmpty: 'No prompts yet; add one.',
      presetLabel: 'Name',
      presetText: 'What the agent receives',
      addPreset: 'Add prompt',
      resetPresets: 'Reset defaults',
      deletePreset: 'Delete',
      presetLimit: 'At most 8 prompts; delete one first.',
      presetTextRequired: 'The text cannot be empty.',
      presetLast: 'Keep at least one prompt.',
      settingsTitle: 'Status Nudge',
      openSettings: 'Open settings',
      settingsUnavailable: 'Could not open Settings; open it from the sidebar instead.',
    }

    // ---------------------------------------------------------------------
    // transcript anchors + highlight projection
    // ---------------------------------------------------------------------

    /** The element a DOM node belongs to, or null. */
    function elementOfNode(node) {
      if (!node) return null
      return node.nodeType === 1 ? node : (node.parentElement ?? null)
    }

    /** Tags whose text must not be projected. */
    const NON_TEXT_TAGS = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true }

    /** Whether an element's subtree is invisible and must not be walked. */
    function isHiddenElement(element) {
      if (NON_TEXT_TAGS[element.tagName] === true) return true
      if (element.hidden === true) return true
      try {
        const style = window.getComputedStyle?.(element)
        return style ? style.display === 'none' || style.visibility === 'hidden' : false
      } catch {
        return false
      }
    }

    /** Whitespace-free projection both sides of an anchor are compared on. */
    function packedText(value) {
      let out = ''
      const text = typeof value === 'string' ? value : ''
      for (let index = 0; index < text.length; index += 1) {
        const ch = text.charAt(index)
        if (ch.trim() !== '') out += ch
      }
      return out
    }

    /** Every visible kept character under a root, with its (node, offset) pair. */
    function packedMapOf(root) {
      let packed = ''
      const map = []
      const walk = (node) => {
        const children = node.childNodes
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index]
          if (child.nodeType === 3) {
            const data = child.data
            for (let offset = 0; offset < data.length; offset += 1) {
              const ch = data.charAt(offset)
              if (ch.trim() === '') continue
              packed += ch
              map.push(child, offset)
            }
          } else if (child.nodeType === 1) {
            if (isHiddenElement(child)) continue
            walk(child)
          }
        }
      }
      walk(root)
      return { packed, map }
    }

    /** A DOM Range covering [start, end) of a packed map, or null. */
    function rangeFromPacked(full, start, end) {
      if (start < 0 || end <= start) return null
      const last = end - 1
      if (last * 2 + 1 >= full.map.length) return null
      try {
        const range = document.createRange()
        range.setStart(full.map[start * 2], full.map[start * 2 + 1])
        range.setEnd(full.map[last * 2], full.map[last * 2 + 1] + 1)
        return range
      } catch {
        return null
      }
    }

    /** Every start index of `needle` inside `haystack`, capped. */
    function occurrencesOf(haystack, needle, limit) {
      const out = []
      if (needle === '') return out
      let at = haystack.indexOf(needle)
      while (at !== -1 && out.length < limit) {
        out.push(at)
        at = haystack.indexOf(needle, at + 1)
      }
      return out
    }

    /** Centre-to-centre distance between two rects. */
    function rectDistance(left, right) {
      const dx = (left.left + left.right) / 2 - (right.left + right.right) / 2
      const dy = (left.top + left.bottom) / 2 - (right.top + right.bottom) / 2
      return Math.sqrt(dx * dx + dy * dy)
    }

    /** The anchor a live selection hangs on, or null outside a flow item. */
    function anchorFromRange(range, quote) {
      const element = elementOfNode(range.commonAncestorContainer)
      if (element === null || typeof element.closest !== 'function') return null
      const anchorElement = element.closest(ANCHOR_SELECTOR)
      if (anchorElement === null) return null
      const packed = packedText(quote)
      if (packed === '') return null
      const full = packedMapOf(anchorElement)
      const candidates = occurrencesOf(full.packed, packed, MAX_OCCURRENCES)
      if (candidates.length === 0) return null
      let target = null
      try {
        target = range.getBoundingClientRect()
      } catch {
        target = null
      }
      let best = null
      for (const index of candidates) {
        const candidateRange = rangeFromPacked(full, index, index + packed.length)
        if (candidateRange === null) continue
        let distance = 0
        if (target !== null) {
          try {
            distance = rectDistance(candidateRange.getBoundingClientRect(), target)
          } catch {
            distance = 0
          }
        }
        if (best === null || distance < best.distance) best = { index, distance }
      }
      if (best === null) return null
      return {
        key: anchorElement.getAttribute('data-chat-anchor-key'),
        quote: packed,
        prefix: full.packed.slice(Math.max(0, best.index - CONTEXT_CHARS), best.index),
        suffix: full.packed.slice(
          best.index + packed.length,
          best.index + packed.length + CONTEXT_CHARS,
        ),
        index: best.index,
      }
    }

    /** Where one stored anchor sits in an anchor element's current projection. */
    function locateAnchor(full, anchor) {
      if (anchor === null || typeof anchor !== 'object') return null
      if (typeof anchor.quote !== 'string' || anchor.quote === '') return null
      const prefix = typeof anchor.prefix === 'string' ? anchor.prefix : ''
      const suffix = typeof anchor.suffix === 'string' ? anchor.suffix : ''
      const candidates = occurrencesOf(full.packed, anchor.quote, MAX_OCCURRENCES)
      if (candidates.length === 0) return null
      let best = null
      for (const index of candidates) {
        let score = 0
        if (prefix !== '' && full.packed.slice(Math.max(0, index - prefix.length), index) === prefix) score += 4
        if (
          suffix !== '' &&
          full.packed.slice(index + anchor.quote.length, index + anchor.quote.length + suffix.length) === suffix
        ) {
          score += 4
        }
        if (typeof anchor.index === 'number') score += Math.max(0, 2 - Math.abs(index - anchor.index) / 200)
        if (best === null || score > best.score) best = { index, score }
      }
      if (best === null) return null
      if (best.score < 4 && candidates.length > 1) return null
      return { start: best.index, end: best.index + anchor.quote.length }
    }


    /** Clamp a number into an inclusive range. */
    function clamp(value, min, max) {
      const low = Math.min(min, max)
      const high = Math.max(min, max)
      return Math.min(high, Math.max(low, value))
    }

    /** The page storage, or undefined when storage is unavailable (private mode). */
    function storage() {
      try {
        return window.localStorage
      } catch {
        return undefined
      }
    }

    /** Read one JSON object; never throws. */
    function readJson(key) {
      try {
        const text = storage()?.getItem(key)
        if (typeof text !== 'string' || text.length === 0) return undefined
        const value = JSON.parse(text)
        return value !== null && typeof value === 'object' ? value : undefined
      } catch {
        return undefined
      }
    }

    /** Persist one JSON object; never throws. */
    function writeJson(key, value) {
      try {
        storage()?.setItem(key, JSON.stringify(value))
      } catch {
        /* storage full or disabled: position memory is best-effort */
      }
    }

    /** Whether a value is one of the two accepted delivery modes. */
    function isDelivery(value) {
      return value === 'followup' || value === 'steer'
    }

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
      }))
    }

    /** Normalize one stored/edited preset list; invalid entries are dropped. */
    function normalizePresetList(value, lang) {
      if (!Array.isArray(value)) return builtinPresets(lang)
      const list = []
      const seen = new Set()
      for (const item of value) {
        if (item === null || typeof item !== 'object') continue
        const text = typeof item.text === 'string' ? item.text.trim() : ''
        if (text.length === 0) continue
        let id = typeof item.id === 'string' && item.id.length > 0 ? item.id : mintPresetId()
        if (seen.has(id)) id = mintPresetId()
        seen.add(id)
        const rawLabel = typeof item.label === 'string' ? item.label.trim() : ''
        list.push({ id, label: rawLabel.length > 0 ? rawLabel : text.slice(0, 8), text })
        if (list.length >= MAX_PRESETS) break
      }
      if (list.length === 0) {
        console.warn('[dsh-nudge] 口径列表为空或全部非法，回退内置口径')
        return builtinPresets(lang)
      }
      return list
    }

    /** Read the persisted presets; the built-in list is the fallback. */
    function readPresets(lang) {
      return normalizePresetList(readJson(PRESETS_KEY), lang)
    }

    /** Read the chosen preset id, falling back to the first available preset. */
    function readPresetId(presets) {
      try {
        const raw = storage()?.getItem(PRESET_KEY)
        if (raw !== null && raw !== undefined) {
          if (presetOf(presets, raw) !== undefined) return raw
          console.warn(`[dsh-nudge] 忽略非法口径 ${JSON.stringify(raw)}，改用第一条`)
        }
      } catch {
        /* storage unavailable */
      }
      return presets[0]?.id ?? DEFAULT_PRESET
    }

    /** Persist one preset list; a storage failure keeps the in-memory list usable. */
    function writePresets(presets) {
      writeJson(PRESETS_KEY, presets)
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

    /** Current viewport, with sane minimums for the first paint. */
    function viewport() {
      return {
        width: Math.max(320, window.innerWidth || 1280),
        height: Math.max(320, window.innerHeight || 800),
      }
    }

    /**
     * Horizontal inset reserved on the right.
     *
     * The right sidebar (shipped column) is an absolutely positioned panel over
     * the conversation's right edge; a floating window docked at the viewport
     * edge would cover it while it is open. The panel publishes its own width
     * as `--dsh-sidebar-width`, so the first dock position steps left of it.
     * This is host layout chrome, not another plugin's DOM: when the query or
     * the variable is unavailable the dock simply stays at the plain margin.
     */
    function rightInset() {
      let inset = EDGE
      try {
        const panel = document.querySelector('[data-sidebar-right-open]')
        if (panel) {
          const raw = window.getComputedStyle(panel).getPropertyValue('--dsh-sidebar-width').trim()
          const width = Number.parseFloat(raw)
          if (Number.isFinite(width) && width > 0) inset += width
        }
      } catch {
        /* layout unavailable: keep the plain margin */
      }
      return inset
    }

    /** First-run dock position: right, above the composer, clear of the right sidebar. */
    function dockPosition(collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_WIDTH : CARD_WIDTH
      const height = collapsed ? 36 : 220
      return {
        x: Math.round(clamp(vp.width - width - rightInset(), 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(DOCK_TOP, 8, Math.max(8, vp.height - height - 8))),
      }
    }

    /** Clamp one stored position into the current viewport. */
    function clampPoint(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_WIDTH : CARD_WIDTH
      const height = collapsed ? 36 : Math.min(360, Math.max(180, vp.height - COMPOSER_RESERVE - 16))
      const maxY = collapsed
        ? Math.max(8, vp.height - height - 8)
        : Math.max(8, vp.height - height - COMPOSER_RESERVE)
      return {
        x: Math.round(clamp(point.x, 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(point.y, 8, maxY)),
      }
    }

    /** Whether a stored value looks like a point. */
    function isPoint(point) {
      return (
        point !== null &&
        typeof point === 'object' &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      )
    }

    // ---------------------------------------------------------------------
    // runtime: state + delivery, independent of the view
    // ---------------------------------------------------------------------

    /**
     * Build the window runtime.
     *
     * The view is a thin renderer over this object; the checks drive the same
     * object without a browser renderer.
     * @param ctx - plugin context.
     * @returns the runtime handle.
     */
    function createRuntime(ctx) {
      const saved = readJson(UI_KEY) ?? {}
      const language = readLang(ctx)
      const narrow = viewport().width < 720
      const presets = readPresets(language)
      const initialTarget = resolveTarget(ctx)

      let state = {
        phase: 'idle',
        note: '',
        error: '',
        lastAt: undefined,
        lastSessionId: undefined,
        unread: false,
        collapsed:
          typeof saved.collapsed === 'boolean' ? saved.collapsed : narrow,
        // One anchor for both shapes: collapsing keeps the window in place and
        // expanding returns it to the same spot.
        pos: isPoint(saved.pos)
          ? clampPoint(saved.pos, typeof saved.collapsed === 'boolean' ? saved.collapsed : narrow)
          : dockPosition(typeof saved.collapsed === 'boolean' ? saved.collapsed : narrow),
        deliveryOverride: readDeliveryOverride(),
        turbo: readTurbo(),
        presets,
        presetId: readPresetId(presets),
        target: initialTarget,
        pendingQuestion: false,
        /** True while the conversation composer is mounted and holds the caret. */
        composerFocused: false,
        /** Quick annotation master switch (the title-bar button). */
        quick: readQuick(),
        /** Collected quote + note blocks waiting to be delivered. */
        annotations: notesOfSession(initialTarget?.sessionId),
        /** The selection currently being annotated, or null. */
        annotationDraft: null,
        /** The note being written for `annotationDraft`. */
        annotationNote: '',
        /** The collected annotation being edited, or null. */
        annotationEditingId: null,
        /** Whether the annotation module shows its body (row summary when false). */
        annotationExpanded: false,
        /** Whether the nudge module (prompts / mode / primary) shows its body. */
        nudgeExpanded: true,
        /** Timestamp of the last capture, used to restart the attention pulse. */
        attentionAt: 0,
        lang: language,
      }
      const listeners = new Set()

      /** One immutable snapshot per change, as `useSyncExternalStore` requires. */
      function getSnapshot() {
        return state
      }

      /** Replace state and notify every renderer. */
      function setState(patch) {
        let changed = false
        for (const key of Object.keys(patch)) {
          if (!Object.is(state[key], patch[key])) {
            changed = true
            break
          }
        }
        if (!changed) return
        state = { ...state, ...patch }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.warn('[dsh-nudge] listener failed', error)
          }
        }
      }

      /** Subscribe one renderer. */
      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      /** Visible text for the current locale. */
      function text(key) {
        const dict = state.lang === 'zh' ? ZH : EN
        return dict[key] ?? key
      }

      // --- delivery -------------------------------------------------------

      let waiting = null

      function clearWaitTimers(entry) {
        if (!entry) return
        if (entry.settleTimer !== undefined) clearTimeout(entry.settleTimer)
        if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
        if (entry.receiptTimer !== undefined) clearTimeout(entry.receiptTimer)
        if (entry.timeoutTimer !== undefined) clearTimeout(entry.timeoutTimer)
        entry.settleTimer = undefined
        entry.idleTimer = undefined
        entry.receiptTimer = undefined
        entry.timeoutTimer = undefined
      }

      function endWaiting() {
        if (waiting) {
          clearWaitTimers(waiting)
          if (typeof waiting.unsubscribeEvents === 'function') {
            try {
              waiting.unsubscribeEvents()
            } catch {
              /* already released */
            }
          }
          waiting.unsubscribeEvents = undefined
          waiting = null
        }
      }

      function finishDone(note) {
        if (!waiting) return
        const sessionId = waiting.sessionId
        endWaiting()
        setState({
          phase: 'done',
          note: note ?? '',
          error: '',
          lastAt: Date.now(),
          lastSessionId: sessionId,
          unread: state.collapsed ? true : state.unread,
        })
      }

      function finishError(message) {
        endWaiting()
        setState({ phase: 'error', error: message, note: '' })
      }

      /** Map one Host/transport failure to the visible reason (6.1 / 6.2). */
      function describeFailure(failure) {
        const code = failure && typeof failure.code === 'string' ? failure.code : ''
        const message = failure && typeof failure.message === 'string' ? failure.message : ''
        if (code === 'session/not-found') return text('sessionClosed')
        if (code === 'gateway/bad-request') return text('badRequest')
        return message.length > 0 ? `${text('deliveryFailed')}：${message}` : text('deliveryFailed')
      }

      /** Unwrap the generated RemoteResult wrapper (bare payloads pass through). */
      function unwrapResult(result) {
        if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
          return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }
        }
        if (result !== null && typeof result === 'object' && result.accepted === true) {
          return { ok: true, value: result }
        }
        return { ok: false, error: { message: 'unexpected prompt result' } }
      }

      /**
       * Classify a durable turn boundary that closed after the probe.
       * @param kind - `turn/end` reason kind.
       * @returns true when the wait was settled by the boundary.
       */
      function settleByTurnEnd(kind) {
        if (kind === 'blocked') {
          finishError(text('turnBlockedNote'))
          return true
        }
        if (kind === 'failed') {
          finishError(text('turnFailedNote'))
          return true
        }
        if (kind === 'aborted') {
          finishError(text('turnAbortedNote'))
          return true
        }
        if (kind === 'completed') {
          finishError(text('noAnswerNote'))
          return true
        }
        return false
      }

      /**
       * Read the durable window and settle the wait on the probe's own turn.
       *
       * Correlation is exact: the probe carries a client-minted `requestId`, the
       * Host persists it as the user message's `source.rpcId`, and the answer is
       * the first text-bearing assistant message of the step that consumes it.
       * The plugin only looks at event types and seq — never at the reply text.
       */
      function onSessionEvents(entry) {
        if (waiting !== entry) return
        const snapshot = entry.eventSource?.getSnapshot?.()
        const entries = snapshot?.entries
        if (!Array.isArray(entries)) return
        if (entry.probeSeq === undefined) {
          for (const item of entries) {
            if (item?.type !== 'event') continue
            const event = item.event
            if (!event || event.seq <= entry.sinceSeq) continue
            if (event.type !== 'user/message') continue
            const source = event.data?.source
            if (source && source.rpcId === entry.requestId) {
              entry.probeSeq = event.seq
              break
            }
            if (entry.probeText.length > 0 && userMessageText(event) === entry.probeText) {
              entry.probeSeq = event.seq
              break
            }
          }
        }
        if (entry.probeSeq === undefined) return
        // The step that consumes a steering message starts at the next boundary;
        // for a queued turn it is the turn's first step. A message produced by
        // the step already in flight is not the answer, so the reply is the
        // first text-bearing assistant message after that step opens.
        if (entry.stepSeq === undefined) {
          for (const item of entries) {
            if (item?.type !== 'event') continue
            const event = item.event
            if (!event || event.seq <= entry.probeSeq) continue
            if (event.type === 'step/start') {
              entry.stepSeq = event.seq
              break
            }
          }
        }
        for (const item of entries) {
          if (item?.type !== 'event') continue
          const event = item.event
          if (!event || event.seq <= entry.probeSeq) continue
          if (event.type === 'assistant/message') {
            if (entry.stepSeq === undefined || event.seq <= entry.stepSeq) continue
            if (assistantMessageText(event).trim().length > 0) {
              finishDone('')
              return
            }
            continue
          }
          if (event.type === 'turn/end') {
            const kind = event.data?.reason?.kind
            // A blocked end names the archived gate itself, so it needs no step
            // to prove the boundary belongs to this probe. Every other outcome
            // only explains the step that consumed the probe.
            if (kind === 'blocked') {
              if (settleByTurnEnd(kind)) return
              continue
            }
            if (entry.stepSeq === undefined || event.seq <= entry.stepSeq) continue
            if (settleByTurnEnd(kind)) return
          }
        }
      }

      /**
       * Watch one session's durable window for this probe's turn.
       * @returns whether the event route is available (otherwise the running
       *   state heuristic remains the fallback).
       */
      function beginEventWatch(entry) {
        const source = eventSourceOf(ctx, entry.sessionId)
        if (!source || typeof source.subscribe !== 'function' || typeof source.getSnapshot !== 'function') {
          return false
        }
        entry.eventSource = source
        entry.sinceSeq = lastDurableSeq(source.getSnapshot())
        entry.unsubscribeEvents = source.subscribe(() => onSessionEvents(entry))
        onSessionEvents(entry)
        return true
      }

      /** True when the session's last turn closed while a wait was in flight. */
      function onStatusChange() {
        refreshWorld()
        const entry = waiting
        if (!entry) return
        // The event route knows exactly when the probe's turn opens and closes;
        // running-state transitions would settle it too early or too late.
        if (entry.eventSource !== undefined) return
        const running = statusOf(ctx, entry.sessionId)?.running === true
        if (running) {
          entry.sawRunning = true
          if (entry.settleTimer !== undefined) {
            clearTimeout(entry.settleTimer)
            entry.settleTimer = undefined
          }
          return
        }
        // An idle session may answer before ever publishing `running`; the
        // idle timer settles that case. A turn observed running must close
        // once and stay closed: the queue mode may close and reopen a turn.
        if (!entry.sawRunning || entry.settleTimer !== undefined) return
        entry.settleTimer = setTimeout(() => {
          entry.settleTimer = undefined
          if (!waiting || waiting !== entry) return
          if (statusOf(ctx, entry.sessionId)?.running === true) return
          finishDone('')
        }, SETTLE_MS)
      }

      // --- composer insertion ---------------------------------------------

      /**
       * The mounted composer bridge, when a conversation input is on screen.
       * It carries the composer's public action face (`setDraft`) and a reader
       * for the current draft; the plugin never touches the editor DOM.
       */
      let composer

      /** The focused composer editor element, when the caret is inside it. */
      function composerNode() {
        try {
          const active = document.activeElement
          if (!active) return undefined
          const editable =
            active.isContentEditable === true ||
            active.getAttribute?.('contenteditable') === 'true'
          if (!editable) return undefined
          // The DSH composer editor marks itself `data-composer-input`; Lexical
          // marks its root too, and the slot host covers older shells.
          if (typeof active.hasAttribute === 'function' && active.hasAttribute('data-composer-input')) return active
          if (active.getAttribute?.('data-lexical-editor') === 'true') return active
          if (typeof active.closest === 'function' && active.closest('[data-slot="conversation.composer"]')) {
            return active
          }
          return undefined
        } catch {
          return undefined
        }
      }

      /** Write mode is available only while a composer is mounted and focused. */
      function canInsert() {
        return composer !== undefined && composerNode() !== undefined
      }

      /** Keep the visible mode flag (the primary button label) in sync with focus. */
      function syncComposerFocus() {
        const focused = canInsert()
        if (focused !== state.composerFocused) setState({ composerFocused: focused })
      }

      /**
       * Attach the live composer handle handed over by the input bridge.
       * `sync: false` stores it without a store update, for React's render
       * phase; the bridge's effect then attaches with the focus refresh.
       */
      function attachComposer(handle, sync = true) {
        composer = handle
        if (sync) syncComposerFocus()
      }

      /** Detach only when the released handle is still the mounted one. */
      function detachComposer(handle) {
        if (composer !== handle) return
        composer = undefined
        syncComposerFocus()
      }

      /**
       * Append the selected preset to the composer draft instead of sending it.
       * The caret ends up past the written text; existing content is kept and
       * separated by one newline (a blank draft gets no leading newline).
       */
      function insertPreset() {
        const handle = composer
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        const preset = presetOf(state.presets, state.presetId) ?? state.presets[0]
        if (!preset) return false
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        const next =
          draft.trim() === ''
            ? preset.text
            : `${draft}${draft.endsWith('\n') ? '' : '\n'}${preset.text}`
        try {
          handle.setDraft(next)
        } catch (error) {
          console.warn('[dsh-nudge] composer insert failed', error)
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        setState({ note: '', error: '' })
        return true
      }

      // --- annotations ----------------------------------------------------

      /** A field being edited, a modal, and this window are never quoted. */
      const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [data-shortcut-modal]'
      const SELF_SELECTOR = '.dsh-nudge-card, .dsh-nudge-pill, .dsh-nudge-popup'

      /** Trim only the trailing whitespace a selection picks up. */
      function tidyQuote(value) {
        return String(value ?? '').replace(/\s+$/, '')
      }

      /** One annotation as the Markdown block it becomes in the composer. */
      function annotationBlock(item) {
        const lines = tidyQuote(item.quote).split('\n')
        const quoted = lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
        const note = typeof item.note === 'string' ? item.note.trim() : ''
        return note === '' ? quoted : `${quoted}\n${text('answerLabel')}${note}`
      }

      /** All pending annotations as one message body. */
      function annotationsText() {
        return state.annotations.map(annotationBlock).join('\n\n')
      }

      /** The selection worth annotating: quote + its flow-item anchor. */
      function readSelection() {
        try {
          if (typeof window.getSelection !== 'function') return null
          const selection = window.getSelection()
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
          const quote = tidyQuote(selection.toString())
          if (quote.trim() === '') return null
          const range = selection.getRangeAt(0)
          const node = range.commonAncestorContainer
          const element = node && node.nodeType === 1 ? node : node?.parentElement
          if (!element || typeof element.closest !== 'function') return null
          if (element.closest(EDITABLE_SELECTOR)) return null
          if (element.closest(MODAL_SELECTOR)) return null
          if (element.closest(SELF_SELECTOR)) return null
          return { quote, range }
        } catch {
          return null
        }
      }

      let selectionTimer
      let attentionTimer
      let repaintTimer
      let highlightObserver
      /** Ranges painted for the current notes, used to hit-test clicks. */
      let highlighted = []

      /** Cancel a capture that has not fired yet (a new press is starting). */
      function cancelPendingCapture() {
        if (selectionTimer !== undefined) {
          clearTimeout(selectionTimer)
          selectionTimer = undefined
        }
      }

      /**
       * Read the selection once it has settled. A short debounce is what keeps
       * double-click word selection and drag-then-adjust smooth: the browser's
       * own finalisation, the second click and the following mouseup all land
       * before the draft appears, and focus is not stolen mid-gesture.
       */
      function captureSelectionLater() {
        if (state.quick !== true) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined
          captureSelection()
        }, 200)
      }

      /** Keyboard selections end on a shifted keyup. */
      function onSelectionKeyup(event) {
        if (state.quick === true && event?.shiftKey === true) captureSelectionLater()
      }

      /** One short pulse so a capture is noticed wherever the eye is. */
      function pulse() {
        setState({ attentionAt: Date.now() })
        if (attentionTimer !== undefined) clearTimeout(attentionTimer)
        attentionTimer = setTimeout(() => {
          attentionTimer = undefined
          setState({ attentionAt: 0 })
        }, 900)
      }

      /** Turn the current selection into the pending annotation draft. */
      function captureSelection() {
        const selection = readSelection()
        if (selection === null) return false
        if (
          state.annotationDraft !== null &&
          state.annotationDraft.quote === selection.quote &&
          state.annotationEditingId === null
        ) {
          return false
        }
        // The card hangs next to the selection; the nudge window does not move
        // and keeps no focus, so the browser's own selection stays untouched.
        let rect = null
        try {
          rect = selection.range.getBoundingClientRect()
        } catch {
          rect = null
        }
        if (rect !== null && rect.width === 0 && rect.height === 0) rect = null
        setState({
          annotationDraft: {
            quote: selection.quote,
            anchor: null,
            range: selection.range,
            rect: rect
              ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
              : null,
          },
          annotationNote: '',
          annotationEditingId: null,
          note: '',
          error: '',
        })
        repaintHighlights()
        return true
      }

      /**
       * Re-apply the captured Range after the note field takes focus. Focus
       * collapses the real selection and every keystroke clears it again, so
       * the window keeps restoring it: the passage stays genuinely selected
       * (native deep-blue) while the caret types in the window.
       */
      function restoreCaptureSelection() {
        const draft = state.annotationDraft
        if (draft === null || draft.range == null) return false
        try {
          const selection = window.getSelection?.()
          if (!selection) return false
          if (selection.rangeCount > 0 && selection.isCollapsed === false) return true
          selection.removeAllRanges()
          selection.addRange(draft.range)
          return true
        } catch {
          return false
        }
      }

      /** Drop the browser selection only when it is still our captured quote. */
      function clearNativeSelection(quote) {
        try {
          const selection = window.getSelection?.()
          if (!selection || selection.rangeCount === 0) return
          if (typeof quote === 'string' && quote !== '' && selection.toString() === quote) {
            selection.removeAllRanges()
          }
        } catch {
          /* no selection object */
        }
      }

      /** Quick-annotation master switch. */
      function setQuick(value) {
        const next = value === true
        try {
          if (next) storage()?.setItem(QUICK_KEY, '1')
          else storage()?.removeItem(QUICK_KEY)
        } catch {
          /* best effort */
        }
        setState({
          quick: next,
          ...(next
            ? { annotationExpanded: true }
            : { annotationDraft: null, annotationEditingId: null, annotationNote: '', annotationExpanded: false }),
        })
        if (next) repaintHighlights()
        else repaintHighlights()
        return true
      }

      /** Whether the annotation module shows its body. */
      function setAnnotationExpanded(value) {
        setState({ annotationExpanded: value === true })
      }

      /** Whether the nudge module shows its body. */
      function setNudgeExpanded(value) {
        setState({ nudgeExpanded: value === true })
      }

      /** Update the note for the pending annotation draft (or the edit). */
      function setAnnotationNote(value) {
        setState({ annotationNote: typeof value === 'string' ? value : '' })
      }

      /** The Session the annotation tray belongs to. */
      function noteSessionId() {
        return (resolveTarget(ctx) ?? state.target)?.sessionId
      }

      /** Persist the tray of the owning Session. */
      function persistNotes(list) {
        saveNotesOfSession(noteSessionId(), Array.isArray(list) ? list : state.annotations)
      }

      /** Commit the pending quote + note into the tray. */
      function addAnnotation(noteOverride) {
        const draft = state.annotationDraft
        if (!draft || typeof draft.quote !== 'string' || draft.quote.trim() === '') return false
        const note =
          typeof noteOverride === 'string'
            ? noteOverride
            : typeof state.annotationNote === 'string'
              ? state.annotationNote.trim()
              : ''
        // Anchoring walks the whole flow item; do it now (one click) instead of
        // on every mouseup, so selecting text stays light.
        let anchor = draft.anchor ?? null
        if (anchor === null && draft.range != null) {
          try {
            anchor = anchorFromRange(draft.range, draft.quote)
          } catch {
            anchor = null
          }
        }
        const annotation = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          quote: draft.quote,
          note,
          anchor,
        }
        const next = [...state.annotations, annotation]
        persistNotes(next)
        clearNativeSelection(draft.quote)
        // Keep the compose box in place for the next passage; only the text
        // clears. Window size stays stable while annotating several passages.
        setState({
          annotations: next,
          annotationDraft: null,
          annotationNote: '',
          annotationEditingId: null,
          note: '',
          error: '',
        })
        repaintHighlights()
        return true
      }

      /** Add the captured passage with the 同意 / 不同意 answer. */
      function quickReply(kind) {
        return addAnnotation(kind === 'agree' ? text('agree') : text('disagree'))
      }

      /** Drop the pending annotation draft without adding it. */
      function dismissAnnotationDraft() {
        setState({ annotationDraft: null, annotationNote: '' })
        repaintHighlights()
      }

      /** Open one collected annotation for editing. */
      function startEditAnnotation(id) {
        const item = state.annotations.find((candidate) => candidate.id === id)
        if (item === undefined) return false
        setState({
          annotationEditingId: id,
          annotationNote: typeof item.note === 'string' ? item.note : '',
          annotationDraft: null,
          annotationExpanded: true,
          nudgeExpanded: false,
          note: '',
          error: '',
        })
        repaintHighlights()
        pulse()
        return true
      }

      /** Persist the edited note. */
      function saveEditedAnnotation() {
        if (state.annotationEditingId === null) return false
        const note = typeof state.annotationNote === 'string' ? state.annotationNote.trim() : ''
        const next = state.annotations.map((item) =>
          item.id === state.annotationEditingId ? { ...item, note } : item,
        )
        persistNotes(next)
        setState({ annotations: next, annotationEditingId: null, annotationNote: '', note: '', error: '' })
        repaintHighlights()
        return true
      }

      /** Leave the edit without saving. */
      function cancelAnnotationEdit() {
        setState({ annotationEditingId: null, annotationNote: '' })
      }

      /** Remove one collected annotation (also used from the edit body). */
      function removeAnnotation(id) {
        const next = state.annotations.filter((item) => item.id !== id)
        if (next.length === state.annotations.length) return false
        persistNotes(next)
        setState({
          annotations: next,
          annotationEditingId: state.annotationEditingId === id ? null : state.annotationEditingId,
          annotationNote: state.annotationEditingId === id ? '' : state.annotationNote,
        })
        repaintHighlights()
        return true
      }

      /** Copy the captured passage to the clipboard (the copy the flow hides). */
      function copyDraftQuote() {
        const quote = state.annotationDraft?.quote
        if (typeof quote !== 'string' || quote === '') return false
        try {
          const clipboard = navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') {
            setState({ note: text('copyFailed') })
            return false
          }
          clipboard.writeText(quote).then(
            () => setState({ note: text('copied') }),
            () => setState({ note: text('copyFailed') }),
          )
          return true
        } catch {
          setState({ note: text('copyFailed') })
          return false
        }
      }

      // --- painted highlights ---------------------------------------------

      /** Recompute which spans carry a note and repaint the CSS highlight. */
      function repaintHighlights() {
        highlighted = []
        const registry = window.CSS?.highlights
        if (registry === undefined) return
        try {
          const captureDraft = state.annotationDraft
          const captureAnchor =
            captureDraft !== null && captureDraft.anchor != null ? captureDraft.anchor : null
          if (state.quick !== true || (state.annotations.length === 0 && captureDraft === null)) {
            registry.delete(HIGHLIGHT_NAME)
            registry.delete(CAPTURE_HIGHLIGHT)
            return
          }
          const byKey = new Map()
          for (const note of state.annotations) {
            const anchor = note.anchor
            if (anchor === null || typeof anchor !== 'object' || typeof anchor.key !== 'string') continue
            if (!byKey.has(anchor.key)) byKey.set(anchor.key, [])
            byKey.get(anchor.key).push({ note, anchor, capture: false })
          }
          if (captureAnchor !== null && typeof captureAnchor.key === 'string') {
            if (!byKey.has(captureAnchor.key)) byKey.set(captureAnchor.key, [])
            byKey.get(captureAnchor.key).push({ note: null, anchor: captureAnchor, capture: true })
          }
          if (byKey.size === 0) {
            registry.delete(HIGHLIGHT_NAME)
            let painted = false
            const fallback = captureDraft?.range
            try {
              if (fallback && fallback.collapsed !== true) {
                registry.set(CAPTURE_HIGHLIGHT, new window.Highlight(fallback))
                painted = true
              }
            } catch {
              painted = false
            }
            if (!painted) registry.delete(CAPTURE_HIGHLIGHT)
            return
          }
          const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
          const maps = new Map()
          const ranges = []
          const captureRanges = []
          for (const element of elements) {
            const key = element.getAttribute?.('data-chat-anchor-key')
            const wanted = byKey.get(key)
            if (wanted === undefined) continue
            let full = maps.get(key)
            if (full === undefined) {
              full = packedMapOf(element)
              maps.set(key, full)
            }
            for (const entry of wanted) {
              const span = locateAnchor(full, entry.anchor)
              if (span === null) continue
              const range = rangeFromPacked(full, span.start, span.end)
              if (range === null) continue
              if (entry.capture === true) {
                captureRanges.push(range)
                continue
              }
              ranges.push(range)
              highlighted.push({ note: entry.note, range })
            }
          }
          if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
          else registry.set(HIGHLIGHT_NAME, new window.Highlight(...ranges))
          if (captureAnchor === null && captureDraft !== null && captureDraft.range) {
            try {
              if (captureDraft.range.collapsed !== true) captureRanges.push(captureDraft.range)
            } catch {
              /* stale range */
            }
          }
          if (captureRanges.length === 0) registry.delete(CAPTURE_HIGHLIGHT)
          else registry.set(CAPTURE_HIGHLIGHT, new window.Highlight(...captureRanges))
        } catch (error) {
          console.warn('[dsh-nudge] highlight repaint failed', error)
        }
      }

      /** Coalesce repaint triggers into one frame-ish task. */
      function scheduleRepaint() {
        if (repaintTimer !== undefined || state.quick !== true) return
        repaintTimer = setTimeout(() => {
          repaintTimer = undefined
          repaintHighlights()
        }, 120)
      }

      /** The annotated passage under a viewport point, or null. */
      function noteAtPoint(x, y) {
        for (let index = highlighted.length - 1; index >= 0; index -= 1) {
          const entry = highlighted[index]
          let rects
          try {
            rects = entry.range.getClientRects()
          } catch {
            continue
          }
          for (const rect of rects) {
            if (rect.width === 0 && rect.height === 0) continue
            if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) {
              return entry.note
            }
          }
        }
        return null
      }

      /** Clicking a painted passage reopens its note for editing. */
      function onTranscriptClick(event) {
        if (state.quick !== true || highlighted.length === 0) return
        try {
          const selection = window.getSelection?.()
          if (selection && selection.isCollapsed === false) return
        } catch {
          /* no selection object */
        }
        const note = noteAtPoint(event.clientX, event.clientY)
        if (note === null) return
        startEditAnnotation(note.id)
      }

      /** Viewport box for the selection card: beside the quote, flipped when cramped. */
      function popupPosition() {
        const draft = state.annotationDraft
        const width = 320
        const margin = 12
        const approxHeight = 240
        const vw = viewport().width
        const vh = viewport().height
        const rect = draft?.rect ?? null
        if (!rect) return { left: `${Math.max(margin, vw - width - margin)}px`, top: '96px', width: `${width}px` }
        let left = rect.right + 10
        if (left + width > vw - margin) left = rect.left - width - 10
        if (left < margin) left = Math.max(margin, Math.min(rect.left, vw - width - margin))
        let top = rect.bottom + 8
        if (top + approxHeight > vh - margin) top = Math.max(margin, rect.top - approxHeight - 8)
        return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${width}px` }
      }

      /** Close the selection card, dropping its draft and the restored selection. */
      function closePopup() {
        const draft = state.annotationDraft
        if (draft === null && state.annotationEditingId === null) return false
        if (draft !== null) clearNativeSelection(draft.quote)
        if (typeof document !== 'undefined' && document.activeElement?.closest?.(SELF_SELECTOR)) {
          try {
            document.activeElement.blur()
          } catch {
            /* nothing focused */
          }
        }
        setState({ annotationDraft: null, annotationNote: '', annotationEditingId: null })
        repaintHighlights()
        return true
      }

      /**
       * A press anywhere outside the card closes it: the popup owns no focus
       * until its own field is clicked, so a click elsewhere is just the
       * reader moving on.
       */
      function onOuterPointerDown(event) {
        cancelPendingCapture()
        if (state.quick !== true) return
        if (state.annotationDraft === null && state.annotationEditingId === null) return
        const target = event.target
        if (target && typeof target.closest === 'function' && target.closest(SELF_SELECTOR)) return
        closePopup()
      }

      /** Scroll and Escape close the selection card, like the old popup did. */
      function onPopupDismiss(event) {
        if (state.annotationDraft === null) return
        // Scrolling inside the card's own field/list must not dismiss it.
        if (
          event &&
          event.target &&
          typeof event.target.closest === 'function' &&
          event.target.closest(SELF_SELECTOR)
        ) {
          return
        }
        closePopup()
      }

      function onPopupKeydown(event) {
        if (event?.key === 'Escape' && state.annotationDraft !== null) {
          event.preventDefault()
          closePopup()
        }
      }

      /** Append every collected annotation to the composer draft. */
      function writeAnnotations() {
        if (state.annotations.length === 0) return false
        const handle = composer
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        const body = annotationsText()
        if (body === '') return false
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        const next = draft.trim() === '' ? body : `${draft}${draft.endsWith('\n') ? '' : '\n'}${body}`
        try {
          handle.setDraft(next)
        } catch (error) {
          console.warn('[dsh-nudge] annotation write failed', error)
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        persistNotes([])
        setState({
          annotations: [],
          annotationDraft: null,
          annotationNote: '',
          annotationEditingId: null,
          annotationExpanded: false,
          note: '',
          error: '',
        })
        repaintHighlights()
        return true
      }

      /** Send every collected annotation as one user message. */
      function sendAnnotations() {
        if (state.phase === 'waiting') return false
        if (state.annotations.length === 0) return false
        const body = annotationsText()
        if (body === '') return false
        if (!deliver(body)) return false
        persistNotes([])
        setState({
          annotations: [],
          annotationDraft: null,
          annotationNote: '',
          annotationEditingId: null,
          annotationExpanded: false,
        })
        repaintHighlights()
        return true
      }

      /** Deliver one message into the on-screen session. */
      function deliver(message) {
        if (typeof message !== 'string' || message.trim() === '') return false
        const target = resolveTarget(ctx) ?? state.target
        if (!target) {
          setState({ phase: 'error', error: text('noSession'), note: '' })
          return false
        }
        // 6.3: the agent's ball is in the user's court; a second request would
        // only stack two pending inputs, so refuse with the reason.
        if (statusOf(ctx, target.sessionId)?.pendingInteraction) {
          setState({ phase: 'error', error: text('waitingQuestion'), note: '' })
          return false
        }
        const remote = sessionRemoteOf(ctx)
        if (!remote) {
          setState({ phase: 'error', error: text('transportMissing'), note: '' })
          return false
        }
        const delivery = isDelivery(state.deliveryOverride)
          ? state.deliveryOverride
          : DEFAULT_DELIVERY
        const mode = delivery === 'steer' ? 'steer' : 'queue'
        const requestId = mintRequestId()
        const controller = new AbortController()
        const entry = {
          sessionId: target.sessionId,
          requestId,
          probeText: message,
          sawRunning: statusOf(ctx, target.sessionId)?.running === true,
          settleTimer: undefined,
          idleTimer: undefined,
          receiptTimer: undefined,
          timeoutTimer: undefined,
          eventSource: undefined,
          unsubscribeEvents: undefined,
          sinceSeq: 0,
          probeSeq: undefined,
          stepSeq: undefined,
        }
        waiting = entry
        setState({ phase: 'waiting', note: '', error: '', target })
        const eventRoute = beginEventWatch(entry)

        entry.timeoutTimer = setTimeout(function onTimeout() {
          if (!waiting || waiting !== entry) return
          // A long turn is the normal case for a follow-up nudge: keep waiting
          // while the agent is still running instead of declaring it late.
          if (statusOf(ctx, entry.sessionId)?.running === true) {
            setState({ note: text('stillRunningNote') })
            entry.timeoutTimer = setTimeout(onTimeout, WAIT_TIMEOUT_MS)
            return
          }
          if (eventRoute) finishError(text('timeoutNote'))
          else finishDone(text('timeoutNote'))
        }, WAIT_TIMEOUT_MS)
        if (eventRoute) {
          entry.receiptTimer = setTimeout(function onReceipt() {
            if (!waiting || waiting !== entry) return
            if (entry.probeSeq !== undefined) return
            if (statusOf(ctx, entry.sessionId)?.running === true) {
              entry.receiptTimer = setTimeout(onReceipt, EVENT_RECEIPT_MS)
              return
            }
            finishError(text('noReceiptNote'))
          }, EVENT_RECEIPT_MS)
        } else {
          // No durable window to watch: fall back to the running-state heuristic.
          entry.idleTimer = setTimeout(() => {
            if (!waiting || waiting !== entry) return
            if (entry.sawRunning) return
            // The unified status may still report the turn: trust it over the timer.
            if (statusOf(ctx, entry.sessionId)?.running === true) {
              entry.sawRunning = true
              return
            }
            finishDone(text('unconfirmedNote'))
          }, IDLE_CONFIRM_MS)
        }

        let request
        try {
          request = remote.prompt(
            {
              requestId,
              sessionId: target.sessionId,
              mode,
              content: [{ type: 'text', text: message }],
              clientTimeZone: timeZoneOf(),
            },
            controller.signal,
          )
        } catch (error) {
          finishError(describeFailure(error))
          return false
        }
        Promise.resolve(request).then(
          (result) => {
            if (!waiting || waiting !== entry) return
            const outcome = unwrapResult(result)
            if (!outcome.ok) finishError(describeFailure(outcome.error))
          },
          (error) => {
            if (!waiting || waiting !== entry) return
            finishError(describeFailure(error))
          },
        )
        return true
      }

      /** The primary button: write into the composer, or send the chosen preset. */
      function ask() {
        if (state.phase === 'waiting' && !canInsert()) return false
        // With the caret in the composer the same button writes the chosen
        // prompt into the draft instead of starting a turn.
        if (canInsert()) return insertPreset()
        const preset = presetOf(state.presets, state.presetId) ?? state.presets[0]
        if (!preset) return false
        return deliver(preset.text)
      }

      /** Switch the delivery mode for this browser and remember it. */
      function setDelivery(value) {
        if (!isDelivery(value)) return false
        try {
          storage()?.setItem(DELIVERY_KEY, value)
        } catch {
          /* best effort */
        }
        setState({ deliveryOverride: value })
        return true
      }

      /** The delivery actually used: browser override, else the single default. */
      function effectiveDelivery() {
        if (isDelivery(state.deliveryOverride)) return state.deliveryOverride
        return DEFAULT_DELIVERY
      }

      /** Turbo mode: hide the primary button and run a prompt on double-click. */
      function setTurbo(value) {
        const next = value === true
        try {
          if (next) storage()?.setItem(TURBO_KEY, '1')
          else storage()?.removeItem(TURBO_KEY)
        } catch {
          /* best effort */
        }
        setState({ turbo: next })
        return true
      }

      /** Switch the probe preset for this browser and remember it. */
      function setPreset(value) {
        if (presetOf(state.presets, value) === undefined) return false
        try {
          storage()?.setItem(PRESET_KEY, value)
        } catch {
          /* best effort */
        }
        setState({ presetId: value })
        return true
      }

      /** Store one preset list, keeping the selection valid. */
      function commitPresets(next, preferredId) {
        const list = normalizePresetList(next, state.lang)
        writePresets(list)
        let presetId = preferredId ?? state.presetId
        if (presetOf(list, presetId) === undefined) presetId = list[0]?.id ?? DEFAULT_PRESET
        try {
          storage()?.setItem(PRESET_KEY, presetId)
        } catch {
          /* best effort */
        }
        setState({ presets: list, presetId })
      }

      /** Add one user preset; returns the new id, or an error text. */
      function addPreset(label, body) {
        const value = typeof body === 'string' ? body.trim() : ''
        if (value.length === 0) return { ok: false, error: text('presetTextRequired') }
        if (state.presets.length >= MAX_PRESETS) return { ok: false, error: text('presetLimit') }
        const preset = {
          id: mintPresetId(),
          label: typeof label === 'string' && label.trim().length > 0 ? label.trim() : value.slice(0, 8),
          text: value,
        }
        commitPresets([...state.presets, preset], preset.id)
        return { ok: true, id: preset.id }
      }

      /** Update one preset's label/text; empty text is refused. */
      function updatePreset(id, patch) {
        const current = presetOf(state.presets, id)
        if (current === undefined) return { ok: false, error: text('presetTextRequired') }
        const value = patch && typeof patch.text === 'string' ? patch.text.trim() : current.text
        if (value.length === 0) return { ok: false, error: text('presetTextRequired') }
        const label =
          patch && typeof patch.label === 'string'
            ? patch.label.trim().length > 0
              ? patch.label.trim()
              : value.slice(0, 8)
            : current.label
        commitPresets(
          state.presets.map((preset) => (preset.id === id ? { id, label, text: value } : preset)),
          state.presetId,
        )
        return { ok: true }
      }

      /** Remove one preset; the last remaining preset cannot be removed. */
      function removePreset(id) {
        if (state.presets.length <= 1) return false
        const next = state.presets.filter((preset) => preset.id !== id)
        if (next.length === state.presets.length) return false
        commitPresets(next, state.presetId === id ? next[0].id : state.presetId)
        return true
      }

      /** Restore the built-in presets (and forget the settings storage). */
      function resetPresets() {
        try {
          storage()?.removeItem(PRESETS_KEY)
        } catch {
          /* best effort */
        }
        commitPresets(builtinPresets(state.lang), DEFAULT_PRESET)
      }

      // --- window state ---------------------------------------------------

      /**
       * Collapse or expand the window in place: the pill keeps the card's
       * top-left anchor (clamped to the pill's own size), and expanding restores
       * the card at the same anchor.
       */
      function setCollapsed(value) {
        if (state.collapsed === value) return
        setState({
          collapsed: value,
          unread: value ? state.unread : false,
          pos: clampPoint(state.pos, value),
        })
        saveUi()
      }

      /** Move the window while dragging (not persisted until drop). */
      function moveTo(x, y) {
        setState({ pos: clampPoint({ x, y }, state.collapsed) })
      }

      /** Persist the current window state. */
      function saveUi() {
        writeJson(UI_KEY, { collapsed: state.collapsed, pos: state.pos })
      }

      // --- settings navigation --------------------------------------------

      let settingsTimer

      /** The settings dialog, tolerating shell versions with slightly different seams. */
      function findSettingsPanel() {
        return (
          document.querySelector?.(SETTINGS_PANEL_SELECTOR) ??
          document.querySelector?.('[role="dialog"][aria-modal="true"]')
        )
      }

      /** Click the settings nav row that owns this plugin's section. */
      function selectSettingsSection(panel) {
        if (typeof panel?.querySelectorAll !== 'function') return false
        const target = text('settingsTitle')
        const buttons = [...panel.querySelectorAll('button')]
        const textOf = (button) => (button.textContent ?? '').replace(/\s+/g, '')
        const labelOf = (button) => (button.getAttribute?.('aria-label') ?? '').replace(/\s+/g, '')
        const match =
          buttons.find((button) => textOf(button) === target) ??
          buttons.find((button) => textOf(button).includes(target)) ??
          buttons.find((button) => labelOf(button).includes(target))
        if (!match || typeof match.click !== 'function') return false
        match.click()
        return true
      }

      /** The modal id the shortcuts adapter would report, so the command's own guard applies. */
      function currentModalId() {
        try {
          const dialogs = document.querySelectorAll?.(
            '[data-shortcut-modal], [role="dialog"][aria-modal="true"]',
          )
          const top = dialogs?.[dialogs.length - 1]
          if (!top) return null
          return top.getAttribute?.('data-shortcut-modal') ?? 'other'
        } catch {
          return null
        }
      }

      /**
       * Run the shell's registered `settings.open` command. The sidebar launcher
       * seat may be occupied by the account menu, so the plain Settings trigger
       * is not always in the sidebar. The command is the shell's own entry point
       * and works for either launcher and for both runtimes; the Desktop shell
       * routes real key events to a native bridge, so synthesizing a keydown is
       * only a last resort for Web shells.
       */
      function runSettingsCommand() {
        try {
          const registry = ctx.get?.('shortcuts')?.registry
          if (typeof registry?.invoke === 'function') {
            registry.invoke('settings.open', { region: 'page', modal: currentModalId() })
            return true
          }
        } catch (error) {
          console.warn('[dsh-nudge] settings command failed', error)
        }
        return pressSettingsShortcut()
      }

      /** Synthesize the registered `settings.open` keystroke; Web shells only. */
      function pressSettingsShortcut() {
        try {
          if (typeof KeyboardEvent === 'undefined') return false
          const shortcuts = ctx.get?.('shortcuts')
          const row = shortcuts?.catalog
            ?.getSnapshot?.()
            ?.find((entry) => entry.id === 'settings.open')
          const binding = row?.binding
          if (!binding) return false
          const modifiers = new Set(binding.modifiers ?? [])
          const event = new KeyboardEvent('keydown', {
            code: binding.code,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.has('control'),
            altKey: modifiers.has('alt'),
            shiftKey: modifiers.has('shift'),
            metaKey: modifiers.has('meta'),
          })
          const target = document.activeElement ?? document.body ?? window
          target.dispatchEvent(event)
          return true
        } catch (error) {
          console.warn('[dsh-nudge] settings shortcut failed', error)
          return false
        }
      }

      /** The freshly opened panel renders on the next frame(s); retry briefly. */
      function waitForSettingsSection(attempt) {
        try {
          const panel = findSettingsPanel()
          if (panel) {
            // Some shell versions render the panel before its nav rows. If the
            // rows never expose our label, keep Settings open rather than
            // reporting a false failure — the user can still pick the section.
            if (selectSettingsSection(panel) || attempt >= 20) return
          } else if (attempt >= 40) {
            console.warn('[dsh-nudge] settings panel did not appear')
            setState({ note: text('settingsUnavailable') })
            return
          }
          settingsTimer = setTimeout(() => {
            settingsTimer = undefined
            waitForSettingsSection(attempt + 1)
          }, 50)
        } catch (error) {
          console.warn('[dsh-nudge] settings navigation failed', error)
          setState({ note: text('settingsUnavailable') })
        }
      }

      /**
       * Open the shell-owned Settings panel and land on this plugin's section.
       * The shell exposes no public open/navigate service, so this clicks the
       * plain Settings trigger when the sidebar still renders it, and otherwise
       * runs the registered `settings.open` command. It never falls back to a
       * document-wide `aria-haspopup="dialog"` match: other plugins (for example
       * the Agent Team panel) render dialog triggers earlier in the DOM and the
       * gear used to open those instead of Settings.
       */
      function openSettings() {
        try {
          const panel = findSettingsPanel()
          if (panel) {
            if (!selectSettingsSection(panel)) waitForSettingsSection(0)
            return true
          }
          // Only the plain Settings trigger has `aria-haspopup="dialog"` and it
          // is scoped to the sidebar seat. When the account menu owns that seat
          // (`aria-haspopup="menu"`), the command below opens the same panel.
          const root = document.querySelector?.(SETTINGS_ROOT_SELECTOR)
          const trigger = root?.querySelector?.('button[aria-haspopup="dialog"]')
          if (trigger && typeof trigger.click === 'function') {
            trigger.click()
          } else if (!runSettingsCommand()) {
            setState({ note: text('settingsUnavailable') })
            return false
          }
          waitForSettingsSection(0)
          return true
        } catch (error) {
          console.warn('[dsh-nudge] open settings failed', error)
          setState({ note: text('settingsUnavailable') })
          return false
        }
      }

      /** Keep the window inside the viewport after a resize; the card closes. */
      function onResize() {
        setState({ pos: clampPoint(state.pos, state.collapsed) })
        onPopupDismiss()
      }

      // --- world subscriptions -------------------------------------------

      /** Refresh target/pending facts from the Client stores. */
      let lastTargetId
      function refreshWorld() {
        const target = resolveTarget(ctx)
        const pendingQuestion = target
          ? Boolean(statusOf(ctx, target.sessionId)?.pendingInteraction)
          : false
        const targetId = target?.sessionId
        if (targetId !== lastTargetId) {
          lastTargetId = targetId
          // The ask is bound to the conversation it was clicked in (1.2); a
          // different conversation must not inherit its status or its wait.
          if (waiting !== null) endWaiting()
          // The tray belongs to the conversation it quotes: load that Session's
          // saved notes and drop any half-written one.
          setState({
            target,
            pendingQuestion,
            note: '',
            error: '',
            phase: 'idle',
            annotations: notesOfSession(targetId),
            annotationDraft: null,
            annotationNote: '',
            annotationEditingId: null,
            annotationExpanded: false,
            nudgeExpanded: true,
            attentionAt: 0,
          })
          repaintHighlights()
          return
        }
        setState({ target, pendingQuestion })
      }

      const offs = []
      const sessions = ctx.get?.('sessions')
      if (typeof sessions?.list?.subscribe === 'function') {
        offs.push(sessions.list.subscribe(refreshWorld))
      }
      const statusSource = ctx.get?.('uiSession')?.sessionStatus
      if (typeof statusSource?.subscribe === 'function') {
        offs.push(statusSource.subscribe(onStatusChange))
      }
      try {
        const locale = ctx.get?.('locale')
        if (typeof locale?.subscribe === 'function') {
          offs.push(locale.subscribe(() => setState({ lang: readLang(ctx) })))
        }
      } catch {
        /* locale absent */
      }
      window.addEventListener('resize', onResize)
      // The primary button follows the caret: entering or leaving the composer
      // flips the write mode without polling.
      try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('focusin', syncComposerFocus, true)
          document.addEventListener('focusout', syncComposerFocus, true)
          // Selection capture and painted-passage clicks.
          document.addEventListener('mouseup', captureSelectionLater, true)
          document.addEventListener('keyup', onSelectionKeyup, true)
          document.addEventListener('click', onTranscriptClick, true)
          // A press outside the window or card dismisses it.
          document.addEventListener('pointerdown', onOuterPointerDown, true)
          document.addEventListener('keydown', onPopupKeydown, true)
          window.addEventListener('scroll', scheduleRepaint, true)
          // Scrolling or resizing closes the selection card, like the old popup.
          window.addEventListener('scroll', onPopupDismiss, true)
        }
      } catch {
        /* no document (checks drive the runtime directly) */
      }
      try {
        if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
          highlightObserver = new MutationObserver(() => scheduleRepaint())
          highlightObserver.observe(document.documentElement ?? document.body, {
            childList: true,
            subtree: true,
          })
        }
      } catch {
        /* no observer */
      }
      refreshWorld()

      /** Release every subscription and in-flight request. */
      function dispose() {
        endWaiting()
        for (const off of offs) {
          try {
            off?.()
          } catch {
            /* already disposed */
          }
        }
        offs.length = 0
        if (settingsTimer !== undefined) clearTimeout(settingsTimer)
        window.removeEventListener('resize', onResize)
        try {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('focusin', syncComposerFocus, true)
            document.removeEventListener('focusout', syncComposerFocus, true)
            document.removeEventListener('mouseup', captureSelectionLater, true)
            document.removeEventListener('keyup', onSelectionKeyup, true)
            document.removeEventListener('click', onTranscriptClick, true)
            document.removeEventListener('pointerdown', onOuterPointerDown, true)
            document.removeEventListener('keydown', onPopupKeydown, true)
            window.removeEventListener('scroll', scheduleRepaint, true)
            window.removeEventListener('scroll', onPopupDismiss, true)
          }
        } catch {
          /* no document */
        }
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        if (attentionTimer !== undefined) clearTimeout(attentionTimer)
        if (repaintTimer !== undefined) clearTimeout(repaintTimer)
        try {
          highlightObserver?.disconnect()
        } catch {
          /* already gone */
        }
        try {
          window.CSS?.highlights?.delete(HIGHLIGHT_NAME)
          window.CSS?.highlights?.delete(CAPTURE_HIGHLIGHT)
        } catch {
          /* no highlight registry */
        }
        highlighted = []
        listeners.clear()
      }

      return {
        subscribe,
        getSnapshot,
        text,
        ask,
        setDelivery,
        effectiveDelivery,
        setTurbo,
        setPreset,
        addPreset,
        updatePreset,
        removePreset,
        resetPresets,
        setCollapsed,
        moveTo,
        saveUi,
        openSettings,
        /** Composer bridge hooks (session input overlay). */
        attachComposer,
        detachComposer,
        /** Annotation tray. */
        captureSelection,
        popupPosition,
        restoreCaptureSelection,
        setQuick,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        addAnnotation,
        quickReply,
        copyDraftQuote,
        startEditAnnotation,
        saveEditedAnnotation,
        cancelAnnotationEdit,
        dismissAnnotationDraft,
        removeAnnotation,
        writeAnnotations,
        sendAnnotations,
        dispose,
        /** @internal exposed for scripts/check-client.mjs */
        _debug: { maxPresets: MAX_PRESETS, state: () => state, syncComposerFocus },
      }
    }

    // ---------------------------------------------------------------------
    // view
    // ---------------------------------------------------------------------

    const CSS = `
.dsh-nudge-card,.dsh-nudge-pill,.dsh-nudge-settings{--dn-accent:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 78%,var(--dsw-alias-label-primary,#1a1a1a) 22%);--dn-accent-soft:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 14%,transparent);--dn-accent-line:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 38%,transparent);--dn-line:var(--dsw-alias-border-l1,rgba(127,127,127,.25));--dn-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent)}
.dsh-nudge-card{position:fixed;z-index:${Z_INDEX};width:min(304px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 18px 44px -22px rgba(15,23,42,.3);font:13px/1.55 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;pointer-events:auto;animation:dsh-nudge-in .18s ease-out}
@keyframes dsh-nudge-in{from{opacity:0;transform:translateY(-5px) scale(.985)}to{opacity:1;transform:none}}
.dsh-nudge-title{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-title:active{cursor:grabbing}
.dsh-nudge-name{font-size:12.5px;font-weight:600;letter-spacing:.2px}
.dsh-nudge-spacer{flex:1 1 auto}
.dsh-nudge-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#9a9aa4);flex:0 0 auto;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-idle-primary,#9a9aa4) 16%,transparent);transition:background .2s ease,box-shadow .2s ease}
.dsh-nudge-dot.waiting{background:var(--dsw-alias-state-warn-primary,#d99b1e);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d99b1e) 20%,transparent);animation:dsh-nudge-pulse 1.2s ease-in-out infinite}
.dsh-nudge-dot.done{background:var(--dsw-alias-state-success-primary,#2f9e63);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#2f9e63) 18%,transparent)}
.dsh-nudge-dot.error{background:var(--dsw-alias-state-error-primary,#c8433c);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 18%,transparent)}
@keyframes dsh-nudge-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dsh-nudge-icon{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-icon:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-alert{margin:10px 14px 0;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.5;word-break:break-word}
.dsh-nudge-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent);color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-alert.note{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d99b1e) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#a06a00)}
.dsh-nudge-content{display:flex;flex-direction:column;gap:12px;padding:12px 14px 14px}
.dsh-nudge-field{display:flex;flex-direction:column;gap:7px;min-width:0}
.dsh-nudge-field-inline{flex-direction:row;align-items:center;gap:10px}
.dsh-nudge-field-inline .dsh-nudge-field-label{flex:0 0 auto}
.dsh-nudge-field-label{font-size:11px;font-weight:600;letter-spacing:.4px;color:var(--dsw-alias-label-secondary,#6a6a76)}
.dsh-nudge-presets{display:flex;flex-wrap:wrap;gap:6px}
.dsh-nudge-chip{height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-nudge-chip:hover{border-color:var(--dn-accent-line);color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dn-accent-soft)}
.dsh-nudge-chip:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-chip.active{background:var(--dn-accent-soft);border-color:var(--dn-accent-line);color:var(--dn-accent);font-weight:600}
.dsh-nudge-mode{display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 5%,transparent);border:1px solid var(--dn-line)}
.dsh-nudge-mode button{height:24px;padding:0 11px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-mode button:hover{color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-mode button.active{background:var(--dn-accent-soft);color:var(--dn-accent);font-weight:600}
.dsh-nudge-mode button:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-mode.inactive{opacity:.45;pointer-events:none}
.dsh-nudge-ask{height:38px;border:0;border-radius:11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dn-accent);box-shadow:0 8px 20px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 55%,transparent);transition:filter .15s ease,transform .1s ease,box-shadow .15s ease}
.dsh-nudge-ask:hover{filter:brightness(1.05);box-shadow:0 10px 24px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 65%,transparent)}
.dsh-nudge-ask:active{transform:translateY(1px)}
.dsh-nudge-ask:disabled{opacity:.55;cursor:default;box-shadow:none;filter:none}
.dsh-nudge-ask:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-turbo-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);text-align:center;padding:2px 0 0;user-select:none}
.dsh-nudge-annotation-compose{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dn-accent-line);background:var(--dn-accent-soft)}
.dsh-nudge-annotation-compose .dsh-nudge-annotation-quote{min-height:34px;-webkit-line-clamp:2}
.dsh-nudge-annotation-quote{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-popup{position:fixed;z-index:${Z_INDEX + 1};box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.06),0 18px 44px -20px rgba(15,23,42,.35);font:13px/1.55 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;pointer-events:auto;animation:dsh-nudge-in .16s ease-out}
.dsh-nudge-popup-quote{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-input{width:100%;box-sizing:border-box;min-height:52px;field-sizing:content;max-height:min(160px,28vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px}
.dsh-nudge-annotation-input:disabled{opacity:.6;cursor:not-allowed}
.dsh-nudge-btn:disabled{opacity:.45;cursor:default}
.dsh-nudge-annotation-input:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-annotation-actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-nudge-annotations-count{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dn-accent-soft);color:var(--dn-accent);font-size:10px;line-height:16px;text-align:center}
.dsh-nudge-annotation-list{display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto}
.dsh-nudge-annotation-item{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 5%,transparent)}
.dsh-nudge-annotation-item-head{display:flex;align-items:flex-start;gap:6px}
.dsh-nudge-annotation-item-head .dsh-nudge-annotation-quote{flex:1 1 auto;min-width:0;-webkit-line-clamp:2}
.dsh-nudge-annotation-note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-remove{flex:0 0 auto;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font-size:14px;line-height:1;cursor:pointer}
.dsh-nudge-annotation-remove:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-annotation-open{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.dsh-nudge-annotation-open .dsh-nudge-annotation-quote{-webkit-line-clamp:1}
.dsh-nudge-annotation-open .dsh-nudge-annotation-note{-webkit-line-clamp:1}
.dsh-nudge-annotation-open:hover .dsh-nudge-annotation-quote{color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-module{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-module-head{display:flex;align-items:center;gap:7px;padding:1px 0 8px;border:0;border-bottom:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.2px;cursor:pointer;text-align:left;user-select:none}
.dsh-nudge-module-head::before{content:'';flex:0 0 auto;width:3px;height:13px;border-radius:2px;background:var(--dn-accent)}
.dsh-nudge-module-head:hover{color:var(--dn-accent)}
.dsh-nudge-module-title{white-space:nowrap}
.dsh-nudge-module-chevron{font-size:11px;line-height:1;opacity:.7}
.dsh-nudge-module-body{display:flex;flex-direction:column;gap:10px;padding-top:2px}
.dsh-nudge-icon.active{background:var(--dn-accent-soft);color:var(--dn-accent)}
@keyframes dsh-nudge-attention{0%{box-shadow:inset 0 0 0 0 var(--dn-accent-line);opacity:0}20%{box-shadow:inset 0 0 0 3px var(--dn-accent-soft);opacity:1}100%{box-shadow:inset 0 0 0 0 transparent;opacity:0}}
.dsh-nudge-attention-ring{position:absolute;inset:0;border-radius:inherit;pointer-events:none;animation:dsh-nudge-attention .9s ease-out}
::highlight(dsh-nudge-notes){background:#fde68a;color:#1f2937}
/* Same colours as the browser's own selection on Chromium/Windows, because
   focusing the note field collapses the real selection before it can be kept.
   --dsh-nudge-capture-bg / -fg stay overridable for other platforms/themes. */
::highlight(dsh-nudge-capture){background:var(--dsh-nudge-capture-bg,#3367d1);color:var(--dsh-nudge-capture-fg,#fff)}
.dsh-nudge-pill{position:fixed;z-index:${Z_INDEX};display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 10px 26px -14px rgba(15,23,42,.3);font:600 12px/1 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;cursor:grab;pointer-events:auto;touch-action:none;user-select:none;transition:transform .15s ease,box-shadow .15s ease;animation:dsh-nudge-in .18s ease-out}
.dsh-nudge-pill:active{cursor:grabbing}
.dsh-nudge-pill:hover{transform:translateY(-1px);box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 30px -14px rgba(15,23,42,.35)}
.dsh-nudge-pill:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-unread{width:6px;height:6px;border-radius:50%;background:var(--dn-accent);flex:0 0 auto;box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-settings{display:flex;flex-direction:column;gap:14px;font:inherit;color:var(--dsw-alias-label-primary,#1a1a1a)}
/* The shell Settings panel caps the body at 800px and scrolls it. While this
   section is mounted, let the panel grow with the section instead (never
   smaller than the shell's own height, never taller than the viewport); the
   shell's internal options area still scrolls once that cap is reached. The
   :has() scope is what keeps the override from affecting other sections. */
body:has(.dsh-nudge-settings) [data-shortcut-modal="settings"]{height:auto;min-height:min(800px,calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px))));max-height:calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px)))}
.dsh-nudge-settings-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-toggle{display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent);cursor:pointer}
.dsh-nudge-toggle input{accent-color:var(--dn-accent);margin:2px 0 0;flex:0 0 auto;width:14px;height:14px}
.dsh-nudge-toggle-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-nudge-toggle-title{font-size:12px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-toggle-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-preset-row{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent)}
.dsh-nudge-preset-line{display:flex;align-items:center;gap:8px}
.dsh-nudge-preset-row input{flex:1 1 auto;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:0 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-row textarea{width:100%;box-sizing:border-box;min-height:56px;field-sizing:content;max-height:min(320px,40vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-row input:focus,.dsh-nudge-preset-row textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-preset-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-nudge-btn{height:30px;padding:0 12px;border:1px solid var(--dn-line);border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
.dsh-nudge-btn:hover{background:var(--dn-hover)}
.dsh-nudge-btn.primary{background:var(--dn-accent);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
.dsh-nudge-btn.primary:hover{filter:brightness(1.05);background:var(--dn-accent)}
.dsh-nudge-btn.danger{color:var(--dsw-alias-state-error-primary,#c8433c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 28%,transparent)}
.dsh-nudge-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent)}
.dsh-nudge-settings-error{color:var(--dsw-alias-state-error-primary,#c8433c);font-size:12px;line-height:1.5}
`.trim()

    /**
     * Build the React view over one runtime.
     * @param runtime - window runtime.
     * @returns the slot component.
     */
    function makeView(runtime) {
      const useSyncExternalStore =
        React.useSyncExternalStore ??
        function useSyncExternalStoreFallback(subscribe, getSnapshot) {
          const [value, setValue] = React.useState(getSnapshot)
          React.useEffect(() => {
            setValue(getSnapshot())
            return subscribe(() => setValue(getSnapshot()))
          }, [subscribe, getSnapshot])
          return value
        }

      return function NudgeWindow() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const drag = React.useRef(null)
        /** A drag that moved must not also toggle the pill. */
        const suppressPillClick = React.useRef(false)
        const noteInputRef = React.useRef(null)
        // Only the repository edit box takes the caret. The selection card never
        // steals focus from the transcript: the native selection stays intact.
        React.useEffect(() => {
          if (state.annotationEditingId === null) return
          const node = noteInputRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus()
            } catch {
              /* unfocusable */
            }
          }
        }, [state.annotationEditingId])
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()
        const draft = state.annotationDraft
        const popup =
          state.quick && draft !== null
            ? h(
                'div',
                {
                  key: 'popup',
                  className: 'dsh-nudge-popup',
                  style: runtime.popupPosition(),
                  role: 'dialog',
                  'aria-label': t('annotationsTitle'),
                },
                h('div', { className: 'dsh-nudge-popup-quote', title: draft.quote }, draft.quote),
                h('textarea', {
                  className: 'dsh-nudge-annotation-input',
                  value: state.annotationNote,
                  placeholder: t('annotationPlaceholder'),
                  'aria-label': t('annotationPlaceholder'),
                  onChange: (event) => {
                    runtime.setAnnotationNote(event.target.value)
                    runtime.restoreCaptureSelection()
                  },
                  onMouseUp: () => runtime.restoreCaptureSelection(),
                  onKeyUp: () => runtime.restoreCaptureSelection(),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      runtime.addAnnotation()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      runtime.dismissAnnotationDraft()
                    }
                  },
                }),
                h(
                  'div',
                  { className: 'dsh-nudge-annotation-actions' },
                  h('button', { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.quickReply('agree') }, t('agree')),
                  h('button', { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.quickReply('disagree') }, t('disagree')),
                  h('button', { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.copyDraftQuote() }, t('copyQuote')),
                ),
                h(
                  'div',
                  { className: 'dsh-nudge-annotation-actions' },
                  h('button', { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.dismissAnnotationDraft() }, t('dismissAnnotation')),
                  h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: () => runtime.addAnnotation() }, t('addAnnotation')),
                ),
              )
            : null

        const dotClass =
          state.phase === 'waiting' ? 'waiting' : state.phase === 'error' ? 'error' : state.phase === 'done' ? 'done' : ''
        const insertMode = state.composerFocused === true
        const turbo = state.turbo === true
        const attention = state.attentionAt > 0
        const statusLabel =
          state.phase === 'waiting'
            ? t('statusWaiting')
            : state.phase === 'error'
              ? t('statusError')
              : state.phase === 'done'
                ? t('statusDone')
                : t('statusIdle')
        const askLabel = insertMode
          ? t('insert')
          : state.phase === 'waiting'
            ? t('asking')
            : state.phase === 'done' || state.phase === 'error'
              ? t('again')
              : t('ask')
        const askTitle = insertMode ? t('insertHint') : t('askHint')
        /** Keep the caret where it is: clicks on the window must not steal focus. */
        const keepFocus = (event) => event.preventDefault()
        const chevron = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M4 6.5l4 3.5 4-3.5',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
        const gear = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M6.9 1.7h2.2l.4 1.5 1.3.5 1.3-.8 1.6 1.6-.8 1.3.5 1.3 1.5.4v2.2l-1.5.4-.5 1.3.8 1.3-1.6 1.6-1.3-.8-1.3.5-.4 1.5H6.9l-.4-1.5-1.3-.5-1.3.8-1.6-1.6.8-1.3-.5-1.3-1.5-.4V7.5l1.5-.4.5-1.3-.8-1.3 1.6-1.6 1.3.8 1.3-.5.4-1.5Z',
            stroke: 'currentColor',
            strokeWidth: 1.1,
            strokeLinejoin: 'round',
          }),
          h('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.1 }),
        )
        const quoteIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M3.2 3.6h6.2v4.8H6.2L3.2 11V3.6Z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M12.8 7.4v5h-3.2',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round',
          }),
        )

        if (state.collapsed) {
          return h(
            React.Fragment,
            null,
            h('style', { key: 'dsh-nudge-css' }, CSS),
            h(
              'button',
              {
                key: 'pill',
                type: 'button',
                className: 'dsh-nudge-pill',
                style: { left: `${state.pos.x}px`, top: `${state.pos.y}px` },
                title: t('expand'),
                'aria-label': t('expand'),
                onClick: onPillClick,
                onPointerDown: onPillPointerDown,
                onPointerMove: onPillPointerMove,
                onPointerUp: onPillPointerUp,
                onPointerCancel: onPillPointerUp,
              },
              h('span', { className: `dsh-nudge-dot ${dotClass}`, title: statusLabel }),
              h('span', null, t('title')),
              state.unread ? h('span', { className: 'dsh-nudge-unread', title: t('newResult') }) : null,
            ),
            popup,
          )
        }

        /** Start one pointer drag from the current anchor. */
        function beginDrag(event) {
          if (event.button !== 0) return
          // A previous drag may have ended outside the pill without a click;
          // never let that stale suppression swallow the next real click.
          suppressPillClick.current = false
          drag.current = {
            dx: event.clientX - state.pos.x,
            dy: event.clientY - state.pos.y,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
          }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }

        /** Move while dragging; a tiny movement stays a click. */
        function moveDrag(event) {
          const current = drag.current
          if (!current) return
          if (!current.moved) {
            const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
            if (distance > 3) current.moved = true
          }
          if (current.moved) runtime.moveTo(event.clientX - current.dx, event.clientY - current.dy)
        }

        /** Finish one drag, persisting only when the window really moved. */
        function endDrag() {
          const current = drag.current
          drag.current = null
          if (current && current.moved) runtime.saveUi()
        }

        function onPointerDown(event) {
          if (event.button !== 0) return
          if (typeof event.target?.closest === 'function' && event.target.closest('button')) return
          beginDrag(event)
          event.preventDefault()
        }

        function onPointerMove(event) {
          moveDrag(event)
        }

        /** A title-bar click (no movement) collapses the card in place. */
        function onPointerUp() {
          const current = drag.current
          endDrag()
          if (current && !current.moved) runtime.setCollapsed(true)
        }

        /** A cancelled pointer must never be treated as a click. */
        function onPointerCancel() {
          endDrag()
        }

        function onPillPointerDown(event) {
          beginDrag(event)
        }

        function onPillPointerMove(event) {
          moveDrag(event)
        }

        function onPillPointerUp() {
          const current = drag.current
          if (current && current.moved) suppressPillClick.current = true
          endDrag()
        }

        function onPillClick() {
          if (suppressPillClick.current) {
            suppressPillClick.current = false
            return
          }
          runtime.setCollapsed(false)
        }

        return h(
          React.Fragment,
          null,
          h(
          'div',
          {
            key: 'card',
            className: 'dsh-nudge-card',
            role: 'dialog',
            'aria-label': t('title'),
            style: { left: `${state.pos.x}px`, top: `${state.pos.y}px` },
          },
          h('style', { key: 'dsh-nudge-css' }, CSS),
          attention
            ? h('span', { key: `attention-${state.attentionAt}`, className: 'dsh-nudge-attention-ring', 'aria-hidden': true })
            : null,
          h(
            'div',
            {
              key: 'title',
              className: 'dsh-nudge-title',
              title: t('collapseHint'),
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel,
            },
            h('span', { className: `dsh-nudge-dot ${dotClass}`, title: statusLabel }),
            h('span', { className: 'dsh-nudge-name' }, t('title')),
            h('span', { className: 'dsh-nudge-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: `dsh-nudge-icon${state.quick ? ' active' : ''}`,
                title: state.quick ? t('quickOn') : t('quickOff'),
                'aria-label': state.quick ? t('quickOn') : t('quickOff'),
                'aria-pressed': state.quick ? 'true' : 'false',
                onClick: () => runtime.setQuick(!state.quick),
              },
              quoteIcon,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-icon',
                title: t('openSettings'),
                'aria-label': t('openSettings'),
                onClick: () => {
                  runtime.openSettings()
                },
              },
              gear,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-icon',
                title: t('collapse'),
                'aria-label': t('collapse'),
                onClick: () => runtime.setCollapsed(true),
              },
              chevron,
            ),
          ),
          state.error.length > 0
            ? h('div', { key: 'error', className: 'dsh-nudge-alert error' }, state.error)
            : null,
          state.note.length > 0
            ? h('div', { key: 'note', className: 'dsh-nudge-alert note' }, state.note)
            : null,
          h(
            'div',
            { key: 'content', className: 'dsh-nudge-content' },
            state.quick
              ? h(
                  'div',
                  { key: 'annotation-module', className: 'dsh-nudge-module' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-module-head',
                      title: state.annotationExpanded ? t('collapseAnnotations') : t('expandAnnotations'),
                      onClick: () => runtime.setAnnotationExpanded(!state.annotationExpanded),
                    },
                    h('span', { className: 'dsh-nudge-module-title' }, t('annotationsTitle')),
                    state.annotations.length > 0
                      ? h('span', { className: 'dsh-nudge-annotations-count' }, String(state.annotations.length))
                      : null,
                    h('span', { className: 'dsh-nudge-spacer' }),
                    h('span', { className: 'dsh-nudge-module-chevron' }, state.annotationExpanded ? '⌃' : '⌄'),
                  ),
                  state.annotationExpanded
                    ? h(
                        'div',
                        { className: 'dsh-nudge-module-body' },
                        state.annotationEditingId !== null
                          ? h(
                              'div',
                              { key: 'annotation-compose', className: 'dsh-nudge-annotation-compose' },
                              h(
                                'div',
                                { className: 'dsh-nudge-annotation-quote' },
                                state.annotations.find((item) => item.id === state.annotationEditingId)?.quote ?? '',
                              ),
                              h('textarea', {
                                className: 'dsh-nudge-annotation-input',
                                ref: noteInputRef,
                                value: state.annotationNote,
                                placeholder: t('annotationPlaceholder'),
                                'aria-label': t('annotationPlaceholder'),
                                onChange: (event) => runtime.setAnnotationNote(event.target.value),
                                onKeyDown: (event) => {
                                  if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    runtime.saveEditedAnnotation()
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    runtime.cancelAnnotationEdit()
                                  }
                                },
                              }),
                              h(
                                'div',
                                { className: 'dsh-nudge-annotation-actions' },
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'dsh-nudge-btn danger',
                                    onClick: () => runtime.removeAnnotation(state.annotationEditingId),
                                  },
                                  t('deleteAnnotation'),
                                ),
                                h(
                                  'button',
                                  { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.cancelAnnotationEdit() },
                                  t('dismissAnnotation'),
                                ),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'dsh-nudge-btn primary',
                                    onClick: () => runtime.saveEditedAnnotation(),
                                  },
                                  t('saveAnnotation'),
                                ),
                              ),
                            )
                          : state.annotations.length === 0
                            ? h(
                                'div',
                                { key: 'annotation-empty', className: 'dsh-nudge-annotation-hint' },
                                t('annotationsHint'),
                              )
                            : null,
                        state.annotations.length > 0
                          ? h(
                              'div',
                              { key: 'annotation-list', className: 'dsh-nudge-annotation-list' },
                              ...state.annotations.map((item) =>
                                h(
                                  'div',
                                  { key: item.id, className: 'dsh-nudge-annotation-item' },
                                  h(
                                    'div',
                                    { className: 'dsh-nudge-annotation-item-head' },
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'dsh-nudge-annotation-open',
                                        onClick: () => runtime.startEditAnnotation(item.id),
                                      },
                                      h('span', { className: 'dsh-nudge-annotation-quote', title: item.quote }, item.quote),
                                      item.note !== ''
                                        ? h('span', { className: 'dsh-nudge-annotation-note' }, item.note)
                                        : null,
                                    ),
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'dsh-nudge-annotation-remove',
                                        title: t('deleteAnnotation'),
                                        'aria-label': t('deleteAnnotation'),
                                        onClick: () => runtime.removeAnnotation(item.id),
                                      },
                                      '×',
                                    ),
                                  ),
                                ),
                              ),
                            )
                          : null,
                        state.annotations.length > 0
                          ? h(
                              'div',
                              { key: 'annotation-actions', className: 'dsh-nudge-annotation-actions' },
                              h('button', { type: 'button', className: 'dsh-nudge-btn', onClick: () => runtime.writeAnnotations() }, t('writeAnnotations')),
                              h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: () => runtime.sendAnnotations() }, t('sendAnnotations')),
                            )
                          : null,
                      )
                    : null,
                )
              : null,
            h(
              'div',
              { key: 'nudge-module', className: 'dsh-nudge-module' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-module-head',
                  title: state.nudgeExpanded ? t('collapseNudge') : t('expandNudge'),
                  onClick: () => runtime.setNudgeExpanded(!state.nudgeExpanded),
                },
                h('span', { className: 'dsh-nudge-module-title' }, t('nudgeModule')),
                h('span', { className: 'dsh-nudge-spacer' }),
                h('span', { className: 'dsh-nudge-module-chevron' }, state.nudgeExpanded ? '⌃' : '⌄'),
              ),
              state.nudgeExpanded
                ? h(
                    'div',
                    { className: 'dsh-nudge-module-body' },
            h(
              'div',
              { key: 'presets', className: 'dsh-nudge-field' },
              h(
                'div',
                { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('preset') },
                ...state.presets.map((preset) =>
                  h(
                    'button',
                    {
                      key: preset.id,
                      type: 'button',
                      className: `dsh-nudge-chip${state.presetId === preset.id ? ' active' : ''}`,
                      title: turbo
                        ? `${preset.text}\n${insertMode ? t('turboInsertHint') : t('turboAskHint')}`
                        : preset.text,
                      onMouseDown: keepFocus,
                      onPointerDown: keepFocus,
                      onClick: () => runtime.setPreset(preset.id),
                      onDoubleClick: turbo
                        ? () => {
                            runtime.setPreset(preset.id)
                            runtime.ask()
                          }
                        : undefined,
                    },
                    preset.label,
                  ),
                ),
              ),
            ),
            h(
              'div',
              { key: 'mode', className: 'dsh-nudge-field dsh-nudge-field-inline' },
              h('div', { className: 'dsh-nudge-field-label' }, t('mode')),
              h(
                'div',
                {
                  className: `dsh-nudge-mode${insertMode ? ' inactive' : ''}`,
                  role: 'group',
                  'aria-label': t('mode'),
                  'aria-disabled': insertMode ? 'true' : undefined,
                  title: insertMode
                    ? t('modeInactive')
                    : state.pendingQuestion
                      ? t('waitingQuestion')
                      : t('settings'),
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: delivery === 'steer' ? 'active' : '',
                    title: t('steerHint'),
                    disabled: insertMode,
                    onClick: () => runtime.setDelivery('steer'),
                  },
                  t('steer'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: delivery === 'followup' ? 'active' : '',
                    title: t('queueHint'),
                    disabled: insertMode,
                    onClick: () => runtime.setDelivery('followup'),
                  },
                  t('queue'),
                ),
              ),
            ),
            turbo
              ? h(
                  'div',
                  {
                    key: 'turbo',
                    className: 'dsh-nudge-turbo-hint',
                    title: t('turboDesc'),
                  },
                  insertMode ? t('turboInsertHint') : t('turboAskHint'),
                )
              : h(
                  'button',
                  {
                    key: 'ask',
                    type: 'button',
                    className: `dsh-nudge-ask${insertMode ? ' insert' : ''}`,
                    title: askTitle,
                    'aria-label': askTitle,
                    disabled: !insertMode && state.phase === 'waiting',
                    onMouseDown: keepFocus,
                    onPointerDown: keepFocus,
                    onClick: () => {
                      runtime.ask()
                    },
                  },
                  askLabel,
                ),
                  )
                : null,
            ),
          ),
          popup,
        ),
        )
      }
    }

    // ---------------------------------------------------------------------
    // settings view
    // ---------------------------------------------------------------------

    /**
     * Build the plugin's settings section: edit, add, delete and reset the probe
     * presets. This is the only place a preset is authored; the floating window
     * is just a flat picker over the same list.
     * @param runtime - the window runtime (same store the window reads).
     * @returns the settings-slot component.
     */
    function makeSettingsView(runtime) {
      const useSyncExternalStore =
        React.useSyncExternalStore ??
        function useSyncExternalStoreFallback(subscribe, getSnapshot) {
          const [value, setValue] = React.useState(getSnapshot)
          React.useEffect(() => {
            setValue(getSnapshot())
            return subscribe(() => setValue(getSnapshot()))
          }, [subscribe, getSnapshot])
          return value
        }

      function PresetRow(props) {
        const { preset, t, onError } = props
        const [label, setLabel] = React.useState(preset.label)
        const [text, setText] = React.useState(preset.text)
        React.useEffect(() => {
          setLabel(preset.label)
          setText(preset.text)
        }, [preset.id, preset.label, preset.text])

        function commit() {
          const result = runtime.updatePreset(preset.id, { label, text })
          onError(result.ok ? '' : result.error)
        }

        return h(
          'div',
          { className: 'dsh-nudge-preset-row' },
          h(
            'div',
            { className: 'dsh-nudge-preset-line' },
            h('input', {
              type: 'text',
              value: label,
              placeholder: t('presetLabel'),
              'aria-label': t('presetLabel'),
              onChange: (event) => setLabel(event.target.value),
              onBlur: commit,
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn danger',
                onClick: () => {
                  if (runtime.removePreset(preset.id)) onError('')
                  else onError(t('presetLast'))
                },
              },
              t('deletePreset'),
            ),
          ),
          h('textarea', {
            value: text,
            placeholder: t('presetText'),
            'aria-label': t('presetText'),
            onChange: (event) => setText(event.target.value),
            onBlur: commit,
          }),
        )
      }

      return function NudgeSettings() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const [error, setError] = React.useState('')
        const [draftLabel, setDraftLabel] = React.useState('')
        const [draftText, setDraftText] = React.useState('')
        const t = runtime.text

        function add() {
          const result = runtime.addPreset(draftLabel, draftText)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setDraftLabel('')
          setDraftText('')
          setError('')
        }

        return h(
          'div',
          { className: 'dsh-nudge-settings' },
          h('style', { key: 'dsh-nudge-css' }, CSS),
          h(
            'label',
            { className: 'dsh-nudge-toggle', title: t('turboDesc') },
            h('input', {
              type: 'checkbox',
              checked: state.turbo === true,
              onChange: (event) => runtime.setTurbo(event.target.checked),
            }),
            h(
              'span',
              { className: 'dsh-nudge-toggle-text' },
              h('span', { className: 'dsh-nudge-toggle-title' }, t('turboTitle')),
              h('span', { className: 'dsh-nudge-toggle-desc' }, t('turboDesc')),
            ),
          ),
          h('div', { className: 'dsh-nudge-settings-hint' }, t('presetsHint')),
          ...state.presets.map((preset) =>
            h(PresetRow, { key: preset.id, preset, t, onError: setError }),
          ),
          h(
            'div',
            { className: 'dsh-nudge-preset-row' },
            h(
              'div',
              { className: 'dsh-nudge-preset-line' },
              h('input', {
                type: 'text',
                value: draftLabel,
                placeholder: t('presetLabel'),
                'aria-label': t('presetLabel'),
                onChange: (event) => setDraftLabel(event.target.value),
              }),
            ),
            h('textarea', {
              value: draftText,
              placeholder: t('presetText'),
              'aria-label': t('presetText'),
              onChange: (event) => setDraftText(event.target.value),
            }),
            h(
              'div',
              { className: 'dsh-nudge-preset-actions' },
              h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: add }, t('addPreset')),
            ),
          ),
          h(
            'div',
            { className: 'dsh-nudge-preset-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn',
                onClick: () => {
                  runtime.resetPresets()
                  setError('')
                },
              },
              t('resetPresets'),
            ),
          ),
          error.length > 0 ? h('div', { className: 'dsh-nudge-settings-error' }, error) : null,
        )
      }
    }

    // ---------------------------------------------------------------------
    // composer bridge
    // ---------------------------------------------------------------------

    /**
     * Zero-DOM registrant in the conversation input overlay. The slot composes
     * the composer's public action face (`inputActions`) and the input store
     * hook (`useInput`) into the entry's props; this bridge hands both to the
     * window runtime so the same button can append the chosen prompt instead
     * of sending it. The editor DOM is never touched.
     * @param runtime - the window runtime.
     * @returns the slot component.
     */
    function makeComposerBridge(runtime) {
      return function NudgeComposerBridge(props) {
        const inputActions = props?.inputActions
        const useInput = props?.useInput
        const latest = React.useRef(undefined)
        if (typeof useInput === 'function') {
          latest.current = useInput((snapshot) => snapshot)
        }
        const handle = React.useRef(undefined)
        if (handle.current === undefined) {
          handle.current = {
            setDraft:
              typeof inputActions?.setDraft === 'function'
                ? (value) => inputActions.setDraft(value)
                : undefined,
            readDraft: () => latest.current?.draft ?? '',
          }
        }
        // Render only stores the handle (no store update, so React never sees
        // a cross-component update during render); the effect activates it and
        // refreshes the focus flag, and releases it on unmount.
        runtime.attachComposer(handle.current, false)
        React.useEffect(() => {
          const current = handle.current
          runtime.attachComposer(current)
          return () => runtime.detachComposer(current)
        }, [inputActions])
        return null
      }
    }

    // ---------------------------------------------------------------------
    // module
    // ---------------------------------------------------------------------

    const name = ENTRY
    const inject = ['slots', 'sessions', 'uiSession', 'remote', 'locale', 'shortcuts']

    /**
     * Mount the Client half.
     * @param ctx - Client plugin context.
     */
    function apply(ctx) {
      const runtime = createRuntime(ctx)

      // Locale dictionaries ride the Client locale service; the visible language
      // is read from its snapshot (browser language before the service answers).
      try {
        const locale = ctx.get?.('locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register('dsh-nudge', { zh: ZH, en: EN }), 'dsh-nudge: locale')
        }
      } catch (error) {
        console.warn('[dsh-nudge] locale registration failed', error)
      }

      const View = makeView(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register({ name: SLOT, id: ENTRY, order: 40 }, View),
          ),
        'dsh-nudge: overlay',
      )

      // Editing/adding presets lives in Settings, not in the floating window.
      const SettingsView = makeSettingsView(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(SETTINGS_SLOT, () =>
            ctx.slots.register(
              {
                name: SETTINGS_SLOT,
                id: ENTRY,
                order: 60,
                label: () => runtime.text('settingsTitle'),
              },
              SettingsView,
            ),
          ),
        'dsh-nudge: settings',
      )

      // The window cannot reach the composer from its overlay slot; a zero-DOM
      // registrant in the input overlay hands the composer's public action face
      // to the runtime (write into the draft instead of sending).
      const ComposerBridge = makeComposerBridge(runtime)
      ctx.effect(
        () =>
          ctx.slots.inject(COMPOSER_SLOT, () =>
            ctx.slots.register({ name: COMPOSER_SLOT, id: ENTRY, order: 70 }, ComposerBridge),
          ),
        'dsh-nudge: composer bridge',
      )

      // Debug/test handle: scripts/check-client.mjs drives this without a renderer.
      window.__dshNudge = runtime
      ctx.effect(
        () => () => {
          runtime.dispose()
          if (window.__dshNudge === runtime) delete window.__dshNudge
        },
        'dsh-nudge: teardown',
      )
    }

    return { name, inject, apply }
  },
})
