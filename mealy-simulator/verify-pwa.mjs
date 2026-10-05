import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildVersion, precacheList, renderServiceWorker } from './pwa-build.mjs'

/**
 * PWA acceptance test.
 *
 * Serves the real production build over http://localhost (a secure context, so
 * service workers are allowed), drives a real headless browser over CDP, and
 * asserts: manifest validity, icon delivery, service-worker activation, the
 * precache contents, offline cold start, offline feature use, localStorage
 * survival, the install affordance, and the full update cycle.
 *
 * Needs: npm run build, plus Microsoft Edge on Windows.
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 4173
const CDP_PORT = 9334
const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PROFILE = 'C:\\Users\\Juner\\AppData\\Local\\Temp\\opencode\\edge-profile-pwa'
const APP = `http://localhost:${PORT}/`

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing — run `npm run build` first.')
  process.exit(1)
}

/* ---------------- static server ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

// GitHub Pages serves everything with a 10 minute cache. Reproducing that here
// proves the worker still updates promptly, because the registration opts out
// of the HTTP cache for the worker script itself.
const server = createServer((req, res) => {
  const url = new URL(req.url, APP)
  let path = decodeURIComponent(url.pathname)
  if (path === '/' || path.endsWith('/')) path += 'index.html'
  const file = join(DIST, path)
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=600',
  })
  res.end(readFileSync(file))
})
await new Promise((done) => server.listen(PORT, done))

/* ---------------- browser ---------------- */

rmSync(PROFILE, { recursive: true, force: true })

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--window-size=1600,1150',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let nextId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

function send(method, params = {}, sessionId) {
  const id = ++nextId
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`${method} timed out`))
      }
    }, 30000)
  })
}

async function connect() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const page = (await res.json()).find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Edge did not expose a debugging target')
}

ws = new WebSocket(await connect())
await new Promise((done, fail) => {
  ws.onopen = done
  ws.onerror = fail
})

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '?').join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    exceptions.push(d.exception?.description ?? d.text)
  }
}

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

async function goto(url) {
  await send('Page.navigate', { url })
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`return document.querySelectorAll('.card').length >= 5`)
    if (ready) return
    await sleep(150)
  }
  throw new Error(`App never rendered at ${url}`)
}

async function setOffline(offline) {
  await send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
  })
}

const report = []
let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures += 1
  report.push(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const section = (title) => console.log(`\n${title}`)

await goto(APP)

// Recorded before anything else so the install assertions are not racing the
// browser's own installability heuristics.
await evaluate(`
  window.__pwaProbe = {
    buttonAtBoot: document.querySelectorAll('.install button').length,
    beforeInstallPrompt: 0,
    appInstalled: 0,
  }
  window.addEventListener('beforeinstallprompt', () => { window.__pwaProbe.beforeInstallPrompt += 1 }, true)
  window.addEventListener('appinstalled', () => { window.__pwaProbe.appInstalled += 1 }, true)
  return 1
`)

/* ---------------- 1. manifest ---------------- */

section('manifest')
const link = await evaluate(`
  const el = document.querySelector('link[rel="manifest"]')
  const res = el ? await fetch(el.href) : null
  return { href: el?.getAttribute('href'), ok: res?.ok, type: res?.headers.get('content-type'), body: res ? await res.json() : null }
`)
check('index.html links a manifest', Boolean(link.href), link.href ?? 'missing')
check('manifest link is relative (works under a project path)', link.href === './manifest.webmanifest', link.href)
check('manifest served as application/manifest+json', /manifest\+json/.test(link.type ?? ''), link.type)
const m = link.body ?? {}
check('app name set', m.name === 'Mealy Machine Studio — FSM builder & simulator', m.name)
check('short name set and short', Boolean(m.short_name) && m.short_name.length <= 12, m.short_name)
check('display mode is standalone', m.display === 'standalone', m.display)
check('theme colour set', /^#[0-9a-f]{6}$/i.test(m.theme_color ?? ''), m.theme_color)
check('background colour set', /^#[0-9a-f]{6}$/i.test(m.background_color ?? ''), m.background_color)
check('start_url and scope are relative', m.start_url === './' && m.scope === './', `${m.start_url} / ${m.scope}`)
check('id pins the app identity', m.id === './', m.id)
check('orientation left free for tablet and phone', m.orientation === 'any', m.orientation)

const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose ?? 'any'}`)
check('192x192 icon declared', sizes.includes('192x192:any'), sizes.join(' '))
check('512x512 icon declared', sizes.includes('512x512:any'), sizes.join(' '))
check('maskable icon declared', sizes.includes('512x512:maskable'), sizes.join(' '))

const icons = await evaluate(`
  const out = []
  for (const icon of ${JSON.stringify(m.icons ?? [])}) {
    const res = await fetch(icon.src)
    const buf = new Uint8Array(await res.arrayBuffer())
    out.push({ src: icon.src, ok: res.ok, type: res.headers.get('content-type'), png: [...buf.slice(0, 8)].join(',') === '137,80,78,71,13,10,26,10', bytes: buf.length })
  }
  return out
`)
for (const icon of icons) {
  check(`icon ${icon.src} served as a valid PNG`, icon.ok && icon.png && icon.type === 'image/png', `${icon.bytes}b ${icon.type}`)
}

const iosMeta = await evaluate(`
  const meta = (n) => document.querySelector('meta[name="' + n + '"]')?.content ?? ''
  return {
    appleIcon: Boolean(document.querySelector('link[rel="apple-touch-icon"]')),
    capable: meta('apple-mobile-web-app-capable'),
    title: meta('apple-mobile-web-app-title'),
    bar: meta('apple-mobile-web-app-status-bar-style'),
  }
`)
check('apple-touch-icon present for iOS home screen', iosMeta.appleIcon)
check('iOS standalone meta present', iosMeta.capable === 'yes' && iosMeta.title === 'Mealy Studio', `${iosMeta.capable} / ${iosMeta.title}`)

/* ---------------- 2. service worker ---------------- */

section('service worker')
const sw = await evaluate(`
  const reg = await navigator.serviceWorker.ready
  for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
  const names = await caches.keys()
  const cache = await caches.open(names[0])
  const keys = (await cache.keys()).map((r) => new URL(r.url).pathname)
  const version = await new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (e) => resolve(e.data.version)
    reg.active.postMessage({ type: 'GET_VERSION' }, [channel.port2])
    setTimeout(() => resolve(''), 2000)
  })
  return {
    state: reg.active?.state,
    scope: reg.scope,
    controlled: Boolean(navigator.serviceWorker.controller),
    cacheNames: names,
    keys: keys.sort(),
    version,
    secure: window.isSecureContext,
  }
