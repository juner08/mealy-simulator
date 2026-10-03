/**
 * Pure geometry helpers for rendering a Mealy machine state diagram in SVG.
 * No Vue, no DOM — keeps the layout maths testable and reusable.
 */

export const STAGE_W = 960
export const STAGE_H = 600
export const PADDING = 88
export const CURVE_GAP = 34

const round = (n) => Math.round(n * 100) / 100

/** Node radius grows with the label so long state names stay legible. */
export function nodeRadius(name) {
  const len = String(name).length
  return Math.min(Math.max(29, 22 + len * 4.4), 58)
}

/**
 * Force-directed placement (repulsion + spring attraction + weak gravity),
 * seeded on a circle then scaled to fill the stage.
 */
export function autoLayout(names, edges, stageW = STAGE_W, stageH = STAGE_H) {
  const n = names.length
  if (!n) return {}
  if (n === 1) return { [names[0]]: { x: stageW / 2, y: stageH / 2 } }

  const cx = stageW / 2
  const cy = stageH / 2
  const seedR = Math.min(stageW, stageH) * 0.36

  const nodes = names.map((name, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    return { name, x: cx + Math.cos(angle) * seedR, y: cy + Math.sin(angle) * seedR }
  })

  const indexOf = new Map(nodes.map((nd, i) => [nd.name, i]))
  const links = []
  const seenLink = new Set()
  for (const e of edges) {
    const a = indexOf.get(e.from)
    const b = indexOf.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seenLink.has(key)) continue
    seenLink.add(key)
    links.push([a, b])
  }

  const k = Math.sqrt((stageW * stageH) / n) * 0.6
  let temperature = Math.min(stageW, stageH) / 7

  for (let step = 0; step < 420; step += 1) {
    for (const nd of nodes) {
      nd.dx = 0
      nd.dy = 0
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 0.5) {
          dx = (i + 1) * 0.6
          dy = (j + 1) * 0.6
          d = Math.hypot(dx, dy)
        }
        const f = (k * k) / d
        const ux = (dx / d) * f
        const uy = (dy / d) * f
        a.dx += ux
        a.dy += uy
        b.dx -= ux
        b.dy -= uy
      }
    }

    for (const [i, j] of links) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.max(Math.hypot(dx, dy), 0.5)
      const f = (d * d) / k
      const ux = (dx / d) * f
      const uy = (dy / d) * f
      a.dx -= ux
      a.dy -= uy
      b.dx += ux
      b.dy += uy
    }

    for (const nd of nodes) {
      nd.dx += (cx - nd.x) * 0.014
      nd.dy += (cy - nd.y) * 0.014
    }

    for (const nd of nodes) {
      const d = Math.max(Math.hypot(nd.dx, nd.dy), 0.001)
      const limited = Math.min(d, temperature)
      nd.x += (nd.dx / d) * limited
      nd.y += (nd.dy / d) * limited
    }

    temperature *= 0.976
  }

  const xs = nodes.map((nd) => nd.x)
  const ys = nodes.map((nd) => nd.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)

  const scale = Math.min(
    (stageW - PADDING * 2) / spanX,
    (stageH - PADDING * 2) / spanY,
  )

  const offsetX = (stageW - spanX * scale) / 2
  const offsetY = (stageH - spanY * scale) / 2

  const out = {}
  for (const nd of nodes) {
    out[nd.name] = {
      x: round(offsetX + (nd.x - minX) * scale),
      y: round(offsetY + (nd.y - minY) * scale),
    }
  }
  return out
}

/** Point on a node's circle, along the direction of `toward`, capped inside. */
function edgeAnchor(center, toward, radius) {
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return { x: center.x, y: center.y }
  const dist = Math.min(radius, d * 0.85)
  return { x: center.x + (dx / d) * dist, y: center.y + (dy / d) * dist }
}

/** Quadratic bezier midpoint. */
function quadMid(p0, c, p2) {
  return {
    x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p2.x,
    y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p2.y,
  }
}

