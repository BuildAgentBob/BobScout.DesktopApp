const PROMPT_BODY_MAX_CHARS = 4000;

const NOISE_URL_PATTERNS = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /hotjar\.com/i,
  /segment\.(io|com)/i,
  /mixpanel\.com/i,
  /sentry\.io/i,
  /facebook\.net/i,
  /datadoghq\.com/i,
  /newrelic\.com/i,
  /clarity\.ms/i,
  /fullstory\.com/i,
  /intercom\.io/i,
  /\/favicon\.(ico|png)/i,
  /\.(woff2?|ttf|eot)(\?|$)/i,
  /\.(png|jpe?g|gif|svg|webp|ico)(\?|$)/i,
  /\/health(check)?(\/|$|\?)/i,
  /\/ping(\/|$|\?)/i,
  /\/heartbeat(\/|$|\?)/i,
  /\/beacon(\/|$|\?)/i,
  /\/telemetry(\/|$|\?)/i,
  /\/metrics(\/|$|\?)/i
];

const API_URL_HINTS =
  /\/api\/|\/graphql|\/rest\/|\/services\/|\/odata|\/v\d+\/|\.json(\?|$)|\/rpc\/|\/query/i;

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated for prompt length]";
}

function formatBodyForPrompt(body) {
  if (!body) return "_No body_";

  if (body.type === "json" && body.value !== null && typeof body.value === "object") {
    return truncateText(JSON.stringify(body.value, null, 2), PROMPT_BODY_MAX_CHARS);
  }

  if (body.type === "json" || body.type === "raw" || body.type === "text") {
    const text =
      typeof body.value === "string" ? body.value : JSON.stringify(body.value, null, 2);
    return truncateText(text || "_Empty_", PROMPT_BODY_MAX_CHARS);
  }

  if (body.type === "base64") {
    return `_Binary content (base64, ${body.value?.length || 0} characters)_`;
  }

  if (body.type === "error" || body.type === "incomplete") {
    return `_${body.value || "Unavailable"}_`;
  }

  return truncateText(JSON.stringify(body, null, 2), PROMPT_BODY_MAX_CHARS);
}

function formatHeadersForPrompt(headers) {
  if (!headers || headers.length === 0) return "_None_";
  return headers.map((header) => `- ${header.name}: ${header.value}`).join("\n");
}

function formatAuthSummary(request) {
  const indicators = request.authIndicators;
  if (!indicators) return "None";

  const parts = [];
  if (indicators.hasAuthorizationHeader) parts.push("Authorization");
  if (indicators.hasCookieHeader) parts.push("Cookie");
  if (indicators.hasSetCookie) parts.push("Set-Cookie");

  return parts.length ? parts.join(", ") : "None";
}

function getUrlPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url || "";
  }
}

function isStaticAssetUrl(url) {
  if (!url) return false;
  if (API_URL_HINTS.test(url)) return false;
  return /\.(css|js)(\?|$)/i.test(url);
}

function isNoiseRequest(request) {
  const url = request.url || "";
  if (NOISE_URL_PATTERNS.some((pattern) => pattern.test(url))) return true;
  if (isStaticAssetUrl(url)) return true;
  return false;
}

function isApiLikeRequest(request) {
  const url = (request.url || "").toLowerCase();
  const mime = (request.mimeType || "").toLowerCase();

  if (API_URL_HINTS.test(url)) return true;
  if (mime.includes("json") || mime.includes("xml")) return true;
  if (request.requestBody && request.requestBody.type !== "error") return true;
  if (request.authIndicators?.hasAuthorizationHeader) return true;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;

  return false;
}

function isNavigationRequest(request) {
  if ((request.method || "GET").toUpperCase() !== "GET") return false;

  const mime = (request.mimeType || "").toLowerCase();
  if (mime.includes("text/html")) return true;

  const url = request.url || "";
  if (!isApiLikeRequest(request) && !mime.includes("json")) {
    const path = getUrlPath(url);
    if (path && !path.includes(".") && !API_URL_HINTS.test(url)) {
      return true;
    }
  }

  return false;
}

function isAuthStep(step) {
  const text = `${step.name || ""} ${step.description || ""}`.toLowerCase();
  return /\b(login|log in|sign in|signin|authenticate|auth|session|sso)\b/.test(text);
}

function isAuthRequest(request, step) {
  if (isAuthStep(step)) return true;

  const url = (request.url || "").toLowerCase();
  if (/\b(login|log-in|signin|sign-in|auth|token|oauth|session)\b/.test(url)) return true;
  if (request.authIndicators?.hasSetCookie && request.method === "POST") return true;

  return false;
}