`)
check('page is a secure context', sw.secure)
check('worker registered at the app scope', sw.scope.endsWith('/'), sw.scope)
check('worker activated', sw.state === 'activated', sw.state)
check('worker controls the page without a reload', sw.controlled)
check('exactly one cache, named for the build', sw.cacheNames.length === 1 && sw.cacheNames[0] === `mealy-studio-${sw.version}`, sw.cacheNames.join(','))
check('worker reports its build version', /^[0-9a-f]{12}$/.test(sw.version), sw.version)
check('app shell precached', sw.keys.includes('/index.html'), sw.keys.join(' '))
check('hashed JS bundle precached', sw.keys.some((k) => /^\/assets\/index-.*\.js$/.test(k)), sw.keys.join(' '))
check('hashed CSS bundle precached', sw.keys.some((k) => /^\/assets\/index-.*\.css$/.test(k)), sw.keys.join(' '))
check('manifest precached', sw.keys.includes('/manifest.webmanifest'), sw.keys.join(' '))
check('all three install icons precached', ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'].every((k) => sw.keys.includes(k)), sw.keys.join(' '))

section('cache safety')
const safety = await evaluate(`
  const names = await caches.keys()
  const entries = []
  for (const name of names) {
    const cache = await caches.open(name)
    for (const request of await cache.keys()) entries.push({ url: request.url, method: request.method })
  }
  return {
    entries,
    foreign: entries.filter((e) => !e.url.startsWith(location.origin)),
    nonGet: entries.filter((e) => e.method !== 'GET'),
    leaks: entries.filter((e) => /localStorage|token|auth|session|mealy-simulator:v1/.test(e.url)),
    dataUrl: entries.filter((e) => e.url.startsWith('data:') || e.url.startsWith('blob:')),
  }
