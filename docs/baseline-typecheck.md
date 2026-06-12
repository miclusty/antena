# Baseline Typecheck Errors — Phase 1

Captured at the end of **Phase 1 (Foundation)** of the `antena-v1-closer` change.
These are pre-existing errors in `src/` that **Phase 4 (Frontend Refactor)** will fix.

> Generated `2026-06-11` on `feature/antena-v1-closer` after commits up to
> `chore(api): enable skipLibCheck in tsconfig` (95ac449).
>
> Run command (per package, bypasses pnpm 11 pre-install check):
> ```bash
> cd packages/<name> && node_modules/.bin/tsc --noEmit 2>&1 | grep "error TS"
> ```

---

## Summary

| Package  | Total | In `src/` | In `node_modules/` |
|----------|-------|-----------|---------------------|
| api      | 19    | 19        | 0                   |
| antena   | 19    | 19        | 0                   |
| **sum**  | **38**| **38**    | **0**               |

All 38 errors are in `src/` files, all pre-existing, all targeted by
Phase 4 (and 4.x subtasks) per the OpenSpec tasks.md.

`node_modules/` errors are 0 in both packages — see "Hygiene" section below.

---

## packages/api — 19 errors

| File | Lines | Error class | Phase 4 task |
|------|-------|-------------|---------------|
| `src/lib/rss-parser.ts` | 68, 79, 83, 84, 88, 102, 113, 117, 118, 122 | `string \| null` vs `string \| undefined`; unknown property `subtitle` on `RSSFeed` | 4.x — refactor rss-parser to handle nullable fields; `RSSFeed` type from `fast-xml-parser` needs extension |
| `src/lib/source-health.ts` | 59 | `Database \| null` not assignable to `Database` | 4.x — null-check before passing to better-sqlite3 |
| `src/routes/extract.ts` | 4 | Cannot find module `../lib/extraction-engine` | 4.x — module name was renamed; needs fixing or alias |
| `src/routes/health.ts` | 21, 22, 51 | `'data' is of type 'unknown'` | 4.x — type-guard the response payload |
| `src/routes/images.ts` | 30 | `Uint8Array<ArrayBuffer>` vs `ArrayBuffer` for R2 binding | 4.x — unwrap to `ArrayBuffer` for the binding API |
| `src/routes/python.ts` | 40, 52, 76 | `Expected 1 arguments, but got 2` (Hono ctx method) | 4.x — update call signature for newer Hono version |

---

## packages/antena — 19 errors

| File | Lines | Error count | Error class | Phase 4 task |
|------|-------|-------------|-------------|---------------|
| `src/App.tsx` | 106, 118 | 2 | Mapped type collision `ApiNewsCard` vs a narrower inferred shape | 4.x — fix map callback type after refactor |
| `src/components/article/ReadingMode.tsx` | 64 | 1 | `accentColor` not in `CSSProperties` | 4.x — should be `accent-color` (kebab) or moved to `style.cssText` |
| `src/components/bookmarks/BookmarksView.tsx` | 103 | 1 | `isBookmarked` prop missing on `NewsCardProps` | 4.x — add prop in 4.6 (NewsCard refinement) |
| `src/lib/api.ts` | 5, 6, 113 (×2), 114, 122, 149, 150 | 8 | `import.meta.env` not typed (5,6); fetch `data` typed as `unknown` (113, 114, 122, 149, 150) | 4.x — add Vite client types; type-guard fetch responses |
| `src/lib/bias.ts` | 59, 60, 61, 62, 63 | 5 | `gradientColor` missing on `BiasInfo` type | 4.x — add `gradientColor` field in continuous gradient refactor |
| `src/lib/haptic.ts` | 28 | 1 | `readonly [n, n, n]` not assignable to mutable `number[]` | 4.x — use `as const` tuple or relax signature |
| `src/lib/types.ts` | 26 | 1 | `Cannot find name 'VoiceBreakdown'` | 4.x — type removed in 4.3-4.4 WebLLM branch archival |

---

## Hygiene

`tsc --noEmit` runs WITHOUT errors from `node_modules/.d.ts` files in both
packages. This was achieved with:

- **packages/antena** — extends `astro/tsconfigs/strict` → `astro/tsconfigs/base`
  which sets `"skipLibCheck": true` (line 25 of base.json).
- **packages/api** — explicit `"skipLibCheck": true` added to
  `packages/api/tsconfig.json` in commit `95ac449`. Without this, drizzle-orm
  0.36's bundled `.d.ts` files leak 77 type errors (mostly `MySqlDeleteBase`
  not implementing `SQLWrapper` correctly, internal `keyof this & string`
  constraint violations) and `@types/node` 22 web-globals leak 12 duplicate
  identifier errors (EventTarget, FormData, Headers, etc. clashing with
  `@cloudflare/workers-types`).

`skipLibCheck: true` is the standard pattern for any modern TypeScript project
that pulls in deps with imperfect `.d.ts` definitions. It does NOT suppress
type errors in our own `src/` — only in third-party type declarations.

---

## What Phase 4 should NOT regress

- **No new errors in `src/` files not listed above.** Any new file in Phase 4
  must typecheck cleanly the first time.
- **No `node_modules/` errors.** If adding a dep surfaces them, add
  `skipLibCheck: true` (if not present) before filing a bug.
- **The 19 + 19 = 38 error count** is the gate for "Phase 4 done". After
  Phase 4, both `pnpm --filter api typecheck` and `pnpm --filter antena typecheck`
  must exit 0 with no output.
