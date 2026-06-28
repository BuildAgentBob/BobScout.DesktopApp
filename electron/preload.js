const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentBob", {
  sendMessage(message) {
    return ipcRenderer.invoke("agent-bob-message", message);
  },
  isElectron: true
});
