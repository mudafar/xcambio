// CambioX UI. Plain ES modules, no build step: state → render().
import {
  AMOUNT_KEYS, RATE_KEYS, LIMITS, isValidRate, parseAmount, formatNumber, applyKey,
  formatEntry, entryFromNumber, convertAll, computeGap, parseRatesResponse,
  describeDate, timeAgo, shareText, roundRate, resolveTheme, nextTheme
} from "./core.js";

// One request returns both rates (BCV "oficial" and "paralelo").
const RATES_URL = "https://ve.dolarapi.com/v1/dolares";
const RATES_KEY = "cambiox:rates";
const AMOUNT_KEY = "cambiox:amount";
const HINT_KEY = "cambiox:hint-rates-seen";
const THEME_KEY = "cambiox:theme"; // "light" | "dark"; absent = auto (read early by the inline script in index.html)
// Keys used by the first version of the app (migrated once, then removed).
const LEGACY_KEYS = { bcv: "cambio-ve:bcv-rate", usdt: "cambio-ve:parallel-rate" };

const FETCH_TIMEOUT_MS = 8000;
const POLL_EVERY_MS = 10 * 60 * 1000; // while the app is open
const RESUME_AFTER_MS = 5 * 60 * 1000; // when it comes back to the foreground
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

// User-facing copy is Spanish.
const LABELS = { bs: "Bolívares", bcv: "Dólares BCV", usdt: "USDT", "rate:bcv": "Tasa BCV", "rate:usdt": "Tasa USDT" };
const RATE_NAMES = { bcv: "BCV", usdt: "USDT" };
const THEME_NAMES = { auto: "automático", light: "claro", dark: "oscuro" };
const THEME_ICONS = { auto: "#i-theme-auto", light: "#i-sun", dark: "#i-moon" };
const THEME_COLORS = { light: "#047857", dark: "#065F46" }; // header top colour, for the browser/status bar
const FIELD_ORDER = ["rate:bcv", "rate:usdt", "bs", "bcv", "usdt"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ui = {
  status: $("#status"),
  statusText: $("#status-text"),
  refresh: $("#refresh-btn"),
  share: $("#share-btn"),
  theme: $("#theme-btn"),
  install: $("#install-btn"),
  gap: $("#gap"),
  hint: $("#rate-hint"),
  keypad: $(".keypad"),
  toast: $("#toast"),
  sr: $("#sr-summary"),
  fields: Object.fromEntries($$("[data-field]").map((node) => [node.dataset.field, node]))
};

const state = {
  active: "bs", // field the keypad types into
  entry: null, // raw text typed into the active field; null = value "selected", next key replaces it
  anchor: "bs", // amount the person typed last; it is never recalculated
  anchorValue: NaN,
  rates: { bcv: NaN, usdt: NaN }, // rates in use (from the API or typed by hand), 2 decimals
  api: { bcv: null, usdt: null }, // last { rate, date } from the API
  manual: { bcv: false, usdt: false },
  fetchedAt: 0,
  sync: "idle", // "loading" | "ok" | "error"
  inflight: null,
  forceQueued: false
};

const isRateField = (field) => field.startsWith("rate:");
const rateKeyOf = (field) => field.slice(5);

// ------------------------------------------------------------------ storage

const store = {
  read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
};

function migrateLegacyRates() {
  const saved = { fetchedAt: Infinity };
  for (const key of RATE_KEYS) {
    const old = store.read(LEGACY_KEYS[key]);
    if (old && isValidRate(Number(old.rate))) {
      saved[key] = { rate: Number(old.rate), date: old.sourceDate || null };
      saved.fetchedAt = Math.min(saved.fetchedAt, Number(old.fetchedAt) || 0);
    }
    store.remove(LEGACY_KEYS[key]);
  }
  if (!saved.bcv && !saved.usdt) return null;
  if (!Number.isFinite(saved.fetchedAt)) saved.fetchedAt = 0;
  store.write(RATES_KEY, saved);
  return saved;
}

function loadSaved() {
  const saved = store.read(RATES_KEY) || migrateLegacyRates();
  if (saved) {
    saved.usdt ??= saved.p2p; // stored as "p2p" before the USDT rename
    for (const key of RATE_KEYS) {
      const rate = roundRate(Number(saved[key]?.rate));
      if (isValidRate(rate)) {
        state.api[key] = { rate, date: saved[key].date ?? null };
        state.rates[key] = rate;
      }
    }
    state.fetchedAt = Number(saved.fetchedAt) || 0;
  }

  const amount = store.read(AMOUNT_KEY);
  if (amount?.anchor === "p2p") amount.anchor = "usdt";
  if (amount && AMOUNT_KEYS.includes(amount.anchor) && Number.isFinite(amount.value)) {
    state.anchor = amount.anchor;
    state.anchorValue = amount.value;
    state.active = amount.anchor;
  }
}

const saveRates = () => store.write(RATES_KEY, { bcv: state.api.bcv, usdt: state.api.usdt, fetchedAt: state.fetchedAt });

let saveAmountTimer;
function saveAmountSoon() {
  clearTimeout(saveAmountTimer);
  saveAmountTimer = setTimeout(() => {
    if (Number.isFinite(state.anchorValue)) store.write(AMOUNT_KEY, { anchor: state.anchor, value: state.anchorValue });
    else store.remove(AMOUNT_KEY);
  }, 400);
}

// ------------------------------------------------------------------ network

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchRates(force) {
  // dolarapi.com sends an ETag with "max-age=0, must-revalidate", so the
  // browser's HTTP cache revalidates every request and gets a tiny 304 when
  // nothing changed. "no-cache" (refresh button) always asks the server,
  // even if those headers change one day.
  const response = await fetch(RATES_URL, {
    cache: force ? "no-cache" : "default",
    signal: timeoutSignal(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = parseRatesResponse(await response.json());
  if (!parsed.bcv && !parsed.usdt) throw new Error("Response has no rates");
  return parsed;
}

/**
 * Refresh the rates. Automatic refreshes keep any rate typed by hand;
 * force=true (the ↻ button) replaces them with the day's rates.
 */
function loadRates({ force = false } = {}) {
  if (state.inflight) {
    state.forceQueued ||= force;
    return state.inflight;
  }

  state.sync = "loading";
  render();

  state.inflight = fetchRates(force)
    .then((parsed) => {
      const forced = force || state.forceQueued;
      for (const key of RATE_KEYS) {
        if (!parsed[key]) continue;
        state.api[key] = parsed[key];
        if (forced) {
          state.manual[key] = false;
          if (state.active === `rate:${key}`) state.entry = null;
        }
        if (!state.manual[key]) state.rates[key] = parsed[key].rate;
      }
      state.fetchedAt = Date.now();
      state.sync = "ok";
      saveRates();
      if (forced) toast("Tasas actualizadas");
    })
    .catch(() => {
      state.sync = "error";
      if (force || state.forceQueued) toast(navigator.onLine === false ? "Sin conexión" : "No se pudo actualizar");
    })
    .finally(() => {
      state.inflight = null;
      state.forceQueued = false;
      render();
    });

  return state.inflight;
}

// ------------------------------------------------------------------ editing

function press(key) {
  const field = state.active;
  const limits = isRateField(field) ? LIMITS.rate : LIMITS.amount;
  // A selected value is replaced by the first key (⌫ clears it).
  const next = applyKey(state.entry ?? "", key, limits);
  if (state.entry !== null && next === state.entry) return;

  state.entry = next;
  commit(field);
  if (navigator.vibrate) navigator.vibrate(8);
  render();
  announceSoon();
}

function commit(field) {
  const value = state.entry ? parseAmount(state.entry) : NaN;
  if (isRateField(field)) {
    const key = rateKeyOf(field);
    state.manual[key] = true;
    state.rates[key] = isValidRate(value) ? value : NaN;
  } else {
    state.anchor = field;
    state.anchorValue = value;
    saveAmountSoon();
  }
}

function activate(field) {
  if (isRateField(field)) dismissHint();
  if (state.active !== field) {
    const previous = state.active;
    // A rate left empty goes back to the day's rate.
    if (isRateField(previous) && state.manual[rateKeyOf(previous)] && !isValidRate(state.rates[rateKeyOf(previous)])) {
      resetRate(rateKeyOf(previous));
    }
    state.active = field;
  }
  state.entry = null; // tapping a field selects its value
  render();
}

function resetRate(key) {
  state.manual[key] = false;
  state.rates[key] = state.api[key]?.rate ?? NaN;
  if (state.active === `rate:${key}`) state.entry = null;
}

function currentValues() {
  return convertAll(state.anchor, state.anchorValue, state.rates);
}

// ------------------------------------------------------------------ render

function setIcon(button, id) {
  const use = button.querySelector("use");
  if (use.getAttribute("href") !== id) use.setAttribute("href", id);
}

function renderAmounts(values) {
  for (const key of AMOUNT_KEYS) {
    const node = ui.fields[key];
    const active = state.active === key;
    const text = active && state.entry !== null ? formatEntry(state.entry) : formatNumber(values[key]);

    node.classList.toggle("is-active", active);
    node.classList.toggle("is-fresh", active && state.entry === null);
    node.querySelector(".value").textContent = text;

    const main = node.querySelector(".amount__main");
    main.setAttribute("aria-label", `${LABELS[key]}: ${text || "vacío"}`);
    main.toggleAttribute("aria-current", active);

    // Row button (owner decision, see AGENTS.md): × clears the row you're typing in;
    // the other two rows (the results) show copy. Hidden while the row is empty.
    const action = node.querySelector(".amount__action");
    const clears = active;
    setIcon(action, clears ? "#i-clear" : "#i-copy");
    action.dataset.mode = clears ? "clear" : "copy";
    action.setAttribute("aria-label", `${clears ? "Borrar" : "Copiar"} ${LABELS[key].toLowerCase()}`);
    action.disabled = text === "";
  }
  fitAmounts();
}

/**
 * Shrink an amount's font until it fits its row (34 px down to 18 px).
 * Measured, not guessed from the character count, so it works for any width.
 */
function fitAmounts() {
  for (const key of AMOUNT_KEYS) {
    const box = ui.fields[key].querySelector(".amount__value");
    box.style.fontSize = "";
    const value = box.querySelector(".value");
    const caret = box.querySelector(".caret");
    let size = parseFloat(getComputedStyle(box).fontSize);
    const fits = () => value.getBoundingClientRect().width + caret.getBoundingClientRect().width + 8 <= box.clientWidth;
    while (size > 18 && !fits()) {
      size -= 2;
      box.style.fontSize = `${size}px`;
    }
  }
}

function renderRates() {
  for (const key of RATE_KEYS) {
    const field = `rate:${key}`;
    const node = ui.fields[field];
    const active = state.active === field;
    const text = active && state.entry !== null ? formatEntry(state.entry) : formatNumber(state.rates[key]);
    const manual = state.manual[key];

    node.classList.toggle("is-active", active);
    node.classList.toggle("is-fresh", active && state.entry === null);
    node.classList.toggle("is-manual", manual);
    node.querySelector(".value").textContent = text;

    // Rates are reference information: the source/date goes in the accessible name and tooltip,
    // not on screen. The "Manual ↺" pill shows when a rate was typed by hand.
    let source;
    if (manual) source = "manual";
    else if (state.api[key]) {
      const when = describeDate(state.api[key].date);
      source = when ? `automática, ${when}` : "automática";
    } else source = state.sync === "error" ? "sin datos, toca para escribirla" : "cargando";

    const main = node.querySelector(".rate__main");
    main.setAttribute("aria-label", `${LABELS[field]} (${source}): ${text ? `${text} bolívares por dólar` : "sin tasa"}. Toca para editar`);
    main.toggleAttribute("aria-current", active);
    node.title = `${LABELS[field]} · ${source}`;

    node.querySelector(".rate__reset").hidden = !(manual && state.api[key]);
  }

  // The gap between the two rates is always visible.
  const gap = computeGap(state.rates);
  if (Number.isFinite(gap)) {
    const pct = formatNumber(Math.abs(gap), 1, 1);
    ui.gap.textContent = `${gap >= 0 ? "+" : "−"}${pct}%`;
    ui.gap.title = `USDT ${pct}% ${gap >= 0 ? "sobre" : "bajo"} el BCV`;
  } else {
    ui.gap.textContent = "—";
    ui.gap.title = "";
  }
}

function renderStatus() {
  const hasRates = RATE_KEYS.some((key) => state.api[key]);
  const ago = state.fetchedAt ? timeAgo(state.fetchedAt) : "";
  let tone = "idle";
  let text = "Cargando tasas…";

  if (state.sync === "loading") {
    text = hasRates ? "Actualizando…" : "Cargando tasas…";
    tone = hasRates ? "stale" : "idle";
  } else if (state.sync === "error") {
    const reason = navigator.onLine === false ? "Sin conexión" : "No se pudo actualizar";
    text = hasRates && ago ? `${reason} · tasas de ${ago}` : `${reason} · toca una tasa para escribirla`;
    tone = hasRates ? "stale" : "bad";
  } else if (hasRates && ago) {
    text = `Actualizado ${ago}`;
    tone = Date.now() - state.fetchedAt > STALE_AFTER_MS ? "stale" : "ok";
  }

  ui.status.dataset.tone = tone;
  ui.statusText.textContent = text;
  ui.refresh.classList.toggle("is-loading", state.sync === "loading");
  ui.refresh.disabled = state.sync === "loading";
}

function render() {
  renderAmounts(currentValues());
  renderRates();
  renderStatus();
}

// ------------------------------------------------------------------ feedback

let toastTimer;
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), 2200);
}

let announceTimer;
function announceSoon() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const v = currentValues();
    ui.sr.textContent = Number.isFinite(v.bs)
      ? `${formatNumber(v.bs)} bolívares equivalen a ${formatNumber(v.bcv) || "—"} dólares BCV y ${formatNumber(v.usdt) || "—"} USDT`
      : "";
  }, 800);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("No se pudo copiar");
  }
}

