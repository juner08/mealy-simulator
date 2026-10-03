<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PRESETS } from '../presets.js'

const props = defineProps({
  theme: { type: String, required: true },
  activePreset: { type: String, default: '' },
})

const emit = defineEmits(['toggle-theme', 'load-preset', 'new-machine'])

const menuOpen = ref(false)
const menuRoot = ref(null)
const highlighted = ref(-1)

function pick(preset) {
  emit('load-preset', preset)
  close()
}

function move(delta) {
  const count = PRESETS.length
  highlighted.value = (highlighted.value + delta + count) % count
}

function choose() {
  if (highlighted.value < 0) return
  pick(PRESETS[highlighted.value])
}

function onKeydown(event) {
  if (!menuOpen.value || event.key !== 'Escape') return
  close()
}

function close() {
  menuOpen.value = false
  highlighted.value = -1
}

function onDocPointer(event) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(event.target)) close()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="menuRoot" class="presets">
    <button
      class="btn btn-primary"
      :aria-expanded="menuOpen"
      aria-haspopup="listbox"
      @click="menuOpen = !menuOpen"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6a3 3 0 0 1 3-3h4l2 2h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3Z" />
      </svg>
      <span class="label-hide">Examples</span>
    </button>

    <Transition name="pop">
      <div v-if="menuOpen" class="preset-menu" role="listbox" tabindex="-1" @keydown.up.prevent="move(-1)" @keydown.down.prevent="move(1)" @keydown.enter.prevent="choose">
        <p class="preset-head">Load a worked example</p>
        <button
          v-for="(preset, i) in PRESETS"
          :key="preset.id"
          class="preset-item"
          :class="{ 'is-active': i === highlighted, 'is-current': preset.id === props.activePreset }"
          role="option"
          :aria-selected="preset.id === props.activePreset"
          :tabindex="-1"
          @mouseenter="highlighted = i"
          @click="pick(preset)"
        >
          <span class="preset-row">
            <span class="preset-name">{{ preset.name }}</span>
            <code class="preset-sample">{{ preset.sample }}</code>
          </span>
          <span class="preset-blurb">{{ preset.blurb }}</span>
        </button>
        <button class="preset-new" @click="emit('new-machine'); close()">
          Start from a blank machine
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.presets {
  position: relative;
}

.preset-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 40;
  width: 22rem;
  padding: 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.preset-head {
  padding: 0.5rem 0.625rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.preset-item {
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.preset-item.is-active {
  background: var(--primary-soft);
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.preset-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.preset-item.is-current .preset-name {
  color: var(--primary);
}

.preset-sample {
  margin-left: auto;
  padding: 0.0625rem 0.3125rem;
  font-family: var(--mono);
  font-size: 0.6875rem;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
}

.preset-blurb {
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-tertiary);
}

.preset-new {
  margin-top: 0.125rem;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-top: 1px solid var(--border-primary);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background: transparent;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.preset-new:hover {
  color: var(--text-primary);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
  transform-origin: top right;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-0.375rem) scale(0.97);
}
</style>
