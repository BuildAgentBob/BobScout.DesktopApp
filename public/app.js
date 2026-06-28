async function sendMessage(message) {
  if (window.agentBob?.sendMessage) {
    try {
      return await window.agentBob.sendMessage(message);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        capturedRequests: []
      };
    }
  }

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error.message,
      capturedRequests: []
    };
  }
}

const expandedRequestIds = new Set();
const stepGroupStates = new Map();
let showRawJson = false;
let lastRenderedGroups = [];
let toastTimer = null;
let lastControlState = {
  isRecording: false,
  requestCount: 0,
  actionCount: 0,
  browserAvailable: false
};

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 1800);
}

function showUrlFieldError(message) {
  const errorEl = document.getElementById("urlFieldError");
  const inputEl = document.getElementById("startUrlInput");
  errorEl.textContent = message;
  errorEl.hidden = false;
  inputEl.classList.add("is-invalid");
  inputEl.setAttribute("aria-invalid", "true");
}

function clearUrlFieldError() {
  const errorEl = document.getElementById("urlFieldError");
  const inputEl = document.getElementById("startUrlInput");
  errorEl.textContent = "";
  errorEl.hidden = true;
  inputEl.classList.remove("is-invalid");
  inputEl.removeAttribute("aria-invalid");
}

function isMissingUrlError(message, tabUrl) {
  return !tabUrl || message === "Please enter a URL.";
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

function serializeRequestForCopy(request) {
  return {
    id: request.id,
    method: request.method,
    url: request.url,
    timestamp: request.timestamp,
    type: request.type,
    statusCode: request.statusCode ?? null,
    actionId: request.actionId ?? null,
    actionName: request.actionName ?? null,
    authIndicators: request.authIndicators ?? null,
    requestHeaders: request.requestHeaders ?? [],
    requestBody: request.requestBody ?? null,
    responseHeaders: request.responseHeaders ?? [],
    responseBody: request.responseBody ?? null
  };
}

function buildStepCopyPayload(group) {
  const payload = {
    name: group.title,
    description: group.description || null,
    requests: (group.requests || []).map(serializeRequestForCopy)
  };

  if (group.id && group.id !== "unlabeled") {
    payload.id = group.id;
  }

  return payload;
}

const TOOLBAR_ICONS = {
  prompt:
    '<path d="M9.5 2l1.2 3.6L14.5 7l-3.6 1.2L9.5 12 8.3 8.4 4.7 7l3.6-1.2L9.5 2z"/><path d="M19 8l.7 2.1L22 11l-2.3.9L19 14l-.7-2.1L16 11l2.3-.9L19 8z"/>',
  edit:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  delete:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
};

function renderToolbarIcon(name) {
  const paths = TOOLBAR_ICONS[name];
  if (!paths) return "";

  return (
    `<svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  );
}

function renderItemToolbar(buttons) {
  const items = buttons
    .map(
      (button) =>
        `<button type="button" class="icon-btn${button.danger ? " icon-btn-danger" : ""}" data-action="${button.action}" title="${escapeHtml(button.label)}" aria-label="${escapeHtml(button.label)}">${renderToolbarIcon(button.icon)}</button>`
    )
    .join("");

  return `<div class="item-toolbar">${items}</div>`;
}

function renderStepToolbar(group) {
  const promptButton = {
    action: "view-step-prompt",
    label: "View AI prompt",
    icon: "prompt"
  };

  if (group.id === "unlabeled") {
    return renderItemToolbar([
      promptButton,
      { action: "copy-step", label: "Copy step", icon: "copy" }
    ]);
  }

  return renderItemToolbar([
    promptButton,
    { action: "edit-step", label: "Edit step", icon: "edit" },
    { action: "copy-step", label: "Copy step", icon: "copy" },
    { action: "delete-step", label: "Delete step", icon: "delete", danger: true }
  ]);
}

function renderStepActiveControl(group, currentActionId, isRecording) {
  if (!isRecording || !group.id || group.id === "unlabeled") {
    return "";
  }

  const isActive = group.id === currentActionId;
  const label = isActive ? "Active step" : "Set as active step";

  return (
    `<button type="button" class="step-active-btn${isActive ? " is-active" : ""}" data-action="set-active-step" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${isActive}"></button>`
  );
}

function renderRequestToolbar() {
  return renderItemToolbar([
    { action: "copy-request", label: "Copy request", icon: "copy" },
    { action: "delete-request", label: "Delete request", icon: "delete", danger: true }
  ]);
}

function getStepGroupKey(group, index) {
  return group.id || `step-${index}-${group.title}`;
}

function isStepGroupOpen(key, index, total) {
  if (stepGroupStates.has(key)) {
    return stepGroupStates.get(key);
  }

  return total === 1 || index === total - 1;
}

function truncateUrl(url, maxLength = 72) {
  if (!url) return "";
  if (url.length <= maxLength) return url;
  return url.slice(0, maxLength - 3) + "...";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setButtonLoading(button, loading, loadingLabel) {
  const isToolbarBtn = button.classList.contains("toolbar-btn");

  if (loading) {
    button.classList.add("is-loading");
    button.disabled = true;

    if (isToolbarBtn && loadingLabel) {
      button.dataset.prevTitle = button.getAttribute("title") || "";
      button.setAttribute("title", loadingLabel);
    } else if (!isToolbarBtn) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = loadingLabel;
    }
  } else {
    button.classList.remove("is-loading");

    if (button.dataset.prevTitle !== undefined) {
      button.setAttribute("title", button.dataset.prevTitle);
      delete button.dataset.prevTitle;
    } else if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }

    restoreToolbarControls();
  }
}

