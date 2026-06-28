const fs = require("fs");
const path = require("path");

function getAppRoot() {
  if (process.env.AGENT_BOB_ROOT) {
    return process.env.AGENT_BOB_ROOT;
  }

  return path.join(__dirname, "..");
}

function getPublicDir() {
  return path.join(getAppRoot(), "public");
}

function getDataDir() {
  const dir = process.env.AGENT_BOB_DATA
    ? path.resolve(process.env.AGENT_BOB_DATA)
    : path.join(getAppRoot(), "data");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

function configurePortableRuntime() {
  const root = getAppRoot();

  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const browsersPath = path.join(root, "browsers");
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }

  getDataDir();
}

module.exports = {
  getAppRoot,
  getPublicDir,
  getDataDir,
  configurePortableRuntime
};
