import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { rmSync } from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const PROFILE = 'C:\\Users\\Juner\\AppData\\Local\\Temp\\opencode\\edge-profile'
const SHOTS = 'C:\\Users\\Juner\\AppData\\Local\\Temp\\opencode'

rmSync(PROFILE, { recursive: true, force: true })

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-device-scale-factor=1',
  '--window-size=1600,1150',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

let ws
let nextId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

function send(method, params = {}, sessionId) {
  const id = ++nextId
  const frame = { id, method, params }
  if (sessionId) frame.sessionId = sessionId
  ws.send(JSON.stringify(frame))
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Edge did not expose a debugging target')
}

const url = await connect()
ws = new WebSocket(url)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
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

async function goto(url_) {
  await send('Page.navigate', { url: url_ })
  for (let i = 0; i < 80; i += 1) {
    const { result } = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('.card').length`,
      returnByValue: true,
    })
    if (result.value >= 5) return
    await sleep(150)
  }
  throw new Error('App never rendered its cards')
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  }
  return result.value
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(`${SHOTS}\\${name}.png`, Buffer.from(data, 'base64'))
}

/* ------------------------------------------------------------------ */

const report = []
let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures += 1
  report.push(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

// Start from a clean slate so the machine is deterministic.
await goto(APP)
await evaluate(`
  localStorage.clear();
  return 1
`)
await goto(APP)

console.log('\nrender')
const boot = await evaluate(`
  const q = (s) => document.querySelectorAll(s)
  return {
    cards: q('.card').length,
    states: q('.state-row').length,
    transitions: q('.rule').length,
    svgNodes: q('.node').length,
    svgEdges: q('.edge').length,
    svgLabels: q('.edge-label').length,
    entryStub: q('.entry-line').length,
    graphNodes: [...q('.node .label')].map((n) => n.textContent.trim()),
    theme: document.querySelector('.app')?.dataset.theme,
    hasHeader: Boolean(document.querySelector('.brand-title')),
    title: document.title,
  }
`)
check('six panels rendered', boot.cards === 6, `found ${boot.cards}`)
check('example preset loaded with 3 states', boot.states === 3, `found ${boot.states}`)
check('preset loaded 6 transitions', boot.transitions === 6, `found ${boot.transitions}`)
check('one SVG node per state', boot.svgNodes === 3, `found ${boot.svgNodes}`)
check('one SVG edge per transition', boot.svgEdges === 6, `found ${boot.svgEdges}`)
check('every edge carries an input/output label', boot.svgLabels === 6, `found ${boot.svgLabels}`)
check('initial-state entry stub drawn', boot.entryStub === 1)
check('state names rendered', boot.graphNodes.join() === 'q0,q1,q2', boot.graphNodes.join())
check('title updated', /Mealy Machine Studio/.test(boot.title), boot.title)
check('theme resolved', boot.theme === 'dark' || boot.theme === 'light', boot.theme)

console.log('\ndiagram geometry in screen space')
const geom = await evaluate(`
  const svg = document.querySelector('.canvas')
  const box = svg.getBoundingClientRect()
  const circles = [...svg.querySelectorAll('.node .body')]
  const rects = circles.map((c) => {
    const r = c.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, rad: r.width / 2, name: c.parentNode.querySelector('.label').textContent.trim() }
  })
  const overlaps = []
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const d = Math.hypot(rects[i].x - rects[j].x, rects[i].y - rects[j].y)
      if (d < rects[i].rad + rects[j].rad - 2) overlaps.push(rects[i].name + '/' + rects[j].name)
    }
  const outOfFrame = rects.filter((r) => r.x < box.x || r.y < box.y || r.x > box.right || r.y > box.bottom).map((r) => r.name)
  const labels = [...svg.querySelectorAll('.edge-label')].map((t) => {
    const r = t.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
  })
  const labelCollisions = []
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const dx = Math.abs(labels[i].x - labels[j].x)
      const dy = Math.abs(labels[i].y - labels[j].y)
      if (dx < (labels[i].w + labels[j].w) / 2 && dy < (labels[i].h + labels[j].h) / 2) labelCollisions.push(i + '-' + j)
    }
  return {
    overlaps, outOfFrame, labelCollisions,
    labelTexts: [...svg.querySelectorAll('.edge-label')].map((t) => t.textContent.trim()),
    nodeCount: rects.length,
    stageHeight: Math.round(box.height),
    stageWidth: Math.round(box.width),
  }
