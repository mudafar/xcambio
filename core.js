// Pure logic for CambioX: parsing, formatting, conversion and keypad editing.
// No DOM access, so it runs unchanged in the browser and in `node --test`.

export const LOCALE = "es-VE";
export const TIME_ZONE = "America/Caracas";

/**
 * Amount fields: bolívares, dollars at the official BCV rate, and USDT.
 * "usdt" is the market rate that dolarapi.com calls "paralelo"; the UI calls it
 * USDT because that is the reference people use (the P2P USDT market).
 */
export const AMOUNT_KEYS = ["bs", "bcv", "usdt"];
/** Rate keys match the amount field they convert. */
export const RATE_KEYS = ["bcv", "usdt"];

export const LIMITS = {
  amount: { maxInt: 12, maxDecimals: 2 },
  rate: { maxInt: 7, maxDecimals: 2 }
};

export const isValidRate = (r) => Number.isFinite(r) && r > 0;

/**
 * Rates are used with two decimals everywhere (display, maths, sharing), so a
 * hand check of what is on screen always matches: 100 × 917,78 = 91.778,00.
 */
export const roundRate = (r) => Math.round(r * 100) / 100;

/**
 * Parse a typed or pasted number. Accepts "1234,56", "1234.56", "1.234,56"
 * and "1,234.56". With a single kind of separator, one occurrence is the
 * decimal mark and repeated ones are thousands separators.
 * Returns NaN for empty or invalid input.
 */
export function parseAmount(raw) {
  let s = String(raw ?? "").replace(/[\s ]/g, "");
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    s = s.split(group).join("").replace(decimal, ".");
  } else if (lastComma !== -1) {
    s = s.indexOf(",") === lastComma ? s.replace(",", ".") : s.split(",").join("");
  } else if (lastDot !== -1 && s.indexOf(".") !== lastDot) {
    s = s.split(".").join("");
  }

  if (!/^\d*\.?\d*$/.test(s) || s === ".") return NaN;
  return Number(s);
}

const numberFormats = new Map();

/** Locale-format a number ("1.234,56"). Returns "" for non-finite values. */
export function formatNumber(n, minFrac = 2, maxFrac = 2, grouping = true) {
  if (!Number.isFinite(n)) return "";
  const key = `${minFrac}|${maxFrac}|${grouping}`;
  let nf = numberFormats.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
      useGrouping: grouping ? "always" : false
    });
    numberFormats.set(key, nf);
  }
  return nf.format(n);
}

// ---------------------------------------------------------------------------
// Keypad editing. An "entry" is the raw text being typed: digits plus at most
// one "," as decimal mark, e.g. "1234,5". It is formatted only for display.
// ---------------------------------------------------------------------------

/** Apply one keypad key ("0"-"9", ",", "back", "clear") to an entry. */
export function applyKey(entry, key, { maxInt = 12, maxDecimals = 2 } = {}) {
  const current = entry ?? "";
  if (key === "clear") return "";
  if (key === "back") return current.slice(0, -1);

  const commaAt = current.indexOf(",");
  if (key === ",") {
    if (maxDecimals === 0 || commaAt !== -1) return current;
    return current === "" ? "0," : `${current},`;
  }

  if (!/^\d$/.test(key)) return current;
  if (commaAt !== -1) {
    return current.length - commaAt - 1 >= maxDecimals ? current : current + key;
  }
  if (current === "0") return key; // no leading zeros
  return current.length >= maxInt ? current : current + key;
}

/** Display an entry while typing: grouped integer part, decimals exactly as typed. */
export function formatEntry(entry) {
  if (!entry) return "";
  const [int, dec] = entry.split(",");
  const intText = formatNumber(Number(int || "0"), 0, 0);
  return dec === undefined ? intText : `${intText},${dec}`;
}