// ------------------------------------------------------------------ events

document.addEventListener("click", (e) => {
  const activator = e.target.closest("[data-activate]");
  if (activator) {
    activate(activator.dataset.activate);
    return;
  }

  const action = e.target.closest("[data-action-for]");
  if (action) {
    const key = action.dataset.actionFor;
    if (action.dataset.mode === "clear") {
      state.active = key;
      state.entry = "";
      commit(key);
      render();
      announceSoon();
      return;
    }
    const value = currentValues()[key];
    // Copied without thousands separators ("1234,56") so it pastes cleanly into bank apps.
    if (Number.isFinite(value)) copyText(entryFromNumber(value, 2), `Copiado: ${formatNumber(value)}`);
    return;
  }

  const reset = e.target.closest("[data-reset]");
  if (reset) {
    resetRate(reset.dataset.reset);
    render();
    toast(`Tasa ${RATE_NAMES[reset.dataset.reset]} automática`);
  }
});

// Keyboard focus (Tab) also selects a field.
document.addEventListener("focusin", (e) => {
  const activator = e.target.closest?.("[data-activate]");
  if (activator && activator.dataset.activate !== state.active) activate(activator.dataset.activate);
});

// Keypad: act on click (works with screen readers and keyboards) but keep
// focus where it is, give instant visual feedback, and hold ⌫ to clear.
let holdTimer;
let held = false;

