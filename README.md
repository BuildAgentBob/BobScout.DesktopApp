# Agent Bob Desktop (Electron)

Electron desktop app for **Agent Bob** — same UI as the Chrome extension, with Playwright network capture when extensions are blocked.

## Your compiled app (use this)

After building, run or copy this file — **not** the `dist/AgentBob` folder:

```
C:\GIT\BobAgentApp\dist\AgentBob-1.0.0-portable.exe
```

Double-click it. No Node.js install needed on the target PC. Electron is embedded inside the exe.

## Build the exe (on your dev machine only)

Node.js is only required **on your machine to build** the app, not for users who run the exe.

```bash
cd C:\GIT\BobAgentApp
npm install
npm run build:portable
```

Output: `dist/AgentBob-1.0.0-portable.exe`

Installer + portable:

```bash
npm run build:win
```

Also creates `dist/AgentBob-1.0.0-setup.exe`.

## Development

```bash
npm start
```

Opens the Agent Bob window (same design as the extension popup).

## How to use

1. Launch **Agent Bob** (the `.exe` or `npm start`)
2. Enter a **Website URL**
3. Click **Start** — a Chromium window opens for recording
4. Use steps, AI prompts, and export as in the extension
5. Click **Stop** when finished

Session data is stored in your Windows user profile (`AppData`), not next to the exe.

## Why you might see “Node” in the project folder

| What you see | What it is |
|--------------|------------|
| `node_modules/` | Dev dependencies only — not shipped to users |
| `npm` / `node` when building | Used once to **compile** the Electron exe |
| **`AgentBob-1.0.0-portable.exe`** | **The real desktop app** (Electron inside) |
| ~~`dist/AgentBob/` with `node.exe`~~ | Old approach — **ignore / delete** |

## Architecture

```
BobAgentApp/
  electron/main.js       Electron app shell
  electron/preload.js    UI bridge
  lib/                   Recorder + Playwright
  public/                Same UI as Chrome extension
  browsers/              Chromium (bundled into exe at build time)
```

## Chrome extension

The extension in `C:\GIT\BobAgent\api-recorder-extension` remains available for users who can install Chrome extensions.