function restoreToolbarControls() {
  updateControls(
    lastControlState.isRecording,
    lastControlState.requestCount,
    lastControlState.actionCount,
    lastControlState.browserAvailable
  );
}

function updateControls(isRecording, requestCount, actionCount, browserAvailable) {
  lastControlState = { isRecording, requestCount, actionCount, browserAvailable };
  document.getElementById("startBtn").disabled = isRecording;
  document.getElementById("stopBtn").disabled = !isRecording;
  document.getElementById("markActionBtn").disabled = !isRecording;
  document.getElementById("startUrlInput").disabled = isRecording;
  document.getElementById("highlightBrowserBtn").disabled = !browserAvailable;
  document.getElementById("exportBtn").disabled = requestCount === 0;
  document.getElementById("clearBtn").disabled =
    requestCount === 0 && actionCount === 0 && !isRecording;
}

function getUrlPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url || "";
  }
}

function formatTimestamp(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusClass(statusCode) {
  if (statusCode === null || statusCode === undefined) return "pending";
  if (statusCode >= 200 && statusCode < 300) return "ok";
  if (statusCode >= 400) return "error";
  return "neutral";
}

function formatBodyContent(body) {
  if (!body) {
    return '<div class="empty-detail">No body</div>';
  }

  if (body.type === "json" && body.value !== null && typeof body.value === "object") {
    return `<pre class="code-block">${escapeHtml(JSON.stringify(body.value, null, 2))}</pre>`;
  }

  if (body.type === "json" || body.type === "raw" || body.type === "text") {
    const text = typeof body.value === "string" ? body.value : JSON.stringify(body.value, null, 2);
    return `<pre class="code-block">${escapeHtml(text || "")}</pre>`;
  }

  if (body.type === "base64") {
    return `<div class="empty-detail">Binary response (base64, ${body.value?.length || 0} chars)</div>`;
  }

  if (body.type === "error" || body.type === "incomplete") {
    return `<div class="empty-detail warn">${escapeHtml(body.value || "Unavailable")}</div>`;
  }

  return `<pre class="code-block">${escapeHtml(JSON.stringify(body, null, 2))}</pre>`;
}

function renderKeyValueTable(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-detail">None</div>';
  }

  const rows = items
    .map(
      (item) =>
        `<tr><th>${escapeHtml(item.name)}</th><td>${escapeHtml(item.value)}</td></tr>`
    )
    .join("");

  return `<table class="kv-table"><tbody>${rows}</tbody></table>`;
}

function renderAuthBadges(indicators) {
  if (!indicators) return "";

  const badges = [];

  if (indicators.hasAuthorizationHeader) {
    badges.push('<span class="chip chip-auth">Authorization</span>');
  }
  if (indicators.hasCookieHeader) {
    badges.push('<span class="chip chip-auth">Cookie</span>');
  }
  if (indicators.hasSetCookie) {
    badges.push('<span class="chip chip-auth">Set-Cookie</span>');
  }

  if (!badges.length) {
    return '<span class="empty-inline">No auth headers detected</span>';
  }

  return badges.join("");
}

