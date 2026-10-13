<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workspace

- The user designated this Codex project as the workspace for future work on
  `https://github.com/easonlines2007/catalan-dictionary` on 2026-10-11.
- Work from `/Users/easonlin/Documents/ChatGPT/Catalan- dictionary`.
  Its `origin` is the GitHub repository above; `main` tracks `origin/main`.
- The previous matching checkout is at
  `/Users/easonlin/Documents/Codex/2026-10-03/https-github-com-easonlines2007-catalan-dictionary/work/release`.
  Keep it as a historical copy; use this workspace for ongoing changes.
- `/Users/easonlin/catalan-vocab-app` is a different repository.
- Read `README.zh-CN.md` for product behavior and local setup. This is a Catalan
  pocket dictionary PWA using Next.js, React, TypeScript, and Tailwind CSS.
- Main files: `app/dictionary-app.tsx` (UI), `lib/lookup.ts` (lookup and morphology),
  `lib/dictionary-repository.ts` (dictionary loading and offline installation),
  `lib/storage.ts` (IndexedDB), `lib/speech.ts` (pronunciation), and `public/sw.js`
  (service worker). Data packs live in `public/dictionary/`.
- Use Node.js 22 and `npm ci`; start development with `npm run dev`.
  Relevant checks are `npm run lint`, `npm run typecheck`, and `npm test`.
- Data packs are already committed. Read `scripts/dictionary/README.md` and
  `DATA_SOURCES.md` before rebuilding them; regeneration requires pinned source
  inputs that are not all bundled in the repository.
- Three-language lookup uses `lib/search-repository.ts` and
  `lib/search-normalization.ts`. `python3 scripts/dictionary/build_search.py`
  rebuilds the supplemental search data from committed packs without needing
  the absent upstream snapshots. Read `scripts/dictionary/SEARCH_DATA.md`.
- Chinese additions live in paired input/reviewed JSON batches under
  `data/translations/batches/`. The builder verifies source evidence and imports
  only `translated` records. Coverage and remaining work are documented in
  `data/translations/README.md`; priority queues regenerate under ignored
  `work/translation-queue/`. The old local Argos experiment failed semantic
  review; its raw drafts must remain outside the default production build.
- Missing Chinese also uses a separate MCR/COW reference layer. Read
  `scripts/dictionary/vendor/omw/README.md` before changing its import rules.
  Keep its visible reference label and synset provenance; never count those
  equivalents as individually reviewed translations.
- Full Chinese coverage also uses source-bound machine-assisted rows under
  `data/translations/bulk/`. Read `scripts/dictionary/BULK_CHINESE.md` before
  regenerating them. Keep machine and headword-reference labels; preserve
  original/reviewed Chinese and never import uncorrected issues or old Argos
  drafts. Published snapshots reproduce the offline build without network calls.
