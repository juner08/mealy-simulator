<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  diagnostics: { type: Array, required: true },
  states: { type: Array, required: true },
  initial: { type: String, required: true },
  transitions: { type: Array, required: true },
  inputAlphabet: { type: Array, required: true },
  outputAlphabet: { type: Array, required: true },
  json: { type: String, required: true },
})

const emit = defineEmits(['import'])

const fileInput = ref(null)

const LEVEL_ICON = { error: '✕', warn: '!', info: 'i' }

const tuple = computed(
  () =>
    `M = (Q, Σ, Γ, δ, q₀)  |Q|=${props.states.length}, ` +
    `|δ|=${props.transitions.length}`,
)

const alphabetLine = computed(() => ({
  sigma: props.inputAlphabet.length ? props.inputAlphabet.join(' ') : '∅',
  gamma: props.outputAlphabet.length ? props.outputAlphabet.join(' ') : '∅',
}))

function download() {
  const blob = new Blob([props.json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'mealy-machine.json'
  link.click()
  URL.revokeObjectURL(url)
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.json)
  } catch {
    /* clipboard blocked — the download button still works */
  }
}

function pickFile() {
  fileInput.value?.click()
}

async function onFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  emit('import', await file.text())
}
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2 class="card-title">Formal definition</h2>
      <span class="spacer" />
      <button class="btn btn-sm btn-ghost" title="Download as JSON" @click="download">
        Export
      </button>
      <button class="btn btn-sm btn-ghost" title="Copy JSON to the clipboard" @click="copy">
        Copy
      </button>
      <button class="btn btn-sm btn-ghost" title="Load a JSON file" @click="pickFile">Import</button>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        class="file-input"
        tabindex="-1"
        aria-hidden="true"
        @change="onFile"
      />
    </header>

    <div class="card-body">
      <dl class="tuple">
        <div class="tuple-row">
          <dt>Q</dt>
          <dd><code>{{ states.join(', ') || '∅' }}</code></dd>
        </div>
        <div class="tuple-row">
          <dt>Σ</dt>
          <dd><code>{{ alphabetLine.sigma }}</code></dd>
        </div>
        <div class="tuple-row">
          <dt>Γ</dt>
          <dd><code>{{ alphabetLine.gamma }}</code></dd>
        </div>
        <div class="tuple-row">
          <dt>q₀</dt>
          <dd><code>{{ initial || '—' }}</code></dd>
        </div>
        <div class="tuple-row">
          <dt>δ</dt>
          <dd><code>{{ transitions.length }} rules</code></dd>
        </div>
      </dl>

      <p class="tuple-note">{{ tuple }}</p>

      <ul v-if="diagnostics.length" class="notes">
        <li v-for="(note, i) in diagnostics" :key="i" class="note" :class="note.level">
          <span class="note-icon" aria-hidden="true">{{ LEVEL_ICON[note.level] }}</span>
          <span class="note-text">{{ note.message }}</span>
        </li>
      </ul>
      <p v-else class="notes-empty">
        <span class="tick" aria-hidden="true">✓</span>
        This machine is deterministic and complete over its alphabet.
      </p>
    </div>
  </section>
</template>

<style scoped>
.file-input {
  display: none;
}

.tuple {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3125rem;
  padding: 0.75rem 0.875rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
}

.tuple-row {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
}

.tuple-row dt {
  width: 1.25rem;
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-tertiary);
}

.tuple-row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tuple-row code {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.tuple-note {
  font-family: var(--mono);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-align: center;
}

.notes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: var(--radius-md);
  border: 1px solid;
  font-size: 0.75rem;
  line-height: 1.45;
}

.note-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: var(--radius-full);
  font-size: 0.625rem;
  font-weight: 800;
  color: #fff;
}

.note.error {
  background: var(--danger-soft);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--danger);
}

.note.error .note-icon {
  background: var(--danger);
}

.note.warn {
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
  color: var(--warning);
}

.note.warn .note-icon {
  background: var(--warning);
}

.note.info {
  background: var(--info-soft);
  border-color: color-mix(in srgb, var(--info) 30%, transparent);
  color: var(--info);
}

.note.info .note-icon {
  background: var(--info);
}

.notes-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-md);
  background: var(--success-soft);
  border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
  color: var(--success);
  font-size: 0.75rem;
  font-weight: 600;
}

.tick {
  display: grid;
  place-items: center;
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--success);
  color: var(--bg-secondary);
  font-size: 0.625rem;
  font-weight: 800;
}
</style>
