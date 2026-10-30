/**
 * Live-ish preview renderer for the client half.
 *
 * Instead of hand-assembling throwaway /tmp/*.html files and re-deriving the
 * component markup, this boots the shipped `client.js` bundle through the same
 * VM harness the checks use, drives it into a named scene via its public debug
 * runtime, serializes the *real* rendered tree plus the bundle's own <style>
 * nodes, and screenshots it with a headless browser.
 *
 * One command -> one PNG at a stable path. Point an image viewer at that path
 * and re-run after an edit; no per-check HTML craft required.
 *
 *   node scripts/preview.mjs                # default: "card-idle", light
 *   node scripts/preview.mjs waiting        # a named scene
 *   node scripts/preview.mjs --all          # every scene, light + dark
 *   node scripts/preview.mjs popup --dark   # one scene, dark palette
 *   node scripts/preview.mjs --list         # what scenes exist
 *
 * Output: preview-out/<scene>[-dark].png (and .html alongside it).
 * Env:   PREVIEW_BROWSER  override the browser binary
 *        PREVIEW_SCALE    device scale factor (default 2)
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { boot, tick, renderToHtml, findByClass, pointerAt } from './harness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = join(ROOT, 'preview-out')
const SCALE = process.env.PREVIEW_SCALE ?? '2'

const BROWSER_CANDIDATES = [
  process.env.PREVIEW_BROWSER,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean)

/**
 * Named scenes -> a drive function over a freshly booted instance.
 * Each returns `{ tree, width, height, background }`.
 * `tree` is produced by calling the registered slot Component.
 */
const SCENES = {
  'card-idle': {
    bg: '#f3f4f6',
    drive: async (b) => {
      b.sessionsList.set({ ids: ['A'], byId: { A: { title: '示例会话', retainedBy: { mainView: 1 } } } })
      await tick()
      return { view: 'shell.overlay', width: 520, height: 240 }
    },
  },
  'card-waiting': {
    bg: '#f3f4f6',
    drive: async (b) => {
      b.sessionsList.set({ ids: ['A'], byId: { A: { title: '示例会话', retainedBy: { mainView: 1 } } } })
      await tick()
      b.runtime.ask()
      await tick()
      return { view: 'shell.overlay', width: 520, height: 240 }
    },
  },
  'card-error': {
    bg: '#f3f4f6',
    drive: async (b) => {
      b.runtime.ask() // no open session => error phase
      await tick()
      return { view: 'shell.overlay', width: 520, height: 260 }
    },
  },
  settings: {
    bg: '#f3f4f6',
    drive: async (b) => {
      b.sessionsList.set({ ids: ['A'], byId: { A: { title: '示例会话', retainedBy: { mainView: 1 } } } })
      await tick()
      return { view: 'settings.section', width: 560, height: 640 }
    },
  },
  'annotation-popup': {
    bg: '#f6f7f9',
    drive: async (b) => {
      b.runtime.setQuick(true)
      b.sandbox.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: false,
        toString: () => '这是被选中的原文内容',
        getRangeAt: () => ({
          commonAncestorContainer: { nodeType: 1, closest: () => null },
          getBoundingClientRect: () => ({ left: 120, top: 300, right: 420, bottom: 322, width: 300, height: 22 }),
        }),
      })
      b.runtime.captureSelection()
      await tick()
      return { view: 'shell.overlay', width: 720, height: 460 }
    },
  },
  'settings-panel': {
    bg: '#f6f7f9',
    drive: async (b) => {
      // No shell settings route in the preview harness: the gear's fallback
      // paints the form inside the window, which is what gets captured.
      b.sandbox.document = { querySelector: () => null, querySelectorAll: () => [] }
      await b.runtime.openSettings()
      await tick()
      return { view: 'shell.overlay', width: 720, height: 640 }
    },
  },
}

function findView(booted, viewName) {
  const registration = booted.registrations.find((item) => item.entry.name === viewName)
  if (!registration) throw new Error(`slot "${viewName}" not registered; have: ${booted.registrations.map((r) => r.entry.name).join(', ')}`)
  return registration.Component
}

