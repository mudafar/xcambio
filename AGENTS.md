# AGENTS.md

Guidance for AI coding agents working on CambioX. Read [README.md](README.md) first for what the app does,
caching, and how to run, test and deploy it. This file covers the rules and context the README does not.

## Ground rules

- **Static site, no build step, no dependencies.** Plain HTML, CSS and ES modules served as-is by GitHub Pages.
  Don't add a bundler, framework, npm runtime dependency or CDN. `package.json` exists only for `npm test`.
- **Everything is self-hosted** (fonts, icons) so the installed app starts with zero network requests.
- **Relative paths only** (`sw.js`, `manifest.json`, `fonts/...`). The site is served under `/xcambio/` on
  GitHub Pages and from `/` locally. Never hard-code `/xcambio/`.
- **Language:** code, comments, docs, tests and commit messages in English. All user-facing copy (UI text,
  toasts, `aria-label`s, manifest `name`/`description`) in Spanish for Venezuela (`es-VE`).
- **Never rename the repository.** The Pages URL is the installed app's identity; renaming breaks every install.
- Keep it working offline and on small phones (see Checks).
- **Don't change user-facing behaviour without the owner's confirmation.** That includes removing, adding,
  moving or swapping a control, changing what a button or gesture does, renaming things on screen, or
  breaking a UI criterion. Propose first (a mockup or screenshot plus the reason), get an explicit yes,
  then implement and add a line to the [Decisions log](#decisions-log). Visual polish that stays within the
  UI criteria and the [Behaviour contract](#behaviour-contract) doesn't need confirmation. If a redesign
  would drop or change an item in the Behaviour contract, call that out explicitly when proposing it.

## Files

| File | Role |
| --- | --- |
| `index.html` | Markup only. SVG icon sprite at the top of `<body>`. |
| `style.css` | All styles. Design tokens in `:root`, dark overrides in `:root[data-theme="dark"]`. |
| `core.js` | Pure logic, no DOM: parsing, formatting, keypad editing, conversion, API parsing, dates. |
| `app.js` | UI: state, `render()`, events, network, storage, service worker registration. |
| `sw.js` | Service worker: precaches the app shell, cache-first. |
| `core.test.js` | Unit tests (`node:test`) for `core.js`. |
| `manifest.json` | PWA manifest (icons, screenshot, colors). |
| `fonts/` | Space Grotesk (numbers, headings) and Inter (UI), latin subset, variable weight, OFL. |
| `icons/` | App icon (SVG sources + PNGs), header mark, browser-tab icon. See Icons. |
| `scripts/` | Dev-only icon tooling (`build-icons.js`, `text-to-path.py`). Not used by the app. |
| `screenshots/` | Screenshot shown in Chrome's install dialog (`manifest.json`). |

## Domain model

- Three **amount** fields: `bs` (bolívares), `bcv` (dollars at the official rate), `usdt` (USDT).
- Two **rates** in bolívares per dollar: `bcv` and `usdt`. Rate keys match the amount they convert.
- Naming: dolarapi.com calls the market rate `paralelo`; the code uses `usdt`; the UI says **USDT**.
  Don't reintroduce "paralelo" or "P2P" as labels: in 2025 Venezuelan authorities arrested people for
  publishing "dólar paralelo" rates, and USDT is the reference people use now. (The rate tracks the P2P
  USDT market closely; it is not a Binance quote.)
- **Rates are rounded to 2 decimals** (`roundRate`) when they arrive and are used that way for display,
  maths and sharing, so a hand check matches the screen. Manual rates are limited to 2 decimals.
- Number format is es-VE: `1.234,56`. `formatNumber` forces grouping (`useGrouping: "always"`).
  `parseAmount` accepts both `,` and `.` decimals.

## State and invariants (`app.js`)

`state` is the single source of truth; `render()` rewrites the DOM from it.

- `active`: field the keypad types into (`bs`, `bcv`, `usdt`, `rate:bcv`, `rate:usdt`).
- `entry`: raw text being typed (`"1234,5"`), or `null` when the field was just selected. While `null` the
  value shows as selected and the next key replaces it (⌫ clears it).
- `anchor` / `anchorValue`: the amount typed last. **Never recalculate the anchor**; changing a rate
  only updates the other two amounts (`convertAll`).
- `rates` (in use), `api` (last fetched `{ rate, date }`), `manual` (per rate, typed by hand).
  Automatic refreshes keep manual rates; the refresh button (`force: true`) and ↺ replace them.
  A manual rate left empty goes back to the automatic one. Manual rates are never persisted.

## Network and caching

- One request: `GET https://ve.dolarapi.com/v1/dolares` (CORS `*`, ETag, `max-age=0, must-revalidate`).
  Automatic loads use `cache: "default"` (conditional request, 304 when unchanged); the refresh button
  uses `cache: "no-cache"`. Timeout 8 s. Don't use `no-store`: it throws away the ETag.
- Don't add custom request headers: they trigger a CORS preflight.
- The service worker must not cache the API (it returns early for cross-origin requests).
- Alternatives checked in Nov 2026: Cotizave (needs an API key), bcv.today (BCV only), CriptoYa and
  Yadio (USDT/P2P only), pydolarve (down). dolarapi is the only free, keyless, CORS-enabled source with both.

## Service worker (`sw.js`)

- When you add a file the app needs at start-up, **add it to `APP_SHELL`**, or the app breaks offline.
- `VERSION` is `'dev'` in the repo; the deploy workflow replaces it with the commit SHA. A new `sw.js`
  installs a fresh cache, `skipWaiting()`s, deletes old caches, and the new version shows on the next launch.
- Navigations are answered with the cached `./` (ignoring query strings).

## Storage (`localStorage`)

| Key | Content |
| --- | --- |
| `cambiox:rates` | `{ bcv: {rate, date}, usdt: {rate, date}, fetchedAt }` |
| `cambiox:amount` | `{ anchor, value }`, the last typed amount |
| `cambiox:hint-rates-seen` | `true` once the one-time "tap a rate" hint was dismissed |
| `cambiox:theme` | `"light"` / `"dark"` when the user overrides the theme; `null` or absent = automatic |

Migrations in `loadSaved()`: the first version's keys `cambio-ve:bcv-rate` / `cambio-ve:parallel-rate`
(moved, then deleted) and the old `p2p` key (now `usdt`). If you change a stored shape, migrate it there;
installed users carry old data.

## UI criteria (agreed with the owner, keep them)

Layout "A": an emerald header (brand, buttons, status, reference strip) over a white sheet that holds
the three amounts and the keypad.

1. **The three amounts are the focus.** Bolívares, Dólares BCV and USDT get the largest type (34 px, shrunk
   only to fit) and the most space (84 px rows, 72/60 px on short screens). Never shrink them to make room
   for something else.
2. **Rates are reference information.** BCV and USDT sit in one quiet strip in the header (18 px values).
   They can still be tapped to type your own rate: a faint ✎ hints it, and a "Manual ↺" pill shows a
   manual rate and resets it. Their source/date goes in the accessible name and tooltip, not on screen.
3. **The brecha (gap between USDT and BCV) is always visible**, next to the rates in the strip.
4. **Emerald is the brand accent**: the header and the active field (soft emerald band, label, caret).
   Content lives on a neutral white sheet (near-black in dark mode). BCV is marked with a blue "$",
   USDT with the Tether mark (`#i-tether`, teal `#26A17B`); no other accent colors.
5. **One scale, no ad-hoc values.** Spacing 4/8/12/16/20/24/32 px (20 px side margin), type
   12/15/18/20/28/34 px (caption, label, rate, brand, key, amount), radius 8/16/28 px + pills.
   The scales are listed at the top of `style.css`.
6. **No boxes unless they group something.** Amounts are a list with hairline dividers; the keypad has no
   key backgrounds, only a soft highlight when pressed. No drop shadows inside the sheet.
7. **Header buttons stay visible**: install (when the browser offers it), theme, share, refresh. No
   overflow (⋯) menu.
8. **Amounts are right-aligned** so digits line up by place value (like a calculator or a bank statement).
9. **Row buttons match intent**: the row you're typing in shows **×** (clear it); the other two rows, the
   results, show a muted **copy** button. Hidden while a row is empty. (Owner decision; see the
   Behaviour contract.)
10. **Touch targets ≥ 44 px**; keys 64 px tall (52 px min, 48 px on very short screens).
11. **Dark mode mirrors light mode** exactly; only tokens change.
12. Everything fits on one screen without scrolling from 320×568 (iPhone SE in Safari) upwards.

## Behaviour contract

What users can do today. Changing or dropping any of these needs the owner's confirmation first
(see Ground rules).

- **Linked amounts:** Bolívares, Dólares BCV and USDT. The amount you type stays fixed; the other two follow.
  Changing a rate only updates the two derived amounts.
- **Selecting and typing:** tap an amount or a rate to select it (the value shows highlighted); the next key
  replaces it. ⌫ on a selected value clears it; ⌫ while typing deletes one digit; holding ⌫ clears the field.
  "," adds the decimal mark. Amounts and rates take at most 2 decimals.
- **Row buttons:** × on the selected amount clears it (and keeps it selected for typing). Copy on the other two
  amounts copies the number without thousands separators (`107267` or `1234,56`, so it pastes cleanly into
  bank apps) and shows a "Copiado: …" toast. Buttons are hidden while a row is empty.
- **Rates:** tap BCV or USDT in the header strip to type your own. A manual rate shows "Manual ↺"; tapping
  the pill goes back to the automatic rate. Leaving a manual rate empty also restores it. The refresh button
  reloads both rates and discards manual ones; automatic refreshes keep them. Manual rates are not saved
  between launches.
- **Brecha** (USDT vs BCV, in %) is always visible next to the rates.
- **Header buttons:** install (only when the browser offers it), theme (automatic → opposite of the system →
  same as the system → automatic), share (system share sheet with the conversion as text; copies it where
  sharing isn't available), refresh.
- **Status line:** "Actualizado hace …" (or offline/error state) and a link to dolarapi.com.
- **One-time hint** "Toca una tasa para usar la tuya", shown once; dismissed by tapping a rate, its ×, or
  after 12 s.
- **Remembered:** the last typed amount (restored on the next launch), the theme choice, the last rates.
- **Desktop:** type digits, "," or ".", Backspace, Delete (clears), arrow keys to move between fields, paste a
  number.
- **Names on screen:** CambioX; Bolívares, Dólares BCV, USDT; never "paralelo" or "P2P".

## Decisions log

Owner decisions, newest last. Add a line whenever the owner confirms a user-facing change.

| Date | Decision |
| --- | --- |
| 2026-11-19 | Keep it a static GitHub Pages site; no framework needed. Code and docs in English, UI in Spanish. |
| 2026-11-19 | Rates from dolarapi.com in one call (`/v1/dolares`); the refresh button always forces an up-to-date fetch. |
| 2026-11-19 | Name **CambioX** everywhere (repo and URL stay `xcambio`). |
| 2026-11-19 | Market rate labelled **USDT** (not "P2P" or "paralelo"). |
| 2026-11-19 | Rates rounded to **2 decimals** and used that way for the maths. |
| 2026-11-19 | Palette A with emerald as the main brand colour. |
| 2026-11-19 | App icon "Bs ⟳ $" (option 3); browser-tab icon a simple green X; Tether mark for USDT. |
| 2026-11-19 | One-time hint that rates can be edited. |
| 2026-11-19 | Light/dark theme button that overrides the system setting. |
| 2026-11-19 | Layout A: emerald header with a reference strip (BCV · USDT · Brecha), white sheet with the three amounts as the focus, right-aligned numbers, borderless keypad. Header buttons stay visible (no ⋯ menu). Brecha always visible. |
| 2026-11-19 | Row buttons: × on the selected amount, copy on the other two. (Restored after it was replaced by copy-only without confirmation.) |
| open | "Rates are reference only" was implemented as *still editable, visually secondary*; the owner hasn't confirmed editable vs read-only. Ask before changing it. |

## Design implementation

- Colors are tokens in `:root` with overrides in `:root[data-theme="dark"]`; don't hard-code colors in
  rules (the Tether and BCV marks are the only fixed colors).
- **Light/dark theme** is driven by `data-theme="light|dark"` on `<html>`, never by
  `@media (prefers-color-scheme)` in CSS. An inline script in `<head>` sets the attribute (and the
  `theme-color` metas) before the first paint from `cambiox:theme`, falling back to the system setting.
  It mirrors `resolveTheme()` in `core.js`; keep the two in sync. The header button cycles
  automatic → opposite of the system → same as the system → automatic (`nextTheme()`), so the first tap
  always changes what you see; while automatic, the app follows system changes live.
- The active field gets the emerald treatment and a caret; a just-selected value gets a selection
  highlight (the next key replaces it). In the strip the highlight only grows sideways.
- Long amounts: `fitAmounts()` in `app.js` measures each value and steps the font down from 34 px until it
  fits; it re-runs on resize and when fonts load. Don't replace it with character-count guesses.
- Fonts: Space Grotesk for numbers and headings, Inter for UI text. Don't use `font-variant-numeric:
  tabular-nums`: Space Grotesk's tabular "1" has a slab foot that looks wrong.
- Breakpoints: `max-height: 760px` and `max-height: 620px` (shorter rows and keys), `max-width: 360px`
  (narrow phones: smaller strip, slimmer header buttons). Desktop shows the app as a centred card.
- iOS: the status bar is `black-translucent`, so the emerald header sits under it; keep the header
  dark enough for white status-bar text, and respect `env(safe-area-inset-*)`.
- Contrast: aim for WCAG AA (4.5:1) on text. White on the header top `#047857` is 5.5:1.

## Icons

- **App icon** (home screen, install dialog, splash): "Bs ⟳ $", the letters Bs and $ with two curved
  exchange arrows, white on an emerald gradient (`#10B981 → #047857`). No app name inside the icon; the home
  screen already prints it underneath.
- **Header mark** (`icons/mark.svg`): the same artwork in emerald on a white tile, so it stands out on the
  emerald header.
- **Browser-tab icon** (`icons/favicon.svg`, `icons/favicon-48.png`): deliberately simpler, a green tile with
  a big white X, because the letters are unreadable at 16 px.
- Letters are **outlined paths** (Space Grotesk Bold, via `scripts/text-to-path.py`), so the SVGs never
  depend on installed fonts. To change them, regenerate the paths and paste them into the SVGs.
- Sources and outputs in `icons/`:

  | Source | Output | Rules |
  | --- | --- | --- |
  | `icon.svg` | `icon-192.png`, `icon-512.png` | purpose `any`; transparent rounded corners are fine |
  | `icon-maskable.svg` | `icon-maskable-512.png` | full-bleed square, artwork inside the central 80% (Android masks it) |
  | `apple-touch-icon.svg` | `apple-touch-icon.png` (180×180) | full-bleed, **no transparency** (iOS fills it with black), no rounded corners (iOS rounds it) |
  | `favicon.svg` | `favicon-48.png` | PNG fallback for browsers without SVG favicons |

- Regenerate the PNGs with `node scripts/build-icons.js` (needs Playwright + Chromium), then shrink them
  (e.g. Pillow `optimize=True`, or `oxipng`). If a file name changes, update `index.html`, `manifest.json`
  and `APP_SHELL` in `sw.js`.

## Checks before you push

1. `npm test`
2. Serve the parent of the repo so the app runs under `/xcambio/` like on Pages:
   `mkdir -p /tmp/www && ln -sfn "$PWD" /tmp/www/xcambio && python3 -m http.server 8765 -d /tmp/www`
3. In a browser (Playwright is fine), check: iPhone SE (320×568), iPhone 13 (390×664), Pixel 7, desktop
   (1280×860), light and dark. No vertical scroll on phones, no horizontal overflow, no console errors.
4. Offline: load once, go offline, reload; the app opens and the keypad works.
5. Installability: Chrome DevTools Protocol `Page.getInstallabilityErrors` returns `[]`.

## Deploy and environments

- `muda-g2i/xcambio` (this fork) → https://muda-g2i.github.io/xcambio/: test deployment. Pushing to `main`
  deploys it (`.github/workflows/pages.yml`).
- `mudafar/xcambio` (upstream) → https://mudafar.github.io/xcambio/: the original site with installed
  users. It still runs the first version; changes reach it only when merged upstream by the owner.
