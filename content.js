"use strict";

(() => {
  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  const onHost = (d) => host === d || host.endsWith("." + d);

  const GENERIC = [
    "ins.adsbygoogle",
    ".adsbygoogle",
    "[id^='google_ads_iframe']",
    "[id^='google_ads_']",
    "[id^='div-gpt-ad']",
    "[data-ad-slot]",
    "[data-ad-client]",
    "[data-google-query-id]",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']",
    "iframe[src*='amazon-adsystem.com']",
    "iframe[src*='adnxs.com']",
    "a[href^='https://adclick.g.doubleclick.net']",
    "a[href*='doubleclick.net/click']",
    "amp-ad",
    "amp-embed[type='taboola']",
    "amp-embed[type='outbrain']",
    ".ad-banner",
    ".ad-container",
    ".ad-wrapper",
    ".ad-slot",
    ".advert",
    ".advertisement",
    ".ads-container",
    ".sponsored-ad",
    "#taboola-below-article",
    ".trc_related_container",
    ".OUTBRAIN",
    ".ob-widget",
    ".mgid_container",
    "[id^='mgid_']",
    "[id^='ScriptRoot'][class*='mgid']"
  ];

  const SITE = {
    "google.com": ["#tads", "#tadsb", "#bottomads", "[data-text-ad]", ".commercial-unit-desktop-top"],
    "youtube.com": [
      "#masthead-ad", "#player-ads", "#panels ytd-ads-engagement-panel-content-renderer",
      "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer", "ytd-banner-promo-renderer",
      "ytd-statement-banner-renderer", "ytd-display-ad-renderer", "ytd-promoted-sparkles-web-renderer",
      "ytd-promoted-video-renderer", "ytd-companion-slot-renderer", "ytd-action-companion-ad-renderer",
      ".ytp-ad-overlay-container", ".ytp-ad-overlay-slot"
    ],
    "reddit.com": ["shreddit-ad-post", "[data-testid='ad']", ".promotedlink"],
    "twitch.tv": ["[data-a-target='video-ad-label']", ".stream-display-ad__container"],
    "facebook.com": ["a[href*='/ads/about']"]
  };

  const selectors = GENERIC.slice();
  for (const domain of Object.keys(SITE)) {
    if (onHost(domain)) selectors.push(...SITE[domain]);
  }

  // Inject immediately to avoid flashes; remove below if disabled or allowlisted.
  const style = document.createElement("style");
  style.id = "shieldblock-cosmetic";
  style.textContent = selectors.join(",\n") + " { display: none !important; }";
  (document.head || document.documentElement).appendChild(style);

  chrome.storage.local.get({ enabled: true, allowlist: [] }, (s) => {
    const allowed = (s.allowlist || []).some(onHost);
    if (s.enabled === false || allowed) {
      style.remove();
      return;
    }
    if (onHost("youtube.com")) startYouTube();
  });

  function startYouTube() {
    let saved = null;

    const tick = () => {
      const player = document.querySelector("#movie_player");
      const video = document.querySelector("video.html5-main-video");
      if (!player || !video) return;

      if (player.classList.contains("ad-showing")) {
        if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
        video.muted = true;
        video.playbackRate = 16;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration;
        }
        document
          .querySelectorAll(
            ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button"
          )
          .forEach((b) => b.click());
        const close = document.querySelector(".ytp-ad-overlay-close-button");
        if (close) close.click();
      } else if (saved) {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
        saved = null;
      }
    };

    setInterval(tick, 250);
  }
})();
