// Drachenwald Court Reporter — popup logic.
// Privacy: nothing in this file transmits user-entered data. The only network
// fetch is the explicit "Refresh awards list" button, which hits the public
// awards page on op.drachenwald.sca.org.

const STORAGE_KEY = "courtReporter.draft.v1";
const AWARDS_KEY = "courtReporter.awards.v1";
const SETTINGS_KEY = "courtReporter.settings.v1";

const OP_SEARCH_URL = "https://op.drachenwald.sca.org/search";

let settings = { verifyNames: false };

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

// Native window.confirm() is unreliable in extension popups (Chrome closes the
// popup or shows a partial dialog). Use a <dialog>-based replacement.
function confirmDialog(message) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("confirm-dialog");
    document.getElementById("confirm-message").textContent = message;
    if (!dlg) { resolve(true); return; }
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "ok");
    };
    dlg.addEventListener("close", onClose);
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  });
}

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
  const stored = await chrome.storage.local.get([STORAGE_KEY, AWARDS_KEY, SETTINGS_KEY]);
  if (stored[STORAGE_KEY]) state = { ...blankState(), ...stored[STORAGE_KEY] };
  if (stored[SETTINGS_KEY]) settings = { ...settings, ...stored[SETTINGS_KEY] };
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
    chrome.storage.local.set({ [STORAGE_KEY]: stripVerification(state) });
  }, 200);
}

function stripVerification(s) {
  const clone = { ...s, report: [], secret: [] };
  for (const tab of ["report", "secret"]) {
    clone[tab] = (s[tab] || []).map(({ _verify, ...rest }) => rest);
  }
  return clone;
}

function saveSettings() {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
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
      if (field === "sca" || field === "mundane") {
        entries[idx]._verify = null;
        renderVerification(node, null);
      }
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

    const verifyBtn = $(".verify-btn", node);
    verifyBtn.addEventListener("click", () => verifyEntry(idx, node));

    // Re-render any cached verification result so it survives re-renders.
    renderVerification(node, entry._verify);

    container.appendChild(node);
  });
}

function renderVerification(node, v) {
  const scaB = node.querySelector('[data-badge="sca"]');
  const munB = node.querySelector('[data-badge="mundane"]');
  const sumB = node.querySelector('[data-badge="match"]');
  const setBadge = (el, kind, text, title) => {
    el.className = "verify-badge" + (kind ? " " + kind : "");
    el.textContent = text || "";
    if (title) el.title = title;
  };
  setBadge(scaB, "", "");
  setBadge(munB, "", "");
  sumB.className = "verify-summary";
  sumB.textContent = "";
  if (!v) return;
  if (v.loading) {
    setBadge(scaB, "loading", "…", "Searching OP…");
    setBadge(munB, "loading", "…", "Searching OP…");
    sumB.textContent = "Verifying…";
    return;
  }
  if (v.error) {
    sumB.className = "verify-summary no";
    sumB.textContent = "Verify failed: " + v.error;
    return;
  }
  if (v.sca) {
    if (v.sca.found) setBadge(scaB, "ok", "✓", "SCA Name Found");
    else setBadge(scaB, "no", "?", "Not found on OP");
  }
  if (v.mundane) {
    if (v.mundane.found) setBadge(munB, "ok", "✓", "Modern Name Found");
    else setBadge(munB, "no", "?", "Not found on OP");
  }
  if (v.match === true) {
    sumB.className = "verify-summary ok";
    sumB.textContent = "✓✓ The results for SCA and modern name matches";
  } else if (v.sca && v.sca.found && v.mundane && v.mundane.found && v.match === false) {
    sumB.className = "verify-summary no";
    sumB.textContent = "Names found but no shared record on OP";
  } else if (v.sca && v.sca.found && (!v.mundane || !v.mundane.checked)) {
    sumB.className = "verify-summary ok";
    sumB.textContent = "SCA Name Found";
  } else if (v.mundane && v.mundane.found && (!v.sca || !v.sca.checked)) {
    sumB.className = "verify-summary ok";
    sumB.textContent = "Modern Name Found";
  }
}

