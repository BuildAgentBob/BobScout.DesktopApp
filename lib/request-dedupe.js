function normalizeUrlForDedupe(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const entries = [...parsed.searchParams.entries()].sort((a, b) => {
      const keyCompare = a[0].localeCompare(b[0]);
      return keyCompare !== 0 ? keyCompare : String(a[1]).localeCompare(String(b[1]));
    });
    parsed.search = "";
    for (const [key, value] of entries) {
      parsed.searchParams.append(key, value);
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

function serializeBodyForDedupe(body) {
  if (!body) return "";

  if (body.type === "json" && body.value !== null && body.value !== undefined) {
    return JSON.stringify(body.value);
  }

  if (body.value !== null && body.value !== undefined) {
    return String(body.value);
  }

  return "";
}

function getRequestDedupeKey(record) {
  const method = (record.method || "GET").toUpperCase();
  const urlKey = normalizeUrlForDedupe(record.url);

  if (["POST", "PUT", "PATCH"].includes(method)) {
    return `${method}|${urlKey}|${serializeBodyForDedupe(record.requestBody)}`;
  }

  return `${method}|${urlKey}`;
}

function matchesRequest(record, existing) {
  return (
    (record.actionId || null) === (existing.actionId || null) &&
    getRequestDedupeKey(record) === getRequestDedupeKey(existing)
  );
}

function removeSupersededFromCaptured(record, capturedRequests) {
  const index = capturedRequests.findIndex((existing) => matchesRequest(record, existing));
  if (index !== -1) {
    capturedRequests.splice(index, 1);
  }
}

function removeSupersededFromPending(record, pendingRequests, clearFinalizeTimer) {
  for (const [requestId, existing] of pendingRequests.entries()) {
    if (existing.id === record.id) continue;
    if (!matchesRequest(record, existing)) continue;

    if (typeof clearFinalizeTimer === "function") {
      clearFinalizeTimer(existing);
    }

    pendingRequests.delete(requestId);
  }
}

function supersedeMatchingRequests(record, capturedRequests, pendingRequests, clearFinalizeTimer) {
  removeSupersededFromCaptured(record, capturedRequests);
  removeSupersededFromPending(record, pendingRequests, clearFinalizeTimer);
}

module.exports = {
  getRequestDedupeKey,
  matchesRequest,
  supersedeMatchingRequests
};