function inferActionLabel(request, step, role) {
  const path = getUrlPath(request.url);
  const method = request.method || "?";

  if (role === "prerequisite") {
    if (/csrf|xsrf|antiforgery/i.test(path + request.url)) return "Fetch CSRF / anti-forgery token";
    if (/token|session|context|bootstrap|init/i.test(path)) return "Fetch session context";
    return `Fetch data required before main action (${method} ${path})`;
  }

  if (isAuthRequest(request, step)) return "Sign in / establish session";

  if (["POST", "PUT", "PATCH"].includes(method)) {
    if (/\b(upload|import|submit|create|post|save|send)\b/i.test(path + (step?.name || ""))) {
      return "Upload / submit data";
    }
    return `Write / mutate (${method} ${path})`;
  }

  if (method === "GET") return `Get records (${path})`;
  if (method === "DELETE") return `Delete (${path})`;

  return `${method} ${path}`;
}

function toSortableTime(request) {
  return request.timestamp ? new Date(request.timestamp).getTime() : 0;
}

function analyzeStepRequests(step) {
  const requests = [...(step.requests || [])].sort(
    (a, b) => toSortableTime(a) - toSortableTime(b)
  );

  const ignored = [];
  const candidates = [];

  for (const request of requests) {
    if (isNoiseRequest(request)) {
      ignored.push({ request, reason: "Analytics, telemetry, or static asset" });
      continue;
    }

    if (isNavigationRequest(request)) {
      ignored.push({ request, reason: "Page navigation — not a core API action" });
      continue;
    }

    if (!isApiLikeRequest(request)) {
      ignored.push({ request, reason: "Not an API/data call" });
      continue;
    }

    candidates.push(request);
  }

  const writes = candidates.filter((r) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(r.method)
  );
  const reads = candidates.filter((r) => r.method === "GET");
  const authWrites = writes.filter((r) => isAuthRequest(r, step));

  let core = [];
  let prerequisites = [];

  if (isAuthStep(step)) {
    core = authWrites.length ? authWrites : writes.length ? writes : candidates;
    prerequisites = reads.filter((r) => !core.includes(r));
  } else if (writes.length > 0) {
    const mainWrite = writes[writes.length - 1];
    const mainTime = toSortableTime(mainWrite);
    core = [mainWrite];
    prerequisites = candidates.filter(
      (r) => r !== mainWrite && toSortableTime(r) <= mainTime && r.method === "GET"
    );

    const otherWrites = writes.filter((r) => r !== mainWrite);
    if (otherWrites.length) {
      prerequisites.push(...otherWrites.slice(0, -1));
    }
  } else if (reads.length > 0) {
    core = reads;
  } else {
    core = candidates;
  }

  const coreSet = new Set(core);
  const prereqSet = new Set(prerequisites);

  for (const request of candidates) {
    if (!coreSet.has(request) && !prereqSet.has(request)) {
      if (request.method === "GET") {
        prerequisites.push(request);
        prereqSet.add(request);
      } else {
        core.push(request);
        coreSet.add(request);
      }
    }
  }

  return {
    core: core.map((request) => ({
      request,
      label: inferActionLabel(request, step, "core")
    })),
    prerequisites: prerequisites.map((request) => ({
      request,
      label: inferActionLabel(request, step, "prerequisite")
    })),
    ignored
  };
}

function formatRequestForPrompt(request, index, label) {
  const title = label
    ? `#### ${label}`
    : `#### Call ${index + 1}: ${request.method || "?"} ${request.url || ""}`;

  return [
    title,
    `- ${request.method || "?"} ${request.url || ""}`,
    `- Status: ${request.statusCode ?? "unknown"} | Auth: ${formatAuthSummary(request)}`,
    "",
    "Request headers:",
    formatHeadersForPrompt(request.requestHeaders),
    "",
    "Request body:",
    "```",
    formatBodyForPrompt(request.requestBody),
    "```",
    "",
    "Response headers:",
    formatHeadersForPrompt(request.responseHeaders),
    "",
    "Response body:",
    "```",
    formatBodyForPrompt(request.responseBody),
    "```"
  ].join("\n");
}

function formatIgnoredSummary(ignored) {
  if (!ignored.length) return "_None — all captured calls appear relevant._";

  return ignored
    .map(({ request, reason }) => {
      const path = getUrlPath(request.url);
      return `- \`${request.method || "?"} ${path}\` — ${reason}`;
    })
    .join("\n");
}

function suggestSubName(step, role, index) {
  const base = (step.name || "Step")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");

  if (role === "prerequisite") {
    return `${base}Prepare`.replace(/\s/g, "");
  }

  if (isAuthStep(step)) return "SignIn";

  return base.replace(/\s/g, "") || `Step${index + 1}`;
}

