const { app, BrowserWindow, ipcMain, dialog, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const os = require('os');
const crypto = require('crypto');
const { ServerTracker } = require('./src/services/server-tracker.js');

// Server tracking instance
let serverTracker = null;

let mainWindow;
const terminals = new Map();
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading config:', e);
  }
  return { commands: [] };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

function createWindow() {
  // Get the work area (screen minus menu bar and dock)
  const { workArea } = screen.getPrimaryDisplay();

  // Constrain window size to work area
  const width = Math.min(1200, workArea.width);
  const height = Math.min(800, workArea.height);

  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('src/index.html');
}

// Security: Configure webview defaults
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // Strip preload scripts for security
    delete webPreferences.preload;
    // Disable Node integration in webviews
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
});

app.whenReady().then(() => {
  createWindow();

  // Initialize server tracker
  serverTracker = new ServerTracker({ pollInterval: 5000 });

  // Forward server events to renderer
  serverTracker.on('server:found', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:found', info);
    }
  });

  serverTracker.on('server:lost', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:lost', info);
    }
  });

  // Start tracking after a short delay
  setTimeout(() => {
    serverTracker.start();
  }, 2000);
});

app.on('window-all-closed', () => {
  // Clean up all terminals
  terminals.forEach((term) => term.kill());
  terminals.clear();

  // Stop server tracker
  if (serverTracker) {
    serverTracker.stop();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Build proper shell environment with common paths
function getShellEnv() {
  const homeDir = os.homedir();
  const env = { ...process.env };

  // Build a comprehensive PATH that includes common Node installation locations
  const additionalPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(homeDir, '.nvm/versions/node/v22.14.0/bin'),  // Common nvm path
    path.join(homeDir, '.nvm/versions/node/v20.18.0/bin'),  // Fallback nvm versions
    path.join(homeDir, '.nvm/versions/node/v18.20.0/bin'),
    path.join(homeDir, '.npm-global/bin'),
    path.join(homeDir, '.local/bin'),
    path.join(homeDir, 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(p => fs.existsSync(p));

  // Also try to find the actual nvm node path dynamically
  const nvmDir = path.join(homeDir, '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const nodeVersions = fs.readdirSync(nvmDir).filter(v => v.startsWith('v'));
      if (nodeVersions.length > 0) {
        // Sort versions and get the latest
        nodeVersions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const latestNodeBin = path.join(nvmDir, nodeVersions[0], 'bin');
        if (fs.existsSync(latestNodeBin) && !additionalPaths.includes(latestNodeBin)) {
          additionalPaths.unshift(latestNodeBin);
        }
      }
    } catch (e) {
      console.error('Error scanning nvm versions:', e);
    }
  }

  env.PATH = additionalPaths.join(':') + ':' + (env.PATH || '');

  return env;
}

// Terminal IPC handlers
ipcMain.handle('terminal:create', (event, id) => {
  const shell = process.env.SHELL || '/bin/zsh';
  // Spawn as login shell (-l) to source user's profile, with enhanced PATH
  const term = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: getShellEnv()
  });

  terminals.set(id, term);

  term.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', id, data);
    }
  });

  term.onExit(() => {
    terminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', id);
    }
  });

  return true;
});

ipcMain.handle('terminal:write', (event, id, data) => {
  const term = terminals.get(id);
  if (term) {
    term.write(data);
  }
});

ipcMain.handle('terminal:resize', (event, id, cols, rows) => {
  const term = terminals.get(id);
  if (term) {
    term.resize(cols, rows);
  }
});

ipcMain.handle('terminal:kill', (event, id) => {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
});

// Config IPC handlers
ipcMain.handle('config:load', () => {
  return loadConfig();
});

ipcMain.handle('config:save', (event, config) => {
  saveConfig(config);
});

// Dialog IPC handlers
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Image/Screenshot handling for drag-and-drop
const droppedImagesDir = path.join(os.tmpdir(), 'gridterm-images');

