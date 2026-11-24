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
    const ENTRY = 'dsh-nudge'
    const UI_KEY = 'dsh-nudge:ui'
    const DELIVERY_KEY = 'dsh-nudge:delivery'
    const TURBO_KEY = 'dsh-nudge:turbo'
    const QUICK_KEY = 'dsh-nudge:quick'
    const AUTOPASTE_KEY = 'dsh-nudge:autopaste'
    const FRAME_KEY = 'dsh-nudge:frame'
    /** The border widths the settings offer for the floating window, in px. */
    const FRAME_CHOICES = [0, 1, 2, 3]
    const DEFAULT_FRAME = 2
    /** Pointer travel before a press on a window chip becomes a drag, in px. */
    const CHIP_DRAG_SLOP = 4
    /** How long a displaced window chip takes to reach its new slot, in ms. */
    const CHIP_SHIFT_MS = 150
    /** How long a dropped chip takes to settle back into its slot, in ms. */
    const CHIP_SETTLE_MS = 130
    const NOTES_KEY = 'dsh-nudge:notes'
    /** Flow item attribute the shell uses for stable transcript anchors. */
    const ANCHOR_SELECTOR = '[data-chat-anchor-key]'
    /**
     * The plugin's own chrome — the card, the pill and the in-place bubble.
     * Factory scope because the view needs it too: a focus retry asks whether
     * the node that took the caret is one of ours.
     */
    const SELF_SELECTOR = '.dsh-nudge-card, .dsh-nudge-pill, .dsh-nudge-popup'
    /**
     * The two roots a drag moves. A title bar press resolves its card through
     * this selector, so the pointer moves the window and not just the bar.
     */
    const DRAG_ROOT_SELECTOR = '.dsh-nudge-card, .dsh-nudge-pill'
    /** Registry name for the annotated-passage highlight. */
    const HIGHLIGHT_NAME = 'dsh-nudge-notes'
    /** Registry name for passages a note marked as the answer. */
    const ANSWER_HIGHLIGHT = 'dsh-nudge-answers'
    /** Registry name for the passage currently being annotated. */
    const CAPTURE_HIGHLIGHT = 'dsh-nudge-capture'
    /** How much context one anchor keeps on each side of its quote. */
    const CONTEXT_CHARS = 24
    const MAX_NOTES = 200
    const MAX_NOTE_SESSIONS = 40
    /** Upper bound on painted quote candidates per anchor. */
    const MAX_OCCURRENCES = 40
    /**
     * How long a note whose row is gone waits before the transcript is searched
     * again, in ms. A new, removed or re-keyed row searches immediately; this is
     * the backstop for a passage that moves without one.
     */
    const MISS_RESCAN_MS = 1500
    /** Samples kept per diagnostic list in the persisted UI record. */
    const DIAG_SAMPLES = 5
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
    /**
     * Lines the status row shows while nothing is happening. It is a plain
     * list of strings; one is shown at a time and the list rotates.
     */
    const TIPS_KEY = 'dsh-nudge:tips'
    /** Per-day usage counters; local dates, most recent days only. */
    const STATS_KEY = 'dsh-nudge:stats'
    /** How many local days the counters keep before the oldest are dropped. */
    const STATS_DAYS = 60
    /** How many preset ids one day may carry, and how long an id may be. */
    const MAX_STAT_PRESETS = 20
    const MAX_STAT_PRESET_ID = 80
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
        zh: '急速模式下双击快捷输入，可以直接执行。',
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
    /**
     * The collapsed window is one round button: the mark icon alone, no label.
     * Geometry below treats it as a square, so the circle stays fully on screen.
     */
    const PILL_SIZE = 36
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
      insertHint: '把选中的快捷输入追加到输入框末尾',
      insertUnavailable: '输入框未就绪，暂时无法写入文案。',
      modeInactive: '写入输入框时不需要发送方式',
      turboTitle: '急速模式',
      turboDesc: '窗口不显示发送按钮；双击快捷输入直接执行。',
      turboTip: '不显示发送按钮，双击快捷输入直接执行',
      switchOn: '开',
      switchOff: '关',
      answerLabel: '我的回答：',
      annotationsTitle: '批注',
      annotationPlaceholder: '填写批注，可留空…',
      annotationsHint: '选中对话里的文字，选区旁会弹出批注卡片；批注汇总在这里。',
    highlightHint: '点对话里的高亮，可以改批注或取消高亮。',
      annotationsOffHint: '快速批注已关闭；打开批注栏的开关才能从选中文字添加批注。',
      addAnnotation: '添加批注',
      asAnswer: '定为答案',
      asAnswerHint: '把它作为答案：高亮整段，选中的文字作为批注',
      dismissAnnotation: '取消',
      deleteAnnotation: '取消高亮',
      editNoteHint: 'Enter 保存 · Shift+Enter 换行 · Esc 取消',
      writeAnnotations: '写入输入框',
    writtenTag: '已写入',
      sendAnnotations: '发送',
      quickOn: '快速批注：开',
      quickOff: '快速批注：关',
      quickTitle: '快速批注',
      quickHint: '选中对话文字就弹出批注卡片；关闭后不能从选中文字添加批注。',
      quickTip: '选中文字就弹出批注卡片',
      autoPasteTitle: '自动粘贴批注',
      autoPasteDesc: '启用后，点进输入框会把待发送的批注写进草稿，并清空待发送列表。',
      autoPasteTip: '点进输入框时写入待发送的批注',
      tipOn: '已开启',
      tipOff: '已关闭',
      settingsTip: '打开或收起窗内设置面板',
      autoPasteOn: '自动粘贴批注：开',
      autoPasteOff: '自动粘贴批注：关',
      appearanceTitle: '外观',
      frameTitle: '窗口边框',
      frameDesc: '悬浮窗描边的粗细。',
      frameNone: '无',
      frameThin: '细',
      frameNormal: '标准',
      frameThick: '粗',
      copyHint: '复制选中的原文',
      deliveryTitle: '发送方式',
      deliveryDesc: '直接打断会中止当前回答；排队等这一轮结束。',
      deliveryTipSteer: '点发送时立刻中止当前回答',
      deliveryTipQueue: '等当前这一轮结束后再处理',
      sortUp: '上移',
      sortDown: '下移',
      nudgeModule: '快捷输入',
      quickAdd: '新增',
      quickAddTitle: '标题',
      quickAddBody: '正文',
      quickEdit: '编辑',
      quickEditHint: '编辑快捷输入：拖动排序，点一下改内容',
      editChipHint: '拖动排序，点一下修改；聚焦后按 ← → 移动，Enter 修改',
      editPresetHead: '编辑快捷输入',
      collapseAnnotations: '收起批注',
      expandAnnotations: '展开批注',
      collapseNudge: '收起快捷输入',
      expandNudge: '展开快捷输入',
      agree: '同意',
      agreeThis: '同意这段',
      disagree: '不同意',
      disagreeThis: '不同意这段',
      copyQuote: '复制原文',
      copied: '引用已复制到剪贴板。',
      copyFailed: '复制失败，请手动选中后复制。',
      copiedShort: '已复制',
      copyFailedShort: '复制失败',
      saveAnnotation: '保存',
      asking: '等待回答…',
      again: '再问一次',
      collapse: '收起',
      collapseHint: '拖动可移动',
      foldHint: '点击收起为圆形按钮',
      expand: '展开 dsh-nudge 窗口',
      statusIdle: '未询问',
      statusWaiting: '等待中',
      statusDone: '已返回',
      statusError: '失败',
      mode: '发送方式',
      queue: '排队',
      steer: '直接打断',
      preset: '快捷输入',
      noSession: '没有打开的会话，无法询问。',
      waitingQuestion: 'agent 正在等待你的回答',
      transportMissing: '当前界面没有发送通道，无法发起询问。',
      deliveryFailed: '发送失败',
      sessionClosed: '会话已结束或已归档，无法询问。',
      badRequest: '发送内容被拒绝，无法询问。',
      timeoutNote: '等待回答超时（agent 可能仍在运行）。',
      stillRunningNote: 'agent 仍在运行，继续等待回答。',
      unconfirmedNote: '未能确认是否已回答，请查看对话。',
      noReceiptNote: '未收到发送确认（会话可能已归档或已结束）。',
      turnBlockedNote: '会话已归档或被阻止运行，本轮没有回答。',
      turnFailedNote: '本轮执行失败，没有拿到回答。',
      turnAbortedNote: '本轮被中止，没有拿到回答。',
      noAnswerNote: '本轮没有产生回答。',
      newResult: '有新结果',
      settings: '发送方式',
      presetsHint: '点一下窗口里的快捷输入就能切换；设置只保存在本机。',
      presetList: '列表',
      presetsEmpty: '还没有快捷输入，点「新增快捷输入」加一条。',
      presetsAllDisabled: '快捷输入都已停用，可在设置里重新启用。',
      presetLabel: '名称',
      presetText: '发给 agent 的话',
      addPreset: '新增快捷输入',
      resetPresets: '恢复默认',
      deletePreset: '删除',
      presetCount: '共 {n} 条',
      presetEnabled: '已启用',
      presetDisabled: '已停用',
      presetEnabledHint: '已启用：显示在窗口的快捷输入里',
      presetDisabledHint: '已停用：保留在设置里，不在窗口显示',
      presetTextRequired: '内容不能为空。',
      expandAllPresets: '全部展开',
      collapseAllPresets: '全部折叠',
      editPreset: '编辑',
      savePreset: '保存',
      cancelPreset: '取消',
      dragPreset: '拖动排序；聚焦后按 ↑ ↓ 也能移动',
      editTip: '编辑这行文案',
      expandPreset: '展开正文',
      collapsePreset: '收起正文',
      importPresets: '批量导入',
      importHint: '每段空三行以上；第一行是名称，其余是内容。',
      importPlaceholder: '标题\n正文\n\n\n\n标题\n正文',
      importSubmit: '导入',
      importAdded: '已导入 {n} 条',
      importSkipped: '跳过 {n} 条（重复内容）',
      importEmpty: '没有识别出可导入的内容。',
      exportPresets: '批量导出',
      exportHint: '按「批量导入」的格式复制全部条目（含已停用）。',
      exportDone: '已复制 {n} 条到剪贴板',
      exportFailed: '复制失败，请检查浏览器的剪贴板权限。',
      exportEmpty: '还没有可导出的条目。',
      tipsTitle: '状态行',
      tipsHint: '窗口空闲时轮流显示；开关提示会停留 5 秒。',
      tipsCount: '共 {n} 句',
      tipsEmpty: '还没有文案。',
      tipsPlaceholder: '一句闲时提示',
      tipsPastePlaceholder: '粘贴整段会自动拆行；也可以一行一句，Ctrl+Enter 添加',
      tipsAdded: '已添加 {n} 句',
      tipsSkipped: '跳过 {n} 行空行、重复或超上限的行',
      addTip: '添加',
      resetTips: '恢复默认',
      deleteTip: '删除',
      tipLimit: '最多 20 句，先删一句再新增。',
      tipTextRequired: '文案不能为空。',
      tipLast: '至少保留一句。',
      statsTitle: '使用统计',
      statsHint: '按天记录快捷输入和批注，发送或写入都算一次快捷输入。只保存在本机。',
      statsToday: '今天',
      statsAnnotation: '批注',
      statsEmpty: '近 15 天还没有使用记录。',
      statsTimes: '近 15 天共 {n} 次',
      statsPeak: '单日最高 {n} 次',
      statsLegendInput: '快捷输入',
      statsTopTitle: '快捷输入 Top 3',
      statsTopEmpty: '近 15 天还没有用过快捷输入。',
      statsTopSince: '快捷输入明细从本次更新后开始记录。',
      statsTopShare: '这 3 条合计 {n} 次',
      statsCountUnit: '{n} 次',
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
      insertHint: 'Append the chosen quick input to the end of the input box',
      insertUnavailable: 'The input box is not ready; cannot insert the text.',
      modeInactive: 'Send mode does not apply when writing into the input box',
      turboTitle: 'Turbo mode',
      turboDesc: 'The send button is hidden; double-click a quick input to run it right away.',
      turboTip: 'Hides the send button; double-click a quick input to run it',
      switchOn: 'on',
      switchOff: 'off',
      answerLabel: 'My answer: ',
      annotationsTitle: 'Notes',
      annotationPlaceholder: 'Write a note, or leave it empty…',
      annotationsHint: 'Select text in the conversation and a note card opens beside it; notes are collected here.',
    highlightHint: 'Click a highlight in the conversation to edit its note or remove the mark.',
      annotationsOffHint: 'Quick notes are off; turn them on in the note header to add notes from a selection.',
      addAnnotation: 'Add note',
      asAnswer: 'Mark as answer',
      asAnswerHint: 'Mark it as the answer: highlight the whole passage, keep the selection as the note',
      dismissAnnotation: 'Cancel',
      deleteAnnotation: 'Remove highlight',
      editNoteHint: 'Enter saves · Shift+Enter starts a new line · Esc cancels',
      writeAnnotations: 'Write to input',
    writtenTag: 'Written',
      sendAnnotations: 'Send',
      quickOn: 'Quick notes: on',
      quickOff: 'Quick notes: off',
      quickTitle: 'Quick notes',
      quickHint: 'Selecting conversation text opens a note card; when off, a selection cannot add a note.',
      quickTip: 'Select text and the note card opens',
      autoPasteTitle: 'Auto-paste notes',
      autoPasteDesc: 'When on, clicking into the input box writes pending notes into the draft and clears the pending list.',
      autoPasteTip: 'Clicking into the input box writes pending notes',
      tipOn: 'On',
      tipOff: 'Off',
      settingsTip: 'Open or close the settings panel in this window',
      autoPasteOn: 'Auto-paste notes: on',
      autoPasteOff: 'Auto-paste notes: off',
      appearanceTitle: 'Appearance',
      frameTitle: 'Window border',
      frameDesc: 'How thick the floating window outline is.',
      frameNone: 'None',
      frameThin: 'Thin',
      frameNormal: 'Standard',
      frameThick: 'Thick',
      copyHint: 'copy this passage',
      deliveryTitle: 'Send mode',
      deliveryDesc: 'Interrupt stops the current answer; Queue waits for the turn to finish.',
      deliveryTipSteer: 'Sending stops the current answer right away',
      deliveryTipQueue: 'Sending waits for the running turn to finish',
      sortUp: 'Move up',
      sortDown: 'Move down',
      nudgeModule: 'Quick input',
      quickAdd: 'Add',
      quickAddTitle: 'Title',
      quickAddBody: 'Body',
      quickEdit: 'Edit',
      quickEditHint: 'Edit quick inputs: drag to reorder, click one to change it',
      editChipHint: 'Drag to reorder, click to edit; focus and press ← / → to move, Enter to edit',
      editPresetHead: 'Edit quick input',
      collapseAnnotations: 'Collapse notes',
      expandAnnotations: 'Expand notes',
      collapseNudge: 'Collapse quick input',
      expandNudge: 'Expand quick input',
      agree: 'Agree',
      agreeThis: 'Agree with this',
      disagree: 'Disagree',
      disagreeThis: 'Disagree with this',
      copyQuote: 'Copy text',
      copied: 'The passage was copied to the clipboard.',
      copyFailed: 'Could not copy; select and copy it manually.',
      copiedShort: 'Copied',
      copyFailedShort: 'Copy failed',
      saveAnnotation: 'Save',
      asking: 'Waiting…',
      again: 'Ask again',
      collapse: 'Collapse',
      collapseHint: 'Drag to move',
      foldHint: 'Click to fold into a round button',
      expand: 'Expand the dsh-nudge window',
      statusIdle: 'Not asked',
      statusWaiting: 'Waiting',
      statusDone: 'Answered',
      statusError: 'Failed',
      mode: 'Send mode',
      queue: 'Queue',
      steer: 'Interrupt',
      preset: 'Quick input',
      noSession: 'No open conversation to ask.',
      waitingQuestion: 'The agent is waiting for your answer',
      transportMissing: 'This page has no send channel, so the request cannot be sent.',
      deliveryFailed: 'Send failed',
      sessionClosed: 'This session has ended or been archived; it cannot be asked.',
      badRequest: 'The message was rejected.',
      timeoutNote: 'Timed out waiting for the answer (the agent may still be running).',
      stillRunningNote: 'The agent is still running; still waiting for the answer.',
      unconfirmedNote: 'Could not confirm whether the answer arrived; check the conversation.',
      noReceiptNote: 'No send confirmation was received (the session may be archived or closed).',
      turnBlockedNote: 'This session is archived or blocked, so the turn produced no answer.',
      turnFailedNote: 'The turn failed, so no answer arrived.',
      turnAbortedNote: 'The turn was aborted, so no answer arrived.',
      noAnswerNote: 'The turn produced no answer.',
      newResult: 'New result',
      settings: 'Send mode',
      presetsHint: 'Click a quick input in the window to switch; settings stay on this machine.',
      presetList: 'List',
      presetsEmpty: 'No quick inputs yet; add one.',
      presetsAllDisabled: 'Every quick input is disabled. Re-enable one in settings.',
      presetLabel: 'Name',
      presetText: 'What the agent receives',
      addPreset: 'Add quick input',
      resetPresets: 'Reset defaults',
      deletePreset: 'Delete',
      presetCount: '{n} total',
      presetEnabled: 'Enabled',
      presetDisabled: 'Disabled',
      presetEnabledHint: 'Enabled: shown in the window quick input',
      presetDisabledHint: 'Disabled: kept in settings, hidden from the window',
      presetTextRequired: 'The text cannot be empty.',
      expandAllPresets: 'Expand all',
      collapseAllPresets: 'Collapse all',
      editPreset: 'Edit',
      savePreset: 'Save',
      cancelPreset: 'Cancel',
      dragPreset: 'Drag to reorder; focus and press ↑ / ↓ to move',
      editTip: 'Edit this line',
      expandPreset: 'Show the text',
      collapsePreset: 'Hide the text',
      importPresets: 'Import',
      importHint: 'Separate entries with three or more blank lines; the first line is the name, the rest is the text.',
      importPlaceholder: 'Name\nText\n\n\n\nName\nText',
      importSubmit: 'Import',
      importAdded: 'Imported {n}',
      importSkipped: 'skipped {n} (duplicate text)',
      importEmpty: 'Nothing to import was found.',
      exportPresets: 'Export',
      exportHint: 'Copy every entry in the import format, including disabled ones.',
      exportDone: 'Copied {n} to the clipboard',
      exportFailed: 'Copy failed; check the browser clipboard permission.',
      exportEmpty: 'There is nothing to export yet.',
      tipsTitle: 'Status line',
      tipsHint: 'Rotates while the window is idle; switch messages hold for 5 seconds.',
      tipsCount: '{n} lines',
      tipsEmpty: 'No lines yet.',
      tipsPlaceholder: 'One idle line',
      tipsPastePlaceholder: 'Paste a block and it splits per line; Ctrl+Enter adds a line',
      tipsAdded: 'Added {n} lines',
      tipsSkipped: 'skipped {n} blank, duplicate or over-limit lines',
      addTip: 'Add',
      resetTips: 'Reset defaults',
      deleteTip: 'Delete',
      tipLimit: 'At most 20 lines; delete one first.',
      tipTextRequired: 'The line cannot be empty.',
      tipLast: 'Keep at least one line.',
      statsTitle: 'Usage',
      statsHint: 'Daily counts of quick inputs (sent or written) and notes. Kept on this machine only.',
      statsToday: 'Today',
      statsAnnotation: 'Notes',
      statsEmpty: 'No usage in the last 15 days.',
      statsTimes: '{n} in 15 days',
      statsPeak: 'Peak {n} a day',
      statsLegendInput: 'Quick input',
      statsTopTitle: 'Top 3 quick inputs',
      statsTopEmpty: 'No quick input used in the last 15 days.',
      statsTopSince: 'Per-item detail starts with this update.',
      statsTopShare: '{n} uses for these 3',
      statsCountUnit: '{n} uses',
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
      // The per-character `trim()` test this replaces kept exactly the
      // non-whitespace code units; one regular expression is much cheaper on
      // the long quotes and long rows this runs over.
      return (typeof value === 'string' ? value : '').replace(/\s+/g, '')
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

    /**
     * Tags whose text reads as one passage. A selection inside one of these is
     * promoted to the whole block, so the highlight covers the paragraph the
     * words sit in rather than the words alone.
     */
    const PASSAGE_TAGS = {
      P: true,
      LI: true,
      H1: true,
      H2: true,
      H3: true,
      H4: true,
      H5: true,
      H6: true,
      BLOCKQUOTE: true,
      PRE: true,
      TD: true,
      TH: true,
      DT: true,
      DD: true,
      FIGCAPTION: true,
    }

    /** Whether a range touches one node; a node that cannot be asked is skipped. */
    function rangeTouches(range, node) {
      try {
        return typeof range.intersectsNode === 'function' && range.intersectsNode(node) === true
      } catch {
        return false
      }
    }

    /** The innermost passage tag between a node and its flow item. */
    function passageBlockOf(node, flowItem) {
      let element = elementOfNode(node)
      while (element !== null && element !== flowItem) {
        if (PASSAGE_TAGS[String(element.tagName ?? '').toUpperCase()] === true) return element
        element = element.parentElement ?? null
      }
      return flowItem
    }

    /** The text one block carries, with only its trailing whitespace dropped. */
    function blockTextOf(block) {
      let text = ''
      const walk = (node) => {
        for (const child of node.childNodes ?? []) {
          if (child.nodeType === 3) text += child.data ?? ''
          else if (child.nodeType === 1 && !isHiddenElement(child)) walk(child)
        }
      }
      walk(block)
      return text.replace(/\s+$/, '')
    }

    /**
     * The whole passages a selection touches, in document order.
     *
     * A selection inside a paragraph names that paragraph; one crossing several
     * names all of them. The innermost block wins, so a list item wrapping a
     * paragraph contributes its words once, and a flow item that carries no
     * block of its own stands for its whole text.
     */
    function passagesOfRange(range) {
      const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
      const blocks = []
      for (const element of elements) {
        const walk = (node) => {
          for (const child of node.childNodes ?? []) {
            if (child.nodeType === 3) {
              if (!rangeTouches(range, child)) continue
              const block = passageBlockOf(child, element)
              if (!blocks.includes(block)) blocks.push(block)
            } else if (child.nodeType === 1 && !isHiddenElement(child)) {
              walk(child)
            }
          }
        }
        walk(element)
      }
      const innermost = blocks.filter(
        (block) => !blocks.some((other) => other !== block && block.contains?.(other) === true),
      )
      const texts = innermost.map(blockTextOf).filter((text) => text.trim() !== '')
      return texts.length === 0 ? '' : texts.join('\n\n')
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

    /**
     * The anchor a quote hangs on when no live selection is left: the innermost
     * flow item whose projection carries the passage.
     *
     * This is the recovery path, not the primary one — the anchor of a fresh
     * selection comes from the range. A passage carried by two unrelated flow
     * items stays unanchored, because painting the wrong one is worse than
     * painting none.
     */
    function anchorFromQuote(quote) {
      const packed = packedText(quote)
      if (packed === '') return null
      const elements = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
      const matches = []
      for (const element of elements) {
        const key = element.getAttribute?.('data-chat-anchor-key')
        if (typeof key !== 'string' || key === '') continue
        const full = packedMapOf(element)
        const index = full.packed.indexOf(packed)
        if (index === -1) continue
        matches.push({ element, key, full, index })
      }
      // A turn-process row wraps its member rows, so the deepest match is the
      // one the passage really belongs to.
      const deepest = matches.filter(
        (match) =>
          !matches.some(
            (other) => other !== match && match.element.contains?.(other.element) === true,
          ),
      )
      if (deepest.length !== 1) return null
      const { key, full, index } = deepest[0]
      return {
        key,
        quote: packed,
        prefix: full.packed.slice(Math.max(0, index - CONTEXT_CHARS), index),
        suffix: full.packed.slice(index + packed.length, index + packed.length + CONTEXT_CHARS),
        index,
      }
    }

    /** Whether a painted highlight already covers exactly these ranges, in order. */
    function sameRanges(highlight, ranges) {
      if (!highlight || typeof highlight[Symbol.iterator] !== 'function') return false
      const current = [...highlight]
      if (current.length !== ranges.length) return false
      return current.every((range, index) => {
        const next = ranges[index]
        return (
          range.collapsed !== true &&
          range.startContainer === next.startContainer &&
          range.startOffset === next.startOffset &&
          range.endContainer === next.endContainer &&
          range.endOffset === next.endOffset
        )
      })
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
            noteSettingsWrite()
          },
          removeItem: (key) => {
            raw.removeItem(key)
            noteSettingsWrite()
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

    /**
     * The insertion point a pointer at (`x`, `y`) asks for among `boxes`,
     * counting every box it has passed in reading order: top to bottom, then
     * left to right. The boxes must be frozen for the whole drag — re-reading
     * them after a reorder is what made a wide chip re-wrap the row and flip the
     * slot back and forth under a still pointer.
     * @param boxes - `{ id, left, top, width, height }` in reading order.
     * @param id - the dragged chip, which is not a slot of its own.
     */
    function chipSlotAt(boxes, id, x, y) {
      let index = 0
      for (const box of boxes) {
        if (box.id === id) continue
        const below = y > box.top + box.height
        const sameRow = y >= box.top && y <= box.top + box.height
        if (below || (sameRow && x > box.left + box.width / 2)) index += 1
      }
      return index
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
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const height = collapsed ? PILL_SIZE : 220
      return {
        x: Math.round(clamp(vp.width - width - rightInset(), 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(DOCK_TOP, 8, Math.max(8, vp.height - height - 8))),
      }
    }

    /** Clamp one stored position into the current viewport. */
    function clampPoint(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const height = collapsed ? PILL_SIZE : Math.min(360, Math.max(180, vp.height - COMPOSER_RESERVE - 16))
      const maxY = collapsed
        ? Math.max(8, vp.height - height - 8)
        : Math.max(8, vp.height - height - COMPOSER_RESERVE)
      return {
        x: Math.round(clamp(point.x, 8, Math.max(8, vp.width - width - 8))),
        y: Math.round(clamp(point.y, 8, maxY)),
      }
    }

    /** Whether the window sits closer to the left edge than to the right one. */
    function nearestEdge(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      return point.x + width / 2 <= vp.width / 2 ? 'left' : 'right'
    }

    /**
     * Pin a stored point to the side it belongs to.
     *
     * Only the vertical spot is the user's: the horizontal one is the edge, so
     * a window left somewhere in the middle of a wider or narrower screen still
     * comes back on a side instead of floating over the conversation.
     */
    function snapToEdge(point, collapsed) {
      const vp = viewport()
      const width = collapsed ? PILL_SIZE : CARD_WIDTH
      const edge = nearestEdge(point, collapsed)
      const x = edge === 'left' ? EDGE : vp.width - width - rightInset()
      return clampPoint({ x, y: point.y }, collapsed)
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

    /**
     * A DOMRect-like box as plain numbers, or null when it is not a usable box.
     * The in-place editor keeps one of these instead of a live DOMRect, so a
     * re-render never reads geometry off a detached node.
     */
    function rectValue(box) {
      if (box === null || typeof box !== 'object') return null
      const left = Number(box.left)
      const top = Number(box.top)
      const right = Number(box.right)
      const bottom = Number(box.bottom)
      const width = Number.isFinite(Number(box.width)) ? Number(box.width) : right - left
      const height = Number.isFinite(Number(box.height)) ? Number(box.height) : bottom - top
      const values = [left, top, right, bottom, width, height]
      if (values.some((value) => Number.isFinite(value) === false)) return null
      return { left, top, right, bottom, width, height }
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
      const initialTarget = resolveTarget(ctx)
      // Every persisted preference comes from the settings table, so the launch
      // state and a later restore cannot drift apart.
      const savedSettings = readSettings({ lang: language, sessionId: initialTarget?.sessionId })

      /**
       * The annotation surface at rest: no draft, nothing stowed, no editor, no
       * half-typed note. The launch state and every closing transition spread
       * this instead of listing the fields again, so a field added to the
       * surface is reset in one place.
       */
      const IDLE_ANNOTATION = {
        annotationDraft: null,
        annotationCardHidden: false,
        annotationNote: '',
        annotationEditingId: null,
        annotationEditRect: null,
      }
      /**
       * The window's direct-edit surface for the quick inputs: whether the 编辑
       * chip is armed, which entry's form is open, and the form's fields. One
       * object so leaving the mode clears every part of it at once.
       */
      const IDLE_NUDGE_EDIT = {
        nudgeEditing: false,
        nudgeEditId: null,
        nudgeEditLabel: '',
        nudgeEditText: '',
        nudgeEditError: '',
      }

      let state = {
        phase: 'idle',
        note: '',
        error: '',
        /** Short-lived confirmation of a toggle, cleared on a timer. */
        flash: '',
        lastAt: undefined,
        lastSessionId: undefined,
        unread: false,
        // Every launch starts as the pill: the window is a reminder to look at
        // the conversation, not a panel to close first.
        collapsed: true,
        // One anchor for both shapes: collapsing keeps the window in place and
        // expanding returns it to the same spot. The stored record only says
        // how far down it sat and which side it was on.
        pos: isPoint(saved.pos) ? snapToEdge(saved.pos, true) : dockPosition(true),
        /**
         * Every persisted preference — the three switches, the delivery mode,
         * the border width, the prompts and the chosen one, the idle lines, the
         * counters and the collected notes — arrives from the settings table by
         * field name, so the launch state cannot miss a row.
         */
        ...savedSettings,
        /** Ids whose body is expanded in the settings list. */
        presetOpen: [],
        /** The preset opened in the settings editor, or null. */
        presetEditingId: null,
        target: initialTarget,
        pendingQuestion: false,
        /** True while the conversation composer is mounted and holds the caret. */
        composerFocused: false,
        /** Which idle line is showing; not persisted, so the launch restarts at the first. */
        tipIndex: 0,
        /** The idle line opened in its editor, or null. */
        tipEditingIndex: null,
        /**
         * The annotation surface: the selection being annotated, whether its
         * card is stowed, the note being written, and the collected note opened
         * in the editor. A card and an editor never coexist.
         */
        ...IDLE_ANNOTATION,
        /** Whether the annotation module shows its body (row summary when false). */
        annotationExpanded: false,
        /** Whether the nudge module (prompts / mode / primary) shows its body. */
        nudgeExpanded: true,
        /** The in-window "new prompt" form (title + body). */
        nudgeDraftOpen: false,
        nudgeDraftLabel: '',
        nudgeDraftText: '',
        nudgeDraftError: '',
        ...IDLE_NUDGE_EDIT,
        /** Whether the window shows the settings form in place of its body. */
        settingsOpen: false,
        /** Timestamp of the last capture, used to restart the attention pulse. */
        attentionAt: 0,
        /** The window control whose explanation bubble is showing, or null. */
        tip: null,
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
        const preset = activePreset()
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
        countStat('insert', preset.id)
        return true
      }

      // --- annotations ----------------------------------------------------

      /** A field being edited, a modal, and this window are never quoted. */
      const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
      const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [data-shortcut-modal]'

      /** Trim only the trailing whitespace a selection picks up. */
      function tidyQuote(value) {
        return String(value ?? '').replace(/\s+$/, '')
      }

      /**
       * One passage as the Markdown blockquote the shell serializes a quote
       * node to; text copied out of the composer keeps this form.
       */
      function quoteMarkdown(value) {
        const lines = tidyQuote(value).split('\n')
        return lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
      }

      /** The answer line under a passage, or '' when the passage stands alone. */
      function annotationNoteLine(item) {
        const note = typeof item.note === 'string' ? item.note.trim() : ''
        return note === '' ? '' : `${text('answerLabel')}${note}`
      }

      /**
       * One annotation as the Markdown block it becomes when it is sent: the
       * quote on its own lines, the answer on the line right below it.
       */
      function annotationBlock(item) {
        const quoted = quoteMarkdown(item.quote)
        const note = annotationNoteLine(item)
        return note === '' ? quoted : `${quoted}\n${note}`
      }

      /** The annotations still waiting to be written into a message. */
      function pendingAnnotations() {
        return state.annotations.filter((item) => item.written !== true)
      }

      // --- the annotation lifecycle ---------------------------------------
      //
      // Three surfaces share one state: the selection card (a draft), the
      // in-place editor (one stored note) and the tray (the Session's notes). A
      // card and an editor never coexist, and every path that ends one of them
      // returns the same fields to rest — so the resting surface is written
      // down once here, and a tray change is persisted and repainted in one
      // step, instead of each transition spelling out its own subset.

      /** One surface change: show it, then repaint the marks it implies. */
      function settleAnnotation(patch) {
        setState(patch)
        repaintHighlights()
      }

      /** Return the surface to rest; the tray list is left as it is. */
      function closeAnnotationSurface(extra) {
        settleAnnotation({ ...IDLE_ANNOTATION, ...(extra ?? {}) })
        return true
      }

      /**
       * Replace the tray: persist it, show it, repaint its marks. A mark belongs
       * to the conversation rather than to a draft, so the list and its painting
       * can never drift apart.
       */
      function commitAnnotations(next, extra) {
        persistNotes(next)
        settleAnnotation({ annotations: next, ...IDLE_ANNOTATION, ...(extra ?? {}) })
        return next
      }

      /** Whether one DOM node belongs to this window rather than to the page. */
      function isSelfNode(node) {
        if (!node || typeof node.closest !== 'function') return false
        try {
          return node.closest(SELF_SELECTOR) !== null
        } catch {
          return false
        }
      }

      /** One write or send batch as one message body, notes two blank lines apart. */
      function annotationsText(list) {
        const items = Array.isArray(list) ? list : pendingAnnotations()
        return items.map(annotationBlock).join('\n\n\n')
      }

      /**
       * The break a Markdown block needs in front of it: two blank lines, so a
       * note reads as a block of its own in the draft instead of running on from
       * whatever it is appended to. A draft already ending with them gets no more.
       */
      function blockBreak(before) {
        if (before === '') return ''
        if (before.endsWith('\n\n\n')) return ''
        if (before.endsWith('\n\n')) return '\n'
        return before.endsWith('\n') ? '\n\n' : '\n\n\n'
      }

      /** Whether a node belongs to a text field rather than the transcript. */
      function inEditable(node) {
        if (!node || typeof node.closest !== 'function') return false
        try {
          return node.closest(EDITABLE_SELECTOR) !== null
        } catch {
          return false
        }
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
          // The browser keeps two ends: `anchor` is where the gesture started,
          // `focus` is where it ended. The native Shift+click grows from the
          // anchor, so a downward drag extends forward and an upward drag
          // extends backward. Both are kept while the range still points at
          // live nodes.
          let anchorPoint = null
          let focusPoint = null
          try {
            if (selection.anchorNode) {
              anchorPoint = { node: selection.anchorNode, offset: selection.anchorOffset }
            }
            if (selection.focusNode) {
              focusPoint = { node: selection.focusNode, offset: selection.focusOffset }
            }
          } catch {
            anchorPoint = null
            focusPoint = null
          }
          return { quote, range, anchorPoint, focusPoint }
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
      /**
       * Anchors recovered by quote instead of by key, keyed by note id.
       *
       * A stored key stops naming an element when the row is recycled under
       * another key; the healed anchor keeps the next repaint on the direct path
       * instead of re-walking every flow item again.
       */
      const resolvedAnchors = new Map()
      /**
       * Bumped when flow items are added, removed or re-keyed.
       *
       * A note whose stored row is gone can only find its passage again after
       * one of those, so the whole-transcript search waits for this to change
       * instead of running on every repaint of a streaming turn.
       */
      let anchorEpoch = 0
      /** Flow-item generation of the last search, and when it ran. */
      let searchEpoch = -1
      let searchAt = 0
      /** Quote → `{ anchor, epoch, at }` for notes that carry no anchor of their own. */
      const quoteAnchors = new Map()
      /** True while a pointer gesture is down, so no card opens mid-drag. */
      let pointerHeld = false

      /** Forget every recovered anchor; the next repaint starts from the stored ones. */
      function resetAnchorRecovery() {
        resolvedAnchors.clear()
        quoteAnchors.clear()
        searchEpoch = -1
        searchAt = 0
      }

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

      /**
       * Keyboard selections end on a shifted keyup — in the transcript only.
       *
       * Shift+Enter makes a newline and Shift+<letter> capitalises, so a keyup
       * inside a text field is typing, not a selection gesture. Capturing it
       * would read a caret as a passage and pull the card (and the focus) over
       * the field the user is typing in.
       */
      function onSelectionKeyup(event) {
        if (state.quick !== true) return
        if (event?.shiftKey !== true) return
        if (inEditable(event?.target)) return
        if (inEditable(document.activeElement)) return
        captureSelectionLater()
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
        // Anchor now, while the range still points at the nodes the user just
        // selected. Waiting for the click would gamble on the page not having
        // re-rendered in between, and a lost anchor means no highlight ever.
        let anchor = null
        try {
          anchor = anchorFromRange(selection.range, selection.quote)
        } catch {
          anchor = null
        }
        settleAnnotation({
          ...IDLE_ANNOTATION,
          annotationDraft: {
            quote: selection.quote,
            anchor,
            range: selection.range,
            // The gesture's start end: Shift+press grows away from it, so an
            // upward selection keeps its lower edge and an upward press extends
            // further up instead of dropping the rows already selected.
            anchorPoint: selection.anchorPoint,
            rect: rect
              ? {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                }
              : null,
            pointer,
          },
          note: '',
          error: '',
        })
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
        persistSetting('quick', next)
        settleAnnotation({
          quick: next,
          // The switch no longer unfolds the tray (its open state belongs to the
          // user); turning it off still drops whatever the tray was holding.
          ...(next ? null : { ...IDLE_ANNOTATION, annotationExpanded: false }),
        })
        notify(next ? text('quickOn') : text('quickOff'))
        return true
      }

      /** Auto-paste switch: when on, pending notes flow into the composer on focus. */
      function setAutoPaste(value) {
        const next = value === true
        persistSetting('autoPaste', next)
        setState({ autoPaste: next })
        notify(next ? text('autoPasteOn') : text('autoPasteOff'))
        return true
      }

      /**
       * Show the explanation bubble for one window control. `rect` is the
       * control's viewport box, kept as numbers so the renderer only has to
       * place the bubble; the text is derived from the live state, so a toggle
       * updates the bubble without moving the pointer.
       */
      function showTip(key, rect) {
        if (typeof key !== 'string' || key === '') return false
        const box = rect && typeof rect === 'object' ? rect : null
        const left = box === null ? NaN : Number(box.left)
        const top = box === null ? NaN : Number(box.top)
        const right = box === null ? NaN : Number(box.right)
        const bottom = box === null ? NaN : Number(box.bottom)
        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
          return false
        }
        setState({ tip: { key, left, top, right, bottom } })
        return true
      }

      /** Hide the explanation bubble. */
      function hideTip() {
        if (state.tip !== null) setState({ tip: null })
        return true
      }

      /** Border width of the floating window, in px; the default is not stored. */
      function setFrame(value) {
        const width = Number(value)
        if (!isFrameWidth(width)) return false
        persistSetting('frame', width)
        setState({ frame: width })
        notify(`${text('frameTitle')}：${text(frameLabelKey(width))}`)
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
        // The capture already anchored the passage; the two retries cover a page
        // that re-rendered between the selection and this click. Whatever still
        // fails leaves a diagnostic sample, because a note without an anchor
        // shows up only as a highlight that never appears.
        let anchor = typeof draft.anchor?.key === 'string' ? draft.anchor : null
        if (anchor === null && draft.range != null) {
          try {
            anchor = anchorFromRange(draft.range, draft.quote)
          } catch {
            anchor = null
          }
        }
        if (anchor === null) anchor = anchorFromQuote(draft.quote)
        if (anchor === null) recordAnchorMiss(draft.quote)
        const annotation = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          quote: draft.quote,
          note,
          anchor,
        }
        const next = [...state.annotations, annotation]
        clearNativeSelection(draft.quote)
        // Only the text clears. A note landing never opens or resizes the tray:
        // the window keeps its shape while several passages are annotated.
        commitAnnotations(next, { note: '', error: '' })
        countStat('annotation')
        return true
      }

      /**
       * Commit the captured passage as an answer.
       *
       * The highlight covers the whole paragraph(s) the selection sits in, and
       * the selected words become the note itself — the note says "this is the
       * answer" without the user retyping it.
       */
      function markAsAnswer() {
        const draft = state.annotationDraft
        if (!draft || typeof draft.quote !== 'string' || draft.quote.trim() === '') return false
        let quote = draft.quote
        if (draft.range != null) {
          try {
            quote = passagesOfRange(draft.range) || draft.quote
          } catch {
            quote = draft.quote
          }
        }
        let anchor = null
        if (draft.range != null) {
          try {
            anchor = anchorFromRange(draft.range, quote)
          } catch {
            anchor = null
          }
        }
        if (anchor === null) anchor = anchorFromQuote(quote)
        if (anchor === null) recordAnchorMiss(quote)
        // Where the marked words sit inside the highlighted paragraph, in the
        // same whitespace-free projection the anchor uses. The purple span is
        // measured from it, so the mark survives a note edit.
        const packed = packedText(quote)
        const packedAnswer = packedText(draft.quote)
        const at = packedAnswer === '' ? -1 : packed.indexOf(packedAnswer)
        const annotation = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          quote,
          note: draft.quote,
          anchor,
          answer: at === -1 ? true : { start: at, length: packedAnswer.length },
        }
        // One answer per passage: marking the same block again replaces the
        // earlier note instead of stacking an identical highlight.
        const next = [
          ...state.annotations.filter((item) => packedText(item.quote) !== packed),
          annotation,
        ]
        clearNativeSelection(draft.quote)
        commitAnnotations(next, { note: '', error: '' })
        countStat('annotation')
        return true
      }

      /**
       * Add the captured passage with the 同意 / 不同意 answer. A remark typed
       * in the card is kept: the verdict comes first, then the remark.
       */
      function quickReply(kind) {
        const verdict = kind === 'agree' ? text('agree') : text('disagree')
        const remark = typeof state.annotationNote === 'string' ? state.annotationNote.trim() : ''
        return addAnnotation(remark === '' || remark === verdict ? verdict : `${verdict}，${remark}`)
      }

      /** Drop the pending annotation draft without adding it. */
      function dismissAnnotationDraft() {
        return closeAnnotationSurface()
      }

      /**
       * Open one collected annotation in the in-place bubble.
       *
       * `rect` is the viewport box the bubble hangs off: the clicked passage,
       * or the tray row that was clicked. The window itself is left alone —
       * editing a mark must never resize or unfold it.
       */
      function startEditAnnotation(id, rect = null) {
        const item = state.annotations.find((candidate) => candidate.id === id)
        if (item === undefined) return false
        const box = rectValue(rect)
        if (state.annotationEditingId === id) {
          // Clicking the same mark again only moves the bubble: whatever is
          // already typed stays in the field.
          settleAnnotation({ annotationEditRect: box })
          return true
        }
        settleAnnotation({
          ...IDLE_ANNOTATION,
          annotationEditingId: id,
          annotationEditRect: box,
          annotationNote: typeof item.note === 'string' ? item.note : '',
          note: '',
          error: '',
        })
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
        commitAnnotations(next, { note: '', error: '' })
        return true
      }

      /** Leave the edit without saving. */
      function cancelAnnotationEdit() {
        return closeAnnotationSurface()
      }

      /** Remove one collected annotation (also used from the edit body). */
      function removeAnnotation(id) {
        const next = state.annotations.filter((item) => item.id !== id)
        if (next.length === state.annotations.length) return false
        // Removing the note under the editor closes it; removing any other note
        // leaves the editor and whatever was typed in it alone.
        persistNotes(next)
        if (state.annotationEditingId === id) closeAnnotationSurface({ annotations: next })
        else settleAnnotation({ annotations: next })
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


      /**
       * Whether this pass may search the whole transcript for a passage whose
       * row is gone.
       *
       * The transcript re-renders per token, so a repaint runs every 120 ms
       * while the agent streams. Searching every flow item's text on each one
       * is what made a long conversation stutter: the search is allowed once
       * per generation of flow items, and at most once per MISS_RESCAN_MS.
       */
      function canSearchAnchors(now) {
        return anchorEpoch !== searchEpoch || now - searchAt >= MISS_RESCAN_MS
      }

      /** Record that this pass searched; later passes wait for the next change. */
      function noteAnchorSearch(now) {
        searchEpoch = anchorEpoch
        searchAt = now
      }

      /**
       * The anchor of a note that carries none of its own, resolved by quote.
       * Cached per flow-item generation, so a passage that is still absent is
       * not looked for again on every repaint.
       */
      function anchorOfQuote(quote, canSearch, now) {
        const cached = quoteAnchors.get(quote)
        // A result is good for one flow-item generation, and no longer than the
        // retry window: the passage can appear inside a row that already exists.
        const fresh =
          cached !== undefined && cached.epoch === anchorEpoch && now - cached.at < MISS_RESCAN_MS
        if (fresh) return cached.anchor
        if (!canSearch) return cached === undefined ? null : cached.anchor
        const anchor = anchorFromQuote(quote)
        quoteAnchors.set(quote, { anchor, epoch: anchorEpoch, at: now })
        noteAnchorSearch(now)
        return anchor
      }

      /**
       * Paint a note whose stored offsets went stale while its text still sits
       * in the same row. Only an unambiguous passage is painted here; an
       * ambiguous one falls through to the recovery pass, which can prove the
       * row is the only carrier.
       */
      function spanWithinElement(entry, key, full) {
        const packed = packedText(entry.anchor.quote)
        if (packed === '') return null
        const at = full.packed.indexOf(packed)
        if (at === -1) return null
        if (full.packed.indexOf(packed, at + 1) !== -1) return null
        if (rangeFromPacked(full, at, at + packed.length) === null) return null
        if (entry.note !== null && typeof entry.note?.id === 'string') {
          resolvedAnchors.set(entry.note.id, {
            key,
            quote: packed,
            prefix: full.packed.slice(Math.max(0, at - CONTEXT_CHARS), at),
            suffix: full.packed.slice(at + packed.length, at + packed.length + CONTEXT_CHARS),
            index: at,
          })
        }
        return { start: at, end: at + packed.length }
      }

      /** Recompute which spans carry a note and repaint the CSS highlight. */
      function repaintHighlights() {
        highlighted = []
        const registry = window.CSS?.highlights
        if (registry === undefined) return
        try {
          const captureDraft = state.annotationDraft
          const captureAnchor =
            captureDraft !== null && captureDraft.anchor != null ? captureDraft.anchor : null
          const sources = state.annotations
          if (state.quick !== true || (sources.length === 0 && captureDraft === null)) {
            registry.delete(HIGHLIGHT_NAME)
            registry.delete(ANSWER_HIGHLIGHT)
            registry.delete(CAPTURE_HIGHLIGHT)
            return
          }
          const byKey = new Map()
          const now = Date.now()
          const canSearch = canSearchAnchors(now)
          // Notes saved before this build (or while the page was mid-stream) can
          // carry no anchor. The quote still identifies the passage, so resolve
          // it once per distinct quote and never draw a guess.
          const recovered = new Map()
          for (const note of sources) {
            let anchor = resolvedAnchors.get(note.id) ?? note.anchor
            if (typeof anchor?.key !== 'string') {
              const quote = typeof note.quote === 'string' ? note.quote : ''
              if (!recovered.has(quote)) recovered.set(quote, anchorOfQuote(quote, canSearch, now))
              anchor = recovered.get(quote)
            }
            if (anchor === null || typeof anchor !== 'object' || typeof anchor.key !== 'string') continue
            // A note without an anchor of its own keeps the one found here, so
            // the next repaint takes the direct path instead of asking again.
            if (typeof note.id === 'string') resolvedAnchors.set(note.id, anchor)
            if (!byKey.has(anchor.key)) byKey.set(anchor.key, [])
            byKey.get(anchor.key).push({ note, anchor, capture: false })
          }
          if (captureAnchor !== null && typeof captureAnchor.key === 'string') {
            if (!byKey.has(captureAnchor.key)) byKey.set(captureAnchor.key, [])
            byKey.get(captureAnchor.key).push({ note: null, anchor: captureAnchor, capture: true })
          }
          if (byKey.size === 0) {
            registry.delete(HIGHLIGHT_NAME)
            registry.delete(ANSWER_HIGHLIGHT)
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
          const answerRanges = []
          const captureRanges = []
          const misses = []
          /**
           * Put one note's passage into the paint lists.
           *
           * An answer note splits its paragraph around the words that were
           * marked: the paragraph stays yellow before and after them, and only
           * that span is purple. Splitting instead of stacking two highlights
           * keeps the result independent of registry paint order.
           */
          function paintNote(entry, full, start, end) {
            const painted = []
            const answer = entry.note?.answer
            const from = typeof answer?.start === 'number' ? answer.start : -1
            const length = typeof answer?.length === 'number' ? answer.length : 0
            if (from < 0 || length <= 0) {
              const range = rangeFromPacked(full, start, end)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
              return painted
            }
            const answerStart = Math.max(start, Math.min(start + from, end))
            const answerEnd = Math.max(answerStart, Math.min(answerStart + length, end))
            if (answerStart > start) {
              const range = rangeFromPacked(full, start, answerStart)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
            }
            if (answerEnd < end) {
              const range = rangeFromPacked(full, answerEnd, end)
              if (range !== null) {
                ranges.push(range)
                painted.push(range)
              }
            }
            const purple = rangeFromPacked(full, answerStart, answerEnd)
            if (purple !== null) {
              answerRanges.push(purple)
              painted.push(purple)
            }
            return painted
          }
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
              // The row is here but the stored offsets drifted: the passage is
              // still inside it, so heal it without searching the transcript.
              const span = locateAnchor(full, entry.anchor) ?? spanWithinElement(entry, key, full)
              if (span === null) {
                misses.push({ entry, quote: entry.anchor.quote })
                continue
              }
              if (entry.capture === true) {
                const range = rangeFromPacked(full, span.start, span.end)
                if (range === null) {
                  misses.push({ entry, quote: entry.anchor.quote })
                  continue
                }
                captureRanges.push(range)
                continue
              }
              for (const range of paintNote(entry, full, span.start, span.end)) {
                highlighted.push({ note: entry.note, range })
              }
            }
          }
          // A key that names no element is the other half of the same problem:
          // the row was re-keyed between the click and this repaint. Both cases
          // fall through to one recovery pass over the quotes — the passage is
          // identified by its text, not by the row that happened to hold it.
          for (const [key, wanted] of byKey) {
            if (maps.has(key)) continue
            for (const entry of wanted) misses.push({ entry, quote: entry.anchor.quote })
          }
          // The search is the expensive pass: one per flow-item generation (or
          // per retry window), never once per repaint.
          if (canSearch && misses.length > 0) noteAnchorSearch(now)
          const searchable = canSearch ? misses : []
          for (const miss of searchable) {
            const packed = packedText(miss.quote)
            if (packed === '') continue
            const holders = []
            for (const element of elements) {
              const key = element.getAttribute?.('data-chat-anchor-key')
              if (typeof key !== 'string') continue
              let full = maps.get(key)
              if (full === undefined) {
                full = packedMapOf(element)
                maps.set(key, full)
              }
              if (full.packed.indexOf(packed) === -1) continue
              holders.push({ key, full })
            }
            // One holder or none: painting the wrong row is worse than letting
            // the mark wait for the render that brings its passage back.
            if (holders.length !== 1) continue
            const index = holders[0].full.packed.indexOf(packed)
            if (index === -1) continue
            if (miss.entry.capture === true) {
              const range = rangeFromPacked(holders[0].full, index, index + packed.length)
              if (range !== null) captureRanges.push(range)
              continue
            }
            for (const range of paintNote(miss.entry, holders[0].full, index, index + packed.length)) {
              highlighted.push({ note: miss.entry.note, range })
            }
            // Heal the anchor so the next repaint takes the direct path.
            if (miss.entry.note !== null && typeof miss.entry.note?.id === 'string') {
              resolvedAnchors.set(miss.entry.note.id, {
                key: holders[0].key,
                quote: packed,
                prefix: holders[0].full.packed.slice(Math.max(0, index - CONTEXT_CHARS), index),
                suffix: holders[0].full.packed.slice(index + packed.length, index + packed.length + CONTEXT_CHARS),
                index,
              })
            }
          }
          // An unchanged set keeps its Highlight: replacing it makes the browser
          // repaint every mark on the page for nothing.
          if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
          else if (!sameRanges(registry.get(HIGHLIGHT_NAME), ranges)) {
            registry.set(HIGHLIGHT_NAME, new window.Highlight(...ranges))
          }
          // Answer passages keep their own registry, so the stylesheet can give
          // them a different colour without touching a plain note's mark.
          if (answerRanges.length === 0) registry.delete(ANSWER_HIGHLIGHT)
          else if (!sameRanges(registry.get(ANSWER_HIGHLIGHT), answerRanges)) {
            registry.set(ANSWER_HIGHLIGHT, new window.Highlight(...answerRanges))
          }
          if (captureAnchor === null && captureDraft !== null && captureDraft.range) {
            try {
              if (captureDraft.range.collapsed !== true) captureRanges.push(captureDraft.range)
            } catch {
              /* stale range */
            }
          }
          if (captureRanges.length === 0) registry.delete(CAPTURE_HIGHLIGHT)
          else if (!sameRanges(registry.get(CAPTURE_HIGHLIGHT), captureRanges)) {
            registry.set(CAPTURE_HIGHLIGHT, new window.Highlight(...captureRanges))
          }
        } catch (error) {
          console.warn('[dsh-nudge] highlight repaint failed', error)
        }
      }

      /** Coalesce repaint triggers into one frame-ish task. */
      function scheduleRepaint() {
        if (repaintTimer !== undefined || state.quick !== true) return
        // Nothing painted and nothing being captured: a streaming transcript
        // mutates the DOM constantly, and this runs on every mutation.
        if (state.annotations.length === 0 && state.annotationDraft === null) return
        repaintTimer = setTimeout(() => {
          repaintTimer = undefined
          repaintHighlights()
        }, 120)
      }

      /**
       * Whether a painted mark lost its text. A mark is a live Range over the
       * transcript's text nodes; when the shell re-renders that row it swaps
       * in fresh nodes with the same text, the old range collapses, and the
       * passage shows unpainted until the next repaint.
       */
      function paintedMarkBroken() {
        for (const entry of highlighted) {
          try {
            const range = entry.range
            if (range.collapsed === true) return true
            if (range.startContainer?.isConnected === false) return true
          } catch {
            return true
          }
        }
        return false
      }

      /**
       * Whether one mutation record touches the transcript. A change that sits
       * in a flow item, or that brings one in or takes one away, can move a
       * mark; a change outside every flow item — this window, the shell's own
       * chrome — cannot, so it must not repaint.
       */
      function transcriptChanged(record) {
        let touched = false
        const target = record?.target
        const element = target?.nodeType === 1 ? target : (target?.parentElement ?? null)
        if (typeof element?.closest === 'function' && element.closest(ANCHOR_SELECTOR) !== null) {
          touched = true
        }
        for (const list of [record?.addedNodes, record?.removedNodes]) {
          for (const node of list ?? []) {
            if (node?.nodeType !== 1) continue
            if (node.matches?.(ANCHOR_SELECTOR) || node.querySelector?.(ANCHOR_SELECTOR)) touched = true
          }
        }
        return touched
      }

      /**
       * The page changed. Only a change to the transcript can move a mark, so
       * nothing else repaints. A broken mark is repainted right here: an
       * observer callback runs before the browser paints the frame, so the
       * passage never shows unpainted. Any other transcript change keeps the
       * debounce.
       */
      function onTranscriptMutation(records) {
        // A row that arrives, leaves or is re-keyed is also the only thing that
        // can bring back a passage whose row is gone.
        if (flowAnchorsChanged(records)) anchorEpoch += 1
        if (state.quick !== true) return
        let relevant = false
        for (const record of records ?? []) {
          if (transcriptChanged(record)) relevant = true
        }
        if (!relevant) return
        if (!paintedMarkBroken()) {
          scheduleRepaint()
          return
        }
        if (repaintTimer !== undefined) {
          clearTimeout(repaintTimer)
          repaintTimer = undefined
        }
        repaintHighlights()
      }

      /**
       * The annotated passage under a viewport point and the box the point hit,
       * or null. The box is what the in-place editor hangs off.
       */
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
              return { note: entry.note, rect: rectValue(rect) }
            }
          }
        }
        return null
      }

      /** Clicking a painted passage reopens its note for editing. */
      function onTranscriptClick(event) {
        if (state.quick !== true || highlighted.length === 0) return
        // Only a click that lands on a transcript row can reopen a note. A
        // click in the composer, a menu or a control belongs to something
        // else: taking its focus would put the next Enter in our editor.
        const target = event?.target
        if (!target || typeof target.closest !== 'function') return
        if (target.closest(ANCHOR_SELECTOR) === null) return
        if (inEditable(target)) return
        if (target.closest(MODAL_SELECTOR) !== null) return
        if (target.closest('button, a, input, textarea, select, [role="button"]') !== null) return
        try {
          const selection = window.getSelection?.()
          if (selection && selection.isCollapsed === false) return
        } catch {
          /* no selection object */
        }
        const hit = noteAtPoint(event.clientX, event.clientY)
        if (hit === null) return
        startEditAnnotation(hit.note.id, hit.rect)
      }

      /**
       * Whether a pointer that ended a selection is plausibly next to it.
       *
       * A `mouseup` is document-wide, so it can belong to a click that has
       * nothing to do with the live selection (a sidebar click that does not
       * collapse it, a drag that ends outside the transcript). Anchoring the
       * card to such a pointer puts it wherever that click happened; the quote
       * box is the only trustworthy anchor then.
       */
      function pointerNearRect(pointer, rect, slack = 24) {
        if (!pointer || !rect) return false
        return (
          pointer.x >= rect.left - slack &&
          pointer.x <= rect.right + slack &&
          pointer.y >= rect.top - slack &&
          pointer.y <= rect.bottom + slack
        )
      }

      /**
       * Viewport box for the selection card.
       *
       * A mouse selection ends on the release point, so the card opens above it
       * with its first button — 定为答案 — centred on that point: the next click
       * lands without moving the mouse. When the card does not fit above the
       * point, or the pointer belongs to a click elsewhere, it falls back to the
       * quote box, centred above/below it.
       */
      function popupPosition() {
        const draft = state.annotationDraft
        const width = 340
        const margin = 8
        const approxHeight = 280
        // Border + padding + half the first button: the button's centre sits
        // this far inside the card. The card is pinned by its bottom edge, so
        // the same measure vertically needs no card height.
        const answerInsetX = 44
        const answerInsetY = 24
        const vw = viewport().width
        const boxWidth = Math.min(width, vw - margin * 2)
        const rect = draft?.rect ?? null
        const pointer = pointerNearRect(draft?.pointer, rect) ? draft.pointer : null
        const clampX = (value) => Math.max(margin, Math.min(value, vw - boxWidth - margin))
        if (pointer) {
          const { x, y } = pointer
          const leftValue = clampX(x - answerInsetX)
          const top = y + answerInsetY
          if (top - approxHeight >= margin) {
            return {
              left: `${Math.round(leftValue)}px`,
              top: `${Math.round(top)}px`,
              transformOrigin: `${Math.round(Math.max(0, Math.min(x - leftValue, boxWidth)))}px 100%`,
              transform: 'translateY(-100%)',
            }
          }
        }
        return placeOverRect(rect, approxHeight)
      }

      /**
       * Place a 340-wide card over one viewport box: centred on it, above when
       * there is room, otherwise below and clamped into the viewport. Without a
       * box it parks in the top-right corner.
       */
      function placeOverRect(rect, approxHeight) {
        const width = 340
        const margin = 8
        const gap = 10
        const vw = viewport().width
        const vh = viewport().height
        const boxWidth = Math.min(width, vw - margin * 2)
        const clampX = (value) => Math.max(margin, Math.min(value, vw - boxWidth - margin))
        if (!rect) {
          return {
            left: `${Math.max(margin, vw - boxWidth - margin)}px`,
            top: '96px',
            transformOrigin: '0px 0px',
            transform: 'none',
          }
        }
        // A stored quote box may lack width (an older draft); NaN here would
        // invalidate `left` and leave the card at the overlay's origin.
        const rectWidth = Number.isFinite(rect.width) ? rect.width : rect.right - rect.left
        const anchorX = rect.left + rectWidth / 2
        const left = clampX(anchorX - boxWidth / 2)
        const origin = {
          transformOrigin: `${Math.round(Math.max(0, Math.min(anchorX - left, boxWidth)))}px 0px`,
        }
        if (rect.top - gap - approxHeight >= margin) {
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(rect.top - gap)}px`,
            ...origin,
            transform: 'translateY(-100%)',
          }
        }
        const below = rect.bottom + gap
        const top = Math.min(below, Math.max(margin, vh - approxHeight - margin))
        return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, ...origin, transform: 'none' }
      }

      /** Where the in-place note editor hangs: over the box that opened it. */
      function editPopupPosition() {
        return placeOverRect(state.annotationEditRect, 220)
      }

      /**
       * Close the selection card, dropping its draft. The native selection is
       * left alone: a press outside the card is not a request to stop selecting.
       * Committing a note clears the native selection in addAnnotation().
       */
      function closePopup() {
        const draft = state.annotationDraft
        if (draft === null && state.annotationEditingId === null) return false
        if (typeof document !== 'undefined' && document.activeElement?.closest?.(SELF_SELECTOR)) {
          try {
            document.activeElement.blur()
          } catch {
            /* nothing focused */
          }
        }
        return closeAnnotationSurface()
      }

      /**
       * A press anywhere outside the card closes it: the popup owns no focus
       * until its own field is clicked, so a click elsewhere is just the
       * reader moving on. A Shift+press is the exception: it extends the
       * captured passage, so the draft and its anchor must survive.
       */
      function onOuterPointerDown(event) {
        cancelPendingCapture()
        if (state.quick !== true) return
        if (state.annotationDraft === null && state.annotationEditingId === null) return
        if (event?.shiftKey === true && state.annotationDraft !== null) return
        const target = event.target
        if (target && typeof target.closest === 'function' && target.closest(SELF_SELECTOR)) return
        closePopup()
      }

      /** Scroll and Escape close the selection card, like the old popup did. */
      function onPopupDismiss(event) {
        // Scrolling inside the card's own field/list must not dismiss it.
        if (
          event &&
          event.target &&
          typeof event.target.closest === 'function' &&
          event.target.closest(SELF_SELECTOR)
        ) {
          return
        }
        // A scroll that trails the release (smooth scrolling, auto-scroll while
        // dragging) is not a request to stop: a pending capture is left alone.
        // A card that is already open stows itself instead of dropping the
        // passage, so a following Shift+press can still extend it.
        if (state.annotationDraft === null) return
        if (state.annotationCardHidden === true) return
        setState({ annotationCardHidden: true })
      }

      /** True while a Shift+drag is extending the captured passage. */
      let extending = false
      /** The leading edge the extension grows from, or null. */
      let extendAnchor = null

      /** The caret under a viewport point, or null when the browser cannot say. */
      function caretRangeAt(x, y) {
        try {
          if (typeof document.caretRangeFromPoint === 'function') {
            return document.caretRangeFromPoint(x, y) ?? null
          }
          if (typeof document.caretPositionFromPoint === 'function') {
            const position = document.caretPositionFromPoint(x, y)
            if (!position) return null
            const range = document.createRange()
            range.setStart(position.offsetNode, position.offset)
            range.collapse(true)
            return range
          }
        } catch {
          return null
        }
        return null
      }

      /**
       * Grow the captured passage away from the gesture's start end to the
       * pointer.
       *
       * The card holds the focus, and focusing it collapsed the native selection,
       * so the browser's own Shift+click has no anchor left. The end the gesture
       * started from is the anchor (it is the lower edge for an upward drag), and
       * the pointer is turned into a caret range; the resulting selection is
       * written back into the draft so the card follows.
       */
      function extendTo(x, y) {
        const draft = state.annotationDraft
        if (draft === null || extendAnchor === null) return false
        const caret = caretRangeAt(x, y)
        if (caret === null) return false
        const selection = window.getSelection?.()
        if (!selection) return false
        try {
          selection.removeAllRanges()
          selection.setBaseAndExtent(
            extendAnchor.node,
            extendAnchor.offset,
            caret.startContainer,
            caret.startOffset,
          )
        } catch {
          return false
        }
        if (selection.isCollapsed) return false
        const range = selection.getRangeAt(0)
        const quote = tidyQuote(selection.toString())
        if (quote.trim() === '') return false
        let rect = null
        try {
          rect = range.getBoundingClientRect()
        } catch {
          rect = null
        }
        if (rect !== null && rect.width === 0 && rect.height === 0) rect = null
        let anchor = null
        try {
          anchor = anchorFromRange(range, quote)
        } catch {
          anchor = null
        }
        // Only the draft changes: the note already typed and the editor stay.
        settleAnnotation({
          annotationDraft: {
            quote,
            anchor,
            range,
            // Keep the gesture's original start end: consecutive Shift+presses
            // grow away from it, whichever direction the first drag ran.
            anchorPoint: draft.anchorPoint,
            rect: rect
              ? {
                  left: rect.left,
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  width: rect.width,
                  height: rect.height,
                }
              : null,
            pointer: null,
          },
          annotationCardHidden: false,
        })
        return true
      }

      /** Shift+press on the transcript keeps extending the captured passage. */
      function onExtendPointerDown(event) {
        if (state.quick !== true || event?.shiftKey !== true) return
        const draft = state.annotationDraft
        if (draft === null || state.annotationEditingId !== null) return
        const target = event.target
        if (target && typeof target.closest === 'function') {
          if (target.closest(EDITABLE_SELECTOR)) return
          if (target.closest(MODAL_SELECTOR)) return
          if (target.closest(SELF_SELECTOR)) return
        }
        let anchor = null
        if (draft.anchorPoint && draft.anchorPoint.node) {
          anchor = draft.anchorPoint
        } else {
          // Drafts captured before this build carry only the range.
          try {
            const range = draft.range && typeof draft.range.cloneRange === 'function' ? draft.range.cloneRange() : null
            if (range !== null) {
              range.collapse(true)
              anchor = { node: range.startContainer, offset: range.startOffset }
            }
          } catch {
            anchor = null
          }
        }
        if (anchor === null) return
        extendAnchor = anchor
        extending = true
        // Keep the caret in the card and stop the browser from starting a fresh
        // selection at the press point.
        event.preventDefault?.()
        extendTo(event.clientX, event.clientY)
      }

      function onExtendPointerMove(event) {
        if (!extending) return
        if (typeof event?.buttons === 'number' && (event.buttons & 1) === 0) {
          extending = false
          extendAnchor = null
          return
        }
        extendTo(event.clientX, event.clientY)
      }

      function onExtendPointerUp() {
        extending = false
        extendAnchor = null
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
        if (event?.key === 'Escape' && state.annotationEditingId !== null) {
          event.preventDefault()
          cancelAnnotationEdit()
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

      /** Put one text block in at the caret; false when the shell refused it. */
      function spliceAtCaret(handle, value) {
        if (value === '') return true
        if (typeof handle.insertText !== 'function' || typeof handle.captureInsertion !== 'function') return false
        try {
          const span = handle.captureInsertion()
          if (!span || typeof span.start !== 'number' || typeof span.end !== 'number') return false
          return handle.insertText(value, span) === true
        } catch {
          return false
        }
      }

      /**
       * Write the pending annotations as the shell's own quote previews: one
       * quote node per passage, the answer as plain text on the line below it.
       * This is the node DSH inserts for a quoted selection, so the draft shows
       * the quote mark instead of a run of `>` lines — and the node serializes
       * back to the very Markdown a sent message carries.
       *
       * Reports how far it got and the blank-line break it already placed, so
       * a shell that stops taking quotes mid-batch can finish the rest as text
       * without doubling the gap. `attempted: false` means the shell has no
       * quote face (or is not idle): the caller keeps its text path.
       */
      function writeQuotedBatch(handle, pending, draft) {
        const skipped = { attempted: false, written: 0, lead: '', gap: false }
        if (typeof handle.insertQuote !== 'function') return skipped
        if (typeof handle.insertText !== 'function' || typeof handle.captureInsertion !== 'function') return skipped
        // The shell only takes a quote into a plain composer; a sending or
        // decided composer is the text path's business.
        let phase = ''
        try {
          phase = handle.readPhase?.() ?? ''
        } catch {
          phase = ''
        }
        if (phase !== '' && phase !== 'plain') return skipped
        const result = { attempted: true, written: 0, lead: '', gap: false }
        const caret = () => {
          try {
            const span = handle.captureInsertion()
            return span && typeof span.start === 'number' ? span : undefined
          } catch {
            return undefined
          }
        }
        try {
          const first = caret()
          if (first === undefined) {
            result.attempted = false
            return result
          }
          const lead = blockBreak(draft.slice(0, first.start))
          if (lead !== '' && handle.insertText(lead, first) !== true) {
            result.attempted = false
            return result
          }
          result.lead = lead
          for (let index = 0; index < pending.length; index += 1) {
            const item = pending[index]
            const quote = tidyQuote(item.quote)
            if (quote.trim() === '') break
            // A refused quote leaves the last written note where it is; the
            // separator for this slot is what `gap` reports.
            if (handle.insertQuote(quote) !== true) {
              result.gap = index > 0
              break
            }
            result.written += 1
            const note = annotationNoteLine(item)
            if (note !== '') {
              const span = caret()
              if (span === undefined || handle.insertText(`\n${note}`, span) !== true) break
            }
            if (index === pending.length - 1) break
            const span = caret()
            if (span === undefined || handle.insertText('\n\n\n', span) !== true) break
            result.gap = true
          }
        } catch {
          return result
        }
        return result
      }

      /** Append every pending annotation to the composer draft. */
      function writeAnnotations() {
        const pending = pendingAnnotations()
        if (pending.length === 0) return false
        const handle = composer
        if (handle === undefined || typeof handle.setDraft !== 'function') {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        const body = annotationsText(pending)
        if (body === '') return false
        let draft = ''
        try {
          draft = handle.readDraft?.() ?? ''
        } catch {
          draft = ''
        }
        if (typeof draft !== 'string') draft = ''
        // Preferred: the shell's quote preview per passage. Whatever it could
        // not take stays pending; the rest of the batch is written as text.
        const quoted = writeQuotedBatch(handle, pending, draft)
        let writtenCount = quoted.written
        if (writtenCount < pending.length && writtenCount > 0) {
          const rest = annotationsText(pending.slice(writtenCount))
          if (spliceAtCaret(handle, (quoted.gap ? '' : '\n\n\n') + rest)) writtenCount = pending.length
        }
        if (writtenCount < pending.length && writtenCount === 0) {
          // The text path: splice at the caret first, then rebuild. `setDraft`
          // rebuilds every paragraph and drops the caret at the end, which is
          // exactly what a write in the middle of typing must not do; the
          // rebuild stays as the fallback for a shell without the insertion
          // face, or for a draft that moved. A leading break the quote path
          // already placed is not put in twice.
          let written = false
          if (typeof handle.insertText === 'function' && typeof handle.captureInsertion === 'function') {
            try {
              const span = handle.captureInsertion()
              if (span && typeof span.start === 'number' && typeof span.end === 'number') {
                const lead = quoted.lead !== '' ? '' : blockBreak(draft.slice(0, span.start))
                written = handle.insertText(lead + body, span) === true
              }
            } catch {
              written = false
            }
          }
          if (written) {
            writtenCount = pending.length
          } else {
            const next = draft.trim() === '' ? body : `${draft}${blockBreak(draft)}${body}`
            try {
              handle.setDraft(next)
            } catch (error) {
              console.warn('[dsh-nudge] annotation write failed', error)
              setState({ note: text('insertUnavailable'), error: '' })
              return false
            }
            writtenCount = pending.length
          }
        }
        if (writtenCount === 0) {
          setState({ note: text('insertUnavailable'), error: '' })
          return false
        }
        // The note leaves the pending set but stays in the tray and keeps its
        // passage painted: a mark belongs to the conversation, not to the
        // draft. Clearing the input box no longer takes it away — only
        // deleting the note does.
        const ids = new Set(pending.slice(0, writtenCount).map((item) => item.id))
        const marked = state.annotations.map((item) =>
          ids.has(item.id) ? { ...item, written: true } : item,
        )
        commitAnnotations(marked, { note: '', error: '' })
        return true
      }

      /** Send the pending annotations as one user message. */
      function sendAnnotations() {
        if (state.phase === 'waiting') return false
        const pending = pendingAnnotations()
        if (pending.length === 0) return false
        const body = annotationsText(pending)
        if (body === '') return false
        if (!deliver(body)) return false
        // What was just sent lives in the conversation now; the notes already
        // written into the draft keep their marks.
        const ids = new Set(pending.map((item) => item.id))
        const next = state.annotations.filter((item) => !ids.has(item.id))
        commitAnnotations(next)
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

      /** The preset a send/write uses: the chosen one when it is enabled. */
      function activePreset() {
        const chosen = presetOf(state.presets, state.presetId)
        if (chosen !== undefined && chosen.enabled !== false) return chosen
        return state.presets.find((preset) => preset.enabled !== false)
      }

      /** The primary button: write into the composer, or send the chosen preset. */
      function ask() {
        if (state.phase === 'waiting' && !canInsert()) return false
        // With the caret in the composer the same button writes the chosen
        // prompt into the draft instead of starting a turn.
        if (canInsert()) return insertPreset()
        const preset = activePreset()
        if (!preset) return false
        const delivered = deliver(preset.text)
        if (delivered) countStat('send', preset.id)
        return delivered
      }

      /** Whether the mounted composer already holds text. */
      function composerHasText() {
        if (composer === undefined) return false
        try {
          const draft = composer.readDraft?.()
          return typeof draft === 'string' && draft.trim() !== ''
        } catch {
          return false
        }
      }

      /**
       * Turbo double-click on a preset: switch to it and use it. A composer
       * that already holds text wins over sending — the prompt is appended,
       * even when the caret is elsewhere, so a half-written message is never
       * dropped just because the double-click did not land in the field.
       */
      function runPreset(id) {
        if (setPreset(id) !== true) return false
        if (composerHasText()) return insertPreset()
        return ask()
      }

      /** Switch the delivery mode for this browser and remember it. */
      function setDelivery(value) {
        if (!isDelivery(value)) return false
        persistSetting('delivery', value)
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
        persistSetting('turbo', next)
        setState({ turbo: next })
        notify(`${text('turboTitle')}：${next ? text('switchOn') : text('switchOff')}`)
        return true
      }

      /** Switch the probe preset for this browser and remember it. */
      function setPreset(value) {
        if (presetOf(state.presets, value) === undefined) return false
        persistSetting('preset', value)
        setState({ presetId: value })
        return true
      }

      /** Store one preset list, keeping the selection on an enabled preset. */
      function commitPresets(next, preferredId) {
        const list = normalizePresetList(next, state.lang)
        persistSetting('presets', list)
        let presetId = preferredId ?? state.presetId
        const chosen = presetOf(list, presetId)
        if (chosen === undefined || chosen.enabled === false) {
          presetId = list.find((preset) => preset.enabled !== false)?.id ?? list[0]?.id ?? DEFAULT_PRESET
        }
        persistSetting('preset', presetId)
        setState({ presets: list, presetId })
      }

      /** Add one user preset; returns the new id, or an error text. */
      function addPreset(label, body) {
        const value = typeof body === 'string' ? body.trim() : ''
        if (value.length === 0) return { ok: false, error: text('presetTextRequired') }
        const preset = {
          id: mintPresetId(),
          label: typeof label === 'string' && label.trim().length > 0 ? label.trim() : value.slice(0, 8),
          text: value,
          enabled: true,
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
          state.presets.map((preset) =>
            preset.id === id ? { id, label, text: value, enabled: preset.enabled !== false } : preset,
          ),
          state.presetId,
        )
        if (state.presetEditingId === id) setState({ presetEditingId: null })
        return { ok: true }
      }

      /** Remove one preset; the list may legitimately become empty. */
      function removePreset(id) {
        const next = state.presets.filter((preset) => preset.id !== id)
        if (next.length === state.presets.length) return false
        commitPresets(next, state.presetId === id ? next[0]?.id : state.presetId)
        setState({
          presetEditingId: state.presetEditingId === id ? null : state.presetEditingId,
          presetOpen: state.presetOpen.filter((open) => open !== id),
        })
        return true
      }

      /**
       * Enable or disable one preset. Disabled presets stay in settings but
       * leave the window's prompt row, so the row only carries live prompts.
       */
      function setPresetEnabled(id, value) {
        const current = presetOf(state.presets, id)
        if (current === undefined) return false
        const enabled = value === true
        if ((current.enabled !== false) === enabled) return false
        commitPresets(
          state.presets.map((preset) => (preset.id === id ? { ...preset, enabled } : preset)),
          state.presetId,
        )
        return true
      }

      /** Flip one preset between enabled and disabled. */
      function togglePresetEnabled(id) {
        const current = presetOf(state.presets, id)
        if (current === undefined) return false
        return setPresetEnabled(id, current.enabled === false)
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

      /** Move one preset to an absolute slot (drag and drop); order persists. */
      function movePresetTo(id, index) {
        const from = state.presets.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const target = Math.round(Number(index))
        if (!Number.isFinite(target)) return false
        const to = Math.max(0, Math.min(state.presets.length - 1, target))
        if (to === from) return false
        const next = [...state.presets]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        commitPresets(next, state.presetId)
        return true
      }

      /**
       * Move one preset next to another (window drag): before it, or after it.
       * Anchoring on the neighbour rather than on an index keeps the disabled
       * entries — which never appear in the window — in their own slots.
       */
      function movePresetBeside(id, anchorId, after) {
        if (id === anchorId) return false
        const list = state.presets
        const from = list.findIndex((preset) => preset.id === id)
        if (from < 0) return false
        const next = list.filter((preset) => preset.id !== id)
        const anchor = next.findIndex((preset) => preset.id === anchorId)
        if (anchor < 0) return false
        next.splice(anchor + (after === true ? 1 : 0), 0, list[from])
        if (next.every((preset, index) => preset.id === list[index].id)) return false
        commitPresets(next, state.presetId)
        return true
      }

      /** Open or close one preset body in the settings list. */
      function togglePresetOpen(id) {
        if (presetOf(state.presets, id) === undefined) return false
        const open = state.presetOpen.includes(id)
          ? state.presetOpen.filter((item) => item !== id)
          : [...state.presetOpen, id]
        setState({ presetOpen: open })
        return true
      }

      /** Open every preset body, or close them all. */
      function setPresetsOpen(open) {
        setState({ presetOpen: open ? state.presets.map((preset) => preset.id) : [] })
        return true
      }

      /** Switch one preset into the editor (only one editor is open at a time). */
      function startPresetEdit(id) {
        if (presetOf(state.presets, id) === undefined) return false
        setState({ presetEditingId: id })
        return true
      }

      /** Leave the editor without saving. */
      function cancelPresetEdit() {
        if (state.presetEditingId === null) return false
        setState({ presetEditingId: null })
        return true
      }

      /** Open the in-window "new prompt" form (title + body). */
      function startNudgeDraft() {
        setState({
          nudgeExpanded: true,
          nudgeDraftOpen: true,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
          ...IDLE_NUDGE_EDIT,
        })
        return true
      }

      /** Close the in-window form without saving. */
      function cancelNudgeDraft() {
        if (state.nudgeDraftOpen !== true) return false
        setState({ nudgeDraftOpen: false, nudgeDraftLabel: '', nudgeDraftText: '', nudgeDraftError: '' })
        return true
      }

      /** Write the draft title without saving it. */
      function setNudgeDraftLabel(value) {
        setState({ nudgeDraftLabel: typeof value === 'string' ? value : '' })
      }

      /** Write the draft body without saving it. */
      function setNudgeDraftText(value) {
        setState({ nudgeDraftText: typeof value === 'string' ? value : '' })
      }

      /** Save the in-window form through the same preset store the settings use. */
      function saveNudgeDraft() {
        const result = addPreset(state.nudgeDraftLabel, state.nudgeDraftText)
        if (result.ok !== true) {
          setState({ nudgeDraftError: result.error })
          return result
        }
        setState({ nudgeDraftOpen: false, nudgeDraftLabel: '', nudgeDraftText: '', nudgeDraftError: '' })
        return result
      }

      /**
       * Arm or leave the window's direct-edit mode. The same row that adds a
       * quick input then lets each one be dragged and edited in place, so fixing
       * an entry no longer means walking into the settings page.
       */
      function setNudgeEditing(value) {
        const next = value === true
        if (next === (state.nudgeEditing === true)) return false
        setState({
          ...IDLE_NUDGE_EDIT,
          nudgeEditing: next,
          nudgeExpanded: next ? true : state.nudgeExpanded,
          nudgeDraftOpen: false,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
        })
        return true
      }

      /** Open one quick input in the window's own editor, pre-filled. */
      function startNudgeEdit(id) {
        const preset = presetOf(state.presets, id)
        if (preset === undefined || preset.enabled === false) return false
        setState({
          ...IDLE_NUDGE_EDIT,
          nudgeExpanded: true,
          nudgeEditing: true,
          nudgeDraftOpen: false,
          nudgeDraftLabel: '',
          nudgeDraftText: '',
          nudgeDraftError: '',
          nudgeEditId: preset.id,
          nudgeEditLabel: preset.label,
          nudgeEditText: preset.text,
        })
        return true
      }

      /** Close the window's editor without saving. */
      function cancelNudgeEdit() {
        if (state.nudgeEditId === null) return false
        setState({ nudgeEditId: null, nudgeEditLabel: '', nudgeEditText: '', nudgeEditError: '' })
        return true
      }

      /** Write the editor's title without saving it. */
      function setNudgeEditLabel(value) {
        setState({ nudgeEditLabel: typeof value === 'string' ? value : '' })
      }

      /** Write the editor's body without saving it. */
      function setNudgeEditText(value) {
        setState({ nudgeEditText: typeof value === 'string' ? value : '' })
      }

      /** Save the window's editor through the same preset store the settings use. */
      function saveNudgeEdit() {
        if (state.nudgeEditId === null) return { ok: false, error: text('presetTextRequired') }
        const result = updatePreset(state.nudgeEditId, {
          label: state.nudgeEditLabel,
          text: state.nudgeEditText,
        })
        if (result.ok !== true) {
          setState({ nudgeEditError: result.error })
          return result
        }
        setState({ nudgeEditId: null, nudgeEditLabel: '', nudgeEditText: '', nudgeEditError: '' })
        return result
      }

      /** One pasted block: the first line is the label, the rest is the body. */
      function presetFromBlock(block) {
        const lines = block.split('\n')
        const label = lines[0].trim()
        const text = lines.slice(1).join('\n').trim()
        return { label, text: text.length > 0 ? text : label }
      }

      /**
       * Bulk-add pasted presets: blocks are separated by three or more blank
       * lines. Mirrors `addTips` — dedupe by body and report what was skipped.
       */
      function importPresets(raw) {
        const blocks = String(raw ?? '')
          .replace(/\r\n/g, '\n')
          .split(/\n(?:[ \t]*\n){3,}/)
          .map((block) => block.trim())
          .filter((block) => block.length > 0)
        if (blocks.length === 0) return { ok: false, added: 0, skipped: 0, error: text('importEmpty') }
        const seen = new Set(state.presets.map((preset) => preset.text))
        const next = [...state.presets]
        let added = 0
        let skipped = 0
        for (const block of blocks) {
          const preset = presetFromBlock(block)
          if (preset.text.length === 0 || seen.has(preset.text)) {
            skipped += 1
            continue
          }
          seen.add(preset.text)
          next.push({ id: mintPresetId(), label: preset.label, text: preset.text, enabled: true })
          added += 1
        }
        if (added === 0) {
          return { ok: false, added, skipped, error: text('importEmpty') }
        }
        commitPresets(next, state.presetId)
        return { ok: true, added, skipped }
      }

      /**
       * Copy every configured preset to the clipboard in the same block format
       * `importPresets` reads, so an export can be pasted back. Disabled
       * presets are included: they are configured, just not shown in the
       * window. The clipboard is async, so the outcome resolves.
       */
      function exportPresets() {
        const count = state.presets.length
        if (count === 0) return Promise.resolve({ ok: false, count, error: text('exportEmpty') })
        const value = state.presets
          .map((preset) =>
            preset.label === preset.text ? preset.label : `${preset.label}\n${preset.text}`,
          )
          .join('\n\n\n\n')
        try {
          const clipboard = navigator.clipboard
          if (typeof clipboard?.writeText !== 'function') {
            return Promise.resolve({ ok: false, count, error: text('exportFailed') })
          }
          return Promise.resolve(clipboard.writeText(value)).then(
            () => ({ ok: true, count }),
            () => ({ ok: false, count, error: text('exportFailed') }),
          )
        } catch {
          return Promise.resolve({ ok: false, count, error: text('exportFailed') })
        }
      }

      /** Restore the built-in presets (and forget the settings storage). */
      function resetPresets() {
        clearSetting('presets')
        commitPresets(builtinPresets(state.lang), DEFAULT_PRESET)
        setState({ presetOpen: [], presetEditingId: null })
      }

      // --- idle lines ------------------------------------------------------

      /** Commit one idle-line list: storage, state, back to the first line. */
      function commitTips(list) {
        const next = normalizeTipList(list, state.lang)
        persistSetting('tips', next)
        setState({ tips: next, tipIndex: 0 })
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
        if (state.tipEditingIndex === index) setState({ tipEditingIndex: null })
        return true
      }

      /** Switch one idle line into its editor. */
      function startTipEdit(index) {
        if (index < 0 || index >= state.tips.length) return false
        setState({ tipEditingIndex: index })
        return true
      }

      /** Leave the idle-line editor without saving. */
      function cancelTipEdit() {
        if (state.tipEditingIndex === null) return false
        setState({ tipEditingIndex: null })
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
        const editing = state.tipEditingIndex
        if (editing === index) setState({ tipEditingIndex: null })
        else if (editing !== null && editing > index) setState({ tipEditingIndex: editing - 1 })
        return true
      }

      /** Move one idle line up (`delta` -1) or down (+1); order is persisted. */
      function moveTip(index, delta) {
        const count = state.tips.length
        const to = index + (delta < 0 ? -1 : 1)
        if (index < 0 || index >= count || to < 0 || to >= count) return false
        return moveTipTo(index, to)
      }

      /** Move one idle line to an absolute slot (drag and drop). */
      function moveTipTo(from, index) {
        const count = state.tips.length
        const target = Math.round(Number(index))
        if (!Number.isFinite(target) || from < 0 || from >= count) return false
        const to = Math.max(0, Math.min(count - 1, target))
        if (to === from) return false
        const next = [...state.tips]
        const [line] = next.splice(from, 1)
        next.splice(to, 0, line)
        // The editor is keyed by position, so it has to move with its line:
        // the moved line lands on `to`, and every line between the two slots
        // shifts one step toward `from`. Missing the middle case leaves the
        // editor on a neighbour, and a save would overwrite that neighbour.
        const editing = state.tipEditingIndex
        let editingNext = editing
        if (editing === from) editingNext = to
        else if (editing !== null && from < to && editing > from && editing <= to) editingNext = editing - 1
        else if (editing !== null && from > to && editing >= to && editing < from) editingNext = editing + 1
        commitTips(next)
        if (editingNext !== editing) setState({ tipEditingIndex: editingNext })
        return true
      }

      /** Restore the built-in idle lines. */
      function resetTips() {
        clearSetting('tips')
        setState({ tips: builtinTips(state.lang), tipIndex: 0 })
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
       * The card's own spot while the pill carries the window, or null.
       *
       * A fold that came from the pointer parks the pill under that pointer, so
       * the shared anchor no longer describes the card; this keeps the card's
       * spot for the unfold. Not persisted: after a reload the pill's spot is
       * the anchor, exactly as it is after a pill drag.
       */
      let cardAnchor = null

      /**
       * Collapse or expand the window.
       *
       * A fold that came from a pointer puts the pill where that pointer is —
       * centred on it and clamped into the viewport — so the button lands under
       * the hand that folded the window instead of jumping to the card's corner.
       * The card keeps its own spot, so the unfold returns it where it was. A
       * fold with no pointer (the keyboard) keeps the shared anchor as before.
       */
      function setCollapsed(value, point) {
        if (state.collapsed === value) return
        let pos = clampPoint(state.pos, value)
        if (value === true && isPoint(point)) {
          cardAnchor = state.pos
          pos = clampPoint({ x: point.x - PILL_SIZE / 2, y: point.y - PILL_SIZE / 2 }, true)
        }
        if (value === false) {
          if (cardAnchor !== null) pos = clampPoint(cardAnchor, false)
          cardAnchor = null
        }
        setState({
          collapsed: value,
          settingsOpen: value ? false : state.settingsOpen,
          unread: value ? state.unread : false,
          pos,
        })
        saveUi()
      }

      /** Move the window while dragging (not persisted until drop). */
      function moveTo(x, y) {
        // A pill dragged elsewhere is the anchor the next unfold starts from:
        // the spot the card was folded at no longer applies.
        if (state.collapsed) cardAnchor = null
        setState({ pos: clampPoint({ x, y }, state.collapsed) })
      }

      /** Persist the current window state. */
      function saveUi() {
        // Keep keys this build does not own (an older record may carry more).
        writeJson(UI_KEY, { ...(readJson(UI_KEY) ?? {}), collapsed: state.collapsed, pos: state.pos })
      }

      // --- durable settings (Host half) -----------------------------------

      /**
       * Read the Host half's durable record once per launch — and only then let
       * the mirror write. The two are ordered here and nowhere else: a POST
       * replaces the whole file, so writing before the read would erase the
       * very settings a restart is supposed to come back from.
       * @returns true when a restored record changed the state.
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
        cardAnchor = null
        setState({
          ...readSettings({ lang: state.lang, sessionId: state.target?.sessionId }),
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
        const days = { ...state.stats.days }
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

      // --- settings navigation --------------------------------------------

      /**
       * Append one sample to a diagnostic list in the persisted UI record.
       *
       * The shell's open seams report nothing when they fail — `invoke` returns
       * void, a blocked command returns silently, a click on the wrong button is
       * accepted — so the only place a failure can be observed is the running
       * page. The samples land in `nudge-store.json`, next to the other settings.
       */
      function recordUiDiag(name, entry) {
        const ui = readJson(UI_KEY) ?? {}
        const list = Array.isArray(ui[name]) ? ui[name].slice(-DIAG_SAMPLES) : []
        list.push({ at: Date.now(), ...entry })
        ui[name] = list
        storage()?.setItem(UI_KEY, JSON.stringify(ui))
      }

      /** One settings-navigation sample. */
      function recordSettingsDiag(entry) {
        try {
          recordUiDiag('settingsDiag', entry)
        } catch {
          /* diagnostics are best-effort and never block the gear */
        }
      }


      /**
       * Why a passage could not be anchored, as one sample.
       *
       * `flows` counts the anchor elements on the page, `hits` how many of them
       * carry the passage, and `inBody` whether the text is on the page at all:
       * together they separate "the transcript re-rendered" from "the passage
       * lives outside every flow item" without a debugger on the running app.
       */
      function recordAnchorMiss(quote) {
        try {
          const packed = packedText(quote)
          const flows = document.querySelectorAll?.(ANCHOR_SELECTOR) ?? []
          let hits = 0
          for (const element of flows) {
            if (packedMapOf(element).packed.indexOf(packed) !== -1) hits += 1
          }
          const body = packedText(document.body?.textContent ?? '')
          recordUiDiag('anchorDiag', {
            event: 'no-anchor',
            length: packed.length,
            flows: flows.length,
            hits,
            inBody: packed !== '' && body.indexOf(packed) !== -1,
          })
        } catch {
          /* diagnostics are best-effort and never block the note */
        }
      }

      /**
       * The Settings jump driver lives in a package-local chunk
       * (`client.settings-jump.js`), fetched on the first press of the gear.
       *
       * The chunk is the reusable unit: it knows the shell's seams and nothing
       * about this plugin, so a second jump target is a second instance with a
       * different `sectionTitle` (and its own `onDiag` / `onFallback`) — the
       * routing, the receipts and the escalation order come for free.
       */
      let settingsJump
      let settingsJumpLoad

      /** Fetch (once) and wire the driver; a failed fetch is retried by the next press. */
      function loadSettingsJump() {
        if (settingsJump !== undefined) return Promise.resolve(settingsJump)
        if (settingsJumpLoad !== undefined) return settingsJumpLoad
        const fail = (error) => {
          settingsJumpLoad = undefined
          console.warn('[dsh-nudge] settings jump chunk unavailable', error)
          return undefined
        }
        try {
          if (typeof require?.async !== 'function') throw new Error('this shell has no chunk loader')
          settingsJumpLoad = require
            .async('./client.settings-jump.js')
            .then((chunk) => {
              settingsJump = chunk.createSettingsJump({
                getShortcuts: () => ctx.get?.('shortcuts'),
                getSlots: () => ctx.slots,
                sectionTitle: () => text('settingsTitle'),
                onDiag: (entry) => recordSettingsDiag(entry),
                onFallback: () => setState({ settingsOpen: true }),
              })
              return settingsJump
            })
            .catch(fail)
        } catch (error) {
          return Promise.resolve(fail(error))
        }
        return settingsJumpLoad
      }

      /**
       * Open Settings on this plugin's section.
       *
       * Resolves whether one of the shell's routes acted. When the chunk itself
       * cannot load — an install copy shipped without the file, or a shell whose
       * loader has no chunk support — the in-window form opens instead, so the
       * gear is never dead.
       */
      async function openSettings() {
        const jump = await loadSettingsJump()
        if (jump === undefined) {
          recordSettingsDiag({ event: 'chunk', error: 'unavailable' })
          setState({ settingsOpen: true })
          return false
        }
        return jump.open()
      }

      /** Drop a pending verification (dispose, or a second press of the gear). */
      function stopSettingsWait() {
        if (settingsJump !== undefined) settingsJump.cancel()
      }

      /** What the running page says about the shell's settings seams (diagnostics). */
      function probeSettings() {
        return settingsJump === undefined ? { pending: true } : settingsJump.probe()
      }

      /** Record the seam sample once the chunk has arrived (mount-time probe). */
      function probeSettingsSeams() {
        loadSettingsJump().then((jump) => {
          recordSettingsDiag(
            jump === undefined
              ? { event: 'mount', error: 'chunk-unavailable' }
              : { event: 'mount', ...jump.probe() },
          )
        })
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

      /**
       * Leaving the page writes the pending settings now. The mirror waits
       * `STORE_SYNC_MS` for a burst of edits to settle, and a window closed in
       * that gap would otherwise drop the last change — on the very restart the
       * Host record exists for. It is best effort: a page torn down at once may
       * still cut the request short.
       */
      function onPageHide() {
        flushSettingsMirror()
      }

      /** A page that goes to the background may never come back: write now. */
      function onVisibilityChange() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSettingsMirror()
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
          // The marks belong to the conversation that quoted them.
          resetAnchorRecovery()
          // The ask is bound to the conversation it was clicked in (1.2); a
          // different conversation must not inherit its status or its wait.
          if (waiting !== null) endWaiting()
          // The tray belongs to the conversation it quotes: load that Session's
          // saved notes and drop any half-written one.
          settleAnnotation({
            target,
            pendingQuestion,
            note: '',
            error: '',
            phase: 'idle',
            annotations: notesOfSession(targetId),
            ...IDLE_ANNOTATION,
            annotationExpanded: false,
            nudgeExpanded: true,
            attentionAt: 0,
          })
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
      window.addEventListener('pagehide', onPageHide)
      // The primary button follows the caret: entering or leaving the composer
      // flips the write mode without polling.
      try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibilityChange)
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
          // Shift+press extends the captured passage without the native anchor.
          document.addEventListener('mousedown', onExtendPointerDown, true)
          document.addEventListener('mousemove', onExtendPointerMove, true)
          document.addEventListener('mouseup', onExtendPointerUp, true)
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
      /**
       * Whether one mutation batch touched a flow item: added one, removed one
       * or re-keyed it. Only those can bring back a passage whose row is gone,
       * so only they raise the generation the recovery search waits for.
       */
      function flowAnchorsChanged(records) {
        for (const record of records) {
          if (record?.type === 'attributes') return true
          for (const list of [record?.addedNodes, record?.removedNodes]) {
            if (!list) continue
            for (const node of list) {
              if (node?.nodeType !== 1) continue
              if (node.matches?.(ANCHOR_SELECTOR) === true) return true
              if (typeof node.querySelector === 'function' && node.querySelector(ANCHOR_SELECTOR) !== null) {
                return true
              }
            }
          }
        }
        return false
      }

      try {
        if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
          highlightObserver = new MutationObserver(onTranscriptMutation)
          highlightObserver.observe(document.documentElement ?? document.body, {
            childList: true,
            subtree: true,
            // A streamed answer edits text in place: that changes a row's text too.
            characterData: true,
            // Rows are re-keyed in place when a turn stops streaming.
            attributes: true,
            attributeFilter: ['data-chat-anchor-key'],
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
        flushSettingsMirror()
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
        window.removeEventListener('pagehide', onPageHide)
        try {
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange)
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
            document.removeEventListener('mousedown', onExtendPointerDown, true)
            document.removeEventListener('mousemove', onExtendPointerMove, true)
            document.removeEventListener('mouseup', onExtendPointerUp, true)
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
          window.CSS?.highlights?.delete(ANSWER_HIGHLIGHT)
          window.CSS?.highlights?.delete(CAPTURE_HIGHLIGHT)
        } catch {
          /* no highlight registry */
        }
        highlighted = []
        resetAnchorRecovery()
        listeners.clear()
      }

      return {
        subscribe,
        getSnapshot,
        text,
        ask,
        /** Turbo double-click: append when a draft exists, else send. */
        runPreset,
        setDelivery,
        effectiveDelivery,
        setTurbo,
        setPreset,
        addPreset,
        updatePreset,
        removePreset,
        movePreset,
        movePresetTo,
        /** Window drag: drop one prompt before or after another. */
        movePresetBeside,
        resetPresets,
        togglePresetOpen,
        setPresetsOpen,
        startPresetEdit,
        cancelPresetEdit,
        /** Enable / disable one prompt without deleting it. */
        setPresetEnabled,
        togglePresetEnabled,
        /** In-window "new prompt" form (title + body). */
        startNudgeDraft,
        cancelNudgeDraft,
        setNudgeDraftLabel,
        setNudgeDraftText,
        saveNudgeDraft,
        /** In-window 编辑 mode: reorder by drag, change one prompt in place. */
        setNudgeEditing,
        startNudgeEdit,
        cancelNudgeEdit,
        setNudgeEditLabel,
        setNudgeEditText,
        saveNudgeEdit,
        importPresets,
        exportPresets,
        setCollapsed,
        moveTo,
        saveUi,
        openSettings,
        closeSettings,
        /** One sample of the shell's settings seams, kept in the durable record. */
        probeSettingsSeams,
        /** Note that the gear itself was reached, before any shell seam runs. */
        noteSettingsPress: () => recordSettingsDiag({ event: 'gear', ...probeSettings() }),
        /** Composer bridge hooks (session input overlay). */
        attachComposer,
        detachComposer,
        /** Annotation tray. */
        captureSelection,
        /** The notes still waiting to be written into a message. */
        pendingAnnotations,
        popupPosition,
        editPopupPosition,
        setQuick,
        setAutoPaste,
        setFrame,
        addTip,
        addTips,
        updateTip,
        removeTip,
        moveTip,
        moveTipTo,
        startTipEdit,
        cancelTipEdit,
        resetTips,
        advanceTip,
        setAnnotationExpanded,
        setNudgeExpanded,
        setAnnotationNote,
        /** Whether one DOM node belongs to this window's own chrome. */
        isSelfNode,
        showTip,
        hideTip,
        addAnnotation,
        markAsAnswer,
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
          state: () => state,
          chipSlotAt,
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

    /**
     * The conversation renders selection actions into this one surface, and the
     * official 「引用文本」 action is its only occupant. While quick notes own
     * the selection, that surface stays out of the way; turning the notes off
     * drops the rule and hands the selection back.
     */
    const OFFICIAL_SELECTION_CSS = '[data-text-interaction-surface]{display:none!important}'

    /** The hide rule, appended to the window stylesheet while quick notes are on. */
    function viewCss(quick) {
      return quick === true ? `${CSS}\n${OFFICIAL_SELECTION_CSS}` : CSS
    }

    const CSS = `
.dsh-nudge-card,.dsh-nudge-pill,.dsh-nudge-settings,.dsh-nudge-popup{--dn-accent:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 78%,var(--dsw-alias-label-primary,#1a1a1a) 22%);--dn-accent-soft:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 14%,transparent);--dn-accent-line:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 38%,transparent);--dn-accent-edge:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 62%,transparent);--dn-line:var(--dsw-alias-border-l1,rgba(127,127,127,.25));--dn-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 28%,transparent);--dn-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent);--dn-note:#8b5cf6;--dn-frame:1px}
.dsh-nudge-card{position:fixed;z-index:${Z_INDEX};width:min(304px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:16px;border:var(--dn-frame) solid var(--dn-accent-edge);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 18px 44px -22px rgba(15,23,42,.3);font:13px/1.55 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;pointer-events:auto;animation:dsh-nudge-in .18s ease-out}
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
.dsh-nudge-mark.waiting .dsh-nudge-mark-tap{opacity:1;transform-box:fill-box;transform-origin:center;animation:dsh-nudge-tap 2s ease-in-out infinite}
.dsh-nudge-mark.done{color:var(--dsw-alias-state-success-primary,#2f9e63)}
.dsh-nudge-mark.done .dsh-nudge-mark-tap{opacity:0}
.dsh-nudge-mark.error{color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-mark.error .dsh-nudge-mark-tap{opacity:0}
@keyframes dsh-nudge-tap{0%{opacity:.45;transform:scale(.94)}55%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
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
.dsh-nudge-presets{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.dsh-nudge-presets-empty{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-chip{height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-nudge-chip:hover{border-color:var(--dn-accent-line);color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dn-accent-soft)}
.dsh-nudge-chip:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-chip.active{background:var(--dn-accent-soft);border-color:var(--dn-accent-line);color:var(--dn-accent);font-weight:600}
.dsh-nudge-chip.dsh-nudge-chip-add{border-style:dashed;color:var(--dn-accent)}
.dsh-nudge-chip.dsh-nudge-chip-edit{border-style:dashed;color:var(--dn-accent)}
/* Edit mode: a chip is a handle and a target, so the pointer owns its motion
   and text selection stays out of the way. */
.dsh-nudge-presets.editing .dsh-nudge-chip{touch-action:none}
.dsh-nudge-presets.editing .dsh-nudge-chip:not(.dsh-nudge-chip-edit):not(.dsh-nudge-chip-add){cursor:grab;user-select:none}
.dsh-nudge-chip-grip{display:inline-block;margin-right:4px;font-size:10px;line-height:1;opacity:.6;pointer-events:none}
/* The drop caret: where the dragged chip lands. It is the only thing that
   moves while dragging — the row itself stays frozen. */
.dsh-nudge-chip-caret{position:absolute;z-index:2;width:3px;border-radius:2px;background:var(--dn-accent);pointer-events:none;animation:dsh-nudge-caret-in .12s ease-out;transition:left .1s ease,top .1s ease,height .1s ease}
@keyframes dsh-nudge-caret-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh-nudge-chip-caret{animation:none;transition:none}}
.dsh-nudge-chip.dsh-nudge-chip-drag{position:relative;z-index:1;will-change:transform}
.dsh-nudge-chip.dsh-nudge-chip-drag.dragging{z-index:3;cursor:grabbing;border-color:var(--dn-accent-line);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 22px -10px rgba(15,23,42,.55)}
.dsh-nudge-chip.dsh-nudge-chip-drag.editing{border-color:var(--dn-accent-line);background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-quick-add{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dn-accent-line);border-radius:12px;background:var(--dn-accent-soft)}
.dsh-nudge-quick-add-field{display:flex;flex-direction:column;gap:4px}
.dsh-nudge-quick-add input,.dsh-nudge-quick-add textarea{width:100%;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:6px 9px;outline:none}
.dsh-nudge-quick-add input{height:30px}
.dsh-nudge-quick-add textarea{min-height:64px;max-height:132px;line-height:1.5;resize:none;overflow-y:auto}
.dsh-nudge-quick-add input:focus,.dsh-nudge-quick-add textarea:focus{border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
/* The in-window editor for one quick input: the add form's shape, its own
   class so the add block keeps one meaning per selector. */
.dsh-nudge-quick-edit{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dn-accent-line);border-radius:12px;background:var(--dn-accent-soft)}
.dsh-nudge-quick-edit input,.dsh-nudge-quick-edit textarea{width:100%;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:6px 9px;outline:none}
.dsh-nudge-quick-edit input{height:30px}
.dsh-nudge-quick-edit textarea{min-height:64px;max-height:132px;line-height:1.5;resize:none;overflow-y:auto}
.dsh-nudge-quick-edit input:focus,.dsh-nudge-quick-edit textarea:focus{border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-ask{height:38px;border:0;border-radius:11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dn-accent);box-shadow:0 8px 20px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 55%,transparent);transition:filter .15s ease,transform .1s ease,box-shadow .15s ease}
.dsh-nudge-ask:hover{filter:brightness(1.05);box-shadow:0 10px 24px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 65%,transparent)}
.dsh-nudge-ask:active{transform:translateY(1px)}
.dsh-nudge-ask:disabled{opacity:.55;cursor:default;box-shadow:none;filter:none}
.dsh-nudge-ask:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-annotation-quote{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
/* 340 is also the width popupPosition()/placeOverRect() lay the card out with:
   change one and the card drifts off its anchor and past the viewport edge. */
.dsh-nudge-popup{position:fixed;z-index:${Z_INDEX + 1};box-sizing:border-box;width:340px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 10px 30px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.08);font:13px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;pointer-events:auto;opacity:.72;transition:opacity .22s ease;animation:dsh-nudge-popup-in .12s cubic-bezier(.16,1,.3,1)}
.dsh-nudge-popup:hover,.dsh-nudge-popup:focus-within{opacity:1}
/* The end state stays open on purpose: the card takes the focus in the frame
   it mounts, so :focus-within makes its resting opacity 1 — a fixed
   to{opacity:.72} would snap to the real value on the last frame. scale is
   its own property so it never overwrites the inline translateY that places
   an upward-opening card. */
@keyframes dsh-nudge-popup-in{from{opacity:0;scale:.97}}
@media (prefers-reduced-motion:reduce){.dsh-nudge-popup{animation:none;transition:none}}
.dsh-nudge-settings-panel{display:flex;flex-direction:column;gap:10px;padding:12px;flex:1 1 auto;min-height:0;max-height:min(520px,72vh);overflow:auto}
.dsh-nudge-settings-head{display:flex;align-items:center;gap:8px}
.dsh-nudge-settings-name{font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-popup-row{display:flex;align-items:center;gap:6px}
.dsh-nudge-popup-row button{height:28px;padding:0 8px;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.dsh-nudge-popup-row button:active{transform:scale(.97)}
.dsh-nudge-popup-row button:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-popup-mic{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--dn-line);border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.dsh-nudge-popup-mic-hint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#5a5a66)}
/* One action style for the whole card: same height, radius and type, and only
   one primary. The actions size themselves by their words, so the longer
   verdict labels stay readable; copying is a utility and sits with the field. */
.dsh-nudge-popup-field{display:flex;align-items:flex-start;gap:6px}
.dsh-nudge-popup-field .dsh-nudge-annotation-input{flex:1 1 auto;min-width:0}
.dsh-nudge-popup-copy{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5a5a66);cursor:pointer;transition:color .12s ease,background-color .12s ease,border-color .12s ease}
.dsh-nudge-popup-copy:hover{color:var(--dn-accent);background:var(--dn-hover)}
.dsh-nudge-popup-copy:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-popup-copy[data-copied="done"]{color:var(--dn-accent);border-color:var(--dn-accent-line);background:var(--dn-accent-soft)}
.dsh-nudge-popup-copy[data-copied="failed"]{color:var(--dsw-alias-state-error-primary,#c8433c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 45%,transparent)}
.dsh-nudge-popup-row .dsh-nudge-popup-quick:hover{background:var(--dn-hover)}
.dsh-nudge-popup-row .dsh-nudge-popup-answer{border-color:var(--dn-accent);background:var(--dn-accent);color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
.dsh-nudge-popup-row .dsh-nudge-popup-answer:hover{filter:brightness(1.06)}
.dsh-nudge-popup-hint{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-popup-hint kbd{font:inherit;padding:0 3px;border:1px solid var(--dn-line);border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 4%,transparent)}
/* The in-place note editor: the capture card's shape, hung off the passage.
   It sits fully opaque because it holds a field the user types into, and its
   field starts two lines tall so a stored note is readable at a glance. */
.dsh-nudge-edit-popup{opacity:1}
.dsh-nudge-edit-quote{max-height:34px;-webkit-line-clamp:2;min-height:0}
.dsh-nudge-edit-popup .dsh-nudge-annotation-input{min-height:56px}
.dsh-nudge-popup-row .dsh-nudge-edit-delete{margin-right:auto;border-color:transparent;background:transparent;color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-popup-row .dsh-nudge-edit-delete:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent)}
.dsh-nudge-annotation-input{width:100%;box-sizing:border-box;min-height:34px;field-sizing:content;max-height:132px;resize:none;overflow-y:auto;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:13px;line-height:20px;padding:7px 10px}
.dsh-nudge-annotation-input:disabled{opacity:.6;cursor:not-allowed}
.dsh-nudge-btn:disabled{opacity:.45;cursor:default}
.dsh-nudge-annotation-input:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-annotation-actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-nudge-annotations-count{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dn-accent-soft);color:var(--dn-accent);font-size:10px;line-height:16px;text-align:center}
/* One fixed-height tray: rows scroll inside it, so adding a note never grows
   the floating window. The guide line and the action row keep their own rows. */
.dsh-nudge-annotation-tray{display:flex;flex-direction:column;gap:8px;height:216px}
.dsh-nudge-annotation-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;overflow-y:auto;scrollbar-gutter:stable}
.dsh-nudge-annotation-empty{display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:100%;padding:0 10px;border:1px dashed var(--dn-line);border-radius:12px;color:var(--dsw-alias-label-secondary,#8a8a8a);text-align:center}
.dsh-nudge-annotation-guide{flex:0 0 auto;min-height:16px;max-height:33px;overflow:hidden}
.dsh-nudge-annotation-item{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 5%,transparent)}
.dsh-nudge-annotation-item-head{display:flex;align-items:flex-start;gap:6px}
.dsh-nudge-annotation-item-head .dsh-nudge-annotation-quote{flex:1 1 auto;min-width:0;-webkit-line-clamp:2}
.dsh-nudge-annotation-written{flex:0 0 auto;font-size:10px;line-height:1.6;padding:0 4px;border-radius:4px;color:color-mix(in srgb,var(--dn-accent) 70%,#fff);background:color-mix(in srgb,var(--dn-accent) 18%,transparent)}
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
/* A passage marked as the answer keeps the note's own purple, on a light tint
   so the text under it stays readable in the light theme. */
::highlight(dsh-nudge-answers){background:var(--dsh-nudge-answer-bg,#ddd6fe);color:var(--dsh-nudge-answer-fg,#1f2937)}
/* Same colours as the browser's own selection on Chromium/Windows, because
   focusing the note field collapses the real selection before it can be kept.
   --dsh-nudge-capture-bg / -fg stay overridable for other platforms/themes. */
::highlight(dsh-nudge-capture){background:var(--dsh-nudge-capture-bg,#3367d1);color:var(--dsh-nudge-capture-fg,#fff)}
.dsh-nudge-pill{position:fixed;z-index:${Z_INDEX};display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border-radius:50%;border:var(--dn-frame) solid var(--dn-accent-edge);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 10px 26px -14px rgba(15,23,42,.3);font:600 12px/1 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;cursor:grab;pointer-events:auto;touch-action:none;user-select:none;transition:transform .15s ease,box-shadow .15s ease;animation:dsh-nudge-in .18s ease-out}
.dsh-nudge-pill:active{cursor:grabbing}
.dsh-nudge-pill:hover{transform:translateY(-1px);box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 30px -14px rgba(15,23,42,.35)}
.dsh-nudge-pill:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-unread{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--dn-accent);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-settings{display:flex;flex-direction:column;gap:14px;font:inherit;color:var(--dsw-alias-label-primary,#1a1a1a)}
/* The shell Settings panel caps the body at 800px and scrolls it. While this
   section is mounted, let the panel grow with the section instead (never
   smaller than the shell's own height, never taller than the viewport); the
   shell's internal options area still scrolls once that cap is reached. The
   :has() scope is what keeps the override from affecting other sections. */
body:has(.dsh-nudge-settings) [data-shortcut-modal="settings"]{height:auto;min-height:min(800px,calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px))));max-height:calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px)))}
.dsh-nudge-settings-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-settings-section-head{display:flex;align-items:center;gap:7px;padding:0 2px 7px;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-settings-section-head::before{content:'';flex:0 0 auto;width:3px;height:13px;border-radius:2px;background:var(--dn-accent);margin-left:2px}
.dsh-nudge-settings-section-title{font-size:12.5px;font-weight:700;letter-spacing:.2px;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-settings-section-desc{margin:-2px 2px 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-settings-section-meta{margin-left:auto;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head{cursor:pointer;user-select:none;list-style:none}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head::-webkit-details-marker{display:none}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head::after{content:'';flex:0 0 auto;width:6px;height:6px;margin-left:6px;border-right:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);border-bottom:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);opacity:.7;transform:rotate(45deg);transition:transform .15s ease}
.dsh-nudge-settings-section.collapsible:not([open]) .dsh-nudge-settings-section-head::after{transform:rotate(-45deg)}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head:hover,.dsh-nudge-settings-fold-head:hover{background:var(--dn-hover);border-radius:6px}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head:focus-visible,.dsh-nudge-settings-fold-head:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px;border-radius:6px}
.dsh-nudge-settings-section.collapsible[open] .dsh-nudge-settings-section-desc{margin-top:2px}
.dsh-nudge-settings-fold{display:flex;flex-direction:column;gap:8px;padding-top:2px;border-top:1px solid var(--dn-line)}
.dsh-nudge-settings-fold-head{display:flex;align-items:center;gap:8px;padding:5px 2px;cursor:pointer;list-style:none;font-size:11.5px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-secondary,#6a6a76);user-select:none}
.dsh-nudge-settings-fold-head::-webkit-details-marker{display:none}
.dsh-nudge-settings-fold-head::after{content:'';flex:0 0 auto;width:6px;height:6px;margin-left:6px;border-right:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);border-bottom:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);opacity:.7;transform:rotate(45deg);transition:transform .15s ease}
.dsh-nudge-settings-fold:not([open]) .dsh-nudge-settings-fold-head::after{transform:rotate(-45deg)}
.dsh-nudge-settings-fold-meta{margin-left:auto;font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
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
/* Preset rows are a table of contents: one name per line, bodies on demand. */
.dsh-nudge-preset-row:has(> .dsh-nudge-preset-summary){gap:4px;padding:6px 8px}
.dsh-nudge-preset-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.dsh-nudge-stats-head{display:flex;align-items:center;gap:8px}
.dsh-nudge-stats-today{display:flex;flex-direction:column;gap:5px}
.dsh-nudge-stats-today-head{display:flex;align-items:baseline;gap:6px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-today-label{font-weight:600}
.dsh-nudge-stats-today-date{font-variant-numeric:tabular-nums}
.dsh-nudge-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dsh-nudge-stat{display:flex;flex-direction:column;gap:1px;min-width:0;padding-left:12px;border-left:1px solid var(--dn-line)}
.dsh-nudge-stat:first-child{padding-left:0;border-left:0}
.dsh-nudge-stat-value{font-size:22px;line-height:1.15;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-stat-label{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
/* One board: trend on the left, prompt ranking on the right. Narrow panels
   (the in-window fallback) stack the two instead of squeezing the chart. */
.dsh-nudge-stats-board{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin-top:2px;padding-top:12px;border-top:1px solid var(--dn-line)}
.dsh-nudge-stats-chart-pane{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-nudge-stats-trend-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-total{font-variant-numeric:tabular-nums}
.dsh-nudge-chart-peak{color:var(--dsw-alias-label-secondary,#9a9aa4)}
.dsh-nudge-chart-wrap{position:relative;flex:0 0 auto;width:100%;aspect-ratio:320/168;min-height:150px;overflow:visible}
.dsh-nudge-chart-svg{display:block;width:100%;height:100%;overflow:visible}
.dsh-nudge-chart-grid{stroke:var(--dn-line);stroke-width:1;stroke-dasharray:2 4;opacity:.7}
.dsh-nudge-chart-axis-line{stroke:var(--dn-line);stroke-width:1}
.dsh-nudge-chart-point{stroke:var(--dsw-alias-bg-layer-1,#fff);stroke-width:1.2}
.dsh-nudge-chart-point.input{fill:var(--dsw-static-deepseek-450,#5686fe)}
.dsh-nudge-chart-point.note{fill:var(--dn-note)}
.dsh-nudge-chart-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 12px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a);text-align:center}
.dsh-nudge-chart-hits{position:absolute;inset:0;display:flex}
.dsh-nudge-chart-hit{flex:1 1 0;position:relative;min-width:0}
.dsh-nudge-chart-tip{position:absolute;top:2px;left:50%;transform:translateX(-50%);z-index:2;display:flex;flex-direction:column;gap:1px;padding:5px 8px;border-radius:8px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 22px -12px rgba(15,23,42,.45);font-size:11px;line-height:1.4;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s ease}
.dsh-nudge-chart-hit:hover .dsh-nudge-chart-tip{opacity:1}
.dsh-nudge-chart-hit:nth-child(-n+3) .dsh-nudge-chart-tip{left:0;transform:none}
.dsh-nudge-chart-hit:nth-last-child(-n+3) .dsh-nudge-chart-tip{left:auto;right:0;transform:none}
.dsh-nudge-chart-tip-date{font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);font-variant-numeric:tabular-nums}
.dsh-nudge-chart-tip-values{color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-axis{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-chart-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-chart-legend-item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-nudge-chart-dot{flex:0 0 auto;width:11px;height:3px;border-radius:2px}
.dsh-nudge-chart-dot.input{background:var(--dsw-static-deepseek-450,#5686fe)}
.dsh-nudge-chart-dot.note{background:var(--dn-note)}
.dsh-nudge-stats-side{display:flex;flex-direction:column;gap:6px;min-width:0}
/* Today sits above the ranking and stays compact: the board is a summary, not
   a second settings page. */
.dsh-nudge-stats-side .dsh-nudge-stats-today{gap:4px;padding-bottom:8px;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-stats-side .dsh-nudge-stats-today-head{justify-content:space-between}
.dsh-nudge-stats-side .dsh-nudge-stats{gap:6px}
.dsh-nudge-stats-side .dsh-nudge-stat{padding-left:7px}
.dsh-nudge-stats-side .dsh-nudge-stat:first-child{padding-left:0}
.dsh-nudge-stats-side .dsh-nudge-stat-value{font-size:18px;line-height:1.1}
.dsh-nudge-stats-side .dsh-nudge-stat-label{font-size:10px;line-height:1.3}
.dsh-nudge-stats-side-head{margin-top:1px}
.dsh-nudge-stats-side-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-side-empty{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-top-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dsh-nudge-top-item{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 6px;border-radius:8px;transition:background .15s ease}
.dsh-nudge-top-item:hover{background:var(--dn-hover)}
.dsh-nudge-top-rank{flex:0 0 18px;height:18px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent);color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:10.5px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-nudge-top-item:first-child .dsh-nudge-top-rank{background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-top-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-top-count{flex:0 0 auto;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-nudge-stats-share{margin-top:auto;padding:4px 6px 0;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a)}
@container dsh-nudge-stats (min-width: 430px){
  .dsh-nudge-stats-board{grid-template-columns:minmax(0,1.55fr) minmax(150px,1fr);gap:18px}
  .dsh-nudge-stats-side{padding-left:18px;border-left:1px solid var(--dn-line)}
}
.dsh-nudge-preset-count{margin-right:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-preset-summary{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-nudge-preset-grip{cursor:grab;padding:2px;border-radius:6px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:13px;line-height:1;user-select:none}
.dsh-nudge-preset-grip:active{cursor:grabbing}
.dsh-nudge-preset-grip:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-preset-toggle{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:4px 6px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dsh-nudge-preset-toggle:hover{background:var(--dn-hover)}
.dsh-nudge-preset-toggle:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-preset-toggle svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-preset-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600}
.dsh-nudge-tip-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;line-height:1.6}
.dsh-nudge-preset-tools{display:flex;align-items:center;gap:4px;flex:0 0 auto}
/* Drag: the summary is the handle, and the row follows the pointer live. */
.dsh-nudge-preset-summary{cursor:grab}
.dsh-nudge-preset-summary:active{cursor:grabbing}
.dsh-nudge-preset-row.dragging{opacity:.65;border-color:var(--dn-accent-line);box-shadow:0 6px 18px rgba(0,0,0,.08)}
.dsh-nudge-preset-row.disabled{opacity:.72}
.dsh-nudge-preset-row.disabled .dsh-nudge-preset-name{color:var(--dsw-alias-label-secondary,#8a8a8a);font-weight:500}
.dsh-nudge-preset-state{flex:0 0 auto;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font:inherit;font-size:11px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease,border-color .15s ease}
.dsh-nudge-preset-state:hover{background:var(--dn-hover)}
.dsh-nudge-preset-state.on{background:var(--dn-accent-soft);border-color:var(--dn-accent-line);color:var(--dn-accent)}
.dsh-nudge-preset-state:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-preset-body{margin:0 6px 2px 30px;padding:8px 10px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 4%,transparent);color:var(--dsw-alias-label-secondary,#555);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:min(280px,36vh);overflow-y:auto}
.dsh-nudge-preset-editor{display:flex;flex-direction:column;gap:8px;padding:2px 6px 2px 30px}
.dsh-nudge-preset-editor input{flex:0 0 auto}
.dsh-nudge-preset-empty{padding:14px;border:1px dashed var(--dn-line);border-radius:12px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:12px;line-height:1.6;text-align:center}
.dsh-nudge-preset-import{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px dashed var(--dn-accent-line);border-radius:12px}
.dsh-nudge-preset-import textarea{width:100%;box-sizing:border-box;min-height:96px;max-height:min(320px,40vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-import textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
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
.dsh-nudge-settings-group,.dsh-nudge-stats-group{display:flex;flex-direction:column;gap:7px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent)}
/* A setting that is one control wide enough to sit on a single row: label on
   the left, its choices on the right, no separate description line. */
.dsh-nudge-settings-inline{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px}
.dsh-nudge-settings-inline .dsh-nudge-toggle-title{flex:0 0 auto}
.dsh-nudge-settings-inline .dsh-nudge-presets{flex-wrap:nowrap}
/* The stats board is the page's hero: slightly raised, and a container so the
   chart/ranking split only kicks in when the panel is actually wide enough. */
.dsh-nudge-stats-group{container-type:inline-size;container-name:dsh-nudge-stats;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.dsh-nudge-settings-error{color:var(--dsw-alias-state-error-primary,#c8433c);font-size:12px;line-height:1.5}
.dsh-nudge-tip{position:fixed;z-index:${Z_INDEX + 2};box-sizing:border-box;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 92%,#000);color:#fff;font:12px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 10px 26px -8px rgba(15,23,42,.45);pointer-events:none;animation:dsh-nudge-tip-in .12s ease-out}
@keyframes dsh-nudge-tip-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
.dsh-nudge-tip-head{display:flex;align-items:baseline;gap:6px;white-space:nowrap}
.dsh-nudge-tip-title{font-weight:600}
.dsh-nudge-tip-state{color:color-mix(in srgb,var(--dn-accent) 55%,#fff);font-weight:600}
.dsh-nudge-tip-hint{margin-top:2px;font-size:11px;line-height:1.5;opacity:.78}
@media (prefers-reduced-motion:reduce){.dsh-nudge-tip{animation:none}}
`.trim()

    /**
     * Build the React view over one runtime.
     * @param runtime - window runtime.
     * @returns the slot component.
     */
    function makeView(runtime) {
      /** The same form the shell section renders, reused by the in-window panel. */
      const SettingsForm = makeSettingsView(runtime)

      /**
       * Write the dragged window's position straight onto its node.
       *
       * A drag is a pointer sample every 4–16 ms. Taking each one through the
       * store re-rendered the whole card — the annotation tray and the prompt
       * row included — for a position only the root element shows. The render
       * keeps owning `left`/`top`; this write exists only between the press and
       * the drop, and the drop commits the same numbers through the store, so
       * the first render after it paints the value the pointer already shows.
       */
      function paintDrag(node, point) {
        const style = node?.style
        if (!style) return
        style.left = `${point.x}px`
        style.top = `${point.y}px`
      }

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
        const popupInputRef = React.useRef(null)
        /** The in-place note editor's field, and the tray list it may scroll. */
        const editInputRef = React.useRef(null)
        const noteListRef = React.useRef(null)
        const quickAddInputRef = React.useRef(null)
        const quickEditInputRef = React.useRef(null)
        /** The chip row: its children hold the layout a reorder is measured from. */
        const chipRowRef = React.useRef(null)
        /** One chip drag in flight; a ref, because a drag must not re-render. */
        const chipDragRef = React.useRef(null)
        /** Chip boxes captured before a reorder, replayed by the FLIP pass below. */
        const chipFlipRef = React.useRef(null)
        /** Where the dropped chip was painted, so the drop can animate from there. */
        const chipSettleRef = React.useRef(null)
        /** Insertion slot the drag currently points at, or null; the caret renders it. */
        const [chipDropIndex, setChipDropIndex] = React.useState(null)
        // The selection card is a writing box: opening it puts the caret straight
        // into the note field so the user can type without clicking first.
        //
        // The focus runs in a layout effect and is retried on the next frame: the
        // shell may hand the focus back to the composer in the same task the card
        // mounts. The captured range is deliberately NOT put back — re-selecting
        // fires a document-wide selectionchange and the browser paints the passage
        // instead of the field, so the card looks unfocused. Extension is done by
        // `onExtendPointerDown` from the draft's own range, which needs no native
        // selection, and the passage stays painted by `::highlight`.
        const useLayoutFocus = React.useLayoutEffect ?? React.useEffect
        useLayoutFocus(() => {
          if (state.annotationDraft === null || state.annotationEditingId !== null) return undefined
          if (state.annotationCardHidden === true) return undefined
          const node = popupInputRef.current
          if (!node || typeof node.focus !== 'function') return undefined
          const focus = () => {
            try {
              node.focus({ preventScroll: true })
            } catch {
              /* unfocusable */
            }
          }
          focus()
          if (typeof window.requestAnimationFrame !== 'function') return undefined
          const frame = window.requestAnimationFrame(() => {
            const active = document.activeElement
            if (active === node) return
            if (runtime.isSelfNode(active)) return
            focus()
          })
          return () => window.cancelAnimationFrame(frame)
        }, [state.annotationDraft, state.annotationCardHidden])
        // The in-place editor is a writing box too: opening it puts the caret at
        // the end of the stored note, so typing appends instead of replacing.
        useLayoutFocus(() => {
          if (state.annotationEditingId === null) return
          const node = editInputRef.current
          if (!node || typeof node.focus !== 'function') return
          try {
            node.focus({ preventScroll: true })
            if (typeof node.setSelectionRange === 'function') {
              const end = typeof node.value === 'string' ? node.value.length : 0
              node.setSelectionRange(end, end)
            }
          } catch {
            /* unfocusable */
          }
        }, [state.annotationEditingId])
        // The tray keeps one height, so a note landing in a scrolled list must
        // bring the list to its bottom: that is the only movement allowed.
        React.useEffect(() => {
          const node = noteListRef.current
          if (!node || typeof node.scrollTo !== 'function') return
          node.scrollTo({ top: node.scrollHeight })
        }, [state.annotations.length])
        // Opening the in-window prompt form puts the caret in the title field.
        React.useEffect(() => {
          if (state.nudgeDraftOpen !== true) return
          const node = quickAddInputRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus({ preventScroll: true })
            } catch {
              /* unfocusable */
            }
          }
        }, [state.nudgeDraftOpen])
        // The in-window editor is a writing box too: the caret lands at the end
        // of the stored title, so opening it never loses a keystroke.
        React.useEffect(() => {
          if (state.nudgeEditId === null) return
          const node = quickEditInputRef.current
          if (!node || typeof node.focus !== 'function') return
          try {
            node.focus({ preventScroll: true })
            if (typeof node.setSelectionRange === 'function') {
              const end = typeof node.value === 'string' ? node.value.length : 0
              node.setSelectionRange(end, end)
            }
          } catch {
            /* unfocusable */
          }
        }, [state.nudgeEditId])
        /** Order of the prompt list; a change is what a drag's FLIP pass reacts to. */
        const chipOrderKey = state.presets.map((preset) => preset.id).join('|')
        // The row is frozen for the whole drag: nothing reorders until the drop, so
        // a long chip can no longer change the wrapping under the pointer and flip
        // the target slot back and forth. What is left is the drop itself — the
        // row takes its new order in one commit, and this pass animates it: the
        // displaced chips from the boxes they had, the dropped chip from wherever
        // the pointer left it.
        useLayoutFocus(() => {
          const before = chipFlipRef.current
          chipFlipRef.current = null
          const settle = chipSettleRef.current
          chipSettleRef.current = null
          const dropped = settle === null ? null : settle.node
          if (before !== null && chipsMotionOn()) {
            for (const box of chipRowLayout()) {
              if (box.node === dropped) continue
              const prev = before.get(box.id)
              if (prev === undefined) continue
              const dx = beforeChipShift(prev, box, 'left')
              const dy = beforeChipShift(prev, box, 'top')
              if (dx === 0 && dy === 0) continue
              if (typeof box.node?.animate !== 'function') continue
              try {
                box.node.animate(
                  [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                  { duration: CHIP_SHIFT_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
                )
              } catch {
                /* the motion is decoration */
              }
            }
          }
          if (settle !== null && chipsMotionOn() && typeof settle.node?.animate === 'function') {
            const box = chipRowLayout().find((item) => item.node === settle.node)
            if (box !== undefined) {
              const dx = Math.round(settle.left - box.left)
              const dy = Math.round(settle.top - box.top)
              if (dx !== 0 || dy !== 0) {
                try {
                  settle.node.animate(
                    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                    { duration: CHIP_SETTLE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
                  )
                } catch {
                  /* the motion is decoration */
                }
              }
            }
          }
          const dragging = chipDragRef.current
          if (dragging !== null && dragging.moved === true) placeChipUnderPointer(dragging)
        }, [chipOrderKey])
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
        /** Copy the captured passage; the icon reports the result in place. */
        const copyIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', {
            x: 5.4,
            y: 5.4,
            width: 7.4,
            height: 7.4,
            rx: 1.6,
            stroke: 'currentColor',
            strokeWidth: 1.3,
          }),
          h('path', {
            d: 'M10.6 5.4V4.2A1.6 1.6 0 0 0 9 2.6H4.2A1.6 1.6 0 0 0 2.6 4.2V9c0 .9.7 1.6 1.6 1.6h1.2',
            stroke: 'currentColor',
            strokeWidth: 1.3,
            strokeLinecap: 'round',
          }),
        )
        const copiedIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'm3.4 8.4 3 3 6.2-6.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
        const copyFailedIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
        const popup =
          state.quick && draft !== null && state.annotationCardHidden !== true
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
                  'div',
                  { key: 'field', className: 'dsh-nudge-popup-field' },
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
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-copy',
                      title:
                        copyFlash === 'done'
                          ? t('copiedShort')
                          : copyFlash === 'failed'
                            ? t('copyFailedShort')
                            : t('copyHint'),
                      'aria-label': t('copyHint'),
                      'data-copied': copyFlash === '' ? undefined : copyFlash,
                      onClick: copyQuote,
                    },
                    copyFlash === 'done' ? copiedIcon : copyFlash === 'failed' ? copyFailedIcon : copyIcon,
                  ),
                ),
                h('div', { key: 'actions', className: 'dsh-nudge-popup-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-answer',
                      title: t('asAnswerHint'),
                      'aria-label': t('asAnswerHint'),
                      onClick: () => runtime.markAsAnswer(),
                    },
                    t('asAnswer'),
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
                      className: 'dsh-nudge-popup-quick',
                      title: t('agreeThis'),
                      'aria-label': t('agreeThis'),
                      onClick: () => runtime.quickReply('agree'),
                    },
                    t('agreeThis'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-quick',
                      title: t('disagreeThis'),
                      'aria-label': t('disagreeThis'),
                      onClick: () => runtime.quickReply('disagree'),
                    },
                    t('disagreeThis'),
                  ),
                ),
              )
            : null
        /** The note the in-place editor is about, or null. */
        const editingItem =
          state.annotationEditingId === null
            ? null
            : (state.annotations.find((item) => item.id === state.annotationEditingId) ?? null)
        /**
         * The in-place editor for one collected note: the same card as the
         * capture bubble, hung off the passage (or tray row) that was clicked.
         * It owns the edit, so the window never has to unfold or grow for it.
         */
        const editPopup =
          state.annotationDraft === null && editingItem !== null
            ? h(
                'div',
                {
                  key: 'edit-popup',
                  className: 'dsh-nudge-popup dsh-nudge-edit-popup',
                  style: runtime.editPopupPosition(),
                  role: 'dialog',
                  'aria-label': t('annotationsTitle'),
                },
                h(
                  'div',
                  { key: 'quote', className: 'dsh-nudge-annotation-quote dsh-nudge-edit-quote' },
                  editingItem.quote,
                ),
                h('textarea', {
                  key: 'note',
                  ref: editInputRef,
                  rows: 2,
                  className: 'dsh-nudge-annotation-input dsh-nudge-edit-input',
                  value: state.annotationNote,
                  placeholder: t('annotationPlaceholder'),
                  'aria-label': t('annotationPlaceholder'),
                  onChange: (event) => runtime.setAnnotationNote(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
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
                  { key: 'actions', className: 'dsh-nudge-popup-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-edit-delete',
                      onClick: () => runtime.removeAnnotation(editingItem.id),
                    },
                    t('deleteAnnotation'),
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => runtime.cancelAnnotationEdit() },
                    t('dismissAnnotation'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-popup-save',
                      title: `${t('saveAnnotation')} (Enter)`,
                      onClick: () => runtime.saveEditedAnnotation(),
                    },
                    t('saveAnnotation'),
                  ),
                ),
                h(
                  'div',
                  { key: 'hint', className: 'dsh-nudge-popup-hint' },
                  h('span', null, t('editNoteHint')),
                ),
              )
            : null

        const dotClass =
          state.phase === 'waiting' ? 'waiting' : state.phase === 'error' ? 'error' : state.phase === 'done' ? 'done' : ''
        const insertMode = state.composerFocused === true
        const turbo = state.turbo === true
        /** Disabled prompts stay in settings but leave the window row. */
        const livePresets = state.presets.filter((preset) => preset.enabled !== false)
        /** The window's own edit mode: drag to reorder, click one to change it. */
        const editing = state.nudgeEditing === true
        /** The caret the row shows while a chip is being dragged, or null. */
        const chipCaretStyle = editing && chipDropIndex !== null ? chipCaretAt(chipDragRef.current, chipDropIndex) : null
        /** The entry the in-window editor is about, or null once it is disabled. */
        const editingPreset =
          state.nudgeEditId === null
            ? null
            : (livePresets.find((preset) => preset.id === state.nudgeEditId) ?? null)
        /** Notes still waiting to be written into the draft. */
        const pendingNotes = runtime.pendingAnnotations().length
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

        /** Whether this browser wants the chip motion (reduced motion users do not). */
        function chipsMotionOn() {
          try {
            if (typeof window === 'undefined') return false
            return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches !== true
          } catch {
            return false
          }
        }

        /**
         * Every chip's box in view coordinates, measured from its layout
         * (`offsetLeft`/`offsetTop`) rather than its painted rect: a chip that is
         * still sliding from the previous reorder must not skew the next one.
         */
        function chipRowLayout() {
          const row = chipRowRef.current
          if (row === null || row === undefined) return []
          let base = null
          try {
            base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
          } catch {
            base = null
          }
          if (base === null) return []
          const boxes = []
          const children = row.children ?? []
          for (let index = 0; index < children.length; index += 1) {
            const node = children[index]
            const id = node?.dataset?.presetId
            if (typeof id !== 'string' || id === '') continue
            boxes.push({
              id,
              node,
              left: base.left + node.offsetLeft,
              top: base.top + node.offsetTop,
              width: node.offsetWidth,
              height: node.offsetHeight,
            })
          }
          return boxes
        }

        /**
         * How far one chip has to travel for its box to land in the new slot:
         * the layout delta, plus any offset still painted from an earlier pass.
         */
        function beforeChipShift(prev, box, axis) {
          const delta = prev[axis] - box[axis]
          let painted = box[axis]
          try {
            const rect = typeof box.node?.getBoundingClientRect === 'function' ? box.node.getBoundingClientRect() : null
            if (rect !== null) painted = rect[axis]
          } catch {
            painted = box[axis]
          }
          return Math.round(delta + (painted - box[axis]))
        }

        /** Put the dragged chip under the pointer, whatever slot its layout took. */
        function placeChipUnderPointer(drag) {
          const row = chipRowRef.current
          const node = drag?.node
          if (row === null || row === undefined || node === undefined || node === null) return
          let base = null
          try {
            base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
          } catch {
            base = null
          }
          if (base === null) return
          const left = base.left + node.offsetLeft
          const top = base.top + node.offsetTop
          node.style.transform = `translate(${Math.round(drag.lastX - drag.grabX - left)}px, ${Math.round(
            drag.lastY - drag.grabY - top,
          )}px)`
        }

        /**
         * Which slot the pointer is pointing at, counted against the boxes frozen
         * at the start of the drag: the row does not move while dragging, so the
         * same pointer position always yields the same slot — that is what stops
         * a wide chip from flipping its neighbours back and forth. The index is
         * an insertion point among the *other* chips, which is the same thing the
         * drop needs.
         */
        function updateChipTarget(drag) {
          if ((drag.boxes ?? []).length < 2) return
          const index = chipSlotAt(drag.boxes, drag.id, drag.lastX, drag.lastY)
          if (drag.target === index) return
          drag.target = index
          setChipDropIndex(index)
        }

        /** The caret that shows the slot above, drawn on the frozen boxes. */
        function chipCaretAt(drag, index) {
          const row = chipRowRef.current
          if (row === null || row === undefined || drag === null) return null
          const rest = (drag.boxes ?? []).filter((box) => box.id !== drag.id)
          if (rest.length === 0) return null
          let base = null
          try {
            base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
          } catch {
            base = null
          }
          if (base === null) return null
          const box = index < rest.length ? rest[index] : rest[rest.length - 1]
          const left = index < rest.length ? box.left - base.left - 2 : box.left + box.width - base.left
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(box.top - base.top)}px`,
            height: `${Math.round(box.height)}px`,
          }
        }

        /** Begin a press on a chip in edit mode; it becomes a drag past a few px. */
        function beginChipDrag(event, preset) {
          if (state.nudgeEditing !== true) return
          if (event === undefined || event === null) return
          if (event.button !== undefined && event.button !== 0) return
          if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return
          const node = event.currentTarget
          if (node === undefined || node === null) return
          if (typeof node.setPointerCapture === 'function' && event.pointerId !== undefined) {
            try {
              node.setPointerCapture(event.pointerId)
            } catch {
              /* capture is best effort */
            }
          }
          let rect = null
          try {
            rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
          } catch {
            rect = null
          }
          chipDragRef.current = {
            id: preset.id,
            node,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            grabX: rect === null ? 0 : event.clientX - rect.left,
            grabY: rect === null ? 0 : event.clientY - rect.top,
            moved: false,
            /** The row's boxes, read once: the drag is decided against them. */
            boxes: null,
            /** Insertion point among the other chips, or null before the first move. */
            target: null,
          }
        }

        /** Follow the pointer once a press has travelled far enough to be a drag. */
        function moveChipDrag(event) {
          const drag = chipDragRef.current
          if (drag === null) return
          if (typeof event?.clientX !== 'number' || typeof event?.clientY !== 'number') return
          drag.lastX = event.clientX
          drag.lastY = event.clientY
          if (drag.moved !== true) {
            if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < CHIP_DRAG_SLOP) return
            drag.moved = true
            drag.boxes = chipRowLayout()
            try {
              drag.node?.classList?.add('dragging')
            } catch {
              /* the lift is decoration */
            }
          }
          placeChipUnderPointer(drag)
          if (drag.boxes !== null) updateChipTarget(drag)
        }

        /**
         * End a press in edit mode. A press that never moved is a click: it opens
         * that entry's editor. One that moved is a drop: the list is committed to
         * the slot the caret was showing, and the row animates into it.
         */
        function endChipDrag(event, openEditor) {
          const drag = chipDragRef.current
          if (drag === null) return
          chipDragRef.current = null
          if (typeof drag.node?.releasePointerCapture === 'function' && drag.pointerId !== undefined) {
            try {
              drag.node.releasePointerCapture(drag.pointerId)
            } catch {
              /* already released */
            }
          }
          try {
            drag.node?.classList?.remove('dragging')
          } catch {
            /* decoration */
          }
          setChipDropIndex(null)
          if (drag.moved === true) {
            dropChip(drag)
            return
          }
          if (openEditor !== false) runtime.startNudgeEdit(drag.id)
        }

        /**
         * Commit the drop. The row was frozen for the whole drag, so the boxes
         * read at its start are still the ones the pointer was judged against:
         * the target index is an insertion point among the *other* chips, and the
         * same index is what the order needs. One commit here, and the layout
         * effect animates the row into it.
         */
        function dropChip(drag) {
          const node = drag.node
          let left = null
          let top = null
          try {
            const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
            if (rect !== null) {
              left = rect.left
              top = rect.top
            }
          } catch {
            left = null
            top = null
          }
          const rest = (drag.boxes ?? []).filter((box) => box.id !== drag.id)
          const target = drag.target
          if (rest.length === 0 || target === null || target === undefined || left === null) {
            settleChip(node)
            return
          }
          const live = state.presets.filter((preset) => preset.enabled !== false).map((preset) => preset.id)
          const current = live.indexOf(drag.id)
          // Dropping on the slot the chip already occupies changes nothing.
          if (current < 0 || target === current) {
            settleChip(node)
            return
          }
          chipFlipRef.current = new Map((drag.boxes ?? []).map((box) => [box.id, box]))
          chipSettleRef.current = { node, left, top }
          if (node !== undefined && node !== null) node.style.transform = ''
          const anchor = target < rest.length ? rest[target] : rest[rest.length - 1]
          if (runtime.movePresetBeside(drag.id, anchor.id, target >= rest.length) !== true) {
            chipFlipRef.current = null
            chipSettleRef.current = null
          }
        }

        /** Let a dropped chip slide from under the pointer back into its slot. */
        function settleChip(node) {
          if (node === undefined || node === null) return
          let from = ''
          try {
            from = typeof window === 'undefined' ? '' : window.getComputedStyle(node).transform
          } catch {
            from = ''
          }
          node.style.transform = ''
          if (from === '' || from === 'none' || chipsMotionOn() !== true) return
          if (typeof node.animate !== 'function') return
          try {
            node.animate([{ transform: from }, { transform: 'none' }], {
              duration: CHIP_SETTLE_MS,
              easing: 'ease-out',
            })
          } catch {
            /* the motion is decoration */
          }
        }
        /** Hover/focus handlers for the explanation bubble of one control. */
        const tipProps = (key) => ({
          onMouseEnter: (event) => runtime.showTip(key, event?.currentTarget?.getBoundingClientRect?.()),
          onMouseLeave: () => runtime.hideTip(),
          onFocus: (event) => runtime.showTip(key, event?.currentTarget?.getBoundingClientRect?.()),
          onBlur: () => runtime.hideTip(),
        })
        /**
         * The spot a click landed on, when a pointer is what clicked. A keyboard
         * activation reports `detail` 0 and no usable coordinates, so it folds
         * from the shared anchor like before.
         */
        function clickPoint(event) {
          if (!event || event.detail === 0) return null
          const x = Number(event.clientX)
          const y = Number(event.clientY)
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          return { x, y }
        }
        /** Clicking the window title folds the window into the pill at the pointer. */
        function onNameClick(event) {
          if (suppressTitleClick.current) {
            suppressTitleClick.current = false
            return
          }
          runtime.setCollapsed(true, clickPoint(event))
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
          onNameClick(event)
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
            h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
            h(
              'button',
              {
                key: 'pill',
                type: 'button',
                className: 'dsh-nudge-pill',
                style: { left: `${state.pos.x}px`, top: `${state.pos.y}px`, '--dn-frame': `${state.frame}px` },
                title: t('expand'),
                'aria-label': t('expand'),
                onClick: onPillClick,
                onPointerDown: onPillPointerDown,
                onPointerMove: onPillPointerMove,
                onPointerUp: onPillPointerUp,
                onPointerCancel: onPillPointerUp,
              },
              markIcon,
              state.unread ? h('span', { className: 'dsh-nudge-unread', title: t('newResult') }) : null,
            ),
            popup,
            editPopup,
          )
        }

        /**
         * Start one pointer drag from the current anchor. The collapsed pill is
         * itself a button, so its own press must not be filtered out by the
         * "buttons keep their own pointer handling" rule.
         */
        function beginDrag(event, allowButtonRoot = false) {
          if (event.button !== 0) return
          // Capturing the pointer on the bar retargets the click away from a
          // button inside it, so buttons keep their own pointer handling.
          const origin = event.target
          if (
            !allowButtonRoot &&
            origin &&
            typeof origin.closest === 'function' &&
            origin.closest('button')
          ) {
            return
          }
          // A previous drag may have ended outside the pill without a click;
          // never let that stale suppression swallow the next real click.
          suppressPillClick.current = false
          // The press lands on the title bar (inside the card) or on the pill
          // itself; the position belongs to the root those live in.
          const root = event.currentTarget
          const node =
            root && typeof root.closest === 'function'
              ? root.closest(DRAG_ROOT_SELECTOR) ?? root
              : root
          drag.current = {
            dx: event.clientX - state.pos.x,
            dy: event.clientY - state.pos.y,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            x: state.pos.x,
            y: state.pos.y,
            node,
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
          if (!current.moved) return
          // No store write per sample: the node follows the pointer, the store
          // hears about the final spot once, on drop.
          const point = clampPoint(
            { x: event.clientX - current.dx, y: event.clientY - current.dy },
            state.collapsed,
          )
          current.x = point.x
          current.y = point.y
          paintDrag(current.node, point)
        }

        /** Finish one drag, committing the final position once. */
        function endDrag() {
          const current = drag.current
          drag.current = null
          if (!current || !current.moved) return
          runtime.moveTo(current.x, current.y)
          runtime.saveUi()
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
          beginDrag(event, true)
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

        /** Place the explanation bubble below its control, flipping when short on room. */
        function tipPosition(box) {
          const width = 224
          const viewportWidth =
            typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 360
          const viewportHeight =
            typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 720
          const center = (box.left + box.right) / 2
          const left = Math.min(Math.max(8, center - width / 2), Math.max(8, viewportWidth - width - 8))
          const below = box.bottom + 6
          const flip = below + 92 > viewportHeight
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(flip ? box.top - 6 : below)}px`,
            width: `${width}px`,
            ...(flip ? { transform: 'translateY(-100%)' } : null),
          }
        }

        /** Title, live state and one-line purpose of a window control. */
        function tipSpecOf(key) {
          if (key === 'quick') {
            return { title: t('quickTitle'), state: state.quick ? t('tipOn') : t('tipOff'), hint: t('quickTip') }
          }
          if (key === 'autopaste') {
            return {
              title: t('autoPasteTitle'),
              state: state.autoPaste ? t('tipOn') : t('tipOff'),
              hint: t('autoPasteTip'),
            }
          }
          if (key === 'delivery') {
            const steer = delivery === 'steer'
            return {
              title: t('deliveryTitle'),
              state: steer ? t('steer') : t('queue'),
              hint: steer ? t('deliveryTipSteer') : t('deliveryTipQueue'),
            }
          }
          if (key === 'turbo') {
            return { title: t('turboTitle'), state: turbo ? t('tipOn') : t('tipOff'), hint: t('turboTip') }
          }
          if (key === 'settings') {
            return { title: t('openSettings'), state: '', hint: t('settingsTip') }
          }
          return null
        }
        const tipSpec = state.tip === null ? null : tipSpecOf(state.tip.key)
        const tipStyle = state.tip === null || tipSpec === null ? null : tipPosition(state.tip)

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
            style: { left: `${state.pos.x}px`, top: `${state.pos.y}px`, '--dn-frame': `${state.frame}px` },
          },
          h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
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
                'aria-label': t('openSettings'),
                ...tipProps('settings'),
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
                    'aria-label': state.quick ? t('quickOn') : t('quickOff'),
                    'aria-pressed': state.quick ? 'true' : 'false',
                    ...tipProps('quick'),
                    onClick: () => runtime.setQuick(!state.quick),
                  },
                  quoteIcon,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-head-icon dsh-nudge-annotation-autopaste${state.autoPaste ? ' active' : ''}`,
                    'aria-label': state.autoPaste ? t('autoPasteOn') : t('autoPasteOff'),
                    'aria-pressed': state.autoPaste ? 'true' : 'false',
                    ...tipProps('autopaste'),
                    onClick: () => runtime.setAutoPaste(!state.autoPaste),
                  },
                  pasteIcon,
                ),
              ),
              state.annotationExpanded
                ? h(
                    'div',
                    { className: 'dsh-nudge-module-body' },
                    // One fixed-height tray. Rows scroll inside the list, and the
                    // guide line and the actions keep their rows, so a note
                    // landing never changes the window's own size.
                    h(
                      'div',
                      { key: 'annotation-tray', className: 'dsh-nudge-annotation-tray' },
                      h(
                        'div',
                        { key: 'annotation-list', className: 'dsh-nudge-annotation-list', ref: noteListRef },
                        ...(state.annotations.length === 0
                          ? [
                              h(
                                'div',
                                {
                                  key: 'annotation-empty',
                                  className: 'dsh-nudge-annotation-hint dsh-nudge-annotation-empty',
                                },
                                state.quick ? t('annotationsHint') : t('annotationsOffHint'),
                              ),
                            ]
                          : state.annotations.map((item) =>
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
                                      onClick: (event) =>
                                        runtime.startEditAnnotation(
                                          item.id,
                                          event?.currentTarget?.getBoundingClientRect?.(),
                                        ),
                                    },
                                    h('span', { className: 'dsh-nudge-annotation-quote', title: item.quote }, item.quote),
                                    item.note !== ''
                                      ? h('span', { className: 'dsh-nudge-annotation-note' }, item.note)
                                      : null,
                                    item.written === true
                                      ? h('span', { className: 'dsh-nudge-annotation-written' }, t('writtenTag'))
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
                            )),
                      ),
                      // Always mounted: the guidance line keeps its height when
                      // the first note arrives, so nothing below it moves.
                      h(
                        'div',
                        {
                          key: 'annotation-hint',
                          className: 'dsh-nudge-annotation-hint dsh-nudge-annotation-guide',
                        },
                        // Only a painted mark can be clicked, so the hint waits
                        // for the quick-notes switch.
                        state.annotations.length > 0 && state.quick ? t('highlightHint') : '',
                      ),
                      // Always mounted too; both buttons simply have nothing to
                      // do until a note is waiting.
                      h(
                        'div',
                        { key: 'annotation-actions', className: 'dsh-nudge-annotation-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-nudge-btn',
                            disabled: pendingNotes === 0,
                            onClick: () => runtime.writeAnnotations(),
                          },
                          t('writeAnnotations'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-nudge-btn primary',
                            disabled: pendingNotes === 0,
                            onClick: () => runtime.sendAnnotations(),
                          },
                          t('sendAnnotations'),
                        ),
                      ),
                    ),
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
                      'aria-label': `${t('mode')}：${delivery === 'steer' ? t('steer') : t('queue')}`,
                      disabled: insertMode,
                      ...tipProps('delivery'),
                      onClick: () => runtime.setDelivery(delivery === 'steer' ? 'followup' : 'steer'),
                    },
                    delivery === 'steer' ? steerIcon : queueIcon,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-nudge-head-icon dsh-nudge-turbo-toggle${turbo ? ' active' : ''}`,
                      'aria-label': `${t('turboTitle')}：${turbo ? t('switchOn') : t('switchOff')}`,
                      'aria-pressed': turbo ? 'true' : 'false',
                      ...tipProps('turbo'),
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
                {
                  ref: chipRowRef,
                  className: `dsh-nudge-presets${editing ? ' editing' : ''}`,
                  role: 'group',
                  'aria-label': t('preset'),
                },
                ...livePresets.map((preset) =>
                  h(
                    'button',
                    {
                      key: preset.id,
                      type: 'button',
                      'data-preset-id': preset.id,
                      className: `dsh-nudge-chip${state.presetId === preset.id ? ' active' : ''}${
                        editing ? ' dsh-nudge-chip-drag' : ''
                      }${state.nudgeEditId === preset.id ? ' editing' : ''}`,
                      title: editing ? t('editChipHint') : preset.text,
                      'aria-label': editing ? `${t('editPreset')}：${preset.label}` : undefined,
                      onMouseDown: keepFocus,
                      onPointerDown: editing ? (event) => beginChipDrag(event, preset) : keepFocus,
                      onPointerMove: editing ? moveChipDrag : undefined,
                      onPointerUp: editing ? (event) => endChipDrag(event, true) : undefined,
                      onPointerCancel: editing ? (event) => endChipDrag(event, false) : undefined,
                      onClick: editing ? undefined : () => runtime.setPreset(preset.id),
                      // Keys do what the pointer does: Enter opens the entry, the
                      // arrows hand it to its neighbour. A drag release also fires
                      // a click, so the pointer path stays off `onClick` on purpose.
                      onKeyDown: editing
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              runtime.startNudgeEdit(preset.id)
                              return
                            }
                            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                            event.preventDefault()
                            const live = state.presets
                              .filter((item) => item.enabled !== false)
                              .map((item) => item.id)
                            const from = live.indexOf(preset.id)
                            const to = from + (event.key === 'ArrowRight' ? 1 : -1)
                            if (from < 0 || to < 0 || to >= live.length) return
                            runtime.movePresetBeside(preset.id, live[to], event.key === 'ArrowRight')
                          }
                        : undefined,
                      onDoubleClick: editing
                        ? undefined
                        : turbo
                          ? () => {
                              runtime.runPreset(preset.id)
                            }
                          : undefined,
                    },
                    editing
                      ? [h('span', { key: 'grip', className: 'dsh-nudge-chip-grip', 'aria-hidden': 'true' }, '⠿'), preset.label]
                      : preset.label,
                  ),
                ),
                chipCaretStyle === null
                  ? null
                  : h('span', {
                      key: 'drop-caret',
                      className: 'dsh-nudge-chip-caret',
                      style: chipCaretStyle,
                      'aria-hidden': 'true',
                    }),
                livePresets.length === 0
                  ? h(
                      'span',
                      { key: 'no-presets', className: 'dsh-nudge-presets-empty' },
                      t(state.presets.length === 0 ? 'presetsEmpty' : 'presetsAllDisabled'),
                    )
                  : null,
                h(
                  'button',
                  {
                    key: 'add-preset',
                    type: 'button',
                    className: 'dsh-nudge-chip dsh-nudge-chip-add',
                    title: t('addPreset'),
                    'aria-label': t('addPreset'),
                    'aria-expanded': state.nudgeDraftOpen === true,
                    onMouseDown: keepFocus,
                    onPointerDown: keepFocus,
                    onClick: () => runtime.startNudgeDraft(),
                  },
                  `＋ ${t('quickAdd')}`,
                ),
                livePresets.length > 0
                  ? h(
                      'button',
                      {
                        key: 'edit-presets',
                        type: 'button',
                        className: `dsh-nudge-chip dsh-nudge-chip-edit${editing ? ' active' : ''}`,
                        title: t('quickEditHint'),
                        'aria-label': t('quickEditHint'),
                        'aria-pressed': editing ? 'true' : 'false',
                        onMouseDown: keepFocus,
                        onPointerDown: keepFocus,
                        onClick: () => runtime.setNudgeEditing(!editing),
                      },
                      `✎ ${t('quickEdit')}`,
                    )
                  : null,
              ),
              state.nudgeEditId !== null && editingPreset !== null
                ? h(
                    'div',
                    { key: 'quick-edit', className: 'dsh-nudge-quick-edit' },
                    h(
                      'div',
                      { className: 'dsh-nudge-quick-add-head' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('editPresetHead')),
                    ),
                    h(
                      'label',
                      { className: 'dsh-nudge-quick-add-field' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('quickAddTitle')),
                      h('input', {
                        ref: quickEditInputRef,
                        type: 'text',
                        value: state.nudgeEditLabel,
                        placeholder: t('quickAddTitle'),
                        onChange: (event) => runtime.setNudgeEditLabel(event.target.value),
                        onKeyDown: (event) => {
                          if (event.isComposing) return
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            runtime.saveNudgeEdit()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            runtime.cancelNudgeEdit()
                          }
                        },
                      }),
                    ),
                    h(
                      'label',
                      { className: 'dsh-nudge-quick-add-field' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('quickAddBody')),
                      h('textarea', {
                        rows: 3,
                        value: state.nudgeEditText,
                        placeholder: t('quickAddBody'),
                        onChange: (event) => runtime.setNudgeEditText(event.target.value),
                        onKeyDown: (event) => {
                          if (event.isComposing) return
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault()
                            runtime.saveNudgeEdit()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            runtime.cancelNudgeEdit()
                          }
                        },
                      }),
                    ),
                    state.nudgeEditError
                      ? h('div', { className: 'dsh-nudge-settings-error', role: 'alert' }, state.nudgeEditError)
                      : null,
                    h(
                      'div',
                      { className: 'dsh-nudge-annotation-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-nudge-btn',
                          onMouseDown: keepFocus,
                          onPointerDown: keepFocus,
                          onClick: () => runtime.cancelNudgeEdit(),
                        },
                        t('cancelPreset'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-nudge-btn primary',
                          onMouseDown: keepFocus,
                          onPointerDown: keepFocus,
                          onClick: () => runtime.saveNudgeEdit(),
                        },
                        t('savePreset'),
                      ),
                    ),
                  )
                : null,
              state.nudgeDraftOpen === true
                ? h(
                    'div',
                    { key: 'quick-add', className: 'dsh-nudge-quick-add' },
                    h(
                      'div',
                      { className: 'dsh-nudge-quick-add-head' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('addPreset')),
                    ),
                    h(
                      'label',
                      { className: 'dsh-nudge-quick-add-field' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('quickAddTitle')),
                      h('input', {
                        ref: quickAddInputRef,
                        type: 'text',
                        value: state.nudgeDraftLabel,
                        placeholder: t('quickAddTitle'),
                        onChange: (event) => runtime.setNudgeDraftLabel(event.target.value),
                        onKeyDown: (event) => {
                          if (event.isComposing) return
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            runtime.saveNudgeDraft()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            runtime.cancelNudgeDraft()
                          }
                        },
                      }),
                    ),
                    h(
                      'label',
                      { className: 'dsh-nudge-quick-add-field' },
                      h('span', { className: 'dsh-nudge-field-label' }, t('quickAddBody')),
                      h('textarea', {
                        rows: 3,
                        value: state.nudgeDraftText,
                        placeholder: t('quickAddBody'),
                        onChange: (event) => runtime.setNudgeDraftText(event.target.value),
                        onKeyDown: (event) => {
                          if (event.isComposing) return
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault()
                            runtime.saveNudgeDraft()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            runtime.cancelNudgeDraft()
                          }
                        },
                      }),
                    ),
                    state.nudgeDraftError
                      ? h('div', { className: 'dsh-nudge-settings-error', role: 'alert' }, state.nudgeDraftError)
                      : null,
                    h(
                      'div',
                      { className: 'dsh-nudge-annotation-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-nudge-btn',
                          onMouseDown: keepFocus,
                          onPointerDown: keepFocus,
                          onClick: () => runtime.cancelNudgeDraft(),
                        },
                        t('cancelPreset'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-nudge-btn primary',
                          onMouseDown: keepFocus,
                          onPointerDown: keepFocus,
                          onClick: () => runtime.saveNudgeDraft(),
                        },
                        t('savePreset'),
                      ),
                    ),
                  )
                : null,
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
                    disabled: livePresets.length === 0 || (!insertMode && state.phase === 'waiting'),
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
          editPopup,
          tipSpec !== null && tipStyle !== null
            ? h(
                'div',
                { key: 'tip', className: 'dsh-nudge-tip', role: 'tooltip', style: tipStyle },
                h(
                  'div',
                  { className: 'dsh-nudge-tip-head' },
                  h('span', { className: 'dsh-nudge-tip-title' }, tipSpec.title),
                  tipSpec.state === '' ? null : h('span', { className: 'dsh-nudge-tip-state' }, tipSpec.state),
                ),
                tipSpec.hint === '' ? null : h('div', { className: 'dsh-nudge-tip-hint' }, tipSpec.hint),
              )
            : null,
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
          { className: 'dsh-nudge-toggle', title: desc, 'data-setting': props.key },
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

      /** A small 16px stroke icon, matching the window's own icons. */
      function presetIcon(pathData) {
        return h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          h('path', { d: pathData }),
        )
      }

      const PENCIL_PATH = 'M10.6 2.4l3 3-8.2 8.2-3.4.6.6-3.4 8-8.4z'
      const CHEVRON_RIGHT = 'M6 4l4 4-4 4'
      const CHEVRON_DOWN = 'M4 6.5l4 4 4-4'
      const TRASH_PATH = 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8'

      /** The preset being dragged, shared by the drag handlers of one list. */
      let draggingId = null
      /** Index of the idle line being dragged, or null. */
      let draggingTip = null

      /**
       * One preset row: a summary line (name, expander, edit, delete, drag),
       * an optional read-only body, and an editor that only writes on save.
       */
      function PresetRow(props) {
        const { preset, t, onError, index, total } = props
        const snapshot = runtime.getSnapshot()
        const open = snapshot.presetOpen.includes(preset.id)
        const editing = snapshot.presetEditingId === preset.id
        const [label, setLabel] = React.useState(preset.label)
        const [text, setText] = React.useState(preset.text)
        React.useEffect(() => {
          setLabel(preset.label)
          setText(preset.text)
        }, [preset.id, preset.label, preset.text])

        function save() {
          const result = runtime.updatePreset(preset.id, { label, text })
          onError(result.ok ? '' : result.error)
        }

        function cancel() {
          setLabel(preset.label)
          setText(preset.text)
          runtime.cancelPresetEdit()
          onError('')
        }

        const enabled = preset.enabled !== false

        /**
         * Live reorder while the pointer travels: the dragged row trades slots
         * with the row under the cursor as soon as the midpoint is crossed, so
         * the list follows the pointer instead of waiting for the drop.
         */
        function dragOverRow(event) {
          if (draggingId === null || draggingId === preset.id) return
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          if (event?.dataTransfer) {
            try {
              event.dataTransfer.dropEffect = 'move'
            } catch {
              /* best effort */
            }
          }
          const target = event?.currentTarget
          const rect = target && typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : undefined
          if (rect === undefined) return
          const after = Number(event.clientY) > rect.top + rect.height / 2
          const list = runtime.getSnapshot().presets
          const from = list.findIndex((item) => item.id === draggingId)
          if (from < 0) return
          const to = after ? (from < index ? index : index + 1) : from < index ? index - 1 : index
          if (to === from || to < 0 || to >= list.length) return
          if (runtime.movePresetTo(draggingId, to)) onError('')
        }

        function dropOn(event) {
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          draggingId = null
        }

        function nudge(delta) {
          if (runtime.movePresetTo(preset.id, index + delta)) onError('')
        }

        const summary = h(
          'div',
          {
            className: 'dsh-nudge-preset-summary',
            draggable: true,
            onDragStart: (event) => {
              draggingId = preset.id
              const row =
                event?.currentTarget && typeof event.currentTarget.closest === 'function'
                  ? event.currentTarget.closest('.dsh-nudge-preset-row')
                  : null
              if (row) row.classList.add('dragging')
              if (event?.dataTransfer) {
                try {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', preset.id)
                } catch {
                  /* best effort */
                }
              }
            },
            onDragEnd: (event) => {
              draggingId = null
              const row =
                event?.currentTarget && typeof event.currentTarget.closest === 'function'
                  ? event.currentTarget.closest('.dsh-nudge-preset-row')
                  : null
              if (row) row.classList.remove('dragging')
            },
          },
          h(
            'span',
            {
              className: 'dsh-nudge-preset-grip',
              title: t('dragPreset'),
              role: 'button',
              tabIndex: 0,
              'aria-label': t('dragPreset'),
              onKeyDown: (event) => {
                if (event.key === 'ArrowUp') nudge(-1)
                if (event.key === 'ArrowDown') nudge(1)
              },
            },
            '⠿',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-nudge-preset-toggle',
              title: open ? t('collapsePreset') : t('expandPreset'),
              'aria-label': open ? t('collapsePreset') : t('expandPreset'),
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => runtime.togglePresetOpen(preset.id),
            },
            h('span', { className: 'dsh-nudge-preset-name' }, preset.label),
            presetIcon(open ? CHEVRON_DOWN : CHEVRON_RIGHT),
          ),
          h(
            'div',
            { className: 'dsh-nudge-preset-tools' },
            h(
              'button',
              {
                type: 'button',
                className: `dsh-nudge-preset-state${enabled ? ' on' : ''}`,
                title: enabled ? t('presetEnabledHint') : t('presetDisabledHint'),
                role: 'switch',
                'aria-checked': enabled ? 'true' : 'false',
                'aria-label': enabled ? t('presetEnabledHint') : t('presetDisabledHint'),
                onClick: () => {
                  runtime.togglePresetEnabled(preset.id)
                  onError('')
                },
              },
              enabled ? t('presetEnabled') : t('presetDisabled'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('editPreset'),
                'aria-label': t('editPreset'),
                'aria-pressed': editing ? 'true' : 'false',
                onClick: () => {
                  if (editing) cancel()
                  else {
                    onError('')
                    runtime.startPresetEdit(preset.id)
                  }
                },
              },
              presetIcon(PENCIL_PATH),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon danger',
                title: t('deletePreset'),
                'aria-label': t('deletePreset'),
                onClick: () => {
                  onError(runtime.removePreset(preset.id) ? '' : t('presetTextRequired'))
                },
              },
              presetIcon(TRASH_PATH),
            ),
          ),
        )

        const body =
          open && !editing
            ? h('div', { className: 'dsh-nudge-preset-body' }, preset.text)
            : null

        const editor = editing
          ? h(
              'div',
              { className: 'dsh-nudge-preset-editor' },
              h('input', {
                type: 'text',
                value: label,
                placeholder: t('presetLabel'),
                'aria-label': t('presetLabel'),
                onChange: (event) => setLabel(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') save()
                  if (event.key === 'Escape') cancel()
                },
              }),
              h('textarea', {
                value: text,
                placeholder: t('presetText'),
                'aria-label': t('presetText'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && event.shiftKey !== true) save()
                  if (event.key === 'Escape') cancel()
                },
              }),
              h(
                'div',
                { className: 'dsh-nudge-preset-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn primary', onClick: save },
                  t('savePreset'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn', onClick: cancel },
                  t('cancelPreset'),
                ),
              ),
            )
          : null

        return h(
          'div',
          {
            className: `dsh-nudge-preset-row${editing ? ' editing' : ''}${enabled ? '' : ' disabled'}`,
            'data-preset-id': preset.id,
            'data-open': open ? 'true' : 'false',
            onDragOver: dragOverRow,
            onDragEnter: dragOverRow,
            onDrop: dropOn,
          },
          summary,
          body,
          editor,
        )
      }

      /**
       * One idle line: the text as a row, an editor behind the pencil icon,
       * and drag (or ↑ ↓ on the handle) for order. No body of its own.
       */
      function TipRow(props) {
        const { value, t, onError, index } = props
        const snapshot = runtime.getSnapshot()
        const editing = snapshot.tipEditingIndex === index
        const [line, setLine] = React.useState(value)
        React.useEffect(() => {
          setLine(value)
        }, [value])

        function save() {
          if (!runtime.updateTip(index, line)) {
            setLine(value)
            onError(t('tipTextRequired'))
            return
          }
          onError('')
        }

        function cancel() {
          setLine(value)
          runtime.cancelTipEdit()
          onError('')
        }

        function nudge(delta) {
          if (runtime.moveTipTo(index, index + delta)) onError('')
        }

        function dropOn(event) {
          if (event !== undefined && typeof event.preventDefault === 'function') event.preventDefault()
          const from = draggingTip
          draggingTip = null
          if (from === null || from === index) return
          if (runtime.moveTipTo(from, index)) onError('')
        }

        const summary = h(
          'div',
          {
            className: 'dsh-nudge-preset-summary',
            draggable: true,
            onDragStart: () => {
              draggingTip = index
            },
            onDragEnd: () => {
              draggingTip = null
            },
            onDragOver: (event) => {
              if (draggingTip === null) return
              if (typeof event.preventDefault === 'function') event.preventDefault()
            },
            onDrop: dropOn,
          },
          h(
            'span',
            {
              className: 'dsh-nudge-preset-grip',
              title: t('dragPreset'),
              role: 'button',
              tabIndex: 0,
              'aria-label': t('dragPreset'),
              onKeyDown: (event) => {
                if (event.key === 'ArrowUp') nudge(-1)
                if (event.key === 'ArrowDown') nudge(1)
              },
            },
            '⠿',
          ),
          h('span', { className: 'dsh-nudge-tip-name' }, value),
          h(
            'div',
            { className: 'dsh-nudge-preset-tools' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon',
                title: t('editTip'),
                'aria-label': t('editTip'),
                'aria-pressed': editing ? 'true' : 'false',
                onClick: () => {
                  if (editing) cancel()
                  else {
                    onError('')
                    runtime.startTipEdit(index)
                  }
                },
              },
              presetIcon(PENCIL_PATH),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn icon danger',
                title: t('deleteTip'),
                'aria-label': t('deleteTip'),
                onClick: () => {
                  onError(runtime.removeTip(index) ? '' : t('tipLast'))
                },
              },
              presetIcon(TRASH_PATH),
            ),
          ),
        )

        const editor = editing
          ? h(
              'div',
              { className: 'dsh-nudge-preset-editor' },
              h('input', {
                type: 'text',
                value: line,
                placeholder: t('tipsPlaceholder'),
                'aria-label': t('tipsPlaceholder'),
                onChange: (event) => setLine(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') save()
                  if (event.key === 'Escape') cancel()
                },
              }),
              h(
                'div',
                { className: 'dsh-nudge-preset-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn primary', onClick: save },
                  t('savePreset'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dsh-nudge-btn', onClick: cancel },
                  t('cancelPreset'),
                ),
              ),
            )
          : null

        return h(
          'div',
          { className: 'dsh-nudge-preset-row dsh-nudge-tip-row', 'data-tip-index': index },
          summary,
          editor,
        )
      }

      return function NudgeSettings() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const [error, setError] = React.useState('')
        /** What the last paste into each list did, shown under that list's own box. */
        const [presetNote, setPresetNote] = React.useState('')
        const [tipNote, setTipNote] = React.useState('')
        const [draftLabel, setDraftLabel] = React.useState('')
        const [draftText, setDraftText] = React.useState('')
        const [draftTip, setDraftTip] = React.useState('')
        const [importOpen, setImportOpen] = React.useState(false)
        const [draftImport, setDraftImport] = React.useState('')
        const [copyNote, setCopyNote] = React.useState('')
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()
        const today = dayKey()
        const statsDays = state.stats?.days ?? {}
        /** The trend window, oldest first; the chart and Top 3 share it. */
        const windowKeys = recentDayKeys(15)
        const windowTotals = { send: 0, insert: 0, annotation: 0 }
        for (const key of windowKeys) {
          for (const field of STAT_FIELDS) windowTotals[field] += statsDays[key]?.[field] ?? 0
        }
        const windowTotal = STAT_FIELDS.reduce((sum, field) => sum + windowTotals[field], 0)
        const windowInputs = windowTotals.send + windowTotals.insert
        // Two series: everything typed into or sent to the composer is one
        // prompt use; notes stay separate because they answer a different
        // question ("how much did I annotate?").
        const inputSeries = windowKeys.map((key) => (statsDays[key]?.send ?? 0) + (statsDays[key]?.insert ?? 0))
        const noteSeries = windowKeys.map((key) => statsDays[key]?.annotation ?? 0)
        // Today splits the same two ways as the chart: a quick input counts
        // once whether it was sent or written, and notes stay their own number.
        const todayInputs = inputSeries[windowKeys.length - 1] ?? 0
        const todayNotes = noteSeries[windowKeys.length - 1] ?? 0
        const hasActivity = inputSeries.some((value) => value > 0) || noteSeries.some((value) => value > 0)
        /** Tallest value in either series; both lines share one scale. */
        const peak = Math.max(1, ...inputSeries, ...noteSeries)

        // Rank the prompts used in this same window. Counts live beside the
        // daily totals, so deleted prompts simply fall out of the list.
        const presetTotals = new Map()
        for (const key of windowKeys) {
          const presets = statsDays[key]?.presets
          if (presets === null || typeof presets !== 'object') continue
          for (const [id, count] of Object.entries(presets)) {
            presetTotals.set(id, (presetTotals.get(id) ?? 0) + count)
          }
        }
        const topPresets = [...presetTotals.entries()]
          .map(([id, total]) => ({ preset: state.presets.find((item) => item.id === id), total }))
          .filter((item) => item.preset !== undefined)
          .sort((a, b) => b.total - a.total || String(a.preset.id).localeCompare(String(b.preset.id)))
          .slice(0, 3)
        const topTotal = topPresets.reduce((sum, item) => sum + item.total, 0)

        // Hand-rolled SVG: the plugin ships no chart dependency. The days are
        // discrete, so the line runs straight between them and every day that
        // actually carries a count gets a marker: no invented smooth curve, and
        // the reader can still see where the data really is.
        const CHART_W = 320
        const CHART_H = 168
        const CHART_PAD_X = 6
        const CHART_PAD_TOP = 12
        const CHART_PAD_BOTTOM = 8
        const round = (value) => Math.round(value * 10) / 10
        const baseline = CHART_H - CHART_PAD_BOTTOM
        const plotHeight = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM
        /** The scale tops out at the busiest day; the top padding is the headroom. */
        const scaleMax = Math.max(1, peak)
        const xAt = (index) =>
          windowKeys.length <= 1
            ? CHART_PAD_X
            : CHART_PAD_X + (index * (CHART_W - CHART_PAD_X * 2)) / (windowKeys.length - 1)
        const yAt = (value) => baseline - (Math.max(0, value) / scaleMax) * plotHeight
        /** Straight segments between days: the value between two days is unknown. */
        function linePath(series) {
          return series
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${round(xAt(index))} ${round(yAt(value))}`)
            .join(' ')
        }
        /** The same line closed down to the baseline, for the soft fill. */
        function areaPath(series) {
          const first = round(xAt(0))
          const last = round(xAt(series.length - 1))
          return `${linePath(series)} L ${last} ${baseline} L ${first} ${baseline} Z`
        }
        /** One marker per day that really carries a count. */
        function pointsOf(series, className) {
          return series.flatMap((value, index) =>
            value <= 0
              ? []
              : [
                  h('circle', {
                    key: `point-${className}-${index}`,
                    className: `dsh-nudge-chart-point ${className}`,
                    cx: round(xAt(index)),
                    cy: round(yAt(value)),
                    r: className === 'input' ? '2.9' : '2.5',
                  }),
                ],
          )
        }
        /** Gridlines at half and full height, so the scale is readable. */
        const gridValues = [1, 0.5]
        const inputLine = linePath(inputSeries)
        const noteLine = linePath(noteSeries)
        const inputArea = areaPath(inputSeries)
        const noteArea = areaPath(noteSeries)
        const todayIndex = windowKeys.length - 1

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
            setTipNote('')
            return false
          }
          const parts = [fill(t('tipsAdded'), result.added)]
          if (result.skipped > 0) parts.push(fill(t('tipsSkipped'), result.skipped))
          setError('')
          setTipNote(parts.join('，'))
          setDraftTip('')
          return true
        }

        function addTipLine() {
          addTipLines(draftTip)
        }

        /** Take one pasted block list and report what landed. */
        function importLines(raw) {
          const result = runtime.importPresets(raw)
          if (!result.ok) {
            setError(result.error)
            setPresetNote('')
            return false
          }
          const parts = [fill(t('importAdded'), result.added)]
          if (result.skipped > 0) parts.push(fill(t('importSkipped'), result.skipped))
          setError('')
          setPresetNote(parts.join('，'))
          setDraftImport('')
          return true
        }

        /** Copy every configured prompt and report the outcome in place. */
        function exportLines() {
          Promise.resolve(runtime.exportPresets()).then((result) => {
            if (result?.ok !== true) {
              setError(result?.error ?? t('exportFailed'))
              setCopyNote('')
              return
            }
            setError('')
            setCopyNote(fill(t('exportDone'), result.count))
          })
        }

        /** A pasted list is split right away: no extra click needed. */
        function onTipPaste(event) {
          const text = event?.clipboardData?.getData?.('text')
          if (typeof text !== 'string' || text.trim() === '') return
          event.preventDefault?.()
          addTipLines(text)
        }

        /**
         * One settings block with the same heading rhythm as a floating-window
         * module: accent bar, title, optional one-line description.
         */
        function settingsSection(key, title, desc, children, options) {
          const collapsible = options?.collapsible === true
          const head = h(
            collapsible ? 'summary' : 'div',
            { className: 'dsh-nudge-settings-section-head' },
            h('span', { className: 'dsh-nudge-settings-section-title' }, title),
            options?.meta ? h('span', { className: 'dsh-nudge-settings-section-meta' }, options.meta) : null,
          )
          return h(
            collapsible ? 'details' : 'section',
            { key, className: `dsh-nudge-settings-section${collapsible ? ' collapsible' : ''}` },
            head,
            desc ? h('div', { className: 'dsh-nudge-settings-section-desc' }, desc) : null,
            ...children,
          )
        }

        /** A nested, closed-by-default editor (the long prompt list). */
        function foldGroup(key, title, meta, children, hint) {
          return h(
            'details',
            { key, className: 'dsh-nudge-settings-fold' },
            h(
              'summary',
              {
                className: 'dsh-nudge-settings-fold-head',
                ...(typeof hint === 'string' && hint !== '' ? { title: hint } : null),
              },
              h('span', null, title),
              meta ? h('span', { className: 'dsh-nudge-settings-fold-meta' }, meta) : null,
            ),
            ...children,
          )
        }

        // The dashboard leads the settings page: it answers "am I using this?"
        // before the switches that change how it behaves.
        const statsSection = h(
          'div',
          { key: 'stats', className: 'dsh-nudge-stats-group' },
          h(
            'div',
            { className: 'dsh-nudge-stats-head' },
            h('span', { className: 'dsh-nudge-toggle-title' }, t('statsTitle')),
          ),
          h('span', { className: 'dsh-nudge-toggle-desc' }, t('statsHint')),
          h(
            'div',
            { className: 'dsh-nudge-stats-board' },
            h(
              'div',
              { className: 'dsh-nudge-stats-chart-pane' },
              h(
                'div',
                { className: 'dsh-nudge-stats-trend-head' },
                h('span', { className: 'dsh-nudge-chart-peak' }, fill(t('statsPeak'), peak)),
                h('span', { className: 'dsh-nudge-stats-total' }, fill(t('statsTimes'), windowTotal)),
              ),
              h(
                'div',
                { className: 'dsh-nudge-chart-wrap' },
                h(
                  'svg',
                  {
                    className: 'dsh-nudge-chart-svg',
                    viewBox: `0 0 ${CHART_W} ${CHART_H}`,
                    preserveAspectRatio: 'none',
                    'aria-hidden': 'true',
                  },
                  h(
                    'defs',
                    null,
                    h(
                      'linearGradient',
                      { id: 'dsh-nudge-fill-input', x1: '0', y1: '0', x2: '0', y2: '1' },
                      h('stop', { offset: '0%', stopColor: 'var(--dsw-static-deepseek-450,#5686fe)', stopOpacity: '0.14' }),
                      h('stop', { offset: '100%', stopColor: 'var(--dsw-static-deepseek-450,#5686fe)', stopOpacity: '0' }),
                    ),
                    h(
                      'linearGradient',
                      { id: 'dsh-nudge-fill-note', x1: '0', y1: '0', x2: '0', y2: '1' },
                      h('stop', { offset: '0%', stopColor: 'var(--dn-note)', stopOpacity: '0.10' }),
                      h('stop', { offset: '100%', stopColor: 'var(--dn-note)', stopOpacity: '0' }),
                    ),
                  ),
                  ...gridValues.map((fraction) =>
                    h('line', {
                      key: `grid-${fraction}`,
                      className: 'dsh-nudge-chart-grid',
                      x1: '0',
                      y1: round(baseline - fraction * plotHeight),
                      x2: CHART_W,
                      y2: round(baseline - fraction * plotHeight),
                      vectorEffect: 'non-scaling-stroke',
                    }),
                  ),
                  h('line', {
                    className: 'dsh-nudge-chart-axis-line',
                    x1: '0',
                    y1: baseline,
                    x2: CHART_W,
                    y2: baseline,
                    vectorEffect: 'non-scaling-stroke',
                  }),
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-area note',
                        d: noteArea,
                        fill: 'url(#dsh-nudge-fill-note)',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-area input',
                        d: inputArea,
                        fill: 'url(#dsh-nudge-fill-input)',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-line note',
                        d: noteLine,
                        fill: 'none',
                        stroke: 'var(--dn-note)',
                        strokeWidth: '1.6',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        vectorEffect: 'non-scaling-stroke',
                      })
                    : null,
                  hasActivity
                    ? h('path', {
                        className: 'dsh-nudge-chart-line input',
                        d: inputLine,
                        fill: 'none',
                        stroke: 'var(--dsw-static-deepseek-450,#5686fe)',
                        strokeWidth: '1.8',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        vectorEffect: 'non-scaling-stroke',
                      })
                    : null,
                  ...(hasActivity ? pointsOf(noteSeries, 'note') : []),
                  ...(hasActivity ? pointsOf(inputSeries, 'input') : []),
                ),
                hasActivity
                  ? null
                  : h('div', { className: 'dsh-nudge-chart-empty' }, t('statsEmpty')),
                h(
                  'div',
                  { className: 'dsh-nudge-chart-hits' },
                  ...windowKeys.map((key, index) =>
                    h(
                      'div',
                      { key, className: 'dsh-nudge-chart-hit' },
                      h(
                        'span',
                        { className: 'dsh-nudge-chart-tip' },
                        h(
                          'span',
                          { className: 'dsh-nudge-chart-tip-date' },
                          key === today ? t('statsToday') : key.slice(5),
                        ),
                        h(
                          'span',
                          { className: 'dsh-nudge-chart-tip-values' },
                          `${t('statsLegendInput')} ${inputSeries[index]} · ${t('statsAnnotation')} ${noteSeries[index]}`,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsh-nudge-stats-axis' },
                h('span', null, windowKeys[0].slice(5)),
                h('span', null, windowKeys[7].slice(5)),
                h('span', null, t('statsToday')),
              ),
              h(
                'div',
                { className: 'dsh-nudge-chart-legend' },
                h(
                  'span',
                  { className: 'dsh-nudge-chart-legend-item' },
                  h('i', { className: 'dsh-nudge-chart-dot input' }),
                  t('statsLegendInput'),
                ),
                h(
                  'span',
                  { className: 'dsh-nudge-chart-legend-item' },
                  h('i', { className: 'dsh-nudge-chart-dot note' }),
                  t('statsAnnotation'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsh-nudge-stats-side' },
              h(
                'div',
                { className: 'dsh-nudge-stats-today' },
                h(
                  'div',
                  { className: 'dsh-nudge-stats-today-head' },
                  h('span', { className: 'dsh-nudge-stats-today-label' }, t('statsToday')),
                  h('span', { className: 'dsh-nudge-stats-today-date' }, today.slice(5)),
                ),
                h(
                  'div',
                  { className: 'dsh-nudge-stats' },
                  ...[
                    { key: 'input', value: todayInputs, label: t('statsLegendInput') },
                    { key: 'note', value: todayNotes, label: t('statsAnnotation') },
                  ].map((item) =>
                    h(
                      'div',
                      { key: item.key, className: 'dsh-nudge-stat' },
                      h('span', { className: 'dsh-nudge-stat-value' }, String(item.value)),
                      h('span', { className: 'dsh-nudge-stat-label' }, item.label),
                    ),
                  ),
                ),
              ),
              h('div', { className: 'dsh-nudge-stats-side-head' }, h('span', null, t('statsTopTitle'))),
              topPresets.length === 0
                ? h(
                    'div',
                    { className: 'dsh-nudge-stats-side-empty' },
                    windowInputs > 0 ? t('statsTopSince') : t('statsTopEmpty'),
                  )
                : h(
                    'ol',
                    { className: 'dsh-nudge-top-list' },
                    ...topPresets.map((item, index) =>
                      h(
                        'li',
                        { key: item.preset.id, className: 'dsh-nudge-top-item' },
                        h('span', { className: 'dsh-nudge-top-rank' }, String(index + 1)),
                        h('span', { className: 'dsh-nudge-top-label', title: item.preset.text }, item.preset.label),
                        h('span', { className: 'dsh-nudge-top-count' }, fill(t('statsCountUnit'), item.total)),
                      ),
                    ),
                  ),
              topPresets.length > 0
                ? h('div', { className: 'dsh-nudge-stats-share' }, fill(t('statsTopShare'), topTotal))
                : null,
            ),
          ),
        )

        return h(
          'div',
          { className: 'dsh-nudge-settings' },
          h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
          statsSection,
          // The settings page follows the floating window: notes, quick input,
          // then appearance (border and status line). Both long editors start
          // folded so the switches stay in view.
          settingsSection('annotations', t('annotationsTitle'), null, [
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
          ]),
          settingsSection('quickinput', t('nudgeModule'), t('presetsHint'), [
            foldGroup('presets', t('presetList'), t('presetCount').replace('{n}', String(state.presets.length)), [
            // The list is a table of contents: names only, bodies on demand.
            h(
              'div',
              { className: 'dsh-nudge-preset-toolbar' },
              h('span', { className: 'dsh-nudge-preset-count' }, t('presetCount').replace('{n}', String(state.presets.length))),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  disabled: state.presets.length === 0,
                  onClick: () => runtime.setPresetsOpen(true),
                },
                t('expandAllPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  disabled: state.presetOpen.length === 0,
                  onClick: () => runtime.setPresetsOpen(false),
                },
                t('collapseAllPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  'aria-expanded': importOpen ? 'true' : 'false',
                  onClick: () => setImportOpen(importOpen !== true),
                },
                t('importPresets'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  title: t('exportHint'),
                  disabled: state.presets.length === 0,
                  onClick: exportLines,
                },
                t('exportPresets'),
              ),
            ),
            copyNote.length > 0
              ? h('div', { key: 'preset-copy-note', className: 'dsh-nudge-settings-note' }, copyNote)
              : null,
            state.presets.length === 0
              ? h('div', { className: 'dsh-nudge-preset-empty' }, t('presetsEmpty'))
              : null,
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
              { className: 'dsh-nudge-preset-row dsh-nudge-preset-add' },
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
            importOpen
              ? h(
                  'div',
                  { className: 'dsh-nudge-preset-import' },
                  h('div', { className: 'dsh-nudge-settings-hint' }, t('importHint')),
                  h('textarea', {
                    value: draftImport,
                    placeholder: t('importPlaceholder'),
                    'aria-label': t('importPresets'),
                    onChange: (event) => setDraftImport(event.target.value),
                  }),
                  h(
                    'div',
                    { className: 'dsh-nudge-preset-actions' },
                    h(
                      'button',
                      { type: 'button', className: 'dsh-nudge-btn primary', onClick: () => importLines(draftImport) },
                      t('importSubmit'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-nudge-btn',
                        onClick: () => {
                          setImportOpen(false)
                          setDraftImport('')
                          setPresetNote('')
                          setError('')
                        },
                      },
                      t('cancelPreset'),
                    ),
                  ),
                )
              : null,
            // The import count belongs under the import box, not under the
            // idle-line box further down the page.
            presetNote.length > 0
              ? h('div', { key: 'preset-import-note', className: 'dsh-nudge-settings-note' }, presetNote)
              : null,
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
                    setPresetNote('')
                    setError('')
                  },
                },
                t('resetPresets'),
              ),
            ),
            ]),
            h(
              'div',
              {
                key: 'delivery',
                className: 'dsh-nudge-settings-group dsh-nudge-settings-inline',
                title: t('deliveryDesc'),
              },
              h('span', { className: 'dsh-nudge-toggle-title' }, t('deliveryTitle')),
              h(
                'div',
                { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('deliveryTitle') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-chip${delivery === 'steer' ? ' active' : ''}`,
                    title: t('deliveryTipSteer'),
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
                    title: t('deliveryTipQueue'),
                    'aria-pressed': delivery === 'steer' ? 'false' : 'true',
                    onClick: () => runtime.setDelivery('followup'),
                  },
                  t('queue'),
                ),
              ),
            ),
            toggleRow({
              key: 'turbo',
              title: t('turboTitle'),
              desc: t('turboDesc'),
              checked: state.turbo === true,
              onChange: (value) => runtime.setTurbo(value),
            }),
          ]),
          settingsSection('appearance', t('appearanceTitle'), null, [
            h(
              'div',
              {
                key: 'frame',
                className: 'dsh-nudge-settings-group dsh-nudge-settings-inline',
                title: t('frameDesc'),
              },
              h('span', { className: 'dsh-nudge-toggle-title' }, t('frameTitle')),
              h(
                'div',
                { className: 'dsh-nudge-presets', role: 'group', 'aria-label': t('frameTitle') },
                ...FRAME_CHOICES.map((width) =>
                  h(
                    'button',
                    {
                      key: `frame-${width}`,
                      type: 'button',
                      className: `dsh-nudge-chip${state.frame === width ? ' active' : ''}`,
                      'aria-pressed': state.frame === width ? 'true' : 'false',
                      onClick: () => runtime.setFrame(width),
                    },
                    t(frameLabelKey(width)),
                  ),
                ),
              ),
            ),
            // The status row belongs to how the window looks, so it lives with
            // the border. Its list is long: the editor starts folded.
            foldGroup('tips', t('tipsTitle'), t('tipsCount').replace('{n}', String(state.tips.length)), [
              // The paste box sits above the list: it is the way in, so it must
              // not hide under a dozen existing lines.
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
              tipNote.length > 0 ? h('div', { key: 'tips-note', className: 'dsh-nudge-settings-note' }, tipNote) : null,
              // Keyed by the line (the list holds no duplicates), not by the slot:
              // a row that moves keeps its own half-typed text instead of handing
              // it to whichever line lands where it used to be.
              ...state.tips.map((line, index) =>
                h(TipRow, {
                  key: `tip:${line}`,
                  value: line,
                  t,
                  onError: setError,
                  index,
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
                      setTipNote('')
                    },
                  },
                  t('resetTips'),
                ),
              ),
            ], t('tipsHint')),
          ]),
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
     * window runtime so the window can append a chosen prompt, or write notes
     * with the shell's own quote previews, instead of sending. The editor DOM
     * is never touched.
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
            // The phase tells a sent message apart from a deleted quote; the
            // input state publishes it next to the draft.
            readPhase: () => latest.current?.phase,
            // Insertion at the caret: the shell's own splice, which leaves
            // the rest of the document (and its undo step) alone. The write
            // path prefers it over rebuilding the whole draft.
            captureInsertion:
              typeof inputActions?.captureInsertion === 'function'
                ? () => inputActions.captureInsertion()
                : undefined,
            insertText:
              typeof inputActions?.insertText === 'function'
                ? (text, span) => inputActions.insertText(text, span)
                : undefined,
            // The shell's own quote node: the passage is shown as its quote
            // preview (quote mark, hover for the full text, click to remove)
            // and still serializes to the Markdown a plain write produced.
            insertQuote:
              typeof inputActions?.insertQuote === 'function'
                ? (value, summary) => inputActions.insertQuote(value, summary)
                : undefined,
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