function getPromptRulesSection() {
  return [
    "## Rules",
    "",
    "- Implement **core actions only** — skip everything listed under “Ignored calls”.",
    "- **Page navigation** (HTML loads between screens) is not automation code — only API calls matter.",
    "- **Prerequisite calls** must run immediately before the core action they support (tokens, ids, upload URLs, form metadata).",
    "- Use **only the endpoints listed** under Core / Prerequisites — do not invent extra calls.",
    "- Masked values (`***MASKED***`) → placeholders (`{username}`, `{password}`, `{accessToken}`, etc.).",
    "- Pass `cookies As CookieContainer` and `sessionData` between steps — login outputs feed later steps."
  ].join("\n");
}

function getPromptStyleSection() {
  return [
    "## Required VB.NET style",
    "",
    "Match this pattern exactly:",
    "",
    "1. List **`Imports` / namespaces** once at the top of the full answer.",
    "2. Each reusable piece is a **separate Sub** (or Function when returning a value).",
    "3. Declare **In args** and **Out args** above each Sub.",
    "4. Always include `errorMessage As String` as an Out arg on every Sub.",
    "5. Wrap each Sub in `Try` / `Catch ex As Exception` / `End Try`.",
    "6. Use `Console.WriteLine(...)` for progress.",
    "7. Use section banners: `' =========================================='` and `' SECTION NAME'`.",
    "8. Use `System.Net.HttpWebRequest` + `HttpWebResponse` (not HttpClient).",
    "9. Pass `CookieContainer` on every request; reuse across Subs.",
    "10. Add headers exactly as captured (`Authorization`, `x-requested-with`, `x-csrf-token`, etc.).",
    "11. Parse HTML with `Regex`; parse JSON with `Newtonsoft.Json.Linq.JObject`.",
    "12. Use `Uri.EscapeDataString` for query/form values.",
    "13. Throw `New Exception(\"...\")` on validation failure."
  ].join("\n");
}

function getReusableOutputFormat(step, analysis, stepIndex) {
  const subs = [];
  const authStep = isAuthStep(step);

  if (analysis.prerequisites.length) {
    subs.push({
      name: suggestSubName(step, "prerequisite", stepIndex),
      purpose: "Prerequisite — run before the main action in this step",
      inArgs: ["`baseUrl As String`", "`cookies As CookieContainer`"],
      outArgs: ["`errorMessage As String`", "`sessionData As Dictionary(Of String, String)` _(tokens, ids parsed from responses)_"]
    });
  }

  subs.push({
    name: suggestSubName(step, "core", stepIndex),
    purpose: authStep
      ? "Sign in — establish session"
      : `Core action — ${step.name || "this step"}`,
    inArgs: authStep
      ? ["`baseUrl As String`", "`username As String`", "`password As String`"]
      : ["`baseUrl As String`", "`cookies As CookieContainer`", "_(inputs from step description)_"],
    outArgs: authStep
      ? [
          "`errorMessage As String`",
          "`cookies As CookieContainer`",
          "`sessionData As Dictionary(Of String, String)`"
        ]
      : ["`errorMessage As String`", "_(outputs — ids, status, confirmation)_"]
  });

  const subBlocks = subs
    .map(
      (sub) =>
        [
          `### Sub: ${sub.name}`,
          `**Purpose:** ${sub.purpose}`,
          "",
          "**In args:**",
          ...sub.inArgs.map((arg) => `- ${arg}`),
          "",
          "**Out args:**",
          ...sub.outArgs.map((arg) => `- ${arg}`),
          "",
          "```vbnet",
          "Try",
          "",
          "    errorMessage = \"\"",
          "",
          "    ' ==========================================",
          `    ' ${sub.name.toUpperCase()}`,
          "    ' ==========================================",
          "",
          "    ' ... full implementation for this Sub only",
          "",
          "Catch ex As Exception",
          "",
          "    errorMessage = ex.Message",
          "",
          "End Try",
          "```"
        ].join("\n")
    )
    .join("\n\n");

  return [
    "## Output format (follow exactly)",
    "",
    "Generate **separate reusable Subs** — one Sub per section below. No long essays.",
    "",
    subBlocks,
    "",
    "After all Subs, add a short **“How to call in UiPath”** list showing call order and which Out args feed the next Sub."
  ].join("\n");
}

function buildStepAnalysisSection(step, analysis) {
  const lines = [
    `### ${step.name || "Step"}`,
    `- Description: ${step.description || "_Infer intent from step name._"}`,
    `- Captured: ${(step.requests || []).length} calls → **${analysis.core.length} core**, **${analysis.prerequisites.length} prerequisite**, **${analysis.ignored.length} ignored**`,
    ""
  ];

  if (analysis.prerequisites.length) {
    lines.push("**Prerequisite calls (implement inside a Prepare Sub — run before core action):**", "");
    analysis.prerequisites.forEach(({ request, label }, index) => {
      lines.push(formatRequestForPrompt(request, index, label), "");
    });
  }

  if (analysis.core.length) {
    lines.push("**Core action(s) (implement as the main Sub for this step):**", "");
    analysis.core.forEach(({ request, label }, index) => {
      lines.push(formatRequestForPrompt(request, index, label), "");
    });
  } else {
    lines.push("_No core API calls identified after filtering — review ignored list or re-record with clearer step boundaries._", "");
  }

  lines.push("**Ignored calls (do NOT generate code for these):**", "", formatIgnoredSummary(analysis.ignored), "");

  return lines.join("\n");
}

