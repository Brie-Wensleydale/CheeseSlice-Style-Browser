/* Style Atlas browser — vanilla JS, zero dependencies. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const COPY_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>';

let DATA = { characters: [], models: [], sections: {}, styles: [], base_prompt: "" };
let state = { character: "", model: "", section: "", view: "char", search: "", rating: "", tags: [], sort: "index", size: "m", band: "" };
let compareA = null, compareB = null;
let lbStyle = null, lbView = "char", lbIdx = 0;

const STATIC = typeof window !== "undefined" && window.STATIC === true;
const INDEX_URL = STATIC ? "data.json" : "/api/index";

const TYPE_ORDER = ["char", "pose", "compare", "bg", "bg_mannequin", "bg_pose", "bg_compare", "fusion"];
const TYPE_LABELS = {
  char: "char", pose: "pose", compare: "compare",
  bg: "background", bg_mannequin: "mannequin on bg", bg_pose: "posed on bg",
  bg_compare: "bg compare", fusion: "fusion",
};

/* ---------- local store (static mode has no server) ---------- */
const LS_RATINGS = "atlas.ratings", LS_TAGS = "atlas.tags";
function lsGet(k, dflt) {
  try { return JSON.parse(localStorage.getItem(k) || "null") ?? dflt; } catch (e) { return dflt; }
}
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

/* ---------- bootstrap ---------- */
async function init() {
  if (STATIC) document.body.classList.add("static");
  const r = await fetch(INDEX_URL, { cache: "no-cache" });
  DATA = await r.json();
  if (!DATA.models) DATA.models = [...new Set(DATA.styles.map((s) => s.model).filter(Boolean))];
  if (STATIC) {
    const ratings = lsGet(LS_RATINGS, {}), tags = lsGet(LS_TAGS, {});
    for (const s of DATA.styles) {
      if (ratings[s.id] != null) s.rating = ratings[s.id];
      if (tags[s.id]) s.tags = tags[s.id];
    }
  }
  state.character = DATA.characters[0] || "";
  state.model = DATA.models[0] || "";
  const savedSize = lsGet("atlas.size", "m");
  if (savedSize === "s" || savedSize === "m" || savedSize === "l") state.size = savedSize;
  document.querySelectorAll("#sizeToggle button").forEach((x) => x.classList.toggle("active", x.dataset.size === state.size));
  populateSelects();
  bindControls();
  render();
}

function populateSelects() {
  const m = $("modelFilter");
  m.innerHTML = "";
  const models = (DATA.models && DATA.models.length) ? DATA.models : ["—"];
  for (const x of models) m.appendChild(new Option(x, x));
  m.value = state.model;
  m.hidden = models.length < 2 && !models[0];

  const c = $("charFilter");
  c.innerHTML = "";
  for (const x of DATA.characters) c.appendChild(new Option(x, x));
  c.value = state.character;
}

