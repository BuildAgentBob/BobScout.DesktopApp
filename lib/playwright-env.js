const fs = require("fs");
const path = require("path");

function configurePlaywrightBrowsersPath(browsersPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
}

function resolveChromiumExecutable(browsersPath) {
  if (!browsersPath || !fs.existsSync(browsersPath)) {
    return null;
  }

  const entries = fs.readdirSync(browsersPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("chromium-")) {
      continue;
    }

    const candidates = [
      path.join(browsersPath, entry.name, "chrome-win64", "chrome.exe"),
      path.join(browsersPath, entry.name, "chrome-win", "chrome.exe")
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getChromiumLaunchError(browsersPath) {
  const resolvedPath = browsersPath || process.env.PLAYWRIGHT_BROWSERS_PATH || "unknown";
  const executable = resolveChromiumExecutable(resolvedPath);

  if (executable) {
    return null;
  }

  return (
    `Bundled Chromium was not found at ${resolvedPath}. ` +
    "Install a fresh copy of Agent Bob or rebuild the portable exe."
  );
}

module.exports = {
  configurePlaywrightBrowsersPath,
  resolveChromiumExecutable,
  getChromiumLaunchError
};
