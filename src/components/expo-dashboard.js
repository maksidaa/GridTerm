// ExpoDashboard - Enhanced Expo project manager with port management
const { QRGenerator } = require('./qr-generator.js');

class ExpoDashboard {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.projects = [];
    this.portAssignments = new Map(); // projectPath -> port
    this.localIp = null;
    this.BASE_PORT = 8081;
  }

  async render() {
    this.container.innerHTML = `
      <div class="expo-dashboard">
        <div class="dashboard-header">
          <h2>Expo Manager</h2>
          <div class="dashboard-actions">
            <button class="dashboard-btn dev-mode-btn" title="Arrange GridTerm + Simulator side-by-side">⚡ Dev Mode</button>
            <button class="dashboard-btn refresh-btn">Refresh</button>
            <button class="dashboard-btn add-project-btn">+ Add Project</button>
          </div>
        </div>
        <div class="dashboard-grid" id="expo-projects-grid">
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Scanning for Expo projects...</p>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadLocalIp();
    await this.loadPortAssignments();
    await this.loadProjects();
  }

  async loadLocalIp() {
    try {
      this.localIp = await window.expo.getLocalIp();
    } catch (e) {
      this.localIp = '192.168.1.1';
    }
  }

  async loadPortAssignments() {
    try {
      const config = await window.config.load();
      const assignments = config.expoPortAssignments || {};
      this.portAssignments = new Map(Object.entries(assignments));
    } catch (e) {
      this.portAssignments = new Map();
    }
  }

  async savePortAssignments() {
    try {
      const config = await window.config.load();
      config.expoPortAssignments = Object.fromEntries(this.portAssignments);
      await window.config.save(config);
    } catch (e) {
      console.error('Error saving port assignments:', e);
    }
  }

  getNextAvailablePort() {
    const usedPorts = new Set(this.portAssignments.values());
    let port = this.BASE_PORT;
    while (usedPorts.has(port)) {
      port++;
    }
    return port;
  }

  getPortForProject(project) {
    if (!project.path) return this.BASE_PORT;

    if (this.portAssignments.has(project.path)) {
      return this.portAssignments.get(project.path);
    }

    // Assign new port
    const port = this.getNextAvailablePort();
    this.portAssignments.set(project.path, port);
    this.savePortAssignments();
    return port;
  }

  async loadProjects() {
    this.projects = [];

    // 1. Scan filesystem for Expo projects
    try {
      const foundProjects = await window.expo.scanProjects();
      for (const project of foundProjects) {
        const port = this.getPortForProject(project);
        this.projects.push({
          id: `found-${project.path}`,
          name: project.name,
          path: project.path,
          version: project.version,
          sdkVersion: project.sdkVersion,
          port: port,
          running: false,
          autoDetected: true
        });
      }
    } catch (e) {
      console.error('Error scanning for Expo projects:', e);
    }

    // 2. Load saved projects
    try {
      const config = await window.config.load();
      const savedProjects = config.expoProjects || [];
      for (const p of savedProjects) {
        if (!this.projects.find(proj => proj.path === p.path)) {
          const port = this.getPortForProject(p);
          this.projects.push({
            ...p,
            port: port,
            running: false,
            autoDetected: false
          });
        }
      }
    } catch (e) {
      console.error('Error loading config:', e);
    }

    // 3. Detect running servers and update status
    try {
      const runningExpo = await window.expo.detect();
      for (const server of runningExpo) {
        const existing = this.projects.find(p => p.port === server.port);
        if (existing) {
          existing.running = true;
          existing.webUrl = server.webUrl;
          existing.expUrl = `exp://${this.localIp}:${server.port}`;
        } else {
          // Unknown running server
          this.projects.push({
            id: `running-${server.port}`,
            name: `Unknown App`,
            port: server.port,
            webUrl: server.webUrl,
            expUrl: `exp://${this.localIp}:${server.port}`,
            running: true,
            autoDetected: true
          });
        }
      }
    } catch (e) {
      console.error('Error detecting servers:', e);
    }

    // 4. Check server tracker
    try {
      const activeServers = await window.servers.getActive();
      for (const server of activeServers) {
        if (server.type === 'expo') {
          const existing = this.projects.find(p => p.port === server.port);
          if (existing) {
            existing.running = true;
            existing.webUrl = server.url;
          }
        }
      }
    } catch (e) {
      console.error('Error getting active servers:', e);
    }

    this.renderProjectGrid();
  }

  renderProjectGrid() {
    const grid = this.container.querySelector('#expo-projects-grid');

    if (this.projects.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#128241;</div>
          <div class="empty-text">No Expo projects found</div>
          <div class="empty-hint">Place your Expo projects in ~/Desktop</div>
          <button class="empty-scan-btn">Scan Again</button>
        </div>
      `;
      const scanBtn = grid.querySelector('.empty-scan-btn');
      if (scanBtn) {
        scanBtn.addEventListener('click', () => this.loadProjects());
      }
      return;
    }

    grid.innerHTML = '';
    for (const project of this.projects) {
      const tile = this.createProjectTile(project);
      grid.appendChild(tile);
    }
  }

  createProjectTile(project) {
    const tile = document.createElement('div');
    tile.className = `project-tile ${project.running ? 'running' : 'stopped'}`;
    tile.dataset.projectId = project.id;

    tile.innerHTML = `
      <div class="tile-header">
        <div class="tile-icon">&#128241;</div>
        <div class="tile-info">
          <div class="tile-name">${project.name}</div>
          <div class="tile-port">
            <span class="port-badge ${project.running ? 'active' : ''}">:${project.port}</span>
            ${project.running ? '<span class="status-indicator running">Running</span>' : '<span class="status-indicator stopped">Stopped</span>'}
          </div>
        </div>
      </div>
      <div class="tile-actions">
        ${project.running ? `
          <button class="tile-btn primary preview-btn">Web Preview</button>
          <button class="tile-btn secondary stop-btn">Stop</button>
        ` : `
          <button class="tile-btn primary start-web-btn">Start Web</button>
          <button class="tile-btn secondary start-ios-btn">Start iOS Sim</button>
        `}
      </div>
      ${project.path ? `<div class="tile-path" title="${project.path}">${this.truncatePath(project.path)}</div>` : ''}
    `;

    // Event listeners
    const previewBtn = tile.querySelector('.preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openWebPreview(project);
      });
    }

    const stopBtn = tile.querySelector('.stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stopServer(project);
      });
    }

    const startWebBtn = tile.querySelector('.start-web-btn');
    if (startWebBtn) {
      startWebBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startWebServer(project);
      });
    }

    const startIosBtn = tile.querySelector('.start-ios-btn');
    if (startIosBtn) {
      startIosBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startIosSimulator(project);
      });
    }

    return tile;
  }

  truncatePath(path) {
    const parts = path.split('/');
    if (parts.length <= 3) return path;
    return '~/' + parts.slice(-2).join('/');
  }

  async openWebPreview(project) {
    await this.app.createExpoPanePreview({
      name: project.name,
      url: project.webUrl || `http://localhost:${project.port}`,
      showQR: false
    });
    this.hide();
  }

  async startWebServer(project) {
    if (!project.path) {
      alert('No project path configured.');
      return;
    }

    // Create terminal pane for Metro bundler (auto-minimizes)
    await this.app.createTerminal({
      name: `${project.name} :${project.port}`,
      directory: project.path,
      aiCommand: null,
      startupCommands: [`npx expo start --port ${project.port} --web`],
      autoMinimize: true
    });

    this.hide();
  }

  async startIosSimulator(project) {
    if (!project.path) {
      alert('No project path configured.');
      return;
    }

    // Create terminal pane for Metro bundler with iOS (auto-minimizes)
    await this.app.createTerminal({
      name: `${project.name} :${project.port}`,
      directory: project.path,
      aiCommand: null,
      startupCommands: [`npx expo start --port ${project.port} --ios`],
      autoMinimize: true
    });

    this.hide();
  }

  async stopServer(project) {
    alert(`To stop ${project.name}, close its terminal pane.`);
  }

  setupEventListeners() {
    // Dev Mode button - arrange windows side-by-side
    const devModeBtn = this.container.querySelector('.dev-mode-btn');
    if (devModeBtn) {
      devModeBtn.addEventListener('click', async () => {
        devModeBtn.disabled = true;
        devModeBtn.textContent = 'Arranging...';
        try {
          const result = await window.windowManager.arrangeDevMode();
          if (result === 'Simulator not running') {
            alert('iOS Simulator is not running. Start an app with "Start iOS Sim" first.');
          }
        } catch (e) {
          console.error('Error arranging windows:', e);
        }
        devModeBtn.disabled = false;
        devModeBtn.textContent = '⚡ Dev Mode';
      });
    }

    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Scanning...';
        const grid = this.container.querySelector('#expo-projects-grid');
        grid.innerHTML = `
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Scanning for Expo projects...</p>
          </div>
        `;
        await this.loadProjects();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
      });
    }

    const addBtn = this.container.querySelector('.add-project-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showAddProjectModal());
    }

    // Listen for server changes
    window.servers.onFound((info) => {
      if (info.type === 'expo') {
        this.handleServerFound(info);
      }
    });

    window.servers.onLost((info) => {
      this.handleServerLost(info);
    });
  }

  handleServerFound(info) {
    const existing = this.projects.find(p => p.port === info.port);
    if (existing) {
      existing.running = true;
      existing.webUrl = info.url;
    }
    this.renderProjectGrid();
  }

  handleServerLost(info) {
    const project = this.projects.find(p => p.port === info.port);
    if (project) {
      project.running = false;
      this.renderProjectGrid();
    }
  }

  showAddProjectModal() {
    const nextPort = this.getNextAvailablePort();
    const modal = document.createElement('div');
    modal.className = 'add-project-modal modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Add Expo Project</h3>
        <div class="form-group">
          <label>Project Name</label>
          <input type="text" id="new-project-name" placeholder="My Expo App">
        </div>
        <div class="form-group">
          <label>Project Path</label>
          <div class="input-with-button">
            <input type="text" id="new-project-path" placeholder="/path/to/project">
            <button class="btn-browse" id="browse-project-path">Browse</button>
          </div>
        </div>
        <div class="form-group">
          <label>Port (auto-assigned: ${nextPort})</label>
          <input type="number" id="new-project-port" value="${nextPort}">
        </div>
        <div class="modal-buttons">
          <button class="btn-secondary cancel-add">Cancel</button>
          <button class="btn-primary save-project">Add Project</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#browse-project-path').addEventListener('click', async () => {
      const folderPath = await window.dialog.selectFolder();
      if (folderPath) {
        modal.querySelector('#new-project-path').value = folderPath;
        const nameInput = modal.querySelector('#new-project-name');
        if (!nameInput.value) {
          try {
            const info = await window.expo.getProjectInfo(folderPath);
            nameInput.value = info.name || folderPath.split('/').pop();
          } catch (e) {
            nameInput.value = folderPath.split('/').pop();
          }
        }
      }
    });

    modal.querySelector('.cancel-add').addEventListener('click', () => modal.remove());

    modal.querySelector('.save-project').addEventListener('click', async () => {
      const name = modal.querySelector('#new-project-name').value.trim();
      const path = modal.querySelector('#new-project-path').value.trim();
      const port = parseInt(modal.querySelector('#new-project-port').value) || nextPort;

      if (!name || !path) {
        alert('Please enter project name and path');
        return;
      }

      // Save port assignment
      this.portAssignments.set(path, port);
      await this.savePortAssignments();

      const project = {
        id: `manual-${Date.now()}`,
        name,
        path,
        port,
        running: false,
        autoDetected: false
      };

      this.projects.push(project);
      await this.saveProjects();
      this.renderProjectGrid();
      modal.remove();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  async saveProjects() {
    try {
      const config = await window.config.load();
      config.expoProjects = this.projects.filter(p => !p.autoDetected);
      await window.config.save(config);
    } catch (e) {
      console.error('Error saving projects:', e);
    }
  }

  hide() {
    const modal = document.getElementById('expo-dashboard-modal');
    if (modal) modal.classList.add('hidden');
  }

  show() {
    const modal = document.getElementById('expo-dashboard-modal');
    if (modal) modal.classList.remove('hidden');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ExpoDashboard };
}