`)
check('no cross-origin response cached', safety.foreign.length === 0, safety.foreign.map((e) => e.url).join(' '))
check('no non-GET request cached', safety.nonGet.length === 0, safety.nonGet.length)
check('no data:/blob: entry cached', safety.dataUrl.length === 0, safety.dataUrl.length)
check('nothing sensitive cached', safety.leaks.length === 0, safety.leaks.map((e) => e.url).join(' '))

/* ---------------- 3. install affordance ---------------- */

section('install affordance')
const install = await evaluate(`
  // Chrome and Edge only fire beforeinstallprompt once the app really is
  // installable, so waiting for the button is an installability test too.
  for (let i = 0; i < 150; i++) {
    if (document.querySelector('.install button')) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const button = document.querySelector('.install button')
  return {
    boot: window.__pwaProbe.buttonAtBoot,
    prompted: window.__pwaProbe.beforeInstallPrompt,
    shown: document.querySelectorAll('.install button').length,
    label: button?.textContent.trim(),
    aria: button?.getAttribute('aria-label'),
    inHeader: Boolean(button?.closest('.app-header')),
  }
`)
check('browser considers the app installable', install.prompted >= 1, `${install.prompted} beforeinstallprompt event(s)`)
check('no install button before the browser offers one', install.boot === 0, `${install.boot} at boot`)
check('install button appears in the header', install.shown === 1 && install.inHeader, `${install.shown} shown`)
check('install button is labelled for everyone', /install/i.test(install.label ?? '') && /install/i.test(install.aria ?? ''), `${install.label} / ${install.aria}`)

const retired = await evaluate(`
  // The native dialog itself needs a real user gesture, so the post-install
  // path is what we assert here.
  window.dispatchEvent(new Event('appinstalled'))
  await new Promise((r) => setTimeout(r, 250))
  return { seen: window.__pwaProbe.appInstalled, left: document.querySelectorAll('.install button').length }
`)
check('button retires once the app is installed', retired.seen === 1 && retired.left === 0, JSON.stringify(retired))


/* ---------------- 4. offline ---------------- */

section('offline')
const saved = await evaluate(`
  // Make this machine unmistakably ours, then let the debounced save land.
  const addInput = document.querySelector('.input-group .input.mono')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(addInput, 'OFFLINE_Q')
  addInput.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 80))
  addInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 900))
  return { states: document.querySelectorAll('.state-row').length, stored: localStorage.getItem('mealy-simulator:v1') }
`)
check('machine saved to localStorage before going offline', saved.stored?.includes('OFFLINE_Q'), `${saved.states} states`)

await setOffline(true)
await goto(APP)

const offline = await evaluate(`
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const cards = document.querySelectorAll('.card').length
  const controller = Boolean(navigator.serviceWorker.controller)
  const stored = localStorage.getItem('mealy-simulator:v1')
  setValue(document.querySelector('#input-string'), '101')
  await new Promise((r) => setTimeout(r, 60))
  document.querySelector('.btn-success').click()
  await new Promise((r) => setTimeout(r, 200))
  const rows = document.querySelectorAll('.table tbody tr').length
  const output = [...document.querySelectorAll('.output-cell')].map((c) => c.textContent.trim()).join('')
  const nodes = document.querySelectorAll('.node').length
  const theme = document.querySelector('.app')?.dataset.theme
  const css = getComputedStyle(document.querySelector('.card')).borderRadius
  const chip = /offline/i.test(document.body.innerText)
  return { cards, controller, restored: stored?.includes('OFFLINE_Q'), rows, output, nodes, theme, css, chip, stylesheets: document.styleSheets.length, online: navigator.onLine }
`)
check('app cold-starts with no network', offline.cards === 6, `${offline.cards} cards`)
check('served by the service worker', offline.controller)
check('existing local data intact offline', offline.restored)
check('stylesheets applied offline', offline.css !== '0px' && offline.stylesheets > 0, `${offline.stylesheets} sheets, radius ${offline.css}`)
check('simulation runs offline', offline.rows === 3 && offline.output === '001', `${offline.rows} rows, out ${offline.output}`)
check('diagram still renders offline', offline.nodes > 0, `${offline.nodes} nodes`)
check('offline chip shown while disconnected', offline.chip)
check('navigator reports offline', offline.online === false)

await setOffline(false)
const back = await evaluate(`
  await new Promise((r) => setTimeout(r, 600))
  return { online: navigator.onLine, stored: localStorage.getItem('mealy-simulator:v1') }