function renderDetailSection(label, content) {
  return `
    <div class="detail-section">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-content">${content}</div>
    </div>
  `;
}

function renderRequestCard(request) {
  const isOpen = expandedRequestIds.has(request.id);
  const pending = Boolean(request.pending);
  const status = pending ? "…" : request.statusCode ?? "—";
  const statusCls = pending ? "pending" : statusClass(request.statusCode);
  const method = (request.method || "?").toUpperCase();
  const path = getUrlPath(request.url);

  const details = [
    renderDetailSection("Full URL", `<div class="mono wrap">${escapeHtml(request.url || "—")}</div>`),
    renderDetailSection(
      "Overview",
      `<div class="overview-grid">
        <div><span class="mini-label">Time</span><span>${escapeHtml(formatTimestamp(request.timestamp))}</span></div>
        <div><span class="mini-label">Type</span><span>${escapeHtml(request.type || "—")}</span></div>
        <div><span class="mini-label">Status</span><span>${escapeHtml(String(status))}</span></div>
        <div><span class="mini-label">Step</span><span>${escapeHtml(request.actionName || "Unlabeled")}</span></div>
      </div>`
    ),
    renderDetailSection("Authentication", renderAuthBadges(request.authIndicators)),
    renderDetailSection(
      "Request headers",
      renderKeyValueTable(request.requestHeaders)
    ),
    renderDetailSection("Request body", formatBodyContent(request.requestBody)),
    renderDetailSection(
      "Response headers",
      renderKeyValueTable(request.responseHeaders)
    ),
    renderDetailSection("Response body", formatBodyContent(request.responseBody))
  ].join("");

  return `
    <details class="request-card${pending ? " is-pending" : ""}" data-request-id="${escapeHtml(request.id)}"${isOpen ? " open" : ""}>
      <summary class="request-summary">
        <span class="method-badge method-${method}">${escapeHtml(method)}</span>
        <span class="http-status http-status-${statusCls}">${escapeHtml(String(status))}</span>
        <span class="request-path" title="${escapeHtml(request.url || "")}">${escapeHtml(path)}</span>
        ${pending ? '<span class="pending-tag">Pending</span>' : ""}
        ${renderRequestToolbar()}
      </summary>
      <div class="request-details">${details}</div>
    </details>
  `;
}

function bindRequestCardEvents(container) {
  container.querySelectorAll(".request-card").forEach((card) => {
    const id = card.dataset.requestId;
    card.addEventListener("toggle", () => {
      if (card.open) {
        expandedRequestIds.add(id);
      } else {
        expandedRequestIds.delete(id);
      }
    });
  });
}

function buildStepMeta(_group, requestCount) {
  return `${requestCount} API call${requestCount === 1 ? "" : "s"}`;
}

function renderActionGroupSummary(group) {
  const descriptionHtml = group.description
    ? `<div class="action-group-description">${escapeHtml(group.description)}</div>`
    : "";

  return (
    `<div class="action-group-header-inner">` +
    `<div class="action-group-title">${escapeHtml(group.title)}</div>` +
    descriptionHtml +
    `<div class="action-group-meta">${escapeHtml(group.meta)}</div>` +
    `</div>`
  );
}

function bindStepGroupEvents(container) {
  container.querySelectorAll(".action-group").forEach((details) => {
    const key = details.dataset.stepKey;
    if (!key) return;

    details.addEventListener("toggle", () => {
      stepGroupStates.set(key, details.open);
    });
  });
}