`)
check('no overlapping state circles', geom.overlaps.length === 0, geom.overlaps.join(','))
check('all states inside the stage', geom.outOfFrame.length === 0, geom.outOfFrame.join(','))
check('no edge-label collisions', geom.labelCollisions.length === 0, geom.labelCollisions.join(','))
check('labels read input/output', geom.labelTexts.every((t) => /^. \/ .$/.test(t)), geom.labelTexts.join(' '))
check('stage has a real height', geom.stageHeight > 300, `${geom.stageWidth}x${geom.stageHeight}`)

console.log('\nsimulation')
const sim = await evaluate(`
  const input = document.querySelector('#input-string')
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setValue(input, '10101')
  await new Promise((r) => setTimeout(r, 60))
  document.querySelector('.btn-success').click()
  await new Promise((r) => setTimeout(r, 120))
  const rows = [...document.querySelectorAll('.table tbody tr')]
  const activeNow = document.querySelector('.node.is-live .label')?.textContent.trim()
  const litEdge = document.querySelectorAll('.edge.is-active').length
  const verdict = document.querySelector('.verdict')?.textContent.replace(/\\s+/g, ' ').trim()
  const outputCells = [...document.querySelectorAll('.output-cell')].map((c) => c.textContent.trim()).join('')
  const traceOutputs = rows.map((r) => r.children[3].textContent.trim()).join('')
  return {
    rowCount: rows.length,
    firstRow: rows[0] ? [...rows[0].children].map((c) => c.textContent.trim()) : null,
    activeNow, litEdge, verdict, outputCells, traceOutputs,
    pendingRows: document.querySelectorAll('.table tbody tr.is-pending').length,
  }
`)
check('one trace row per symbol', sim.rowCount === 5, `found ${sim.rowCount}`)
check('trace row shape is correct', JSON.stringify(sim.firstRow) === JSON.stringify(['1','q0','1','0','q1']), JSON.stringify(sim.firstRow))
check('no rows left pending after Run', sim.pendingRows === 0, `${sim.pendingRows} pending`)
check('output string is 00101', sim.outputCells === '00101', sim.outputCells)
check('trace outputs agree with tape', sim.traceOutputs === '00101', sim.traceOutputs)
check('final state q1 highlighted on the diagram', sim.activeNow === 'q1', String(sim.activeNow))
check('exactly one transition lit', sim.litEdge === 1, `found ${sim.litEdge}`)
check('verdict shows the output string', /Output string.*00101/.test(sim.verdict ?? ''), sim.verdict)

console.log('\nstepping and playback')
const stepper = await evaluate(`
  const row = () => document.querySelector('.table tbody tr.is-active')
  document.querySelector('.table tbody tr').click()
  await new Promise((r) => setTimeout(r, 80))
  const atStart = { row: row()?.children[1].textContent.trim(), live: document.querySelector('.node.is-live .label')?.textContent.trim(), lit: document.querySelectorAll('.edge.is-active').length }
  const prev = [...document.querySelectorAll('.workspace .card')].find((c) => c.textContent.includes('Simulation')).querySelectorAll('.btn')
  const prevBtn = [...prev].find((b) => b.textContent.includes('Prev'))
  prevBtn.click()
  await new Promise((r) => setTimeout(r, 80))
  const afterPrev = { live: document.querySelector('.node.is-live .label')?.textContent.trim(), revealed: document.querySelectorAll('.output-cell.is-revealed').length }
  return { atStart, afterPrev }