ui.keypad.addEventListener("pointerdown", (e) => {
  const key = e.target.closest(".key");
  if (!key) return;
  e.preventDefault();
  key.classList.add("is-pressed");
  if (key.dataset.key === "back") {
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      press("clear");
    }, 500);
  }
});

const releaseKeys = () => {
  clearTimeout(holdTimer);
  $$(".key.is-pressed").forEach((key) => key.classList.remove("is-pressed"));
};
["pointerup", "pointercancel"].forEach((type) => document.addEventListener(type, releaseKeys));
ui.keypad.addEventListener("pointerleave", releaseKeys);
ui.keypad.addEventListener("contextmenu", (e) => e.preventDefault());

ui.keypad.addEventListener("click", (e) => {
  const key = e.target.closest(".key");
  if (!key) return;
  if (key.dataset.key === "back" && held) {
    held = false;
    return;
  }
  press(key.dataset.key);
});

// Physical keyboard.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  let key = null;
  if (/^\d$/.test(e.key)) key = e.key;
  else if (e.key === "," || e.key === "." || e.key === "Decimal") key = ",";
  else if (e.key === "Backspace") key = "back";
  else if (e.key === "Delete") key = "clear";
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const i = FIELD_ORDER.indexOf(state.active);
    const next = FIELD_ORDER[(i + (e.key === "ArrowDown" ? 1 : -1) + FIELD_ORDER.length) % FIELD_ORDER.length];
    activate(next);
    ui.fields[next].querySelector("[data-activate]").focus({ preventScroll: true });
    return;
  }
  if (!key) return;
  e.preventDefault();
  press(key);
});

