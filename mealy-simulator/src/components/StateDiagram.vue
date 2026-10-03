<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STAGE_H,
  STAGE_W,
  autoLayout,
  bounds,
  nodeRadius,
  normalizeViewBox,
  routeEdges,
} from '../lib/graph.js'

const props = defineProps({
  states: { type: Array, required: true },
  transitions: { type: Array, required: true },
  initial: { type: String, required: true },
  activeState: { type: String, default: '' },
  activeTransitionId: { type: String, default: null },
  hasRun: { type: Boolean, default: false },
})

const ZOOM_MIN = 0.35
const ZOOM_MAX = 4

const svgRef = ref(null)
const positions = ref({})
const pinned = ref({})
const viewBox = ref({ x: 0, y: 0, w: STAGE_W, h: STAGE_H })
const showLabels = ref(true)

const dragNode = ref(null)
const dragOffset = ref({ x: 0, y: 0 })
const panStart = ref(null)

/* ---------------- geometry ---------------- */

const nodes = computed(() =>
  props.states.map((name) => {
    const p = positions.value[name] ?? { x: STAGE_W / 2, y: STAGE_H / 2 }
    return { name, x: p.x, y: p.y, r: nodeRadius(name) }
  }),
)

const edges = computed(() => routeEdges(positions.value, props.transitions))

/** The "enters here from nowhere" stub for the initial state. */
const entryStub = computed(() => {
  const target = nodes.value.find((n) => n.name === props.initial)
  if (!target) return null
  const centroid = nodes.value.reduce(
    (acc, n) => ({ x: acc.x + n.x / nodes.value.length, y: acc.y + n.y / nodes.value.length }),
    { x: 0, y: 0 },
  )
  let dx = target.x - centroid.x
  let dy = target.y - centroid.y
  const d = Math.hypot(dx, dy)
  if (d < 1) {
    dx = -0.7071
    dy = -0.7071
  } else {
    dx /= d
    dy /= d
  }
  const inner = target.r + 9
  const outer = target.r + 52
  return {
    x1: target.x + dx * inner,
    y1: target.y + dy * inner,
    x2: target.x + dx * outer,
    y2: target.y + dy * outer,
    id: `entry-${target.name}`,
  }
})

/* ---------------- layout lifecycle ---------------- */

function relayout() {
  const fresh = autoLayout(props.states, props.transitions)
  const next = {}
  for (const name of props.states) {
    next[name] = pinned.value[name] && positions.value[name]
      ? positions.value[name]
      : fresh[name]
  }
  positions.value = next
}

function fit() {
  if (!Object.keys(positions.value).length) {
    viewBox.value = { x: 0, y: 0, w: STAGE_W, h: STAGE_H }
    return
  }
  viewBox.value = normalizeViewBox(bounds(positions.value, 82))
}

// Only state-list changes reshuffle the graph; editing edges keeps the shape stable.
watch(() => props.states.join('\u0000'), () => {
  relayout()
  fit()
})

watch(() => props.transitions.length, () => {
  if (props.transitions.length === 1) {
    relayout()
    fit()
  }
})

onMounted(() => {
  relayout()
  fit()
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onUp)
})

/* ---------------- coordinate mapping ---------------- */

function toLocal(event) {
  const rect = svgRef.value.getBoundingClientRect()
  const vb = viewBox.value
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h)
  const offsetX = (rect.width - vb.w * scale) / 2
  const offsetY = (rect.height - vb.h * scale) / 2
  return {
    x: vb.x + (event.clientX - rect.left - offsetX) / scale,
    y: vb.y + (event.clientY - rect.top - offsetY) / scale,
  }
}

/* ---------------- interaction ---------------- */

function onNodeDown(event, node) {
  event.stopPropagation()
  const p = toLocal(event)
  dragNode.value = node.name
  dragOffset.value = { x: p.x - node.x, y: p.y - node.y }
}

function onBackgroundDown(event) {
  panStart.value = { local: toLocal(event), vb: { ...viewBox.value } }
}

function onMove(event) {
  if (dragNode.value) {
    const p = toLocal(event)
    const name = dragNode.value
    const offset = dragOffset.value
    positions.value = {
      ...positions.value,
      [name]: { x: p.x - offset.x, y: p.y - offset.y },
    }
    return
  }
  if (panStart.value) {
    const p = toLocal(event)
    const start = panStart.value
    viewBox.value = normalizeViewBox({
      ...start.vb,
      x: start.vb.x - (p.x - start.local.x),
      y: start.vb.y - (p.y - start.local.y),
    })
  }
}

