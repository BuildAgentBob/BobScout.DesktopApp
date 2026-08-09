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

function safePageUrl(page) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

class PlaywrightSession {
  constructor(options = {}) {
    this.onPersist = options.onPersist;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pageSessions = new Map();
    this.pageIds = new WeakMap();
    this.nextPageId = 1;
    this.contextPageListenerAttached = false;
  }

  splitNamespacedRequestId(namespacedId) {
    const value = String(namespacedId || "");
    const separator = value.indexOf(":");
    if (separator === -1) {
      return { pageId: null, requestId: value };
    }

    return {
      pageId: value.slice(0, separator),
      requestId: value.slice(separator + 1)
    };
  }

  async fetchResponseBody(namespacedId) {
    const { pageId, requestId } = this.splitNamespacedRequestId(namespacedId);
    const session = pageId ? this.pageSessions.get(pageId) : null;

    if (!session?.cdp) {
      return { error: "Network session is not active." };
    }

    try {
      return await session.cdp.send("Network.getResponseBody", { requestId });
    } catch (error) {
      return { error: error.message };
    }
  }

  getOpenPages() {
    return [...this.pageSessions.values()]
      .map((session) => session.page)
      .filter((page) => page && !page.isClosed());
  }

  hasOpenPages() {
    return this.getOpenPages().length > 0;
  }

  pickPrimaryPage() {
    const openPages = this.getOpenPages();
    if (openPages.length === 0) {
      return null;
    }

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    return openPages[0];
  }

  async detachPageNetwork(pageId) {
    const session = this.pageSessions.get(pageId);
    if (!session) return;

    this.pageSessions.delete(pageId);

    if (session.cdp) {
      try {
        await session.cdp.detach();
      } catch {
        // Session may already be closed with the page.
      }
    }
  }

  stopRecordingBecauseNoPages() {
    if (!Recorder.isRecording) return;

    Recorder.finalizeAllPending("Recorded browser tab was closed");
    Recorder.isRecording = false;
    Recorder.recordingTabId = null;
    Recorder.setLastError("Recording stopped: all recorded browser tabs were closed.");
    Recorder.persist();
    this.page = null;
  }

  async attachPageNetwork(page) {
    if (!page || page.isClosed() || this.pageIds.has(page)) {
      return;
    }

    const pageId = String(this.nextPageId++);
    const cdp = await this.context.newCDPSession(page);
    await cdp.send("Network.enable", {
      maxPostDataSize: 10 * 1024 * 1024
    });

    this.pageIds.set(page, pageId);
    this.pageSessions.set(pageId, { page, cdp });

    const forward = (method) => (params) => {
      if (!Recorder.isRecording) return;

      Recorder.handleDebuggerEvent(
        {
          tabId: Recorder.RECORDING_TAB_ID,
          pageId,
          pageUrl: safePageUrl(page)
        },
        method,
        {
          ...params,
          requestId: `${pageId}:${params.requestId}`
        }
      );
    };

    cdp.on("Network.requestWillBeSent", forward("Network.requestWillBeSent"));
    cdp.on(
      "Network.requestWillBeSentExtraInfo",
      forward("Network.requestWillBeSentExtraInfo")
    );
    cdp.on("Network.responseReceived", forward("Network.responseReceived"));
    cdp.on(
      "Network.responseReceivedExtraInfo",
      forward("Network.responseReceivedExtraInfo")
    );
    cdp.on("Network.loadingFinished", forward("Network.loadingFinished"));
    cdp.on("Network.loadingFailed", forward("Network.loadingFailed"));

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      if (!Recorder.isRecording) return;

      const url = frame.url();
      if (page === this.page || !this.page || this.page.isClosed()) {
        this.page = page;
        Recorder.setTabUrl(url);
        Recorder.persist();
      }
    });

    page.on("close", () => {
      this.detachPageNetwork(pageId);

      if (this.page === page) {
        this.page = this.pickPrimaryPage();
        if (this.page) {
          Recorder.setTabUrl(safePageUrl(this.page));
          Recorder.persist();
        }
      }

      if (!this.hasOpenPages()) {
        this.stopRecordingBecauseNoPages();
      }
    });
  }

  async attachNetwork() {
    if (!this.context) return;

    if (!this.contextPageListenerAttached) {
      this.context.on("page", (page) => {
        this.attachPageNetwork(page).catch((error) => {
          Recorder.setLastError(
            `Failed to attach recording to new window: ${error.message}`
          );
          Recorder.persist();
        });
      });
      this.contextPageListenerAttached = true;
    }

    for (const page of this.context.pages()) {
      await this.attachPageNetwork(page);
    }

    this.page = this.pickPrimaryPage();
    Recorder.fetchResponseBody = (requestId) => this.fetchResponseBody(requestId);
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
      this.contextPageListenerAttached = false;
      this.pageSessions.clear();
      this.nextPageId = 1;
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
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
    return this.hasOpenPages();
  }

  async highlightBrowser() {
    if (!this.isBrowserAvailable()) {
      throw new Error("No recording browser is open. Click Start to launch one.");
    }

    this.page = this.pickPrimaryPage();
    if (!this.page) {
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
    const pageIds = [...this.pageSessions.keys()];
    for (const pageId of pageIds) {
      await this.detachPageNetwork(pageId);
    }

    if (this.browser) {
      await this.browser.close();
    }

    this.browser = null;
    this.context = null;
    this.page = null;
    this.pageSessions.clear();
    this.contextPageListenerAttached = false;
    this.nextPageId = 1;
  }
}

module.exports = {
  PlaywrightSession,
  isRestrictedUrl,
  normalizeStartUrl
};
