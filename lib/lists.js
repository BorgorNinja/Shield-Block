// Sources are taken from uBlock Origin's assets/assets.json (gorhill/uBlock).
// Each list tries its URLs in order; later URLs are mirrors.

const UA = "https://ublockorigin.github.io/uAssets";
const RAW = "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master";
const JSD = "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssets@master";

const ubo = (file) => [`${UA}/filters/${file}`, `${RAW}/filters/${file}`, `${JSD}/filters/${file}`];

export const LISTS = [
  { id: "ublock-filters", name: "uBlock filters – Ads", on: true, urls: ubo("filters.txt") },
  { id: "ublock-badware", name: "uBlock filters – Badware risks", on: true, urls: ubo("badware.txt") },
  { id: "ublock-privacy", name: "uBlock filters – Privacy", on: true, urls: ubo("privacy.txt") },
  { id: "ublock-unbreak", name: "uBlock filters – Unbreak", on: true, urls: ubo("unbreak.txt") },
  { id: "ublock-quick-fixes", name: "uBlock filters – Quick fixes", on: true, urls: ubo("quick-fixes.txt") },
  {
    id: "easylist",
    name: "EasyList",
    on: true,
    urls: [`${UA}/thirdparties/easylist.txt`, "https://easylist.to/easylist/easylist.txt", `${JSD}/thirdparties/easylist.txt`]
  },
  {
    id: "easyprivacy",
    name: "EasyPrivacy",
    on: true,
    urls: [`${UA}/thirdparties/easyprivacy.txt`, "https://easylist.to/easylist/easyprivacy.txt", `${JSD}/thirdparties/easyprivacy.txt`]
  },
  {
    id: "urlhaus-1",
    name: "Online Malicious URL Blocklist",
    on: true,
    urls: [
      "https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt",
      `${RAW}/thirdparties/urlhaus-filter/urlhaus-filter-online.txt`
    ]
  },
  {
    id: "plowe-0",
    name: "Peter Lowe's Ad and tracking server list",
    on: true,
    urls: [
      "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext",
      `${RAW}/thirdparties/pgl.yoyo.org/as/serverlist`
    ]
  },
  { id: "ublock-annoyances", name: "uBlock filters – Annoyances", on: false, urls: ubo("annoyances.txt") },
  { id: "ublock-cookies", name: "uBlock filters – Cookie notices", on: false, urls: ubo("annoyances-cookies.txt") }
];

export const defaultLists = () => Object.fromEntries(LISTS.map((l) => [l.id, l.on]));
