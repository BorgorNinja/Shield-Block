// Parses Adblock Plus / uBlock Origin filter list text.
// Pure JS (no chrome.* APIs) so it runs in the service worker and in Node tests.

const TYPE_MAP = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  css: "stylesheet",
  object: "object",
  "object-subrequest": "object",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  subdocument: "sub_frame",
  frame: "sub_frame",
  ping: "ping",
  beacon: "ping",
  media: "media",
  font: "font",
  websocket: "websocket",
  other: "other",
  document: "main_frame",
  doc: "main_frame"
};

const ALL_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "media", "websocket", "other"
];

// Options that make a filter inexpressible in declarativeNetRequest.
const UNSUPPORTED = new Set([
  "csp", "permissions", "removeparam", "queryprune", "replace", "header", "urltransform",
  "cname", "ipaddress", "app", "method", "popup", "popunder", "inline-script", "inline-font",
  "webrtc", "strict1p", "strict3p", "redirect-rule", "rewrite", "uritransform", "from-redirect"
]);

const COSMETIC_RE = /^([^#/\s]*)(#@?[$?%]?#)(.+)$/;
const OPTIONS_RE = /^~?[a-z0-9_-]+(=[^,]*)?(,~?[a-z0-9_-]+(=[^,]*)?)*$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const SIMPLE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PROCEDURAL_RE =
  /:-abp-|:has-text|:xpath|:matches-|:upward|:nth-ancestor|:others|:remove|:style|:watch-attr|:contains|:if\(|:if-not|:min-text|:shadow|:spath|:not\(:|:-js-|:is-/;

function validDomainEntry(d) {
  return d.length <= 253 && DOMAIN_RE.test(d) && !d.includes("..");
}

function parseDomainList(val) {
  const pos = [];
  const neg = [];
  let droppedPositive = false;
  for (let raw of val.split("|")) {
    raw = raw.trim().toLowerCase();
    if (!raw) continue;
    const negated = raw[0] === "~";
    const d = negated ? raw.slice(1) : raw;
    if (!validDomainEntry(d)) {
      // entities (example.*), regexes, non-ASCII: not expressible
      if (!negated) droppedPositive = true;
      continue;
    }
    (negated ? neg : pos).push(d);
  }
  return { pos, neg, droppedPositive };
}

function balanced(sel) {
  let paren = 0, bracket = 0, quote = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "\\") { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") paren++;
    else if (c === ")") { if (--paren < 0) return false; }
    else if (c === "[") bracket++;
    else if (c === "]") { if (--bracket < 0) return false; }
  }
  return paren === 0 && bracket === 0 && !quote;
}

function sanitizeSelector(sel) {
  sel = sel.trim();
  if (!sel || sel.length > 400) return null;
  if (/[{}<>;\n\r]/.test(sel)) return null;
  if (PROCEDURAL_RE.test(sel)) return null;
  if (!balanced(sel)) return null;
  return sel;
}

function parseCosmetic(line, m, out) {
  const [, domPart, op, body] = m;
  if (op !== "##" && op !== "#@#") return; // procedural / scriptlet / style injection
  if (body.startsWith("+js(")) return;
  const selector = sanitizeSelector(body);
  if (!selector) return;

  const pos = [];
  const neg = [];
  for (let d of domPart.split(",")) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    const negated = d[0] === "~";
    if (negated) d = d.slice(1);
    if (!validDomainEntry(d)) continue; // entities / invalid
    (negated ? neg : pos).push(d);
  }

  if (op === "#@#") {
    if (pos.length) out.cosmeticUnhide.push({ domains: pos, selector });
    return;
  }
  if (!domPart) {
    out.cosmeticGeneric.push(selector);
  } else if (pos.length) {
    out.cosmeticSpecific.push({ domains: pos, selector });
  }
  // negative-only domain lists are dropped (rare)
}

function parseNetwork(line, out) {
  let s = line;
  let exception = false;
  if (s.startsWith("@@")) { exception = true; s = s.slice(2); }

  let pattern = s;
  let optStr = "";
  const di = s.lastIndexOf("$");
  if (di >= 0) {
    const candidate = s.slice(di + 1);
    if (OPTIONS_RE.test(candidate)) {
      pattern = s.slice(0, di);
      optStr = candidate;
    }
  }

  // Bare IPv4 lines (e.g. URLhaus) mean the host, not a substring.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(pattern)) pattern = "||" + pattern + "^";

  const f = {
    exception,
    pattern,
    types: new Set(),
    notTypes: new Set(),
    party: null,
    domains: [],
    notDomains: [],
    toDomains: [],
    notToDomains: [],
    denyallow: [],
    important: false,
    matchCase: false,
    badfilter: false,
    special: null // generichide | elemhide | specifichide
  };

  if (optStr) {
    for (const opt of optStr.split(",")) {
      let name = opt;
      const neg = name[0] === "~";
      if (neg) name = name.slice(1);
      let val = null;
      const eq = name.indexOf("=");
      if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
      name = name.toLowerCase();

      if (UNSUPPORTED.has(name)) return;
      if (name === "all") {
        if (!neg) ALL_TYPES.forEach((t) => f.types.add(t));
      } else if (TYPE_MAP[name]) {
        (neg ? f.notTypes : f.types).add(TYPE_MAP[name]);
      } else if (name === "third-party" || name === "3p") {
        f.party = neg ? "first" : "third";
      } else if (name === "first-party" || name === "1p") {
        f.party = neg ? "third" : "first";
      } else if (name === "domain" || name === "from") {
        if (val === null) return;
        const r = parseDomainList(val);
        if (r.droppedPositive && !r.pos.length) return;
        f.domains.push(...r.pos);
        f.notDomains.push(...r.neg);
      } else if (name === "to") {
        if (val === null) return;
        const r = parseDomainList(val);
        if (r.droppedPositive && !r.pos.length) return;
        f.toDomains.push(...r.pos);
        f.notToDomains.push(...r.neg);
      } else if (name === "denyallow") {
        if (val === null) return;
        const r = parseDomainList(val);
        f.denyallow.push(...r.pos);
      } else if (name === "important") {
        f.important = true;
      } else if (name === "match-case") {
        f.matchCase = true;
      } else if (name === "badfilter") {
        f.badfilter = true;
      } else if (name === "redirect" || name === "empty" || name === "mp4" || name === "noop") {
        // Applied as a plain block; neutered resources are not shipped.
      } else if (name === "generichide" || name === "ghide") {
        f.special = "generichide";
      } else if (name === "elemhide" || name === "ehide") {
        f.special = "elemhide";
      } else if (name === "specifichide" || name === "shide") {
        f.special = "specifichide";
      } else {
        return; // unknown option: skip the filter
      }
    }
  }

  f.key = line;
  out.network.push(f);
}

export function parseList(text) {
  const out = {
    network: [],
    cosmeticGeneric: [],
    cosmeticSpecific: [],
    cosmeticUnhide: []
  };

  const lines = text.split(/\r?\n/);
  const hostsRe = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const c = line[0];
    if (c === "!" || c === "[") continue;

    // Cosmetic filters can start with '#' (e.g. "##.ad"); hosts-file comments are "# ..." only.
    const m = COSMETIC_RE.exec(line);
    if (m) {
      parseCosmetic(line, m, out);
      continue;
    }
    if (c === "#") continue;

    // hosts-file format (Peter Lowe's list)
    const hm = hostsRe.exec(line);
    if (hm) {
      const host = hm[1].toLowerCase();
      if (host !== "localhost" && SIMPLE_HOST_RE.test(host)) {
        const f = {
          exception: false, pattern: "||" + host + "^", types: new Set(), notTypes: new Set(),
          party: null, domains: [], notDomains: [], toDomains: [], notToDomains: [],
          denyallow: [], important: false, matchCase: false, badfilter: false, special: null,
          key: line
        };
        out.network.push(f);
      }
      continue;
    }

    if (line.includes("##") || line.includes("#?#") || line.includes("#$#")) continue;

    parseNetwork(line, out);
  }

  // Drop filters disabled by $badfilter (same text without the badfilter option).
  const bad = new Set();
  for (const f of out.network) {
    if (f.badfilter) {
      bad.add(f.key.replace(/,badfilter\b/i, "").replace(/\$badfilter$/i, ""));
    }
  }
  if (bad.size) {
    out.network = out.network.filter((f) => !f.badfilter && !bad.has(f.key));
  } else {
    out.network = out.network.filter((f) => !f.badfilter);
  }
  return out;
}

export { ALL_TYPES, SIMPLE_HOST_RE, validDomainEntry };