/* ---------- event wiring ---------- */
function bindControls() {
  $("modelFilter").onchange = (e) => { state.model = e.target.value; state.section = ""; state.tags = []; render(); };
  $("charFilter").onchange = (e) => { state.character = e.target.value; state.section = ""; state.tags = []; render(); };
  $("ratingFilter").onchange = (e) => { state.rating = e.target.value; renderGrid(); };
  $("bandFilter").onchange = (e) => { state.band = e.target.value; renderGrid(); };
  $("sortSel").onchange = (e) => { state.sort = e.target.value; renderGrid(); };
  $("search").oninput = (e) => { state.search = e.target.value.toLowerCase(); renderGrid(); };
  $("search").onkeydown = (e) => { if (e.key === "Escape") { e.target.value = ""; state.search = ""; renderGrid(); } };

  document.querySelectorAll("#viewToggle button").forEach((b) => {
    b.onclick = () => {
      state.view = b.dataset.view;
      document.querySelectorAll("#viewToggle button").forEach((x) => x.classList.toggle("active", x === b));
      renderGrid();
    };
  });
  document.querySelectorAll("#sizeToggle button").forEach((b) => {
    b.onclick = () => {
      state.size = b.dataset.size;
      document.querySelectorAll("#sizeToggle button").forEach((x) => x.classList.toggle("active", x === b));
      lsSet("atlas.size", state.size);
      renderGrid();
    };
  });
  // lightbox
  $("lbClose").onclick = closeLightbox;
  $("lbBackdrop").onclick = closeLightbox;
  $("lbPrev").onclick = () => stepLightbox(-1);
  $("lbNext").onclick = () => stepLightbox(1);
  $("lbImgPrev").onclick = () => stepImage(-1);
  $("lbImgNext").onclick = () => stepImage(1);
  $("lbCopyFull").onclick = () => copyFullPrompt(lbStyle);
  $("lbCopyStyle").onclick = () => copyStylePrompt(lbStyle);
  $("lbSetA").onclick = () => { setCompare(lbStyle, "A"); toast("A: " + (styleById(lbStyle) || {}).style); };
  $("lbSetB").onclick = () => { setCompare(lbStyle, "B"); toast("B: " + (styleById(lbStyle) || {}).style); };
  $("lbRateClear").onclick = () => rate(null);
  $("lbStars").querySelectorAll("[data-r]").forEach((s) => { s.onclick = () => rate(parseInt(s.dataset.r)); });
  $("lbTagInput").onkeydown = onTagKey;
  $("dlRatings").onclick = (e) => { if (e.shiftKey) $("upRatings").click(); else exportRatings(); };
  $("upRatings").onchange = (e) => { if (e.target.files[0]) importRatings(e.target.files[0]); e.target.value = ""; };
  document.addEventListener("keydown", onGlobalKey);

  // compare
  $("compareOpen").onclick = () => openCompare(compareA, compareB, "slider");
  $("compareSideOpen").onclick = () => openCompare(compareA, compareB, "side");
  $("compareClear").onclick = clearCompare;
  $("cmClose").onclick = closeCompare;
  $("cmBackdrop").onclick = closeCompare;
  $("cmSliderMode").onclick = () => setCompareMode("slider");
  $("cmSideBySide").onclick = () => setCompareMode("side");
  $("cmA").onchange = (e) => { compareA = e.target.value || null; renderCompare(); };
  $("cmB").onchange = (e) => { compareB = e.target.value || null; renderCompare(); };
  bindDivider();
}

/* ---------- rendering ---------- */
function stylesForCharacter() {
  return DATA.styles.filter((s) => s.character === state.character && (!state.model || !s.model || s.model === state.model));
}

function availableTypes() {
  const set = new Set();
  for (const s of stylesForCharacter()) for (const t in s.images) if (s.images[t].length) set.add(t);
  return TYPE_ORDER.filter((t) => set.has(t));
}
function renderViewToggle() {
  const types = availableTypes();
  if (!types.includes(state.view)) state.view = types[0] || "char";
  const wrap = $("viewToggle");
  wrap.innerHTML = types.map((t) =>
    `<button data-view="${t}" class="${t === state.view ? "active" : ""}">${TYPE_LABELS[t] || t}</button>`
  ).join("");
  wrap.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { state.view = b.dataset.view; renderViewToggle(); renderGrid(); };
  });
}
function render() {
  renderViewToggle();
  renderSectionChips();
  renderTagChips();
  renderGrid();
}

function renderSectionChips() {
  const wrap = $("sectionChips");
  const secs = DATA.sections[state.character] || {};
  let html = `<span class="chip ${state.section === "" ? "active" : ""}" data-sec="">all traditions <span class="n">${stylesForCharacter().length}</span></span>`;
  for (const sec of Object.keys(secs)) {
    html += `<span class="chip ${state.section === sec ? "active" : ""}" data-sec="${esc(sec)}">${esc(sec)} <span class="n">${secs[sec]}</span></span>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => { state.section = c.dataset.sec; renderSectionChips(); renderGrid(); };
  });
}

function renderTagChips() {
  const wrap = $("tagChips");
  const all = new Map();
  for (const s of stylesForCharacter()) for (const t of s.tags) all.set(t, (all.get(t) || 0) + 1);
  if (all.size === 0) { wrap.innerHTML = ""; return; }
  let html = "";
  for (const [t, n] of [...all.entries()].sort()) {
    const on = state.tags.includes(t);
    html += `<span class="chip ${on ? "active" : ""}" data-tag="${esc(t)}">${esc(t)} <span class="n">${n}</span></span>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => {
      const t = c.dataset.tag;
      state.tags = state.tags.includes(t) ? state.tags.filter((x) => x !== t) : [...state.tags, t];
      renderTagChips(); renderGrid();
    };
  });
}

