// Converts parsed network filters to declarativeNetRequest rules and builds the cosmetic DB.
// Pure JS (no chrome.* APIs).

import { SIMPLE_HOST_RE } from "./parser.js";

export const LIST_BLOCK_BASE = 10000;
export const LIST_ALLOW_BASE = 100000;
const DOMAINS_PER_RULE = 1000;
const MAX_URLFILTER_LEN = 500;
const MAX_REGEX_LEN = 512;

const PLAIN_REGEX_BODY = /^[\w\-\/%=&~:]+$/;
const BAD_REGEX = /\(\?[=!<]|\\[1-9]|\\[bBdDsSwWpPuUxX]|\{\d*,?\d*\}\??\)?\{/;

function uniq(a) {
  return [...new Set(a)];
}

function pushSpecialDomains(f, special, out) {
  const m = /^\|\|([a-z0-9.-]+)\^?$/i.exec(f.pattern);
  const domains = [];
  if (m && SIMPLE_HOST_RE.test(m[1].toLowerCase())) domains.push(m[1].toLowerCase());
  domains.push(...f.domains);
  if (!domains.length) return;
  const target = special === "elemhide" ? out.ehide : out.ghide;
  for (const d of domains) target.add(d);
  if (special === "elemhide") for (const d of domains) out.ghide.add(d);
}

function toCandidate(f, special) {
  if (f.special) {
    if (f.exception) pushSpecialDomains(f, f.special === "specifichide" ? "specifichide" : f.special, special);
    return null;
  }

  let p = f.pattern;
  let kind = "url";
  let hostAnchor = false;
  let startAnchor = false;
  let endAnchor = false;
  let regex = null;

  if (p.length > 2 && p[0] === "/" && p[p.length - 1] === "/") {
    const body = p.slice(1, -1);
    if (PLAIN_REGEX_BODY.test(body)) {
      p = body; // literal substring
    } else {
      if (body.length > MAX_REGEX_LEN || BAD_REGEX.test(body) || /[^\x20-\x7e]/.test(body)) return null;
      kind = "regex";
      regex = body;
    }
  }

  if (kind === "url") {
    if (p.startsWith("||")) { hostAnchor = true; p = p.slice(2); }
    else if (p.startsWith("|")) { startAnchor = true; p = p.slice(1); }
    if (p.endsWith("|")) { endAnchor = true; p = p.slice(0, -1); }
    if (!hostAnchor && !startAnchor) p = p.replace(/^\*+/, "");
    if (!endAnchor) p = p.replace(/\*+$/, "");
    if (p.includes("|")) return null;
    if (/[^\x21-\x7e]/.test(p)) return null;
    if (hostAnchor && p.startsWith("*")) return null;
    if (p.length > MAX_URLFILTER_LEN) return null;

    const core = p.replace(/[\^*]/g, "");
    const hasDomains = f.domains.length > 0 || f.toDomains.length > 0;
    if (!core.length && !hasDomains) return null;
    if (core.length && core.length < 3 && !hasDomains && !hostAnchor) return null;

    // ||host^ -> requestDomains (host and all subdomains), eligible for aggregation
    if (hostAnchor && !endAnchor) {
      const hm = /^([a-z0-9.-]+)\^$/i.exec(p);
      if (hm && SIMPLE_HOST_RE.test(hm[1].toLowerCase())) {
        kind = "domain";
        p = hm[1].toLowerCase();
      }
    }
  }

  const cond = {};
  let requestDomains = null;

  if (kind === "domain") {
    if (f.toDomains.length) return null;
    requestDomains = [p];
  } else if (kind === "regex") {
    cond.regexFilter = regex;
    if (f.matchCase) cond.isUrlFilterCaseSensitive = true;
    if (f.toDomains.length) cond.requestDomains = uniq(f.toDomains);
  } else {
    if (p) {
      cond.urlFilter = (hostAnchor ? "||" : startAnchor ? "|" : "") + p + (endAnchor ? "|" : "");
      if (f.matchCase) cond.isUrlFilterCaseSensitive = true;
    }
    if (f.toDomains.length) cond.requestDomains = uniq(f.toDomains);
  }

  if (f.domains.length) cond.initiatorDomains = uniq(f.domains);
  if (f.notDomains.length) cond.excludedInitiatorDomains = uniq(f.notDomains);
  const exReq = uniq([...f.notToDomains, ...f.denyallow]);
  if (exReq.length) cond.excludedRequestDomains = exReq;
  if (f.party === "third") cond.domainType = "thirdParty";
  else if (f.party === "first") cond.domainType = "firstParty";

  let allowAll = false;
  const rt = [...f.types].filter((t) => !f.notTypes.has(t));
  if (f.types.size) {
    if (!rt.length) return null;
    if (f.exception && rt.includes("main_frame")) {
      allowAll = true;
      cond.resourceTypes = ["main_frame"];
    } else {
      cond.resourceTypes = rt;
    }
  } else if (f.notTypes.size) {
    cond.excludedResourceTypes = [...f.notTypes];
  }

  // Require something that restricts the match.
  const restricted =
    cond.urlFilter || cond.regexFilter || cond.requestDomains || cond.initiatorDomains || requestDomains;
  if (!restricted) return null;

  let type, priority;
  if (allowAll) { type = "allowAllRequests"; priority = 4; }
  else if (f.exception) { type = "allow"; priority = f.important ? 4 : 2; }
  else { type = "block"; priority = f.important ? 3 : 1; }

  return { kind, type, priority, cond, requestDomains, hostAnchor };
}

function signature(c) {
  return JSON.stringify([c.type, c.priority, c.cond]);
}

/**
 * @param {Array} filters parsed network filters (from all enabled lists)
 * @param {{budget:number, regexBudget:number}} opts
 * @returns {{rules:Array, regexCandidates:Array, special:{ghide:Set,ehide:Set}, stats:Object}}
 */
export function convertNetwork(filters, opts) {
  const special = { ghide: new Set(), ehide: new Set() };
  const groups = new Map(); // signature -> {type, priority, cond, domains:Set}
  const urlRules = new Map(); // dedupe key -> candidate
  const regexRules = new Map();
  let total = 0;
  let skipped = 0;

  for (const f of filters) {
    const c = toCandidate(f, special);
    if (!c) { if (!f.special) skipped++; continue; }
    total++;
    if (c.kind === "domain") {
      const sig = signature({ type: c.type, priority: c.priority, cond: c.cond });
      let g = groups.get(sig);
      if (!g) {
        g = { type: c.type, priority: c.priority, cond: c.cond, domains: new Set() };
        groups.set(sig, g);
      }
      g.domains.add(c.requestDomains[0]);
    } else if (c.kind === "regex") {
      regexRules.set(signature(c), c);
    } else {
      urlRules.set(signature(c), c);
    }
  }

  const aggBlock = [];
  const aggAllow = [];
  for (const g of groups.values()) {
    const domains = [...g.domains].sort();
    for (let i = 0; i < domains.length; i += DOMAINS_PER_RULE) {
      const chunk = domains.slice(i, i + DOMAINS_PER_RULE);
      const rule = {
        priority: g.priority,
        action: { type: g.type },
        condition: { ...g.cond, requestDomains: chunk }
      };
      (g.type === "block" ? aggBlock : aggAllow).push(rule);
    }
  }

  const mk = (c) => ({
    priority: c.priority,
    action: { type: c.type },
    condition: c.cond
  });

  const urlBlocks = [];
  const urlAllows = [];
  for (const c of urlRules.values()) (c.type === "block" ? urlBlocks : urlAllows).push(c);

  // Quality order when over budget: important, host-anchored, then the rest.
  const score = (c) => (c.priority >= 3 ? 0 : c.hostAnchor ? 1 : 2);
  urlBlocks.sort((a, b) => score(a) - score(b));

  const ordered = [
    ...aggBlock,
    ...aggAllow,
    ...urlBlocks.map(mk),
    ...urlAllows.map(mk)
  ];

  const budget = Math.max(0, opts.budget - Math.min(regexRules.size, opts.regexBudget));
  const kept = ordered.slice(0, budget);
  const dropped = ordered.length - kept.length;

  return {
    rules: kept,
    regexCandidates: [...regexRules.values()].map(mk),
    special,
    stats: {
      filters: filters.length,
      converted: total,
      skipped,
      domainGroups: aggBlock.length + aggAllow.length,
      urlBlocks: urlBlocks.length,
      urlAllows: urlAllows.length,
      regexCandidates: regexRules.size,
      dropped
    }
  };
}

export function assignIds(rules) {
  let b = LIST_BLOCK_BASE;
  let a = LIST_ALLOW_BASE;
  for (const r of rules) {
    r.id = r.action.type === "block" ? b++ : a++;
  }
  return rules;
}

/* ---------------- Cosmetic ---------------- */

export function buildCosmetic(parsedLists, special) {
  const generic = new Set();
  const specific = {};
  const unhide = {};

  for (const p of parsedLists) {
    for (const s of p.cosmeticGeneric) generic.add(s);
    for (const { domains, selector } of p.cosmeticSpecific) {
      for (const d of domains) {
        const arr = specific[d] || (specific[d] = []);
        if (!arr.includes(selector)) arr.push(selector);
      }
    }
    for (const { domains, selector } of p.cosmeticUnhide) {
      for (const d of domains) {
        const arr = unhide[d] || (unhide[d] = []);
        if (!arr.includes(selector)) arr.push(selector);
      }
    }
  }

  return {
    generic: [...generic],
    specific,
    unhide,
    ghide: [...special.ghide],
    ehide: [...special.ehide]
  };
}

function hostCandidates(host) {
  const labels = host.split(".");
  const out = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join("."));
  return out;
}

const RULE_TAIL = "{display:none!important}";

export function cosmeticCss(db, host, isTopFrame) {
  if (!db) return "";
  const cands = hostCandidates(host);
  const ehide = new Set(db.ehide || []);
  if (cands.some((c) => ehide.has(c))) return "";

  const ghide = new Set(db.ghide || []);
  const skipGeneric = !isTopFrame || cands.some((c) => ghide.has(c));

  const off = new Set();
  for (const c of cands) {
    const u = db.unhide[c];
    if (u) for (const s of u) off.add(s);
  }

  let genericCss = "";
  if (!skipGeneric) {
    if (!off.size) {
      genericCss = db._gcss || (db._gcss = db.generic.map((s) => s + RULE_TAIL).join("\n"));
    } else {
      genericCss = db.generic.filter((s) => !off.has(s)).map((s) => s + RULE_TAIL).join("\n");
    }
  }
  const specific = [];
  for (const c of cands) {
    const sp = db.specific[c];
    if (sp) for (const s of sp) if (!off.has(s)) specific.push(s + RULE_TAIL);
  }
  return [genericCss, specific.join("\n")].filter(Boolean).join("\n");
}