`)
check('clicking row 1 seeks to that step', stepper.atStart.live === 'q1' && stepper.atStart.lit === 1 && stepper.atStart.row === 'q0', JSON.stringify(stepper.atStart))
check('Prev steps back and un-reveals output', stepper.afterPrev.live === 'q0' && stepper.afterPrev.revealed === 0, JSON.stringify(stepper.afterPrev))

const playback = await evaluate(`
  const sim = [...document.querySelectorAll('.workspace .card')].find((c) => c.textContent.includes('Simulation'))
  const play = [...sim.querySelectorAll('.btn')].find((b) => b.textContent.includes('Play'))
  play.click()
  await new Promise((r) => setTimeout(r, 250))
  const midway = document.querySelector('.node.is-live .label')?.textContent.trim()
  const pause = [...sim.querySelectorAll('.btn')].find((b) => b.textContent.includes('Pause'))
  pause.click()
  await new Promise((r) => setTimeout(r, 120))
  return { midway, paused: Boolean(pause), revealed: document.querySelectorAll('.output-cell.is-revealed').length }
`)
check('Play animates the machine', playback.midway !== undefined && playback.midway !== 'q1', `live=${playback.midway}`)
check('Pause stops it mid-run', playback.paused && playback.revealed < 5, `revealed ${playback.revealed}`)

console.log('\nediting the machine')
const editing = await evaluate(`
  const toastText = () => [...document.querySelectorAll('.alert')].map((a) => a.textContent.replace(/\\s+/g,' ').trim())
  const stateRows = [...document.querySelectorAll('.state-row')]
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const addInput = document.querySelector('.input-group .input.mono')
  setValue(addInput, 'q3')
  addInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 120))
  const afterAdd = {
    states: document.querySelectorAll('.state-row').length,
    circles: document.querySelectorAll('.node .body').length,
    toast: toastText().slice(-1)[0] ?? '',
  }
  // duplicate state must be refused
  setValue(addInput, 'q3')
  addInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 120))
  const dupToast = toastText().slice(-1)[0] ?? ''
  const dupCount = document.querySelectorAll('.state-row').length
  // non-deterministic transition must be refused
  const tInput = document.querySelector('#t-input')
  const tOutput = document.querySelector('#t-output')
  setValue(tInput, '0'); setValue(tOutput, '1')
  await new Promise((r) => setTimeout(r, 60))
  const before = document.querySelectorAll('.rule').length
  const addBtn = [...document.querySelectorAll('.btn-primary')].find((b) => b.textContent.includes('Add transition'))
  addBtn.click()
  await new Promise((r) => setTimeout(r, 120))
  return {
    afterAdd, dupToast, dupCount,
    nonDetToast: toastText().slice(-1)[0] ?? '',
    nonDetCount: document.querySelectorAll('.rule').length,
    before,
    notes: [...document.querySelectorAll('.note')].map((n) => n.className.replace('note ','') + ': ' + n.textContent.trim()),
  }
`)
check('add state creates a node too', editing.afterAdd.states === 4 && editing.afterAdd.circles === 4, JSON.stringify(editing.afterAdd))
check('duplicate state refused with a message', editing.dupCount === 4 && /already exists/.test(editing.dupToast), editing.dupToast)
check('non-deterministic delta refused', editing.nonDetCount === editing.before && /deterministic/.test(editing.nonDetToast), editing.nonDetToast)

console.log('\nundo, delete and halting')
const teardown = await evaluate(`
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // delete the state we just added
  const q3 = [...document.querySelectorAll('.state-row')].find((r) => r.textContent.includes('q3'))
  ;[...q3.querySelectorAll('.btn')].find((b) => b.textContent.includes('Delete')).click()
  await new Promise((r) => setTimeout(r, 150))
  const afterDelete = { states: document.querySelectorAll('.state-row').length, circles: document.querySelectorAll('.node .body').length }

  // reset back to a machine with a hole, then halt on it
  const input = document.querySelector('#input-string')
  setValue(input, '10z')
  await new Promise((r) => setTimeout(r, 60))
  document.querySelector('.btn-success').click()
  await new Promise((r) => setTimeout(r, 150))
