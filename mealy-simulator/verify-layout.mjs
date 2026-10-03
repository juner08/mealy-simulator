import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { rmSync, writeFileSync } from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334
const APP = process.env.APP_URL ?? 'http://localhost:4173'
const PROFILE = 'C:\\Users\\Juner\\AppData\\Local\\Temp\\opencode\\edge-profile-2'
const SHOTS = 'C:\\Users\\Juner\\AppData\\Local\\Temp\\opencode'

rmSync(PROFILE, { recursive: true, force: true })

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--disable-extensions',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

let ws
let nextId = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++nextId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`${method} timeout`))), 30000)
  })
}

async function connect() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('no debugging target')
}

ws = new WebSocket(await connect())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  }
}

await send('Runtime.enable')
await send('Page.enable')

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 700,
  })
}

async function load() {
  await send('Page.navigate', { url: APP })
  for (let i = 0; i < 80; i += 1) {
    const n = await evaluate(`return document.querySelectorAll('.card').length`)
    if (n >= 6) return
    await sleep(150)
  }
  throw new Error('never rendered')
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(`${SHOTS}\\${name}.png`, Buffer.from(data, 'base64'))
}

const report = []
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  report.push(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('\nresponsive layout')
for (const [w, h, label] of [
  [1600, 1100, 'desktop'],
  [1280, 900, 'laptop'],
  [900, 1000, 'tablet'],
  [430, 900, 'phone'],
]) {
  await viewport(w, h)
  await load()
  const layout = await evaluate(`
    const doc = document.documentElement
    const header = document.querySelector('.app-header').getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const workspace = document.querySelector('.workspace').getBoundingClientRect()
    const stage = document.querySelector('.stage').getBoundingClientRect()
    const offenders = [...document.querySelectorAll('.card, .btn, .badge, .state-row, .rule')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .map((el) => el.className.split(' ')[0])
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      headerStuck: getComputedStyle(document.querySelector('.app-header')).position,
      sidebarLeft: Math.round(sidebar.left),
      workspaceLeft: Math.round(workspace.left),
      stacked: workspace.left > sidebar.left + sidebar.width - 5,
      stageW: Math.round(stage.width),
      stageH: Math.round(stage.height),
      offenders: [...new Set(offenders)],
      headerH: Math.round(header.height),
    }
  `)
  check(`${label} ${w}px: no horizontal scroll`, layout.overflowX <= 0, `${layout.overflowX}px overflow`)
  check(`${label} ${w}px: nothing clipped on the right`, layout.offenders.length === 0, layout.offenders.join(','))
  check(`${label} ${w}px: header sticks to the top`, layout.headerStuck === 'sticky')
  check(`${label} ${w}px: diagram has a usable size`, layout.stageW > 260 && layout.stageH > 200, `${layout.stageW}x${layout.stageH}`)
  if (w <= 900) {
    check(`${label} ${w}px: panels stack instead of squeezing`, layout.stacked, `${layout.sidebarLeft} / ${layout.workspaceLeft}`)
  } else {
    check(`${label} ${w}px: sidebar sits beside the workspace`, !layout.stacked)
  }
  await shot(`mealy-${label}`)
}

console.log('\ntheme rendering')
await viewport(1500, 1000)
await load()
const themes = await evaluate(`
  const read = () => {
    const card = getComputedStyle(document.querySelector('.card'))
    const body = getComputedStyle(document.querySelector('.app'))
    const label = getComputedStyle(document.querySelector('.state-label'))
    const lum = (c) => {
      const [r, g, b] = c.match(/[\\d.]+/g).map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    return {
      theme: document.querySelector('.app').dataset.theme,
      cardBg: card.backgroundColor,
      bodyBg: body.backgroundColor,
      textColor: label.color,
      cardLum: lum(card.backgroundColor),
      textLum: lum(label.color),
    }
  }
  const light = read()
  document.querySelector('.btn-icon').click()
  await new Promise((r) => setTimeout(r, 250))
  const dark = read()
  return { light, dark }
`)
check('light theme is genuinely light', themes.light.cardLum > 200, themes.light.cardBg)
check('dark theme is genuinely dark', themes.dark.cardLum < 60, themes.dark.cardBg)
check('light theme has dark text', themes.light.textLum < 90, themes.light.textColor)
check('dark theme has light text', themes.dark.textLum > 140, themes.dark.textColor)
check('themes differ', themes.light.theme === 'light' && themes.dark.theme === 'dark')

console.log('\nproduction bundle')
const prod = await evaluate(`
  return {
    moduleScripts: [...document.querySelectorAll('script[type="module"]')].map((s) => s.src),
    hasViteClient: Boolean(document.querySelector('vite-plugin') || window.__vite_plugin_react_preamble__),
    css: [...document.querySelectorAll('link[rel="stylesheet"]')].length,
    inlineStyles: document.querySelectorAll('style').length,
  }
`)
check('no HMR client injected in the build', !prod.hasViteClient)
check('bundled JS is a hashed asset', prod.moduleScripts.every((s) => /\/assets\/.*\\.js$/.test(s)), prod.moduleScripts.join())
check('scoped component CSS was extracted', prod.css >= 1)

console.log(report.join('\n'))
console.log(`\n${report.length - failures} passed, ${failures} failed\n`)

ws.close()
edge.kill()
process.exit(failures ? 1 : 0)
