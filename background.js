import { LISTS, defaultLists } from "./lib/lists.js";
import { parseList } from "./lib/parser.js";
import { convertNetwork, assignIds, buildCosmetic, cosmeticCss, LIST_BLOCK_BASE } from "./lib/convert.js";

const DNR = chrome.declarativeNetRequest;

// Dynamic rule id layout
const PAUSE_ID = 1; //          global pause (master toggle off)
const ALLOW_BASE = 2; //        per-site allowlist, ids 2..1999
const ALLOW_MAX = 1999;
const CUSTOM_BASE = 2000; //    custom blocklist, ids 2000..9999
const CUSTOM_MAX = 9999;
// 10000..99999 list blocks, 100000+ list exceptions (see lib/convert.js)

const UPDATE_ALARM = "update-lists";
const UPDATE_EVERY_MIN = 360;
const BLOCKABLE_TYPES = [
  "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "media", "websocket", "other"
];

const DEFAULTS = { enabled: true, allowlist: [], custom: [], total: 0, lists: defaultLists() };

let queue = Promise.resolve();
const serialize = (fn) => (queue = queue.then(fn, fn));

/* ---------------- state ---------------- */

let stateCache = null;
let cosDb = null;

async function getState() {
  if (stateCache) return stateCache;
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  s.lists = { ...defaultLists(), ...s.lists };
  stateCache = s;
  return s;
}

async function getCosmeticDb() {
  if (cosDb) return cosDb;
  const r = await chrome.storage.local.get("cosmetic");
  cosDb = r.cosmetic || null;
  return cosDb;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled || changes.allowlist || changes.custom || changes.lists) stateCache = null;
  if (changes.cosmetic) cosDb = null;
});

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({ status: { ...status, ...patch } });
}

/* ---------------- user rules (pause / allowlist / custom) ---------------- */

async function applyUserRules() {
  stateCache = null;
  const s = await getState();
  const addRules = [];

  if (!s.enabled) {
    addRules.push({
      id: PAUSE_ID,
      priority: 1000,
      action: { type: "allowAllRequests" },
      condition: { urlFilter: "|http", resourceTypes: ["main_frame", "sub_frame"] }
    });
  }
  s.allowlist.slice(0, ALLOW_MAX - ALLOW_BASE + 1).forEach((domain, i) =>
    addRules.push({
      id: ALLOW_BASE + i,
      priority: 100,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame"] }
    })
  );
  s.custom.slice(0, CUSTOM_MAX - CUSTOM_BASE + 1).forEach((domain, i) =>
    addRules.push({
      id: CUSTOM_BASE + i,
      priority: 5,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: BLOCKABLE_TYPES }
    })
  );

  const old = await DNR.getDynamicRules();
  await DNR.updateDynamicRules({
    removeRuleIds: old.filter((r) => r.id < LIST_BLOCK_BASE).map((r) => r.id),
    addRules
  });
}

/* ---------------- list fetching ---------------- */

async function fetchList(list, meta) {
  let lastErr = "no URL succeeded";
  for (const url of list.urls) {
    try {
      const headers = {};
      if (meta && meta.url === url) {
        if (meta.etag) headers["If-None-Match"] = meta.etag;
        if (meta.lastModified) headers["If-Modified-Since"] = meta.lastModified;
      }
      const res = await fetch(url, { cache: "no-store", headers });
      if (res.status === 304) return { notModified: true, url };
      if (!res.ok) { lastErr = `${url} -> HTTP ${res.status}`; continue; }
      const text = await res.text();
      if (text.length < 200) { lastErr = `${url} -> response too short`; continue; }
      return {
        text,
        url,
        etag: res.headers.get("etag") || null,
        lastModified: res.headers.get("last-modified") || null
      };
    } catch (e) {
      lastErr = `${url} -> ${e && e.message ? e.message : e}`;
    }
  }
  return { error: lastErr };
}