const allRows = [...document.querySelectorAll('.table tbody tr')]
  const lastRow = allRows.length ? [...allRows[allRows.length - 1].children] : []
  const halted = {
    badge: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
    blockedRow: document.querySelectorAll('.table tbody tr.is-blocked').length,
    lastRow: lastRow.map((c) => c.textContent.trim()),
    redCell: Boolean(document.querySelector('code.danger')),
    verdict: document.querySelector('.verdict')?.className,
    toast: [...document.querySelectorAll('.alert-error')].map((a) => a.textContent.replace(/\\s+/g, ' ').trim()),
  }
  return { afterDelete, halted }
`)
check('delete removes both the row and the circle', teardown.afterDelete.states === 3 && teardown.afterDelete.circles === 3, JSON.stringify(teardown.afterDelete))
check('unknown symbol halts the run', teardown.halted.blockedRow === 1, `${teardown.halted.blockedRow} blocked rows`)
check('halted row shows undefined as the target', teardown.halted.lastRow?.[4] === 'undefined', JSON.stringify(teardown.halted.lastRow))
check('halted row styled as an error', teardown.halted.redCell)
check('verdict switches to the bad state', /is-bad/.test(teardown.halted.verdict ?? ''), teardown.halted.verdict)
check('halt explained in a toast', /Stuck at step 3/.test(teardown.halted.toast.join(' ')), teardown.halted.toast.join(' '))

console.log('\npresets, theme, export')
const extras = await evaluate(`
  // open the preset menu and load a different example
  document.querySelector('.presets .btn-primary').click()
  await new Promise((r) => setTimeout(r, 100))
  const items = [...document.querySelectorAll('.preset-item')]
  const opened = items.length
  items[3].click()
  await new Promise((r) => setTimeout(r, 150))
  const loaded = {
    states: document.querySelectorAll('.state-row').length,
    rules: document.querySelectorAll('.rule').length,
    coverage: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()).find((t) => /% complete/.test(t)),
    sample: document.querySelector('#input-string').value,
  }
  // theme toggle
  const before = document.querySelector('.app').dataset.theme
  document.querySelector('.btn-icon').click()
  await new Promise((r) => setTimeout(r, 100))
  const after = document.querySelector('.app').dataset.theme
  const bg = getComputedStyle(document.querySelector('.app')).backgroundColor
  return { opened, loaded, before, after, bg, json: document.body.innerText.includes('δ') }
`)
check('preset menu lists every example', extras.opened === 6, `found ${extras.opened}`)
check('loading the up/down counter gives 4 states + 12 rules', extras.loaded.states === 4 && extras.loaded.rules === 12, JSON.stringify(extras.loaded))
check('loaded preset is 100% complete', extras.loaded.coverage === '100% complete', extras.loaded.coverage)
check('preset brings its own sample input', extras.loaded.sample === 'uudnnd', extras.loaded.sample)
check('theme toggle flips the app dataset', extras.before !== extras.after, `${extras.before} -> ${extras.after}`)
check('page repaints with a new background', !!extras.bg, extras.bg)

const roundTrip = await evaluate(`
  await new Promise((r) => setTimeout(r, 700))
  const store = JSON.parse(localStorage.getItem('mealy-simulator:v1'))
  return {
    saved: Boolean(store),
    states: store?.states,
    rules: store?.transitions?.length,
    kind: store?.kind,
    sample: store?.sample,
  }
`)
check('machine persisted to localStorage', roundTrip.saved && roundTrip.kind === 'mealy-machine', JSON.stringify(roundTrip))
check('persisted payload matches the current machine', roundTrip.states?.length === 4 && roundTrip.rules === 12, JSON.stringify(roundTrip))

console.log('\nzoom and pan')
const camera = await evaluate(`
  const svg = document.querySelector('.canvas')
  const readout = () => document.querySelector('.zoom-readout').textContent.trim()
  const start = readout()
  const plus = [...document.querySelectorAll('.diagram-tools .btn')].find((b) => b.textContent.trim() === '+')
  plus.click(); plus.click()
  await new Promise((r) => setTimeout(r, 80))
  const zoomed = readout()
  const box = svg.getBoundingClientRect()
  const vb = () => svg.getAttribute('viewBox').split(' ').map(Number)
  const b1 = vb()
  const fire = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }))
  const move = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }))
  fire('pointerdown', box.x + box.width * 0.5, box.y + box.height * 0.5)
  move('pointermove', box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 60)
  move('pointerup', box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 60)
  await new Promise((r) => setTimeout(r, 80))
  const b2 = vb()
  const fit = [...document.querySelectorAll('.diagram-tools .btn')].find((b) => b.textContent.trim() === 'Fit')
  fit.click()
  await new Promise((r) => setTimeout(r, 80))
  const b3 = vb()
  return { start, zoomed, panned: [b2[0] !== b1[0] || b2[1] !== b1[1]], refit: [b3[0] !== b2[0] || b3[1] !== b2[1]] }
