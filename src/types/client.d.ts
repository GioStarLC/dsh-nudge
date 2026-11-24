/**
 * The Client-shell surface this plugin reads, and the shapes it persists.
 *
 * These declarations are global on purpose: the browser half is plain JS with
 * JSDoc, and the value of naming a shape here is that `ctx` and the runtime
 * state have one definition everywhere they are touched instead of an inferred
 * one per call site. When the installed DSH publishes its own client types at a
 * matching version, this is the file they replace — the call sites already
 * carry the annotations.
 */

// --- the shell -----------------------------------------------------------

/** One row in `ctx.sessions.list`'s snapshot. */
interface DshSessionRow {
  title?: unknown
  displayTitle?: unknown
  retainedBy?: { mainView?: number } | null
}

/** The snapshot `ctx.sessions.list.getSnapshot()` publishes. */
interface DshSessionListSnapshot {
  ids?: unknown
  byId?: Record<string, DshSessionRow>
}

/** The sessions service: which conversation the main view retains, and its events. */
interface DshSessionsService {
  list?: { getSnapshot?: () => DshSessionListSnapshot | undefined }
  binding?: (sessionId: string) => { eventSource?: unknown } | undefined
}

/** The Client locale service: dictionaries in, active language out. */
interface DshLocaleService {
  register?: (id: string, dictionaries: Record<string, Record<string, string>>) => void
  getLocale?: () => { active?: unknown } | undefined
}

/** The unified per-session status fact. */
interface DshSessionStatusService {
  sessionStatus?: { getSnapshot?: () => Map<string, string> | undefined }
}

/** What `remote.session.prompt` resolves to. */
interface DshPromptResponse {
  ok?: boolean
  value?: { accepted?: boolean }
  error?: unknown
}

/** The composer's own delivery path, however the composition exposes it. */
interface DshRemoteSession {
  prompt?: (request: Record<string, unknown>, signal?: unknown) => Promise<DshPromptResponse> | DshPromptResponse
}

/** The shortcut registry the settings jump drives. */
interface DshShortcutService {
  registry?: { invoke?: (id: string, context?: unknown) => unknown }
}

/** Services this plugin reads from `ctx.get(...)`. */
interface DshContextServices {
  locale?: DshLocaleService
  sessions?: DshSessionsService
  uiSession?: DshSessionStatusService
  'remote.session'?: DshRemoteSession
  remote?: { session?: DshRemoteSession }
  shortcuts?: DshShortcutService
}

/** The slot registry: an entry and the component mounted at it. */
interface DshSlotEntry {
  name: string
  id: string
  order?: number
  label?: () => string
}

/** The Client plugin context, narrowed to the extension points this plugin uses. */
interface DshClientContext {
  get?: <K extends keyof DshContextServices>(name: K) => DshContextServices[K] | undefined
  effect?: (fn: () => void | (() => void), label?: string) => void
  slots: {
    /** Run the callback inside a slot and hand its own return value back. */
    inject?: <T>(name: string, fn: () => T) => T
    register?: (entry: DshSlotEntry, component: (...args: any[]) => any) => () => void
  }
}

/** The chunk loader the module factory receives: only `async` is used. */
interface DshLoaderRequire {
  async?: (spec: string) => Promise<any>
}

// --- the plugin's own shapes ---------------------------------------------

type NudgeLang = 'zh' | 'en'

/** One probe preset, as the window and the settings page show it. */
interface NudgePreset {
  id: string
  label: string
  text: string
  enabled: boolean
}

/** A quote anchor: where a passage sits in one transcript row. */
interface NudgeAnchor {
  key: string | null
  quote: string
  prefix: string
  suffix: string
  index: number
}

/** One collected annotation, per Session. */
interface NudgeAnnotation {
  id: string
  quote: string
  note: string
  anchor: NudgeAnchor | null
  written?: boolean
  createdAt?: number
}

