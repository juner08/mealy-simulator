import { computed, readonly, ref } from 'vue'

/**
 * Progressive Web App glue for Mealy Machine Studio.
 *
 * Everything in here is additive and defensive: no service worker, no
 * `beforeinstallprompt` event or no network simply means the app behaves
 * exactly as it did before. It never touches the machine in localStorage.
 */

const OFFLINE_READY_KEY = 'mealy-simulator:offline-ready'

/** 'hidden' | 'ready' (native prompt available) | 'ios' (help sheet) | 'installed' */
const installState = ref('hidden')
const updateReady = ref(false)
const offlineReady = ref(false)
const showIosHelp = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

let registration = null

// A plain binding, not a ref: this is a one-shot browser event, not state.
let deferredPrompt = null
let waitingWorker = null
let started = false
let reloading = false
let userRequestedUpdate = false

const standaloneQuery =
  typeof window !== 'undefined'
    ? window.matchMedia?.('(display-mode: standalone), (display-mode: window-controls-overlay)')
    : null

const isStandalone = () =>
  Boolean(standaloneQuery?.matches) || Boolean(navigator.standalone)

/** iPadOS 13+ reports a desktop UA, so the touch-point count is the tell. */
function isAppleMobile() {
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}

function initialInstallState() {
  if (isStandalone()) return 'installed'
  // Safari on iOS has no beforeinstallprompt; Add to Home Screen is the only
  // route, so offer the instruction sheet there.
  if (isAppleMobile()) return 'ios'
  return 'hidden'
}

/* ---------------- service worker ---------------- */

function currentVersion(worker) {
  if (!worker) return Promise.resolve('')
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(''), 1000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data?.version ?? '')
    }
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2])
  })
}

function watchWorker(worker) {
  if (!worker) return
  worker.addEventListener('statechange', () => {
    // A worker that reaches "installed" while another one is in control is a
    // pending update, not a fresh install. Leave it waiting for the user.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waitingWorker = worker
      updateReady.value = true
    }
  })
}

async function announceOfflineReady() {
  const version = await currentVersion(registration?.active)
  if (!version) return
  try {
    if (localStorage.getItem(OFFLINE_READY_KEY) === version) return
    localStorage.setItem(OFFLINE_READY_KEY, version)
  } catch {
    return // storage blocked — offline caching still works
  }
  offlineReady.value = true
}

async function register() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  if (import.meta.env.DEV) return // a cached shell would fight hot reload

  try {
    // Relative to the page, so this works at a domain root and under a
    // project path like /mealy-simulator/ alike.
    registration = await navigator.serviceWorker.register('sw.js', { scope: './' })
  } catch {
    return // file:// previews, blocked SWs, quota errors — app still works
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for an update the user accepted. Taking over on first
    // install also fires this, and that must not bounce the page.
    if (!userRequestedUpdate || reloading) return
    reloading = true
    window.location.reload()
  })

  if (registration.waiting && navigator.serviceWorker.controller) {
    waitingWorker = registration.waiting
    updateReady.value = true
  } else if (registration.active) {
    announceOfflineReady()
  }

  watchWorker(registration.installing)
  registration.addEventListener('updatefound', () => watchWorker(registration.installing))
}

/** Ask the browser to look for a newer build. Cheap and throttled by the UA. */
function checkForUpdate() {
  registration?.update().catch(() => {})
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  // Coming back from Safari's share sheet is exactly when someone is reading
  // the install steps, so the sheet stays put.
  checkForUpdate()
}

/* ---------------- install ---------------- */

function onBeforeInstallPrompt(event) {
  // Suppress the browser's own UI even when we will not offer the button.
  event.preventDefault()
  if (isStandalone()) return
  deferredPrompt = event
  installState.value = 'ready'
}

function onAppInstalled() {
  deferredPrompt = null
  installState.value = 'installed'
  showIosHelp.value = false
}

async function promptInstall() {
  if (installState.value === 'ios') {
    showIosHelp.value = true
    return 'ios-help'
  }
  const event = deferredPrompt
  if (!event) return 'unavailable'

  deferredPrompt = null
  installState.value = 'hidden'
  try {
    event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') {
      installState.value = 'installed'
    } else {
      // The browser will not offer it again this session.
      installState.value = 'hidden'
    }
    return outcome
  } catch {
    // A prompt() without a user gesture, or a browser that withdraws the
    // event, must never surface as an error in the app.
    installState.value = 'hidden'
    return 'unavailable'
  }
}

function closeIosHelp() {
  showIosHelp.value = false
}

/** Hide the prompt but keep the build waiting — it is adopted on next launch. */
function dismissUpdate() {
  updateReady.value = false
}

function onStandaloneChange() {
  if (!isStandalone()) return
  installState.value = 'installed'
  showIosHelp.value = false
}

/* ---------------- lifecycle ---------------- */

export function registerPwa() {
  if (started || typeof window === 'undefined') return
  started = true

  installState.value = initialInstallState()
  online.value = navigator.onLine

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
  window.addEventListener('online', () => {
    online.value = true
    checkForUpdate()
  })
  window.addEventListener('offline', () => {
    online.value = false
  })
  document.addEventListener('visibilitychange', onVisibilityChange)
  standaloneQuery?.addEventListener?.('change', onStandaloneChange)

  register()
}

const canInstall = computed(
  () => !isStandalone() && (installState.value === 'ready' || installState.value === 'ios'),
)
const isInstalled = computed(() => installState.value === 'installed' || isStandalone())

export function usePwa() {
  registerPwa()
  return {
    installState: readonly(installState),
    updateReady: readonly(updateReady),
    offlineReady: readonly(offlineReady),
    showIosHelp: readonly(showIosHelp),
    online: readonly(online),
    canInstall,
    isInstalled,
    promptInstall,
    closeIosHelp,
    dismissUpdate,
    applyUpdate,
  }
}

/** Adopt the waiting build now, then let the controllerchange handler reload. */
function applyUpdate() {
  if (!waitingWorker) {
    checkForUpdate()
    return
  }
  userRequestedUpdate = true
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
}
