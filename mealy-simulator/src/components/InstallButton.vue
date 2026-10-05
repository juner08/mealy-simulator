<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { usePwa } from '../pwa.js'

const emit = defineEmits(['dismissed'])

const { canInstall, promptInstall, showIosHelp, closeIosHelp } = usePwa()

const root = ref(null)

async function onClick() {
  let outcome = 'unavailable'
  try {
    outcome = await promptInstall()
  } catch {
    // The browser refused the prompt — leave the app exactly as it was.
    return
  }
  if (outcome === 'dismissed') {
    emit('dismissed', 'Install dismissed — you can add it later from the browser menu.')
  }
}

function onDocPointer(event) {
  if (showIosHelp.value && root.value && !root.value.contains(event.target)) closeIosHelp()
}

function onKeydown(event) {
  if (event.key === 'Escape' && showIosHelp.value) closeIosHelp()
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
  <div v-if="canInstall" ref="root" class="install">
    <button
      class="btn btn-ghost"
      title="Install Mealy Studio as an app"
      aria-label="Install Mealy Studio as an app"
      :aria-expanded="showIosHelp"
      @click="onClick"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <span class="label-hide">Install</span>
    </button>

    <Transition name="pop">
      <div
        v-if="showIosHelp"
        class="install-sheet"
        role="dialog"
        aria-label="How to install Mealy Studio on this device"
      >
        <p class="install-head">Add Mealy Studio to your Home Screen</p>
        <ol class="install-steps">
          <li>Tap the <strong>Share</strong> button in the browser toolbar.</li>
          <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. The app then opens like a native one.</li>
        </ol>
        <button class="install-close" @click="closeIosHelp">Got it</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.install {
  position: relative;
}

.install-sheet {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 40;
  width: min(20rem, calc(100vw - 2rem));
  padding: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.install-head {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.install-steps {
  margin: 0;
  padding-left: 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.install-steps strong {
  color: var(--text-primary);
}

.install-close {
  align-self: flex-start;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
}

.install-close:hover {
  background: var(--bg-inset);
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
