<script setup>
defineProps({
  notifications: { type: Array, required: true },
})

const emit = defineEmits(['dismiss'])

const ICON = {
  error: 'M12 8v5M12 16.5v.5M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  success: 'm5 13 4 4L19 7',
  info: 'M12 8h.01M11 12h1v5h1',
}
</script>

<template>
  <div v-if="notifications.length" class="alert-stack" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="note in notifications"
        :key="note.id"
        class="alert"
        :class="`alert-${note.level}`"
      >
        <svg
          class="alert-icon"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.1"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.5" />
          <path :d="ICON[note.level] ?? ICON.info" />
        </svg>
        <span class="alert-text">{{ note.message }}</span>
        <button class="alert-close" title="Dismiss" @click="emit('dismiss', note.id)">
          ✕
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.alert {
  align-items: center;
}

.alert-icon {
  flex-shrink: 0;
}

.alert-text {
  flex: 1;
  min-width: 0;
}

.alert-close {
  flex-shrink: 0;
  padding: 0 0.25rem;
  border: 0;
  background: none;
  font-size: 0.75rem;
  line-height: 1;
  color: currentcolor;
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.alert-close:hover {
  opacity: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem) scale(0.98);
}
</style>
