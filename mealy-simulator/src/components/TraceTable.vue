<script setup>
const props = defineProps({
  trace: { type: Array, required: true },
  cursor: { type: Number, default: 0 },
  hasRun: { type: Boolean, default: false },
})

const emit = defineEmits(['seek'])

function rowClass(step, index) {
  return {
    'is-active': index === props.cursor - 1,
    'is-done': index < props.cursor - 1,
    'is-pending': index >= props.cursor,
    'is-blocked': step.blocked,
  }
}
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2 class="card-title">Execution trace</h2>
      <span v-if="trace.length" class="badge badge-count">{{ trace.length }}</span>
      <span class="spacer" />
      <span v-if="trace.length" class="badge">
        {{ cursor }} / {{ trace.length }} revealed
      </span>
    </header>

    <div v-if="trace.length" class="table-wrapper">
      <table class="table">
        <caption class="sr-only">Step by step state transitions</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">From</th>
            <th scope="col">Input</th>
            <th scope="col">Output</th>
            <th scope="col">To</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(step, i) in trace"
            :key="step.n"
            :class="rowClass(step, i)"
            class="row"
            tabindex="0"
            @click="emit('seek', i + 1)"
            @keyup.enter="emit('seek', i + 1)"
            @keyup.space.prevent="emit('seek', i + 1)"
          >
            <td class="cell-mono">{{ step.n }}</td>
            <td><code class="cell-mono">{{ step.from }}</code></td>
            <td><code class="cell-mono">{{ step.input }}</code></td>
            <td>
              <code v-if="step.blocked" class="cell-mono danger">—</code>
              <code v-else class="cell-mono accent">{{ step.output }}</code>
            </td>
            <td>
              <code v-if="step.blocked" class="cell-mono danger">undefined</code>
              <code v-else class="cell-mono">{{ step.to }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">
      <p>No run yet.</p>
      <p class="hint">Type an input string above and press Run to see each step.</p>
    </div>
  </section>
</template>

<style scoped>
.table-wrapper {
  max-height: 19rem;
  overflow: auto;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.row {
  cursor: pointer;
}

.row:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.row.is-pending td {
  opacity: 0.45;
}

code {
  padding: 0.0625rem 0.3125rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: var(--radius-sm);
}

code.accent {
  background: var(--accent-soft);
  color: var(--accent);
}

code.danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
</style>