function buildStepAutomationPrompt(exportPayload, step, stepIndex = 0) {
  const session = exportPayload.session || {};
  const stepName = step.name || "Step";
  const analysis = analyzeStepRequests(step);

  const lines = [
    `# VB.NET automation — ${stepName}`,
    "",
    "Generate **VB.NET Invoke Code** for UiPath/RPA. **Code first**, minimal prose.",
    "",
    getPromptRulesSection(),
    "",
    getPromptStyleSection(),
    "",
    "## Session",
    "",
    `- Application URL: ${session.tabUrl || "unknown"}`,
    "",
    "## This step",
    "",
    buildStepAnalysisSection(step, analysis),
    getReusableOutputFormat(step, analysis, stepIndex)
  ];

  return lines.join("\n");
}

function buildWorkflowAutomationPrompt(exportPayload) {
  const session = exportPayload.session || {};
  const steps = exportPayload.actions || [];

  if (!steps.length) {
    return buildStepAutomationPrompt(exportPayload, {
      name: "Workflow",
      description: "Full recorded session",
      requests: [
        ...(exportPayload.unlabeledRequests || []),
        ...steps.flatMap((s) => s.requests || [])
      ]
    });
  }

  const stepAnalyses = steps.map((step) => ({
    step,
    analysis: analyzeStepRequests(step)
  }));

  const workflowSummary = stepAnalyses
    .map(({ step, analysis }, index) => {
      const subNames = [];
      if (analysis.prerequisites.length) {
        subNames.push(suggestSubName(step, "prerequisite", index));
      }
      subNames.push(suggestSubName(step, "core", index));
      return `${index + 1}. **${step.name}** → \`${subNames.join("`\` then `")}\``;
    })
    .join("\n");

  const lines = [
    "# VB.NET automation — Full workflow",
    "",
    "Generate **VB.NET Invoke Code** for the **entire workflow below**. Each step becomes **separate reusable Subs**. Skip all ignored calls.",
    "",
    getPromptRulesSection(),
    "",
    getPromptStyleSection(),
    "",
    "## Session",
    "",
    `- Application URL: ${session.tabUrl || "unknown"}`,
    `- Steps: ${steps.length}`,
    "",
    "## Workflow overview (call order)",
    "",
    workflowSummary,
    "",
    "## Steps (filtered API calls only)",
    ""
  ];

  stepAnalyses.forEach(({ step, analysis }, index) => {
    lines.push(buildStepAnalysisSection(step, analysis));
  });

  lines.push(
    "## Output format (follow exactly)",
    "",
    "1. **One shared Imports block** at the top.",
    "2. **One Sub per core action** across the whole workflow (plus a Prepare Sub when prerequisites exist).",
    "3. Suggested Sub names:",
    ""
  );

  stepAnalyses.forEach(({ step, analysis }, index) => {
    if (analysis.prerequisites.length) {
      lines.push(`- \`${suggestSubName(step, "prerequisite", index)}\` — prerequisites for “${step.name}”`);
    }
    lines.push(`- \`${suggestSubName(step, "core", index)}\` — ${step.name}`);
  });

  lines.push(
    "",
    "4. **Sign-in Sub** must Out `cookies` and `sessionData`; later Subs must In those values.",
    "5. End with **“How to call in UiPath”** — numbered call order for the whole workflow.",
    "",
    "Generate complete Sub code for each piece. No navigation/HTML scraping unless a prerequisite call requires parsing a token from a response."
  );

  return lines.join("\n");
}

function buildAutomationPrompt(exportPayload, stepId) {
  if (stepId === "__workflow__") {
    return buildWorkflowAutomationPrompt(exportPayload);
  }

  if (stepId === "unlabeled") {
    return buildStepAutomationPrompt(exportPayload, {
      name: "Unlabeled",
      description: "API calls captured before the first workflow step.",
      requests: exportPayload.unlabeledRequests || []
    });
  }

  const steps = exportPayload.actions || [];
  const stepIndex = steps.findIndex((action) => action.id === stepId);
  const step = stepIndex >= 0 ? steps[stepIndex] : null;

  if (!step) {
    return "";
  }

  return buildStepAutomationPrompt(exportPayload, step, stepIndex);
}
