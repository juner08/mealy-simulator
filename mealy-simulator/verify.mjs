import assert from 'node:assert/strict'
import { useMealyMachine } from './src/composables/useMealyMachine.js'
import { PRESETS, BLANK_MACHINE } from './src/presets.js'
import { autoLayout, routeEdges, bounds, nodeRadius, selfLoopPath } from './src/lib/graph.js'

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/* localStorage shim so the persistence watcher does not explode under Node. */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const fresh = () => {
  const m = useMealyMachine()
  m.loadMachine(BLANK_MACHINE)
  m.notifications.value = []
  return m
}

console.log('\npresets simulate correctly')
check('sequence detector 101 -> 00101', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'seq-101'))
  m.run()
  assert.equal(m.emitted.value, '00101')
  assert.equal(m.runStatus.value, 'done')
  assert.equal(m.finalState.value, 'q1')
})

check('modulo-4 counter wraps back to q0', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'mod4'))
  m.inputString.value = '1111'
  m.run()
  assert.equal(m.emitted.value, '1111')
  assert.equal(m.finalState.value, 'q0')
})

check('up/down counter traces uud correctly', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'ud-counter'))
  m.inputString.value = 'uud'
  m.run()
  assert.equal(m.emitted.value, '121')
  assert.equal(m.finalState.value, 'q1')
})

check('traffic light emits on lamp switch-on', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'traffic'))
  m.inputString.value = 'grgrg'
  m.run()
  assert.equal(m.emitted.value, '10000')
  assert.equal(m.finalState.value, 'G')
})

check('toggle flip-flop alternates', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'toggle'))
  m.inputString.value = '101'
  m.run()
  assert.equal(m.emitted.value, '100')
  assert.equal(m.finalState.value, 'off')
})

check('every preset is deterministic and complete', () => {
  for (const preset of PRESETS) {
    const m = fresh()
    m.loadMachine(preset)
    const errors = m.diagnostics.value.filter((n) => n.level === 'error')
    assert.equal(errors.length, 0, `${preset.name}: ${errors.map((e) => e.message).join('; ')}`)
    const incomplete = m.diagnostics.value.filter((n) => n.level === 'warn')
    assert.equal(incomplete.length, 0, `${preset.name} incomplete: ${incomplete.map((e) => e.message).join('; ')}`)
  }
})

console.log('\nsimulation semantics')
check('undefined transition halts the run', () => {
  const m = fresh()
  m.inputString.value = '01x'
  m.run()
  assert.equal(m.runStatus.value, 'blocked')
  assert.equal(m.isBlocked.value, true)
  const stuck = m.trace.value.at(-1)
  assert.equal(stuck.blocked, true)
  assert.equal(stuck.input, 'x')
  assert.equal(stuck.n, 3)
  assert.equal(stuck.from, 'q1')
})

check('partial output survives a halt', () => {
  const m = fresh()
  m.inputString.value = '01z'
  m.run()
  assert.equal(m.emitted.value, '00')
  assert.equal(m.trace.value.length, 3)
})

check('cursor gates the revealed output', () => {
  const m = fresh()
  m.inputString.value = '0101'
  m.run()
  assert.equal(m.cursor.value, 4)
  m.stepBackward()
  m.stepBackward()
  assert.equal(m.cursor.value, 2)
  assert.equal(m.activeState.value, 'q1')
  assert.notEqual(m.activeTransitionId.value, null)
})

check('empty input is rejected with a message', () => {
  const m = fresh()
  m.inputString.value = '   '
  m.run()
  assert.equal(m.trace.value.length, 0)
  assert.ok(m.notifications.value.some((n) => n.level === 'error'))
})

check('active state tracks the cursor', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'mod4'))
  m.inputString.value = '111'
  m.run()
  m.cursor.value = 0
  assert.equal(m.activeState.value, 'q0')
  m.cursor.value = 2
  assert.equal(m.activeState.value, 'q2')
  m.cursor.value = 3
  assert.equal(m.activeState.value, 'q3')
})

console.log('\ndeterminism and bookkeeping')
check('duplicate delta is rejected', () => {
  const m = fresh()
  const before = m.transitions.value.length
  m.addTransition({ from: 'q0', input: '0', output: '1', to: 'q1' })
  assert.equal(m.transitions.value.length, before)
  assert.ok(m.notifications.value.some((n) => n.level === 'error'))
})

check('duplicate state name is rejected', () => {
  const m = fresh()
  m.addState('q0')
  assert.deepEqual(m.states.value, ['q0', 'q1'])
})

