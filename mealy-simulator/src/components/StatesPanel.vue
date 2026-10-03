<script setup>
import { computed, nextTick, ref } from 'vue'

const props = defineProps({
  states: { type: Array, required: true },
  initial: { type: String, required: true },
  activeState: { type: String, default: '' },
  hasRun: { type: Boolean, default: false },
})

const emit = defineEmits(['add', 'remove', 'rename', 'make-initial'])

const draft = ref('')
const editing = ref('')
const editDraft = ref('')
const editInput = ref(null)
const canRemove = computed(() => props.states.length > 1)

const setEditInput = (el) => {
  editInput.value = el
}

const slug = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

function suggest() {
  const base = `q${props.states.length}`
  if (!props.states.includes(base)) return base
  let i = 0
  while (props.states.includes(`q${props.states.length}_${i}`)) i += 1
  return `q${props.states.length}_${i}`
}

function submit() {
  const name = draft.value.trim()
  if (!name) return
  emit('add', name)
  draft.value = ''
}

function quickAdd() {
  const name = suggest()
  if (props.states.includes(name)) return
  emit('add', name)
}

async function startRename(name) {
  editing.value = name
  editDraft.value = name
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

async function commitRename() {
  const next = editDraft.value.trim()
  const original = editing.value
  editing.value = ''
  if (!next || next === original) return
  emit('rename', original, next)
}

function cancelRename() {
  editing.value = ''
}
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2 class="card-title">States</h2>
      <span class="badge badge-count">{{ states.length }}</span>
      <span class="spacer" />
      <button
        class="btn btn-sm btn-ghost"
        title="Add a state with a generated name"
        @click="quickAdd"
      >
        + Auto
      </button>
    </header>

    <div class="card-body">
      <form class="input-group" @submit.prevent="submit">
        <input
          v-model="draft"
          class="input mono"
          placeholder="New state name"
          aria-label="New state name"
          maxlength="16"
          list="state-suggestions"
        />
        <datalist id="state-suggestions">
          <option v-for="state in states" :key="state" :value="state" />
        </datalist>
        <button type="submit" class="btn btn-primary" :disabled="!draft.trim()">Add</button>
      </form>

      <ul class="state-list">
        <li
          v-for="state in states"
          :key="state"
          class="state-row"
          :class="{
            'is-initial': state === initial,
            'is-live': hasRun && state === activeState,
          }"
        >
          <span class="dot" aria-hidden="true" />

          <input
            v-if="editing === state"
            :ref="setEditInput"
            v-model="editDraft"
            class="input mono edit-field"
            maxlength="16"
            aria-label="Rename state"
            @keyup.enter.prevent="commitRename"
            @keyup.esc.prevent="cancelRename"
            @blur="commitRename"
          />
          <code v-else class="state-label">{{ state }}</code>

          <span v-if="state === initial" class="badge badge-primary">q0</span>
          <span v-if="hasRun && state === activeState" class="badge badge-success">live</span>

          <div class="state-tools">
            <button
              class="btn btn-sm btn-ghost"
              :disabled="state === initial"
              :title="state === initial ? 'Already the initial state' : `Make ${state} the initial state`"
              @click="emit('make-initial', state)"
            >
              Start
            </button>
            <button
              class="btn btn-sm btn-ghost"
              :title="`Rename ${state}`"
              @click="startRename(state)"
            >
              Rename
            </button>
            <button
              class="btn btn-sm btn-danger-ghost"
              :disabled="!canRemove"
              :title="canRemove ? `Delete ${state}` : 'A machine needs at least one state'"
              @click="emit('remove', state)"
            >
              Delete
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.state-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-height: 17rem;
  overflow: auto;
}

.state-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem 0.375rem 0.625rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.state-row:hover {
  border-color: var(--border-secondary);
}

.state-row.is-initial {
  background: var(--primary-soft);
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
}

.state-row.is-live {
  border-color: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--border-secondary);
}

.is-initial .dot {
  background: var(--primary);
}

.is-live .dot {
  background: var(--success);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    box-shadow: 0 0 0 0.35rem var(--success-soft);
  }
}

.state-label {
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary);
  background: none;
  padding: 0;
  min-width: 2.25rem;
}

.edit-field {
  max-width: 7.5rem;
  padding: 0.1875rem 0.375rem;
}

.state-tools {
  margin-left: auto;
  display: flex;
  gap: 0.125rem;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.state-row:hover .state-tools,
.state-row:focus-within .state-tools {
  opacity: 1;
}

@media (hover: none) {
  .state-tools {
    opacity: 1;
  }
}
</style>
