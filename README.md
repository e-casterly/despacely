# Despacely

A local-first floor planning app — create projects, draw walls and arrange furniture in 2D, and preview the result in 3D. Everything is stored in the browser (IndexedDB), with no backend.

> **🚧 Work in progress.** Despacely is an early-stage personal project, built as an example of clean architecture and a well-tested codebase. You can already draw a plan and walk through it in 3D; furniture is the next big piece. APIs and data shapes may still change.

## Status

- ✅ Project management — create, rename, duplicate, delete (persisted in IndexedDB)
- ✅ Editor foundation — scene document (walls as a node graph), debounced autosave, command-based undo/redo
- ✅ 2D plan — metric grid (10cm / 50cm / 1m tiers), pan & zoom
- ✅ Walls — chained drawing with mitred corners, snap guides (vertices, alignment, angles), length typed in while drawing
- ✅ Rooms — derived from the wall graph rather than stored: rectangle draw tool, live area labels, selection, whole-room drag, nested loops carved out as holes
- ✅ Doors & windows — cut into a wall as real gaps, drawn as plan symbols (swing arc, glazing lines), draggable along the wall
- ✅ Selection & inspector — pick a wall, vertex, room or opening; edit its numbers, or delete it
- ✅ 3D preview — Three.js: walls extruded with their openings (sill and lintel), room floors, orbit + WASD panning, camera remembered per project
- 🚧 Furniture — the domain model is in place, the placement tool is not

## Tech stack

Vue 3 (`<script setup>`) · TypeScript · Pinia · Vue Router · Dexie (IndexedDB) · Three.js · Tailwind CSS v4 · Vite · Vitest · Playwright.

## Architecture

The codebase is feature-sliced (`src/features/*`) with a strict layering inside the editor: a dependency-free **domain** layer (the scene model, geometry and operations — plain TypeScript, no Vue or Dexie) sits at the core, with persistence, state (Pinia) and rendering built around it. The 2D and 3D views are projections of one shared scene document. Reusable UI primitives live in `src/components/ui` (`Base*`), app-level singletons in `src/components/app` (`App*`).

Two rules keep the renderers thin. Geometry lives in pure, unit-tested modules rather than inside the canvas components, so the maths is assertable without a WebGL context or a pixel diff. And no renderer spells a colour of its own: every colour on the canvas comes from a CSS theme token in `src/style.css`, resolved through `features/editor/palette.ts`.

## Project setup

```sh
pnpm install
```

### Develop (hot-reload)

```sh
pnpm dev
```

### Type-check, compile and minify for production

```sh
pnpm build
```

### Unit tests ([Vitest](https://vitest.dev/))

```sh
pnpm test:unit
```

### End-to-end tests ([Playwright](https://playwright.dev))

```sh
# Install browsers for the first run
npx playwright install

pnpm test:e2e
```

### Lint ([ESLint](https://eslint.org/) + [oxlint](https://oxc.rs/))

```sh
pnpm lint
```