// Ensure the images directory exists
function ensureImagesDir() {
  if (!fs.existsSync(droppedImagesDir)) {
    fs.mkdirSync(droppedImagesDir, { recursive: true });
  }
}

// Save a dropped image file and return its path
ipcMain.handle('image:saveDroppedFile', async (event, filePath) => {
  ensureImagesDir();
  try {
    // If it's already a valid image path, just return it
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
        return filePath;
      }
    }
    return null;
  } catch (e) {
    console.error('Error handling dropped file:', e);
    return null;
  }
});

// Save image data (base64 or buffer) to a temp file
ipcMain.handle('image:saveImageData', async (event, imageData, format = 'png') => {
  ensureImagesDir();
  try {
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(4).toString('hex');
    const filename = `screenshot-${timestamp}-${randomId}.${format}`;
    const filePath = path.join(droppedImagesDir, filename);

    // Handle base64 data
    if (typeof imageData === 'string') {
      // Remove data URL prefix if present
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    } else {
      // Handle buffer
      fs.writeFileSync(filePath, imageData);
    }

    return filePath;
  } catch (e) {
    console.error('Error saving image data:', e);
    return null;
  }
});

// Get image from clipboard
ipcMain.handle('image:getFromClipboard', async () => {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }

    ensureImagesDir();
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(4).toString('hex');
    const filename = `clipboard-${timestamp}-${randomId}.png`;
    const filePath = path.join(droppedImagesDir, filename);

    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
  } catch (e) {
    console.error('Error getting clipboard image:', e);
    return null;
  }
});

// === EXPO INTEGRATION ===

// Get local IP address for Expo Go QR codes
ipcMain.handle('expo:getLocalIp', () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
});

// Get Expo project info from app.json/package.json
ipcMain.handle('expo:getProjectInfo', async (event, projectPath) => {
  try {
    const appJsonPath = path.join(projectPath, 'app.json');
    const packageJsonPath = path.join(projectPath, 'package.json');

    let appConfig = {};
    let packageConfig = {};

    if (fs.existsSync(appJsonPath)) {
      appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    }
    if (fs.existsSync(packageJsonPath)) {
      packageConfig = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    }

    return {
      name: appConfig.expo?.name || packageConfig.name || 'Unknown',
      slug: appConfig.expo?.slug,
      version: appConfig.expo?.version || packageConfig.version,
      sdkVersion: appConfig.expo?.sdkVersion,
      icon: appConfig.expo?.icon
    };
  } catch (e) {
    console.error('Error getting Expo project info:', e);
    return { name: 'Unknown Project' };
  }
});

// Detect running Expo/Metro servers
ipcMain.handle('expo:detect', async () => {
  const expoPorts = [8081, 19000, 19001, 19002, 19006];
  const servers = [];

  for (const port of expoPorts) {
    try {
      const isOpen = await checkPort(port);
      if (isOpen) {
        servers.push({
          port,
          type: 'expo',
          webUrl: `http://localhost:${port}`,
          expUrl: `exp://localhost:${port}`
        });
      }
    } catch (e) {
      // Port not open, skip
    }
  }

  return servers;
});

// Scan filesystem for Expo projects
ipcMain.handle('expo:scanProjects', async () => {
  const { ExpoDetector } = require('./src/services/expo-detector.js');
  const desktopPath = path.join(os.homedir(), 'Desktop');

  try {
    const projects = ExpoDetector.scanDirectoryForExpoProjects(desktopPath, 3);
    return projects;
  } catch (e) {
    console.error('Error scanning for Expo projects:', e);
    return [];
  }
});

// Track running Expo background processes
const expoProcesses = new Map(); // port -> { process, projectName, projectPath }