/** One day's counters. */
interface NudgeStatsDay {
  send?: number
  insert?: number
  annotation?: number
  presets?: Record<string, number>
}

/** The stored counter record, keyed by local day. */
interface NudgeStats {
  days: Record<string, NudgeStatsDay>
}

interface NudgePoint {
  x: number
  y: number
}

/** Every persisted preference, by state field name. */
interface NudgeSettingsState {
  turbo: boolean
  quick: boolean
  autoPaste: boolean
  deliveryOverride: 'followup' | 'steer'
  frame: number
  presetId: string
  presets: NudgePreset[]
  tips: string[]
  stats: NudgeStats
  annotations: NudgeAnnotation[]
}

/** What the readers need besides storage. */
interface NudgeSettingsEnv {
  lang: NudgeLang
  sessionId?: string
}

/** One row of the settings table. */
interface NudgeSettingRow {
  name: string
  field?: string | null
  key: string
  decode?: (raw: string | null, env: NudgeSettingsEnv) => unknown
  encode?: (value: unknown, env: NudgeSettingsEnv) => string | undefined
  persist?: (value: unknown, env: NudgeSettingsEnv) => unknown
  toWire: () => unknown
  fromWire: (value: unknown) => unknown
}

/** The selection a note is being written about, held while its card is open. */
interface NudgeAnnotationDraft {
  quote: string
  anchor: NudgeAnchor | null
  range: Range | null
  anchorPoint: { node: Node; offset: number } | null
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
  pointer: NudgePoint | null
  /** The selection already covers its passage; the card keeps off the pointer. */
  wholePassage: boolean
}

/** The conversation a click is about. */
interface NudgeTarget {
  sessionId: string
  title: string
}

/** The whole runtime state, persisted preferences included. */
interface NudgeRuntimeState extends NudgeSettingsState {
  phase: 'idle' | 'waiting' | 'done' | 'error'
  note: string
  error: string
  flash: string
  lastAt?: number
  lastSessionId?: string
  unread: boolean
  collapsed: boolean
  pos: NudgePoint
  presetOpen: string[]
  presetEditingId: string | null
  target?: NudgeTarget
  pendingQuestion: boolean
  composerFocused: boolean
  tipIndex: number
  tipEditingIndex: number | null
  annotationDraft: NudgeAnnotationDraft | null
  annotationCardHidden: boolean
  annotationNote: string
  annotationEditingId: string | null
  annotationEditRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
  annotationExpanded: boolean
  nudgeExpanded: boolean
  nudgeDraftOpen: boolean
  nudgeDraftLabel: string
  nudgeDraftText: string
  nudgeDraftError: string
  nudgeEditing: boolean
  nudgeEditId: string | null
  nudgeEditLabel: string
  nudgeEditText: string
  nudgeEditError: string
  settingsOpen: boolean
  attentionAt: number
  tip: { key: string; left: number; top: number; right: number; bottom: number } | null
  lang: NudgeLang
}

// --- globals the loader and the shell provide ----------------------------

interface Window {
  /** The runtime this bundle exposes to `scripts/check-client.mjs` and `preview`. */
  __dshNudge?: any
  /** The slot overlay root the shell mounts the plugin into. */
  __ModuleLoader__?: { load: (definition: Record<string, unknown>) => void }
}

/** The factory's `require`: the shell's loader, with package-local chunks on `.async`. */
declare var require: DshLoaderRequire

/** One probe waiting for its answer in a conversation. */
interface NudgeWaitEntry {
  sessionId: string
  requestId: string
  probeText: string
  sawRunning: boolean
  settleTimer?: number
  idleTimer?: number
  receiptTimer?: number
  timeoutTimer?: number
  eventSource?: { getSnapshot?: () => any; subscribe?: (fn: () => void) => () => void }
  unsubscribeEvents?: (() => void) | undefined
  sinceSeq: number
  probeSeq?: number
  stepSeq?: number
}