function renderActionList(preview, options = {}) {
  const isRecording = Boolean(options.isRecording);
  const currentActionId = options.currentActionId || null;
  const actionList = document.getElementById("actionList");
  actionList.innerHTML = "";

  const groups = [];

  if (preview.unlabeledRequests?.length) {
    groups.push({
      id: "unlabeled",
      title: "Unlabeled",
      description: null,
      meta: "Before first step indicator",
      requests: preview.unlabeledRequests
    });
  }

  for (const action of preview.actions || []) {
    let requests = [...(action.requests || [])];

    if (
      preview.currentAction?.id === action.id &&
      preview.pendingRequests?.length
    ) {
      requests = requests.concat(
        preview.pendingRequests.map((request) => ({ ...request, pending: true }))
      );
    }

    groups.push({
      id: action.id,
      title: action.name,
      description: action.description,
      meta: buildStepMeta(action, requests.length),
      requests
    });
  }

  if (
    preview.pendingRequests?.length &&
    (!preview.currentAction ||
      !preview.actions?.some((action) => action.id === preview.currentAction.id))
  ) {
    groups.push({
      id: preview.currentAction?.id || "in-progress",
      title: preview.currentAction?.name || "In progress",
      description: preview.currentAction?.description || null,
      meta: `${preview.pendingRequests.length} pending`,
      requests: preview.pendingRequests.map((request) => ({ ...request, pending: true }))
    });
  }

  if (!groups.length) {
    return false;
  }

  groups.forEach((group, index) => {
    const stepKey = getStepGroupKey(group, index);
    const section = document.createElement("details");
    section.className = "action-group";
    section.dataset.stepKey = stepKey;
    section.dataset.stepId = group.id || "";
    section.open = isStepGroupOpen(stepKey, index, groups.length);

    if (isRecording && group.id && group.id === currentActionId) {
      section.classList.add("is-active-step");
    }

    const bodyContent = group.requests.length
      ? group.requests.map(renderRequestCard).join("")
      : `<div class="step-empty-note">No API calls for this step yet</div>`;

    section.innerHTML =
      `<summary class="action-group-header">${renderStepActiveControl(group, currentActionId, isRecording)}${renderActionGroupSummary(group)}${renderStepToolbar(group)}</summary>` +
      `<div class="action-group-body">${bodyContent}</div>`;

    actionList.appendChild(section);
  });

  lastRenderedGroups = groups;
  bindStepGroupEvents(actionList);
  bindRequestCardEvents(actionList);
  return true;
}

async function refresh() {
  const response = await sendMessage({ type: "GET_REQUESTS" });
  const isRecording = Boolean(response?.isRecording);
  const requests = response?.capturedRequests || [];
  const count = requests.length;
  const pendingCount = response?.pendingCount || 0;
  const actionCount = response?.actionCount || 0;
  const preview = response?.preview || { actions: [] };

  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  statusBadge.classList.toggle("recording", isRecording);
  statusText.textContent = isRecording ? "Recording" : "Idle";

  document.getElementById("requestCount").textContent = String(count);
  document.getElementById("actionCount").textContent = String(actionCount);

  const currentActionEl = document.getElementById("currentAction");
  const currentActionName = document.getElementById("currentActionName");
  const currentActionDescription = document.getElementById("currentActionDescription");

  if (response?.currentAction?.name) {
    currentActionName.textContent = response.currentAction.name;

    if (response.currentAction.description) {
      currentActionDescription.textContent = response.currentAction.description;
      currentActionDescription.hidden = false;
    } else {
      currentActionDescription.textContent = "";
      currentActionDescription.hidden = true;
    }

    currentActionEl.classList.add("visible");
  } else if (isRecording) {
    currentActionName.textContent = "Indicate a step to group API calls";
    currentActionDescription.hidden = true;
    currentActionEl.classList.add("visible");
  } else {
    currentActionEl.classList.remove("visible");
    currentActionName.textContent = "";
    currentActionDescription.textContent = "";
    currentActionDescription.hidden = true;
  }

  const tabHint = document.getElementById("tabHint");
  if (isRecording && response.tabUrl) {
    tabHint.textContent = `Recording: ${truncateUrl(response.tabUrl)}`;
  } else if (response.tabUrl) {
    tabHint.textContent = `Last session: ${truncateUrl(response.tabUrl)}`;
  } else {
    tabHint.textContent = "Enter a URL below, then start recording";
  }

  const errorEl = document.getElementById("error");
  const errorText = document.getElementById("errorText");
  const errors = [];

  if (response.lastError) errors.push(response.lastError);
  if (response.stateError) errors.push(response.stateError);

  if (errors.length) {
    errorText.textContent = errors.join(" ");
    errorEl.classList.add("visible");
  } else {
    errorText.textContent = "";
    errorEl.classList.remove("visible");
  }

  const emptyState = document.getElementById("emptyState");
  const actionList = document.getElementById("actionList");
  const rawJsonPanel = document.getElementById("rawJsonPanel");
  const previewSubtitle = document.getElementById("previewSubtitle");
  const toggleRawBtn = document.getElementById("toggleRawBtn");

  const hasGroupedContent = renderActionList(preview, {
    isRecording,
    currentActionId: response?.currentAction?.id || preview.currentAction?.id || null
  });

  if (count === 0 && actionCount === 0) {
    emptyState.hidden = false;
    actionList.hidden = true;
    rawJsonPanel.hidden = true;
    previewSubtitle.textContent = isRecording
      ? "Perform a new action on the recorded tab"
      : "Nothing recorded yet";
    toggleRawBtn.hidden = true;
  } else {
    emptyState.hidden = true;
    actionList.hidden = !hasGroupedContent;
    toggleRawBtn.hidden = false;

    if (showRawJson) {
      rawJsonPanel.hidden = false;
      rawJsonPanel.textContent = JSON.stringify(preview, null, 2);
      toggleRawBtn.textContent = "Hide raw JSON";
    } else {
      rawJsonPanel.hidden = true;
      toggleRawBtn.textContent = "Show raw JSON";
    }

    if (actionCount > 0) {
      previewSubtitle.textContent = pendingCount
        ? `${actionCount} step${actionCount === 1 ? "" : "s"} · ${count} calls (${pendingCount} pending)`
        : `${actionCount} step${actionCount === 1 ? "" : "s"} · ${count} calls`;
    } else {
      previewSubtitle.textContent = pendingCount
        ? `${count} call${count === 1 ? "" : "s"} (${pendingCount} pending)`
        : `${count} call${count === 1 ? "" : "s"}`;
    }
  }

  updateControls(isRecording, count, actionCount, Boolean(response.browserAvailable));

  if (isRecording) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

let autoRefreshTimer = null;

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(refresh, 1500);
}

