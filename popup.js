import { LISTS, defaultLists } from "./lib/lists.js";

const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, allowlist: [], custom: [], total: 0, lists: defaultLists(), status: {} };

let host = null;
let tabId = null;
let state = { ...DEFAULTS };

const isAllowRuleId = (id) => (id >= 1 && id <= 1999) || id >= 100000;
const n = (x) => (x || 0).toLocaleString();

const cleanDomain = (s) => {
  s = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s) ? s : null;
};

const onHost = (d) => host === d || (host && host.endsWith("." + d));

async function commit(patch, reload = false) {
  state = { ...state, ...patch };
  await chrome.storage.local.set(patch);
  await chrome.runtime.sendMessage({ type: "apply" });
  if (reload && tabId !== null) chrome.tabs.reload(tabId);
  render();
}

function renderAllowlist() {
  const ul = $("allow");
  ul.replaceChildren();
  if (!state.allowlist.length) {
    const li = document.createElement("li");
    li.textContent = "Empty";
    ul.appendChild(li);
    return;
  }
  for (const d of state.allowlist) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = d;
    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.addEventListener("click", () =>
      commit({ allowlist: state.allowlist.filter((x) => x !== d) }, onHost(d))
    );
    li.append(name, rm);
    ul.appendChild(li);
  }
}

function renderLists() {
  const ul = $("lists");
  if (ul.childElementCount) {
    for (const input of ul.querySelectorAll("input")) input.checked = !!state.lists[input.dataset.id];
    return;
  }
  for (const l of LISTS) {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.id = l.id;
    input.checked = !!state.lists[l.id];
    input.addEventListener("change", async () => {
      const lists = { ...state.lists, [l.id]: input.checked };
      state.lists = lists;
      await chrome.storage.local.set({ lists });
      chrome.runtime.sendMessage({ type: "updateLists", rebuild: true });
    });
    label.append(input, document.createTextNode(l.name));
    li.appendChild(label);
    ul.appendChild(li);
  }
}

function renderStatus() {
  const s = state.status || {};
  const lines = [];
  if (s.busy) lines.push(s.message || "Working…");
  else if (!s.builtAt && !s.checkedAt) lines.push("Waiting for first download…");
  if (s.net) {
    lines.push(`Network rules: ${n(s.net.loaded)} of ${n(s.net.limit)} slots` +
      (s.net.dropped ? ` (${n(s.net.dropped)} over limit)` : "") +
      (s.net.failed ? `, ${n(s.net.failed)} rejected` : ""));
  }
  if (s.cosmetic) lines.push(`Cosmetic: ${n(s.cosmetic.generic)} generic, ${n(s.cosmetic.sites)} sites`);
  if (s.checkedAt) lines.push(`Last checked: ${new Date(s.checkedAt).toLocaleString()}`);
  if (s.builtAt) lines.push(`Last rebuilt: ${new Date(s.builtAt).toLocaleString()}`);
  const errs = [...(s.errors || []), ...(s.installError ? ["Install: " + s.installError] : [])];
  const el = $("status");
  el.textContent = lines.join("\n") + (errs.length ? "\n" + errs.join("\n") : "");
  el.classList.toggle("err", errs.length > 0);
  $("update").disabled = !!s.busy;
}

function render() {
  $("enabled").checked = state.enabled;
  $("total").textContent = n(state.total);
  $("host").textContent = host || "Not available on this page";
  const paused = host && state.allowlist.some(onHost);
  $("pause").disabled = !host;
  $("pause").textContent = paused ? "Resume on this site" : "Pause on this site";
  $("pause").classList.toggle("secondary", !!paused);
  renderAllowlist();
  renderLists();
  renderStatus();
}

async function pageCount() {
  if (tabId === null) return;
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    const count = rulesMatchedInfo.filter(
      (r) => !(r.rule.rulesetId === "_dynamic" && isAllowRuleId(r.rule.ruleId))
    ).length;
    $("page").textContent = n(count);
  } catch {
    $("page").textContent = "0";
  }
}

async function init() {
  state = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  state.lists = { ...defaultLists(), ...state.lists };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabId = tab.id;
    try {
      const u = new URL(tab.url);
      if (/^https?:$/.test(u.protocol)) host = u.hostname.toLowerCase().replace(/^www\./, "");
    } catch {}
  }
  $("custom").value = state.custom.join("\n");
  render();
  pageCount();

  $("enabled").addEventListener("change", (e) => commit({ enabled: e.target.checked }, true));

  $("pause").addEventListener("click", () => {
    if (!host) return;
    const paused = state.allowlist.some(onHost);
    const allowlist = paused ? state.allowlist.filter((d) => !onHost(d)) : [...state.allowlist, host];
    commit({ allowlist }, true);
  });

  $("save").addEventListener("click", async () => {
    const custom = [...new Set($("custom").value.split("\n").map(cleanDomain).filter(Boolean))];
    $("custom").value = custom.join("\n");
    await commit({ custom }, true);
  });

  $("update").addEventListener("click", () => {
    $("update").disabled = true;
    chrome.runtime.sendMessage({ type: "updateLists", force: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.total) state.total = changes.total.newValue;
    if (changes.status) state.status = changes.status.newValue || {};
    if (changes.total || changes.status) render();
  });
}

init();
