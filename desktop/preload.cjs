const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktop: true,
  listCards: () => ipcRenderer.invoke("cards:list"),
  importCards: (entries) => ipcRenderer.invoke(
    "cards:import",
    (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && entry.file)
      .map((entry) => ({
        path: webUtils.getPathForFile(entry.file),
        suggestedName: entry.suggestedName,
        sourcePath: entry.sourcePath,
        fileName: entry.file.name,
        fileType: entry.file.type,
        size: entry.file.size,
      })),
  ),
  updateCard: (id, patch) => ipcRenderer.invoke("cards:update", id, patch),
  hydrateCard: (id) => ipcRenderer.invoke("cards:hydrate", id),
  hydrateAllCards: () => ipcRenderer.invoke("cards:hydrateAll"),
  updateCards: (ids, patch) => ipcRenderer.invoke("cards:updateMany", ids, patch),
  deleteCards: (ids) => ipcRenderer.invoke("cards:delete", ids),
  exportCard: (id) => ipcRenderer.invoke("cards:export", id),
  exportCards: (ids) => ipcRenderer.invoke("cards:exportMany", ids),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  pickDirectory: () => ipcRenderer.invoke("settings:pickDirectory"),
  listBackups: () => ipcRenderer.invoke("backups:list"),
  createBackup: () => ipcRenderer.invoke("backups:create"),
  restoreBackup: (name) => ipcRenderer.invoke("backups:restore", name),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
  getTavernStatus: () => ipcRenderer.invoke("tavern:status"),
  startSillyTavern: () => ipcRenderer.invoke("tavern:start"),
  openTavernWindow: () => ipcRenderer.invoke("tavern:openWindow"),
  openTavernBrowser: () => ipcRenderer.invoke("tavern:openBrowser"),
  openLibrary: () => ipcRenderer.invoke("library:open"),
  tavernPanelList: () => ipcRenderer.invoke("tavernPanel:list"),
  tavernPanelCardImage: (id) => ipcRenderer.invoke("tavernPanel:cardImage", id),
  tavernPanelCardPayload: (id) => ipcRenderer.invoke("tavernPanel:cardPayload", id),
  tavernPanelMarkImported: (id, avatar) => ipcRenderer.invoke("tavernPanel:markImported", id, avatar),
  tavernPanelTavernCharacters: () => ipcRenderer.invoke("tavernPanel:tavernCharacters"),
  tavernAdoptCharacter: (avatar) => ipcRenderer.invoke("tavern:adoptCharacter", avatar),
  tavernChatWithCard: (id) => ipcRenderer.invoke("tavern:chatWithCard", id),
  tavernSendToTavern: (ids) => ipcRenderer.invoke("cards:sendToTavern", ids),
  tavernInstallExtension: () => ipcRenderer.invoke("tavern:installExtension"),
  onTavernProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("tavern:progress", handler);
    return () => ipcRenderer.removeListener("tavern:progress", handler);
  },
});