// Paste a number from anywhere (desktop).
document.addEventListener("paste", (e) => {
  const value = parseAmount((e.clipboardData?.getData("text") ?? "").replace(/[^\d.,]/g, ""));
  if (!Number.isFinite(value)) return;
  e.preventDefault();
  state.entry = entryFromNumber(value, (isRateField(state.active) ? LIMITS.rate : LIMITS.amount).maxDecimals);
  commit(state.active);
  render();
  announceSoon();
});

ui.refresh.addEventListener("click", () => loadRates({ force: true }));

ui.share.addEventListener("click", async () => {
  const text = shareText(currentValues(), state.rates);
  const url = location.href.split("#")[0];
  if (navigator.share) {
    try {
      await navigator.share({ title: "CambioX", text, url });
    } catch { /* cancelled */ }
    return;
  }
  copyText(`${text}\n${url}`, "Conversión copiada");
});

// Install button (Chrome / Edge / Android). iOS uses Share → "Agregar a inicio".
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  ui.install.hidden = false;
});
ui.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  ui.install.hidden = true;
});
window.addEventListener("appinstalled", () => {
  ui.install.hidden = true;
});

// Amount sizes depend on the font and the width: re-fit when either changes.
document.fonts?.ready.then(fitAmounts);
window.addEventListener("resize", fitAmounts);

