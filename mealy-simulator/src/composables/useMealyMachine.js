import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'mealy-simulator:v1'
let idSeq = 0
const nextId = () => `t${Date.now().toString(36)}${(idSeq++).toString(36)}`

/** Whitespace-free, trimmed, uppercase symbol. Mealy symbols are single chars. */
const normalizeSymbol = (value) => {
  const raw = String(value ?? '').trim()
  return raw.length ? raw[0] : ''
}

export function useMealyMachine() {
  /* ---------------- machine definition ---------------- */

  const states = ref(['q0', 'q1'])
  const initialState = ref('q0')
  const transitions = ref([])
  const inputString = ref('')

  /* ---------------- simulation run ---------------- */

  const trace = ref([])
  const cursor = ref(0)
  const runStatus = ref('idle') // idle | done | blocked
  const isPlaying = ref(false)
  const speed = ref(560)
  let playTimer = null

  /* ---------------- toasts ---------------- */

  const notifications = ref([])
  let toastSeq = 0

  function notify(level, message, ttl = 4200) {
    const id = ++toastSeq
    notifications.value = [...notifications.value, { id, level, message }]
    if (ttl > 0) setTimeout(() => dismiss(id), ttl)
    return id
  }

  function dismiss(id) {
    notifications.value = notifications.value.filter((n) => n.id !== id)
  }

  /* ---------------- derived: alphabets ---------------- */

  const inputAlphabet = computed(() =>
    [...new Set(transitions.value.map((t) => t.input))].sort(),
  )
  const outputAlphabet = computed(() =>
    [...new Set(transitions.value.map((t) => t.output))].sort(),
  )

  const transitionKey = (t) => `${t.from}\u0000${t.input}`

  /** δ(state, symbol) — first matching transition, or undefined. */
  function delta(state, symbol) {
    return transitions.value.find((t) => t.from === state && t.input === symbol)
  }

  /* ---------------- derived: run results ---------------- */

  const hasRun = computed(() => trace.value.length > 0)
  const isBlocked = computed(() => runStatus.value === 'blocked')
  const isComplete = computed(() => runStatus.value === 'done')

  const emitted = computed(() =>
    trace.value.filter((s) => !s.blocked).map((s) => s.output).join(''),
  )

  const finalState = computed(() => {
    if (!trace.value.length) return initialState.value
    const last = trace.value[trace.value.length - 1]
    return last.to ?? last.from
  })

  /** State the diagram should highlight for the current cursor position. */
  const activeState = computed(() => {
    if (!cursor.value) return initialState.value
    const step = trace.value[cursor.value - 1]
    return step ? (step.to ?? step.from) : initialState.value
  })

  /** Transition the diagram should highlight for the current cursor position. */
  const activeTransitionId = computed(() => {
    if (!cursor.value) return null
    const step = trace.value[cursor.value - 1]
    return step && !step.blocked ? step.transitionId : null
  })

  const consumed = computed(() => Math.min(cursor.value, trace.value.length))
  const atEnd = computed(() => hasRun.value && cursor.value >= trace.value.length)

  /* ---------------- state CRUD ---------------- */

  function addState(rawName) {
    const name = String(rawName ?? '').trim()
    if (!name) return notify('error', 'State name cannot be empty.')
    if (states.value.includes(name)) return notify('error', `State "${name}" already exists.`)
    states.value = [...states.value, name]
    notify('success', `Added state "${name}".`)
  }

  function removeState(name) {
    if (states.value.length <= 1) return notify('error', 'A machine needs at least one state.')

    const dropped = transitions.value.filter(
      (t) => t.from === name || t.to === name,
    ).length

    states.value = states.value.filter((s) => s !== name)
    transitions.value = transitions.value.filter(
      (t) => t.from !== name && t.to !== name,
    )
    if (initialState.value === name) initialState.value = states.value[0]
    resetRun()

    notify(
      'success',
      dropped
        ? `Removed "${name}" and ${dropped} transition(s).`
        : `Removed "${name}".`,
    )
  }

  function renameState(oldName, rawNext) {
    const next = String(rawNext ?? '').trim()
    if (!next) return notify('error', 'State name cannot be empty.')
    if (next === oldName) return
    if (states.value.includes(next)) return notify('error', `State "${next}" already exists.`)

    states.value = states.value.map((s) => (s === oldName ? next : s))
    transitions.value = transitions.value.map((t) => ({
      ...t,
      from: t.from === oldName ? next : t.from,
      to: t.to === oldName ? next : t.to,
    }))
    if (initialState.value === oldName) initialState.value = next
    resetRun()
    notify('success', `Renamed "${oldName}" to "${next}".`)
  }

  function setAsInitial(name) {
    if (!states.value.includes(name)) return
    initialState.value = name
    resetRun()
    notify('info', `"${name}" is now the initial state.`)
  }

  /* ---------------- transition CRUD ---------------- */

  function addTransition(raw) {
    const from = String(raw.from ?? '').trim()
    const to = String(raw.to ?? '').trim()
    const input = normalizeSymbol(raw.input)
    const output = normalizeSymbol(raw.output)

    if (!states.value.includes(from)) return notify('error', 'Pick a valid source state.')
    if (!states.value.includes(to)) return notify('error', 'Pick a valid target state.')
    if (!input) return notify('error', 'Input symbol is required.')
    if (!output) return notify('error', 'Output symbol is required.')
    if (delta(from, input)) {
      return notify(
        'error',
        `δ(${from}, ${input}) already exists. A Mealy machine must be deterministic.`,
      )
    }

    transitions.value = [
      ...transitions.value,
      { id: nextId(), from, input, output, to },
    ]
    return notify('success', `Added δ(${from}, ${input}) → (${to}, ${output}).`)
  }

  function removeTransition(id) {
    const target = transitions.value.find((t) => t.id === id)
    transitions.value = transitions.value.filter((t) => t.id !== id)
    resetRun()
    if (target) {
      notify('success', `Removed δ(${target.from}, ${target.input}).`)
    }
  }

  /* ---------------- simulation ---------------- */

  function resetRun() {
    stopPlayback()
    trace.value = []
    cursor.value = 0
    runStatus.value = 'idle'
  }

  function stopPlayback() {
    if (playTimer) clearInterval(playTimer)
    playTimer = null
    isPlaying.value = false
  }

  function run({ autoplay = false } = {}) {
    const word = inputString.value.trim()
    if (!word) return notify('error', 'Enter an input string to simulate.')
    if (!states.value.includes(initialState.value)) {
      return notify('error', 'Choose a valid initial state.')
    }

    const steps = []
    let at = initialState.value

    for (let i = 0; i < word.length; i += 1) {
      const symbol = word[i]
      const t = delta(at, symbol)
      if (!t) {
        steps.push({
          n: i + 1,
          from: at,
          input: symbol,
          output: null,
          to: null,
          transitionId: null,
          blocked: true,
        })
        break
      }
      steps.push({
        n: i + 1,
        from: at,
        input: symbol,
        output: t.output,
        to: t.to,
        transitionId: t.id,
        blocked: false,
      })
      at = t.to
    }

    trace.value = steps
    cursor.value = 0
    const blocked = steps.some((s) => s.blocked)
    runStatus.value = blocked ? 'blocked' : 'done'

    if (blocked) {
      const stuck = steps.find((s) => s.blocked)
      notify(
        'error',
        `Stuck at step ${stuck.n}: no δ(${stuck.from}, ${stuck.input}). The machine halts there.`,
        7000,
      )
      return
    }

    if (autoplay) startPlayback()
    else cursor.value = steps.length
  }

  function stepForward() {
    stopPlayback()
    if (!hasRun.value) return run()
    cursor.value = Math.min(cursor.value + 1, trace.value.length)
  }

  function stepBackward() {
    stopPlayback()
    cursor.value = Math.max(cursor.value - 1, 0)
  }

  function startPlayback() {
    if (!hasRun.value) return run({ autoplay: true })
    stopPlayback()
    if (atEnd.value) cursor.value = 0
    isPlaying.value = true
    playTimer = setInterval(() => {
      if (cursor.value >= trace.value.length) {
        stopPlayback()
        return
      }
      cursor.value += 1
    }, speed.value)
  }

  function togglePlayback() {
    if (isPlaying.value) stopPlayback()
    else startPlayback()
  }

  watch(speed, () => {
    if (!isPlaying.value) return
    stopPlayback()
    startPlayback()
  })

  /* ---------------- diagnostics ---------------- */

  const diagnostics = computed(() => {
    const notes = []
    const alphabet = inputAlphabet.value

    if (!states.value.includes(initialState.value)) {
      notes.push({ level: 'error', message: 'Initial state is not part of the machine.' })
    }

    const seen = new Map()
    for (const t of transitions.value) {
      const key = transitionKey(t)
      if (seen.has(key)) {
        notes.push({
          level: 'error',
          message: `δ(${t.from}, ${t.input}) is defined twice — machines must be deterministic.`,
        })
      }
      seen.set(key, t)
    }

    for (const t of transitions.value) {
      if (!states.value.includes(t.from) || !states.value.includes(t.to)) {
        notes.push({
          level: 'error',
          message: `Transition δ(${t.from}, ${t.input}) → ${t.to} points at a state that does not exist.`,
        })
        break
      }
    }

    if (alphabet.length) {
      const gaps = []
      for (const s of states.value) {
        const missing = alphabet.filter((a) => !delta(s, a))
        if (missing.length) gaps.push(`${s} lacks ${missing.join(', ')}`)
      }
      if (gaps.length) {
        notes.push({
          level: 'warn',
          message: `Incomplete δ — ${gaps.join(' · ')}.`,
        })
      }
    } else {
      notes.push({ level: 'info', message: 'No transitions defined yet.' })
    }

    if (transitions.value.length) {
      const reach = new Set([initialState.value])
      const queue = [initialState.value]
      while (queue.length) {
        const at = queue.shift()
        for (const t of transitions.value) {
          if (t.from === at && !reach.has(t.to)) {
            reach.add(t.to)
            queue.push(t.to)
          }
        }
      }
      const orphans = states.value.filter((s) => !reach.has(s))
      if (orphans.length) {
        notes.push({
          level: 'warn',
          message: `Unreachable from the initial state: ${orphans.join(', ')}.`,
        })
      }

      const sinks = states.value.filter(
        (s) => delta(s, alphabet[0]) && alphabet.every((a) => delta(s, a).to === s),
      )
      if (alphabet.length && sinks.length) {
        notes.push({
          level: 'info',
          message: `${sinks.join(', ')} ${sinks.length > 1 ? 'are' : 'is'} a dead state — every transition loops back.`,
        })
      }
    }

    return notes
  })

  const blockingIssues = computed(() => diagnostics.value.filter((n) => n.level === 'error'))

  /* ---------------- preset / import / export ---------------- */

  function loadMachine(preset) {
    resetRun()
    states.value = [...preset.states]
    initialState.value = preset.initial ?? preset.states[0]
    transitions.value = preset.transitions.map((t) => ({ ...t, id: nextId() }))
    inputString.value = preset.sample ?? ''
    return preset
  }

  function clearMachine() {
    resetRun()
    states.value = ['q0']
    initialState.value = 'q0'
    transitions.value = []
    inputString.value = ''
  }

  function serialize() {
    return {
      states: [...states.value],
      initial: initialState.value,
      transitions: transitions.value.map(({ from, input, output, to }) => ({
        from,
        input,
        output,
        to,
      })),
      sample: inputString.value,
    }
  }

  function toJson() {
    return JSON.stringify(
      { kind: 'mealy-machine', version: 1, ...serialize() },
      null,
      2,
    )
  }

  /** Returns { ok, machine } so the caller can surface a precise error. */
  function parseJson(text) {
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, message: 'That file is not valid JSON.' }
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, message: 'Expected a JSON object.' }
    }
    if (!Array.isArray(data.states) || !data.states.length) {
      return { ok: false, message: 'Missing a non-empty "states" array.' }
    }
    const names = data.states.map((s) => String(s).trim()).filter(Boolean)
    if (!names.length) return { ok: false, message: 'Every state name was blank.' }
    if (new Set(names).size !== names.length) {
      return { ok: false, message: 'State names must be unique.' }
    }
    const list = Array.isArray(data.transitions) ? data.transitions : []
    const bad = list.find(
      (t) =>
        !names.includes(t?.from) ||
        !names.includes(t?.to) ||
        !normalizeSymbol(t?.input) ||
        !normalizeSymbol(t?.output),
    )
    if (bad) {
      return {
        ok: false,
        message: 'A transition references an unknown state or has an empty symbol.',
      }
    }
    return {
      ok: true,
      machine: {
        states: names,
        initial: names.includes(data.initial) ? data.initial : names[0],
        transitions: list.map((t) => ({
          from: t.from,
          input: normalizeSymbol(t.input),
          output: normalizeSymbol(t.output),
          to: t.to,
        })),
        sample: typeof data.sample === 'string' ? data.sample : '',
      },
    }
  }

  /* ---------------- persistence ---------------- */

  let saveTimer = null
  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ kind: 'mealy-machine', version: 1, ...serialize() }),
      )
    } catch {
      /* storage full or blocked — non-fatal */
    }
  }

  function hydrate() {
    let raw
    try {
      raw = localStorage.getItem(STORAGE_KEY)
    } catch {
      return false
    }
    if (!raw) return false
    const parsed = parseJson(raw)
    if (!parsed.ok) return false
    loadMachine(parsed.machine)
    return true
  }

  watch(
    [states, initialState, transitions, inputString],
    () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(persist, 400)
    },
    { deep: true },
  )

  return {
    states,
    initialState,
    transitions,
    inputString,
    trace,
    cursor,
    runStatus,
    isPlaying,
    speed,
    notifications,
    inputAlphabet,
    outputAlphabet,
    hasRun,
    isBlocked,
    isComplete,
    emitted,
    finalState,
    activeState,
    activeTransitionId,
    consumed,
    atEnd,
    diagnostics,
    blockingIssues,
    notify,
    dismiss,
    delta,
    addState,
    removeState,
    renameState,
    setAsInitial,
    addTransition,
    removeTransition,
    run,
    resetRun,
    stepForward,
    stepBackward,
    togglePlayback,
    startPlayback,
    stopPlayback,
    loadMachine,
    clearMachine,
    serialize,
    toJson,
    parseJson,
    hydrate,
  }
}