`)
check('reconnects without touching local data', back.online && back.stored?.includes('OFFLINE_Q'))

/* ---------------- 5. update cycle ---------------- */

section('update cycle')
const template = readFileSync(join(ROOT, 'src/sw-template.js'), 'utf8')
const htmlPath = join(DIST, 'index.html')
const originalHtml = readFileSync(htmlPath, 'utf8')

const firstVersion = buildVersion(DIST)
writeFileSync(htmlPath, originalHtml.replace('</body>', '<!-- next build --></body>'))
const secondVersion = buildVersion(DIST)
check('any asset change yields a new build version', firstVersion !== secondVersion, `${firstVersion} -> ${secondVersion}`)
check('precache list is exactly the deployed files', precacheList(DIST).length === 10, precacheList(DIST).join(' '))
check('unchanged inputs are reproducible', buildVersion(DIST) === secondVersion)

writeFileSync(
  join(DIST, 'sw.js'),
  renderServiceWorker(template, secondVersion, precacheList(DIST)),
)

const updated = await evaluate(`
  const reg = await navigator.serviceWorker.getRegistration()
  await reg.update()
  for (let i = 0; i < 100; i++) {
    if (document.querySelector('.update-bar')) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const bar = document.querySelector('.update-bar')
  const text = bar?.textContent.replace(/\\s+/g, ' ').trim() ?? ''
  const waiting = Boolean(reg.waiting)
  bar?.querySelector('.btn-primary')?.click()
  return { waiting, text }
`)
check('new build detected while the old one keeps serving', updated.waiting)
check('update banner offers a reload', /new version/i.test(updated.text), updated.text)

const reloaded = await (async () => {
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate(`
      const reg = await navigator.serviceWorker.getRegistration()
      return document.querySelectorAll('.card').length === 6 && !reg.waiting
        ? reg.active ? 1 : 0 : 0
    `)
    if (ready) return true
    await sleep(150)
  }
  return false
})()
check('reload lands on the new build', reloaded)

const after = await evaluate(`
  const reg = await navigator.serviceWorker.getRegistration()
  const names = await caches.keys()
  const version = await new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (e) => resolve(e.data.version)
    reg.active.postMessage({ type: 'GET_VERSION' }, [channel.port2])
    setTimeout(() => resolve(''), 2000)
  })
  return {
    version,
    caches: names,
    stored: localStorage.getItem('mealy-simulator:v1'),
    states: document.querySelectorAll('.state-row').length,
    bar: document.querySelectorAll('.update-bar').length,
  }
`)
check('running the new build', after.version === secondVersion, `${after.version} vs ${secondVersion}`)
check('stale cache deleted, only the new one left', after.caches.length === 1 && after.caches[0] === `mealy-studio-${secondVersion}`, after.caches.join(','))
check('local data survived the update', after.stored?.includes('OFFLINE_Q'))
check('machine still loaded after the update', after.states === 4, `${after.states} states`)
check('update banner gone', after.bar === 0)

const sticky = await evaluate(`
  const reg = await navigator.serviceWorker.getRegistration()
  return { installed: reg.active?.state, controlled: Boolean(navigator.serviceWorker.controller) }
`)
check('worker still installed and in control at the end', sticky.installed === 'activated' && sticky.controlled, JSON.stringify(sticky))

writeFileSync(htmlPath, originalHtml)
writeFileSync(
  join(DIST, 'sw.js'),
  renderServiceWorker(template, firstVersion, precacheList(DIST)),
)

section('iOS install path')
// Safari never fires beforeinstallprompt, but headless Chrome still does even
// with an iPhone user agent. Swallow it on this page only, so the assertion
// covers the Add to Home Screen branch and nothing else.
const blocker = await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.addEventListener('beforeinstallprompt', (event) => event.stopImmediatePropagation(), true)`,
})
await send('Emulation.setUserAgentOverride', {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
})
await goto(APP)
const ios = await evaluate(`
  const button = [...document.querySelectorAll('.install button')].find((b) => /install/i.test(b.getAttribute('aria-label') ?? ''))
  button?.click()
  await new Promise((r) => setTimeout(r, 300))
  const sheet = document.querySelector('.install-sheet')
  return {
    shown: Boolean(button),
    sheet: Boolean(sheet),
    role: sheet?.getAttribute('role'),
    text: sheet?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    steps: sheet?.querySelectorAll('li').length ?? 0,
  }
`)
check('iPhone is offered the install option', ios.shown)
check('iPhone gets Add to Home Screen instructions', /add to home screen/i.test(ios.text), ios.text.slice(0, 90))
check('instruction sheet is a labelled dialog with steps', ios.role === 'dialog' && ios.steps >= 3, `${ios.steps} steps`)

// An empty user agent restores the browser default.
await send('Emulation.setUserAgentOverride', { userAgent: '' })
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocker.identifier })
await goto(APP)

section('console health')
check('no runtime exceptions', exceptions.length === 0, exceptions.join(' | '))
check(
  'no console errors',
  consoleErrors.filter((e) => !/Failed to load resource/.test(e)).length === 0,
  consoleErrors.join(' | '),
)

section('installed app: standalone, offline, still working')
// The browser's own installability audit, when this build of Edge exposes it.
const installability = await (async () => {
  try {
    const { installabilityErrors } = await send('Page.getInstallabilityErrors')
    return installabilityErrors.map((e) => e.errorId)
  } catch {
    return null
  }
})()
if (installability) {
  check('browser reports no installability errors', installability.length === 0, installability.join(', '))
}