async function updateLists({ force = false, rebuild = false } = {}) {
  stateCache = null;
  const s = await getState();
  const enabled = LISTS.filter((l) => s.lists[l.id]);
  await setStatus({ busy: true, message: "Checking filter lists…" });

  const { listMeta = {} } = await chrome.storage.local.get("listMeta");
  const stored = await chrome.storage.local.get(enabled.map((l) => "raw:" + l.id));
  let changed = rebuild;
  const errors = [];

  for (const list of enabled) {
    const have = typeof stored["raw:" + list.id] === "string";
    await setStatus({ message: `Updating ${list.name}…` });
    const res = await fetchList(list, force || !have ? null : listMeta[list.id]);
    if (res.error) {
      errors.push(`${list.name}: ${res.error}`);
      continue;
    }
    if (res.notModified) {
      listMeta[list.id] = { ...listMeta[list.id], checked: Date.now() };
      continue;
    }
    await chrome.storage.local.set({ ["raw:" + list.id]: res.text });
    listMeta[list.id] = {
      url: res.url,
      etag: res.etag,
      lastModified: res.lastModified,
      checked: Date.now(),
      fetched: Date.now(),
      bytes: res.text.length
    };
    changed = true;
  }

  await chrome.storage.local.set({ listMeta });
  await setStatus({ checkedAt: Date.now(), errors });

  if (changed || force) await rebuildFromStorage();
  await setStatus({ busy: false, message: errors.length ? "Updated with errors" : "Up to date" });
}

/* ---------------- rebuild: parse -> convert -> install ---------------- */

async function validateRegex(candidates, limit) {
  const ok = [];
  const BATCH = 50;
  for (let i = 0; i < candidates.length && ok.length < limit; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((r) =>
        DNR.isRegexSupported({
          regex: r.condition.regexFilter,
          isCaseSensitive: !!r.condition.isUrlFilterCaseSensitive
        }).then((x) => x.isSupported, () => false)
      )
    );
    batch.forEach((r, j) => results[j] && ok.length < limit && ok.push(r));
  }
  return ok;
}

async function installListRules(rules) {
  const old = await DNR.getDynamicRules();
  const removeRuleIds = old.filter((r) => r.id >= LIST_BLOCK_BASE).map((r) => r.id);
  try {
    await DNR.updateDynamicRules({ removeRuleIds, addRules: rules });
    return { failed: 0 };
  } catch (e) {
    // Atomic install failed (an invalid rule, most likely). Clear and add in bisected chunks.
    await DNR.updateDynamicRules({ removeRuleIds });
    let failed = 0;
    const add = async (chunk) => {
      if (failed > 300 || !chunk.length) return;
      try {
        await DNR.updateDynamicRules({ addRules: chunk });
      } catch {
        if (chunk.length === 1) { failed++; return; }
        const mid = chunk.length >> 1;
        await add(chunk.slice(0, mid));
        await add(chunk.slice(mid));
      }
    };
    for (let i = 0; i < rules.length; i += 2000) await add(rules.slice(i, i + 2000));
    return { failed, error: String(e && e.message ? e.message : e) };
  }
}

