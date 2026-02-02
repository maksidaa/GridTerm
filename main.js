const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const os = require('os');
const crypto = require('crypto');
const { ServerTracker } = require('./src/services/server-tracker.js');
const { ExpoDetector } = require('./src/services/expo-detector.js');

// Server tracking instance
let serverTracker = null;

let mainWindow;
const terminals = new Map();
const configPath = path.join(app.getPath('userData'), 'config.json');

// GridTerm library paths
const gridtermDir = path.join(os.homedir(), '.gridterm');
const libraryDir = path.join(gridtermDir, 'library');
const agentsLibDir = path.join(libraryDir, 'agents');
const sourcesPath = path.join(gridtermDir, 'sources.json');

// Global Claude commands path
const globalClaudeCommandsDir = path.join(os.homedir(), '.claude', 'commands');

// Track active file watchers
const activeWatchers = new Map();

// Ensure library directories exist
function ensureLibraryDirs() {
  [gridtermDir, libraryDir, agentsLibDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  // Also ensure global Claude commands dir exists
  if (!fs.existsSync(globalClaudeCommandsDir)) {
    fs.mkdirSync(globalClaudeCommandsDir, { recursive: true });
  }
}

// Copy a command file to global Claude commands
function syncToGlobalCommands(filePath, filename) {
  try {
    if (!fs.existsSync(filePath)) return;
    const destPath = path.join(globalClaudeCommandsDir, filename);
    fs.copyFileSync(filePath, destPath);
    console.log(`Synced ${filename} to global Claude commands`);
  } catch (e) {
    console.error('Error syncing to global commands:', e);
  }
}

// Sync all commands from a directory to global
function syncDirToGlobal(dirPath) {
  const agentDirs = findAgentDirs(dirPath);
  let synced = 0;

  for (const agentDir of agentDirs) {
    // Only sync from commands/skills folders
    if (!agentDir.includes('/commands') && !agentDir.includes('/skills')) continue;

    try {
      const files = fs.readdirSync(agentDir);
      for (const file of files) {
        if (file.endsWith('.md') && file !== 'README.md') {
          const srcPath = path.join(agentDir, file);
          syncToGlobalCommands(srcPath, file);
          synced++;
        }
      }
    } catch (e) {
      console.error('Error syncing directory:', agentDir, e);
    }
  }
  return synced;
}

// Watch a directory for new command files
function watchDirectory(dirPath) {
  const agentDirs = findAgentDirs(dirPath);

  for (const agentDir of agentDirs) {
    if (activeWatchers.has(agentDir)) continue;

    try {
      const watcher = fs.watch(agentDir, (eventType, filename) => {
        if (filename && filename.endsWith('.md') && filename !== 'README.md') {
          console.log(`Detected ${eventType} for ${filename} in ${agentDir}`);
          const filePath = path.join(agentDir, filename);

          // Small delay to ensure file is fully written
          setTimeout(() => {
            if (fs.existsSync(filePath)) {
              // Sync to global commands
              if (agentDir.includes('/commands') || agentDir.includes('/skills')) {
                syncToGlobalCommands(filePath, filename);
              }
              // Re-import to library
              importAgentsFromDir(path.dirname(agentDir.replace('/.claude/', '/').replace('/commands', '').replace('/skills', '')));
              // Notify renderer to refresh
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('library:updated');
              }
            }
          }, 500);
        }
      });

      activeWatchers.set(agentDir, watcher);
      console.log(`Watching ${agentDir} for changes`);
    } catch (e) {
      console.error('Error watching directory:', agentDir, e);
    }
  }
}

// Scan all saved directories on startup
function scanAllDirectories() {
  const config = loadConfig();
  const directories = config.directories || [];

  console.log(`Scanning ${directories.length} saved directories...`);

  for (const dir of directories) {
    if (dir.path && fs.existsSync(dir.path)) {
      // Import agents to library
      importAgentsFromDir(dir.path);
      // Sync to global commands
      syncDirToGlobal(dir.path);
      // Set up watcher
      watchDirectory(dir.path);
    }
  }
}

// Load sources tracking
function loadSources() {
  try {
    if (fs.existsSync(sourcesPath)) {
      return JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading sources:', e);
  }
  return { agents: {} };
}

// Save sources tracking
function saveSources(sources) {
  try {
    fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));
  } catch (e) {
    console.error('Error saving sources:', e);
  }
}

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  // Scan all directories on startup (after a short delay to let window load)
  setTimeout(() => {
    ensureLibraryDirs();
    scanAllDirectories();
  }, 1000);

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

// Load subagents from GridTerm's own directory
ipcMain.handle('subagents:load', async () => {
  const subagentsDir = path.join(__dirname, 'subagents');
  return loadSubagentsFromPath(subagentsDir);
});

