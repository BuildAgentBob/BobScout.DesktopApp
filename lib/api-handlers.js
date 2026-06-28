const Recorder = require("./recorder");
const { buildExportPayload } = require("./exporter");
const { loadSession, saveSession } = require("./storage");

let session = null;

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
    if (payload.type === "START_RECORDING") {
      return await session.startRecording(payload.tabUrl);
    }

    if (payload.type === "STOP_RECORDING") {
      return await session.stopRecording();
    }

    if (payload.type === "HIGHLIGHT_BROWSER") {
      return await session.highlightBrowser();
    }

    if (payload.type === "GET_REQUESTS") {
      return {
        ...safeGetState(),
        lastError: Recorder.lastError,
        mode: "desktop",
        browserAvailable: session?.isBrowserAvailable?.() ?? false
      };
    }

    if (payload.type === "MARK_ACTION") {
      return Recorder.markAction(payload.name, payload.description);
    }

    if (payload.type === "UPDATE_STEP") {
      return Recorder.updateAction(
        payload.actionId,
        payload.name,
        payload.description
      );
    }

    if (payload.type === "DELETE_STEP") {
      return Recorder.deleteAction(payload.actionId);
    }

    if (payload.type === "DELETE_REQUEST") {
      return Recorder.deleteRequest(payload.requestId);
    }

    if (payload.type === "SET_CURRENT_STEP") {
      return Recorder.setCurrentAction(payload.actionId);
    }

    if (payload.type === "CLEAR_REQUESTS") {
      Recorder.resetSession();
      Recorder.setLastError(null);
      persistState();
      return { success: true };
    }

    if (payload.type === "GET_EXPORT") {
      return buildExportPayload(
        Recorder.capturedRequests,
        Recorder.tabUrl,
        Recorder.actions
      );
    }

    if (payload.type === "PING") {
      return { ok: true, isRecording: Recorder.isRecording };
    }

    return { success: false, error: "Unknown message type." };
  } catch (error) {
    Recorder.isRecording = false;
    Recorder.recordingTabId = null;
    Recorder.setLastError(error.message);
    persistState();
    return { success: false, error: error.message };
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