function filterStyles() {
  let list = stylesForCharacter();
  if (state.section) list = list.filter((s) => s.section === state.section);
  if (state.search) list = list.filter((s) => s.style.toLowerCase().includes(state.search));
  if (state.rating === "unrated") list = list.filter((s) => s.rating == null);
  else if (state.rating) { const n = parseInt(state.rating); list = list.filter((s) => s.rating != null && s.rating >= n); }
  if (state.tags.length) list = list.filter((s) => state.tags.every((t) => s.tags.includes(t)));
  if (state.band === "issues") list = list.filter((s) => s.audit && s.audit.band && s.audit.band !== "ok");
  else if (state.band) list = list.filter((s) => s.audit && s.audit.band === state.band);
  const by = state.sort;
  list.sort((a, b) => {
    if (by === "az") return a.style.localeCompare(b.style);
    if (by === "rating") return (b.rating || 0) - (a.rating || 0) || a.style.localeCompare(b.style);
    if (by === "badness") return ((b.audit && b.audit.badness) || 0) - ((a.audit && a.audit.badness) || 0) || a.style.localeCompare(b.style);
    return (a.index - b.index) || a.style.localeCompare(b.style);
  });
  return list;
}

function thumbFor(s) {
  let imgs = s.images[state.view];
  if (!imgs || imgs.length === 0) imgs = s.images.char;
  return imgs && imgs[0] ? imgs[0].thumb : null;
}

