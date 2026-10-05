# Mealy Machine Studio

An interactive builder and simulator for **Mealy finite-state machines** — the
kind where the output is produced on every transition rather than attached to a
state.

```
npm install
npm run dev      # http://localhost:5173
```

## What it does

- **Build** states and the transition function `δ` through forms, with
  determinism enforced as you type (a second `δ(q, a)` for the same pair is
  rejected).
- **Look** at an automatically laid out state diagram. Drag states to arrange
  them, pan and zoom the canvas, toggle the input/output labels.
- **Run** an input string and step through it one symbol at a time, or play the
  run back at four speeds. The live state and the transition just taken are
  highlighted on the diagram.
- **Check** the machine formally: completeness over its own alphabet,
  determinism, unreachable states, dead states, plus a completeness percentage.
- **Keep** your work — it is saved to `localStorage` on every change, and can be
  exported to or imported from JSON.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Run the simulation |
| `Space` | Play / pause the run |
| `←` `→` | Step backward / forward |
| Click a trace row | Jump to that step |

## Worked examples

Six machines ship in the **Examples** menu, each with a sample input:
sequence detector for `101` (handles overlapping matches), a modulo-4 counter,
"ends in 11", an up/down counter over `{u, d, n}`, a traffic light, and a
two-state toggle.

## Installable app (PWA)

The production build is an installable, offline-capable app. There is nothing
to configure and no plugin to add — `npm run build` emits everything:

```
dist/
  manifest.webmanifest      name, icons, theme colour, standalone display
  sw.js                     generated: precache list + content-hashed version
  icons/                    192, 512, maskable 512, apple-touch 180
```

- **Windows / Android** — an **Install** button appears in the header once the
  browser decides the app is installable; the browser's own install UI works
  too. **iPhone / iPad** — the button opens a short *Add to Home Screen*
  sheet, because Safari has no install prompt.
- **Offline** — the whole app is precached, so it cold-starts and simulates
  with no connection. A chip appears while you are offline.
- **Your data** — the machine lives in `localStorage` and the service worker
  never reads, writes, syncs or clears it. It survives offline sessions,
  updates and reconnects untouched. Nothing user-specific is ever cached: only
  same-origin `GET`s for this app's own static files.
- **Updates** — the cache is named after a hash of the deployed files, so a
  new deploy always produces a new cache and the old one is deleted. The app
  re-checks for a new build whenever you come back to the tab, which is enough
  to pick up a deploy behind GitHub Pages' 10-minute CDN cache. A banner then
  offers **Reload**; "Later" keeps the new build waiting for the next launch.

```
npm run build       # required — the worker only exists in a production build
npm run preview     # then install from the preview URL
npm run test:pwa    # 76 checks — install, offline cold start, update cycle
```

The dev server never registers a worker, so hot reload is never shadowed by a
cached shell. `test:pwa`, `test:ui` and `test:layout` need Microsoft Edge on
Windows.

## Layout

```
src/
  App.vue                     shell, layout, theme, shortcuts
  style.css                   design tokens + shared primitives
  pwa.js                      worker registration, install prompt, update banner
  sw-template.js              service worker source (build-injected)
  presets.js                  the worked examples
  composables/
    useMealyMachine.js        state/transition CRUD, validation, simulation
  lib/
    graph.js                  force layout, edge routing, edge labels, fitting
  components/                 one panel per concern

pwa-build.mjs                 writes dist/sw.js: precache list + build hash
```

`lib/graph.js` is pure geometry with no Vue or DOM dependency, which is what
makes the layout testable in isolation.

## Tests

```
npm test          # 39 checks — simulation semantics, validation, layout maths
npm run test:ui   # 56 checks — drives a real headless browser over CDP
npm run test:layout
npm run test:pwa  # 76 checks — install, offline cold start, update cycle
```

`test:ui`, `test:layout` and `test:pwa` need Microsoft Edge on Windows; they
launch it headless and assert against the live DOM (no overlapping nodes, edge
labels do not collide, the output tape agrees with the trace table, dragging
and zooming work, nothing is clipped at any width, no console errors, and for
`test:pwa` that the app installs, cold-starts offline, keeps local data and
adopts a new build). `test:ui` wants `npm run dev` on :5173; `test:layout` wants `npm run preview` on
:4173 with a fresh build. `test:pwa` needs only a fresh `npm run build` — it
serves `dist/` on :4173 itself.