// Load subagents from a specific project directory
ipcMain.handle('subagents:loadFromDir', async (event, dirPath) => {
  // Look for subagents in common locations
  const possiblePaths = [
    path.join(dirPath, 'subagents'),
    path.join(dirPath, '.claude', 'subagents'),
    path.join(dirPath, '.claude', 'skills'),
    path.join(dirPath, '.gridterm', 'subagents'),
    path.join(dirPath, 'agents'),
    path.join(dirPath, 'skills'),
  ];

  let subagents = [];
  for (const subagentsDir of possiblePaths) {
    const found = loadSubagentsFromPath(subagentsDir);
    subagents = subagents.concat(found);
  }
  return subagents;
});

function loadSubagentsFromPath(subagentsDir) {
  const subagents = [];
  try {
    if (fs.existsSync(subagentsDir)) {
      const files = fs.readdirSync(subagentsDir);
      for (const file of files) {
        const filePath = path.join(subagentsDir, file);

        if (file.endsWith('.json')) {
          // Load JSON subagent
          const content = fs.readFileSync(filePath, 'utf8');
          const subagent = JSON.parse(content);
          subagent._source = subagentsDir;
          subagents.push(subagent);
        } else if (file.endsWith('.md') && file !== 'README.md') {
          // Load Markdown agent
          const content = fs.readFileSync(filePath, 'utf8');
          const subagent = parseMarkdownAgent(content, file, subagentsDir);
          if (subagent) {
            subagent._source = subagentsDir;
            subagent._file = filePath;
            subagents.push(subagent);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error loading subagents from', subagentsDir, e);
  }
  return subagents;
}

function parseMarkdownAgent(content, filename, sourcePath) {
  try {
    // Extract title from first # heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const fullTitle = titleMatch ? titleMatch[1].trim() : filename.replace('.md', '');

    // Check if title contains a slash command (e.g., "# /diff - What Changed?")
    const slashCmdMatch = fullTitle.match(/^(\/\w+(?:-\w+)*)\s*[-–—]?\s*(.*)$/);

    // Check if this is from a commands folder (use filename as command)
    const isCommandsFolder = sourcePath && sourcePath.includes('/commands');
    const baseFilename = filename.replace('.md', '');

    let name, command, autoExec, isSlashCommand;

    if (slashCmdMatch) {
      // Title has a slash command like "# /diff - What Changed?"
      command = slashCmdMatch[1];
      name = slashCmdMatch[2] || slashCmdMatch[1];
      autoExec = true;
      isSlashCommand = true;
    } else if (isCommandsFolder) {
      // File is in commands folder - use filename as slash command
      command = '/' + baseFilename;
      name = fullTitle.split('—')[0].split('-')[0].trim(); // Get name before any dashes
      autoExec = true;
      isSlashCommand = true;
    } else {
      // This is an agent without a slash command
      name = fullTitle.replace(' Agent', '').trim();
      command = `Read the agent file at ${filename} and act as the ${name}. Follow its guidelines and expertise to help with: `;
      autoExec = false;
      isSlashCommand = false;
    }

    // Extract description from ## Role, ## Identity, ## Instructions, or first paragraph
    let description = '';
    const roleMatch = content.match(/##\s+(?:Role|Your Role)\s*\n([\s\S]*?)(?=\n##|\n---|\n\n\n)/);
    const identityMatch = content.match(/##\s+Identity\s*\n([\s\S]*?)(?=\n##|\n---|\n\n\n)/);
    const instructMatch = content.match(/##\s+Instructions\s*\n([\s\S]*?)(?=\n##|\n---|\n\n\n)/);

    if (identityMatch) {
      description = identityMatch[1].replace(/\*\*/g, '').replace(/>/g, '').trim().split('\n')[0].substring(0, 150);
    } else if (roleMatch) {
      description = roleMatch[1].replace(/\*\*/g, '').replace(/>/g, '').trim().split('\n')[0].substring(0, 150);
    } else if (instructMatch) {
      description = instructMatch[1].replace(/\*\*/g, '').replace(/>/g, '').trim().split('\n')[0].substring(0, 150);
    } else {
      // Get first paragraph after title
      const firstPara = content.match(/^#.+\n\n(.+)/m);
      if (firstPara) {
        description = firstPara[1].replace(/\*\*/g, '').substring(0, 150);
      }
    }

    // Ensure we have a valid name
    const finalName = name || baseFilename;

    return {
      name: finalName,
      icon: getAgentIcon(finalName),
      description: description || 'Specialized skill',
      usage: isSlashCommand ? `Run ${command}` : `Summon the ${finalName} for specialized help`,
      command: command,
      autoExec: autoExec,
      isMarkdown: true,
      isSlashCommand: isSlashCommand
    };
  } catch (e) {
    console.error('Error parsing markdown agent:', filename, e);
    return null;
  }
}

function getAgentIcon(name) {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('ui') || nameLower.includes('ux')) return '🎨';
  if (nameLower.includes('workflow')) return '🔄';
  if (nameLower.includes('permission')) return '🔐';
  if (nameLower.includes('onboard')) return '🚀';
  if (nameLower.includes('test')) return '🧪';
  if (nameLower.includes('security')) return '🛡️';
  if (nameLower.includes('database') || nameLower.includes('data')) return '🗄️';
  if (nameLower.includes('api')) return '🔌';
  return '🤖';
}

// === LIBRARY MANAGEMENT ===

// Load all agents from the library
ipcMain.handle('library:loadAgents', async () => {
  ensureLibraryDirs();
  const agents = [];
  const sources = loadSources();

  // Load from GridTerm library
  try {
    const files = fs.readdirSync(agentsLibDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(agentsLibDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const agent = JSON.parse(content);
        // Add source info
        agent._sourceProject = sources.agents[agent.name] || 'Unknown';
        agents.push(agent);
      }
    }
  } catch (e) {
    console.error('Error loading library agents:', e);
  }

  // Also load from global Claude commands (~/.claude/commands/)
  const globalCommandsDir = path.join(os.homedir(), '.claude', 'commands');
  try {
    if (fs.existsSync(globalCommandsDir)) {
      const globalAgents = loadSubagentsFromPath(globalCommandsDir);
      for (const agent of globalAgents) {
        if (agent && agent.name) {
          agent._sourceProject = 'Global (~/.claude/commands)';
          agent._isGlobal = true;
          agents.push(agent);
        }
      }
    }
  } catch (e) {
    console.error('Error loading global commands:', e);
  }

  return agents;
});

// Find all agent/skill directories recursively
function findAgentDirs(baseDir, maxDepth = 4) {
  const agentDirs = [];
  const targetNames = ['subagents', 'agents', 'skills', 'commands'];

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        const fullPath = path.join(dir, entry.name);

        // Check if this is an agent directory
        if (targetNames.includes(entry.name)) {
          agentDirs.push(fullPath);
        }

        // Also check for .claude subdirectory pattern
        if (entry.name === '.claude') {
          const skillsPath = path.join(fullPath, 'skills');
          const subagentsPath = path.join(fullPath, 'subagents');
          const commandsPath = path.join(fullPath, 'commands');
          if (fs.existsSync(skillsPath)) agentDirs.push(skillsPath);
          if (fs.existsSync(subagentsPath)) agentDirs.push(subagentsPath);
          if (fs.existsSync(commandsPath)) agentDirs.push(commandsPath);
        }

        // Recurse into subdirectories
        scan(fullPath, depth + 1);
      }
    } catch (e) {
      // Ignore permission errors
    }
  }

  scan(baseDir, 0);
  return agentDirs;
}

// Shared function to import agents from a directory
function importAgentsFromDir(dirPath) {
  ensureLibraryDirs();
  const sources = loadSources();
  const imported = [];

  const projectName = path.basename(dirPath);

  // Find all agent directories recursively
  const agentDirs = findAgentDirs(dirPath);

  for (const searchPath of agentDirs) {
    const agents = loadSubagentsFromPath(searchPath);

    for (const agent of agents) {
      // Skip agents without a name
      if (!agent || !agent.name) {
        console.log('Skipping agent without name from', searchPath);
        continue;
      }

      // Create a sanitized filename
      const filename = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
      const destPath = path.join(agentsLibDir, filename);

      // Save agent to library
      const libraryAgent = {
        ...agent,
        _importedFrom: searchPath,
        _importedAt: new Date().toISOString(),
        _projectName: projectName
      };

      fs.writeFileSync(destPath, JSON.stringify(libraryAgent, null, 2));

      // Track source
      sources.agents[agent.name] = projectName;
      imported.push(agent.name);
    }
  }

  saveSources(sources);

  // Also sync commands/skills to global Claude commands
  syncDirToGlobal(dirPath);

  // Set up file watcher for this directory
  watchDirectory(dirPath);

  return { imported, count: imported.length };
}

// Import agents from a directory into the library
ipcMain.handle('library:importFromDir', async (event, dirPath) => {
  return importAgentsFromDir(dirPath);
});

// Sync a directory when it's added (called when user adds a new directory)
ipcMain.handle('library:syncDirectory', async (event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return { synced: 0 };

  // Import to library
  const importResult = importAgentsFromDir(dirPath);

  // Sync to global
  const synced = syncDirToGlobal(dirPath);

  // Watch for changes
  watchDirectory(dirPath);

  return { ...importResult, globalSynced: synced };
});

// Browse and import from a selected directory
ipcMain.handle('library:browseAndImport', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Directory to Import Agents From'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const dirPath = result.filePaths[0];
    const importResult = importAgentsFromDir(dirPath);
    return { dirPath, ...importResult };
  }
  return null;
});

// Get library stats
ipcMain.handle('library:getStats', async () => {
  ensureLibraryDirs();
  const sources = loadSources();

  try {
    const files = fs.readdirSync(agentsLibDir).filter(f => f.endsWith('.json'));
    const projects = [...new Set(Object.values(sources.agents))];

    return {
      totalAgents: files.length,
      projects: projects,
      projectCount: projects.length
    };
  } catch (e) {
    return { totalAgents: 0, projects: [], projectCount: 0 };
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
