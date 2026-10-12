(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Config
  ------------------------------------------------------------------- */
  const API_URL = "/predict";            // same origin; change if the API lives elsewhere
  const REQUEST_TIMEOUT_MS = 90000;      // free hosting can take a while to wake up
  const COLD_START_HINT_MS = 5000;
  const MIN_LOADING_MS = 700;

  const EXAMPLES = {
    steady: {
      person_age: 38, person_income: 92000, person_home_ownership: "MORTGAGE",
      person_emp_length: 11, loan_intent: "HOMEIMPROVEMENT", loan_grade: "A",
      loan_amnt: 9000, loan_int_rate: 7.4, cb_person_default_on_file: "N",
      cb_person_cred_hist_length: 14,
    },
    stretched: {
      person_age: 23, person_income: 26000, person_home_ownership: "RENT",
      person_emp_length: 1, loan_intent: "DEBTCONSOLIDATION", loan_grade: "F",
      loan_amnt: 16000, loan_int_rate: 19.8, cb_person_default_on_file: "Y",
      cb_person_cred_hist_length: 2,
    },
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  const form = $("#loan-form");
  const panel = $("#result");

  /* ------------------------------------------------------------------
     Numeric fields (text box + slider kept in sync)
  ------------------------------------------------------------------- */
  const fields = {};

  $$(".field").forEach((el) => {
    const f = {
      key: el.dataset.key,
      slider: $(".slider", el),
      input: $(".value-input", el),
      box: $(".value-box", el),
      error: $(".field-error", el),
      min: Number(el.dataset.min),
      max: Number(el.dataset.max),
      minDec: Number(el.dataset.minDec || 0),
      maxDec: Number(el.dataset.maxDec || 0),
      isInt: el.dataset.int === "true",
      message: el.dataset.error,
      value: NaN,
    };
    fields[f.key] = f;
  });

  const parse = (raw) => parseFloat(String(raw).replace(/[^\d.]/g, ""));

  const format = (f, v) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: f.minDec,
      maximumFractionDigits: f.maxDec,
    });

  function paintSlider(f) {
    const lo = Number(f.slider.min);
    const hi = Number(f.slider.max);
    if (Number.isFinite(f.value)) {
      const v = clamp(f.value, lo, hi);
      f.slider.value = v;
      f.slider.style.setProperty("--fill", ((v - lo) / (hi - lo)) * 100 + "%");
    } else {
      f.slider.style.setProperty("--fill", "0%");
    }
  }

  function clearError(f) {
    f.error.hidden = true;
    f.box.classList.remove("invalid");
    f.input.removeAttribute("aria-invalid");
  }

  function validate(f) {
    const ok = Number.isFinite(f.value) && f.value >= f.min && f.value <= f.max;
    if (ok) {
      clearError(f);
    } else {
      f.error.textContent = f.message;
      f.error.hidden = false;
      f.box.classList.add("invalid");
      f.input.setAttribute("aria-invalid", "true");
    }
    return ok;
  }

  function setValue(f, v) {
    f.value = v;
    f.input.value = format(f, v);
    paintSlider(f);
    clearError(f);
    updateRatio();
  }

  Object.values(fields).forEach((f) => {
    f.slider.addEventListener("input", () => setValue(f, Number(f.slider.value)));

    f.input.addEventListener("input", () => {
      f.value = parse(f.input.value);
      paintSlider(f);
      clearError(f);
      updateRatio();
    });

    f.input.addEventListener("blur", () => {
      if (Number.isFinite(f.value)) {
        if (f.isInt) f.value = Math.round(f.value);
        f.input.value = format(f, f.value);
        paintSlider(f);
      }
      validate(f);
    });
  });

  /* ------------------------------------------------------------------
     Loan as a share of income (sent to the API as loan_percent_income)
  ------------------------------------------------------------------- */
  const ratioValue = $("#ratio-value");
  const ratioBar = $("#ratio-bar");

  function currentRatio() {
    const income = fields.person_income.value;
    const amount = fields.loan_amnt.value;
    if (!Number.isFinite(income) || !Number.isFinite(amount) || income <= 0) return null;
    return amount / income;
  }

  function updateRatio() {
    const r = currentRatio();
    if (r === null) {
      ratioValue.textContent = "–";
      ratioBar.style.width = "0%";
      return;
    }
    ratioValue.textContent = Math.round(r * 100) + "%";
    ratioBar.style.width = clamp(r, 0, 1) * 100 + "%";
  }

  /* ------------------------------------------------------------------
     Segmented controls: sliding thumb
  ------------------------------------------------------------------- */
  const segmented = $$(".segmented");

  function placeThumb(seg, animate = true) {
    const thumb = $(".thumb", seg);
    const checked = $("input:checked", seg);
    const label = checked && $(`label[for="${checked.id}"]`, seg);
    if (!label) return;
    if (!animate) thumb.style.transition = "none";
    thumb.style.width = label.offsetWidth + "px";
    thumb.style.transform = `translateX(${label.offsetLeft}px)`;
    if (!animate) {
      void thumb.offsetWidth;
      thumb.style.transition = "";
    }
  }

  const placeAll = (animate = false) => segmented.forEach((s) => placeThumb(s, animate));

  form.addEventListener("change", (e) => {
    if (e.target.matches('input[type="radio"]')) {
      const seg = e.target.closest(".segmented");
      if (seg) placeThumb(seg);
    }
  });
  window.addEventListener("resize", () => placeAll(false));

  const getChoice = (name) => form.elements[name].value;

  function setChoice(name, value) {
    const radio = $(`input[name="${name}"][value="${value}"]`, form);
    if (!radio) return;
    radio.checked = true;
    const seg = radio.closest(".segmented");
    if (seg) placeThumb(seg);
  }

  /* ------------------------------------------------------------------
     Gauge
  ------------------------------------------------------------------- */
  const G = { cx: 160, cy: 170, r: 120 };
  const gFill = $("#gFill");
  const gKnob = $("#gKnob");
  const gNumber = $("#gNumber");
  const gTick = $("#gTick");

  let shown = 0;
  let raf = 0;

  const pct = (p) => (p * 100).toFixed(1) + "%";

  const pointOnArc = (p, radius) => {
    const a = Math.PI * (1 - p);
    return { x: G.cx + radius * Math.cos(a), y: G.cy - radius * Math.sin(a) };
  };

  function drawGauge(p) {
    shown = p;
    gFill.style.strokeDasharray = `${(p * 100).toFixed(3)} 100`;
    gFill.style.opacity = p > 0.0005 ? 1 : 0;
    const k = pointOnArc(p, G.r);
    gKnob.setAttribute("cx", k.x.toFixed(2));
    gKnob.setAttribute("cy", k.y.toFixed(2));
    gNumber.textContent = pct(p);
  }

  function animateGauge(to) {
    cancelAnimationFrame(raf);
    if (reduceMotion.matches) {
      drawGauge(to);
      return Promise.resolve();
    }
    const from = shown;
    const duration = 1500;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 4);
        drawGauge(from + (to - from) * eased);
        if (t < 1) raf = requestAnimationFrame(tick);
        else resolve();
      };
      raf = requestAnimationFrame(tick);
    });
  }

  function placeTick(threshold) {
    const a = pointOnArc(threshold, G.r - 15);
    const b = pointOnArc(threshold, G.r + 15);
    gTick.setAttribute("x1", a.x.toFixed(2));
    gTick.setAttribute("y1", a.y.toFixed(2));
    gTick.setAttribute("x2", b.x.toFixed(2));
    gTick.setAttribute("y2", b.y.toFixed(2));
  }

  /* ------------------------------------------------------------------
     Result panel state
  ------------------------------------------------------------------- */
  const verdict = $("#verdict");
  const cutoff = $("#cutoff");
  const cutoffValue = $("#cutoff-value");
  const resultText = $("#result-text");
  const note = $("#note");
  const status = $("#status");
  const submitBtn = $("#submit-btn");
  const btnLabel = $("#btn-label");

  const IDLE_TEXT = "Fill in the application, then choose Assess risk. The estimate appears here.";

  function setNote(message, kind = "info") {
    note.textContent = message;
    note.dataset.kind = kind;
    note.hidden = false;
  }
  const clearNote = () => { note.hidden = true; note.textContent = ""; };

  function setIdle() {
    cancelAnimationFrame(raf);
    panel.dataset.state = "idle";
    panel.classList.remove("has-result", "is-loading");
    drawGauge(0);
    gNumber.textContent = "–";
    verdict.textContent = "No result yet";
    cutoff.hidden = true;
    resultText.textContent = IDLE_TEXT;
    status.textContent = "";
    clearNote();
  }

  function setBusy(on) {
    panel.classList.toggle("is-loading", on);
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-busy", on);
    submitBtn.setAttribute("aria-busy", String(on));
    btnLabel.textContent = on ? "Assessing…" : "Assess risk";
  }

  /* ------------------------------------------------------------------
     API
  ------------------------------------------------------------------- */
  function collect() {
    const ratio = currentRatio();
    return {
      person_age: Math.round(fields.person_age.value),
      person_income: fields.person_income.value,
      person_home_ownership: getChoice("person_home_ownership"),
      person_emp_length: fields.person_emp_length.value,
      loan_intent: getChoice("loan_intent"),
      loan_grade: getChoice("loan_grade"),
      loan_amnt: fields.loan_amnt.value,
      loan_int_rate: fields.loan_int_rate.value,
      loan_percent_income: Math.round(ratio * 100) / 100,
      cb_person_default_on_file: getChoice("cb_person_default_on_file"),
      cb_person_cred_hist_length: Math.round(fields.cb_person_cred_hist_length.value),
    };
  }

  async function describeError(res) {
    if (res.status === 422) {
      try {
        const body = await res.json();
        if (Array.isArray(body.detail)) {
          const parts = body.detail.map((d) => {
            const name = String(d.loc[d.loc.length - 1]).replace(/_/g, " ");
            return `${name}: ${d.msg}`;
          });
          return `The API rejected some values. ${parts.join("; ")}`;
        }
      } catch (_) { /* fall through */ }
      return "The API rejected some of the values. Check the form and try again.";
    }
    if (res.status >= 500) {
      return "The model couldn't score this application. Check the server logs for details.";
    }
    return `The request failed (status ${res.status}). Try again.`;
  }

  async function postPrediction(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        err.name === "AbortError"
          ? "The server took too long to respond. Try again in a moment."
          : "Couldn't reach the server. Check your connection and try again."
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(await describeError(res));
    return res.json();
  }

  async function showResult(data) {
    const p = clamp(Number(data.default_probability), 0, 1);
    const t = clamp(Number(data.threshold), 0, 1);
    const high = data.default_prediction === 1;
    const near = Math.abs(p - t) <= 0.05;

    panel.dataset.state = high ? "high" : "low";
    verdict.textContent = high ? "High risk" : "Low risk";
    cutoffValue.textContent = pct(t);
    cutoff.hidden = false;
    placeTick(t);
    panel.classList.add("has-result");

    const sentence =
      `The model estimates a ${pct(p)} chance of default. ` +
      (high ? `That is at or above the ${pct(t)} cutoff.` : `That is below the ${pct(t)} cutoff.`) +
      (near ? " It is close to the cutoff, so review this application with extra care." : "");
    resultText.textContent = sentence;
    status.textContent = `${high ? "High risk" : "Low risk"}. ${sentence}`;

    if (window.matchMedia("(max-width: 959px)").matches) {
      panel.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "nearest" });
    }
    await animateGauge(p);
  }

  /* ------------------------------------------------------------------
     Events
  ------------------------------------------------------------------- */
  let busy = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    let firstInvalid = null;
    Object.values(fields).forEach((f) => {
      if (!validate(f) && !firstInvalid) firstInvalid = f;
    });
    if (firstInvalid) {
      setNote("Fix the highlighted fields, then assess again.", "error");
      firstInvalid.input.focus();
      return;
    }

    clearNote();
    busy = true;
    setBusy(true);
    const hint = setTimeout(
      () => setNote("Still working. If the server was idle, the first request can take up to a minute."),
      COLD_START_HINT_MS
    );

    try {
      const started = performance.now();
      const data = await postPrediction(collect());
      const wait = MIN_LOADING_MS - (performance.now() - started);
      if (wait > 0) await sleep(wait);
      clearTimeout(hint);
      clearNote();
      busy = false;
      setBusy(false);
      await showResult(data);
    } catch (err) {
      clearTimeout(hint);
      busy = false;
      setBusy(false);
      setNote(err.message, "error");
    }
  });

  $$("[data-example]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const example = EXAMPLES[btn.dataset.example];
      Object.entries(example).forEach(([key, value]) => {
        if (fields[key]) setValue(fields[key], value);
        else setChoice(key, value);
      });
    })
  );

  $("[data-reset]").addEventListener("click", () => {
    form.reset();
    Object.values(fields).forEach((f) => setValue(f, parse(f.input.value)));
    placeAll(true);
    setIdle();
  });

  /* ------------------------------------------------------------------
     Init
  ------------------------------------------------------------------- */
  Object.values(fields).forEach((f) => setValue(f, parse(f.input.value)));
  setIdle();
  placeAll(false);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => placeAll(false));
  }
})();