/** Cubic bezier midpoint. */
function cubicMid(p0, c1, c2, p3) {
  return {
    x: (p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8,
    y: (p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8,
  }
}

/**
 * Loop that leaves the top of a node and returns just clockwise of it.
 * `flip` mirrors the loop to the bottom for nodes sitting on the stage edge.
 */
export function selfLoopPath(center, radius, flip = false) {
  const sign = flip ? -1 : 1
  const a1 = sign * -Math.PI * 0.78
  const a2 = sign * -Math.PI * 0.22

  const p0 = {
    x: center.x + Math.cos(a1) * radius,
    y: center.y + Math.sin(a1) * radius,
  }
  const p3 = {
    x: center.x + Math.cos(a2) * radius,
    y: center.y + Math.sin(a2) * radius,
  }
  const reach = radius * 2.15
  const c1 = {
    x: center.x + Math.cos(a1) * reach,
    y: center.y + Math.sin(a1) * reach,
  }
  const c2 = {
    x: center.x + Math.cos(a2) * reach,
    y: center.y + Math.sin(a2) * reach,
  }

  return {
    d: `M ${round(p0.x)} ${round(p0.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(p3.x)} ${round(p3.y)}`,
    label: cubicMid(p0, c1, c2, p3),
    endAngle: Math.atan2(p3.y - c2.y, p3.x - c2.x),
  }
}

/**
 * Turns the transition list into drawable edges.
 * Parallel edges fan out and A→B / B→A pairs curve to opposite sides.
 */
export function routeEdges(positions, transitions) {
  const groups = new Map()

  for (const t of transitions) {
    if (t.from === t.to) continue
    const from = positions[t.from]
    const to = positions[t.to]
    if (!from || !to) continue

    const key = [t.from, t.to].sort().join('\u0000')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const edges = []

  for (const list of groups.values()) {
    const [a, b] = [list[0].from, list[0].to].sort()
    const forward = list.filter((t) => t.from === a)
    const backward = list.filter((t) => t.from === b)
    const single = list.length === 1

    // The perpendicular is derived from the canonical a -> b direction, never
    // from the edge's own direction — otherwise A->B and B->A would flip it and
    // both bow to the same side.
    const aPos = positions[a]
    const bPos = positions[b]
    const spanX = bPos.x - aPos.x
    const spanY = bPos.y - aPos.y
    const span = Math.max(Math.hypot(spanX, spanY), 0.001)
    const perpX = -spanY / span
    const perpY = spanX / span

    const place = (t, curve) => {
      const from = positions[t.from]
      const to = positions[t.to]
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      const control = { x: mid.x + perpX * curve, y: mid.y + perpY * curve }

      const rFrom = nodeRadius(t.from)
      const rTo = nodeRadius(t.to)
      const start = edgeAnchor(from, control, rFrom)
      const end = edgeAnchor(to, control, rTo)

      edges.push({
        id: t.id,
        transition: t,
        d: `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
        label: quadMid(start, control, end),
        curved: Math.abs(curve) > 0.5,
        // angle of the segment entering the target node, for arrow orientation
        endAngle: Math.atan2(end.y - control.y, end.x - control.x),
      })
    }

    if (single) {
      place(list[0], 0)
    } else {
      forward.forEach((t, i) => place(t, -(i + 1) * CURVE_GAP))
      backward.forEach((t, i) => place(t, (i + 1) * CURVE_GAP))
    }
  }

  for (const t of transitions) {
    if (t.from !== t.to) continue
    const center = positions[t.from]
    if (!center) continue
    const radius = nodeRadius(t.from)
    const flip = center.y < STAGE_H * 0.22
    const loop = selfLoopPath(center, radius, flip)
    edges.push({
      id: t.id,
      transition: t,
      d: loop.d,
      label: loop.label,
      curved: true,
      loop: true,
      endAngle: loop.endAngle,
    })
  }

  return edges
}

/** Bounding box of all nodes plus a margin — used to fit the viewBox. */
export function bounds(positions, margin = 70) {
  const list = Object.values(positions)
  if (!list.length) return { x: 0, y: 0, w: STAGE_W, h: STAGE_H }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of list) {
    const r = 0
    minX = Math.min(minX, p.x - r)
    maxX = Math.max(maxX, p.x + r)
    minY = Math.min(minY, p.y - r)
    maxY = Math.max(maxY, p.y + r)
  }
  return {
    x: round(minX - margin),
    y: round(minY - margin),
    w: round(maxX - minX + margin * 2),
    h: round(maxY - minY + margin * 2),
  }
}

/** Clamp a viewBox so it can never collapse or flip. */
export function normalizeViewBox(vb, minW = 180, minH = 120) {
  const w = Math.max(vb.w, minW)
  const h = Math.max(vb.h, minH)
  return { x: round(vb.x), y: round(vb.y), w: round(w), h: round(h) }
}
