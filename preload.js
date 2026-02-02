const { ipcRenderer } = require('electron');

window.terminal = {
  create: (id) => ipcRenderer.invoke('terminal:create', id),
  write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  kill: (id) => ipcRenderer.invoke('terminal:kill', id),
  onData: (callback) => {
    ipcRenderer.on('terminal:data', (event, id, data) => callback(id, data));
  },
  onExit: (callback) => {
    ipcRenderer.on('terminal:exit', (event, id) => callback(id));
  }
};

window.config = {
  load: () => ipcRenderer.invoke('config:load'),
  save: (data) => ipcRenderer.invoke('config:save', data)
};

window.dialog = {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder')
};

window.subagents = {
  load: () => ipcRenderer.invoke('subagents:load'),
  loadFromDir: (dirPath) => ipcRenderer.invoke('subagents:loadFromDir', dirPath)
};

window.library = {
  loadAgents: () => ipcRenderer.invoke('library:loadAgents'),
  importFromDir: (dirPath) => ipcRenderer.invoke('library:importFromDir', dirPath),
  browseAndImport: () => ipcRenderer.invoke('library:browseAndImport'),
  getStats: () => ipcRenderer.invoke('library:getStats'),
  syncDirectory: (dirPath) => ipcRenderer.invoke('library:syncDirectory', dirPath),
  onUpdated: (callback) => {
    ipcRenderer.on('library:updated', () => callback());
  }
};

// Image/Screenshot handling
window.image = {
  saveDroppedFile: (filePath) => ipcRenderer.invoke('image:saveDroppedFile', filePath),
  saveImageData: (imageData, format) => ipcRenderer.invoke('image:saveImageData', imageData, format),
  getFromClipboard: () => ipcRenderer.invoke('image:getFromClipboard')
};

// Server tracking
window.servers = {
  getActive: () => ipcRenderer.invoke('servers:getActive'),
  scan: () => ipcRenderer.invoke('servers:scan'),
  onFound: (callback) => ipcRenderer.on('server:found', (event, info) => callback(info)),
  onLost: (callback) => ipcRenderer.on('server:lost', (event, info) => callback(info))
};

// Expo integration
window.expo = {
  detect: () => ipcRenderer.invoke('expo:detect'),
  getProjectInfo: (path) => ipcRenderer.invoke('expo:getProjectInfo', path),
  getLocalIp: () => ipcRenderer.invoke('expo:getLocalIp')
};
