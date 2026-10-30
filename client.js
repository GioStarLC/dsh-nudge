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
    /** How often a settings open route is checked for the panel it asked for. */
    const SETTINGS_POLL_MS = 50
    /** How long one open route gets to paint the panel before the next runs. */
    const SETTINGS_ROUTE_MS = 600
    /** Extra time the painted panel gets to render its nav rows. */
    const SETTINGS_SECTION_MS = 1000
    const ENTRY = 'dsh-nudge'
    const UI_KEY = 'dsh-nudge:ui'
    const DELIVERY_KEY = 'dsh-nudge:delivery'
    const TURBO_KEY = 'dsh-nudge:turbo'
    const QUICK_KEY = 'dsh-nudge:quick'
    const AUTOPASTE_KEY = 'dsh-nudge:autopaste'
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
    /**
     * Loopback route the Host half serves its durable settings record on. It
     * exists because `localStorage` is scoped to one origin and the web GUI
     * picks a fresh loopback port on every launch: without a copy outside the
     * page, a restart looks like a first run and drops the settings.
     */
    const STORE_ROUTE = '/dsh-nudge/store'
    /** Shape version of the durable settings record the Host half keeps. */
    const STORE_VERSION = 1
    /** How long a burst of setting edits settles before one Host write, in ms. */
    const STORE_SYNC_MS = 300

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
    /**
     * Lines the status row shows while nothing is happening. It is a plain
     * list of strings; one is shown at a time and the list rotates.
     */
    const TIPS_KEY = 'dsh-nudge:tips'
    /** Upper bound on those lines, so the settings section stays scrollable. */
    const MAX_TIPS = 20
    /** Built-in idle lines; the settings section can edit, add and reset them. */
    const BUILTIN_TIPS = [
      {
        zh: '选中对话里的文字，就能加一条批注。',
        en: 'Select text in the conversation to leave a note.',
      },
      {
        zh: '开关切换的提示会在这行停 5 秒，然后继续轮换。',
        en: 'A switch message holds here for 5 seconds, then the rotation resumes.',
      },
      {
        zh: '急速模式下双击口径，可以直接执行。',
        en: 'In turbo mode, double-click a prompt to run it straight away.',
      },
    ]
    /** How long a change message holds before the idle line returns, in ms. */
    const FLASH_HOLD_MS = 5000
    /** How long a line stays up before the next one takes over, in ms. */
    const TIP_ROTATE_MS = FLASH_HOLD_MS
    /** Cap on one idle line, in characters; keeps the status row one line tall. */
    const MAX_TIP_LENGTH = 60

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
      switchOn: '开',
      switchOff: '关',
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
      quickTitle: '快速批注',
      quickHint: '开启后选中对话文字即刻弹出批注卡片；关闭时用标题栏的「+」手动捕获选区。',
      autoPasteTitle: '自动粘贴批注',
      autoPasteDesc: '点选输入框时，把当前待发送的批注自动写入输入框。',
      autoPasteOn: '自动粘贴：开',
      autoPasteOff: '自动粘贴：关',
      copyHint: '复制选中的原文',
      deliveryTitle: '投递方式',
      deliveryDesc: '「直接打断」中止当前回答立刻处理；「排队」等这一轮结束后再处理。',
      sortUp: '上移',
      sortDown: '下移',
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
      copiedShort: '已复制',
      copyFailedShort: '复制失败',
      saveAnnotation: '保存',
      asking: '等待回答…',
      again: '再问一次',
      collapse: '收起',
      collapseHint: '拖动可移动',
      foldHint: '点击收起为胶囊',
      expand: '展开 dsh-nudge 窗口',
      statusIdle: '未询问',
      statusWaiting: '等待中',
      statusDone: '已返回',
      statusError: '失败',
      mode: '方式',
      queue: '排队',
      steer: '直接打断',
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
      tipsTitle: '状态行文案',
      tipsHint: '空闲时这行轮换显示下面的文案；切换开关的提示会停 5 秒，再继续轮换。',
      tipsEmpty: '还没有文案。',
      tipsPlaceholder: '一句闲时提示',
      tipsPastePlaceholder: '整段粘贴会自动拆成一句一句；也可以手写，一行一句（Ctrl+Enter 提交）',
      tipsAdded: '已添加 {n} 句',
      tipsSkipped: '跳过 {n} 行空行、重复或超上限的行',
      addTip: '添加',
      resetTips: '恢复默认',
      deleteTip: '删除',
      tipLimit: '最多 20 句，先删一句再新增。',
      tipTextRequired: '文案不能为空。',
      tipLast: '至少保留一句。',
      settingsTitle: '状态询问',
      settingsHead: '设置',
      back: '返回',
      openSettings: '打开设置',
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
      switchOn: 'on',
      switchOff: 'off',
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
      quickTitle: 'Quick notes',
      quickHint: 'When on, selecting text in the conversation opens a note card right away; when off, use the + in the title bar to capture the selection.',
      autoPasteTitle: 'Auto-paste notes',
      autoPasteDesc: 'When you click into the input box, write the pending notes into it automatically.',
      autoPasteOn: 'Auto-paste: on',
      autoPasteOff: 'Auto-paste: off',
      copyHint: 'copy this passage',
      deliveryTitle: 'Delivery mode',
      deliveryDesc: 'Interrupt stops the current answer and handles this right away; Queue waits for the running turn to finish.',
      sortUp: 'Move up',
      sortDown: 'Move down',
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
      copiedShort: 'Copied',
      copyFailedShort: 'Copy failed',
      saveAnnotation: 'Save',
      asking: 'Waiting…',
      again: 'Ask again',
      collapse: 'Collapse',
      collapseHint: 'Drag to move',
      foldHint: 'Click to fold into the pill',
      expand: 'Expand the dsh-nudge window',
      statusIdle: 'Not asked',
      statusWaiting: 'Waiting',
      statusDone: 'Answered',
      statusError: 'Failed',
      mode: 'Mode',
      queue: 'Queue',
      steer: 'Interrupt',
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
      tipsTitle: 'Status lines',
      tipsHint: 'While idle this row rotates the lines below; a switch message holds here for 5 seconds, then the rotation resumes.',
      tipsEmpty: 'No lines yet.',
      tipsPlaceholder: 'One idle line',
      tipsPastePlaceholder: 'Paste a whole list and it is split per line; or type one line each (Ctrl+Enter adds them)',
      tipsAdded: 'Added {n} lines',
      tipsSkipped: 'skipped {n} blank, duplicate or over-limit lines',
      addTip: 'Add',
      resetTips: 'Reset defaults',
      deleteTip: 'Delete',
      tipLimit: 'At most 20 lines; delete one first.',
      tipTextRequired: 'The line cannot be empty.',
      tipLast: 'Keep at least one line.',
      settingsTitle: 'Status Nudge',
      settingsHead: 'Settings',
      back: 'Back',
      openSettings: 'Open settings',
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
            scheduleStoreSync()
          },
          removeItem: (key) => {
            raw.removeItem(key)
            scheduleStoreSync()
          },
        }
        return storageFacade
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

    /** The settings, in the shape the Host half keeps them. */
    function settingsSnapshot() {
      const store = storage()
      if (store === undefined) return undefined
      const snapshot = { version: STORE_VERSION }
      const ui = readJson(UI_KEY)
      if (ui !== undefined) snapshot.ui = ui
      const delivery = store.getItem(DELIVERY_KEY)
      if (isDelivery(delivery)) snapshot.delivery = delivery
      if (store.getItem(TURBO_KEY) === '1') snapshot.turbo = true
      if (store.getItem(QUICK_KEY) === '1') snapshot.quick = true
      if (store.getItem(AUTOPASTE_KEY) === '1') snapshot.autoPaste = true
      const preset = store.getItem(PRESET_KEY)
      if (typeof preset === 'string' && preset !== '') snapshot.preset = preset
      const presets = readJson(PRESETS_KEY)
      if (presets !== undefined) snapshot.presets = presets
      const tips = readJson(TIPS_KEY)
      if (Array.isArray(tips)) snapshot.tips = tips
      const notes = readJson(NOTES_KEY)
      if (notes !== undefined) snapshot.notes = notes
      return snapshot
    }

    /** Whether a snapshot carries any setting at all (the version always counts). */
    function hasStoredSettings(snapshot) {
      return snapshot !== undefined && snapshot !== null && Object.keys(snapshot).length > 1
    }

    /**
     * Write a Host-supplied record into the page storage.
     * @returns true when at least one known key was adopted.
     */
    function applySettingsStore(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      const store = storage()
      if (store === undefined) return false
      try {
        if (value.ui !== null && typeof value.ui === 'object' && !Array.isArray(value.ui)) {
          store.setItem(UI_KEY, JSON.stringify(value.ui))
        }
        // The stored shape says "queue" (how it reads in the UI); the state
        // machine only knows `followup`. Normalise so an old record still lands.
        if (value.delivery === 'queue') store.setItem(DELIVERY_KEY, 'followup')
        else if (isDelivery(value.delivery)) store.setItem(DELIVERY_KEY, value.delivery)
        if (value.turbo === true) store.setItem(TURBO_KEY, '1')
        if (value.quick === true) store.setItem(QUICK_KEY, '1')
        if (value.autoPaste === true) store.setItem(AUTOPASTE_KEY, '1')
        if (typeof value.preset === 'string' && value.preset !== '') store.setItem(PRESET_KEY, value.preset)
        if (Array.isArray(value.presets)) store.setItem(PRESETS_KEY, JSON.stringify(value.presets))
        if (Array.isArray(value.tips)) store.setItem(TIPS_KEY, JSON.stringify(value.tips))
        if (value.notes !== null && typeof value.notes === 'object' && !Array.isArray(value.notes)) {
          store.setItem(NOTES_KEY, JSON.stringify(value.notes))
        }
        return true
      } catch {
        return false
      }
    }

    let storeSyncTimer

    /** Mirror the settings to the Host half once a burst of edits settles. */
    function scheduleStoreSync() {
      if (typeof fetch !== 'function') return
      try {
        if (storeSyncTimer !== undefined) clearTimeout(storeSyncTimer)
      } catch {
        /* no timers */
      }
      try {
        storeSyncTimer = setTimeout(commitSettingsToHost, STORE_SYNC_MS)
      } catch {
        storeSyncTimer = undefined
      }
    }

    /** Drop a pending settings mirror; used when the window unmounts. */
    function cancelStoreSync() {
      try {
        if (storeSyncTimer !== undefined) clearTimeout(storeSyncTimer)
      } catch {
        /* no timers */
      }
      storeSyncTimer = undefined
    }

    /** Send the current settings to the Host half; a missing Host half is fine. */    function commitSettingsToHost() {
      storeSyncTimer = undefined
      const snapshot = settingsSnapshot()
      if (snapshot === undefined || typeof fetch !== 'function') return
      try {
        Promise.resolve(
          fetch(STORE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ store: snapshot }),
          }),
        ).catch(() => {})
      } catch {
        /* preview page or check harness: nothing to sync to */
      }
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

    /** The first non-empty string among a stored preset's text aliases. */
    function presetTextOf(item) {
      for (const key of ['text', 'body', 'content', 'prompt']) {
        const value = item[key]
        if (typeof value === 'string' && value.trim() !== '') return value.trim()
      }
      return ''
    }

    /** Normalize one stored/edited preset list; invalid entries are dropped. */
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
        list.push({ id, label: rawLabel.length > 0 ? rawLabel : text.slice(0, 8), text })
        if (list.length >= MAX_PRESETS) break
      }
      if (list.length === 0) {
        console.warn('[dsh-nudge] 口径列表为空或全部非法，回退内置口径')
        return builtinPresets(lang)
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
      if (!Array.isArray(stored)) writePresets(list)
      return list
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

    /** Read the auto-paste switch: notes flow into the composer on focus. */
    function readAutoPaste() {
      try {
        return storage()?.getItem(AUTOPASTE_KEY) === '1'
      } catch {
        return false
      }
    }

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

    /** Persist the idle lines. */
    function writeTips(tips) {
      writeJson(TIPS_KEY, tips)
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
        /** Short-lived confirmation of a toggle, cleared on a timer. */
        flash: '',
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
        /** Auto-paste switch: pending notes flow into the composer on focus. */
        autoPaste: readAutoPaste(),
        /** Idle lines for the status row, and which one is showing. */
        tips: readTips(language),
        tipIndex: 0,
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
        /** Whether the window shows the settings form in place of its body. */
        settingsOpen: false,
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
        if (focused === state.composerFocused) return
        setState({ composerFocused: focused })
        // Auto-paste: the moment the caret lands in the composer, hand the
        // pending notes over and empty the tray. A failed write keeps them.
        if (focused && state.autoPaste === true && state.annotations.length > 0) {
          writeAnnotations()
        }
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
      let flashTimer
      let repaintTimer
      let highlightObserver
      /** Ranges painted for the current notes, used to hit-test clicks. */
      let highlighted = []
      /** True while a pointer gesture is down, so no card opens mid-drag. */
      let pointerHeld = false

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
       * The pointer's own position is kept so the card can open right at the cursor.
       */
      function captureSelectionLater(event) {
        if (state.quick !== true) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        const pointer =
          event && typeof event.clientX === 'number' && typeof event.clientY === 'number'
            ? { x: event.clientX, y: event.clientY }
            : null
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined
          captureSelection(pointer)
        }, 200)
      }

      /** Keyboard selections end on a shifted keyup. */
      function onSelectionKeyup(event) {
        if (state.quick === true && event?.shiftKey === true) captureSelectionLater()
      }

      /**
       * A card must never open while the button is still down: dragging a
       * selection keeps firing `selectionchange`, and opening then would steal
       * the focus (and the caret) in the middle of the gesture. The pointer
       * path and the safety net both wait for the release.
       */
      function onPointerGestureDown() {
        pointerHeld = true
        cancelPendingCapture()
      }

      function onPointerGestureUp() {
        pointerHeld = false
      }

      /**
       * Safety net for a settled selection that never reaches the pointer path:
       * a drag that ends outside the transcript, a double-click on a boundary,
       * or a second selection whose mouseup was swallowed by a re-render. It
       * shares the debounce timer, so the pointer path always wins, and
       * `captureSelection` itself refuses the quote that is already captured.
       */
      function onSelectionChange() {
        if (state.quick !== true) return
        if (pointerHeld) return
        if (selectionTimer !== undefined) clearTimeout(selectionTimer)
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined
          captureSelection()
        }, 260)
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

      /**
       * Show one short confirmation line after a toggle, so a icon-only button
       * still says in words what it just switched to.
       */
      function notify(message) {
        const line = typeof message === 'string' ? message : ''
        if (line === '') return false
        setState({ flash: line })
        if (flashTimer !== undefined) clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
          flashTimer = undefined
          setState({ flash: '' })
        }, FLASH_HOLD_MS)
        return true
      }

      /** Turn the current selection into the pending annotation draft. */
      function captureSelection(pointer = null) {
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
            pointer,
          },
          annotationNote: '',
          annotationEditingId: null,
          note: '',
          error: '',
        })
        repaintHighlights()
        return true
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
        notify(next ? text('quickOn') : text('quickOff'))
        return true
      }

      /** Auto-paste switch: when on, pending notes flow into the composer on focus. */
      function setAutoPaste(value) {
        const next = value === true
        try {
          if (next) storage()?.setItem(AUTOPASTE_KEY, '1')
          else storage()?.removeItem(AUTOPASTE_KEY)
        } catch {
          /* best effort */
        }
        setState({ autoPaste: next })
        notify(next ? text('autoPasteOn') : text('autoPasteOff'))
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
          // A note just landed: open the tray so the count and the actions are
          // visible without a second click (the compose box stays expanded).
          annotationExpanded: true,
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

      /**
       * Copy the captured passage. Resolves to whether the clipboard took it;
       * the card reports that in place, the way ds-popup's copy button does.
       */
      function copyDraftQuote() {
        const quote = state.annotationDraft?.quote
        if (typeof quote !== 'string' || quote === '') return Promise.resolve(false)
        try {
          const clipboard = navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') return Promise.resolve(false)
          return Promise.resolve(clipboard.writeText(quote)).then(
            () => true,
            () => false,
          )
        } catch {
          return Promise.resolve(false)
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

      /**
       * Viewport box for the selection card: pinned to the pointer that finished
       * the selection, opened below-right of it when there is room and flipped to
       * the other side when the viewport edge is near. Without a pointer (keyboard
       * selection) it falls back to the quote box, centred above/below it.
       */
      function popupPosition() {
        const draft = state.annotationDraft
        const width = 340
        const margin = 8
        const gap = 10
        const offset = 12
        const approxHeight = 280
        const vw = viewport().width
        const vh = viewport().height
        const boxWidth = Math.min(width, vw - margin * 2)
        const rect = draft?.rect ?? null
        const pointer = draft?.pointer ?? null
        const clampX = (value) => Math.max(margin, Math.min(value, vw - boxWidth - margin))
        if (pointer) {
          const { x, y } = pointer
          const left = clampX(x + offset)
          const flipLeft = x + offset + boxWidth > vw - margin
          const top = y + offset
          if (top + approxHeight <= vh - margin) {
            return { left: `${Math.round(flipLeft ? clampX(x - offset - boxWidth) : left)}px`, top: `${Math.round(top)}px`, transform: 'none' }
          }
          // Not enough room below: open above the cursor instead.
          const aboveTop = Math.max(margin, y - offset)
          return {
            left: `${Math.round(flipLeft ? clampX(x - offset - boxWidth) : left)}px`,
            top: `${Math.round(aboveTop)}px`,
            transform: 'translateY(-100%)',
          }
        }
        if (!rect) {
          return {
            left: `${Math.max(margin, vw - boxWidth - margin)}px`,
            top: '96px',
            transform: 'none',
          }
        }
        const left = clampX(rect.left + rect.width / 2 - boxWidth / 2)
        if (rect.top - gap - approxHeight >= margin) {
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(rect.top - gap)}px`,
            transform: 'translateY(-100%)',
          }
        }
        const below = rect.bottom + gap
        const top = Math.min(below, Math.max(margin, vh - approxHeight - margin))
        return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, transform: 'none' }
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

      /**
       * True when the focused node is one of our own text fields and it holds a
       * real (non-empty) text selection: there the browser's own copy wins.
       */
      function fieldHasSelection() {
        try {
          const active = document.activeElement
          if (!active || typeof active.selectionStart !== 'number') return false
          if (typeof active.closest !== 'function' || active.closest(SELF_SELECTOR) === null) return false
          return active.selectionStart !== active.selectionEnd
        } catch {
          return false
        }
      }

      /** Ctrl/Cmd+C while a card is open, with no selection inside our fields. */
      function copyShortcutActive(event) {
        if (state.annotationDraft === null) return false
        if (event.ctrlKey !== true && event.metaKey !== true) return false
        if (event.altKey === true || event.shiftKey === true) return false
        return typeof event.key === 'string' && event.key.toLowerCase() === 'c'
      }

      function onPopupKeydown(event) {
        if (event?.key === 'Escape' && state.settingsOpen) {
          event.preventDefault()
          closeSettings()
          return
        }
        if (event?.key === 'Escape' && state.annotationDraft !== null) {
          event.preventDefault()
          closePopup()
          return
        }
        if (!copyShortcutActive(event)) return
        if (fieldHasSelection()) return
        // Focusing the note field drops the editor's native selection, so the
        // browser has nothing left to copy. The card owns the passage: copy it
        // ourselves and keep Ctrl+C working, which is the point of the card.
        event.preventDefault()
        copyDraftQuote().then((ok) => notify(ok ? text('copiedShort') : text('copyFailedShort')))
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
        notify(`${text('mode')}：${value === 'steer' ? text('steer') : text('queue')}`)
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
        notify(`${text('turboTitle')}：${next ? text('switchOn') : text('switchOff')}`)
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

      /** Move one preset one slot up (`delta` -1) or down (+1); order persists. */
      function movePreset(id, delta) {
        const from = state.presets.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const step = delta < 0 ? -1 : 1
        const to = from + step
        if (to < 0 || to >= state.presets.length) return false
        const next = [...state.presets]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        commitPresets(next, state.presetId)
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

      // --- idle lines ------------------------------------------------------

      /** Commit one idle-line list: storage, state, Host mirror, back to the first line. */
      function commitTips(list) {
        const next = normalizeTipList(list, state.lang)
        writeTips(next)
        setState({ tips: next, tipIndex: 0 })
        scheduleStoreSync()
        return next
      }

      /** Replace the line at `index`; a blank line is refused. */
      function updateTip(index, value) {
        if (index < 0 || index >= state.tips.length) return false
        const line = tidyTip(value)
        if (line === '') return false
        const next = [...state.tips]
        next[index] = line
        commitTips(next)
        return true
      }

      /** Append one idle line; the list is capped. */
      function addTip(value) {
        const line = tidyTip(value)
        if (line === '') return { ok: false, error: text('tipTextRequired') }
        if (state.tips.length >= MAX_TIPS) return { ok: false, error: text('tipLimit') }
        const next = commitTips([...state.tips, line])
        return { ok: true, index: Math.max(0, next.indexOf(line)) }
      }

      /**
       * Append pasted text as separate lines: every line break starts a new
       * idle line, so a whole list can be pasted at once. Blank lines,
       * duplicates and overflow past MAX_TIPS are dropped.
       */
      function addTips(raw) {
        if (typeof raw !== 'string') return { ok: false, added: 0, skipped: 0, error: text('tipTextRequired') }
        const lines = []
        for (const part of raw.split(/\r\n|\r|\n/)) {
          const line = tidyTip(part)
          if (line !== '') lines.push(line)
        }
        const incoming = []
        for (const line of lines) {
          if (state.tips.includes(line) || incoming.includes(line)) continue
          incoming.push(line)
        }
        if (incoming.length === 0) {
          return { ok: false, added: 0, skipped: lines.length, error: text('tipTextRequired') }
        }
        const room = MAX_TIPS - state.tips.length
        if (room <= 0) return { ok: false, added: 0, skipped: lines.length, error: text('tipLimit') }
        const added = incoming.slice(0, room)
        commitTips([...state.tips, ...added])
        return {
          ok: true,
          added: added.length,
          skipped: lines.length - added.length,
          truncated: added.length < incoming.length,
          error: '',
        }
      }

      /** Remove one idle line; the last remaining line cannot be removed. */
      function removeTip(index) {
        if (state.tips.length <= 1) return false
        if (index < 0 || index >= state.tips.length) return false
        const next = [...state.tips]
        next.splice(index, 1)
        commitTips(next)
        return true
      }

      /** Move one idle line up (`delta` -1) or down (+1); order is persisted. */
      function moveTip(index, delta) {
        const count = state.tips.length
        const from = index
        const to = from + (delta < 0 ? -1 : 1)
        if (from < 0 || from >= count || to < 0 || to >= count || from === to) return false
        const next = [...state.tips]
        const [line] = next.splice(from, 1)
        next.splice(to, 0, line)
        commitTips(next)
        return true
      }

      /** Restore the built-in idle lines. */
      function resetTips() {
        try {
          storage()?.removeItem(TIPS_KEY)
        } catch {
          /* best effort */
        }
        setState({ tips: builtinTips(state.lang), tipIndex: 0 })
        scheduleStoreSync()
      }

      /** Show the next idle line; the status row calls this on a timer. */
      function advanceTip() {
        const count = state.tips.length
        if (count < 2) return
        // A confirmation line owns the row for its full hold, then the
        // rotation picks up again with the next line.
        if (state.flash.length > 0) return
        setState({ tipIndex: (state.tipIndex + 1) % count })
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
          settingsOpen: value ? false : state.settingsOpen,
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
        // Keep keys this build does not own (an older record may carry more).
        writeJson(UI_KEY, { ...(readJson(UI_KEY) ?? {}), collapsed: state.collapsed, pos: state.pos })
      }

      // --- durable settings (Host half) -----------------------------------

      /**
       * Adopt the Host half's durable record when this origin has no settings
       * of its own — the state a restart on a fresh loopback port starts from.
       * When the page does have settings they are the fresher copy (the user
       * just changed them), so the Host record is refreshed from them instead
       * of overwriting them.
       * @returns true when a restored record changed the state.
       */
      function hydrateFromHost() {
        return loadStoreFromHost().then((remote) => {
          const local = settingsSnapshot()
          if (
            remote !== null &&
            remote !== undefined &&
            typeof remote === 'object' &&
            !hasStoredSettings(local)
          ) {
            if (!applySettingsStore(remote)) return false
            reloadFromStorage()
            return true
          }
          if (hasStoredSettings(local)) scheduleStoreSync()
          return false
        })
      }

      /** Re-derive every persisted preference from the storage record. */
      function reloadFromStorage() {
        const presets = readPresets(state.lang)
        const saved = readJson(UI_KEY) ?? {}
        const narrow = viewport().width < 720
        const collapsed = typeof saved.collapsed === 'boolean' ? saved.collapsed : narrow
        setState({
          presets,
          presetId: readPresetId(presets),
          deliveryOverride: readDeliveryOverride(),
          turbo: readTurbo(),
          quick: readQuick(),
          autoPaste: readAutoPaste(),
          tips: readTips(state.lang),
          tipIndex: 0,
          annotations: notesOfSession(state.target?.sessionId),
          collapsed,
          pos: isPoint(saved.pos) ? clampPoint(saved.pos, collapsed) : dockPosition(collapsed),
        })
      }

      // --- settings navigation --------------------------------------------

      /**
       * Keep the last few navigation samples in the persisted UI record.
       *
       * The shell's open seams report nothing when they fail — `invoke` returns
       * void, a blocked command returns silently, a click on the wrong button is
       * accepted — so the only place a failure can be observed is the running
       * page. The samples land in `nudge-store.json`, next to the other settings.
       */
      function recordSettingsDiag(entry) {
        try {
          const ui = readJson(UI_KEY) ?? {}
          const list = Array.isArray(ui.settingsDiag) ? ui.settingsDiag.slice(-5) : []
          list.push({ at: Date.now(), ...entry })
          ui.settingsDiag = list
          storage()?.setItem(UI_KEY, JSON.stringify(ui))
        } catch {
          /* diagnostics are best-effort and never block the gear */
        }
      }

      /**
       * A reusable "open DSH Settings and land on a section" driver.
       *
       * The shell exposes no plugin-facing API for this: the panel's open state
       * lives inside the shell component, `settings.open` returns void and is
       * refused silently while another modal owns the page, and the sidebar
       * trigger shares its seat with other plugins' popovers. The only
       * trustworthy receipt is the panel itself, so the jump is a small state
       * machine — ask a route, wait for the panel to paint, escalate — and
       * everything business-specific is injected:
       *
       *   getShortcuts  the `shortcuts` service (`registry.invoke`, `catalog`)
       *   getSlots      the `slots` service, read only by `probe()`
       *   sectionTitle  the nav row to click once the panel is up
       *   onDiag        where to record what the page looked like
       *   onFallback    what to show when no route painted the panel
       *
       * Nothing below reads this plugin's state, so the same driver serves any
       * other jump of the same shape (another settings section, another shell
       * panel) unchanged.
       */
      function createSettingsJump(options) {
        const { getShortcuts, getSlots, sectionTitle, onDiag, onFallback } = options

        let timer
        /** The routes of the current press, and the one being verified. */
        let routes = []
        let index = 0

        /** Cancel a pending verification (dispose, or a second press of the gear). */
        function cancel() {
          if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
          }
        }

        /** The settings dialog, tolerating shell versions with slightly different seams. */
        function findPanel() {
          return (
            document.querySelector?.(SETTINGS_PANEL_SELECTOR) ??
            document.querySelector?.('[role="dialog"][aria-modal="true"]')
          )
        }

        /** Click the settings nav row that owns the requested section. */
        function selectSection(panel) {
          if (typeof panel?.querySelectorAll !== 'function') return false
          const target = sectionTitle()
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
         * What the running page says about the shell's settings seams: whether
         * the sidebar launcher exists, what `settings.open` looks like from here,
         * and (when a panel is up) which nav rows it painted. Every value is
         * optional, because a shell build may miss any of them.
         */
        function probe() {
          const facts = {}
          try {
            const root = document.querySelector?.(SETTINGS_ROOT_SELECTOR) ?? null
            facts.root = root !== null
            const scoped = root?.querySelector?.('button[aria-haspopup="dialog"]') ?? null
            facts.scoped = scoped === null ? null : {
              label: scoped.getAttribute?.('aria-label') ?? null,
              keys: scoped.getAttribute?.('aria-keyshortcuts') ?? null,
            }
            facts.global = document.querySelectorAll?.('button[aria-haspopup="dialog"]')?.length ?? -1
            facts.comma = document.querySelectorAll?.('button[aria-keyshortcuts*="omma"]')?.length ?? -1
            facts.slots = document.querySelectorAll?.('[data-slot]')?.length ?? -1
            facts.modal = currentModalId()
            const shortcuts = getShortcuts()
            facts.shortcuts = shortcuts === undefined ? null : Object.keys(shortcuts)
            facts.invoke = typeof shortcuts?.registry?.invoke
            facts.catalog = shortcuts?.catalog?.getSnapshot?.()?.length ?? -1
            const slots = getSlots()
            facts.slotNames = typeof slots?.entries === 'function'
              ? (slots.entries() ?? [])
                .map((entry) => entry.name)
                .filter((name) => typeof name === 'string' && name.includes('settings'))
              : null
            const seat = typeof slots?.entries === 'function' ? slots.entries('sidebar.settings') : undefined
            facts.seat = Array.isArray(seat) && seat.length > 0 ? Object.keys(seat[0]?.options ?? {}) : null
            const panel = findPanel()
            facts.panel = Boolean(panel)
            if (panel) {
              facts.nav = [...panel.querySelectorAll('button')]
                .map((button) => (button.textContent ?? '').replace(/\s+/g, ''))
                .slice(0, 16)
            }
          } catch (error) {
            facts.error = String(error?.message ?? error)
          }
          return facts
        }

        /**
         * Ask the shell's registered `settings.open` command. This is the shell's
         * own entry point and works for either launcher seat and for both
         * runtimes; it reports nothing back, so the panel is the receipt.
         */
        function invokeCommand() {
          try {
            const registry = getShortcuts()?.registry
            if (typeof registry?.invoke !== 'function') return false
            registry.invoke('settings.open', { region: 'page', modal: currentModalId() })
            return true
          } catch (error) {
            console.warn('[dsh-nudge] settings command failed', error)
            return false
          }
        }

        /** Synthesize the registered `settings.open` keystroke; Web shells only. */
        function pressShortcut() {
          try {
            if (typeof KeyboardEvent === 'undefined') return false
            const row = getShortcuts()?.catalog
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

        /**
         * Text that names the shell's Settings trigger. The shell labels it with
         * its own locale ("设置" / "Settings"), so match loosely.
         */
        const TRIGGER_TEXT = /设置|設定|偏好|settings?|preferences?/i

        /** Whether `button` carries a mark that identifies it as the Settings trigger. */
        function looksLikeTrigger(button) {
          const shortcut = button.getAttribute?.('aria-keyshortcuts') ?? ''
          if (/comma/i.test(shortcut)) return true
          const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title')]
            .filter((value) => typeof value === 'string')
            .join(' ')
          return TRIGGER_TEXT.test(label)
        }

        /**
         * The plain Settings trigger, wherever the shell renders it. A button is
         * only ever clicked here when it is *positively* identified as that
         * trigger — the sidebar seat holds other dialog buttons too (a usage
         * popover, an account menu), and clicking one of those is a visible side
         * effect for a jump that then has to escalate anyway.
         */
        function findTrigger() {
          const root = document.querySelector?.(SETTINGS_ROOT_SELECTOR)
          const scoped = root?.querySelector?.('button[aria-haspopup="dialog"]')
          if (scoped) return scoped
          // The launcher seat is shared: when the account menu owns it the plain
          // trigger is not rendered in the sidebar at all, so fall back to any
          // dialog button whose own marks name Settings. Prefer the closed one, so
          // the click opens instead of closes.
          const candidates = [
            ...(document.querySelectorAll?.('button[aria-haspopup="dialog"]') ?? []),
          ].filter((button) => looksLikeTrigger(button))
          const closed = candidates.find(
            (button) => button.getAttribute?.('aria-expanded') !== 'true',
          )
          return closed ?? candidates[0] ?? null
        }

        /**
         * The ways the shell can open Settings, in the order they are tried: the
         * registered command first (it carries no side effect when it is refused),
         * then the trigger button (it drives the shell's own chrome, but clicking
         * it is a real click), then a synthesized keystroke for Web shells.
         *
         * Every one of these fails silently on some shell build — a modal guard
         * refuses the command, the launcher seat belongs to the account menu, an
         * older shell has no command at all — so a route only reports that it
         * *asked*. The panel is the receipt, and the next route runs only when the
         * previous one painted nothing.
         */
        function routesOf() {
          return [
            { id: 'command', run: () => invokeCommand() },
            {
              id: 'trigger',
              run() {
                const trigger = findTrigger()
                if (trigger === null || typeof trigger.click !== 'function') return false
                trigger.click()
                return true
              },
            },
            { id: 'keystroke', run: () => pressShortcut() },
          ]
        }

        /** Run the next route; false once they are exhausted and the fallback ran. */
        function advance() {
          for (;;) {
            // A route may open the panel just after its budget expired; checking
            // before every route also stops the next one from closing a panel
            // that is already up (`settings.open` toggles when Settings owns the
            // modal).
            const open = findPanel()
            if (open !== null && open !== undefined) {
              awaitSection(open, Date.now() + SETTINGS_SECTION_MS)
              return true
            }
            if (index >= routes.length) break
            const route = routes[index]
            let acted = false
            try {
              acted = route.run() === true
            } catch (error) {
              console.warn('[dsh-nudge] settings route failed', route.id, error)
            }
            onDiag({ event: 'route', id: route.id, acted, ...probe() })
            if (acted) {
              awaitPanel(Date.now() + SETTINGS_ROUTE_MS)
              return true
            }
            index += 1
          }
          // No seam answered: hand over to the host's fallback so the gear is
          // never dead.
          console.warn('[dsh-nudge] no settings seam answered; showing the form in the window')
          onDiag({ event: 'fallback', ...probe() })
          onFallback()
          return false
        }

        /** Wait for the panel a route asked for; hand over to the next route if it never comes. */
        function awaitPanel(deadline) {
          cancel()
          const panel = findPanel()
          if (panel !== null && panel !== undefined) {
            awaitSection(panel, Date.now() + SETTINGS_SECTION_MS)
            return
          }
          if (Date.now() >= deadline) {
            index += 1
            advance()
            return
          }
          timer = setTimeout(() => {
            timer = undefined
            awaitPanel(deadline)
          }, SETTINGS_POLL_MS)
        }

        /** Land on the requested section once the panel painted its nav rows. */
        function awaitSection(panel, deadline) {
          if (selectSection(panel)) {
            onDiag({ event: 'landed' })
            return
          }
          if (Date.now() >= deadline) {
            // Some shells paint the panel before its rows. Keeping Settings open
            // beats closing it: the user can still pick the row by hand.
            console.warn('[dsh-nudge] settings panel painted no row for this plugin')
            onDiag({ event: 'no-row', ...probe() })
            return
          }
          timer = setTimeout(() => {
            timer = undefined
            awaitSection(findPanel() ?? panel, deadline)
          }, SETTINGS_POLL_MS)
        }

        /**
         * Open Settings, landing on the requested section.
         *
         * The shell exposes no public "open settings and navigate" service, so
         * the routes in `routesOf` are tried until one of them actually paints
         * the panel, and only then is the section row clicked. When no route
         * paints it — an older shell, or a launcher seat and shortcuts service
         * that are both unavailable — `onFallback` runs instead. Returns whether
         * a shell route acted.
         */
        function open() {
          cancel()
          routes = routesOf()
          index = 0
          try {
            return advance()
          } catch (error) {
            console.warn('[dsh-nudge] open settings failed', error)
            onDiag({ event: 'error', error: String(error?.message ?? error) })
            onFallback()
            return false
          }
        }

        return { open, cancel, probe }
      }

      /**
       * The settings jump this plugin uses, wired to its own diagnostics record
       * and its own in-window form as the fallback.
       */
      const settingsJump = createSettingsJump({
        getShortcuts: () => ctx.get?.('shortcuts'),
        getSlots: () => ctx.slots,
        sectionTitle: () => text('settingsTitle'),
        onDiag: (entry) => recordSettingsDiag(entry),
        onFallback: () => setState({ settingsOpen: true }),
      })

      /** Open this plugin's settings, landing on its own section. */
      function openSettings() {
        return settingsJump.open()
      }

      /** Drop a pending verification (dispose, or a second press of the gear). */
      function stopSettingsWait() {
        settingsJump.cancel()
      }

      /** What the running page says about the shell's settings seams (diagnostics). */
      function probeSettings() {
        return settingsJump.probe()
      }

      /** Leave the in-window settings form and return to the normal body. */
      function closeSettings() {
        if (state.settingsOpen) setState({ settingsOpen: false })
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
          document.addEventListener('pointerdown', onPointerGestureDown, true)
          document.addEventListener('pointerup', onPointerGestureUp, true)
          document.addEventListener('pointercancel', onPointerGestureUp, true)
          window.addEventListener('blur', onPointerGestureUp)
          document.addEventListener('mouseup', captureSelectionLater, true)
          document.addEventListener('keyup', onSelectionKeyup, true)
          document.addEventListener('selectionchange', onSelectionChange, true)
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
      // The Host half holds the durable copy of every preference; adopting it
      // is what makes the settings survive an app restart (the GUI's loopback
      // port changes, so `localStorage` is a different origin after a restart).
      try {
        Promise.resolve(hydrateFromHost()).catch(() => {})
      } catch {
        /* no Host half (preview page, check harness) */
      }

      /** Release every subscription and in-flight request. */
      function dispose() {
        cancelStoreSync()
        cancelPendingCapture()
        pointerHeld = false
        endWaiting()
        for (const off of offs) {
          try {
            off?.()
          } catch {
            /* already disposed */
          }
        }
        offs.length = 0
        stopSettingsWait()
        window.removeEventListener('resize', onResize)
        try {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('focusin', syncComposerFocus, true)
            document.removeEventListener('focusout', syncComposerFocus, true)
            document.removeEventListener('pointerdown', onPointerGestureDown, true)
            document.removeEventListener('pointerup', onPointerGestureUp, true)
            document.removeEventListener('pointercancel', onPointerGestureUp, true)
            window.removeEventListener('blur', onPointerGestureUp)
            document.removeEventListener('mouseup', captureSelectionLater, true)
            document.removeEventListener('keyup', onSelectionKeyup, true)
            document.removeEventListener('selectionchange', onSelectionChange, true)
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
        movePreset,
        resetPresets,
        setCollapsed,
        moveTo,
        saveUi,
        openSettings,
        closeSettings,
        /** One sample of the shell's settings seams, kept in the durable record. */
        probeSettingsSeams: () => recordSettingsDiag({ event: 'mount', ...probeSettings() }),
        /** Note that the gear itself was reached, before any shell seam runs. */
        noteSettingsPress: () => recordSettingsDiag({ event: 'gear', ...probeSettings() }),
        /** Composer bridge hooks (session input overlay). */
        attachComposer,
        detachComposer,
        /** Annotation tray. */
        captureSelection,
        popupPosition,
        setQuick,
        setAutoPaste,
        addTip,
        addTips,
        updateTip,
        removeTip,
        moveTip,
        resetTips,
        advanceTip,
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
        _debug: {
          maxPresets: MAX_PRESETS,
          state: () => state,
          syncComposerFocus,
          settingsSnapshot,
          applySettingsStore,
          commitSettingsToHost,
          hydrateFromHost,
        },
      }
    }

    // ---------------------------------------------------------------------
    // view
    // ---------------------------------------------------------------------

    const CSS = `
.dsh-nudge-card,.dsh-nudge-pill,.dsh-nudge-settings,.dsh-nudge-popup{--dn-accent:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 78%,var(--dsw-alias-label-primary,#1a1a1a) 22%);--dn-accent-soft:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 14%,transparent);--dn-accent-line:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 38%,transparent);--dn-line:var(--dsw-alias-border-l1,rgba(127,127,127,.25));--dn-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 28%,transparent);--dn-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent);--dn-agree:#2e7d32}
.dsh-nudge-card{position:fixed;z-index:${Z_INDEX};width:min(304px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:16px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 18px 44px -22px rgba(15,23,42,.3);font:13px/1.55 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;pointer-events:auto;animation:dsh-nudge-in .18s ease-out}
@keyframes dsh-nudge-in{from{opacity:0;transform:translateY(-5px) scale(.985)}to{opacity:1;transform:none}}
.dsh-nudge-title{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-title:active{cursor:grabbing}
.dsh-nudge-name{font-size:12.5px;font-weight:600;letter-spacing:.2px;cursor:pointer;border-radius:5px;padding:2px 4px;margin:-2px -4px;transition:background .15s ease,color .15s ease}
.dsh-nudge-name:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-name:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-spacer{flex:1 1 auto}
.dsh-nudge-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:16px;height:16px;color:var(--dsw-alias-state-idle-primary,#9a9aa4);transition:color .2s ease}
.dsh-nudge-mark svg{display:block;overflow:visible}
.dsh-nudge-mark .dsh-nudge-mark-tap{opacity:.55;transition:opacity .2s ease}
.dsh-nudge-mark.waiting{color:var(--dsw-alias-state-warn-primary,#d99b1e)}
.dsh-nudge-mark.waiting .dsh-nudge-mark-tap{opacity:1;transform-box:fill-box;transform-origin:center;animation:dsh-nudge-tap 1.2s ease-out infinite}
.dsh-nudge-mark.done{color:var(--dsw-alias-state-success-primary,#2f9e63)}
.dsh-nudge-mark.done .dsh-nudge-mark-tap{opacity:0}
.dsh-nudge-mark.error{color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-mark.error .dsh-nudge-mark-tap{opacity:0}
@keyframes dsh-nudge-tap{0%{opacity:1;transform:scale(.55)}45%{opacity:.5;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
@keyframes dsh-nudge-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dsh-nudge-icon{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-icon:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-alert{margin:10px 14px 0;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.5;word-break:break-word}
.dsh-nudge-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent);color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-alert.note{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d99b1e) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#a06a00)}
.dsh-nudge-flash{margin:8px 14px 0;font-size:11.5px;line-height:1.4;min-height:16px;color:var(--dn-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-nudge-flash.active{animation:dsh-nudge-flash-in .16s ease-out}
@keyframes dsh-nudge-flash-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
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
.dsh-nudge-ask{height:38px;border:0;border-radius:11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dn-accent);box-shadow:0 8px 20px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 55%,transparent);transition:filter .15s ease,transform .1s ease,box-shadow .15s ease}
.dsh-nudge-ask:hover{filter:brightness(1.05);box-shadow:0 10px 24px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 65%,transparent)}
.dsh-nudge-ask:active{transform:translateY(1px)}
.dsh-nudge-ask:disabled{opacity:.55;cursor:default;box-shadow:none;filter:none}
.dsh-nudge-ask:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-annotation-compose{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dn-accent-line);background:var(--dn-accent-soft)}
.dsh-nudge-annotation-compose .dsh-nudge-annotation-quote{min-height:34px;-webkit-line-clamp:2}
.dsh-nudge-annotation-quote{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-popup{position:fixed;z-index:${Z_INDEX + 1};box-sizing:border-box;width:340px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 10px 30px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.08);font:13px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;pointer-events:auto;opacity:.72;transition:opacity .22s ease;animation:dsh-nudge-popup-in .18s ease-out}
.dsh-nudge-popup:hover,.dsh-nudge-popup:focus-within{opacity:1}
@keyframes dsh-nudge-popup-in{from{opacity:0}to{opacity:.72}}
@media (prefers-reduced-motion:reduce){.dsh-nudge-popup{animation:none;transition:none}}
.dsh-nudge-popup-close{position:absolute;top:6px;right:6px;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:16px;line-height:20px;cursor:pointer}
.dsh-nudge-popup-close:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-settings-panel{display:flex;flex-direction:column;gap:10px;padding:12px;flex:1 1 auto;min-height:0;max-height:min(520px,72vh);overflow:auto}
.dsh-nudge-settings-head{display:flex;align-items:center;gap:8px}
.dsh-nudge-settings-name{font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-popup-row{display:flex;align-items:center;gap:6px}
.dsh-nudge-popup-row button{height:32px;padding:0 9px;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:13px;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.dsh-nudge-popup-row button:active{transform:scale(.97)}
.dsh-nudge-popup-row button:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-popup-quick{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:0}
.dsh-nudge-popup-quick .emoji{font-size:15px;line-height:1}
.dsh-nudge-popup-quick:hover{background:var(--dn-hover)}
.dsh-nudge-popup-quick.agree{border-color:var(--dn-agree);background:var(--dn-agree);color:#fff;font-weight:600}
.dsh-nudge-popup-quick.agree:hover{filter:brightness(.94)}
.dsh-nudge-popup-row .dsh-nudge-popup-save{border-color:var(--dn-accent-line);background:var(--dn-accent-soft);color:var(--dn-accent);font-weight:600}
.dsh-nudge-popup-row .dsh-nudge-popup-save:hover{background:color-mix(in srgb,var(--dn-accent) 20%,transparent)}
.dsh-nudge-popup-row .dsh-nudge-popup-copy{min-width:62px;color:var(--dn-accent)}
.dsh-nudge-popup-copy[data-copied="true"]{border-color:var(--dn-accent-line);background:var(--dn-accent-soft)}
.dsh-nudge-popup-hint{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-popup-hint kbd{font:inherit;padding:0 3px;border:1px solid var(--dn-line);border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 4%,transparent)}
.dsh-nudge-annotation-input{width:100%;box-sizing:border-box;min-height:34px;field-sizing:content;max-height:132px;overflow-y:auto;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:13px;line-height:20px;padding:7px 10px}
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
.dsh-nudge-module-head{display:flex;align-items:center;gap:7px;padding:1px 0 8px;border:0;border-bottom:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.2px;text-align:left;user-select:none}
.dsh-nudge-module-head::before{content:'';flex:0 0 auto;width:3px;height:13px;border-radius:2px;background:var(--dn-accent);margin-left:2px}
.dsh-nudge-module-title{white-space:nowrap}
.dsh-nudge-module-main{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:2px 4px;margin-left:-4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;transition:color .15s ease,background .15s ease}
.dsh-nudge-module-main:hover{color:var(--dn-accent);background:var(--dn-hover)}
.dsh-nudge-module-main:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-module-actions{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}
.dsh-nudge-head-btn,.dsh-nudge-head-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;height:22px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:11.5px;font-weight:600;letter-spacing:0;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-head-icon{width:22px;padding:0}
.dsh-nudge-head-btn:hover,.dsh-nudge-head-icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-head-btn:focus-visible,.dsh-nudge-head-icon:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-head-btn.active,.dsh-nudge-head-icon.active{background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-head-btn.inactive,.dsh-nudge-head-btn:disabled{opacity:.45;cursor:default;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66)}
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
.dsh-nudge-settings-note{font-size:12px;line-height:1.6;color:var(--dn-accent-line,var(--dsw-alias-label-secondary,#5a5a66))}
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
.dsh-nudge-tip-draft{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-tip-draft textarea{width:100%;box-sizing:border-box;min-height:64px;max-height:min(240px,32vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-tip-draft textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-tip-draft .dsh-nudge-btn{align-self:flex-start}
.dsh-nudge-btn{height:30px;padding:0 12px;border:1px solid var(--dn-line);border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
.dsh-nudge-btn:hover{background:var(--dn-hover)}
.dsh-nudge-btn.primary{background:var(--dn-accent);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
.dsh-nudge-btn.primary:hover{filter:brightness(1.05);background:var(--dn-accent)}
.dsh-nudge-btn.danger{color:var(--dsw-alias-state-error-primary,#c8433c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 28%,transparent)}
.dsh-nudge-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent)}
.dsh-nudge-btn.icon{width:30px;padding:0;font-size:13px;line-height:1}
.dsh-nudge-btn:disabled{opacity:.4;cursor:default}
.dsh-nudge-btn:disabled:hover{background:transparent}
.dsh-nudge-settings-group{display:flex;flex-direction:column;gap:7px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent)}
.dsh-nudge-settings-error{color:var(--dsw-alias-state-error-primary,#c8433c);font-size:12px;line-height:1.5}
`.trim()

    /**
     * Build the React view over one runtime.
     * @param runtime - window runtime.
     * @returns the slot component.
     */
    function makeView(runtime) {
      /** The same form the shell section renders, reused by the in-window panel. */
      const SettingsForm = makeSettingsView(runtime)
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
        /** A drag that moved must not also collapse the window from its title. */
        const suppressTitleClick = React.useRef(false)
        const noteInputRef = React.useRef(null)
        const popupInputRef = React.useRef(null)
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
        // The selection card is a writing box: opening it puts the caret straight
        // into the note field so the user can type without clicking first.
        React.useEffect(() => {
          if (state.annotationDraft === null || state.annotationEditingId !== null) return
          const node = popupInputRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus({ preventScroll: true })
            } catch {
              /* unfocusable */
            }
          }
        }, [state.annotationDraft])
        // The status row is never empty: a change message wins while its timer
        // runs, otherwise the idle lines take turns.
        React.useEffect(() => {
          const count = Array.isArray(state.tips) ? state.tips.length : 0
          if (count < 2 || typeof runtime.advanceTip !== 'function') return undefined
          const timer = window.setInterval(() => runtime.advanceTip(), TIP_ROTATE_MS)
          return () => window.clearInterval(timer)
        }, [state.tips.length])
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()
        const draft = state.annotationDraft
        // Copy reports back in place for a moment, the way ds-popup's card does;
        // the timer is reset when the card moves to another passage.
        const [copyFlash, setCopyFlash] = React.useState('')
        const copyFlashTimer = React.useRef(0)
        React.useEffect(
          () => () => {
            window.clearTimeout(copyFlashTimer.current)
          },
          [],
        )
        React.useEffect(() => {
          window.clearTimeout(copyFlashTimer.current)
          setCopyFlash('')
        }, [draft?.quote])
        const copyQuote = () => {
          const pending = runtime.copyDraftQuote()
          Promise.resolve(pending).then((ok) => {
            setCopyFlash(ok === true ? 'done' : 'failed')
            window.clearTimeout(copyFlashTimer.current)
            copyFlashTimer.current = window.setTimeout(() => setCopyFlash(''), 1400)
          })
        }
        const copyLabel =
          copyFlash === 'done'
            ? t('copiedShort')
            : copyFlash === 'failed'
              ? t('copyFailedShort')
              : t('copyQuote')
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
                h(
                  'button',
                  {
                    key: 'close',
                    type: 'button',
                    className: 'dsh-nudge-popup-close',
                    title: `${t('dismissAnnotation')} (Esc)`,
                    'aria-label': t('dismissAnnotation'),
                    onClick: () => runtime.dismissAnnotationDraft(),
                  },
                  '×',
                ),
                h('textarea', {
                  key: 'note',
                  ref: popupInputRef,
                  rows: 1,
                  className: 'dsh-nudge-annotation-input',
                  value: state.annotationNote,
                  placeholder: t('annotationPlaceholder'),
                  'aria-label': t('annotationPlaceholder'),
                  // Typing must never be interrupted: the note field owns the
                  // caret, so the transcript selection is left alone here.
                  onChange: (event) => {
                    runtime.setAnnotationNote(event.target.value)
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
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
                  { key: 'actions', className: 'dsh-nudge-popup-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-quick agree',
                      onClick: () => runtime.quickReply('agree'),
                    },
                    h('span', { className: 'emoji', 'aria-hidden': true }, '👍'),
                    h('span', null, t('agree')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-quick',
                      onClick: () => runtime.quickReply('disagree'),
                    },
                    h('span', { className: 'emoji', 'aria-hidden': true }, '👎'),
                    h('span', null, t('disagree')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-save',
                      title: `${t('addAnnotation')} (Enter)`,
                      onClick: () => runtime.addAnnotation(),
                    },
                    t('addAnnotation'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-copy',
                      'data-copied': copyFlash === 'done' ? 'true' : undefined,
                      onClick: copyQuote,
                    },
                    copyLabel,
                  ),
                ),
                h(
                  'div',
                  { key: 'hint', className: 'dsh-nudge-popup-hint' },
                  h(
                    'span',
                    null,
                    h('kbd', null, 'Enter'),
                    ` ${t('addAnnotation')} · `,
                    h('kbd', null, 'Esc'),
                    ` ${t('dismissAnnotation')} · `,
                    h('kbd', null, 'Ctrl+C'),
                    ` ${t('copyHint')}`,
                  ),
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
        /** Clicking the window title folds the window into the pill. */
        function onNameClick() {
          if (suppressTitleClick.current) {
            suppressTitleClick.current = false
            return
          }
          runtime.setCollapsed(true)
        }
        /**
         * The title bar captures the pointer for dragging, which retargets the
         * click to the bar itself: fold on the bar, but let its own buttons win.
         */
        function onTitleClick(event) {
          const origin = event?.target
          if (origin && origin !== event.currentTarget && typeof origin.closest === 'function' && origin.closest('button')) {
            return
          }
          onNameClick()
        }
        /** Keyboard equivalent of clicking the title. */
        function onNameKeyDown(event) {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onNameClick()
        }
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
        /** Auto-paste: a note card flowing into the draft, on focus. */
        const pasteIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', {
            x: 3.2,
            y: 2.4,
            width: 9.6,
            height: 11.2,
            rx: 1.7,
            stroke: 'currentColor',
            strokeWidth: 1.2,
          }),
          h('path', {
            d: 'M6 5.6h4M6 8.4h4M6 11.2h2.2',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round',
          }),
        )
        /** Turbo: a filled bolt, the universal "go fast" mark. */
        const boltIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('path', {
            d: 'M8.9 1.4 2.85 9.05h3.3l-.85 5.55 6.85-8.05h-3.6l.85-5.15Z',
            fill: 'currentColor',
          }),
        )
        /** Delivery "steer": jump the queue and cut in now. */
        const steerIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M2.8 3.3 8.9 8l-6.1 4.7V3.3Z', fill: 'currentColor' }),
          h('path', {
            d: 'M11.9 3.1v9.8',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
        /** Delivery "queue": wait for the current turn, then go. */
        const queueIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M2.6 4.6 6.1 8l-3.5 3.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M8.4 4.6 11.9 8l-3.5 3.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
        /**
         * The title mark: a tapping fingertip plus the tap it lands.
         * Colour carries the phase (idle grey / waiting amber / done green / error red);
         * the tap ripple only breathes while a nudge is in flight.
         */
        const markIcon = h(
          'span',
          { className: `dsh-nudge-mark ${dotClass}`, title: statusLabel, 'aria-hidden': true },
          h(
            'svg',
            { width: 16, height: 16, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true },
            h('circle', { className: 'dsh-nudge-mark-tap', cx: 2.6, cy: 2.6, r: 1.9, fill: 'currentColor' }),
            h('path', {
              d: 'M9.6 2.4c.62 0 1.1.5 1.1 1.1v4.1c.1-.6.6-1.05 1.25-1.05.6 0 1.1.45 1.15 1.05.2-.5.65-.8 1.15-.8.7 0 1.2.55 1.2 1.25v5.3a3.3 3.3 0 0 1-3.3 3.3H9.4a3 3 0 0 1-2.1-.85L4.6 13a1 1 0 0 1 1.35-1.45l1.35 1.15V3.5c0-.6.5-1.1 1.1-1.1Z',
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
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
              markIcon,
              h('span', null, t('title')),
              state.unread ? h('span', { className: 'dsh-nudge-unread', title: t('newResult') }) : null,
            ),
            popup,
          )
        }

        /** Start one pointer drag from the current anchor. */
        function beginDrag(event) {
          if (event.button !== 0) return
          // Capturing the pointer on the bar retargets the click away from a
          // button inside it, so buttons keep their own pointer handling.
          const origin = event.target
          if (origin && typeof origin.closest === 'function' && origin.closest('button')) return
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

        /** Finish a title-bar drag; a plain click on the title folds the window. */
        function onPointerUp() {
          const current = drag.current
          if (current && current.moved) suppressTitleClick.current = true
          endDrag()
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
              onClick: onTitleClick,
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel,
            },
            markIcon,
            h(
              'span',
              {
                className: 'dsh-nudge-name',
                role: 'button',
                tabIndex: 0,
                title: t('foldHint'),
                'aria-label': `${t('title')}：${t('foldHint')}`,
                onClick: onNameClick,
                onKeyDown: onNameKeyDown,
              },
              t('title'),
            ),
            h('span', { className: 'dsh-nudge-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-icon',
                title: t('openSettings'),
                'aria-label': t('openSettings'),
                onClick: () => {
                  // A second press leaves the in-window form, like any toggle.
                  if (state.settingsOpen) runtime.closeSettings()
                  else runtime.openSettings()
                },
                onPointerDown: (event) => {
                  // The bar starts a drag on pointerdown; a press here must not
                  // be swallowed by it (and must not move the window).
                  event.stopPropagation()
                  runtime.noteSettingsPress()
                },
              },
              gear,
            ),
          ),
          state.error.length > 0
            ? h('div', { key: 'error', className: 'dsh-nudge-alert error' }, state.error)
            : null,
          state.note.length > 0
            ? h('div', { key: 'note', className: 'dsh-nudge-alert note' }, state.note)
            : null,
          // Always mounted: this row is the window's status bar now, and a row
          // that appeared only while a message was up would resize the whole
          // floating window every time a switch is toggled. An empty string
          // keeps the line box (see `.dsh-nudge-flash`) so the height is fixed.
          h(
            'div',
            {
              key: 'flash',
              className: `dsh-nudge-flash${state.flash.length > 0 ? ' active' : ''}`,
              role: 'status',
              'aria-live': 'polite',
            },
            state.flash.length > 0
              ? state.flash
              : state.tips.length > 0
                ? state.tips[state.tipIndex % state.tips.length]
                : '',
          ),
          state.settingsOpen
            ? h(
                'div',
                {
                  key: 'settings-panel',
                  className: 'dsh-nudge-settings-panel',
                  role: 'region',
                  'aria-label': t('settingsTitle'),
                },
                h(
                  'div',
                  { key: 'settings-head', className: 'dsh-nudge-settings-head' },
                  h('span', { className: 'dsh-nudge-settings-name' }, t('settingsHead')),
                  h('span', { className: 'dsh-nudge-spacer' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-icon',
                      title: t('back'),
                      'aria-label': t('back'),
                      onClick: () => runtime.closeSettings(),
                    },
                    '×',
                  ),
                ),
                h(SettingsForm, { key: 'settings-form' }),
              )
            : h(
            'div',
            { key: 'content', className: 'dsh-nudge-content' },
            h(
              'div',
              { key: 'annotation-module', className: 'dsh-nudge-module' },
              h(
                'div',
                { key: 'annotation-head', className: 'dsh-nudge-module-head' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-module-main',
                    title: state.annotationExpanded ? t('collapseAnnotations') : t('expandAnnotations'),
                    'aria-expanded': state.annotationExpanded ? 'true' : 'false',
                    onClick: () => runtime.setAnnotationExpanded(!state.annotationExpanded),
                  },
                  h('span', { className: 'dsh-nudge-module-title' }, t('annotationsTitle')),
                  state.annotations.length > 0
                    ? h('span', { className: 'dsh-nudge-annotations-count' }, String(state.annotations.length))
                    : null,
                ),
                h('span', { className: 'dsh-nudge-spacer' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-head-icon dsh-nudge-annotation-quick${state.quick ? ' active' : ''}`,
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
                    className: `dsh-nudge-head-icon dsh-nudge-annotation-autopaste${state.autoPaste ? ' active' : ''}`,
                    title: state.autoPaste ? t('autoPasteOn') : t('autoPasteOff'),
                    'aria-label': state.autoPaste ? t('autoPasteOn') : t('autoPasteOff'),
                    'aria-pressed': state.autoPaste ? 'true' : 'false',
                    onClick: () => runtime.setAutoPaste(!state.autoPaste),
                  },
                  pasteIcon,
                ),
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
                            state.quick ? t('annotationsHint') : t('annotationsOffHint'),
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
            ),
            h(
              'div',
              { key: 'nudge-module', className: 'dsh-nudge-module' },
              h(
                'div',
                { key: 'nudge-head', className: 'dsh-nudge-module-head' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-module-main',
                    title: state.nudgeExpanded ? t('collapseNudge') : t('expandNudge'),
                    'aria-expanded': state.nudgeExpanded ? 'true' : 'false',
                    onClick: () => runtime.setNudgeExpanded(!state.nudgeExpanded),
                  },
                  h('span', { className: 'dsh-nudge-module-title' }, t('nudgeModule')),
                ),
                h('span', { className: 'dsh-nudge-spacer' }),
                h(
                  'div',
                  { className: 'dsh-nudge-module-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-nudge-head-icon dsh-nudge-delivery-toggle${insertMode ? ' inactive' : ''}${
                        delivery === 'steer' ? ' steer' : ''
                      }`,
                      title: insertMode
                        ? t('modeInactive')
                        : `${t('mode')}：${delivery === 'steer' ? t('steer') : t('queue')}（点击切换）`,
                      'aria-label': `${t('mode')}：${delivery === 'steer' ? t('steer') : t('queue')}`,
                      disabled: insertMode,
                      onClick: () => runtime.setDelivery(delivery === 'steer' ? 'followup' : 'steer'),
                    },
                    delivery === 'steer' ? steerIcon : queueIcon,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-nudge-head-icon dsh-nudge-turbo-toggle${turbo ? ' active' : ''}`,
                      title: `${t('turboTitle')}：${turbo ? t('switchOn') : t('switchOff')}（点击切换）`,
                      'aria-label': t('turboTitle'),
                      'aria-pressed': turbo ? 'true' : 'false',
                      onClick: () => runtime.setTurbo(!turbo),
                    },
                    boltIcon,
                  ),
                ),
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
                      title: preset.text,
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
            turbo
              ? null
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

      /**
       * One labelled checkbox row, shared by every boolean setting.
       * Built eagerly (a plain element, not a component) so the settings tree
       * stays directly inspectable by the checks.
       */
      function toggleRow(props) {
        const { title, desc, checked, onChange } = props
        return h(
          'label',
          { className: 'dsh-nudge-toggle', title: desc },
          h('input', {
            type: 'checkbox',
            checked: checked === true,
            onChange: (event) => onChange(event.target.checked),
          }),
          h(
            'span',
            { className: 'dsh-nudge-toggle-text' },
            h('span', { className: 'dsh-nudge-toggle-title' }, title),
            h('span', { className: 'dsh-nudge-toggle-desc' }, desc),
          ),
        )
      }

      function PresetRow(props) {
        const { preset, t, onError, index, total } = props
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
              onKeyDown: (event) => {
                if (event.key === 'Enter') commit()
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('sortUp'),
                'aria-label': t('sortUp'),
                disabled: index <= 0,
                onClick: () => runtime.movePreset(preset.id, -1),
              },
              '↑',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('sortDown'),
                'aria-label': t('sortDown'),
                disabled: index >= total - 1,
                onClick: () => runtime.movePreset(preset.id, 1),
              },
              '↓',
            ),
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
            onKeyDown: (event) => {
              if (event.key === 'Enter' && event.shiftKey !== true) commit()
            },
          }),
        )
      }

      /** One idle line: a text field plus reorder and delete buttons. */
      function TipRow(props) {
        const { value, t, onError, index, total } = props
        const [line, setLine] = React.useState(value)
        React.useEffect(() => {
          setLine(value)
        }, [value])

        function commit() {
          if (!runtime.updateTip(index, line)) {
            setLine(value)
            onError(t('tipTextRequired'))
            return
          }
          onError('')
        }

        return h(
          'div',
          { className: 'dsh-nudge-preset-line' },
          h('input', {
            type: 'text',
            value: line,
            placeholder: t('tipsPlaceholder'),
            'aria-label': t('tipsPlaceholder'),
            onChange: (event) => setLine(event.target.value),
            onBlur: commit,
            onKeyDown: (event) => {
              if (event.key === 'Enter') commit()
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-nudge-btn icon',
              title: t('sortUp'),
              'aria-label': t('sortUp'),
              disabled: index <= 0,
              onClick: () => runtime.moveTip(index, -1),
            },
            '↑',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-nudge-btn icon',
              title: t('sortDown'),
              'aria-label': t('sortDown'),
              disabled: index >= total - 1,
              onClick: () => runtime.moveTip(index, 1),
            },
            '↓',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-nudge-btn danger',
              onClick: () => {
                if (runtime.removeTip(index)) onError('')
                else onError(t('tipLast'))
              },
            },
            t('deleteTip'),
          ),
        )
      }

      return function NudgeSettings() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const [error, setError] = React.useState('')
        const [note, setNote] = React.useState('')
        const [draftLabel, setDraftLabel] = React.useState('')
        const [draftText, setDraftText] = React.useState('')
        const [draftTip, setDraftTip] = React.useState('')
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()

        /** Fill `{n}` in a message template. */
        function fill(template, count) {
          return template.replace('{n}', String(count))
        }

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

        /** Take one paste (or one typed block) and report what landed. */
        function addTipLines(raw) {
          const result = runtime.addTips(raw)
          if (!result.ok) {
            setError(result.error)
            setNote('')
            return false
          }
          const parts = [fill(t('tipsAdded'), result.added)]
          if (result.skipped > 0) parts.push(fill(t('tipsSkipped'), result.skipped))
          setError('')
          setNote(parts.join('，'))
          setDraftTip('')
          return true
        }

        function addTipLine() {
          addTipLines(draftTip)
        }

        /** A pasted list is split right away: no extra click needed. */
        function onTipPaste(event) {
          const text = event?.clipboardData?.getData?.('text')
          if (typeof text !== 'string' || text.trim() === '') return
          event.preventDefault?.()
          addTipLines(text)
        }

        return h(
          'div',
          { className: 'dsh-nudge-settings' },
          h('style', { key: 'dsh-nudge-css' }, CSS),
          // Every switch on the floating window has a row here, so the window
          // can stay icon-only without hiding how it is configured.
          toggleRow({
            key: 'turbo',
            title: t('turboTitle'),
            desc: t('turboDesc'),
            checked: state.turbo === true,
            onChange: (value) => runtime.setTurbo(value),
          }),
          toggleRow({
            key: 'quick',
            title: t('quickTitle'),
            desc: t('quickHint'),
            checked: state.quick === true,
            onChange: (value) => runtime.setQuick(value),
          }),
          toggleRow({
            key: 'autopaste',
            title: t('autoPasteTitle'),
            desc: t('autoPasteDesc'),
            checked: state.autoPaste === true,
            onChange: (value) => runtime.setAutoPaste(value),
          }),
          h(
            'div',
            { key: 'delivery', className: 'dsh-nudge-settings-group' },
            h('span', { className: 'dsh-nudge-toggle-title' }, t('deliveryTitle')),
            h('span', { className: 'dsh-nudge-toggle-desc' }, t('deliveryDesc')),
            h(
              'div',
              { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('deliveryTitle') },
              h(
                'button',
                {
                  type: 'button',
                  className: `dsh-nudge-chip${delivery === 'steer' ? ' active' : ''}`,
                  'aria-pressed': delivery === 'steer' ? 'true' : 'false',
                  onClick: () => runtime.setDelivery('steer'),
                },
                t('steer'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: `dsh-nudge-chip${delivery === 'steer' ? '' : ' active'}`,
                  'aria-pressed': delivery === 'steer' ? 'false' : 'true',
                  onClick: () => runtime.setDelivery('followup'),
                },
                t('queue'),
              ),
            ),
          ),
          h('div', { className: 'dsh-nudge-settings-hint' }, t('presetsHint')),
          ...state.presets.map((preset, index) =>
            h(PresetRow, {
              key: preset.id,
              preset,
              t,
              onError: setError,
              index,
              total: state.presets.length,
            }),
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
          h('div', { key: 'tips-title', className: 'dsh-nudge-settings-hint' }, t('tipsTitle')),
          h('div', { key: 'tips-hint', className: 'dsh-nudge-settings-hint' }, t('tipsHint')),
          // The paste box sits above the list: it is the way in, so it must not
          // hide under a dozen existing lines.
          h(
            'div',
            { key: 'tip-draft', className: 'dsh-nudge-tip-draft' },
            h('textarea', {
              value: draftTip,
              placeholder: t('tipsPastePlaceholder'),
              'aria-label': t('tipsPastePlaceholder'),
              onChange: (event) => setDraftTip(event.target.value),
              onPaste: onTipPaste,
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.ctrlKey === true || event.metaKey === true)) {
                  addTipLine()
                }
              },
            }),
            h('button', { type: 'button', className: 'dsh-nudge-btn primary', onClick: addTipLine }, t('addTip')),
          ),
          note.length > 0 ? h('div', { key: 'tips-note', className: 'dsh-nudge-settings-note' }, note) : null,
          ...state.tips.map((line, index) =>
            h(TipRow, {
              key: `tip-${index}`,
              value: line,
              t,
              onError: setError,
              index,
              total: state.tips.length,
            }),
          ),
          h(
            'div',
            { key: 'tips-reset', className: 'dsh-nudge-preset-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn',
                onClick: () => {
                  runtime.resetTips()
                  setError('')
                  setNote('')
                },
              },
              t('resetTips'),
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

      // The shell's settings seams fail silently, so read them once after the
      // sidebar painted: the sample lands in the durable record next to the
      // other settings, where a page that cannot be inspected can still report
      // which seam is missing on that build.
      ctx.effect(() => {
        const timer = setTimeout(() => {
          try {
            runtime.probeSettingsSeams()
          } catch {
            /* diagnostics never break the plugin */
          }
        }, 3000)
        timer?.unref?.()
        return () => clearTimeout(timer)
      }, 'dsh-nudge: settings seams')
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
