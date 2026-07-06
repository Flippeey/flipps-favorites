# Naming + Code Conventions

## File Naming

- React components: `PascalCase.tsx` (`Tile.tsx`, `HeroSearch.tsx`). Multi-export files are fine (`views.tsx`, `Tile.tsx` export several components).
- Custom hooks: `useFoo.ts`. Pointer/keyboard interaction hooks live in `src/newtab/interaction/`; state-owning hooks (selection, workspaces, toasts, optimistic patch, context-menu builder) live in `src/newtab/state/`.
- Utility modules: `kebab-case.ts` (`icon-helpers.ts`, `write-manifest.mjs`).
- Tests: `<feature>.spec.ts` in `tests/specs/`.
- CSS: `kebab-case.css`.

## Identifier Naming

- React components: `PascalCase`. Props interface named `<Component>Props`, defined immediately above the component.
- Hooks: `camelCase` starting with `use`.
- Functions, variables, props: `camelCase`.
- Type aliases for unions: `PascalCase` (`type ThemeMode = 'light' | 'dark' | 'system'`).
- Object shapes: `interface` when extendable; `type` for unions, intersections, mapped types.
- Message type string values: `'domain/action'` (`'bookmarks/get-tree'`, `'icons/set-override'`). Always reference as `messageTypes.xxx`, not raw strings.

## CSS Conventions

- Class prefix `ff-`, BEM-ish: `ff-tile`, `ff-tile__icon`, `ff-tile__label`, `ff-section__header`.
- Express state through `data-*` attributes (`data-selected`, `data-item-kind`, `data-bg`, `data-tile-shape`), not modifier classes.

## Data Attributes (DOM query API)

These are the contract between components and interaction hooks. Render them consistently:

- `data-item-id`, `data-item-kind` on tiles
- `data-scope-folder-id` on selection-scope containers
- `data-drop-position`, `data-drop-target`, `data-drag-source` — written by drag hook
- `data-overlay-crumb-id` on overlay breadcrumbs

Query DOM via `data-*` selectors rather than class names.

## TypeScript Style

- Strict mode is non-negotiable. Use `unknown` + narrowing at boundaries instead of `any`.
- Explicit param + return types on exported function signatures. Let inference handle locals.
- Component props: named `interface FooProps`, destructured in the signature. Skip `React.FC`.
- Type-only imports: `import type { ... }`.
- Imports: use the `@/` path alias for cross-area imports (`@/shared/messages`, `@/newtab/lib/tree`) rather than deep relative chains. Mapped in both `tsconfig.json` (`@/*` → `src/*`) and `vite.config.mjs`. Relative imports are fine for same-folder siblings.
- Immutability for state updates: spread (`{ ...prev, ...patch }`, `new Set(prev.ids)`). Treat React state as read-only.

## React Style

- Functional components + hooks only. `useState` / `useMemo` / `useCallback` / `useEffect` / `useRef`.
- Memoize callbacks whose referential identity matters to interaction hooks (`useDrag`, `useMarquee`).
- `useEffect` cleanup: return cleanup for every subscription or timer. Use a `cancelled` flag for async effects (see `getBookmarkUsage` effect in `App.tsx`).
- Side-effecting DOM writes (theme, accent) live in module-scope helpers in `lib/accent.ts`. Call them from `useEffect` rather than inlining DOM mutation.

## Logging

- Production paths stay silent — leave `console.log` out.
- `console.info` is acceptable for service worker lifecycle events (install / update).
