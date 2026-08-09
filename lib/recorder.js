const {
  maskHeaders,
  mergeHeaders,
  parseRequestBody,
  parseResponseBody,
  computeAuthIndicators
} = require("./sanitizer");
const { buildPreviewPayload } = require("./exporter");

const RECORDING_TAB_ID = 1;

const Recorder = {
  isRecording: false,
  recordingTabId: null,
  tabUrl: null,
  capturedRequests: [],
  pendingRequests: new Map(),
  extraInfoBuffers: new Map(),
  finalizeTimers: new Map(),
  actions: [],
  currentActionId: null,
  actionCounter: 0,
  onPersist: null,
  fetchResponseBody: null,
  lastError: null,

  init(options = {}) {
    this.onPersist = options.onPersist || null;
    this.fetchResponseBody = options.fetchResponseBody || null;
  },

  resetSession() {
    this.clearAllFinalizeTimers();
    this.pendingRequests.clear();
    this.extraInfoBuffers.clear();
    this.capturedRequests = [];
    this.actions = [];
    this.currentActionId = null;
    this.actionCounter = 0;
  },

  startDefaultStep() {
    this.actionCounter += 1;
    const action = {
      id: `action-${this.actionCounter}`,
      name: "Sample step",
      description: null,
      markedAt: new Date().toISOString(),
      order: 1
    };

    this.actions.push(action);
    this.currentActionId = action.id;
    return action;
  },

  getCurrentAction() {
    if (!this.currentActionId) return null;
    return this.actions.find((action) => action.id === this.currentActionId) || null;
  },

  markAction(name, description) {
    if (!this.isRecording) {
      return { success: false, error: "Start recording before indicating a step." };
    }

    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return { success: false, error: "Step name cannot be empty." };
    }

    if (trimmed.length > 120) {
      return { success: false, error: "Step name must be 120 characters or less." };
    }

    const trimmedDescription = String(description || "").trim();
    if (trimmedDescription.length > 500) {
      return { success: false, error: "Description must be 500 characters or less." };
    }

    this.actionCounter += 1;
    const action = {
      id: `action-${this.actionCounter}`,
      name: trimmed,
      description: trimmedDescription || null,
      markedAt: new Date().toISOString(),
      order: this.actions.length + 1
    };

    this.actions.push(action);
    this.currentActionId = action.id;
    this.persist();

    return { success: true, action };
  },

  updateAction(actionId, name, description) {
    const action = this.actions.find((item) => item.id === actionId);
    if (!action) {
      return { success: false, error: "Step not found." };
    }

    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return { success: false, error: "Step name cannot be empty." };
    }

    if (trimmed.length > 120) {
      return { success: false, error: "Step name must be 120 characters or less." };
    }

    const trimmedDescription = String(description || "").trim();
    if (trimmedDescription.length > 500) {
      return { success: false, error: "Description must be 500 characters or less." };
    }

    action.name = trimmed;
    action.description = trimmedDescription || null;
    delete action.isSample;

    for (const request of this.capturedRequests) {
      if (request.actionId === actionId) {
        request.actionName = trimmed;
      }
    }

    for (const request of this.pendingRequests.values()) {
      if (request.actionId === actionId) {
        request.actionName = trimmed;
      }
    }

    this.persist();
    return { success: true, action };
  },

  setCurrentAction(actionId) {
    if (!this.isRecording) {
      return { success: false, error: "Start recording before changing the active step." };
    }

    const action = this.actions.find((item) => item.id === actionId);
    if (!action) {
      return { success: false, error: "Step not found." };
    }

    if (this.currentActionId === actionId) {
      return { success: true, action };
    }

    this.currentActionId = actionId;
    this.persist();
    return { success: true, action };
  },

  deleteAction(actionId) {
    const index = this.actions.findIndex((item) => item.id === actionId);
    if (index === -1) {
      return { success: false, error: "Step not found." };
    }

    this.actions.splice(index, 1);
    this.actions.forEach((item, orderIndex) => {
      item.order = orderIndex + 1;
    });

    this.capturedRequests = this.capturedRequests.filter(
      (request) => request.actionId !== actionId
    );

    for (const [requestId, record] of this.pendingRequests.entries()) {
      if (record.actionId === actionId) {
        this.clearFinalizeTimer(requestId);
        this.pendingRequests.delete(requestId);
      }
    }

    if (this.currentActionId === actionId) {
      this.currentActionId = this.actions.length
        ? this.actions[this.actions.length - 1].id
        : null;
    }

    if (this.isRecording && this.actions.length === 0) {
      this.startDefaultStep();
    }

    this.persist();
    return { success: true };
  },

  deleteRequest(requestId) {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      this.clearFinalizeTimer(requestId);
      this.pendingRequests.delete(requestId);
      this.persist();
      return { success: true };
    }

    const beforeCount = this.capturedRequests.length;
    this.capturedRequests = this.capturedRequests.filter(
      (request) => request.id !== requestId
    );

    if (this.capturedRequests.length === beforeCount) {
      return { success: false, error: "Request not found." };
    }

    this.persist();
    return { success: true };
  },

  setTabUrl(url) {
    this.tabUrl = url;
  },

  setLastError(error) {
    this.lastError = error || null;
  },

  handleDebuggerEvent(source, method, params) {
    if (!this.isRecording || source.tabId !== this.recordingTabId) return;

    if (method === "Network.requestWillBeSent") {
      this.handleRequestWillBeSent(params, source);
    } else if (method === "Network.requestWillBeSentExtraInfo") {
      this.handleRequestWillBeSentExtraInfo(params);
    } else if (method === "Network.responseReceived") {
      this.handleResponseReceived(params);
    } else if (method === "Network.responseReceivedExtraInfo") {
      this.handleResponseReceivedExtraInfo(params);
    } else if (method === "Network.loadingFinished") {
      this.handleLoadingFinished(params);
    } else if (method === "Network.loadingFailed") {
      this.handleLoadingFailed(params);
    }
  },

  applyBufferedExtraInfo(requestId, record) {
    const buffered = this.extraInfoBuffers.get(requestId);
    if (!buffered) return;

    if (buffered.requestHeaders) {
      record.requestHeaders = mergeHeaders(
        record.requestHeaders,
        buffered.requestHeaders
      );
    }

    if (buffered.responseHeaders) {
      record.responseHeaders = mergeHeaders(
        record.responseHeaders,
        buffered.responseHeaders
      );
    }

    record.authIndicators = computeAuthIndicators(
      record.requestHeaders,
      record.responseHeaders
    );

    this.extraInfoBuffers.delete(requestId);
  },

  handleRequestWillBeSent(params, source = {}) {
    const request = params.request;
    const method = (request.method || "GET").toUpperCase();
    const rawRequestHeaders = request.headers || {};
    const requestHeaders = maskHeaders(rawRequestHeaders);
    const currentAction = this.getCurrentAction();
    const pageUrl = source.pageUrl || this.tabUrl;

    const record = {
      id: params.requestId,
      timestamp: params.wallTime
        ? new Date(params.wallTime * 1000).toISOString()
        : new Date().toISOString(),
      tabUrl: pageUrl,
      pageId: source.pageId || null,
      url: request.url,
      method,
      type: params.type,
      actionId: currentAction?.id || null,
      actionName: currentAction?.name || null,
      requestHeaders,
      requestBody: parseRequestBody(request.postData),
      statusCode: null,
      responseHeaders: [],
      mimeType: null,
      responseBody: null,
      authIndicators: computeAuthIndicators(rawRequestHeaders, null)
    };

    this.pendingRequests.set(params.requestId, record);
    this.applyBufferedExtraInfo(params.requestId, record);
  },

  handleRequestWillBeSentExtraInfo(params) {
    const record = this.pendingRequests.get(params.requestId);
    if (!record) {
      const buffered = this.extraInfoBuffers.get(params.requestId) || {};
      buffered.requestHeaders = params.headers;
      this.extraInfoBuffers.set(params.requestId, buffered);
      return;
    }

    record.requestHeaders = mergeHeaders(record.requestHeaders, params.headers);
    record.authIndicators = {
      ...record.authIndicators,
      ...computeAuthIndicators(record.requestHeaders, record.responseHeaders)
    };
  },

  async fetchBodyForRequest(requestId) {
    if (typeof this.fetchResponseBody !== "function") {
      return {
        error: "Response body fetcher is not available."
      };
    }

    try {
      return await this.fetchResponseBody(requestId);
    } catch (error) {
      return { error: error.message };
    }
  },

  scheduleFinalizeFallback(requestId) {
    if (this.finalizeTimers.has(requestId)) {
      return;
    }

    const record = this.pendingRequests.get(requestId);
    if (!record) return;

    const timer = setTimeout(async () => {
      this.finalizeTimers.delete(requestId);

      const pending = this.pendingRequests.get(requestId);
      if (!pending) return;

      if (pending.statusCode !== null && pending.statusCode !== undefined) {
        if (!pending.responseBody) {
          pending.responseBody = {
            type: "incomplete",
            value: "Response body unavailable (timeout fallback)"
          };
        }

        this.finalizeRecord(requestId, pending);
        return;
      }

      const response = await this.fetchBodyForRequest(requestId);
      const current = this.pendingRequests.get(requestId);
      if (!current) return;

      if (response?.error) {
        current.responseBody = {
          type: "error",
          value: response.error
        };
      } else if (response) {
        current.responseBody = parseResponseBody(
          response.body,
          response.base64Encoded
        );
      } else if (!current.responseBody) {
        current.responseBody = {
          type: "incomplete",
          value: "Response body unavailable (timeout fallback)"
        };
      }

      this.finalizeRecord(requestId, current);
    }, 8000);

    this.finalizeTimers.set(requestId, timer);
  },

  clearFinalizeTimer(requestId) {
    const timer = this.finalizeTimers.get(requestId);
    if (!timer) return;

    clearTimeout(timer);
    this.finalizeTimers.delete(requestId);
  },

  clearAllFinalizeTimers() {
    for (const timer of this.finalizeTimers.values()) {
      clearTimeout(timer);
    }

    this.finalizeTimers.clear();
  },

  handleResponseReceived(params) {
    const record = this.pendingRequests.get(params.requestId);
    if (!record) return;

    const response = params.response;
    const rawResponseHeaders = response.headers || {};

    record.statusCode = response.status;
    record.responseHeaders = mergeHeaders(
      record.responseHeaders,
      maskHeaders(rawResponseHeaders)
    );
    record.mimeType = response.mimeType || null;
    record.authIndicators = computeAuthIndicators(
      record.requestHeaders,
      record.responseHeaders
    );

    this.scheduleFinalizeFallback(params.requestId);
  },

  handleResponseReceivedExtraInfo(params) {
    const record = this.pendingRequests.get(params.requestId);
    if (!record) {
      const buffered = this.extraInfoBuffers.get(params.requestId) || {};
      buffered.responseHeaders = params.headers;
      this.extraInfoBuffers.set(params.requestId, buffered);
      return;
    }

    record.responseHeaders = mergeHeaders(record.responseHeaders, params.headers);
    record.authIndicators = computeAuthIndicators(
      record.requestHeaders,
      record.responseHeaders
    );
  },

  async handleLoadingFinished(params) {
    const record = this.pendingRequests.get(params.requestId);
    if (!record) return;

    this.clearFinalizeTimer(params.requestId);

    const response = await this.fetchBodyForRequest(params.requestId);
    const pending = this.pendingRequests.get(params.requestId);
    if (!pending) return;

    if (response?.error) {
      pending.responseBody = {
        type: "error",
        value: response.error
      };
    } else if (response) {
      pending.responseBody = parseResponseBody(
        response.body,
        response.base64Encoded
      );
    }

    this.finalizeRecord(params.requestId, pending);
  },

  handleLoadingFailed(params) {
    const record = this.pendingRequests.get(params.requestId);
    if (!record) return;

    this.clearFinalizeTimer(params.requestId);
    record.responseBody = {
      type: "error",
      value: params.errorText || "Request failed"
    };

    this.finalizeRecord(params.requestId, record);
  },

  finalizeRecord(requestId, record) {
    if (!this.pendingRequests.has(requestId)) return;

    this.clearFinalizeTimer(requestId);
    this.pendingRequests.delete(requestId);
    this.extraInfoBuffers.delete(requestId);
    this.capturedRequests.push(record);
    this.persist();
  },

  finalizeAllPending(reason) {
    if (this.pendingRequests.size === 0) return;

    const toFinalize = [...this.pendingRequests.values()].sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return aTime - bTime;
    });

    this.clearAllFinalizeTimers();
    this.pendingRequests.clear();
    this.extraInfoBuffers.clear();

    for (const record of toFinalize) {
      if (!record.responseBody) {
        record.responseBody = {
          type: "incomplete",
          value: reason || "Request did not finish before recording stopped"
        };
      }

      this.capturedRequests.push(record);
    }

    this.persist();
  },

  persist() {
    if (typeof this.onPersist === "function") {
      this.onPersist();
    }
  },

  getDisplayRequests() {
    const pending = Array.from(this.pendingRequests.values()).map((record) => ({
      ...record,
      pending: true
    }));

    return [...this.capturedRequests, ...pending];
  },

  getState() {
    const displayRequests = this.getDisplayRequests();
    const currentAction = this.getCurrentAction();

    return {
      isRecording: this.isRecording,
      recordingTabId: this.recordingTabId,
      tabUrl: this.tabUrl,
      capturedRequests: displayRequests,
      finalizedCount: this.capturedRequests.length,
      pendingCount: this.pendingRequests.size,
      actions: this.actions,
      currentAction,
      actionCount: this.actions.length,
      preview: buildPreviewPayload(
        this.capturedRequests,
        Array.from(this.pendingRequests.values()),
        this.actions,
        currentAction
      )
    };
  },

  loadState(state) {
    this.isRecording = false;
    this.recordingTabId = null;
    this.tabUrl = state.tabUrl || null;
    this.capturedRequests = state.capturedRequests || [];
    this.actions = state.actions || [];
    this.currentActionId = state.currentActionId ?? null;
    this.actionCounter = state.actionCounter || 0;
    this.clearAllFinalizeTimers();
    this.pendingRequests.clear();
    this.extraInfoBuffers.clear();
  },

  getPersistedState() {
    return {
      isRecording: false,
      recordingTabId: null,
      tabUrl: this.tabUrl,
      capturedRequests: this.capturedRequests,
      actions: this.actions,
      currentActionId: this.currentActionId,
      actionCounter: this.actionCounter,
      lastError: this.lastError
    };
  },

  RECORDING_TAB_ID
};

module.exports = Recorder;
