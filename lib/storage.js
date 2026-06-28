const fs = require("fs");
const path = require("path");
const { getDataDir } = require("./app-paths");

function getSessionFile() {
  return path.join(getDataDir(), "session.json");
}

function loadSession() {
  const sessionFile = getSessionFile();

  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch {
    return null;
  }
}

function saveSession(state) {
  fs.writeFileSync(getSessionFile(), JSON.stringify(state, null, 2), "utf8");
}

module.exports = {
  loadSession,
  saveSession
};