function stopAutoRefresh() {
  if (!autoRefreshTimer) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

document.getElementById("toggleRawBtn").addEventListener("click", async () => {
  showRawJson = !showRawJson;
  await refresh();
});

document.getElementById("startUrlInput").addEventListener("input", clearUrlFieldError);

document.getElementById("startBtn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "Starting...");

  const tabUrl = document.getElementById("startUrlInput").value.trim();
  clearUrlFieldError();

  if (!tabUrl) {
    showUrlFieldError("Please enter a URL");
    setButtonLoading(button, false);
    document.getElementById("error").classList.remove("visible");
    return;
  }

  const result = await sendMessage({
    type: "START_RECORDING",
    tabUrl
  });

  if (!result?.success) {
    const message = result?.error || "Failed to start recording.";
    if (isMissingUrlError(message, tabUrl)) {
      showUrlFieldError("Please enter a URL");
      document.getElementById("error").classList.remove("visible");
    } else {
      document.getElementById("errorText").textContent = message;
      document.getElementById("error").classList.add("visible");
    }
  } else {
    clearUrlFieldError();
    document.getElementById("error").classList.remove("visible");
  }

  setButtonLoading(button, false);
  await refresh();
});

document.getElementById("highlightBrowserBtn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "Highlighting...");

  const result = await sendMessage({ type: "HIGHLIGHT_BROWSER" });

  setButtonLoading(button, false);

  if (!result?.success) {
    document.getElementById("errorText").textContent =
      result?.error || "Could not highlight the recording browser.";
    document.getElementById("error").classList.add("visible");
    return;
  }

  document.getElementById("error").classList.remove("visible");
  showToast("Recording browser highlighted");
});

document.getElementById("stopBtn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "Stopping...");

  await sendMessage({ type: "STOP_RECORDING" });

  setButtonLoading(button, false);
  await refresh();
});

function openStepModal(options = {}) {
  const backdrop = document.getElementById("stepModalBackdrop");
  const title = document.getElementById("stepModalTitle");
  const editIdInput = document.getElementById("stepEditId");
  const nameInput = document.getElementById("stepNameInput");
  const descriptionInput = document.getElementById("stepDescriptionInput");
  const saveButton = document.getElementById("stepModalSave");

  if (options.editId) {
    title.textContent = "Edit Step";
    editIdInput.value = options.editId;
    nameInput.value = options.name || "";
    descriptionInput.value = options.description || "";
    saveButton.textContent = "Save changes";
  } else {
    title.textContent = "Indicate Step";
    editIdInput.value = "";
    nameInput.value = "";
    descriptionInput.value = "";
    saveButton.textContent = "Save step";
  }

  backdrop.hidden = false;
  backdrop.classList.add("visible");
  nameInput.focus();
}