check('blank symbols are rejected', () => {
  const m = fresh()
  const before = m.transitions.value.length
  m.addTransition({ from: 'q0', input: '', output: '1', to: 'q1' })
  assert.equal(m.transitions.value.length, before)
})

check('multi-char symbols are normalised to one char', () => {
  const m = fresh()
  m.addTransition({ from: 'q0', input: 'ab', output: 'cd', to: 'q1' })
  const added = m.transitions.value.at(-1)
  assert.equal(added.input, 'a')
  assert.equal(added.output, 'c')
})

check('rename rewrites transitions and initial state', () => {
  const m = fresh()
  m.renameState('q0', 'start')
  assert.ok(m.states.value.includes('start'))
  assert.equal(m.initialState.value, 'start')
  assert.ok(m.transitions.value.every((t) => t.from !== 'q0' && t.to !== 'q0'))
  assert.ok(m.transitions.value.some((t) => t.from === 'start'))
})

check('removing a state cascades to its transitions', () => {
  const m = fresh()
  m.removeState('q1')
  assert.deepEqual(m.states.value, ['q0'])
  assert.equal(m.transitions.value.length, 1)
  assert.equal(m.transitions.value[0].to, 'q0')
})

check('removing a state never deletes other states', () => {
  const m = fresh()
  m.addState('q2')
  m.removeState('q1')
  assert.deepEqual(m.states.value, ['q0', 'q2'])
})

check('removing the initial state reassigns it', () => {
  const m = fresh()
  m.removeState('q0')
  assert.ok(m.states.value.includes(m.initialState.value))
  assert.equal(m.initialState.value, 'q1')
})

check('the last state cannot be deleted', () => {
  const m = fresh()
  m.removeState('q0')
  m.removeState('q1')
  assert.equal(m.states.value.length, 1)
})

check('unreachable states are reported', () => {
  const m = fresh()
  m.addState('orphan')
  const warn = m.diagnostics.value.find((n) => n.level === 'warn')
  assert.ok(warn && warn.message.includes('orphan'))
})

console.log('\nimport / export')
check('round-trips through JSON', () => {
  const m = fresh()
  m.loadMachine(PRESETS.find((p) => p.id === 'ud-counter'))
  const parsed = m.parseJson(m.toJson())
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.machine.states, ['q0', 'q1', 'q2', 'q3'])
  assert.equal(parsed.machine.transitions.length, 12)
  assert.equal(parsed.machine.initial, 'q0')
})

check('rejects malformed JSON', () => {
  const m = fresh()
  assert.equal(m.parseJson('{nope').ok, false)
  assert.equal(m.parseJson('{}').ok, false)
  assert.equal(m.parseJson('{"states":[]}').ok, false)
})

check('rejects transitions to unknown states', () => {
  const m = fresh()
  const bad = JSON.stringify({
    states: ['a'],
    transitions: [{ from: 'a', input: '0', output: '0', to: 'ghost' }],
  })
  assert.equal(m.parseJson(bad).ok, false)
})

check('falls back to the first state when initial is bogus', () => {
  const m = fresh()
  const parsed = m.parseJson(JSON.stringify({ states: ['a', 'b'], initial: 'zzz', transitions: [] }))
  assert.equal(parsed.machine.initial, 'a')
})

console.log('\ngraph layout')
check('positions every state with finite coordinates', () => {
  for (const preset of PRESETS) {
    const pos = autoLayout(preset.states, preset.transitions)
    assert.equal(Object.keys(pos).length, preset.states.length)
    for (const p of Object.values(pos)) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'non-finite coordinate')
    }
  }
})

check('no two states overlap', () => {
  for (const preset of PRESETS) {
    const pos = autoLayout(preset.states, preset.transitions)
    const list = preset.states
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const d = Math.hypot(pos[list[i]].x - pos[list[j]].x, pos[list[i]].y - pos[list[j]].y)
        const need = nodeRadius(list[i]) + nodeRadius(list[j]) + 18
        assert.ok(d > need, `${preset.name}: ${list[i]} and ${list[j]} only ${d.toFixed(1)}px apart`)
      }
    }
  }
})

check('layout fits inside the padded stage', () => {
  for (const preset of PRESETS) {
    const pos = autoLayout(preset.states, preset.transitions)
    for (const p of Object.values(pos)) {
      assert.ok(p.x > 0 && p.y > 0 && p.x < 960 && p.y < 600, `${preset.name} outside stage: ${JSON.stringify(p)}`)
    }
  }
})

