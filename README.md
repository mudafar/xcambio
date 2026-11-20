# CambioX

Convert bolívares, BCV dollars and USDT instantly. A static PWA (HTML + CSS + ES modules, no build step)
hosted on GitHub Pages that works offline once opened. The app's interface is in Spanish.

> Working on this repo with an AI agent? Read [AGENTS.md](AGENTS.md) first. It also lists the agreed
> UI criteria that any design change should respect.

## How it works

- Three linked amounts: **Bolívares**, **Dólares BCV** and **USDT**. The amount you type is never
  recalculated; the other two follow it. Editing a rate only changes the derived amounts.
- Rates come from one request to [dolarapi.com](https://dolarapi.com):
  `GET https://ve.dolarapi.com/v1/dolares` returns the official BCV rate (`oficial`) and the market rate
  (`paralelo`, shown as **USDT**). Rates are rounded to two decimals and used that way everywhere.
- The rates and the gap between them (brecha) are shown as a reference strip in the header. Tap a rate to
  type your own ("Manual ↺"); tapping that pill, or the refresh button, goes back to the automatic rate.
- An on-screen keypad edits whichever field is selected; on desktop you can type, paste and use the arrow keys.
  × clears the amount you're typing; the other two amounts have a copy button.
- Light and dark themes follow the phone's setting; the theme button in the header overrides it
  (automatic → light/dark → automatic).

## Caching

| What | Where | Strategy |
| --- | --- | --- |
| App shell (HTML, CSS, JS, fonts, icons) | Service worker cache `cambiox-<commit>` | Precached, cache-first. Each deploy changes `sw.js`, which installs a fresh cache and deletes the old one |
| Rates | `localStorage` (`cambiox:rates`) + browser HTTP cache | Shown instantly from storage, then revalidated. dolarapi sends an ETag with `max-age=0, must-revalidate`, so unchanged rates cost a 304. Refreshed on launch, when the app returns to the foreground (after 5 min), every 10 min while open, and when the connection comes back |
| Refresh button | — | `fetch(..., { cache: "no-cache" })`: always asks the server and replaces manual rates |

The service worker deliberately does not cache the API, so it never serves an outdated rate.

## Develop

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ (service workers work on localhost).

```bash
npm test
```

`core.js` holds the pure logic (parsing, formatting, conversion, keypad editing) and is covered by
`core.test.js`. `app.js` is the UI.

## Deploy

Pushing to `main` runs `.github/workflows/pages.yml`: it runs the tests, stamps `sw.js` with the commit SHA and
publishes the site to GitHub Pages. In the repository settings, Pages → Source must be **GitHub Actions**.