function closeStepModal() {
  const backdrop = document.getElementById("stepModalBackdrop");
  document.getElementById("stepEditId").value = "";
  backdrop.classList.remove("visible");
  backdrop.hidden = true;
}

document.getElementById("markActionBtn").addEventListener("click", () => {
  openStepModal();
});

document.getElementById("stepModalCancel").addEventListener("click", closeStepModal);

document.getElementById("stepModalBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "stepModalBackdrop") {
    closeStepModal();
  }
});

document.getElementById("stepModalForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const editId = document.getElementById("stepEditId").value.trim();
  const name = document.getElementById("stepNameInput").value;
  const description = document.getElementById("stepDescriptionInput").value;

  const result = await sendMessage(
    editId
      ? {
          type: "UPDATE_STEP",
          actionId: editId,
          name,
          description
        }
      : {
          type: "MARK_ACTION",
          name,
          description
        }
  );

  if (!result?.success) {
    document.getElementById("errorText").textContent =
      result?.error || (editId ? "Failed to update step." : "Failed to indicate step.");
    document.getElementById("error").classList.add("visible");
    return;
  }

  closeStepModal();
  document.getElementById("error").classList.remove("visible");
  await refresh();
});

document.getElementById("refreshBtn").addEventListener("click", refresh);

document.getElementById("clearBtn").addEventListener("click", async () => {
  await sendMessage({ type: "CLEAR_REQUESTS" });
  expandedRequestIds.clear();
  stepGroupStates.clear();
  await refresh();
});

document.getElementById("exportBtn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setButtonLoading(button, true, "Exporting...");

  const payload = await sendMessage({ type: "GET_EXPORT" });
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "captured-api-workflow.json";
  link.click();
  URL.revokeObjectURL(url);

  setButtonLoading(button, false);
  await refresh();
});

let cachedPrompt = "";

function openPromptModal(prompt, stepName) {
  cachedPrompt = prompt;
  const backdrop = document.getElementById("promptModalBackdrop");
  const preview = document.getElementById("promptPreview");
  const feedback = document.getElementById("copyFeedback");
  const title = document.getElementById("promptModalTitle");

  title.textContent = stepName ? `AI Prompt — ${stepName}` : "AI Prompt";
  preview.value = prompt;
  feedback.textContent = "";
  backdrop.hidden = false;
  backdrop.classList.add("visible");
}

function closePromptModal() {
  const backdrop = document.getElementById("promptModalBackdrop");
  backdrop.classList.remove("visible");
  backdrop.hidden = true;
  document.getElementById("copyFeedback").textContent = "";
}

async function copyPromptToClipboard() {
  const feedback = document.getElementById("copyFeedback");

  try {
    await navigator.clipboard.writeText(cachedPrompt);
    feedback.textContent = "Copied to clipboard.";
  } catch {
    const preview = document.getElementById("promptPreview");
    preview.focus();
    preview.select();
    document.execCommand("copy");
    feedback.textContent = "Copied to clipboard.";
  }
}

async function showStepPrompt(group) {
  if (!group?.requests?.length) {
    document.getElementById("errorText").textContent =
      "No API calls in this step to generate a prompt.";
    document.getElementById("error").classList.add("visible");
    return;
  }

  if (typeof buildAutomationPrompt !== "function") {
    document.getElementById("errorText").textContent =
      "Prompt generator is not available. Reload the page.";
    document.getElementById("error").classList.add("visible");
    return;
  }

  const exportPayload = await sendMessage({ type: "GET_EXPORT" });
  if (!exportPayload) {
    document.getElementById("errorText").textContent = "Could not load captured workflow.";
    document.getElementById("error").classList.add("visible");
    return;
  }

  const prompt = buildAutomationPrompt(exportPayload, group.id);
  if (!prompt) {
    document.getElementById("errorText").textContent = "Could not build prompt for this step.";
    document.getElementById("error").classList.add("visible");
    return;
  }

  document.getElementById("error").classList.remove("visible");
  openPromptModal(prompt, group.title);
}

document.getElementById("promptModalClose").addEventListener("click", closePromptModal);

document.getElementById("promptModalBackdrop").addEventListener("click", (event) => {
  if (event.target.id === "promptModalBackdrop") {
    closePromptModal();
  }
});

