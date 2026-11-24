/**
 * Every fixed value the client half shares.
 *
 * Storage keys, sizes, timings, built-in presets and idle lines.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
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
    /**
     * The composer's own left row: the seat shared by the attach mark, the
     * permission chip and the pinned prompts.
     */
    const INPUT_BAR_SLOT = 'conversation.input.left'
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

export { SLOT, SETTINGS_SLOT, COMPOSER_SLOT, INPUT_BAR_SLOT, ENTRY, UI_KEY, DELIVERY_KEY, TURBO_KEY, QUICK_KEY, AUTOPASTE_KEY, FRAME_KEY, FRAME_CHOICES, DEFAULT_FRAME, CHIP_DRAG_SLOP, CHIP_SHIFT_MS, CHIP_SETTLE_MS, NOTES_KEY, ANCHOR_SELECTOR, SELF_SELECTOR, DRAG_ROOT_SELECTOR, HIGHLIGHT_NAME, ANSWER_HIGHLIGHT, CAPTURE_HIGHLIGHT, CONTEXT_CHARS, MAX_NOTES, MAX_NOTE_SESSIONS, MAX_OCCURRENCES, MISS_RESCAN_MS, DIAG_SAMPLES, PRESET_KEY, PRESETS_KEY, STORE_ROUTE, STORE_VERSION, STORE_SYNC_MS, DEFAULT_DELIVERY, BUILTIN_PRESETS, IDLE_NUDGE_EDIT, DEFAULT_PRESET, TIPS_KEY, STATS_KEY, STATS_DAYS, MAX_STAT_PRESETS, MAX_STAT_PRESET_ID, MAX_TIPS, BUILTIN_TIPS, FLASH_HOLD_MS, TIP_ROTATE_MS, MAX_TIP_LENGTH, CARD_WIDTH, PILL_SIZE, EDGE, DOCK_TOP, COMPOSER_RESERVE, Z_INDEX, WAIT_TIMEOUT_MS, SETTLE_MS, IDLE_CONFIRM_MS, EVENT_RECEIPT_MS }
