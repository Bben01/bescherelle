# AGENTS.md — Bescherelle hébreu

Static Hebrew ↔ French verb conjugator (https://bescherelle.pages.dev). Vite + TypeScript, **no framework**,
no server: everything runs in the browser on `public/data/verbs.json`, and every verb/root page is also
prerendered to static HTML. UI text is **French**; code and comments are English.

## Commands

```sh
npm run dev        # Vite dev server
npm test           # vitest (tests/*.test.ts: transliteration + search)
npx tsc --noEmit   # typecheck only (src/)
npm run build      # tsc + vite build + node scripts/prerender.ts → dist/ (~3 500 pages)
npm run preview    # Cloudflare Pages emulator on dist/
npm run data       # Python: download Wiktionary/kaikki + Tatoeba into .cache/, rebuild public/data/
```

Node ≥ 23.6 (prerender runs `.ts` directly). CI (`.github/workflows/ci.yml`) runs `npm ci && npm test && npm run build`
and deploys to Cloudflare Pages on `main` if secrets exist. There is no linter; `tsc` (with `noUnusedLocals/Parameters`) is the gate.

## Layout

| Path | Role |
|---|---|
| `index.html` | App shell: header/nav, settings panel (`data-setting` inputs), `<main id="app">` with `<!--app-->…<!--/app-->` markers the prerenderer fills. |
| `src/main.ts` | Client only: router (`route()` switch on pathname), page controllers (`showHome`, `showVerb`, `showCompare`, `showQuiz`, `showFavs`), settings/favs/history in `localStorage` (`store`), Hebrew virtual keyboard, speech, global click/keydown handlers, SPA link interception, service-worker registration. |
| `src/render.ts` | **Pure HTML-string renderers** shared by client *and* `scripts/prerender.ts` — must not touch `document`/`window`. Always escape with `esc()`. |
| `src/data.ts` | Types (`Verb`, `Form {p: pointed, u: unpointed}`), `TENSES` / `OTHER_CELLS` (cell keys such as `p.3ms`, `fut.1p`, `pr.fs`, `imp.mp`, `inf`, `n`, `pp`), `hydrate()`, data loaders. |
| `src/hebrew.ts` | `BINYANIM`, `BINYAN_ORDER`, `GIZROT` (root types), `hkey()` (search key: bare consonants, finals normalised), `stripNiqqud`, `translit(p, 'fr' \| 'en')`, keyboard maps. |
| `src/search.ts` | `SearchIndex` (all modes: auto, root, contains, subseq, anyorder, pattern `?`/`*`, fr, translit) + `SECTIONS` labels for grouped results. |
| `src/style.css` | Single stylesheet; theme via CSS custom properties. |
| `scripts/prerender.ts` | Writes `dist/verbe/<id>.html`, `dist/racine/<root>.html`, static pages, `sitemap.xml`; stamps `public/sw.js` `__VERSION__` with a content hash. |
| `scripts/*.py` | Data pipeline (`fetch_sources.py`, `build_data.py`, `translate_mt.py`). Machine translations are versioned in `data/fr_mt.json`. |
| `public/data/{verbs,examples}.json` | Generated but **committed** data (CC BY-SA / CC BY). Don't hand-edit; regenerate via the scripts. |
| `public/sw.js`, `public/_headers` | Offline PWA (navigations network-first, assets cache-first) and Cloudflare cache headers. |

## Conventions & gotchas

- **Shared rendering:** anything shown on a verb/root/list page goes in `render.ts` so prerendered HTML and the SPA match. Client-only behaviour (event binding) goes in `main.ts`.
- **Display settings are CSS-driven:** `applySettings()` toggles classes on `<html>` (`no-niqqud`, `no-ktiv`, `no-tr`, `tr-style-en`, `dark`/`light`). `formHtml()` always emits all variants (`.p`, `.u`, `.tr-fr`, `.tr-en`); CSS hides the unwanted ones. Don't branch on settings in renderers.
- **Dark mode variables are defined twice** in `style.css` (`@media (prefers-color-scheme: dark) html:not(.light)` and `html.dark`). Update both when adding colour variables.
- **Colour system** (all in `style.css`):
  - tense: `--t-pr / --t-p / --t-fut / --t-imp`, applied through `.t-<tenseId>` → `--tc` (tense cards on the verb page, separator rows in the compare table). Keep `.t-*` rules **after** `.tense` so the default `--tc` doesn't override them;
  - grammatical person: `--p1 / --p2 / --p3`, via `.pp1-3` on pronouns (`pronHtml()`) and `.pers-1-3` row stripes (`cellGroup()` in `render.ts`); `.pl-start` marks the singular → plural divider;
  - binyan: `.b-<code>` badges, `.vh-<code>` (`--bc`) top border of the verb header;
  - gizra, grouped by weak radical: `.gz-reg / first / mid / last / quad` (`GIZRA_POS` in `render.ts`).
- **Mobile keyboard:** form submit handlers call `dismissKeyboard()` (blurs the input when `(pointer: coarse)`) so the virtual keyboard closes on Enter; inputs carry `enterkeyhint`. Desktop keeps focus.
- **Breakpoints:** `≤ 860px` (nav scrolls horizontally), `≤ 640px` (compact mobile: cards become a 2-column grid, hero text hidden, search button hidden).
- **Hebrew text:** wrap in `lang="he" dir="rtl"`; compare words with `hkey()`, never raw strings (niqqud/final letters differ).
- **URLs:** `/verbe/<id>?hl=cell1,cell2` highlights table rows (`tr.hl`, ids `c-<cell>` with `.` → `-`); `/racine/<rootKey>`; `/liste?b=&g=&l=&tri=freq&page=`; `/?q=&mode=&b=&g=`; `/comparer?v=id1,id2`.
- **Cache busting:** `vite.config.ts` hashes the data files into `__DATA_V__`; the service worker version is stamped at prerender time. No manual bumps needed.
- **Licences:** site/code CC BY-NC 4.0; data CC BY-SA 4.0 (Wiktionary) and CC BY 2.0 FR (Tatoeba). Keep attribution links intact.

## Verifying UI changes

`npm run dev`, then open e.g. `/?q=parler` → first card → verb page. Check the 390 px mobile width and dark mode
(add class `dark` to `<html>` or use the ⚙︎ settings). `npm run build` additionally checks that the prerenderer still works.