async function rebuildFromStorage() {
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    const s = await getState();
    await setStatus({ busy: true, message: "Parsing filters…" });

    const enabled = LISTS.filter((l) => s.lists[l.id]);
    const raws = await chrome.storage.local.get(enabled.map((l) => "raw:" + l.id));
    const parsed = [];
    const network = [];
    for (const l of enabled) {
      const text = raws["raw:" + l.id];
      if (typeof text !== "string") continue;
      const p = parseList(text);
      parsed.push(p);
      for (const f of p.network) network.push(f);
    }

    const max = DNR.MAX_NUMBER_OF_DYNAMIC_RULES || 5000;
    const maxRegex = DNR.MAX_NUMBER_OF_REGEX_RULES || 1000;
    const userCount = (await DNR.getDynamicRules()).filter((r) => r.id < LIST_BLOCK_BASE).length;
    const budget = Math.max(0, max - userCount - 100);

    await setStatus({ message: "Converting rules…" });
    const conv = convertNetwork(network, { budget, regexBudget: Math.min(maxRegex, 800) });
    const regexRules = await validateRegex(conv.regexCandidates, Math.min(maxRegex, 800));
    const rules = assignIds([...conv.rules, ...regexRules]);

    await setStatus({ message: `Installing ${rules.length.toLocaleString()} rules…` });
    const inst = await installListRules(rules);

    const db = buildCosmetic(parsed, conv.special);
    await chrome.storage.local.set({ cosmetic: db });

    await setStatus({
      builtAt: Date.now(),
      net: {
        loaded: rules.length - inst.failed,
        converted: conv.stats.converted,
        dropped: conv.stats.dropped,
        failed: inst.failed,
        regex: regexRules.length,
        limit: max
      },
      cosmetic: { generic: db.generic.length, sites: Object.keys(db.specific).length },
      installError: inst.error || null
    });
  } finally {
    clearInterval(keepAlive);
  }
}

/* ---------------- cosmetic injection ---------------- */

const onHost = (host, d) => host === d || host.endsWith("." + d);

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0 || !/^https?:/i.test(d.url)) return;
  try {
    const s = await getState();
    if (!s.enabled) return;
    const host = new URL(d.url).hostname.toLowerCase();
    if (s.allowlist.some((a) => onHost(host, a.replace(/^www\./, "")))) return;
    const css = cosmeticCss(await getCosmeticDb(), host, true);
    if (!css) return;
    await chrome.scripting.insertCSS({
      target: { tabId: d.tabId, frameIds: [0] },
      css,
      origin: "USER"
    });
  } catch {
    // tab closed or navigation raced; ignore
  }
});

/* ---------------- lifecycle ---------------- */

function initBadge() {
  DNR.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
}

async function ensureAlarm() {
  const a = await chrome.alarms.get(UPDATE_ALARM);
  if (!a) chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 5, periodInMinutes: UPDATE_EVERY_MIN });
}

chrome.runtime.onInstalled.addListener(() => {
  initBadge();
  ensureAlarm();
  serialize(async () => {
    await applyUserRules();
    await updateLists({ force: true });
  }).catch((e) => setStatus({ busy: false, message: "Error: " + e }));
});

chrome.runtime.onStartup.addListener(() => {
  initBadge();
  ensureAlarm();
  serialize(async () => {
    await applyUserRules();
    const { status = {} } = await chrome.storage.local.get("status");
    const stale = !status.checkedAt || Date.now() - status.checkedAt > UPDATE_EVERY_MIN * 60000;
    if (stale) await updateLists({});
  }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === UPDATE_ALARM) {
    serialize(() => updateLists({})).catch((e) => setStatus({ busy: false, message: "Error: " + e }));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "apply") {
    serialize(applyUserRules)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === "updateLists") {
    serialize(() => updateLists({ force: !!msg.force, rebuild: !!msg.rebuild })).catch((e) =>
      setStatus({ busy: false, message: "Error: " + e })
    );
    sendResponse({ started: true });
  }
});

/* ---------------- lifetime counter (unpacked only) ---------------- */

if (DNR.onRuleMatchedDebug) {
  const isAllow = (r) =>
    r.rulesetId === "_dynamic" && ((r.ruleId >= 1 && r.ruleId <= ALLOW_MAX) || r.ruleId >= 100000);
  let pending = 0;
  let timer = null;
  DNR.onRuleMatchedDebug.addListener((info) => {
    if (isAllow(info.rule)) return;
    pending++;
    if (timer) return;
    timer = setTimeout(async () => {
      const add = pending;
      pending = 0;
      timer = null;
      const { total = 0 } = await chrome.storage.local.get({ total: 0 });
      await chrome.storage.local.set({ total: total + add });
    }, 1500);
  });
}