check('routes one edge per transition', () => {
  for (const preset of PRESETS) {
    const pos = autoLayout(preset.states, preset.transitions)
    const edges = routeEdges(pos, preset.transitions)
    assert.equal(edges.length, preset.transitions.length, preset.name)
    for (const e of edges) {
      assert.match(e.d, /^M [\d.-]+ [\d.-]+ (Q|C) /)
      assert.ok(Number.isFinite(e.label.x) && Number.isFinite(e.label.y))
      assert.ok(Number.isFinite(e.endAngle))
    }
  }
})

check('a lone edge stays straight', () => {
  const pos = { a: { x: 200, y: 300 }, b: { x: 500, y: 300 } }
  const edges = routeEdges(pos, [{ id: '1', from: 'a', input: '0', output: '1', to: 'b' }])
  assert.equal(edges[0].curved, false)
  assert.match(edges[0].d, / Q /)
})

check('A->B and B->A curve to opposite sides', () => {
  const pos = { a: { x: 200, y: 300 }, b: { x: 500, y: 300 } }
  const edges = routeEdges(pos, [
    { id: '1', from: 'a', input: '0', output: '0', to: 'b' },
    { id: '2', from: 'b', input: '1', output: '1', to: 'a' },
  ])
  const above = edges.find((e) => e.id === '1').label.y
  const below = edges.find((e) => e.id === '2').label.y
  assert.ok(above < 300, `a->b should bow upward, label at ${above}`)
  assert.ok(below > 300, `b->a should bow downward, label at ${below}`)
})

check('parallel edges fan out with distinct labels', () => {
  const pos = { a: { x: 200, y: 300 }, b: { x: 500, y: 300 } }
  const edges = routeEdges(pos, [
    { id: '1', from: 'a', input: '0', output: '0', to: 'b' },
    { id: '2', from: 'a', input: '1', output: '1', to: 'b' },
    { id: '3', from: 'a', input: '2', output: '0', to: 'b' },
  ])
  const ys = edges.map((e) => Math.round(e.label.y))
  assert.equal(new Set(ys).size, 3, `labels collided: ${ys.join()}`)
})

check('self-loops leave and re-enter the same node', () => {
  const pos = { a: { x: 300, y: 300 } }
  const edges = routeEdges(pos, [{ id: '1', from: 'a', input: '0', output: '1', to: 'a' }])
  assert.equal(edges.length, 1)
  assert.equal(edges[0].loop, true)
  assert.match(edges[0].d, /^M .* C /)
  assert.ok(edges[0].label.y < 300, 'loop label should sit above the node')
})

check('self-loop near the top edge flips its label below', () => {
  const loop = selfLoopPath({ x: 300, y: 20 }, 30, true)
  assert.ok(loop.label.y > 20, 'flipped loop label should sit below')
})

check('edges never start inside a node circle', () => {
  const pos = { a: { x: 200, y: 300 }, b: { x: 560, y: 380 } }
  const edges = routeEdges(pos, [{ id: '1', from: 'a', input: '0', output: '0', to: 'b' }])
  const nums = edges[0].d.match(/-?\d+(\.\d+)?/g).map(Number)
  const start = { x: nums[0], y: nums[1] }
  const dist = Math.hypot(start.x - pos.a.x, start.y - pos.a.y)
  assert.ok(dist >= nodeRadius('a') - 0.5, `edge starts ${dist.toFixed(1)}px from centre, inside the node`)
})

check('bounds wrap the whole graph with margin', () => {
  const pos = { a: { x: 100, y: 100 }, b: { x: 400, y: 350 } }
  const box = bounds(pos, 60)
  assert.ok(box.x <= 40 && box.y <= 40)
  assert.ok(box.w > 300 && box.h > 250)
})

check('single state lands in the centre', () => {
  const pos = autoLayout(['solo'], [])
  assert.equal(Object.keys(pos).length, 1)
  assert.equal(pos.solo.x, 480)
  assert.equal(pos.solo.y, 300)
})

check('empty state list is handled', () => {
  assert.deepEqual(autoLayout([], []), {})
  assert.deepEqual(routeEdges({}, [{ id: '1', from: 'a', input: '0', output: '0', to: 'b' }]), [])
})

console.log('\nnode sizing')
check('radius grows with the label and stays clamped', () => {
  assert.ok(nodeRadius('q0') > 25)
  assert.ok(nodeRadius('aVeryLongStateName') > nodeRadius('q0'))
  assert.ok(nodeRadius('x'.repeat(80)) <= 58)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
