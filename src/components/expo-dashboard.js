// ExpoDashboard - Tile view for managing Expo projects
const { QRGenerator } = require('./qr-generator.js');

class ExpoDashboard {
  constructor(container, app) {
    this.container = container;
    this.app = app; // Reference to GridTermApp
    this.projects = [];
    this.runningServers = new Map();
    this.localIp = null;
  }

  async render() {
    this.container.innerHTML = `
      <div class="expo-dashboard">
        <div class="dashboard-header">
          <h2>Expo Projects</h2>
          <div class="dashboard-actions">
            <button class="dashboard-btn refresh-btn">Refresh</button>
            <button class="dashboard-btn add-project-btn">+ Add Project</button>
          </div>
        </div>
        <div class="dashboard-grid" id="expo-projects-grid">
          <div class="loading-state">Scanning for Expo servers...</div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadLocalIp();
    await this.loadProjects();
  }

  async loadLocalIp() {
    try {
      this.localIp = await window.expo.getLocalIp();
    } catch (e) {
      console.error('Error getting local IP:', e);
      this.localIp = '192.168.1.1';
    }
  }

  async loadProjects() {
    // Load from saved config
    try {
      const config = await window.config.load();
      this.projects = (config.expoProjects || []).map(p => ({
        ...p,
        running: false,
        autoDetected: false
      }));
    } catch (e) {
      console.error('Error loading config:', e);
      this.projects = [];
    }

    // Detect running Expo servers
    try {
      const runningExpo = await window.expo.detect();
      for (const server of runningExpo) {
        const existing = this.projects.find(p => p.port === server.port);
        if (existing) {
          existing.running = true;
          existing.webUrl = server.webUrl;
          existing.expUrl = server.expUrl;
        } else {
          this.projects.push({
            id: `auto-${server.port}`,
            name: `Expo (port ${server.port})`,
            port: server.port,
            webUrl: server.webUrl,
            expUrl: server.expUrl,
            running: true,
            autoDetected: true
          });
        }
      }
    } catch (e) {
      console.error('Error detecting Expo servers:', e);
    }

    // Also check active servers from server tracker
    try {
      const activeServers = await window.servers.getActive();
      for (const server of activeServers) {
        if (server.type === 'expo') {
          const existing = this.projects.find(p => p.port === server.port);
          if (existing) {
            existing.running = true;
          } else {
            this.projects.push({
              id: `tracked-${server.port}`,
              name: server.name || `Expo (port ${server.port})`,
              port: server.port,
              webUrl: server.url,
              expUrl: `exp://${this.localIp}:${server.port}`,
              running: true,
              autoDetected: true
            });
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
          <div class="empty-hint">Start an Expo server or add a project manually</div>
        </div>
      `;
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
      <div class="tile-icon">${project.icon || '&#128241;'}</div>
      <div class="tile-name">${project.name}</div>
      <div class="tile-status">
        <span class="status-dot ${project.running ? 'online' : 'offline'}"></span>
        ${project.running ? `Port ${project.port}` : 'Stopped'}
      </div>
      <div class="tile-actions">
        ${project.running ? `
          <button class="tile-btn preview-btn" data-port="${project.port}">Preview</button>
          <button class="tile-btn qr-btn" data-port="${project.port}">QR</button>
        ` : `
          <button class="tile-btn start-btn" data-path="${project.path || ''}">Start</button>
        `}
        ${!project.autoDetected ? `
          <button class="tile-btn remove-btn" data-id="${project.id}" title="Remove">&#10005;</button>
        ` : ''}
      </div>
    `;

    // Event listeners for tile actions
    const previewBtn = tile.querySelector('.preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openExpoPreview(project);
      });
    }

    const qrBtn = tile.querySelector('.qr-btn');
    if (qrBtn) {
      qrBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showQRCode(project);
      });
    }

    const startBtn = tile.querySelector('.start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startExpoServer(project);
      });
    }

    const removeBtn = tile.querySelector('.remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeProject(project.id);
      });
    }

    return tile;
  }

  async openExpoPreview(project) {
    // Create new Expo preview pane
    await this.app.createExpoPanePreview({
      name: project.name,
      url: project.webUrl || `http://localhost:${project.port}`,
      showQR: true
    });

    // Close dashboard modal
    this.hide();
  }

  async startExpoServer(project) {
    if (!project.path) {
      alert('No project path configured. Please add the project path first.');
      return;
    }

    // Open terminal and run expo start
    await this.app.createTerminal({
      name: `${project.name} - Metro`,
      directory: project.path,
      aiCommand: null,
      startupCommands: ['npx expo start --web']
    });

    // Close dashboard
    this.hide();
  }

  showQRCode(project) {
    const expUrl = project.expUrl || `exp://${this.localIp}:${project.port}`;

    // Create QR modal
    const modal = document.createElement('div');
    modal.className = 'qr-modal';
    modal.innerHTML = `
      <div class="qr-modal-content">
        <h3>${project.name}</h3>
        <canvas id="project-qr-canvas" width="256" height="256"></canvas>
        <div class="qr-modal-url">${expUrl}</div>
        <div class="qr-modal-hint">Scan with Expo Go app on your device</div>
        <button class="qr-modal-close">Close</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Generate QR
    const canvas = modal.querySelector('#project-qr-canvas');
    QRGenerator.generate(expUrl, canvas, { size: 256 });

    // Close button
    modal.querySelector('.qr-modal-close').addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  async removeProject(projectId) {
    this.projects = this.projects.filter(p => p.id !== projectId);
    await this.saveProjects();
    this.renderProjectGrid();
  }

  async saveProjects() {
    try {
      const config = await window.config.load();
      // Only save manually added projects (not auto-detected)
      config.expoProjects = this.projects.filter(p => !p.autoDetected);
      await window.config.save(config);
    } catch (e) {
      console.error('Error saving projects:', e);
    }
  }

  setupEventListeners() {
    // Refresh button
    const refreshBtn = this.container.querySelector('.refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        await this.loadProjects();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
      });
    }

    // Add project button
    const addBtn = this.container.querySelector('.add-project-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.showAddProjectModal();
      });
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
    } else {
      this.projects.push({
        id: `auto-${info.port}`,
        name: info.name || `Expo (port ${info.port})`,
        port: info.port,
        webUrl: info.url,
        expUrl: `exp://${this.localIp}:${info.port}`,
        running: true,
        autoDetected: true
      });
    }
    this.renderProjectGrid();
  }

  handleServerLost(info) {
    const project = this.projects.find(p => p.port === info.port);
    if (project) {
      if (project.autoDetected) {
        // Remove auto-detected projects when they stop
        this.projects = this.projects.filter(p => p.port !== info.port);
      } else {
        project.running = false;
      }
      this.renderProjectGrid();
    }
  }

  showAddProjectModal() {
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
          <label>Default Port (optional)</label>
          <input type="number" id="new-project-port" placeholder="8081">
        </div>
        <div class="modal-buttons">
          <button class="btn-secondary cancel-add">Cancel</button>
          <button class="btn-primary save-project">Add Project</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Browse button
    modal.querySelector('#browse-project-path').addEventListener('click', async () => {
      const folderPath = await window.dialog.selectFolder();
      if (folderPath) {
        modal.querySelector('#new-project-path').value = folderPath;
        // Try to get project name from path
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

    // Cancel button
    modal.querySelector('.cancel-add').addEventListener('click', () => {
      modal.remove();
    });

    // Save button
    modal.querySelector('.save-project').addEventListener('click', async () => {
      const name = modal.querySelector('#new-project-name').value.trim();
      const path = modal.querySelector('#new-project-path').value.trim();
      const port = parseInt(modal.querySelector('#new-project-port').value) || 8081;

      if (!name) {
        alert('Please enter a project name');
        return;
      }

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

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  hide() {
    const dashboardModal = document.getElementById('expo-dashboard-modal');
    if (dashboardModal) {
      dashboardModal.classList.add('hidden');
    }
  }

  show() {
    const dashboardModal = document.getElementById('expo-dashboard-modal');
    if (dashboardModal) {
      dashboardModal.classList.remove('hidden');
    }
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ExpoDashboard };
}