function renderGrid() {
  const list = filterStyles();
  const grid = $("grid");
  $("countBadge").textContent = `${list.length} / ${stylesForCharacter().length}`;
  $("empty").hidden = list.length > 0;
  grid.dataset.view = state.view;
  grid.dataset.size = state.size;

  grid.innerHTML = list.map((s) => {
    const thumb = thumbFor(s);
    const stars = s.rating ? "★".repeat(s.rating) + "☆".repeat(5 - s.rating) : "";
    const cmpClass = s.id === compareA ? " cmp-a" : s.id === compareB ? " cmp-b" : "";
    const band = s.audit && s.audit.band && s.audit.band !== "ok" ? s.audit.band : "";
    const badge = band ? `<span class="bandbadge band-${band}">${band === "label-mismatch" ? "mismatch" : band}</span>` : "";
    return `<div class="card${cmpClass}" data-id="${s.id}">
      <img class="thumb" loading="lazy" src="${esc(thumb || "")}" alt="">
      ${badge}
      <button class="cmpbtn" data-cmp="${s.id}" title="compare">⇄</button>
      <div class="info">
        <div class="namerow">
          <div class="name">${esc(s.style)}</div>
          <div class="copyrow">
            <button class="cbtn grey" data-copyfull="${s.id}" title="copy full prompt (base + style)">${COPY_SVG}</button>
            <button class="cbtn purple" data-copystyle="${s.id}" title="copy style prompt only">${COPY_SVG}</button>
          </div>
        </div>
        <div class="sec">${esc(s.section)}${s.rating ? `<span class="stars">${stars}</span>` : ""}</div>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".card").forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest(".cmpbtn, .cbtn")) return;
      openLightbox(card.dataset.id);
    };
  });
  grid.querySelectorAll(".cmpbtn").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); toggleComparePick(b.dataset.cmp); };
  });
  grid.querySelectorAll("[data-copyfull]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); copyFullPrompt(b.dataset.copyfull); };
  });
  grid.querySelectorAll("[data-copystyle]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); copyStylePrompt(b.dataset.copystyle); };
  });
}

/* ---------- prompt copying ---------- */
function styleById(id) { return DATA.styles.find((x) => x.id === id); }
function styleTextOf(s) { return (s && (s.style_text || "")) || ""; }
function fullPromptOf(s) {
  const prompts = DATA.prompts || {};
  const base = ((s && prompts[s.character]) || DATA.base_prompt || "").trim();
  const st = styleTextOf(s).trim();
  const tpl = DATA.prompt_template || "{prompt}, {style}";
  if (!st) return base;
  if (!base) return st;
  return tpl.replace("{prompt}", base).replace("{style}", st).replace(/,\s*$/, "");
}
async function copyText(text, label) {
  const t = (text || "").trim();
  if (!t) { toast("nothing to copy — this style has no text"); return; }
  try {
    await navigator.clipboard.writeText(t);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e2) {}
    ta.remove();
  }
  toast(`${label} copied (${t.length} chars)`);
}
function copyFullPrompt(id) {
  const s = styleById(id); if (!s) return;
  copyText(fullPromptOf(s), "full prompt");
}
function copyStylePrompt(id) {
  const s = styleById(id); if (!s) return;
  copyText(styleTextOf(s), "style prompt");
}

/* ---------- ratings / tags export-import ---------- */
function exportRatings() {
  const ratings = lsGet(LS_RATINGS, {});
  const tags = lsGet(LS_TAGS, {});
  const payload = {
    exported_at: new Date().toISOString(),
    character: state.character, model: state.model,
    ratings, tags,
    styles: Object.fromEntries(DATA.styles.filter((s) => ratings[s.id] || (tags[s.id] || []).length)
      .map((s) => [s.id, { style: s.style, section: s.section, rating: ratings[s.id] ?? null, tags: tags[s.id] || [] }])),
  };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `style-atlas-ratings-${state.character.replace(/\s+/g, "-").toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`${Object.keys(ratings).length} ratings, ${Object.keys(tags).length} tagged styles exported`);
}

function importRatings(file) {
  const fr = new FileReader();
  fr.onload = () => {
    let payload;
    try { payload = JSON.parse(fr.result); } catch (e) { toast("not a ratings JSON"); return; }
    if (!payload || typeof payload !== "object") { toast("not a ratings JSON"); return; }
    const ratings = { ...lsGet(LS_RATINGS, {}), ...(payload.ratings || {}) };
    const tags = { ...lsGet(LS_TAGS, {}), ...(payload.tags || {}) };
    lsSet(LS_RATINGS, ratings);
    lsSet(LS_TAGS, tags);
    for (const s of DATA.styles) {
      if (ratings[s.id] != null) s.rating = ratings[s.id];
      if (tags[s.id]) s.tags = tags[s.id];
    }
    renderTagChips();
    renderGrid();
    toast(`imported ${Object.keys(payload.ratings || {}).length} ratings, ${Object.keys(payload.tags || {}).length} tag entries`);
  };
  fr.readAsText(file);
}

/* ---------- compare selection ---------- */
function toggleComparePick(id) {
  if (compareA == null) { setCompare(id, "A"); return; }
  if (compareB == null && id !== compareA) { setCompare(id, "B"); openCompare(compareA, id, "slider"); return; }
  setCompare(id, "A"); setCompare(null, "B");
}
function setCompare(id, slot) {
  if (slot === "A") compareA = id;
  if (slot === "B") compareB = id;
  updateCompareBar();
  renderGrid();
}
function clearCompare() { compareA = null; compareB = null; updateCompareBar(); renderGrid(); }
function styleLabel(id) {
  const s = styleById(id);
  return s ? `${s.style}` : "—";
}
function updateCompareBar() {
  const bar = $("compareBar");
  bar.hidden = compareA == null && compareB == null;
  const parts = [compareA ? `A: ${styleLabel(compareA)}` : null, compareB ? `B: ${styleLabel(compareB)}` : null].filter(Boolean);
  $("compareLabel").textContent = "compare: " + (parts.join("  vs  ") || "pick A");
  $("compareOpen").disabled = !(compareA && compareB);
  $("compareSideOpen").disabled = !(compareA && compareB);
}

/* ---------- lightbox ---------- */
function openLightbox(id) {
  const s = styleById(id);
  if (!s) return;
  lbStyle = id; lbView = state.view in s.images ? state.view : "char"; lbIdx = 0;
  $("lightbox").hidden = false;
  document.body.style.overflow = "hidden";
  renderLightbox();
}
function closeLightbox() { $("lightbox").hidden = true; document.body.style.overflow = ""; }
function stepLightbox(dir) {
  const list = filterStyles();
  const i = list.findIndex((s) => s.id === lbStyle);
  const next = list[(i + dir + list.length) % list.length];
  if (next) { lbStyle = next.id; lbIdx = 0; renderLightbox(); }
}
function stepImage(dir) {
  const s = styleById(lbStyle); if (!s) return;
  const imgs = s.images[lbView] || [];
  lbIdx = (lbIdx + dir + imgs.length) % imgs.length;
  renderLightboxImage();
}

function renderLightbox() {
  const s = styleById(lbStyle); if (!s) return;
  $("lbTitle").textContent = s.style;
  $("lbMeta").textContent = `${s.character} · ${s.model || ""} · ${s.section} · #${s.index}`.replace(" ·  ·", " ·");
  if (s.audit && s.audit.band) {
    const bits = [s.audit.band];
    if (s.audit.ssim != null) bits.push("ssim " + Number(s.audit.ssim).toFixed(3));
    if (s.audit.badness != null) bits.push("badness " + Number(s.audit.badness).toFixed(2));
    $("lbMeta").textContent += " · " + bits.join(" · ");
    $("lbMeta").classList.toggle("lb-bad", s.audit.band === "dead");
  } else {
    $("lbMeta").classList.remove("lb-bad");
  }

  const tabs = TYPE_ORDER.filter((t) => s.images[t] && s.images[t].length);
  $("lbViewTabs").innerHTML = tabs.map((t) =>
    `<button data-v="${t}" class="${t === lbView ? "active" : ""}">${TYPE_LABELS[t] || t}${s.images[t].length > 1 ? " (" + s.images[t].length + ")" : ""}</button>`
  ).join("");
  $("lbViewTabs").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { lbView = b.dataset.v; lbIdx = 0; renderLightbox(); };
  });

  renderLightboxImage();
  renderStars(s.rating);
  renderTags(s);
  $("lbSetA").textContent = compareA === s.id ? "✓ A" : "set A";
  $("lbSetB").textContent = compareB === s.id ? "✓ B" : "set B";
}
function renderLightboxImage() {
  const s = styleById(lbStyle); if (!s) return;
  const imgs = s.images[lbView] || [];
  if (imgs.length === 0) { $("lbImg").src = ""; $("lbImgIdx").textContent = ""; $("lbImgNav").hidden = true; return; }
  lbIdx = Math.min(lbIdx, imgs.length - 1);
  $("lbImg").src = imgs[lbIdx].url;
  $("lbImgIdx").textContent = `${lbIdx + 1} / ${imgs.length}`;
  $("lbImgNav").hidden = imgs.length < 2;
}

