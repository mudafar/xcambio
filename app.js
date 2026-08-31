(() => {
  "use strict";

  const BCV_API_URL = "https://ve.dolarapi.com/v1/dolares/oficial";
  const CACHE_KEY = "cambio-ve:bcv";
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bcvInput = document.getElementById("bcv-input");
  const bcvMeta = document.getElementById("bcv-meta");
  const bcvRow = document.getElementById("bcv-row");
  const p2pInput = document.getElementById("p2p-input");
  const amountInput = document.getElementById("amount-input");
  const amountLabel = document.getElementById("amount-label");
  const amountPrefix = document.getElementById("amount-prefix");
  const resultLabel = document.getElementById("result-label");
  const resultPrefix = document.getElementById("result-prefix");
  const resultOutput = document.getElementById("result-output");
  const swapBtn = document.getElementById("swap-btn");
  const gapText = document.getElementById("gap-text");

  // direction: "bs2usdt" | "usdt2bs"
  let direction = "bs2usdt";

  const fmt = (n, decimals = 2) =>
    n.toLocaleString("es-VE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const relativeDay = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("es-VE", { day: "2-digit", month: "short" });
    } catch {
      return "";
    }
  };

  // ---------- BCV fetch + daily cache ----------

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCache(rate, sourceDate) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ rate, sourceDate, fetchedAt: Date.now() })
      );
    } catch {
      /* storage unavailable, ignore */
    }
  }

  function applyBcvRate(rate, metaText, stale) {
    bcvInput.value = rate ? rate : "";
    bcvMeta.textContent = metaText;
    bcvRow.classList.toggle("stale", !!stale);
    recalc();
  }

  async function fetchBcvRate() {
    try {
      const res = await fetch(BCV_API_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      const rate = data.promedio ?? data.venta ?? data.compra;
      if (!rate) throw new Error("no rate field");
      saveCache(rate, data.fechaActualizacion || null);
      const day = data.fechaActualizacion ? relativeDay(data.fechaActualizacion) : "hoy";
      applyBcvRate(rate, `oficial · ${day}`, false);
    } catch (err) {
      const cached = loadCache();
      if (cached) {
        applyBcvRate(cached.rate, "sin conexión · último valor guardado", true);
      } else {
        applyBcvRate(null, "no se pudo cargar · ingresa manualmente", true);
      }
    }
  }

  function initBcv() {
    const cached = loadCache();
    if (cached && Date.now() - cached.fetchedAt < DAY_MS) {
      const day = cached.sourceDate ? relativeDay(cached.sourceDate) : "hoy";
      applyBcvRate(cached.rate, `oficial · ${day} · guardado`, false);
      return;
    }
    bcvMeta.textContent = "cargando…";
    fetchBcvRate();
  }

  // manual edits to BCV input override and mark as manual
  bcvInput.addEventListener("input", () => {
    bcvMeta.textContent = "ingresado manualmente";
    bcvRow.classList.remove("stale");
    recalc();
  });

  // ---------- calculator ----------

  function setDirectionLabels() {
    if (direction === "bs2usdt") {
      amountLabel.textContent = "Bolívares";
      amountPrefix.textContent = "Bs.";
      resultLabel.textContent = "USDT";
      resultPrefix.textContent = "$";
    } else {
      amountLabel.textContent = "USDT";
      amountPrefix.textContent = "$";
      resultLabel.textContent = "Bolívares";
      resultPrefix.textContent = "Bs.";
    }
  }

  function recalc() {
    const amount = parseFloat(amountInput.value);
    const p2pRate = parseFloat(p2pInput.value);
    const bcvRate = parseFloat(bcvInput.value);

    const activeRate = p2pRate > 0 ? p2pRate : null;

    if (!isNaN(amount) && amount >= 0 && activeRate) {
      const out =
        direction === "bs2usdt" ? amount / activeRate : amount * activeRate;
      resultOutput.textContent = fmt(out, direction === "bs2usdt" ? 2 : 2);
    } else {
      resultOutput.textContent = "0,00";
    }

    updateGap(bcvRate, p2pRate);
  }

  function updateGap(bcvRate, p2pRate) {
    if (!bcvRate || !p2pRate || bcvRate <= 0 || p2pRate <= 0) {
      gapText.innerHTML = "Ingresa ambas tasas para ver la brecha";
      return;
    }
    const diffPct = ((p2pRate - bcvRate) / bcvRate) * 100;
    const isPremium = diffPct >= 0;
    const label = isPremium ? "más cara que BCV" : "más barata que BCV";
    const pillClass = isPremium ? "gap-pill--warn" : "gap-pill--good";
    gapText.innerHTML = `<span class="gap-pill ${pillClass}">P2P ${fmt(Math.abs(diffPct), 1)}% ${label}</span>`;
  }

  amountInput.addEventListener("input", recalc);
  p2pInput.addEventListener("input", recalc);

  swapBtn.addEventListener("click", () => {
    direction = direction === "bs2usdt" ? "usdt2bs" : "bs2usdt";
    setDirectionLabels();
    amountInput.value = "";
    resultOutput.textContent = "0,00";
    recalc();
    amountInput.focus();
  });

  // ---------- init ----------

  setDirectionLabels();
  initBcv();
})();