/** Turn a number into an editable entry ("1234,5"). */
export function entryFromNumber(n, maxDecimals = 2) {
  return Number.isFinite(n) && n >= 0 ? formatNumber(n, 0, maxDecimals, false) : "";
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Given the field the person typed in (the anchor) and its value, compute all
 * three amounts. The anchor value is returned untouched; a field whose rate is
 * missing comes back as NaN instead of a wrong number.
 */
export function convertAll(anchor, value, rates) {
  const out = { bs: NaN, bcv: NaN, usdt: NaN };
  if (!Number.isFinite(value) || value < 0) return out;

  out[anchor] = value;

  let bs;
  if (anchor === "bs") bs = value;
  else if (isValidRate(rates[anchor])) bs = value * rates[anchor];
  else return out;

  out.bs = bs;
  for (const key of RATE_KEYS) {
    if (key !== anchor) out[key] = isValidRate(rates[key]) ? bs / rates[key] : NaN;
  }
  return out;
}

/** Percentage the USDT rate sits above (positive) or below the BCV rate. */
export function computeGap(rates) {
  if (!isValidRate(rates.bcv) || !isValidRate(rates.usdt)) return NaN;
  return ((rates.usdt - rates.bcv) / rates.bcv) * 100;
}

// ---------------------------------------------------------------------------
// API (dolarapi.com: GET https://ve.dolarapi.com/v1/dolares)
// ---------------------------------------------------------------------------

function readRate(item) {
  for (const field of ["promedio", "venta", "compra"]) {
    const n = Number(item?.[field]);
    if (item?.[field] != null && isValidRate(n)) return n;
  }
  return NaN;
}

/**
 * Parse the /v1/dolares response (an array with "oficial" and "paralelo").
 * Returns { bcv, usdt }, each { rate, date } (rate rounded to 2 decimals) or null.
 */
export function parseRatesResponse(data) {
  const out = { bcv: null, usdt: null };
  if (!Array.isArray(data)) return out;
  const map = { oficial: "bcv", paralelo: "usdt" };
  for (const item of data) {
    const key = map[item?.fuente];
    if (!key || (item.moneda && item.moneda !== "USD")) continue;
    const rate = roundRate(readRate(item));
    if (isValidRate(rate)) out[key] = { rate, date: item.fechaActualizacion || null };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);

/** Spanish label for a rate's timestamp in Venezuelan time: "hoy", "hoy 10:01 a. m." or "18 nov.". */
export function describeDate(dateStr, now = new Date()) {
  const d = new Date(dateStr);
  if (!dateStr || Number.isNaN(d.getTime())) return "";

  const time = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(d);
  const midnight = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) === "00:00";

  if (dayKey(d) === dayKey(now)) return midnight ? "hoy" : `hoy ${time}`;
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(d);
}

/** Spanish relative time: "hace un momento", "hace 5 minutos", "hace 2 horas", "ayer"… */
export function timeAgo(timestamp, now = Date.now()) {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "hace un momento";
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), "hour");
  return rtf.format(-Math.floor(seconds / 86400), "day");
}

// ---------------------------------------------------------------------------
// Theme: "auto" follows the system, "light" / "dark" override it.
// ---------------------------------------------------------------------------

export const THEMES = ["auto", "light", "dark"];

/** The theme actually shown ("light" | "dark") for a preference. */
export function resolveTheme(pref, systemDark) {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

/**
 * Next preference for the theme button. From "auto" it first goes to the
 * opposite of the system theme, so the first tap always changes something:
 * auto → opposite → same as system → auto.
 */
export function nextTheme(pref, systemDark) {
  const order = systemDark ? ["auto", "light", "dark"] : ["auto", "dark", "light"];
  const i = Math.max(0, order.indexOf(pref)); // unknown values count as "auto"
  return order[(i + 1) % order.length];
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** Plain-text summary of the current conversion, for sharing or copying. */
export function shareText(values, rates) {
  const rate = (key) => (isValidRate(rates[key]) ? formatNumber(rates[key]) : "—");
  if (!Number.isFinite(values.bs)) {
    return `Tasa BCV: Bs ${rate("bcv")}\nTasa USDT: Bs ${rate("usdt")}`;
  }
  const lines = [`Bs ${formatNumber(values.bs)}`];
  if (Number.isFinite(values.bcv)) lines.push(`$${formatNumber(values.bcv)} a tasa BCV (${rate("bcv")})`);
  if (Number.isFinite(values.usdt)) lines.push(`${formatNumber(values.usdt)} USDT (tasa ${rate("usdt")})`);
  return lines.join("\n");
}