function renderStars(rating) {
  $("lbStars").querySelectorAll("[data-r]").forEach((s) => {
    s.classList.toggle("on", rating != null && parseInt(s.dataset.r) <= rating);
  });
}
async function rate(n) {
  const s = styleById(lbStyle);
  s.rating = n;
  if (STATIC) {
    const ratings = lsGet(LS_RATINGS, {});
    if (n == null) delete ratings[s.id]; else ratings[s.id] = n;
    lsSet(LS_RATINGS, ratings);
  } else {
    try {
      await fetch("/api/rate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lbStyle, rating: n }),
      });
    } catch (e) {}
  }
  renderStars(s.rating);
  renderGrid();
  toast(n ? `rated ${n}★` : "rating cleared");
}

function renderTags(s) {
  $("lbTags").innerHTML = s.tags.map((t) =>
    `<span class="tagpill">#${esc(t)} <span class="x" data-tag="${esc(t)}">✕</span></span>`
  ).join("");
  $("lbTags").querySelectorAll(".x").forEach((x) => {
    x.onclick = () => saveTags(s.tags.filter((t) => t !== x.dataset.tag));
  });
}
function onTagKey(e) {
  if (e.key !== "Enter" && e.key !== ",") return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (!v) return;
  const s = styleById(lbStyle);
  saveTags([...s.tags, ...v.split(",").map((x) => x.trim()).filter(Boolean)]);
  e.target.value = "";
}
async function saveTags(tags) {
  const s = styleById(lbStyle);
  s.tags = tags;
  if (STATIC) {
    const store = lsGet(LS_TAGS, {});
    store[s.id] = tags;
    lsSet(LS_TAGS, store);
  } else {
    try {
      await fetch("/api/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lbStyle, tags }),
      });
    } catch (e) {}
  }
  renderTags(s);
  renderTagChips();
  renderGrid();
}

