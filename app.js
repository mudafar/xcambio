function computeConversion(value, rate) {
  const numericValue = Number(value);
  const numericRate = Number(rate);

  if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isFinite(numericRate) || numericRate <= 0) {
    return 0;
  }

  return numericValue / numericRate;
}

function getUpdatedPair({ source, value, rate }) {
  const numericValue = Number(value);
  const numericRate = Number(rate);

  if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isFinite(numericRate) || numericRate <= 0) {
    return { amount: 0, result: 0, source };
  }

  if (source === "bs") {
    return { amount: numericValue, result: computeConversion(numericValue, numericRate), source };
  }

  return { amount: numericValue * numericRate, result: numericValue, source };
}

(() => {
  "use strict";

  if (typeof document === "undefined") {
    return;
  }

  const BCV_API_URL = "https://ve.dolarapi.com/v1/dolares/oficial";
  const PARALLEL_API_URL = "https://ve.dolarapi.com/v1/dolares/paralelo";
  const BCV_CACHE_KEY = "cambio-ve:bcv-rate";
  const PARALLEL_CACHE_KEY = "cambio-ve:parallel-rate";
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bsInput = document.getElementById("bs-input");
  const bcvUsdInput = document.getElementById("bcv-usd-input");
  const parallelUsdInput = document.getElementById("parallel-usd-input");
  const bcvRateInput = document.getElementById("bcv-rate-input");
  const parallelRateInput = document.getElementById("parallel-rate-input");
  const bcvMeta = document.getElementById("bcv-meta");
  const parallelMeta = document.getElementById("parallel-meta");
  const bcvRow = document.getElementById("bcv-row");
  const parallelRow = document.getElementById("parallel-row");
  const gapText = document.getElementById("gap-text");
  const refreshRatesBtn = document.getElementById("refresh-rates-btn");
  const refreshStatus = document.getElementById("refresh-status");

  const fmt = (n, decimals = 2) =>
    n.toLocaleString("es-VE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const fmtInput = (n) => {
    if (!Number.isFinite(n)) return "";
    return String(Number(n.toFixed(2)));
  };

  const relativeDay = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("es-VE", { day: "2-digit", month: "short" });
    } catch {
      return "";
    }
  };

  function loadCache(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCache(key, rate, sourceDate) {
    try {
      localStorage.setItem(key, JSON.stringify({ rate, sourceDate, fetchedAt: Date.now() }));
    } catch {
      // ignore storage problems
    }
  }

  function updateGap() {
    const bcvRate = parseFloat(bcvRateInput.value);
    const parallelRate = parseFloat(parallelRateInput.value);

    if (!bcvRate || !parallelRate || bcvRate <= 0 || parallelRate <= 0) {
      gapText.textContent = "Ingresa un valor o actualiza las tasas para ver la brecha";
      return;
    }

    const diffPct = ((parallelRate - bcvRate) / bcvRate) * 100;
    const isPremium = diffPct >= 0;
    const label = isPremium ? "más cara que el BCV" : "más barata que el BCV";
    gapText.textContent = `P2P está ${fmt(Math.abs(diffPct), 1)}% ${label}`;
  }

  function applyRateValue(rateInput, metaEl, rowEl, rate, metaText, stale) {
    rateInput.value = rate ? String(rate) : "";
    metaEl.textContent = metaText;
    rowEl.classList.toggle("stale", !!stale);
    updateGap();
  }

  async function fetchRate(url, cacheKey, rateInput, metaEl, rowEl, label, useLocalFallback = true) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("bad response");

      const data = await response.json();
      const rate = data.promedio ?? data.venta ?? data.compra ?? data.price ?? data.tasa ?? data.value;

      if (!rate) throw new Error("no rate field");

      saveCache(cacheKey, rate, data.fechaActualizacion || data.date || null);
      const day = data.fechaActualizacion || data.date ? relativeDay(data.fechaActualizacion || data.date) : "hoy";
      applyRateValue(rateInput, metaEl, rowEl, rate, `${label} · ${day}`, false);
      return rate;
    } catch (err) {
      if (!useLocalFallback) {
        return null;
      }

      const cached = loadCache(cacheKey);
      if (cached) {
        applyRateValue(rateInput, metaEl, rowEl, cached.rate, "sin conexión · ultimo valor guardado", true);
        return cached.rate;
      }

      applyRateValue(rateInput, metaEl, rowEl, null, "no se pudo cargar · ingresa manualmente", true);
      return null;
    }
  }

  async function refreshRates() {
    refreshRatesBtn.disabled = true;
    refreshRatesBtn.classList.add("is-loading");
    refreshStatus.textContent = "Actualizando...";
    bcvMeta.textContent = "consultando API...";
    parallelMeta.textContent = "consultando API...";

    const [bcvRate, parallelRate] = await Promise.all([
      fetchRate(BCV_API_URL, BCV_CACHE_KEY, bcvRateInput, bcvMeta, bcvRow, "oficial", false),
      fetchRate(PARALLEL_API_URL, PARALLEL_CACHE_KEY, parallelRateInput, parallelMeta, parallelRow, "paralelo", false)
    ]);

    if (bcvRate && parallelRate) {
      syncFromCurrentSource();
      refreshStatus.textContent = "Actualizado ahora";
    } else {
      refreshStatus.textContent = "No se pudo actualizar";
      if (bcvRate === null) bcvMeta.textContent = "sin conexión · conserva el último valor";
      if (parallelRate === null) parallelMeta.textContent = "sin conexión · conserva el último valor";
    }

    refreshRatesBtn.disabled = false;
    refreshRatesBtn.classList.remove("is-loading");
  }

  function initRates() {
    const cachedBcv = loadCache(BCV_CACHE_KEY);
    const cachedParallel = loadCache(PARALLEL_CACHE_KEY);

    if (cachedBcv && Date.now() - cachedBcv.fetchedAt < DAY_MS) {
      const day = cachedBcv.sourceDate ? relativeDay(cachedBcv.sourceDate) : "hoy";
      applyRateValue(bcvRateInput, bcvMeta, bcvRow, cachedBcv.rate, `oficial · ${day} · guardado`, false);
    } else {
      bcvMeta.textContent = "cargando…";
    }

    if (cachedParallel && Date.now() - cachedParallel.fetchedAt < DAY_MS) {
      const day = cachedParallel.sourceDate ? relativeDay(cachedParallel.sourceDate) : "hoy";
      applyRateValue(parallelRateInput, parallelMeta, parallelRow, cachedParallel.rate, `paralelo · ${day} · guardado`, false);
    } else {
      parallelMeta.textContent = "cargando…";
    }

    Promise.all([
      fetchRate(BCV_API_URL, BCV_CACHE_KEY, bcvRateInput, bcvMeta, bcvRow, "oficial"),
      fetchRate(PARALLEL_API_URL, PARALLEL_CACHE_KEY, parallelRateInput, parallelMeta, parallelRow, "paralelo")
    ]).then(([bcvRate, parallelRate]) => {
      if (bcvRate && parallelRate) syncFromCurrentSource();
    });
  }

  function syncFromCurrentSource() {
    const bsValue = parseFloat(bsInput.value);
    const bcvUsdValue = parseFloat(bcvUsdInput.value);
    const parallelUsdValue = parseFloat(parallelUsdInput.value);
    const bcvRate = parseFloat(bcvRateInput.value);
    const parallelRate = parseFloat(parallelRateInput.value);

    if (!Number.isFinite(bcvRate) || bcvRate <= 0 || !Number.isFinite(parallelRate) || parallelRate <= 0) {
      updateGap();
      return;
    }

    if (!Number.isNaN(bsValue)) {
      bcvUsdInput.value = fmtInput(bsValue / bcvRate);
      parallelUsdInput.value = fmtInput(bsValue / parallelRate);
      return;
    }

    if (!Number.isNaN(bcvUsdValue)) {
      bsInput.value = fmtInput(bcvUsdValue * bcvRate);
      parallelUsdInput.value = fmtInput((bcvUsdValue * bcvRate) / parallelRate);
      return;
    }

    if (!Number.isNaN(parallelUsdValue)) {
      bsInput.value = fmtInput(parallelUsdValue * parallelRate);
      bcvUsdInput.value = fmtInput((parallelUsdValue * parallelRate) / bcvRate);
      return;
    }

    updateGap();
  }

  function applyManualRateInput(input, metaEl, rowEl, key) {
    const raw = parseFloat(input.value);
    metaEl.textContent = "ingresado manualmente";
    rowEl.classList.remove("stale");
    if (Number.isFinite(raw) && raw > 0) {
      saveCache(key, raw, null);
    }
    updateGap();
  }

  function onValueInputChanged(source) {
    const bsValue = parseFloat(bsInput.value);
    const bcvUsdValue = parseFloat(bcvUsdInput.value);
    const parallelUsdValue = parseFloat(parallelUsdInput.value);
    const bcvRate = parseFloat(bcvRateInput.value);
    const parallelRate = parseFloat(parallelRateInput.value);

    if (!Number.isFinite(bcvRate) || bcvRate <= 0 || !Number.isFinite(parallelRate) || parallelRate <= 0) {
      return;
    }

    if (source === "bs") {
      if (Number.isNaN(bsValue)) {
        bcvUsdInput.value = "";
        parallelUsdInput.value = "";
        return;
      }
      bcvUsdInput.value = fmtInput(bsValue / bcvRate);
      parallelUsdInput.value = fmtInput(bsValue / parallelRate);
      return;
    }

    if (source === "bcv-usd") {
      if (Number.isNaN(bcvUsdValue)) {
        bsInput.value = "";
        parallelUsdInput.value = "";
        return;
      }
      bsInput.value = fmtInput(bcvUsdValue * bcvRate);
      parallelUsdInput.value = fmtInput((bcvUsdValue * bcvRate) / parallelRate);
      return;
    }

    if (source === "parallel-usd") {
      if (Number.isNaN(parallelUsdValue)) {
        bsInput.value = "";
        bcvUsdInput.value = "";
        return;
      }
      bsInput.value = fmtInput(parallelUsdValue * parallelRate);
      bcvUsdInput.value = fmtInput((parallelUsdValue * parallelRate) / bcvRate);
    }
  }

  bsInput.addEventListener("input", () => onValueInputChanged("bs"));
  bcvUsdInput.addEventListener("input", () => onValueInputChanged("bcv-usd"));
  parallelUsdInput.addEventListener("input", () => onValueInputChanged("parallel-usd"));

  bcvRateInput.addEventListener("input", () => {
    applyManualRateInput(bcvRateInput, bcvMeta, bcvRow, BCV_CACHE_KEY);
    onValueInputChanged(document.activeElement === bcvUsdInput ? "bcv-usd" : document.activeElement === parallelUsdInput ? "parallel-usd" : document.activeElement === bsInput ? "bs" : "bs");
  });

  parallelRateInput.addEventListener("input", () => {
    applyManualRateInput(parallelRateInput, parallelMeta, parallelRow, PARALLEL_CACHE_KEY);
    onValueInputChanged(document.activeElement === bcvUsdInput ? "bcv-usd" : document.activeElement === parallelUsdInput ? "parallel-usd" : document.activeElement === bsInput ? "bs" : "bs");
  });

  refreshRatesBtn.addEventListener("click", refreshRates);
  initRates();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/xcambio/sw.js").catch(() => {
        // service worker is optional; ignore registration failures
      });
    });
  }
})();

if (typeof module !== "undefined") {
  module.exports = { computeConversion, getUpdatedPair };
}
