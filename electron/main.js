const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const {
  configurePlaywrightBrowsersPath
} = require("../lib/playwright-env");

function configureElectronPaths() {
  const projectRoot = path.join(__dirname, "..");
  process.env.AGENT_BOB_ROOT = app.isPackaged ? app.getAppPath() : projectRoot;
  process.env.AGENT_BOB_DATA = app.getPath("userData");

  const browsersPath = app.isPackaged
    ? path.join(process.resourcesPath, "browsers")
    : path.join(projectRoot, "browsers");

  configurePlaywrightBrowsersPath(browsersPath);
}

configureElectronPaths();

const { configurePortableRuntime, getPublicDir } = require("../lib/app-paths");
const { PlaywrightSession } = require("../lib/playwright-session");
const {
  initApiHandlers,
  handleMessage,
  shutdownSession
} = require("../lib/api-handlers");

configurePortableRuntime();

const playwrightSession = new PlaywrightSession();
initApiHandlers(playwrightSession);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 920,
    minWidth: 480,
    minHeight: 640,
    title: "Agent Bob",
    autoHideMenuBar: true,
    icon: path.join(getPublicDir(), "assets", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(getPublicDir(), "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("agent-bob-message", async (_event, message) => {
  return handleMessage(message);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (app.isQuitting) {
    return;
  }

  event.preventDefault();
  app.isQuitting = true;

  shutdownSession().finally(() => {
    app.quit();
  });
});
