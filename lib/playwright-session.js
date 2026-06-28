const Recorder = require("./recorder");
const {
  getChromiumLaunchError,
  resolveChromiumExecutable
} = require("./playwright-env");

let chromium = null;

function getChromium() {
  if (!chromium) {
    chromium = require("playwright").chromium;
  }

  return chromium;
}

const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://"
];

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function normalizeStartUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "about:blank";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

class PlaywrightSession {
  constructor(options = {}) {
    this.onPersist = options.onPersist;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
    this.networkAttached = false;
  }

  async fetchResponseBody(requestId) {
    if (!this.cdp) {
      return { error: "Network session is not active." };
    }

    try {
      return await this.cdp.send("Network.getResponseBody", { requestId });
    } catch (error) {
      return { error: error.message };
    }
  }

  async attachNetwork() {
    if (!this.page || this.networkAttached) return;

    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send("Network.enable", { maxPostDataSize: 65536 });

    Recorder.fetchResponseBody = (requestId) => this.fetchResponseBody(requestId);

    const source = { tabId: Recorder.RECORDING_TAB_ID };

    this.cdp.on("Network.requestWillBeSent", (params) => {
      Recorder.handleDebuggerEvent(source, "Network.requestWillBeSent", params);
    });

    this.cdp.on("Network.responseReceived", (params) => {
      Recorder.handleDebuggerEvent(source, "Network.responseReceived", params);
    });

    this.cdp.on("Network.loadingFinished", (params) => {
      Recorder.handleDebuggerEvent(source, "Network.loadingFinished", params);
    });

    this.cdp.on("Network.loadingFailed", (params) => {
      Recorder.handleDebuggerEvent(source, "Network.loadingFailed", params);
    });

    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page.mainFrame()) return;
      if (!Recorder.isRecording) return;

      Recorder.setTabUrl(frame.url());
      Recorder.persist();
    });

    this.page.on("close", () => {
      if (!Recorder.isRecording) return;

      Recorder.finalizeAllPending("Recorded browser tab was closed");
      Recorder.isRecording = false;
      Recorder.recordingTabId = null;
      Recorder.setLastError("Recording stopped: browser tab was closed.");
      Recorder.persist();
      this.networkAttached = false;
      this.cdp = null;
      this.page = null;
    });

    this.networkAttached = true;
  }

  async ensureBrowser() {
    if (!this.browser) {
      const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
      const launchError = getChromiumLaunchError(browsersPath);

      if (launchError) {
        throw new Error(launchError);
      }

      const executablePath = resolveChromiumExecutable(browsersPath);
      this.browser = await getChromium().launch({
        headless: false,
        executablePath,
        args: ["--start-maximized"]
      });
      this.context = await this.browser.newContext({
        viewport: null
      });
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
      this.networkAttached = false;
      this.cdp = null;
    }
  }

  async startRecording(tabUrl) {
    const trimmed = String(tabUrl || "").trim();
    if (!trimmed) {
      return { success: false, error: "Please enter a URL." };
    }

    const url = normalizeStartUrl(trimmed);

    if (isRestrictedUrl(url)) {
      throw new Error(
        "Cannot record on browser internal pages. Enter a regular website URL."
      );
    }

    await this.ensureBrowser();
    await this.attachNetwork();

    Recorder.resetSession();
    Recorder.startDefaultStep();
    Recorder.recordingTabId = Recorder.RECORDING_TAB_ID;
    Recorder.isRecording = true;
    Recorder.setLastError(null);

    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    Recorder.setTabUrl(this.page.url());
    Recorder.persist();

    return {
      success: true,
      tabUrl: Recorder.tabUrl
    };
  }

  async stopRecording() {
    Recorder.finalizeAllPending("Recording stopped before response completed");
    Recorder.isRecording = false;
    Recorder.recordingTabId = null;
    Recorder.setLastError(null);
    Recorder.persist();

    return { success: true };
  }

  isBrowserAvailable() {
    return Boolean(this.page && !this.page.isClosed());
  }

  async highlightBrowser() {
    if (!this.isBrowserAvailable()) {
      throw new Error("No recording browser is open. Click Start to launch one.");
    }

    await this.page.bringToFront();

    try {
      await this.page.evaluate(() => {
        const STYLE_ID = "agent-bob-highlight-style";
        const OVERLAY_ID = "agent-bob-highlight-overlay";
        const BADGE_ID = "agent-bob-highlight-badge";

        document.getElementById(OVERLAY_ID)?.remove();
        document.getElementById(BADGE_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
          @keyframes agentBobHighlightPulse {
            0%, 100% {
              opacity: 1;
              box-shadow: inset 0 0 0 8px #f59e0b, inset 0 0 60px 12px rgba(245, 158, 11, 0.45);
            }
            50% {
              opacity: 0.35;
              box-shadow: inset 0 0 0 4px #fbbf24, inset 0 0 24px 6px rgba(251, 191, 36, 0.2);
            }
          }
        `;

        const overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.cssText =
          "position:fixed;inset:0;z-index:2147483646;pointer-events:none;" +
          "animation:agentBobHighlightPulse 0.55s ease-in-out 6;";

        const badge = document.createElement("div");
        badge.id = BADGE_ID;
        badge.textContent = "Agent Bob — connected browser";
        badge.style.cssText =
          "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
          "pointer-events:none;background:#f59e0b;color:#1a1200;" +
          "font:600 14px/1.2 system-ui,sans-serif;padding:10px 18px;border-radius:999px;" +
          "box-shadow:0 8px 24px rgba(0,0,0,0.25);";

        document.head.appendChild(style);
        document.body.appendChild(overlay);
        document.body.appendChild(badge);

        window.setTimeout(() => {
          overlay.remove();
          badge.remove();
          style.remove();
        }, 3500);
      });
    } catch {
      // Some pages block script injection; bringing the window forward is enough.
    }

    return { success: true };
  }

  async shutdown() {
    if (this.browser) {
      await this.browser.close();
    }

    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
    this.networkAttached = false;
  }
}

module.exports = {
  PlaywrightSession,
  isRestrictedUrl,
  normalizeStartUrl
};