// Start Expo in background mode (no terminal pane)
ipcMain.handle('expo:startBackground', async (event, { projectPath, projectName, port, mode }) => {
  const { spawn } = require('child_process');

  // Check if already running on this port
  if (expoProcesses.has(port)) {
    return { success: false, error: 'Already running on this port' };
  }

  const args = ['expo', 'start', '--port', String(port)];
  if (mode === 'ios') args.push('--ios');
  if (mode === 'web') args.push('--web');

  try {
    const proc = spawn('npx', args, {
      cwd: projectPath,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    expoProcesses.set(port, {
      process: proc,
      projectName,
      projectPath,
      port,
      mode,
      startedAt: Date.now()
    });

    proc.on('exit', () => {
      expoProcesses.delete(port);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('expo:processStopped', { port, projectName });
      }
    });

    // Notify renderer that process started
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('expo:processStarted', { port, projectName, mode });
    }

    return { success: true, port };
  } catch (e) {
    console.error('Error starting Expo:', e);
    return { success: false, error: e.message };
  }
});

// Stop a background Expo process
ipcMain.handle('expo:stopBackground', async (event, { port }) => {
  const info = expoProcesses.get(port);
  if (!info) {
    return { success: false, error: 'No process on this port' };
  }

  try {
    info.process.kill('SIGTERM');
    expoProcesses.delete(port);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Get list of running background Expo processes
ipcMain.handle('expo:getBackgroundProcesses', async () => {
  const list = [];
  for (const [port, info] of expoProcesses) {
    list.push({
      port,
      projectName: info.projectName,
      projectPath: info.projectPath,
      mode: info.mode,
      startedAt: info.startedAt
    });
  }
  return list;
});

// Arrange windows side-by-side for dev mode
ipcMain.handle('window:arrangeDevMode', async () => {
  const { exec } = require('child_process');

  // Get screen dimensions
  const { workArea } = screen.getPrimaryDisplay();

  // First, get the Simulator's current position
  const getSimPositionScript = `
    tell application "System Events"
      if not (exists process "Simulator") then
        return "Simulator not running"
      end if

      tell process "Simulator"
        try
          set simPos to position of window 1
          return (item 1 of simPos) as text
        on error
          return "error"
        end try
      end tell
    end tell
  `;

  return new Promise((resolve) => {
    exec(`osascript -e '${getSimPositionScript.replace(/'/g, "'\\''")}'`, (error, stdout, stderr) => {
      if (error) {
        console.error('AppleScript error:', stderr);
        resolve('error');
        return;
      }

      const result = stdout.trim();
      if (result === 'Simulator not running') {
        resolve('Simulator not running');
        return;
      }

      const simX = parseInt(result, 10);
      if (isNaN(simX)) {
        console.error('Could not parse Simulator position:', result);
        resolve('error');
        return;
      }

      // Resize GridTerm to fill from left edge to Simulator's left edge
      const gridTermWidth = simX - workArea.x;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBounds({
          x: workArea.x,
          y: workArea.y,
          width: Math.max(gridTermWidth, 400), // Minimum width of 400px
          height: workArea.height
        });
        mainWindow.focus();
      }

      resolve('arranged');
    });
  });
});

// Helper function to check if a port is open
function checkPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();

    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, '127.0.0.1');
  });
}

// === SERVER TRACKING ===

// Get all currently active servers
ipcMain.handle('servers:getActive', () => {
  if (serverTracker) {
    return serverTracker.getActiveServers();
  }
  return [];
});

// Trigger a manual scan of all ports
ipcMain.handle('servers:scan', async () => {
  if (serverTracker) {
    return await serverTracker.scanPorts();
  }
  return [];
});

// Add a custom port to monitor
ipcMain.handle('servers:addPort', (event, port) => {
  if (serverTracker) {
    serverTracker.addCustomPort(port);
  }
});

// Remove a custom port from monitoring
ipcMain.handle('servers:removePort', (event, port) => {
  if (serverTracker) {
    serverTracker.removeCustomPort(port);
  }
});
