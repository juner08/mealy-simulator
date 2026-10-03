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

## Layout

```
src/
  App.vue                     shell, layout, theme, shortcuts
  style.css                   design tokens + shared primitives
  presets.js                  the worked examples
  composables/
    useMealyMachine.js        state/transition CRUD, validation, simulation
  lib/
    graph.js                  force layout, edge routing, edge labels, fitting
  components/                 one panel per concern
```

`lib/graph.js` is pure geometry with no Vue or DOM dependency, which is what
makes the layout testable in isolation.

## Tests

```
npm test          # 39 checks — simulation semantics, validation, layout maths
npm run test:ui   # 56 checks — drives a real headless browser over CDP
npm run test:layout
```

`test:ui` and `test:layout` need Microsoft Edge on Windows; they launch it
headless and assert against the live DOM (no overlapping nodes, edge labels do
not collide, the output tape agrees with the trace table, dragging and zooming
work, nothing is clipped at any width, no console errors).