async function verifyEntry(idx, node) {
  const entry = state[state.activeTab][idx];
  if (!entry) return;
  const sca = (entry.sca || "").trim();
  const mundane = (entry.mundane || "").trim();
  if (!sca && !mundane) {
    setStatus("Enter a name to verify.", "err");
    return;
  }
  if (!settings.verifyNames) {
    const ok = await confirmDialog(
      "Name verification will send the names you entered to op.drachenwald.sca.org/search. " +
      "Enable this feature for the rest of this session?"
    );
    if (!ok) return;
    settings.verifyNames = true;
    $("#verify-names").checked = true;
    saveSettings();
  }

  entry._verify = { loading: true };
  renderVerification(node, entry._verify);

  try {
    const [scaRes, munRes] = await Promise.all([
      sca ? opSearch(sca) : Promise.resolve(null),
      mundane ? opMundaneSearch(mundane) : Promise.resolve(null)
    ]);
    const v = {
      sca: scaRes ? { checked: true, found: scaRes.records.some((r) => containsName(r, sca)), records: scaRes.records } : null,
      mundane: munRes ? { checked: true, found: munRes.records.some((r) => containsName(r, mundane)), records: munRes.records } : null
    };
    if (sca && mundane && scaRes && munRes) {
      // True if any record from either search contains BOTH the SCA name and
      // the modern name in the same row/snippet — indicates same person.
      const all = [...scaRes.records, ...munRes.records];
      v.match = all.some((r) => containsName(r, sca) && containsName(r, mundane));
    }
    entry._verify = v;
  } catch (err) {
    entry._verify = { error: err.message || String(err) };
  }
  renderVerification(node, entry._verify);
}

function containsName(text, name) {
  if (!name) return false;
  return text.toLowerCase().includes(name.toLowerCase());
}

async function opSearch(query) {
  // The OP search form posts `persona=<name>` to /search as
  // application/x-www-form-urlencoded and the server renders the matching
  // records into the response HTML. When the query is an exact persona
  // match, the server skips the results page and 302-redirects directly to
  // /persona/<name> — which fetch follows transparently, leaving us on the
  // detail page. Detect that case via res.url and treat it as a hit.
  const body = "persona=" + encodeURIComponent(query);
  return opPostSearch(body, query);
}

async function opMundaneSearch(name) {
  // Mundane (modern/legal) names are not indexed by the persona field; OP's
  // advanced search uses `forename=<X>&surname=<Y>`. Split on the last
  // whitespace: everything before is forename, the last token is surname.
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return opSearch(name);
  const surname = parts.pop();
  const forename = parts.join(" ");
  const body = "forename=" + encodeURIComponent(forename)
    + "&surname=" + encodeURIComponent(surname);
  return opPostSearch(body, name);
}

async function opPostSearch(body, query) {
  const res = await fetch(OP_SEARCH_URL, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) return { records: [], url: OP_SEARCH_URL };
  const finalUrl = res.url || OP_SEARCH_URL;
  const personaMatch = /\/persona\/([^?#]+)/.exec(finalUrl);
  if (personaMatch) {
    let name = personaMatch[1];
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    // Include the original query so containsName() matches even if the
    // server's canonical persona name differs in casing or punctuation.
    return { records: [name, query], url: finalUrl };
  }
  const html = await res.text();
  const records = parseSearchResults(html, query);
  // A unique match redirects to /person/<surname>/<forename>; treat that as a
  // confirmed hit even if our snippet parser missed it on the profile page.
  if (res.redirected && /\/person\//.test(res.url) && records.length === 0) {
    records.push(query + " — " + decodeURIComponent(res.url));
  }
  return { records, url: res.url || OP_SEARCH_URL };
}

function parseSearchResults(html, query) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  const seen = new Set();
  // Collect text snippets from likely result elements: table rows, list items,
  // articles. Keep ones that mention the query (case-insensitive).
  const candidates = doc.querySelectorAll("tr, li, article, .result, .person, .entry, dd");
  for (const el of candidates) {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (!t || t.length < 3 || t.length > 600) continue;
    if (!t.toLowerCase().includes(query.toLowerCase())) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
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

  const verifyToggle = $("#verify-names");
  verifyToggle.checked = !!settings.verifyNames;
  verifyToggle.addEventListener("change", () => {
    settings.verifyNames = verifyToggle.checked;
    saveSettings();
  });

  $("#open-op-search").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://op.drachenwald.sca.org/search" });
  });

  $("#clear-draft").addEventListener("click", async () => {
    if (!(await confirmDialog("Discard the current draft on this device?"))) return;
    state = blankState();
    await chrome.storage.local.remove(STORAGE_KEY);
    activateTab("report");
    setStatus("Draft cleared.", "ok");
  });
}

init();
