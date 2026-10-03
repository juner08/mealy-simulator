<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AlertStack from './components/AlertStack.vue'
import MachinePanel from './components/MachinePanel.vue'
import PresetMenu from './components/PresetMenu.vue'
import SimulatorPanel from './components/SimulatorPanel.vue'
import StateDiagram from './components/StateDiagram.vue'
import StatesPanel from './components/StatesPanel.vue'
import TraceTable from './components/TraceTable.vue'
import TransitionsPanel from './components/TransitionsPanel.vue'
import { useMealyMachine } from './composables/useMealyMachine.js'
import { BLANK_MACHINE, PRESETS } from './presets.js'

const THEME_KEY = 'mealy-simulator:theme'

const m = reactive(useMealyMachine())

function initialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* storage blocked — fall through to the OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
}

const theme = ref(initialTheme())
const activePreset = ref('')

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(THEME_KEY, theme.value)
  } catch {
    /* storage blocked — the theme still applies for this session */
  }
}

/* ---------------- presets & io ---------------- */

function loadPreset(preset) {
  activePreset.value = preset.id
  m.loadMachine(preset)
  m.notify('success', `Loaded "${preset.name}".`)
}

function newMachine() {
  activePreset.value = ''
  m.loadMachine(BLANK_MACHINE)
  m.notify('info', 'Started a blank machine.')
}

function onImport(text) {
  const result = m.parseJson(text)
  if (!result.ok) return m.notify('error', result.message, 7000)
  activePreset.value = ''
  m.loadMachine(result.machine)
  m.notify('success', 'Machine imported.')
}

const json = computed(() => m.toJson())

/* ---------------- shortcuts ---------------- */

function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    m.run()
    return
  }
  if (event.key === 'Escape' || isTyping(event.target)) return

  if (event.code === 'Space') {
    event.preventDefault()
    if (m.hasRun) m.togglePlayback()
    else m.run({ autoplay: true })
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    m.stepForward()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    m.stepBackward()
  }
}

function seek(position) {
  m.stopPlayback()
  m.cursor = position
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (!m.hydrate()) loadPreset(PRESETS[0])
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  m.stopPlayback()
})
</script>

<template>
  <div class="app" :data-theme="theme">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="2.6" />
            <circle cx="18" cy="18" r="2.6" />
            <circle cx="18" cy="6" r="2.6" />
            <path d="M8.6 6H15.4M6 8.6v3.2a2 2 0 0 0 2 2h10" />
          </svg>
        </span>
        <div class="brand-text">
          <h1 class="brand-title">
            <span class="gradient-text">Mealy Machine</span> Studio
          </h1>
          <p class="brand-sub">Build, validate and step through a finite-state machine</p>
        </div>
      </div>

      <span class="spacer" />

      <div class="header-actions">
        <button
          class="btn btn-ghost btn-icon"
          :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        </button>

        <span class="divider-v" />

        <button class="btn btn-ghost" @click="newMachine">New</button>
        <PresetMenu
          :theme="theme"
          :active-preset="activePreset"
          @load-preset="loadPreset"
          @new-machine="newMachine"
        />
      </div>
    </header>

    <AlertStack
      :notifications="m.notifications"
      @dismiss="m.dismiss"
    />

    <main class="page">
      <div class="layout">
        <aside class="sidebar">
          <StatesPanel
            :states="m.states"
            :initial="m.initialState"
            :active-state="m.activeState"
            :has-run="m.hasRun"
            @add="m.addState"
            @remove="m.removeState"
            @rename="m.renameState"
            @make-initial="m.setAsInitial"
          />

          <TransitionsPanel
            :states="m.states"
            :transitions="m.transitions"
            :alphabet="m.inputAlphabet"
            @add="m.addTransition"
            @remove="m.removeTransition"
          />

          <MachinePanel
            :diagnostics="m.diagnostics"
            :states="m.states"
            :initial="m.initialState"
            :transitions="m.transitions"
            :input-alphabet="m.inputAlphabet"
            :output-alphabet="m.outputAlphabet"
            :json="json"
            @import="onImport"
          />
        </aside>

        <div class="workspace">
          <StateDiagram
            :states="m.states"
            :transitions="m.transitions"
            :initial="m.initialState"
            :active-state="m.activeState"
            :active-transition-id="m.activeTransitionId"
            :has-run="m.hasRun"
          />

          <SimulatorPanel
            :model-value="m.inputString"
            :can-run="Boolean(m.inputString.trim())"
            :has-run="m.hasRun"
            :is-playing="m.isPlaying"
            :at-end="m.atEnd"
            :consumed="m.consumed"
            :emitted="m.emitted"
            :final-state="m.finalState"
            :is-blocked="m.isBlocked"
            :speed="m.speed"
            :trace-length="m.trace.length"
            @update:model-value="m.inputString = $event"
            @run="m.run()"
            @play="m.togglePlayback()"
            @step-forward="m.stepForward()"
            @step-back="m.stepBackward()"
            @reset="m.resetRun()"
            @update:speed="m.speed = $event"
          />

          <TraceTable
            :trace="m.trace"
            :cursor="m.cursor"
            :has-run="m.hasRun"
            @seek="seek"
          />
        </div>
      </div>

      <footer class="footer-note">
        <kbd>Ctrl</kbd> + <kbd>Enter</kbd> run · <kbd>Space</kbd> play ·
        <kbd>←</kbd> <kbd>→</kbd> step · changes save to this browser automatically
      </footer>
    </main>
  </div>
</template>