ws.close()
edge.kill()
await sleep(1000)

// A real app-mode window on a clean profile: no tab bar, no address bar. Seed
// it online first, then cut the network — an installed app opened offline.
const APP_PROFILE = `${PROFILE}-app`
rmSync(APP_PROFILE, { recursive: true, force: true })
const appEdge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,900',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${APP_PROFILE}`,
    `--app=${APP}`,
  ],
  { stdio: 'ignore' },
)
let appWs
const appPending = new Map()
let appId = 0
const appSend = (method, params = {}) => {
  const id = ++appId
  appWs.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    appPending.set(id, { res, rej })
    setTimeout(
      () => appPending.has(id) && (appPending.delete(id), rej(new Error(`${method} timeout`))),
      20000,
    )
  })
}
const appEvaluate = async (expression) => {
  const { result, exceptionDetails } = await appSend('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}
let appUrl
for (let i = 0; i < 60; i += 1) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(
      (t) => t.type === 'page',
    )
    if (page?.webSocketDebuggerUrl) {
      appUrl = page.webSocketDebuggerUrl
      break
    }
  } catch {}
  await sleep(250)
}
appWs = new WebSocket(appUrl)
await new Promise((done, fail) => {
  appWs.onopen = done
  appWs.onerror = fail
})
appWs.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && appPending.has(msg.id)) {
    const { res, rej } = appPending.get(msg.id)
    appPending.delete(msg.id)
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
  }
}
await appSend('Runtime.enable')
await appSend('Page.enable')
await appSend('Network.enable')

async function appGoto() {
  await appSend('Page.navigate', { url: APP })
  for (let i = 0; i < 100; i += 1) {
    const ready = await appSend('Runtime.evaluate', {
      expression: `document.querySelectorAll('.card').length >= 5`,
      returnByValue: true,
    })
    if (ready.result.value) return
    await sleep(150)
  }
  throw new Error('app-mode window never rendered')
}

await appGoto()
const seeded = await appEvaluate(`
  const reg = await navigator.serviceWorker.ready
  for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100))
  const addInput = document.querySelector('.input-group .input.mono')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(addInput, 'APP_Q')
  addInput.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 80))
  addInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 900))
  return {
    standalone: matchMedia('(display-mode: standalone)').matches,
    browserMode: matchMedia('(display-mode: browser)').matches,
    installButtons: document.querySelectorAll('.install button').length,
    controlled: Boolean(navigator.serviceWorker.controller),
    states: document.querySelectorAll('.state-row').length,
    worker: reg.active?.state,
  }
`)
check('app-mode window reports standalone display', seeded.standalone && !seeded.browserMode, `standalone=${seeded.standalone}`)
check('install affordance hidden once installed', seeded.installButtons === 0, `${seeded.installButtons} shown`)
check('app-mode window activates the worker', seeded.worker === 'activated' && seeded.controlled, JSON.stringify(seeded))

// Now pull the plug and reopen the installed app.
await appSend('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
})
await appGoto()
const appWindow = await appEvaluate(`
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setValue(document.querySelector('#input-string'), '101')
  await new Promise((r) => setTimeout(r, 60))
  document.querySelector('.btn-success').click()
  await new Promise((r) => setTimeout(r, 200))
  return {
    cards: document.querySelectorAll('.card').length,
    states: document.querySelectorAll('.state-row').length,
    stored: (localStorage.getItem('mealy-simulator:v1') || '').includes('APP_Q'),
    controlled: Boolean(navigator.serviceWorker.controller),
    installButtons: document.querySelectorAll('.install button').length,
    rows: document.querySelectorAll('.table tbody tr').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
`)
check('installed app cold-starts offline', appWindow.cards === 6, `${appWindow.cards} cards`)
check('installed app served by the worker offline', appWindow.controlled)
check('installed app kept the saved machine', appWindow.stored && appWindow.states === 4, `${appWindow.states} states`)
check('installed app still simulates offline', appWindow.rows === 3, `${appWindow.rows} rows`)
check('no install button in the offline installed app', appWindow.installButtons === 0, `${appWindow.installButtons} shown`)
check('installed app has no horizontal overflow', appWindow.overflowX <= 0, `${appWindow.overflowX}px`)

appWs.close()
appEdge.kill()

console.log(report.join('\n'))
console.log(`\n${report.length - failures} passed, ${failures} failed\n`)

server.close()
process.exit(failures ? 1 : 0)