/* ---------- compare modal ---------- */
function openCompare(a, b, mode) {
  compareA = a; compareB = b;
  const all = DATA.styles.filter((s) => s.character === state.character);
  const opts = all.map((s) => `<option value="${s.id}">${esc(s.title || s.style)}</option>`).join("");
  $("cmA").innerHTML = `<option value="">— pick A —</option>` + opts;
  $("cmB").innerHTML = `<option value="">— pick B —</option>` + opts;
  $("cmA").value = compareA || ""; $("cmB").value = compareB || "";
  $("compareModal").hidden = false;
  document.body.style.overflow = "hidden";
  renderCompare();
  setDivider(50);
  setCompareMode(mode || "slider");
  updateCompareBar();
}
function closeCompare() { $("compareModal").hidden = true; document.body.style.overflow = ""; }
function compareImage(id) {
  const s = styleById(id); if (!s) return null;
  const imgs = (state.view in s.images ? s.images[state.view] : s.images.char) || [];
  return imgs[0] || null;
}
function renderCompare() {
  const a = compareImage(compareA), b = compareImage(compareB);
  // bottom layer = A (left), clipped top layer = B (right of the handle)
  $("cmImgBottom").src = a ? a.url : "";
  $("cmImgTop").src = b ? b.url : "";
  $("cmTagA").textContent = compareA ? "A · " + styleLabel(compareA) : "";
  $("cmTagB").textContent = compareB ? "B · " + styleLabel(compareB) : "";
  const side = document.createElement("div");
  side.className = "cm-side";
  side.innerHTML =
    `<figure class="cm-side-fig">${a ? `<img src="${a.url}" alt="">` : ""}<figcaption>A · ${esc(styleLabel(compareA))}</figcaption></figure>` +
    `<figure class="cm-side-fig">${b ? `<img src="${b.url}" alt="">` : ""}<figcaption>B · ${esc(styleLabel(compareB))}</figcaption></figure>`;
  const old = $("cmStage").querySelector(".cm-side");
  if (old) old.remove();
  $("cmStage").appendChild(side);
}
function setCompareMode(mode) {
  const stage = $("cmStage");
  const side = mode === "side";
  stage.classList.toggle("side", side);
  $("cmSideBySide").classList.toggle("active", side);
  $("cmSliderMode").classList.toggle("active", !side);
  const hint = document.querySelector(".cm-hint");
  if (hint) hint.style.display = side ? "none" : "";
  renderCompare();
}
function setDivider(p) {
  $("cmImgTop").style.clipPath = `inset(0 0 0 ${p}%)`;
  $("cmDivider").style.left = p + "%";
}
function bindDivider() {
  const split = $("cmSplit"), divider = $("cmDivider");
  let dragging = false;
  const move = (clientX) => {
    const r = split.getBoundingClientRect();
    let p = ((clientX - r.left) / r.width) * 100;
    setDivider(Math.max(0, Math.min(100, p)));
  };
  divider.addEventListener("pointerdown", (e) => { dragging = true; divider.setPointerCapture(e.pointerId); e.preventDefault(); });
  divider.addEventListener("pointermove", (e) => { if (dragging) move(e.clientX); });
  divider.addEventListener("pointerup", () => { dragging = false; });
  divider.addEventListener("pointercancel", () => { dragging = false; });
  split.addEventListener("click", (e) => {
    if ($("cmStage").classList.contains("side")) return;
    if (e.target === divider || divider.contains(e.target)) return;
    move(e.clientX);
  });
}

/* ---------- misc ---------- */
function onGlobalKey(e) {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if ($("lightbox").hidden === false) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") stepLightbox(-1);
    else if (e.key === "ArrowRight") stepLightbox(1);
  } else if ($("compareModal").hidden === false) {
    if (e.key === "Escape") closeCompare();
  }
}
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

init();

/* debug handle: lets a headless check poke the live state without touching internals */
window.__atlas = {
  get DATA() { return DATA; },
  get state() { return state; },
  set state(v) { state = v; },
  renderGrid, render, filterStyles, openLightbox, openCompare, setCompare,
};
