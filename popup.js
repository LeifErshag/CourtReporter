// Drachenwald Court Reporter — popup logic.
// Privacy: nothing in this file transmits user-entered data. The only network
// fetch is the explicit "Refresh awards list" button, which hits the public
// awards page on op.drachenwald.sca.org.

const STORAGE_KEY = "courtReporter.draft.v1";
const AWARDS_KEY = "courtReporter.awards.v1";

const FORM_FIELD_LABELS = {
  report: "Report Summary",
  secret: "Secret Awards"
};

const blankEntry = () => ({
  sca: "",
  mundane: "",
  award: "",
  scrollStatus: "",
  scrollBy: "",
  tokenStatus: "",
  tokenBy: ""
});

const blankState = () => ({
  activeTab: "report",
  report: [blankEntry()],
  secret: [blankEntry()]
});

let state = blankState();
let awards = [];

// ---------- Format ----------

function formatEntry(e) {
  // Pattern: SCA (Mundane): Award, scrollStatus (scrollBy), tokenStatus (tokenBy)
  // Empty fields are allowed; the markers :() must remain.
  const sca = (e.sca || "").trim();
  const mundane = (e.mundane || "").trim();
  const award = (e.award || "").trim();
  const sStat = (e.scrollStatus || "").trim();
  const sBy = (e.scrollBy || "").trim();
  const tStat = (e.tokenStatus || "").trim();
  const tBy = (e.tokenBy || "").trim();
  const head = `${sca}${sca ? " " : ""}(${mundane})`;
  return `${head}:${award ? " " + award : ""}, ${sStat} (${sBy}), ${tStat} (${tBy})`;
}

function formatAll(entries) {
  return entries
    .map(formatEntry)
    .filter((line) => line.replace(/[\s:(),]/g, "").length > 0 || line === "():,(),()")
    .join("\n");
}

// ---------- Persistence ----------

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, AWARDS_KEY]);
  if (stored[STORAGE_KEY]) state = { ...blankState(), ...stored[STORAGE_KEY] };
  if (stored[AWARDS_KEY]) {
    awards = stored[AWARDS_KEY].awards || [];
  } else {
    // Bundled fallback list.
    try {
      const res = await fetch(chrome.runtime.getURL("awards.json"));
      const data = await res.json();
      awards = data.awards || [];
    } catch (_) {
      awards = [];
    }
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }, 200);
}

// ---------- Render ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function renderAwardsDatalist() {
  const dl = $("#awards-list");
  dl.innerHTML = "";
  for (const a of awards) {
    const opt = document.createElement("option");
    opt.value = a;
    dl.appendChild(opt);
  }
}

function renderEntries() {
  const container = $("#entries");
  container.innerHTML = "";
  const entries = state[state.activeTab];
  const tpl = $("#entry-template");

  entries.forEach((entry, idx) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    $(".entry-num", node).textContent = `#${idx + 1}`;

    for (const field of Object.keys(entry)) {
      const input = node.querySelector(`[data-field="${field}"]`);
      if (input) input.value = entry[field] || "";
    }

    node.addEventListener("input", (ev) => {
      const t = ev.target;
      const field = t.dataset.field;
      if (!field) return;
      entries[idx][field] = t.value;
      $(".entry-preview", node).textContent = formatEntry(entries[idx]);
      updateOutput();
      saveState();
    });
    node.addEventListener("change", (ev) => {
      const t = ev.target;
      const field = t.dataset.field;
      if (!field) return;
      entries[idx][field] = t.value;
      $(".entry-preview", node).textContent = formatEntry(entries[idx]);
      updateOutput();
      saveState();
    });

    $(".remove", node).addEventListener("click", () => {
      entries.splice(idx, 1);
      if (entries.length === 0) entries.push(blankEntry());
      renderEntries();
      updateOutput();
      saveState();
    });
    $(".move-up", node).addEventListener("click", () => {
      if (idx === 0) return;
      [entries[idx - 1], entries[idx]] = [entries[idx], entries[idx - 1]];
      renderEntries();
      updateOutput();
      saveState();
    });
    $(".move-down", node).addEventListener("click", () => {
      if (idx === entries.length - 1) return;
      [entries[idx + 1], entries[idx]] = [entries[idx], entries[idx + 1]];
      renderEntries();
      updateOutput();
      saveState();
    });

    $(".entry-preview", node).textContent = formatEntry(entry);
    container.appendChild(node);
  });
}

function updateOutput() {
  $("#output").value = formatAll(state[state.activeTab]);
}

