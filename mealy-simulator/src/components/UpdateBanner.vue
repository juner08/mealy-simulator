<script setup>
import { usePwa } from '../pwa.js'

const { updateReady, applyUpdate, dismissUpdate, online } = usePwa()
</script>

<template>
  <Transition name="rise">
    <div v-if="updateReady" class="update-bar" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
      </svg>
      <span class="update-text">A new version of Mealy Studio is ready.</span>
      <button class="btn btn-primary btn-sm" @click="applyUpdate">Reload</button>
      <button class="btn btn-ghost btn-sm" @click="dismissUpdate">Later</button>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="!online" class="offline-chip" role="status" aria-live="polite">
      Offline — your work is saved on this device
    </div>
  </Transition>
</template>

<style scoped>
.update-bar {
  position: fixed;
  left: 50%;
  bottom: max(1rem, env(safe-area-inset-bottom));
  z-index: 60;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: max-content;
  max-width: calc(100vw - 2rem);
  padding: 0.5rem 0.5rem 0.5rem 0.875rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-xl);
  color: var(--text-secondary);
}

.update-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.offline-chip {
  position: fixed;
  left: 50%;
  top: max(1rem, env(safe-area-inset-top));
  z-index: 60;
  transform: translateX(-50%);
  padding: 0.4375rem 0.875rem;
  background: var(--warning-soft);
  border: 1px solid var(--warning);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--warning);
  box-shadow: var(--shadow-md);
  max-width: calc(100vw - 2rem);
  text-align: center;
}

.rise-enter-active,
.rise-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translate(-50%, 0.75rem);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .update-bar {
    gap: 0.4375rem;
    padding: 0.4375rem 0.4375rem 0.4375rem 0.75rem;
  }

  .update-text {
    font-size: 0.75rem;
  }
}
</style>
