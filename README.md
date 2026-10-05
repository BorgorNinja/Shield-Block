# ShieldBlock 🛡️

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chrome Version](https://img.shields.io/badge/Chrome-121%2B-brightgreen?style=flat-square)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.0.0-informational?style=flat-square)](manifest.json)

> **ShieldBlock** is a modern, high-performance ad and tracker blocker engineered specifically for **Chrome Manifest V3**. It dynamically converts and optimizes upstream **uBlock Origin** and **EasyList** filter rules into native Chromium `declarativeNetRequest` rules—delivering near-instant page loads, zero browser lag, and minimal memory usage.

---

## ✨ Features

- **⚡ Native Manifest V3 Performance**
  Leverages Chrome's native `declarativeNetRequest` (DNR) engine for lightning-fast request blocking at the browser level without intercepting requests in JavaScript.

- **🛡️ Comprehensive Filter List Subscriptions**
  Pre-configured with industry-standard filter lists (uBlock Origin, EasyList, EasyPrivacy, Peter Lowe's List, and URLhaus Malicious URLs) with mirror fallbacks and conditional HTTP caching (`ETag` / `304 Not Modified`).

- **🎨 Anti-Flicker Cosmetic Filtering**
  Early CSS injection at `document_start` suppresses ad containers, banners, and sponsored widgets before the page renders, completely avoiding layout shifts and visual flicker.

- **🎬 Smart YouTube Ad Skipping**
  Seamlessly accelerates and skips unavoidable video ads: automatically mutes audio, ramps playback to 16×, skips ads instantly, and restores your original volume and playback rate.

- **⚙️ Dynamic Rule Budgeting & Compilation**
  Intelligently converts Adblock Plus / uBlock syntax into Chromium DNR rules within Chrome's dynamic rule limits. Validates regular expressions with `isRegexSupported` and features safe rollback and chunked installation.

- **🌐 Per-Site Allowlisting & Custom Blocklists**
  Pause blocking on specific trusted domains with a single click, or enforce custom domain rules via the extension popup.

- **📊 Live Tracking & Metrics**
  Real-time badge counter displays blocked requests on the active tab alongside persistent lifetime blocking statistics.

---

## 🗂️ Filter Lists

ShieldBlock supports official community-curated filter lists:

| Filter List | Description | Default Status |
| :--- | :--- | :---: |
| **uBlock filters – Ads** | Core ad-blocking rules maintained by uBlock Origin | ✅ Enabled |
| **uBlock filters – Badware** | Protection against malware domains and suspicious hosts | ✅ Enabled |
| **uBlock filters – Privacy** | Tracker mitigation and analytics blocking | ✅ Enabled |
| **uBlock filters – Unbreak** | Fixes site breakage caused by overzealous filter rules | ✅ Enabled |
| **uBlock filters – Quick fixes** | Timely community fixes for emerging anti-adblock solutions | ✅ Enabled |
| **EasyList** | The primary ad-blocking subscription for English/global web | ✅ Enabled |
| **EasyPrivacy** | Comprehensive tracking prevention list | ✅ Enabled |
| **Online Malicious URL Blocklist** | URLhaus threat intelligence blocklist | ✅ Enabled |
| **Peter Lowe's Server List** | Ad and tracking server list curated by Peter Lowe | ✅ Enabled |
| **uBlock filters – Annoyances** | Overlay popups, social widgets, and newsletter banners | ⚪ Optional |
| **uBlock filters – Cookie notices** | GDPR / cookie consent dialog suppressors | ⚪ Optional |

*Lists update automatically in the background every 6 hours via Chrome Alarms, and can also be refreshed on-demand.*

---

## 🏗️ Architecture

```
shieldblock/
├── manifest.json         # Extension Manifest V3 configuration & permissions
├── background.js         # Service Worker: manages DNR rules, updates, & alarms
├── content.js            # Content script: cosmetic element hiding & YouTube skipper
├── popup.html/.css/.js   # Popup dashboard: stats, toggles, custom rules, & list manager
├── icons/                # Extension application icons (16px, 32px, 48px, 128px)
├── rules/                # Bundled declarativeNetRequest static rulesets
│   ├── ads.json          # Pre-packaged static ad rules
│   └── trackers.json     # Pre-packaged static tracker rules
└── lib/
    ├── lists.js          # Filter list registry & upstream CDN endpoints
    ├── parser.js         # Adblock Plus / uBlock filter syntax parser
    └── convert.js        # Parser-to-Chromium DNR rule compiler & budgeter
```

---

## 🚀 Installation & Development

### Load in Developer Mode

1. **Clone the repository**:
   ```bash
   git clone https://github.com/BorgorNinja/Shield-Block.git
   cd Shield-Block
   ```

2. **Open Extensions in Chrome**:
   - Navigate to `chrome://extensions` in Google Chrome, Chromium, Brave, or MS Edge.

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch located in the top-right corner.

4. **Load the Extension**:
   - Click **Load unpacked** in the top-left corner.
   - Select the cloned `Shield-Block` folder.

5. **Pin & Use**:
   - Pin ShieldBlock to your browser toolbar and start browsing ad-free!

---

## 🔒 Permissions & Privacy

ShieldBlock prioritizes user privacy. **No personal data or browsing activity is collected, tracked, or transmitted.**

| Permission | Purpose |
| :--- | :--- |
| `declarativeNetRequest` | Enables network-level request blocking using Chromium's native engine. |
| `declarativeNetRequestFeedback` | Enables count statistics of blocked requests for the UI badge. |
| `storage` & `unlimitedStorage` | Stores filter list cache, custom blocklists, and user preferences locally. |
| `activeTab` | Determines the current domain for per-site pausing and tab-specific statistics. |
| `alarms` | Schedules background checks for filter list updates (every 6 hours). |
| `scripting` | Dynamically applies cosmetic element-hiding CSS. |
| `webNavigation` | Triggers cosmetic styling as pages navigate to avoid ad flashes. |
| `<all_urls>` | Required for applying cosmetic styles and declarative network rules across websites. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.
Filter lists are maintained by their respective authors and upstream projects (uBlock Origin, EasyList, etc.).
