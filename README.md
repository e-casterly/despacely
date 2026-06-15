# Despacely

A local-first floor planning app — create projects, draw walls and arrange furniture in 2D, and preview the result in 3D. Everything is stored in the browser (IndexedDB), with no backend.

> **🚧 Work in progress.** Despacely is an early-stage personal project, built as an example of clean architecture and a well-tested codebase. The project CRUD is in place; the editor is being built out milestone by milestone. APIs and data shapes may still change.

## Status

- ✅ Project management — create, rename, duplicate, delete (persisted in IndexedDB)
- ✅ Editor foundation — scene document model, autosave, undo/redo groundwork
- ✅ 2D canvas — grid, pan & zoom
- 🚧 Drawing tools — walls and furniture placement
- 🚧 3D preview (Three.js)

## Tech stack

Vue 3 (`<script setup>`) · TypeScript · Pinia · Vue Router · Dexie (IndexedDB) · Tailwind CSS v4 · Vite · Vitest · Playwright.

## Architecture

The codebase is feature-sliced (`src/features/*`) with a strict layering inside the editor: a dependency-free **domain** layer (the scene model, geometry and operations — plain TypeScript, no Vue or Dexie) sits at the core, with persistence, state (Pinia) and rendering built around it. The 2D and 3D views are projections of one shared scene document. Reusable UI primitives live in `src/components/ui` (`Base*`), app-level singletons in `src/components/app` (`App*`).

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