document.getElementById("promptCopyBtn").addEventListener("click", copyPromptToClipboard);

function findRenderedGroup(stepId, stepKey) {
  if (stepId) {
    const byId = lastRenderedGroups.find((group) => group.id === stepId);
    if (byId) return byId;
  }

  if (stepKey) {
    const index = lastRenderedGroups.findIndex(
      (group, groupIndex) => getStepGroupKey(group, groupIndex) === stepKey
    );
    if (index !== -1) {
      return lastRenderedGroups[index];
    }
  }

  return null;
}

async function handleActionListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const action = button.dataset.action;
  const stepGroup = button.closest(".action-group");
  const requestCard = button.closest(".request-card");
  const stepKey = stepGroup?.dataset.stepKey || "";
  const stepId = stepGroup?.dataset.stepId || "";

  if (action === "view-step-prompt") {
    const group = findRenderedGroup(stepId, stepKey);
    if (!group) return;

    button.disabled = true;
    try {
      await showStepPrompt(group);
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (action === "edit-step") {
    const group = findRenderedGroup(stepId, stepKey);
    if (!group || group.id === "unlabeled") return;

    openStepModal({
      editId: group.id,
      name: group.title,
      description: group.description || ""
    });
    return;
  }

  if (action === "set-active-step") {
    const group = findRenderedGroup(stepId, stepKey);
    if (!group || group.id === "unlabeled") return;

    const result = await sendMessage({
      type: "SET_CURRENT_STEP",
      actionId: group.id
    });

    if (!result?.success) {
      document.getElementById("errorText").textContent =
        result?.error || "Failed to set active step.";
      document.getElementById("error").classList.add("visible");
      return;
    }

    document.getElementById("error").classList.remove("visible");
    showToast(`Active step: ${group.title}`);
    await refresh();
    return;
  }

  if (action === "copy-step") {
    const group = findRenderedGroup(stepId, stepKey);
    if (!group) return;

    const copied = await copyTextToClipboard(
      JSON.stringify(buildStepCopyPayload(group), null, 2)
    );

    if (copied) {
      showToast("Step copied to clipboard");
    } else {
      document.getElementById("errorText").textContent = "Could not copy step to clipboard.";
      document.getElementById("error").classList.add("visible");
    }
    return;
  }

  if (action === "delete-step") {
    const group = findRenderedGroup(stepId, stepKey);
    if (!group || group.id === "unlabeled") return;

    const confirmed = window.confirm(
      `Delete step "${group.title}" and all ${group.requests.length} API call(s) in it?`
    );
    if (!confirmed) return;

    const result = await sendMessage({
      type: "DELETE_STEP",
      actionId: group.id
    });

    if (!result?.success) {
      document.getElementById("errorText").textContent =
        result?.error || "Failed to delete step.";
      document.getElementById("error").classList.add("visible");
      return;
    }

    stepGroupStates.delete(stepKey);
    await refresh();
    return;
  }

  if (action === "copy-request") {
    const requestId = requestCard?.dataset.requestId;
    if (!requestId) return;

    const group = findRenderedGroup(stepId, stepKey);
    const request = group?.requests?.find((item) => item.id === requestId);
    if (!request) return;

    const copied = await copyTextToClipboard(
      JSON.stringify(serializeRequestForCopy(request), null, 2)
    );

    if (copied) {
      showToast("Request copied to clipboard");
    } else {
      document.getElementById("errorText").textContent =
        "Could not copy request to clipboard.";
      document.getElementById("error").classList.add("visible");
    }
    return;
  }

  if (action === "delete-request") {
    const requestId = requestCard?.dataset.requestId;
    if (!requestId) return;

    const confirmed = window.confirm("Delete this API call?");
    if (!confirmed) return;

    const result = await sendMessage({
      type: "DELETE_REQUEST",
      requestId
    });

    if (!result?.success) {
      document.getElementById("errorText").textContent =
        result?.error || "Failed to delete request.";
      document.getElementById("error").classList.add("visible");
      return;
    }

    expandedRequestIds.delete(requestId);
    await refresh();
  }
}

document.getElementById("actionList").addEventListener("click", handleActionListClick);

refresh();
window.addEventListener("beforeunload", () => {
  stopAutoRefresh();
});
