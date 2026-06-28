const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const browsersDir = path.join(projectRoot, "browsers");

if (!fs.existsSync(browsersDir)) {
  fs.mkdirSync(browsersDir, { recursive: true });
}

console.log("Preparing Chromium for Agent Bob packaging...");
execSync("node node_modules/playwright/cli.js install chromium", {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersDir
  }
});

console.log("Browsers ready at:", browsersDir);