/** Wrap a serialized component tree in a standalone page. */
function pageHtml(inner, { width, height, background, dark }) {
  const themeVars = dark
    ? '--dsw-alias-bg-layer-1:#1b1c20;--dsw-alias-label-primary:#f2f3f5;--dsw-alias-label-secondary:#a9abb3;--dsw-alias-border-l1:rgba(255,255,255,.14);--dsw-alias-state-idle-primary:#8b8e98;'
    : '--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-label-primary:#1a1a1e;--dsw-alias-label-secondary:#5b5d66;--dsw-alias-border-l1:rgba(24,24,28,.14);--dsw-alias-state-idle-primary:#8e9099;'
  const bg = dark ? '#0f1013' : background
  return `<!doctype html><html lang="zh-CN" data-dn-preview><head><meta charset="utf-8">
<style>
  html,body{margin:0}
  body{width:${width}px;height:${height}px;background:${bg};padding:24px;box-sizing:border-box;
       font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;--dn-preview:1;${themeVars}}
  /* keep fixed-position plugin chrome visually centered inside the capture box */
  #dn-stage{position:relative;width:100%;height:100%}
  #dn-stage .dsh-nudge-card,#dn-stage .dsh-nudge-pill,#dn-stage .dsh-nudge-popup,#dn-stage .dsh-nudge-settings{
    position:relative !important;left:auto !important;top:auto !important;transform:none !important;margin:0 auto;
  }
  /* neutralize entry animations so a single screenshot is the settled frame */
  *{animation:none !important;transition:none !important}
</style></head>
<body><div id="dn-stage">${inner}</div></body></html>`
}

/** Launch one headless browser to screenshot an HTML file to a PNG. */
function screenshot(browser, htmlPath, pngPath, width, height) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${width + 48},${height + 48}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ]
    const child = spawn(browser, args, { stdio: 'ignore' })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else reject(new Error(`browser exited ${code}`))
    })
  })
}

async function renderScene(name, { dark }) {
  const scene = SCENES[name]
  if (!scene) throw new Error(`unknown scene "${name}"`)
  const booted = await boot({})
  const { view, width, height } = await scene.drive(booted)
  const Component = findView(booted, view)
  const tree = Component()
  const inner = renderToHtml(tree) || '<p style="color:#999">（此场景无可见内容）</p>'
  const html = pageHtml(inner, { width, height, background: scene.bg, dark })

  const suffix = dark ? '-dark' : ''
  const htmlPath = join(OUT_DIR, `${name}${suffix}.html`)
  const pngPath = join(OUT_DIR, `${name}${suffix}.png`)
  await writeFile(htmlPath, html, 'utf8')
  await screenshot(BROWSER, htmlPath, pngPath, width, height)
  return { name, pngPath, htmlPath }
}

// --- main ---------------------------------------------------------------

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const named = argv.filter((a) => !a.startsWith('--'))

if (flags.has('--list')) {
  console.log('scenes:', Object.keys(SCENES).join(', '))
  process.exit(0)
}

const BROWSER = BROWSER_CANDIDATES.find(Boolean)
if (!BROWSER) {
  console.error('No browser found. Set PREVIEW_BROWSER to a Chrome/Chromium/Brave binary.')
  process.exit(2)
}

await mkdir(OUT_DIR, { recursive: true })

const wanted = flags.has('--all') ? Object.keys(SCENES) : named.length ? named : ['card-idle']
const darks = flags.has('--all') || flags.has('--dark') ? [false, true] : [flags.has('--dark') ? true : false]

let failed = 0
for (const name of wanted) {
  if (!SCENES[name]) {
    console.error(`unknown scene "${name}" (try --list)`)
    failed += 1
    continue
  }
  for (const dark of darks) {
    try {
      const { pngPath } = await renderScene(name, { dark })
      console.log(`✓ ${name}${dark ? ' (dark)' : ''} -> ${pngPath}`)
    } catch (error) {
      failed += 1
      console.error(`✗ ${name}${dark ? ' (dark)' : ''}: ${error.message}`)
    }
  }
}
process.exit(failed === 0 ? 0 : 1)
