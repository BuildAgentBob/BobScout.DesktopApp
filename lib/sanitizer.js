const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-csrf-token"
];

const SENSITIVE_BODY_KEYS = [
  "password",
  "passcode",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "authorization",
  "cookie"
];

const MASKED_VALUE = "***MASKED***";
const MAX_RECORDED_ARRAY_ITEMS = 3;
const MAX_RECORDED_STRING_CHARS = 50;

function truncateRecordedString(value) {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_RECORDED_STRING_CHARS) return value;
  return `${value.slice(0, MAX_RECORDED_STRING_CHARS)}...`;
}

function compactRecordedBody(value) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_RECORDED_ARRAY_ITEMS)
      .map((item) => compactRecordedBody(item));
  }

  if (typeof value === "object") {
    const compacted = {};

    for (const key of Object.keys(value)) {
      compacted[key] = compactRecordedBody(value[key]);
    }

    return compacted;
  }

  if (typeof value === "string") {
    return truncateRecordedString(value);
  }

  return value;
}

function isSensitiveHeader(name) {
  return SENSITIVE_HEADERS.includes(String(name).toLowerCase());
}

function isSensitiveBodyKey(key) {
  const lowerKey = String(key).toLowerCase();
  return SENSITIVE_BODY_KEYS.some((x) => lowerKey.includes(x));
}

function maskHeaders(headers) {
  if (!headers) return [];

  if (Array.isArray(headers)) {
    return headers.map((h) => ({
      name: h.name,
      value: isSensitiveHeader(h.name) ? MASKED_VALUE : h.value
    }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: isSensitiveHeader(name) ? MASKED_VALUE : value
  }));
}

function maskObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === "object" && item !== null ? maskObject(item) : item
    );
  }

  const cleaned = {};

  for (const key of Object.keys(obj)) {
    if (isSensitiveBodyKey(key)) {
      cleaned[key] = MASKED_VALUE;
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      cleaned[key] = maskObject(obj[key]);
    } else {
      cleaned[key] = obj[key];
    }
  }

  return cleaned;
}

function parseRequestBody(postData) {
  if (!postData) return null;

  try {
    const json = JSON.parse(postData);
    return { type: "json", value: maskObject(json) };
  } catch {
    return { type: "raw", value: postData };
  }
}

function parseResponseBody(body, base64Encoded) {
  if (body === undefined || body === null) return null;

  if (base64Encoded) {
    return { type: "base64", value: body };
  }

  try {
    const json = JSON.parse(body);
    return { type: "json", value: compactRecordedBody(maskObject(json)) };
  } catch {
    return { type: "text", value: truncateRecordedString(body) };
  }
}

function computeAuthIndicators(requestHeaders, responseHeaders) {
  const reqNames = normalizeHeaderNames(requestHeaders);
  const resNames = normalizeHeaderNames(responseHeaders);

  return {
    hasAuthorizationHeader: reqNames.some((n) => n === "authorization"),
    hasCookieHeader: reqNames.some((n) => n === "cookie"),
    hasSetCookie: resNames.some((n) => n === "set-cookie")
  };
}

function normalizeHeaderNames(headers) {
  if (!headers) return [];

  if (Array.isArray(headers)) {
    return headers.map((h) => String(h.name).toLowerCase());
  }

  return Object.keys(headers).map((n) => n.toLowerCase());
}

module.exports = {
  maskHeaders,
  maskObject,
  parseRequestBody,
  parseResponseBody,
  computeAuthIndicators,
  normalizeHeaderNames
};
