const Recorder = require("./recorder");
const { buildExportPayload } = require("./exporter");
const { loadSession, saveSession } = require("./storage");

let session = null;

const READ_ONLY_MESSAGE_TYPES = new Set([
  "GET_REQUESTS",
  "GET_EXPORT",
  "PING"
]);

function toIpcSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return {
      success: false,
      error: `Failed to serialize response: ${error.message}`,
      isRecording: Recorder.isRecording
    };
  }
}

function persistState() {
  saveSession(Recorder.getPersistedState());
}

function safeGetState() {
  try {
    return Recorder.getState();
  } catch (error) {
    return {
      isRecording: Recorder.isRecording,
      recordingTabId: Recorder.recordingTabId,
      tabUrl: Recorder.tabUrl,
      capturedRequests: Recorder.getDisplayRequests(),
      finalizedCount: Recorder.capturedRequests.length,
      pendingCount: Recorder.pendingRequests.size,
      actions: Recorder.actions,
      currentAction: Recorder.getCurrentAction(),
      actionCount: Recorder.actions.length,
      preview: null,
      stateError: error.message
    };
  }
}

function initApiHandlers(playwrightSession) {
  session = playwrightSession;

  Recorder.init({ onPersist: persistState });

  const saved = loadSession();
  if (saved) {
    Recorder.loadState(saved);
    Recorder.setLastError(saved.lastError || null);
  }
}

async function handleMessage(message) {
  const payload = message || {};

  try {
    let result;

    if (payload.type === "START_RECORDING") {
      result = await session.startRecording(payload.tabUrl);
    } else if (payload.type === "STOP_RECORDING") {
      result = await session.stopRecording();
    } else if (payload.type === "HIGHLIGHT_BROWSER") {
      result = await session.highlightBrowser();
    } else if (payload.type === "GET_REQUESTS") {
      result = {
        ...safeGetState(),
        lastError: Recorder.lastError,
        mode: "desktop",
        browserAvailable: session?.isBrowserAvailable?.() ?? false
      };
    } else if (payload.type === "MARK_ACTION") {
      result = Recorder.markAction(payload.name, payload.description);
    } else if (payload.type === "UPDATE_STEP") {
      result = Recorder.updateAction(
        payload.actionId,
        payload.name,
        payload.description
      );
    } else if (payload.type === "DELETE_STEP") {
      result = Recorder.deleteAction(payload.actionId);
    } else if (payload.type === "DELETE_REQUEST") {
      result = Recorder.deleteRequest(payload.requestId);
    } else if (payload.type === "SET_CURRENT_STEP") {
      result = Recorder.setCurrentAction(payload.actionId);
    } else if (payload.type === "CLEAR_REQUESTS") {
      Recorder.resetSession();
      Recorder.setLastError(null);
      persistState();
      result = { success: true };
    } else if (payload.type === "GET_EXPORT") {
      result = buildExportPayload(
        Recorder.capturedRequests,
        Recorder.tabUrl,
        Recorder.actions
      );
    } else if (payload.type === "PING") {
      result = { ok: true, isRecording: Recorder.isRecording };
    } else {
      result = { success: false, error: "Unknown message type." };
    }

    return toIpcSafe(result);
  } catch (error) {
    if (!READ_ONLY_MESSAGE_TYPES.has(payload.type)) {
      Recorder.isRecording = false;
      Recorder.recordingTabId = null;
    }

    Recorder.setLastError(error.message);
    persistState();
    return toIpcSafe({
      success: false,
      error: error.message,
      isRecording: Recorder.isRecording
    });
  }
}

async function shutdownSession() {
  if (session) {
    await session.shutdown();
  }
}

module.exports = {
  initApiHandlers,
  handleMessage,
  shutdownSession
};
