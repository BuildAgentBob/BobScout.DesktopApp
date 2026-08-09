function normalizeHeaderValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return String(value);
}

function normalizeHeaders(headers) {
  if (!headers) return [];

  if (Array.isArray(headers)) {
    return headers.map((h) => ({
      name: String(h.name),
      value: normalizeHeaderValue(h.value)
    }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name: String(name),
    value: normalizeHeaderValue(value)
  }));
}

function maskHeaders(headers) {
  return normalizeHeaders(headers);
}

function maskObject(obj) {
  return obj;
}

function mergeHeaders(existing, extra) {
  const merged = new Map();

  for (const header of normalizeHeaders(existing)) {
    merged.set(String(header.name).toLowerCase(), {
      name: header.name,
      value: header.value
    });
  }

  for (const header of normalizeHeaders(extra)) {
    merged.set(String(header.name).toLowerCase(), {
      name: header.name,
      value: header.value
    });
  }

  return Array.from(merged.values());
}

function parseRequestBody(postData) {
  if (!postData) return null;

  try {
    const json = JSON.parse(postData);
    return { type: "json", value: json };
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
    return { type: "json", value: json };
  } catch {
    return { type: "text", value: body };
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
  mergeHeaders,
  parseRequestBody,
  parseResponseBody,
  computeAuthIndicators,
  normalizeHeaderNames
};