function onUp() {
  if (dragNode.value) pinned.value = { ...pinned.value, [dragNode.value]: true }
  dragNode.value = null
  panStart.value = null
}

function onWheel(event) {
  event.preventDefault()
  const anchor = toLocal(event)
  const vb = viewBox.value
  const factor = event.deltaY < 0 ? 0.88 : 1.14
  const w = Math.min(Math.max(vb.w * factor, vb.w / ZOOM_MAX), vb.w / ZOOM_MIN)
  const realFactor = w / vb.w
  viewBox.value = normalizeViewBox({
    x: anchor.x - (anchor.x - vb.x) * realFactor,
    y: anchor.y - (anchor.y - vb.y) * realFactor,
    w,
    h: vb.h * realFactor,
  })
}

function zoomBy(factor) {
  const vb = viewBox.value
  const cx = vb.x + vb.w / 2
  const cy = vb.y + vb.h / 2
  const w = Math.min(Math.max(vb.w * factor, vb.w / ZOOM_MAX), vb.w / ZOOM_MIN)
  const realFactor = w / vb.w
  viewBox.value = normalizeViewBox({
    x: cx - (cx - vb.x) * realFactor,
    y: cy - (cy - vb.y) * realFactor,
    w,
    h: vb.h * realFactor,
  })
}

function reshuffle() {
  pinned.value = {}
  relayout()
  fit()
}

const zoomPercent = computed(() => Math.round((STAGE_W / viewBox.value.w) * 100))
</script>

<template>
  <section class="card diagram-card">
    <header class="card-header">
      <h2 class="card-title">State diagram</h2>
      <span class="spacer" />
      <div class="diagram-tools">
        <button
          class="btn btn-sm btn-ghost"
          :class="{ 'is-on': showLabels }"
          title="Toggle input/output labels"
          @click="showLabels = !showLabels"
        >
          Labels
        </button>
        <button class="btn btn-sm btn-ghost" title="Recompute an automatic layout" @click="reshuffle">
          Relayout
        </button>
        <span class="divider-v" />
        <button class="btn btn-sm btn-ghost" title="Zoom out" @click="zoomBy(1.2)">−</button>
        <span class="zoom-readout">{{ zoomPercent }}%</span>
        <button class="btn btn-sm btn-ghost" title="Zoom in" @click="zoomBy(0.82)">+</button>
        <button class="btn btn-sm btn-ghost" title="Fit the diagram to the view" @click="fit">Fit</button>
      </div>
    </header>

    <div class="stage" :class="{ 'is-grabbing': panStart || dragNode }">
      <svg
        ref="svgRef"
        class="canvas"
        :viewBox="`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mealy machine state diagram"
        @pointerdown="onBackgroundDown"
        @wheel="onWheel"
      >
        <defs>
          <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" class="grid-line" fill="none" />
          </pattern>
          <marker id="tip" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" class="tip" />
          </marker>
          <marker id="tip-active" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" class="tip tip-active" />
          </marker>
        </defs>

        <rect class="grid-bg" x="-10000" y="-10000" width="20000" height="20000" />

        <g class="edges">
          <g
            v-for="edge in edges"
            :key="edge.id"
            class="edge"
            :class="{ 'is-active': hasRun && edge.id === activeTransitionId, 'is-loop': edge.loop }"
          >
            <path class="edge-hit" :d="edge.d" />
            <path class="edge-line" :d="edge.d" />
            <template v-if="showLabels">
              <text
                class="edge-label"
                :x="edge.label.x"
                :y="edge.label.y"
                text-anchor="middle"
                dominant-baseline="central"
              >
                <tspan>{{ edge.transition.input }}</tspan>
                <tspan class="sep"> / </tspan>
                <tspan class="out">{{ edge.transition.output }}</tspan>
              </text>
            </template>
          </g>
        </g>

        <g v-if="entryStub" class="entry">
          <path
            class="entry-line"
            :d="`M ${entryStub.x2} ${entryStub.y2} L ${entryStub.x1} ${entryStub.y1}`"
          />
        </g>

        <g class="nodes">
          <g
            v-for="node in nodes"
            :key="node.name"
            class="node"
            :class="{
              'is-initial': node.name === initial,
              'is-live': hasRun && node.name === activeState,
            }"
            :transform="`translate(${node.x} ${node.y})`"
            @pointerdown="onNodeDown($event, node)"
          >
            <circle v-if="node.name === initial" class="ring" :r="node.r + 7" />
            <circle v-if="hasRun && node.name === activeState" class="halo" :r="node.r + 15" />
            <circle class="body" :r="node.r" />
            <text
              class="label"
              text-anchor="middle"
              dominant-baseline="central"
              :style="{ fontSize: `${Math.min(19, Math.max(13, node.r * 0.62))}px` }"
            >
              {{ node.name }}
            </text>
          </g>
        </g>
      </svg>

      <div v-if="!states.length" class="overlay">
        <p>No states yet</p>
        <span>Add a state to start drawing the machine.</span>
      </div>

      <p v-if="states.length" class="hint">
        Drag a state to move it · drag the canvas to pan · scroll to zoom
      </p>
    </div>
  </section>