function setStatus(msg, kind = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status " + kind;
  if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ""; el.className = "status"; } }, 3500);
}

// ---------- Tabs ----------

function activateTab(name) {
  state.activeTab = name;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  renderEntries();
  updateOutput();
  saveState();
}

// ---------- Insert into form ----------

// This function runs in the page context via chrome.scripting.executeScript.
// It locates the textarea/input belonging to the form question whose label
// matches `targetLabel`, then sets its value via the React-compatible setter.
function injectFill(targetLabel, value) {
  function setReactValue(el, v) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  const items = document.querySelectorAll('[role="listitem"], [role="list"] > div, div[jsmodel]');
  const candidates = items.length ? items : [document.body];
  const needle = targetLabel.toLowerCase();

  for (const item of candidates) {
    const text = (item.innerText || "").toLowerCase();
    if (!text.includes(needle)) continue;
    // Skip items where the label appears only inside a help/description and
    // there's no editable field.
    const field = item.querySelector('textarea, input[type="text"]');
    if (!field) continue;
    setReactValue(field, value);
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    return { ok: true };
  }
  return { ok: false, reason: `Could not find a field labelled "${targetLabel}" on this page.` };
}

async function insertIntoForm() {
  const value = $("#output").value;
  const label = FORM_FIELD_LABELS[state.activeTab];
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith("https://docs.google.com/forms/")) {
      setStatus("Open the Google Form tab first.", "err");
      return;
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectFill,
      args: [label, value]
    });
    if (result && result.ok) setStatus(`Inserted into "${label}".`, "ok");
    else setStatus(result?.reason || "Insert failed.", "err");
  } catch (err) {
    setStatus("Insert failed: " + err.message, "err");
  }
}

// ---------- Awards refresh ----------

async function refreshAwards() {
  setStatus("Fetching awards…");
  try {
    const res = await fetch("https://op.drachenwald.sca.org/awards", { credentials: "omit" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    const parsed = parseAwardsFromHtml(html);
    if (parsed.length === 0) throw new Error("No awards parsed from page");
    awards = parsed;
    await chrome.storage.local.set({
      [AWARDS_KEY]: { fetchedAt: new Date().toISOString(), awards }
    });
    renderAwardsDatalist();
    setStatus(`Loaded ${awards.length} awards.`, "ok");
  } catch (err) {
    setStatus("Refresh failed: " + err.message, "err");
  }
}

function parseAwardsFromHtml(html) {
  // The OP awards page renders award names as links/headings. We accept any
  // text inside <a>, <h2>, <h3>, or <li> elements that looks like an award
  // name. Filter out obvious navigation entries.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const skip = /^(home|search|awards|login|logout|about|kingdom|drachenwald|principalit|order of precedence|menu)\b/i;
  const seen = new Set();
  const out = [];
  for (const el of doc.querySelectorAll("a, h2, h3, h4, li, td")) {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!t || t.length < 3 || t.length > 120) continue;
    if (skip.test(t)) continue;
    if (!/[A-Za-z]/.test(t)) continue;
    if (seen.has(t)) continue;
    // Heuristic: award names usually start with "Order", "Award", "Grant",
    // "Patent", "Court", "Augmentation", "Queen's", "King's", or end with
    // "Cypher" / "of Arms" / "Drachenwald".
    if (/^(order|award|grant|patent|court|augmentation|queen'?s|king'?s|companion)\b/i.test(t)
      || /(cypher|of arms|drachenwald|favou?r)\b/i.test(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// ---------- Wire up ----------

async function init() {
  await loadState();
  renderAwardsDatalist();

  $$(".tab").forEach((t) => {
    t.addEventListener("click", () => activateTab(t.dataset.tab));
  });
  activateTab(state.activeTab);

  $("#add-entry").addEventListener("click", () => {
    state[state.activeTab].push(blankEntry());
    renderEntries();
    updateOutput();
    saveState();
  });

  $("#copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#output").value);
      setStatus("Copied.", "ok");
    } catch (e) {
      setStatus("Copy failed: " + e.message, "err");
    }
  });

  $("#insert").addEventListener("click", insertIntoForm);
  $("#refresh-awards").addEventListener("click", refreshAwards);

  $("#open-op-search").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://op.drachenwald.sca.org/search" });
  });

  $("#clear-draft").addEventListener("click", async () => {
    if (!confirm("Discard the current draft on this device?")) return;
    state = blankState();
    await chrome.storage.local.remove(STORAGE_KEY);
    activateTab("report");
    setStatus("Draft cleared.", "ok");
  });
}

init();