`)
check('zoom in raises the readout', camera.zoomed !== camera.start, `${camera.start} -> ${camera.zoomed}`)
check('dragging the canvas pans the viewBox', camera.panned[0])
check('Fit resets the viewBox', camera.refit[0])

const nodeDrag = await evaluate(`
  const svg = document.querySelector('.canvas')
  const node = svg.querySelector('.node')
  const c = node.querySelector('.body').getBoundingClientRect()
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  const before = node.getAttribute('transform')
  node.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, pointerId: 2 }))
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 90, clientY: cy + 40, bubbles: true, pointerId: 2 }))
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 90, clientY: cy + 40, bubbles: true, pointerId: 2 }))
  await new Promise((r) => setTimeout(r, 80))
  const moved = node.getAttribute('transform')
  // relayout must keep the pinned node where we dropped it
  ;[...document.querySelectorAll('.diagram-tools .btn')].find((b) => b.textContent.trim() === 'Relayout').click()
  await new Promise((r) => setTimeout(r, 150))
  return { before, moved, afterRelayout: node.getAttribute('transform') }
`)
check('dragging a state moves it', nodeDrag.before !== nodeDrag.moved, `${nodeDrag.before} -> ${nodeDrag.moved}`)
check('relayout returns to the automatic layout', nodeDrag.afterRelayout === nodeDrag.before, `${nodeDrag.moved} -> ${nodeDrag.afterRelayout}`)

console.log('\nlabels toggle and accessibility')
const a11y = await evaluate(`
  const labelsBtn = [...document.querySelectorAll('.diagram-tools .btn')].find((b) => b.textContent.trim() === 'Labels')
  const before = document.querySelectorAll('.edge-label').length
  labelsBtn.click()
  await new Promise((r) => setTimeout(r, 80))
  const after = document.querySelectorAll('.edge-label').length
  labelsBtn.click()
  await new Promise((r) => setTimeout(r, 80))
  const restored = document.querySelectorAll('.edge-label').length
  const captioned = Boolean(document.querySelector('.canvas[role="img"]'))
  const emptyButtons = [...document.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length
  const unlabelledInputs = [...document.querySelectorAll('input:not([aria-hidden]), select')].filter((i) => !i.getAttribute('aria-label') && !i.id && !i.labels?.length).length
  return { before, after, restored, captioned, emptyButtons, unlabelledInputs }
`)
check('labels toggle hides them', a11y.before > 0 && a11y.after === 0, `${a11y.before} -> ${a11y.after}`)
check('labels toggle restores them', a11y.restored === a11y.before)
check('diagram exposed as an image role', a11y.captioned)
check('no unlabelled buttons', a11y.emptyButtons === 0, `${a11y.emptyButtons} found`)
check('no unlabelled form fields', a11y.unlabelledInputs === 0, `${a11y.unlabelledInputs} found`)

await shot('mealy-final-dark')
await evaluate(`document.querySelector('.btn-icon').click(); await new Promise(r => setTimeout(r, 200)); return 1`)
await shot('mealy-final-light')

console.log('\nconsole health')
check('no runtime exceptions', exceptions.length === 0, exceptions.join(' | '))
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))

console.log(report.join('\n'))
console.log(`\n${report.length - failures} passed, ${failures} failed\n`)

ws.close()
edge.kill()
process.exit(failures ? 1 : 0)