</template>

<style scoped>
.diagram-card {
  overflow: hidden;
}

.diagram-tools {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.diagram-tools .btn.is-on {
  background: var(--primary-soft);
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  color: var(--primary);
}

.zoom-readout {
  min-width: 2.75rem;
  text-align: center;
  font-family: var(--mono);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.stage {
  position: relative;
  aspect-ratio: 16 / 10;
  min-height: 22rem;
  background: var(--bg-inset);
  touch-action: none;
}

.stage.is-grabbing {
  cursor: grabbing;
}

.stage.is-grabbing .canvas,
.stage.is-grabbing .node {
  cursor: grabbing;
}

.canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.grid-bg {
  fill: url(#grid);
}

.grid-line {
  stroke: var(--border-primary);
  stroke-width: 1;
  opacity: 0.55;
}

/* edges */

.edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}

.edge-line {
  fill: none;
  stroke: var(--border-secondary);
  stroke-width: 2;
  stroke-linecap: round;
  marker-end: url(#tip);
  transition: stroke 0.2s ease, stroke-width 0.2s ease;
}

.tip {
  fill: var(--border-secondary);
}

.tip-active {
  fill: var(--accent);
}

.edge.is-active .edge-line {
  stroke: var(--accent);
  stroke-width: 3.25;
  marker-end: url(#tip-active);
  filter: drop-shadow(0 0 6px var(--accent-soft));
  stroke-dasharray: 10 7;
  animation: flow 0.65s linear infinite;
}

@keyframes flow {
  to {
    stroke-dashoffset: -17;
  }
}

.edge-label {
  fill: var(--text-secondary);
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--bg-inset);
  stroke-width: 5px;
  stroke-linejoin: round;
  pointer-events: none;
}

.edge-label .sep {
  fill: var(--text-tertiary);
  font-weight: 400;
}

.edge-label .out {
  fill: var(--accent);
}

.edge.is-active .edge-label {
  fill: var(--accent);
  stroke: var(--bg-inset);
}

/* initial-state entry stub */

.entry-line {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2.25;
  stroke-linecap: round;
  marker-end: url(#tip-active);
  opacity: 0.85;
}

/* nodes */

.node {
  cursor: grab;
}

.ring {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0.75;
}

.halo {
  fill: none;
  stroke: var(--success);
  stroke-width: 2;
  opacity: 0.55;
  animation: breathe 1.8s ease-in-out infinite;
}

@keyframes breathe {
  50% {
    opacity: 0.18;
  }
}

.body {
  fill: var(--bg-secondary);
  stroke: var(--text-tertiary);
  stroke-width: 2.25;
  transition: stroke 0.2s ease, fill 0.2s ease;
}

.node:hover .body {
  stroke: var(--primary);
}

.node.is-initial .body {
  stroke: var(--primary);
  fill: var(--primary-soft);
}

.node.is-live .body {
  stroke: var(--success);
  fill: var(--success-soft);
}

.label {
  fill: var(--text-primary);
  font-family: var(--mono);
  font-weight: 700;
  pointer-events: none;
  user-select: none;
}

.node.is-initial .label {
  fill: var(--primary);
}

/* overlay */

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.875rem;
  pointer-events: none;
}

.overlay p {
  font-weight: 700;
  color: var(--text-secondary);
}

.overlay span {
  font-size: 0.75rem;
}

.hint {
  position: absolute;
  left: 50%;
  bottom: 0.625rem;
  transform: translateX(-50%);
  padding: 0.25rem 0.625rem;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
  backdrop-filter: blur(6px);
  border: 1px solid var(--border-primary);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.85;
}

@media (max-width: 640px) {
  .stage {
    aspect-ratio: 4 / 3;
    min-height: 18rem;
  }

  .hint {
    display: none;
  }
}
</style>
