<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  states: { type: Array, required: true },
  transitions: { type: Array, required: true },
  alphabet: { type: Array, required: true },
})

const emit = defineEmits(['add', 'remove'])

const from = ref('')
const to = ref('')
const input = ref('')
const output = ref('')

watch(
  () => props.states,
  (list) => {
    if (!list.includes(from.value)) from.value = list[0] ?? ''
    if (!list.includes(to.value)) to.value = list[1] ?? list[0] ?? ''
  },
  { immediate: true },
)

const canAdd = computed(
  () => from.value && to.value && input.value.trim() && output.value.trim(),
)

const ordered = computed(() =>
  [...props.transitions].sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.input.localeCompare(b.input),
  ),
)

const coverage = computed(() => {
  const total = props.alphabet.length * props.states.length
  if (!total) return 0
  return Math.round((props.transitions.length / total) * 100)
})

function submit() {
  if (!canAdd.value) return
  emit('add', { from: from.value, to: to.value, input: input.value, output: output.value })
  input.value = ''
  output.value = ''
}

function quickAdd(fromState, symbol) {
  emit('add', {
    from: fromState,
    to: fromState,
    input: symbol,
    output: '0',
  })
}
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2 class="card-title">Transitions</h2>
      <span class="badge badge-count">{{ transitions.length }}</span>
      <span class="spacer" />
      <span
        class="badge"
        :class="coverage === 100 ? 'badge-success' : 'badge-info'"
        :title="`${transitions.length} of ${alphabet.length * states.length} state/symbol pairs defined`"
      >
        {{ coverage }}% complete
      </span>
    </header>

    <div class="card-body">
      <form class="form-grid" @submit.prevent="submit">
        <div class="field">
          <label for="t-from">From state</label>
          <select id="t-from" v-model="from" class="select">
            <option v-for="s in states" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="field">
          <label for="t-input">Input</label>
          <input
            id="t-input"
            v-model="input"
            class="input mono"
            maxlength="1"
            placeholder="0"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="t-to">To state</label>
          <select id="t-to" v-model="to" class="select">
            <option v-for="s in states" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="field">
          <label for="t-output">Output</label>
          <input
            id="t-output"
            v-model="output"
            class="input mono"
            maxlength="1"
            placeholder="0"
            autocomplete="off"
          />
        </div>
        <button type="submit" class="btn btn-primary btn-block span-2" :disabled="!canAdd">
          Add transition
        </button>
      </form>

      <div v-if="transitions.length" class="rule-list">
        <div
          v-for="t in ordered"
          :key="t.id"
          class="rule"
        >
          <div class="rule-notation">
            <code class="tok from">{{ t.from }}</code>
            <span class="arrow">→</span>
            <span class="pair">
              <code class="tok sym">{{ t.input }}</code>
              <span class="slash">/</span>
              <code class="tok sym">{{ t.output }}</code>
            </span>
            <span class="arrow">→</span>
            <code class="tok to">{{ t.to }}</code>
          </div>
          <button
            class="btn btn-sm btn-danger-ghost"
            :title="`Delete δ(${t.from}, ${t.input})`"
            @click="emit('remove', t.id)"
          >
            ✕
          </button>
        </div>
      </div>

      <div v-else class="empty">
        <p>No transitions yet.</p>
        <p class="hint">Fill the form above, or scaffold a row below.</p>
      </div>

      <div v-if="!transitions.length" class="scaffold">
        <span class="scaffold-label">Scaffold</span>
        <button
          v-for="(s, i) in states"
          :key="s"
          class="btn btn-sm btn-ghost"
          @click="quickAdd(s, i === 0 ? '0' : '1')"
        >
          δ({{ s }}, {{ i === 0 ? '0' : '1' }})
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.625rem;
}

.span-2 {
  grid-column: span 2;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 15rem;
  overflow: auto;
}

.rule {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3125rem 0.375rem 0.3125rem 0.625rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  transition: border-color 0.15s ease;
}

.rule:hover {
  border-color: var(--border-secondary);
}

.rule-notation {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
  min-width: 0;
  font-size: 0.8125rem;
}

.tok {
  padding: 0.0625rem 0.375rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
}

.tok.from,
.tok.to {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.tok.to {
  background: var(--accent-soft);
  color: var(--accent);
}

.tok.sym {
  background: var(--info-soft);
  color: var(--info);
}

.pair {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
}

.slash,
.arrow {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.rule .btn {
  margin-left: auto;
}

.hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.scaffold {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
  padding-top: 0.25rem;
  border-top: 1px dashed var(--border-primary);
}

.scaffold-label {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
</style>
