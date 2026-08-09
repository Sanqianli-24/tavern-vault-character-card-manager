const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktop: true,
  listCards: () => ipcRenderer.invoke("cards:list"),
  importCards: (entries) => ipcRenderer.invoke(
    "cards:import",
    entries.map((entry) => ({
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
  getTavernStatus: () => ipcRenderer.invoke("tavern:status"),
  startSillyTavern: () => ipcRenderer.invoke("tavern:start"),
  onTavernProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("tavern:progress", handler);
    return () => ipcRenderer.removeListener("tavern:progress", handler);
  },
});
