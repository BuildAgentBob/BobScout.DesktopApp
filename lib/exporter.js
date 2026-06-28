function buildExportPayload(capturedRequests, tabUrl, actions) {
  const actionList = actions || [];
  const actionBuckets = new Map();

  for (const action of actionList) {
    actionBuckets.set(action.id, {
      id: action.id,
      name: action.name,
      description: action.description || null,
      markedAt: action.markedAt,
      order: action.order,
      requests: []
    });
  }

  const unlabeledRequests = [];

  for (const request of capturedRequests) {
    if (request.actionId && actionBuckets.has(request.actionId)) {
      actionBuckets.get(request.actionId).requests.push(request);
    } else {
      unlabeledRequests.push(request);
    }
  }

  const groupedActions = actionList
    .map((action) => actionBuckets.get(action.id))
    .filter(Boolean);

  const payload = {
    exportedAt: new Date().toISOString(),
    session: {
      tabUrl: tabUrl || null,
      requestCount: capturedRequests.length,
      actionCount: actionList.length
    },
    actions: groupedActions
  };

  if (unlabeledRequests.length > 0) {
    payload.unlabeledRequests = unlabeledRequests;
  }

  return payload;
}

function buildPreviewPayload(capturedRequests, pendingRequests, actions, currentAction) {
  const exportData = buildExportPayload(capturedRequests, null, actions);

  if (pendingRequests.length > 0) {
    exportData.pendingRequests = pendingRequests;
  }

  if (currentAction) {
    exportData.currentAction = {
      id: currentAction.id,
      name: currentAction.name,
      description: currentAction.description || null,
      markedAt: currentAction.markedAt
    };
  }

  return exportData;
}

module.exports = {
  buildExportPayload,
  buildPreviewPayload
};