// Keep rates fresh: installed apps are resumed far more often than reopened.
const refreshIfOlderThan = (ms) => {
  if (Date.now() - state.fetchedAt > ms) loadRates();
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshIfOlderThan(RESUME_AFTER_MS);
});
window.addEventListener("online", () => refreshIfOlderThan(0));
setInterval(() => {
  renderStatus();
  if (document.visibilityState === "visible") refreshIfOlderThan(POLL_EVERY_MS);
}, 30 * 1000);

// ------------------------------------------------------------------ theme

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function themePref() {
  const pref = store.read(THEME_KEY);
  return pref === "light" || pref === "dark" ? pref : "auto";
}

function applyTheme(pref) {
  const theme = resolveTheme(pref, systemDark.matches);
  document.documentElement.dataset.theme = theme;
  $$('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", THEME_COLORS[theme]));
  setIcon(ui.theme, THEME_ICONS[pref]);
  ui.theme.setAttribute("aria-label", `Tema: ${THEME_NAMES[pref]}. Cambiar tema`);
  ui.theme.title = `Tema ${THEME_NAMES[pref]}`;
}

ui.theme.addEventListener("click", () => {
  const pref = nextTheme(themePref(), systemDark.matches);
  store.write(THEME_KEY, pref === "auto" ? null : pref);
  applyTheme(pref);
  toast(pref === "auto" ? "Tema automático (como tu teléfono)" : `Tema ${THEME_NAMES[pref]}`);
});

// Follow the system while on "auto" (e.g. the phone switches to dark at night).
systemDark.addEventListener?.("change", () => applyTheme(themePref()));

// ------------------------------------------------------------------ one-time hint

// Shown once, pointing at the rates, so people discover they can type their own.
function showHintOnce() {
  if (store.read(HINT_KEY)) return;
  setTimeout(() => {
    if (store.read(HINT_KEY)) return;
    ui.hint.hidden = false;
    requestAnimationFrame(() => ui.hint.classList.add("is-visible"));
    setTimeout(dismissHint, 12000);
  }, 900);
}

function dismissHint() {
  store.write(HINT_KEY, true);
  if (ui.hint.hidden) return;
  ui.hint.classList.remove("is-visible");
  setTimeout(() => { ui.hint.hidden = true; }, 200);
}

ui.hint.addEventListener("click", dismissHint);

// ------------------------------------------------------------------ start

applyTheme(themePref());
loadSaved();
render();
loadRates();
showHintOnce();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // Look for a new version when a long-lived installed app is resumed (at most hourly).
      let lastCheck = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - lastCheck < 60 * 60 * 1000) return;
        lastCheck = Date.now();
        reg.update().catch(() => {});
      });
    }).catch(() => { /* the app works without it */ });
  });
}
