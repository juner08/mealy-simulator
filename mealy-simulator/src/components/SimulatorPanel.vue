<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, required: true },
  canRun: { type: Boolean, default: false },
  hasRun: { type: Boolean, default: false },
  isPlaying: { type: Boolean, default: false },
  atEnd: { type: Boolean, default: false },
  consumed: { type: Number, default: 0 },
  emitted: { type: String, default: '' },
  finalState: { type: String, default: '' },
  isBlocked: { type: Boolean, default: false },
  speed: { type: Number, default: 560 },
  traceLength: { type: Number, default: 0 },
})

const emit = defineEmits([
  'update:modelValue',
  'run',
  'play',
  'step-forward',
  'step-back',
  'reset',
  'update:speed',
])

const SPEEDS = [
  { label: '0.5×', value: 1100 },
  { label: '1×', value: 560 },
  { label: '2×', value: 280 },
  { label: '4×', value: 140 },
]

/** Input symbols paired with the outputs produced so far. */
const tape = computed(() => {
  const word = props.modelValue.trim()
  return [...word].map((symbol, i) => ({
    input: symbol,
    output: i < props.consumed ? (props.emitted[i] ?? '—') : null,
    revealed: i < props.consumed,
    live: i === props.consumed - 1,
  }))
})

const onInput = (event) => emit('update:modelValue', event.target.value)
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2 class="card-title">Simulation</h2>
      <span class="spacer" />
      <span v-if="hasRun" class="badge" :class="isBlocked ? 'badge-danger' : 'badge-success'">
        {{ isBlocked ? 'halted' : 'complete' }}
      </span>
    </header>

    <div class="card-body">
      <div class="field">
        <label for="input-string">Input string</label>
        <div class="input-group">
          <input
            id="input-string"
            class="input input-lg mono"
            :value="modelValue"
            placeholder="e.g. 10110"
            autocomplete="off"
            spellcheck="false"
            @input="onInput"
            @keyup.enter="emit('run')"
          />
          <button class="btn btn-success" :disabled="!canRun" @click="emit('run')">
            Run
          </button>
        </div>
      </div>

      <div class="controls">
        <button
          class="btn"
          :disabled="!hasRun"
          :title="isPlaying ? 'Pause' : 'Animate the run step by step'"
          @click="emit('play')"
        >
          <svg v-if="!isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.79-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14Z" />
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
          </svg>
          {{ isPlaying ? 'Pause' : 'Play' }}
        </button>

        <button class="btn" :disabled="!hasRun || atEnd" title="Back one step" @click="emit('step-back')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.5 5.14 6.21 11.99a1 1 0 0 0 0 1.7l9.29 6.86a1 1 0 0 0 1.53-.85V5.14a1 1 0 0 0-1.53-.85Z" />
          </svg>
          Prev
        </button>

        <button
          class="btn"
          :disabled="!hasRun || (atEnd && !isPlaying)"
          title="Forward one step"
          @click="emit('step-forward')"
        >
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8.5 5.14 17.79 11.99a1 1 0 0 1 0 1.7l-9.29 6.86a1 1 0 0 1-1.53-.85V5.14a1 1 0 0 1 1.53-.85Z" />
          </svg>
        </button>

        <button class="btn btn-ghost" :disabled="!hasRun" title="Clear the run" @click="emit('reset')">
          Clear
        </button>

        <label class="speed">
          <span>Speed</span>
          <select
            class="select"
            :value="speed"
            @change="emit('update:speed', Number($event.target.value))"
          >
            <option v-for="s in SPEEDS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
        </label>
      </div>

      <div v-if="tape.length" class="tape-wrap">
        <div class="tape-label">input</div>
        <div class="tape">
          <span
            v-for="(cell, i) in tape"
            :key="`i${i}`"
            class="cell input-cell"
            :class="{ 'is-revealed': cell.revealed, 'is-live': cell.live }"
          >{{ cell.input }}</span>
        </div>
      </div>

      <div v-if="hasRun" class="tape-wrap">
        <div class="tape-label">output</div>
        <div class="tape">
          <span
            v-for="(cell, i) in tape"
            :key="`o${i}`"
            class="cell output-cell"
            :class="{
              'is-revealed': cell.revealed,
              'is-live': cell.live,
              'is-blocked': i === consumed - 1 && isBlocked,
            }"
          >{{ cell.output ?? '·' }}</span>
        </div>
      </div>

      <div v-if="hasRun" class="verdict" :class="{ 'is-bad': isBlocked }">
        <div class="verdict-item">
          <span class="verdict-label">Output string</span>
          <code class="verdict-value">{{ emitted || '—' }}</code>
        </div>
        <div class="verdict-rule" />
        <div class="verdict-item">
          <span class="verdict-label">Ends in</span>
          <code class="verdict-value">{{ finalState || '—' }}</code>
        </div>
        <div class="verdict-rule" />
        <div class="verdict-item">
          <span class="verdict-label">Steps</span>
          <code class="verdict-value">{{ consumed }}<span class="of">/</span>{{ traceLength }}</code>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.speed {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-left: auto;
}

.speed span {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.speed .select {
  width: auto;
  padding-block: 0.3125rem;
  font-family: var(--mono);
}

.tape-wrap {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.tape-label {
  width: 3.25rem;
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.tape {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding-bottom: 2px;
  min-width: 0;
}

.cell {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-primary);
  background: var(--bg-primary);
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-tertiary);
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease,
    transform 0.18s ease;
}

.input-cell.is-revealed {
  border-color: var(--info);
  color: var(--info);
  background: var(--info-soft);
}

.output-cell.is-revealed {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.cell.is-live {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.output-cell.is-blocked {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-soft);
}

.verdict {
  display: flex;
  align-items: stretch;
  gap: 0.875rem;
  padding: 0.75rem 0.875rem;
  background: var(--success-soft);
  border: 1px solid color-mix(in srgb, var(--success) 45%, transparent);
  border-radius: var(--radius-md);
}

.verdict.is-bad {
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.verdict-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.verdict-rule {
  width: 1px;
  background: color-mix(in srgb, currentcolor 18%, transparent);
}

.verdict-label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.verdict-value {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--success);
  word-break: break-all;
}

.is-bad .verdict-value {
  color: var(--danger);
}

.of {
  color: var(--text-tertiary);
  font-weight: 400;
}
</style>
