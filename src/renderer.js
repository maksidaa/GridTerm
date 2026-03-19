const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { BrowserPane } = require('./panes/browser-pane.js');
const { ExpoPanePreview } = require('./panes/expo-pane.js');
const { ExpoDashboard } = require('./components/expo-dashboard.js');



class GridTermApp {
  constructor() {
    this.terminals = new Map();
    this.browserPanes = new Map();
    this.allPanes = new Map(); // Unified pane tracking: { type: 'terminal'|'browser'|'expo', pane: object }
    this.paneCounter = 0;
    this.terminalCounter = 0; // Keep for backwards compatibility
    this.commands = [];
    this.directories = [];
    this.activeDropdown = null;
    this.modalMode = 'command'; // 'command' or 'directory'
    this.selectedModel = 'none';
    this.selectedPaneType = 'terminal'; // 'terminal', 'browser', or 'expo'
    this.appSettings = {};
    this.paletteSelectedIndex = 0;
    this.welcomeElement = null;
    this.gridLayout = 'auto'; // 'auto', '1', '4', '9'
    this.sidebarVisible = true;
    this.activePaneId = null; // Track which pane is focused (replaces activeTerminalId)
    this.activeTerminalId = null; // Keep for backwards compatibility
    this.expoDashboard = null; // Expo dashboard instance
    this.zenMode = false; // Focus/Zen mode state
    this.workspacePresets = []; // Saved workspace presets
    this.pipes = new Map(); // Pipe connections: pipeId → { sourceId, targetId, filter, active, _buffer, _flushTimer }
    this.pipeMode = false;
    this.pipeCounter = 0;
    this.recentActions = JSON.parse(localStorage.getItem('gridterm-recent-actions') || '[]');

    this.gridContainer = document.getElementById('grid-container');
    this.addButton = document.getElementById('add-terminal');
    this.sidebar = document.getElementById('sidebar');

    // Launch modal elements
    this.launchModal = document.getElementById('launch-modal');
    this.launchDirSelect = document.getElementById('launch-directory');
    this.launchNameInput = document.getElementById('launch-name');
    this.claudeOptions = document.getElementById('claude-options');
    this.codexOptions = document.getElementById('codex-options');

    // Add item modal elements
    this.modal = document.getElementById('add-modal');
    this.modalTitle = document.getElementById('modal-title');
    this.itemNameInput = document.getElementById('item-name');
    this.itemValueInput = document.getElementById('item-value');
    this.itemValueLabel = document.getElementById('item-value-label');

    this.init();
  }

  async init() {
    try {
      // Load saved config
      const config = await window.config.load();
      this.commands = config.commands || [];
      this.directories = config.directories || [];
      // Populate sidebar
      this.renderSidebar();

      // Set up IPC listeners
      window.terminal.onData((id, data) => {
        const term = this.terminals.get(id);
        if (term) {
          term.xterm.write(data);
          this.detectPaneContext(id, data);
          this.markPaneActive(id);
          this.forwardPipeData(id, data);
        }
      });

      window.terminal.onExit((id) => {
        this.removeTerminal(id);
      });

      // Event listeners
      this.addButton.addEventListener('click', () => this.quickLaunch());
      this.addButton.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showLaunchModal();
      });

    // Launch modal events
    document.getElementById('cancel-launch').addEventListener('click', () => {
      this.launchModal.classList.add('hidden');
    });

    document.getElementById('do-launch').addEventListener('click', () => {
      this.doLaunch();
    });

    // Pane type selector buttons
    document.querySelectorAll('.pane-type-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectPaneType(btn.dataset.type));
    });

    // Expo project scan button
    document.getElementById('scan-expo-projects').addEventListener('click', () => {
      this.populateExpoProjects();
    });

    // Model selector buttons
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectModel(btn.dataset.model));
    });

    // Titlebar directory selector
    document.getElementById('titlebar-directory').addEventListener('change', (e) => {
      const dirIndex = e.target.value;
      if (dirIndex !== '') {
        const dir = this.directories[parseInt(dirIndex)];
        if (dir) {
          this.sendToActiveTerminal(`cd "${dir.path}"\n`, false);
        }
        // Reset to placeholder after selection
        e.target.value = '';
      }
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      this.toggleSidebar();
    });

    // Layout selector buttons
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setGridLayout(btn.dataset.layout);
      });
    });

    // Sidebar add buttons
    document.getElementById('sidebar-add-dir').addEventListener('click', () => {
      this.showModal('directory');
    });

    document.getElementById('sidebar-add-cmd').addEventListener('click', () => {
      this.showModal('command');
    });

    // Workspace presets
    document.getElementById('sidebar-save-preset').addEventListener('click', () => {
      this.saveWorkspacePreset();
    });

    // Expo Dashboard button
    document.getElementById('open-expo-dashboard').addEventListener('click', () => {
      this.showExpoDashboard();
    });

    // Dev Mode button - arrange windows side-by-side
    document.getElementById('dev-mode-btn').addEventListener('click', async () => {
      const btn = document.getElementById('dev-mode-btn');
      btn.disabled = true;
      btn.querySelector('span:last-child').textContent = 'Arranging...';
      try {
        const result = await window.windowManager.arrangeDevMode();
        if (result === 'Simulator not running') {
          alert('iOS Simulator is not running. Start an app with "Start iOS Sim" first.');
        }
      } catch (e) {
        console.error('Error arranging windows:', e);
      }
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = 'Dev Mode (Side-by-Side)';
    });

    // Listen for server events to update sidebar
    this.setupServerEventListeners();

    // Set up command palette, keyboard shortcuts, context menu, settings
    this.setupCommandPalette();
    this.setupKeyboardShortcuts();
    this.setupContextMenu();
    this.setupSettings();

    // Load app settings and workspace presets
    this.appSettings = config.appSettings || {};
    this.workspacePresets = config.workspacePresets || [];
    this.renderSidebarPresets();
    this.renderSidebarPipes();

    // Pipe mode sidebar button
    document.getElementById('sidebar-toggle-pipe-mode').addEventListener('click', () => {
      this.togglePipeMode();
    });
    if (this.appSettings.fontSize) {
      // Will apply when terminals are created
    }
    if (this.appSettings.gridGap) {
      document.getElementById('grid-container').style.gap = this.appSettings.gridGap + 'px';
      document.getElementById('grid-container').style.padding = this.appSettings.gridGap + 'px';
    }

    // Collapsible sidebar sections
    document.querySelectorAll('.sidebar-header[data-section]').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.sidebar-section');
        section.classList.toggle('collapsed');
      });
    });

    // Add item modal events
    document.getElementById('cancel-modal').addEventListener('click', () => {
      this.hideModal();
    });

    document.getElementById('save-modal').addEventListener('click', () => {
      this.saveModalItem();
    });

    // Browse folder button
    document.getElementById('browse-folder').addEventListener('click', async () => {
      const folderPath = await window.dialog.selectFolder();
      if (folderPath) {
        this.itemValueInput.value = folderPath;
        // Auto-fill name from folder name if empty
        if (!this.itemNameInput.value) {
          const folderName = folderPath.split('/').pop();
          this.itemNameInput.value = folderName;
        }
      }
    });

    // Drag and drop for folder path
    const valueWrapper = document.getElementById('item-value-wrapper');

    valueWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.modalMode === 'directory') {
        valueWrapper.classList.add('drag-over');
      }
    });

    valueWrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      valueWrapper.classList.remove('drag-over');
    });

    valueWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      valueWrapper.classList.remove('drag-over');

      if (this.modalMode === 'directory' && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const filePath = file.path;
        if (filePath) {
          this.itemValueInput.value = filePath;
          // Auto-fill name from folder name if empty
          if (!this.itemNameInput.value) {
            const folderName = filePath.split('/').pop();
            this.itemNameInput.value = folderName;
          }
        }
      }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (this.activeDropdown && !e.target.closest('.commands-wrapper')) {
        this.activeDropdown.classList.add('hidden');
        this.activeDropdown = null;
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fitAllTerminals();
    });

    // Show onboarding on first run, restore session, or show launch modal
    if (!localStorage.getItem('gridterm-onboarded')) {
      this.showOnboarding(); // will call showLaunchModal() on completion
    } else if (this.appSettings.autoRestore && config.session && config.session.panes && config.session.panes.length > 0) {
      await this.restoreSession(config.session);
    } else {
      this.showLaunchModal();
      this.showWelcomeState();
    }
    } catch (err) {
      console.error('Error in init():', err);
    }
  }

  async quickLaunch() {
    const model = (this.appSettings && this.appSettings.defaultModel) || 'none';
    let aiCommand = '';
    if (model === 'claude') {
      aiCommand = 'claude --dangerously-skip-permissions';
    } else if (model === 'codex') {
      aiCommand = 'codex --full-auto';
    }
    await this.createTerminal({ name: null, directory: null, aiCommand, startupCommands: [] });
  }

  showLaunchModal() {
    // Reset modal state
    this.selectedPaneType = 'terminal';
    document.querySelectorAll('.pane-type-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === 'terminal');
    });
    document.getElementById('terminal-options').classList.remove('hidden');
    document.getElementById('browser-options').classList.add('hidden');
    document.getElementById('expo-options').classList.add('hidden');
    document.getElementById('browser-url').value = '';
    document.getElementById('expo-url').value = '';

    // Apply default model from settings
    const defaultModel = (this.appSettings && this.appSettings.defaultModel) || 'none';
    this.selectedModel = defaultModel;
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.model === defaultModel);
    });
    this.claudeOptions.classList.toggle('hidden', defaultModel !== 'claude');
    this.codexOptions.classList.toggle('hidden', defaultModel !== 'codex');

    // Populate directory dropdown
    this.launchDirSelect.innerHTML = '<option value="">Home (~)</option>';
    this.directories.forEach((dir, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${dir.name} - ${dir.path}`;
      this.launchDirSelect.appendChild(option);
    });

    // Clear name input
    this.launchNameInput.value = '';

    // Reset checkboxes to defaults
    document.getElementById('skip-permissions').checked = true;
    document.getElementById('claude-verbose').checked = false;
    document.getElementById('codex-full-auto').checked = true;
    document.getElementById('startup-compact').checked = false;
    document.getElementById('startup-status').checked = false;

    this.launchModal.classList.remove('hidden');

    // Keyboard: Esc to close, Enter to launch (unless in input/select)
    if (this._launchModalKeyHandler) document.removeEventListener('keydown', this._launchModalKeyHandler);
    this._launchModalKeyHandler = (e) => {
      if (this.launchModal.classList.contains('hidden')) return;
      if (e.key === 'Escape') { this.launchModal.classList.add('hidden'); }
      if (e.key === 'Enter' && !e.target.matches('input, select, textarea')) { this.doLaunch(); }
    };
    document.addEventListener('keydown', this._launchModalKeyHandler);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    this.sidebar.classList.toggle('collapsed', !this.sidebarVisible);
    document.getElementById('sidebar-toggle').textContent = this.sidebarVisible ? '◂◂' : '▸▸';
    // Refit terminals after sidebar toggle
    setTimeout(() => {
      this.fitAllTerminals();
      if (this.pipeMode) this.renderPipeCurves();
    }, 250);
    this.saveSessionDebounced();
  }

  renderSidebar() {
    this.renderSidebarPanes();
    this.renderSidebarDirectories();
    this.renderSidebarCommands();
    this.updateTitlebarDirectories();
    this.updateEmptyHints();
  }

  renderSidebarPanes() {
    const container = document.getElementById('sidebar-panes');
    if (!container) return;
    container.innerHTML = '';

    if (this.allPanes.size === 0) {
      container.innerHTML = '<div class="sidebar-empty-hint">No open panes</div>';
      return;
    }

    let index = 1;
    for (const [id, info] of this.allPanes) {
      let name, icon, isMinimized = false;

      if (info.type === 'terminal') {
        const term = this.terminals.get(id);
        if (!term) continue;
        name = term.pane.querySelector('.terminal-name')?.value || `Terminal ${index}`;
        icon = term.launchConfig?.aiCommand?.includes('claude') ? '🤖' :
               term.launchConfig?.aiCommand?.includes('codex') ? '🧠' : '💻';
        isMinimized = term.pane.classList.contains('minimized');
      } else if (info.type === 'browser') {
        const bp = this.browserPanes.get(id);
        if (!bp) continue;
        name = bp.pane.querySelector('.pane-name')?.value || 'Browser';
        icon = '🌐';
      } else if (info.type === 'expo') {
        const ep = this.browserPanes.get(id);
        if (!ep) continue;
        name = ep.pane.querySelector('.pane-name')?.value || 'Expo';
        icon = '📱';
      }

      const isActive = this.activePaneId === id;
      const item = document.createElement('div');
      item.className = `sidebar-pane-item${isActive ? ' active' : ''}${isMinimized ? ' minimized' : ''}`;
      item.dataset.paneId = id;
      item.innerHTML = `
        <span class="pane-activity-dot" id="activity-${id}"></span>
        <span class="pane-type-icon">${icon}</span>
        <span class="pane-item-name">${name}</span>
        ${isMinimized ? '<span class="pane-minimized-badge">min</span>' : ''}
        ${index <= 9 ? `<span class="pane-shortcut">⌘${index}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        if (isMinimized) this.toggleMinimize(id);
        this.setActivePaneId(id);
      });
      container.appendChild(item);
      index++;
    }
  }

  updateEmptyHints() {
    const dirEmpty = document.getElementById('directories-empty');
    const cmdEmpty = document.getElementById('commands-empty');
    if (dirEmpty) dirEmpty.style.display = this.directories.length > 0 ? 'none' : '';
    if (cmdEmpty) cmdEmpty.style.display = this.commands.length > 0 ? 'none' : '';
  }

  updateTitlebarDirectories() {
    const select = document.getElementById('titlebar-directory');
    if (!select) return;
    select.innerHTML = '<option value="">📁 Directory</option>';
    this.directories.forEach((dir, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = dir.name;
      select.appendChild(option);
    });
  }

  renderSidebarDirectories() {
    const container = document.getElementById('sidebar-directories');
    container.innerHTML = '';
    this.updateEmptyHints();

    this.directories.forEach((dir, index) => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.innerHTML = `
        <span class="item-icon">📁</span>
        <span class="item-name">${dir.name}</span>
        <span class="item-delete" data-index="${index}">×</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('item-delete')) {
          this.deleteDirectory(parseInt(e.target.dataset.index));
          this.renderSidebarDirectories();
        } else {
          this.sendToActiveTerminal(`cd "${dir.path}"\n`, false);
        }
      });
      container.appendChild(item);
    });
  }

  renderSidebarCommands() {
    const container = document.getElementById('sidebar-commands');
    container.innerHTML = '';
    this.updateEmptyHints();

    this.commands.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.innerHTML = `
        <span class="item-icon">⌘</span>
        <span class="item-name">${cmd.name}</span>
        <span class="item-delete" data-index="${index}">×</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('item-delete')) {
          this.deleteCommand(parseInt(e.target.dataset.index));
          this.renderSidebarCommands();
        } else {
          this.sendToActiveTerminal(cmd.command, false);
        }
      });
      container.appendChild(item);
    });
  }

  sendToActiveTerminal(command, autoExec = false) {
    if (this.terminals.size === 0) {
      alert('Please open a terminal first');
      return;
    }

    // Use active terminal or fall back to first terminal
    let targetId = this.activeTerminalId;
    if (!targetId || !this.terminals.has(targetId)) {
      targetId = this.terminals.keys().next().value;
    }

    const term = this.terminals.get(targetId);

    if (term) {
      const cmd = autoExec ? command + '\n' : command;
      window.terminal.write(targetId, cmd);
      this.focusTerminalSafely(term.xterm);
    }
  }

  // Set up drag-and-drop for images/screenshots on terminal
  setupImageDragDrop(pane, termBody, termId) {
    // Create drop overlay
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'image-drop-overlay hidden';
    dropOverlay.innerHTML = `
      <div class="drop-content">
        <div class="drop-icon">📸</div>
        <div class="drop-text">Drop image here</div>
        <div class="drop-hint">Path will be inserted into terminal</div>
      </div>
    `;
    pane.appendChild(dropOverlay);

    let dragCounter = 0;

    // Prevent default drag behaviors on the whole pane
    pane.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;

      // Check if dragging files (images)
      if (e.dataTransfer.types.includes('Files')) {
        dropOverlay.classList.remove('hidden');
      }
    });

    pane.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    pane.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;

      if (dragCounter === 0) {
        dropOverlay.classList.add('hidden');
      }
    });

    pane.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropOverlay.classList.add('hidden');

      const files = Array.from(e.dataTransfer.files);

      for (const file of files) {
        // Check if it's an image
        if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(file.name)) {
          const filePath = file.path;

          if (filePath) {
            // File has a path (dragged from Finder)
            const savedPath = await window.image.saveDroppedFile(filePath);
            if (savedPath) {
              this.insertImagePath(termId, savedPath);
            }
          } else {
            // File doesn't have a path (might be from browser or other source)
            // Read as data URL and save
            const reader = new FileReader();
            reader.onload = async (event) => {
              const savedPath = await window.image.saveImageData(event.target.result, 'png');
              if (savedPath) {
                this.insertImagePath(termId, savedPath);
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }
    });

    // Also handle paste for clipboard images
    termBody.addEventListener('paste', async (e) => {
      // Check for clipboard image
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();

          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = async (event) => {
              const savedPath = await window.image.saveImageData(event.target.result, 'png');
              if (savedPath) {
                this.insertImagePath(termId, savedPath);
              }
            };
            reader.readAsDataURL(blob);
          }
          return;
        }
      }
    });
  }

  // Insert image path into terminal with helpful prompt
  insertImagePath(termId, imagePath) {
    const term = this.terminals.get(termId);
    if (!term) return;

    // Insert a helpful command that references the image
    const command = `[Image: ${imagePath}] `;
    window.terminal.write(termId, command);
    this.focusTerminalSafely(term.xterm);
  }

  setActiveTerminal(id) {
    // Use the new unified method
    this.setActivePaneId(id);
  }

  selectPaneType(type) {
    this.selectedPaneType = type;

    // Update button states
    document.querySelectorAll('.pane-type-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === type);
    });

    // Show/hide relevant options
    document.getElementById('terminal-options').classList.toggle('hidden', type !== 'terminal');
    document.getElementById('browser-options').classList.toggle('hidden', type !== 'browser');
    document.getElementById('expo-options').classList.toggle('hidden', type !== 'expo');

    // Populate Expo projects when expo type is selected
    if (type === 'expo') {
      this.populateExpoProjects();
    }
  }

  async populateExpoProjects() {
    const select = document.getElementById('expo-project-select');
    const scanBtn = document.getElementById('scan-expo-projects');

    select.innerHTML = '<option value="">Scanning for projects...</option>';
    if (scanBtn) scanBtn.disabled = true;

    try {
      // Scan filesystem for Expo projects
      const foundProjects = await window.expo.scanProjects();

      // Detect running servers
      const runningServers = await window.expo.detect();

      // Build dropdown options
      select.innerHTML = '<option value="">-- Select a project --</option>';

      // Add running servers first (they're ready to use)
      if (runningServers.length > 0) {
        const runningGroup = document.createElement('optgroup');
        runningGroup.label = 'Running Servers';
        runningServers.forEach(server => {
          const opt = document.createElement('option');
          opt.value = server.webUrl || `http://localhost:${server.port}`;
          opt.textContent = `Port ${server.port} (Running)`;
          opt.dataset.running = 'true';
          runningGroup.appendChild(opt);
        });
        select.appendChild(runningGroup);
      }

      // Add found projects
      if (foundProjects.length > 0) {
        const projectsGroup = document.createElement('optgroup');
        projectsGroup.label = 'Found Projects';
        foundProjects.forEach(project => {
          const opt = document.createElement('option');
          opt.value = `http://localhost:8081`;
          opt.textContent = project.name;
          opt.dataset.path = project.path;
          opt.dataset.name = project.name;
          projectsGroup.appendChild(opt);
        });
        select.appendChild(projectsGroup);
      }

      if (runningServers.length === 0 && foundProjects.length === 0) {
        select.innerHTML = '<option value="">No projects found - enter URL below</option>';
      }
    } catch (e) {
      console.error('Error populating Expo projects:', e);
      select.innerHTML = '<option value="">Error scanning - enter URL below</option>';
    }

    if (scanBtn) scanBtn.disabled = false;
  }

  selectModel(model) {
    this.selectedModel = model;

    // Update button states
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.model === model);
    });

    // Show/hide relevant options
    this.claudeOptions.classList.toggle('hidden', model !== 'claude');
    this.codexOptions.classList.toggle('hidden', model !== 'codex');
  }

  async doLaunch() {
    const name = this.launchNameInput.value.trim();

    this.launchModal.classList.add('hidden');

    // Handle different pane types
    if (this.selectedPaneType === 'browser') {
      const url = document.getElementById('browser-url').value.trim() || 'https://google.com';
      await this.createBrowserPane({
        name: name || 'Browser',
        url: url
      });
    } else if (this.selectedPaneType === 'expo') {
      // Check dropdown first, then URL input, then default
      const projectSelect = document.getElementById('expo-project-select');
      const selectedOption = projectSelect.options[projectSelect.selectedIndex];
      const selectedUrl = projectSelect.value;
      const manualUrl = document.getElementById('expo-url').value.trim();
      const url = selectedUrl || manualUrl || 'http://localhost:8081';

      // Use project name if available
      const projectName = selectedOption?.dataset?.name;
      const showQR = document.getElementById('expo-show-qr').checked;

      await this.createExpoPanePreview({
        name: name || projectName || 'Expo Preview',
        url: url,
        showQR: showQR
      });
    } else {
      // Terminal pane
      const dirIndex = this.launchDirSelect.value;
      const directory = dirIndex !== '' ? this.directories[parseInt(dirIndex)] : null;

      // Build the AI command and startup commands
      let aiCommand = '';
      let startupCommands = [];

      if (this.selectedModel === 'claude') {
        aiCommand = 'claude';
        if (document.getElementById('skip-permissions').checked) {
          aiCommand += ' --dangerously-skip-permissions';
        }
        if (document.getElementById('claude-verbose').checked) {
          aiCommand += ' --verbose';
        }

        // Collect startup commands
        if (document.getElementById('startup-compact').checked) {
          startupCommands.push('/compact');
        }
        if (document.getElementById('startup-status').checked) {
          startupCommands.push('/status');
        }
      } else if (this.selectedModel === 'codex') {
        aiCommand = 'codex';
        if (document.getElementById('codex-full-auto').checked) {
          aiCommand += ' --full-auto';
        }
      }

      // Create terminal with launch config
      await this.createTerminal({
        name: name || (directory ? directory.name : null),
        directory: directory ? directory.path : null,
        aiCommand: aiCommand,
        startupCommands: startupCommands
      });
    }
  }

  async createTerminal({ name, directory, aiCommand, startupCommands = [], autoMinimize = false }) {
    const id = `term-${++this.terminalCounter}`;
    const displayName = name || `Terminal ${this.terminalCounter}`;

    // Create pane HTML
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.id = id;
    pane.innerHTML = `
      <div class="terminal-header">
        <span class="header-activity-dot"></span>
        <input type="text" class="terminal-name" placeholder="Terminal ${this.terminalCounter}" value="${displayName}">
        <div class="commands-wrapper">
          <button class="commands-btn">Shortcuts ▾</button>
          <div class="commands-dropdown hidden"></div>
        </div>
        <button class="copy-btn" title="Copy">📋</button>
        <button class="minimize-btn" title="Minimize">─</button>
        <button class="expand-btn" title="Expand">⤢</button>
        <button class="close-btn" title="Close">×</button>
      </div>
      <div class="terminal-body"></div>
    `;

    this.gridContainer.appendChild(pane);

    // Set up terminal
    const termBody = pane.querySelector('.terminal-body');
    const xterm = new Terminal({
      fontSize: this.appSettings.fontSize || 14,
      fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace",
      theme: {
        background: '#0d0d0d',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#f85149',
        green: '#56d364',
        yellow: '#e3b341',
        blue: '#6cb6ff',
        magenta: '#db61a2',
        cyan: '#76e3ea',
        white: '#ffffff',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#7ee787',
        brightYellow: '#f7c843',
        brightBlue: '#a5d6ff',
        brightMagenta: '#ff9bce',
        brightCyan: '#b3f0ff',
        brightWhite: '#ffffff'
      },
      cursorBlink: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(termBody);

    // Store terminal info (including launch config for session restore)
    this.terminals.set(id, { xterm, fitAddon, pane, launchConfig: { name, directory, aiCommand, startupCommands } });
    this.allPanes.set(id, { type: 'terminal', pane: { pane } });

    // Lock user-provided names so auto-naming doesn't overwrite them
    if (name) {
      this.markUserRenamed(id);
    }

    // Create PTY in main process
    await window.terminal.create(id);

    // Handle input
    xterm.onData((data) => {
      window.terminal.write(id, data);
    });

    // Handle resize
    xterm.onResize(({ cols, rows }) => {
      window.terminal.resize(id, cols, rows);
    });

    // Set up header controls
    const commandsBtn = pane.querySelector('.commands-btn');
    const dropdown = pane.querySelector('.commands-dropdown');
    const copyBtn = pane.querySelector('.copy-btn');
    const minimizeBtn = pane.querySelector('.minimize-btn');
    const expandBtn = pane.querySelector('.expand-btn');
    const closeBtn = pane.querySelector('.close-btn');

    commandsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown(dropdown, id);
    });

    copyBtn.addEventListener('click', () => {
      this.copyFromTerminal(id);
    });

    minimizeBtn.addEventListener('click', () => {
      this.toggleMinimize(id);
    });

    expandBtn.addEventListener('click', () => {
      this.toggleExpand(id);
    });

    closeBtn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        this.closeTerminal(id);
      } else {
        this.confirmClosePane(id, 'terminal');
      }
    });

    // Cmd+C copies selection instead of sending SIGINT when text is selected
    xterm.attachCustomKeyEventHandler((e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && e.type === 'keydown') {
        if (xterm.hasSelection()) {
          navigator.clipboard.writeText(xterm.getSelection());
          xterm.clearSelection();
          return false; // prevent SIGINT
        }
      }
      return true;
    });

    // Click to focus terminal
    pane.addEventListener('click', () => {
      this.setActiveTerminal(id);
    });

    // Double-click header to toggle fullscreen
    pane.querySelector('.terminal-header').addEventListener('dblclick', () => {
      this.toggleExpand(id);
    });

    // Stop auto-naming when user manually edits the name
    const nameInput = pane.querySelector('.terminal-name');
    nameInput.addEventListener('input', () => {
      this.markUserRenamed(id);
    });

    // Drag and drop for images/screenshots
    this.setupImageDragDrop(pane, termBody, id);

    // Set as active terminal
    this.setActiveTerminal(id);

    // Update grid, sidebar pane list, and fit terminals
    this.updateGridLayout();
    this.renderSidebarPanes();

    // Fit after a short delay to ensure DOM is ready
    setTimeout(async () => {
      this.fitAllTerminals();
      this.focusTerminalSafely(xterm);

      // Execute launch commands after terminal is ready
      if (directory) {
        // Small delay to let shell initialize
        await this.delay(100);
        window.terminal.write(id, `cd "${directory}"\n`);
      }

      if (aiCommand) {
        await this.delay(300);
        window.terminal.write(id, `${aiCommand}\n`);

        // Execute startup commands after Claude initializes
        if (startupCommands && startupCommands.length > 0) {
          // Wait for Claude to fully start
          await this.delay(3000);
          for (const cmd of startupCommands) {
            await this.delay(500);
            window.terminal.write(id, `${cmd}\n`);
          }
        }
      } else if (startupCommands && startupCommands.length > 0) {
        // Execute startup commands without AI (e.g., expo start)
        await this.delay(300);
        for (const cmd of startupCommands) {
          await this.delay(200);
          window.terminal.write(id, `${cmd}\n`);
        }

        // Auto-minimize after commands start (e.g., for Expo servers)
        if (autoMinimize) {
          await this.delay(500);
          this.toggleMinimize(id);
        }
      }
    }, 50);

    this.saveSessionDebounced();
    return id;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  focusTerminalSafely(xterm) {
    const saved = this.gridContainer.scrollTop;
    xterm.focus();
    requestAnimationFrame(() => {
      this.gridContainer.scrollTop = saved;
    });
  }

  async createBrowserPane({ name, url }) {
    const id = `browser-${++this.paneCounter}`;
    const displayName = name || 'Browser';

    const browserPane = new BrowserPane(id, displayName, this.gridContainer, url);
    browserPane.createPane();

    // Store in maps
    this.browserPanes.set(id, browserPane);
    this.allPanes.set(id, { type: 'browser', pane: browserPane });

    // Set up header controls
    browserPane.expandBtn.addEventListener('click', () => {
      browserPane.toggleExpand();
    });

    browserPane.closeBtn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        this.closeBrowserPane(id);
      } else {
        this.confirmClosePane(id, 'browser');
      }
    });

    // Wire up console capture for pipe forwarding
    const webview = browserPane.pane.querySelector('webview');
    if (webview) {
      webview.addEventListener('console-message', (e) => {
        this.forwardPipeData(id, e.message + '\n');
        this.markPaneActive(id);
      });
    }

    // Click/pointer to focus (capture phase so webview clicks are caught)
    browserPane.pane.addEventListener('pointerdown', () => {
      this.setActivePaneId(id);
    }, true);

    // Set as active pane
    this.setActivePaneId(id);

    // Update grid layout
    this.updateGridLayout();
    this.renderSidebarPanes();
    this.saveSessionDebounced();

    return browserPane;
  }

  async createExpoPanePreview({ name, url, showQR }) {
    const id = `expo-${++this.paneCounter}`;
    const displayName = name || 'Expo Preview';

    // Get local IP for QR code
    let localIp = null;
    try {
      localIp = await window.expo.getLocalIp();
    } catch (e) {
      console.error('Error getting local IP:', e);
    }

    // Create Expo preview pane with QR code support
    const expoPane = new ExpoPanePreview(id, displayName, this.gridContainer, url, {
      showQR: showQR,
      showDeviceFrame: false,
      localIp: localIp
    });
    expoPane.createPane();

    // Store in maps
    this.browserPanes.set(id, expoPane);
    this.allPanes.set(id, { type: 'expo', pane: expoPane });

    // Set up header controls
    expoPane.expandBtn.addEventListener('click', () => {
      expoPane.toggleExpand();
    });

    expoPane.closeBtn.addEventListener('click', (e) => {
      if (e.shiftKey) {
        this.closeBrowserPane(id);
      } else {
        this.confirmClosePane(id, 'browser');
      }
    });

    // Wire up console capture for pipe forwarding
    const expoWebview = expoPane.pane.querySelector('webview');
    if (expoWebview) {
      expoWebview.addEventListener('console-message', (e) => {
        this.forwardPipeData(id, e.message + '\n');
        this.markPaneActive(id);
      });
    }

    // Click/pointer to focus (capture phase so webview clicks are caught)
    expoPane.pane.addEventListener('pointerdown', () => {
      this.setActivePaneId(id);
    }, true);

    // Set as active pane
    this.setActivePaneId(id);

    // Update grid layout
    this.updateGridLayout();
    this.renderSidebarPanes();
    this.saveSessionDebounced();

    return expoPane;
  }

  closeBrowserPane(id) {
    const browserPane = this.browserPanes.get(id);
    if (browserPane) {
      browserPane.destroy();
      this.browserPanes.delete(id);
      this.allPanes.delete(id);
      this.removePipesForPane(id);
      this.updateGridLayout();
      this.renderSidebarPanes();
      this.saveSessionDebounced();
    }

    // If no panes left, show launch modal
    if (this.allPanes.size === 0) {
      this.showLaunchModal();
    }
  }

  setActivePaneId(id) {
    // Remove active class from all panes
    this.terminals.forEach((term) => {
      term.pane.classList.remove('active-terminal');
      term.pane.classList.remove('active-pane');
    });
    this.browserPanes.forEach((bp) => {
      bp.pane.classList.remove('active-pane');
    });

    this.activePaneId = id;

    // Check if it's a terminal
    const term = this.terminals.get(id);
    if (term) {
      term.pane.classList.add('active-terminal');
      this.activeTerminalId = id;
      this.focusTerminalSafely(term.xterm);
      return;
    }

    // Check if it's a browser/expo pane
    const bp = this.browserPanes.get(id);
    if (bp) {
      bp.pane.classList.add('active-pane');
      if (bp.focus) bp.focus();
    }

    // Update sidebar pane list to reflect active state
    this.renderSidebarPanes();
  }

  toggleDropdown(dropdown, termId) {
    // Close any open dropdown
    if (this.activeDropdown && this.activeDropdown !== dropdown) {
      this.activeDropdown.classList.add('hidden');
    }

    if (dropdown.classList.contains('hidden')) {
      this.renderDropdown(dropdown, termId);
      dropdown.classList.remove('hidden');
      this.activeDropdown = dropdown;
    } else {
      dropdown.classList.add('hidden');
      this.activeDropdown = null;
    }
  }

  toggleExpand(id) {
    const term = this.terminals.get(id);
    if (!term) return;

    const pane = term.pane;
    const expandBtn = pane.querySelector('.expand-btn');
    const isMaximized = pane.classList.toggle('maximized');

    // Update button icon
    expandBtn.textContent = isMaximized ? '⤡' : '⤢';
    expandBtn.title = isMaximized ? 'Collapse' : 'Expand';

    // Refit terminal after a short delay
    setTimeout(() => {
      term.fitAddon.fit();
      this.focusTerminalSafely(term.xterm);
    }, 50);
  }

  toggleMinimize(id) {
    const term = this.terminals.get(id);
    if (!term) return;

    const pane = term.pane;
    const isMinimized = pane.classList.contains('minimized');

    if (isMinimized) {
      // Restore: show in grid
      pane.classList.remove('minimized');
      pane.style.display = '';
      this.updateGridLayout();
      setTimeout(() => {
        term.fitAddon.fit();
        this.focusTerminalSafely(term.xterm);
      }, 50);
    } else {
      // Minimize: hide completely
      pane.classList.add('minimized');
      pane.style.display = 'none';
      this.updateGridLayout();
    }

    // Update sidebar to show/hide the hidden terminal
    this.updateRunningServersList();
  }

  renderDropdown(dropdown, termId) {
    dropdown.innerHTML = '';

    // Directories section
    if (this.directories.length > 0) {
      const dirHeader = document.createElement('div');
      dirHeader.className = 'dropdown-section-header';
      dirHeader.textContent = 'Directories';
      dropdown.appendChild(dirHeader);

      this.directories.forEach((dir, index) => {
        const item = document.createElement('div');
        item.className = 'command-item directory-item';
        item.innerHTML = `
          <span class="item-icon">📁</span>
          <span class="command-name">${dir.name}</span>
          <span class="command-text">${dir.path}</span>
          <span class="delete-cmd">×</span>
        `;

        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('delete-cmd')) {
            e.stopPropagation();
            this.deleteDirectory(index);
            this.renderDropdown(dropdown, termId);
          } else {
            this.pasteCommand(termId, `cd "${dir.path}"\n`);
            dropdown.classList.add('hidden');
            this.activeDropdown = null;
          }
        });

        dropdown.appendChild(item);
      });
    }

    // Commands section
    if (this.commands.length > 0) {
      const cmdHeader = document.createElement('div');
      cmdHeader.className = 'dropdown-section-header';
      cmdHeader.textContent = 'Commands';
      dropdown.appendChild(cmdHeader);

      this.commands.forEach((cmd, index) => {
        const item = document.createElement('div');
        item.className = 'command-item';
        item.innerHTML = `
          <span class="item-icon">⌘</span>
          <span class="command-name">${cmd.name}</span>
          <span class="command-text">${cmd.command}</span>
          <span class="delete-cmd">×</span>
        `;

        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('delete-cmd')) {
            e.stopPropagation();
            this.deleteCommand(index);
            this.renderDropdown(dropdown, termId);
          } else {
            this.pasteCommand(termId, cmd.command);
            dropdown.classList.add('hidden');
            this.activeDropdown = null;
          }
        });

        dropdown.appendChild(item);
      });
    }

    // Add options section
    const addSection = document.createElement('div');
    addSection.className = 'dropdown-add-section';

    const addDir = document.createElement('div');
    addDir.className = 'command-item add-new';
    addDir.innerHTML = '<span class="item-icon">📁</span> Add Directory';
    addDir.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      this.activeDropdown = null;
      this.showModal('directory');
    });
    addSection.appendChild(addDir);

    const addCmd = document.createElement('div');
    addCmd.className = 'command-item add-new';
    addCmd.innerHTML = '<span class="item-icon">⌘</span> Add Command';
    addCmd.addEventListener('click', () => {
      dropdown.classList.add('hidden');
      this.activeDropdown = null;
      this.showModal('command');
    });
    addSection.appendChild(addCmd);

    dropdown.appendChild(addSection);
  }

  pasteCommand(termId, command) {
    window.terminal.write(termId, command);
    const term = this.terminals.get(termId);
    if (term) {
      this.focusTerminalSafely(term.xterm);
    }
  }

  showModal(mode) {
    this.modalMode = mode;
    this.itemNameInput.value = '';
    this.itemValueInput.value = '';

    const browseBtn = document.getElementById('browse-folder');
    const dropHint = document.getElementById('drop-hint');
    const valueWrapper = document.getElementById('item-value-wrapper');

    if (mode === 'directory') {
      this.modalTitle.textContent = 'Add Directory';
      this.itemNameInput.placeholder = 'Name (e.g., "My Project")';
      this.itemValueLabel.textContent = 'Path';
      this.itemValueInput.placeholder = '/path/to/directory or drag folder here';
      browseBtn.classList.remove('hidden');
      dropHint.classList.remove('hidden');
    } else {
      this.modalTitle.textContent = 'Add Command';
      this.itemNameInput.placeholder = 'Name (e.g., "Start Dev Server")';
      this.itemValueLabel.textContent = 'Command';
      this.itemValueInput.placeholder = 'npm run dev';
      browseBtn.classList.add('hidden');
      dropHint.classList.add('hidden');
    }

    this.modal.classList.remove('hidden');
    this.itemNameInput.focus();

    // Keyboard: Esc to close, Enter to advance/save
    if (this._addModalKeyHandler) document.removeEventListener('keydown', this._addModalKeyHandler);
    this._addModalKeyHandler = (e) => {
      if (this.modal.classList.contains('hidden')) return;
      if (e.key === 'Escape') { this.hideModal(); }
      if (e.key === 'Enter') {
        if (e.target === this.itemNameInput) { this.itemValueInput.focus(); e.preventDefault(); }
        else if (e.target === this.itemValueInput) { this.saveModalItem(); e.preventDefault(); }
      }
    };
    document.addEventListener('keydown', this._addModalKeyHandler);
  }

  hideModal() {
    this.modal.classList.add('hidden');
  }

  async saveModalItem() {
    const name = this.itemNameInput.value.trim();
    const value = this.itemValueInput.value.trim();

    if (name && value) {
      if (this.modalMode === 'directory') {
        this.directories.push({ name, path: value });
        this.renderSidebarDirectories();
        this.updateTitlebarDirectories();
      } else {
        this.commands.push({ name, command: value });
        this.renderSidebarCommands();
      }
      await this.saveConfig();
      this.hideModal();
      this.showToast(`${name} added`, { type: 'success' });
    }
  }

  async saveConfig() {
    await window.config.save({
      commands: this.commands,
      directories: this.directories,
      appSettings: this.appSettings,
      workspacePresets: this.workspacePresets,
      session: this.getSessionData()
    });
  }

  getSessionData() {
    const panes = [];
    for (const [id, info] of this.allPanes) {
      if (info.type === 'terminal') {
        const term = this.terminals.get(id);
        if (!term) continue;
        const name = term.pane.querySelector('.terminal-name')?.value || null;
        const lc = term.launchConfig || {};
        panes.push({ type: 'terminal', name, directory: lc.directory, aiCommand: lc.aiCommand });
      } else if (info.type === 'browser') {
        const bp = this.browserPanes.get(id);
        if (!bp) continue;
        const name = bp.pane.querySelector('.pane-name')?.value || 'Browser';
        panes.push({ type: 'browser', name, url: bp.url });
      } else if (info.type === 'expo') {
        const ep = this.browserPanes.get(id);
        if (!ep) continue;
        const name = ep.pane.querySelector('.pane-name')?.value || 'Expo';
        panes.push({ type: 'expo', name, url: ep.url, showQR: ep.showQR });
      }
    }
    // Save pipes by pane index (IDs change on restore)
    const paneIds = Array.from(this.allPanes.keys());
    const pipesData = [];
    for (const [, pipe] of this.pipes) {
      const sourceIdx = paneIds.indexOf(pipe.sourceId);
      const targetIdx = paneIds.indexOf(pipe.targetId);
      if (sourceIdx >= 0 && targetIdx >= 0) {
        pipesData.push({ sourceIdx, targetIdx, filter: pipe.filter });
      }
    }

    return {
      panes,
      pipes: pipesData,
      sidebarVisible: this.sidebarVisible,
      gridLayout: this.gridLayout,
      activePaneIndex: Array.from(this.allPanes.keys()).indexOf(this.activePaneId)
    };
  }

  saveSessionDebounced() {
    clearTimeout(this._sessionSaveTimer);
    this._sessionSaveTimer = setTimeout(() => this.saveConfig(), 500);
  }

  async restoreSession(session) {
    // Restore sidebar state
    if (session.sidebarVisible === false && this.sidebarVisible) {
      this.toggleSidebar();
    }

    // Restore grid layout
    if (session.gridLayout) {
      this.setGridLayout(session.gridLayout);
    }

    // Restore panes
    for (const p of session.panes) {
      if (p.type === 'terminal') {
        await this.createTerminal({ name: p.name, directory: p.directory, aiCommand: p.aiCommand, startupCommands: [] });
      } else if (p.type === 'browser') {
        await this.createBrowserPane({ name: p.name, url: p.url });
      } else if (p.type === 'expo') {
        await this.createExpoPanePreview({ name: p.name, url: p.url, showQR: p.showQR });
      }
    }

    // Restore active pane
    if (session.activePaneIndex >= 0) {
      const ids = Array.from(this.allPanes.keys());
      if (ids[session.activePaneIndex]) {
        this.setActivePaneId(ids[session.activePaneIndex]);
      }
    }

    // Restore pipes
    if (session.pipes && session.pipes.length > 0) {
      const newPaneIds = Array.from(this.allPanes.keys());
      for (const p of session.pipes) {
        const sourceId = newPaneIds[p.sourceIdx];
        const targetId = newPaneIds[p.targetIdx];
        if (sourceId && targetId) {
          this.createPipe(sourceId, targetId, p.filter);
        }
      }
    }

    if (session.panes.length > 0) {
      this.showToast(`Session restored (${session.panes.length} pane${session.panes.length > 1 ? 's' : ''})`, { type: 'info' });
    }
  }

  async deleteCommand(index) {
    this.commands.splice(index, 1);
    await this.saveConfig();
  }

  async deleteDirectory(index) {
    this.directories.splice(index, 1);
    await this.saveConfig();
    this.updateTitlebarDirectories();
  }

  async closeTerminal(id) {
    await window.terminal.kill(id);
    this.removeTerminal(id);
  }

  removeTerminal(id) {
    const term = this.terminals.get(id);
    if (term) {
      term.xterm.dispose();
      term.pane.remove();
      this.terminals.delete(id);
      this.allPanes.delete(id);
      this.removePipesForPane(id);
      this.updateGridLayout();
      this.fitAllTerminals();
      this.renderSidebarPanes();
      this.saveSessionDebounced();
    }

    // If no panes left, show launch modal
    if (this.allPanes.size === 0) {
      this.showLaunchModal();
    }
  }

  copyFromTerminal(id) {
    const term = this.terminals.get(id);
    if (!term) return;
    const xterm = term.xterm;

    let text;
    if (xterm.hasSelection()) {
      text = xterm.getSelection();
    } else {
      // Copy visible scrollback
      const buffer = xterm.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      text = lines.join('\n').trimEnd();
    }

    if (text) {
      navigator.clipboard.writeText(text);
      this.showToast('Copied to clipboard', 'success');
    }
  }

  confirmClosePane(paneId, type) {
    // Remove any existing close confirmation popovers
    document.querySelectorAll('.close-confirm').forEach(el => el.remove());

    const paneEl = type === 'terminal'
      ? this.terminals.get(paneId)?.pane
      : this.browserPanes.get(paneId)?.pane?.pane || this.browserPanes.get(paneId)?.pane;
    if (!paneEl) return;

    const header = paneEl.querySelector('.terminal-header') || paneEl.querySelector('.browser-header');
    if (!header) return;

    // Get pane name
    const nameInput = header.querySelector('.terminal-name') || header.querySelector('.browser-name');
    const paneName = nameInput?.value || (type === 'terminal' ? 'Terminal' : 'Browser');

    const popover = document.createElement('div');
    popover.className = 'close-confirm';
    popover.innerHTML = `
      <div class="close-confirm-text">Close <strong>${paneName}</strong>?</div>
      <div class="close-confirm-buttons">
        <button class="close-confirm-cancel">Cancel</button>
        <button class="close-confirm-ok">Close</button>
      </div>
    `;
    header.style.position = 'relative';
    header.appendChild(popover);

    const cancel = popover.querySelector('.close-confirm-cancel');
    const ok = popover.querySelector('.close-confirm-ok');

    const dismiss = () => popover.remove();

    cancel.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    ok.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
      if (type === 'terminal') this.closeTerminal(paneId);
      else this.closeBrowserPane(paneId);
    });

    // Dismiss on outside click
    setTimeout(() => {
      const outsideClick = (e) => {
        if (!popover.contains(e.target)) {
          dismiss();
          document.removeEventListener('mousedown', outsideClick);
        }
      };
      document.addEventListener('mousedown', outsideClick);
    }, 0);

    // Dismiss on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        dismiss();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  updateGridLayout() {
    // Count only VISIBLE panes (not minimized/hidden ones)
    let count = 0;
    for (const [id, info] of this.allPanes) {
      if (info.type === 'terminal') {
        const term = this.terminals.get(id);
        if (term && !term.pane.classList.contains('minimized')) {
          count++;
        }
      } else {
        // Browser/Expo panes are always visible
        count++;
      }
    }

    // Apply layout class
    const layoutClass = `layout-${this.gridLayout}`;
    const countClass = 'count-' + Math.min(count, 9);
    this.gridContainer.className = `${layoutClass} ${countClass}`;

    // Show welcome state when no panes exist
    if (count === 0 && this.allPanes.size === 0) {
      this.showWelcomeState();
    } else {
      this.hideWelcomeState();
    }

    // Update pane number badges
    this.updatePaneNumbers();
  }

  setGridLayout(layout) {
    this.gridLayout = layout;

    // Update button states
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.layout === layout);
    });

    this.updateGridLayout();

    // Refit terminals after layout change
    setTimeout(() => this.fitAllTerminals(), 100);
    this.saveSessionDebounced();
  }

  toggleZenMode() {
    this.zenMode = !this.zenMode;
    const body = document.body;

    if (this.zenMode) {
      // Save pre-zen state
      this._preZenSidebar = this.sidebarVisible;
      this._preZenLayout = this.gridLayout;

      // Hide sidebar, titlebar controls, switch to 1x1
      body.classList.add('zen-mode');
      if (this.sidebarVisible) this.toggleSidebar();
      this.setGridLayout('1');

      // Scroll active pane into view
      if (this.activePaneId) {
        const pane = this.terminals.get(this.activePaneId)?.pane ||
                     this.browserPanes.get(this.activePaneId)?.pane;
        if (pane) pane.scrollIntoView({ behavior: 'smooth' });
      }

      this.showToast('Zen mode — ⌘⇧↵ to exit', { type: 'info', duration: 2000 });
    } else {
      // Restore pre-zen state
      body.classList.remove('zen-mode');
      if (this._preZenSidebar && !this.sidebarVisible) this.toggleSidebar();
      if (this._preZenLayout) this.setGridLayout(this._preZenLayout);
    }

    setTimeout(() => this.fitAllTerminals(), 100);
  }

  fitAllTerminals() {
    this.terminals.forEach((term) => {
      try {
        term.fitAddon.fit();
      } catch (e) {
        // Ignore fit errors during transitions
      }
    });
  }

  showExpoDashboard() {
    const dashboardModal = document.getElementById('expo-dashboard-modal');
    const modalContent = dashboardModal.querySelector('.modal-content');

    if (!this.expoDashboard) {
      this.expoDashboard = new ExpoDashboard(modalContent, this);
    }

    this.expoDashboard.render();
    dashboardModal.classList.remove('hidden');

    // Close on click outside
    const closeHandler = (e) => {
      if (e.target === dashboardModal) {
        dashboardModal.classList.add('hidden');
        dashboardModal.removeEventListener('click', closeHandler);
      }
    };
    dashboardModal.addEventListener('click', closeHandler);
  }

  setupServerEventListeners() {
    // Listen for server found/lost events to update sidebar
    window.servers.onFound((info) => {
      console.log('Server found:', info);
      this.updateRunningServersList();
    });

    window.servers.onLost((info) => {
      console.log('Server lost:', info);
      this.updateRunningServersList();
    });

    // Initial update after a delay
    setTimeout(() => {
      this.updateRunningServersList();
    }, 3000);
  }

  async updateRunningServersList() {
    try {
      const container = document.getElementById('running-expo-servers');
      if (!container) return;

      const items = [];

      // Find minimized Expo terminals (hidden but running)
      for (const [id, term] of this.terminals) {
        if (term.pane.classList.contains('minimized')) {
          const name = term.pane.querySelector('.terminal-name')?.value || 'Expo';
          items.push({
            type: 'hidden-terminal',
            id,
            name,
            port: name.match(/:(\d+)/)?.[1] || ''
          });
        }
      }

      // Also check for detected servers
      const servers = await window.servers.getActive();
      for (const server of servers.filter(s => s.type === 'expo')) {
        // Don't duplicate if we already have a hidden terminal for this port
        if (!items.some(i => i.port === String(server.port))) {
          items.push({
            type: 'server',
            name: server.name || 'Expo',
            port: server.port,
            url: server.url
          });
        }
      }

      if (items.length === 0) {
        container.innerHTML = '<div class="sidebar-empty">No running Expo servers</div>';
        return;
      }

      container.innerHTML = '';
      for (const item of items) {
        const div = document.createElement('div');
        div.className = 'running-server-item';

        if (item.type === 'hidden-terminal') {
          div.innerHTML = `
            <span class="server-status running"></span>
            <span class="server-name">${item.name}</span>
            <button class="server-restore-btn" title="Show">↗</button>
            <button class="server-stop-btn" title="Stop">×</button>
          `;
          div.querySelector('.server-restore-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMinimize(item.id);
            this.updateRunningServersList();
          });
          div.querySelector('.server-stop-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTerminal(item.id);
            this.updateRunningServersList();
          });
        } else {
          div.innerHTML = `
            <span class="server-status"></span>
            <span class="server-name">${item.name}</span>
            <span class="server-port">:${item.port}</span>
          `;
          div.addEventListener('click', () => {
            this.createExpoPanePreview({
              name: item.name,
              url: item.url,
              showQR: false
            });
          });
        }

        container.appendChild(div);
      }
    } catch (e) {
      console.error('Error updating running servers list:', e);
    }
  }

  // ==========================================
  // Command Palette (Cmd+K)
  // ==========================================
  showCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('command-palette-input');
    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();
    this.renderPaletteResults('');
  }

  hideCommandPalette() {
    document.getElementById('command-palette-overlay').classList.add('hidden');
  }

  getPaletteActions() {
    const actions = [];

    // Pane actions
    actions.push({ icon: '➕', label: 'New Pane', hint: 'Open terminal, browser, or Expo', shortcut: '⌘T', action: () => this.showLaunchModal(), category: 'Actions' });
    actions.push({ icon: '🧘', label: 'Toggle Zen Mode', hint: 'Focus on one pane', shortcut: '⌘⇧↵', action: () => { this.hideCommandPalette(); this.toggleZenMode(); }, category: 'Actions' });
    actions.push({ icon: '⚡', label: 'Toggle Pipe Mode', hint: 'Connect pane outputs to inputs', shortcut: '⌘⇧P', action: () => { this.hideCommandPalette(); this.togglePipeMode(); }, category: 'Actions' });
    actions.push({ icon: '📊', label: 'Pipe Flow Dashboard', hint: 'View all pipes, stats, orchestration', action: () => { this.hideCommandPalette(); this.showPipeFlowDashboard(); }, category: 'Actions' });
    actions.push({ icon: '📡', label: 'Broadcast to AI', hint: 'Send same prompt to all AI panes', shortcut: '⌘⇧B', action: () => { this.hideCommandPalette(); this.showBroadcastPrompt(); }, category: 'Actions' });
    actions.push({ icon: '💾', label: 'Save Workspace', hint: 'Save current layout as a preset', action: () => { this.hideCommandPalette(); this.saveWorkspacePreset(); }, category: 'Actions' });
    actions.push({ icon: '⚙', label: 'Settings', hint: 'Font size, theme, preferences', action: () => this.showSettings(), category: 'Actions' });

    // Open panes (all types)
    let paneIndex = 1;
    for (const [id, info] of this.allPanes) {
      let name, icon;
      if (info.type === 'terminal') {
        const term = this.terminals.get(id);
        name = term?.pane.querySelector('.terminal-name')?.value || `Terminal ${paneIndex}`;
        icon = '💻';
      } else {
        const bp = this.browserPanes.get(id);
        name = bp?.pane.querySelector('.pane-name')?.value || (info.type === 'expo' ? 'Expo' : 'Browser');
        icon = info.type === 'expo' ? '📱' : '🌐';
      }
      const idx = paneIndex;
      actions.push({ icon, label: name, hint: `Switch to pane`, shortcut: idx <= 9 ? `⌘${idx}` : '', action: () => { this.setActivePaneId(id); }, category: 'Panes' });
      paneIndex++;
    }

    // Directories
    this.directories.forEach(dir => {
      actions.push({ icon: '📁', label: dir.name, hint: dir.path, action: () => { this.hideCommandPalette(); this.sendToActiveTerminal(`cd "${dir.path}"\n`, false); }, category: 'Directories' });
    });

    // Commands
    this.commands.forEach(cmd => {
      actions.push({ icon: '⌘', label: cmd.name, hint: cmd.command, action: () => { this.hideCommandPalette(); this.sendToActiveTerminal(cmd.command, false); }, category: 'Commands' });
    });

    // Workspace presets
    this.workspacePresets.forEach(preset => {
      actions.push({ icon: '📐', label: preset.name, hint: `${preset.panes.length} pane${preset.panes.length > 1 ? 's' : ''}`, action: () => { this.hideCommandPalette(); this.loadWorkspacePreset(preset); }, category: 'Workspaces' });
    });

    return actions;
  }

  renderPaletteResults(query) {
    const container = document.getElementById('command-palette-results');
    const actions = this.getPaletteActions();
    const q = query.toLowerCase().trim();

    let filtered;
    if (q) {
      // Fuzzy search with scoring
      filtered = actions.map(a => ({
        ...a,
        score: Math.max(this.fuzzyScore(q, a.label), this.fuzzyScore(q, a.hint || '') * 0.8)
      })).filter(a => a.score > 0).sort((a, b) => b.score - a.score);
    } else {
      // Show recent actions first when no query
      const recentSet = new Set(this.recentActions.slice(0, 5));
      const recentItems = actions.filter(a => recentSet.has(a.label)).map(a => ({ ...a, isRecent: true, category: 'Recent' }));
      const rest = actions.filter(a => !recentSet.has(a.label));
      filtered = [...recentItems, ...rest];
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="palette-empty">No results found</div>';
      return;
    }

    container.innerHTML = '';
    let currentCategory = '';

    filtered.forEach((item, index) => {
      if (item.category !== currentCategory) {
        currentCategory = item.category;
        const cat = document.createElement('div');
        cat.className = 'palette-category';
        cat.textContent = currentCategory;
        container.appendChild(cat);
      }

      const el = document.createElement('div');
      el.className = 'palette-item' + (index === 0 ? ' selected' : '');
      el.innerHTML = `
        <span class="palette-icon">${item.icon}</span>
        <span class="palette-label">${item.label}</span>
        ${item.hint ? `<span class="palette-hint">${item.hint}</span>` : ''}
        ${item.isRecent ? `<span class="palette-recent-badge">recent</span>` : ''}
        ${item.shortcut ? `<span class="palette-shortcut">${item.shortcut}</span>` : ''}
      `;
      el.addEventListener('click', () => {
        this.hideCommandPalette();
        this.trackRecentAction(item.label);
        item.action();
      });
      container.appendChild(el);
    });

    this.paletteSelectedIndex = 0;
  }

  setupCommandPalette() {
    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('command-palette-input');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hideCommandPalette();
    });

    input.addEventListener('input', () => {
      this.renderPaletteResults(input.value);
    });

    input.addEventListener('keydown', (e) => {
      const items = document.querySelectorAll('.palette-item');
      if (e.key === 'Escape') {
        this.hideCommandPalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.paletteSelectedIndex < items.length - 1) {
          items[this.paletteSelectedIndex]?.classList.remove('selected');
          this.paletteSelectedIndex++;
          items[this.paletteSelectedIndex]?.classList.add('selected');
          items[this.paletteSelectedIndex]?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.paletteSelectedIndex > 0) {
          items[this.paletteSelectedIndex]?.classList.remove('selected');
          this.paletteSelectedIndex--;
          items[this.paletteSelectedIndex]?.classList.add('selected');
          items[this.paletteSelectedIndex]?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[this.paletteSelectedIndex]?.click();
      }
    });
  }

  // ==========================================
  // Keyboard Shortcuts
  // ==========================================
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+K - Command palette
      if (isMeta && e.key === 'k') {
        e.preventDefault();
        this.showCommandPalette();
        return;
      }

      // Cmd+T - New pane
      if (isMeta && e.key === 't') {
        e.preventDefault();
        this.showLaunchModal();
        return;
      }

      // Cmd+W - Close active pane (with confirmation)
      if (isMeta && e.key === 'w') {
        e.preventDefault();
        if (this.activePaneId) {
          const type = this.terminals.has(this.activePaneId) ? 'terminal' : 'browser';
          this.confirmClosePane(this.activePaneId, type);
        }
        return;
      }

      // Cmd+] - Next pane
      if (isMeta && e.key === ']') {
        e.preventDefault();
        this.switchPane(1);
        return;
      }

      // Cmd+[ - Previous pane
      if (isMeta && e.key === '[') {
        e.preventDefault();
        this.switchPane(-1);
        return;
      }

      // Cmd+1-9 - Switch to pane by number
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const paneNum = parseInt(e.key);
        const paneIds = Array.from(this.allPanes.keys());
        if (paneNum <= paneIds.length) {
          this.setActivePaneId(paneIds[paneNum - 1]);
        }
        return;
      }

      // Cmd+, - Settings
      if (isMeta && e.key === ',') {
        e.preventDefault();
        this.showSettings();
        return;
      }

      // Cmd+Shift+B - Broadcast to AI
      if (isMeta && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        this.showBroadcastPrompt();
        return;
      }

      // Cmd+Shift+P - Pipe mode
      if (isMeta && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        this.togglePipeMode();
        return;
      }

      // Cmd+Shift+Enter - Focus/Zen mode
      if (isMeta && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        this.toggleZenMode();
        return;
      }
    });
  }

  switchPane(direction) {
    const paneIds = Array.from(this.allPanes.keys());
    if (paneIds.length === 0) return;

    const currentIndex = paneIds.indexOf(this.activePaneId);
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = paneIds.length - 1;
    if (nextIndex >= paneIds.length) nextIndex = 0;

    this.setActivePaneId(paneIds[nextIndex]);
  }

  // ==========================================
  // Context Menu
  // ==========================================
  setupContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      const pane = e.target.closest('.terminal-pane') || e.target.closest('.browser-pane');
      if (!pane) {
        this.hideContextMenu();
        return;
      }

      e.preventDefault();
      const paneId = pane.id;
      const paneInfo = this.allPanes.get(paneId);
      const paneType = paneInfo?.type || 'terminal';

      // Build menu items based on pane type
      let items = '';
      items += `<div class="context-menu-item" data-action="rename"><span class="ctx-icon">✏️</span>Rename</div>`;
      items += `<div class="context-menu-item" data-action="duplicate"><span class="ctx-icon">📋</span>Duplicate Pane</div>`;
      items += `<div class="context-menu-divider"></div>`;
      if (paneType === 'terminal') {
        items += `<div class="context-menu-item" data-action="minimize"><span class="ctx-icon">─</span>Minimize</div>`;
      }
      items += `<div class="context-menu-item" data-action="expand"><span class="ctx-icon">⤢</span>Expand</div>`;
      if (paneType === 'browser' || paneType === 'expo') {
        items += `<div class="context-menu-item" data-action="refresh"><span class="ctx-icon">↻</span>Refresh</div>`;
        items += `<div class="context-menu-item" data-action="copyurl"><span class="ctx-icon">🔗</span>Copy URL</div>`;
      }
      items += `<div class="context-menu-divider"></div>`;
      items += `<div class="context-menu-item" data-action="close" style="color:#f85149;"><span class="ctx-icon">✕</span>Close<span class="ctx-shortcut">⌘W</span></div>`;

      const menu = document.getElementById('context-menu');
      menu.innerHTML = items;
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.classList.remove('hidden');

      menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          this.hideContextMenu();
          const action = item.dataset.action;
          if (action === 'close') {
            this.confirmClosePane(paneId, paneType);
          } else if (action === 'minimize') {
            this.toggleMinimize(paneId);
          } else if (action === 'expand') {
            if (paneType === 'terminal') {
              this.toggleExpand(paneId);
            } else {
              const bp = this.browserPanes.get(paneId);
              if (bp?.toggleExpand) bp.toggleExpand();
            }
          } else if (action === 'rename') {
            pane.querySelector('.terminal-name, .pane-name')?.focus();
          } else if (action === 'duplicate') {
            this.duplicatePane(paneId);
          } else if (action === 'refresh') {
            const bp = this.browserPanes.get(paneId);
            if (bp?.webview) bp.webview.reload();
          } else if (action === 'copyurl') {
            const bp = this.browserPanes.get(paneId);
            if (bp?.url) navigator.clipboard.writeText(bp.url);
          }
        });
      });
    });

    document.addEventListener('click', () => this.hideContextMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideContextMenu();
    });
  }

  hideContextMenu() {
    document.getElementById('context-menu')?.classList.add('hidden');
  }

  async duplicatePane(paneId) {
    const paneInfo = this.allPanes.get(paneId);
    if (!paneInfo) return;

    if (paneInfo.type === 'terminal') {
      const term = this.terminals.get(paneId);
      if (!term) return;
      const name = term.pane.querySelector('.terminal-name')?.value || '';
      await this.createTerminal({ name: name + ' (copy)' });
    } else if (paneInfo.type === 'browser') {
      const bp = this.browserPanes.get(paneId);
      if (!bp) return;
      const name = bp.pane.querySelector('.pane-name')?.value || 'Browser';
      await this.createBrowserPane({ name: name + ' (copy)', url: bp.url });
    } else if (paneInfo.type === 'expo') {
      const ep = this.browserPanes.get(paneId);
      if (!ep) return;
      const name = ep.pane.querySelector('.pane-name')?.value || 'Expo';
      await this.createExpoPanePreview({ name: name + ' (copy)', url: ep.url, showQR: ep.showQR });
    }
  }

  // ==========================================
  // Workspace Presets
  // ==========================================
  async saveWorkspacePreset() {
    const session = this.getSessionData();
    if (!session.panes.length) {
      this.showToast('No panes to save', { type: 'error' });
      return;
    }

    // Prompt for name via a simple input
    const name = await this.promptInput('Save Workspace', 'Workspace name', 'My Workspace');
    if (!name) return;

    // Add or update preset
    const existing = this.workspacePresets.findIndex(p => p.name === name);
    const preset = { name, panes: session.panes, gridLayout: session.gridLayout, savedAt: new Date().toISOString() };
    if (existing >= 0) {
      this.workspacePresets[existing] = preset;
    } else {
      this.workspacePresets.push(preset);
    }

    await this.saveConfig();
    this.renderSidebarPresets();
    this.showToast(`Workspace "${name}" saved`, { type: 'success' });
  }

  async loadWorkspacePreset(preset) {
    // Close all existing panes
    for (const [id, info] of Array.from(this.allPanes.entries())) {
      if (info.type === 'terminal') this.closeTerminal(id);
      else this.closeBrowserPane(id);
    }

    // Restore from preset
    await this.restoreSession({
      panes: preset.panes,
      gridLayout: preset.gridLayout,
      sidebarVisible: this.sidebarVisible,
      activePaneIndex: 0
    });

    this.showToast(`Loaded "${preset.name}"`, { type: 'info' });
  }

  deleteWorkspacePreset(index) {
    const name = this.workspacePresets[index]?.name;
    this.workspacePresets.splice(index, 1);
    this.saveConfig();
    this.renderSidebarPresets();
    this.showToast(`"${name}" deleted`, { type: 'info' });
  }

  renderSidebarPresets() {
    const container = document.getElementById('sidebar-presets');
    if (!container) return;
    container.innerHTML = '';

    if (this.workspacePresets.length === 0) {
      container.innerHTML = '<div class="sidebar-empty-hint">Save your current layout as a preset</div>';
      return;
    }

    this.workspacePresets.forEach((preset, index) => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.innerHTML = `
        <span class="item-icon">📐</span>
        <span class="item-name">${preset.name}</span>
        <span class="preset-pane-count">${preset.panes.length}</span>
        <span class="item-delete" data-index="${index}">×</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('item-delete')) {
          this.deleteWorkspacePreset(parseInt(e.target.dataset.index));
        } else {
          this.loadWorkspacePreset(preset);
        }
      });
      container.appendChild(item);
    });
  }

  promptInput(title, placeholder, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width: 360px;">
          <h3>${title}</h3>
          <input type="text" id="prompt-input" placeholder="${placeholder}" value="${defaultValue}" style="margin-bottom: 12px;">
          <div class="modal-buttons">
            <button class="btn-secondary" id="prompt-cancel">Cancel</button>
            <button class="btn-primary" id="prompt-ok">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#prompt-input');
      input.focus();
      input.select();

      const cleanup = (value) => {
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
        resolve(value);
      };

      const keyHandler = (e) => {
        if (e.key === 'Escape') cleanup(null);
        if (e.key === 'Enter') cleanup(input.value.trim() || null);
      };
      document.addEventListener('keydown', keyHandler);
      overlay.querySelector('#prompt-cancel').addEventListener('click', () => cleanup(null));
      overlay.querySelector('#prompt-ok').addEventListener('click', () => cleanup(input.value.trim() || null));
    });
  }

  // ==========================================
  // Activity Tracking
  // ==========================================
  markPaneActive(id) {
    // Light up the activity dot in sidebar and pane header
    const dot = document.getElementById(`activity-${id}`);
    if (dot) {
      dot.classList.add('active');
      clearTimeout(dot._fadeTimer);
      dot._fadeTimer = setTimeout(() => dot.classList.remove('active'), 2000);
    }

    // Also update the pane header activity dot
    const pane = this.terminals.get(id)?.pane || this.browserPanes.get(id)?.pane;
    if (pane) {
      const headerDot = pane.querySelector('.header-activity-dot');
      if (headerDot) {
        headerDot.classList.add('active');
        clearTimeout(headerDot._fadeTimer);
        headerDot._fadeTimer = setTimeout(() => headerDot.classList.remove('active'), 2000);
      }
    }
  }

  // ==========================================
  // Pipe Mode
  // ==========================================

  togglePipeMode() {
    this.pipeMode = !this.pipeMode;
    document.body.classList.toggle('pipe-mode', this.pipeMode);
    if (this.pipeMode) {
      this.showPipeOverlay();
      this.showToast('Pipe Mode — drag ● output to ● input', { type: 'info', duration: 3000 });
    } else {
      this.hidePipeOverlay();
    }
  }

  showPipeOverlay() {
    const overlay = document.getElementById('pipe-overlay');
    const toolbar = document.getElementById('pipe-toolbar');
    overlay.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    this.updatePipeOverlayPosition();
    this.renderPipePorts();
    this.renderPipeCurves();
    this.renderPipeToolbar();

    this._pipeResizeHandler = () => {
      this.updatePipeOverlayPosition();
      this.renderPipeCurves();
    };
    window.addEventListener('resize', this._pipeResizeHandler);
    this.gridContainer.addEventListener('scroll', this._pipeResizeHandler);
  }

  hidePipeOverlay() {
    const overlay = document.getElementById('pipe-overlay');
    const toolbar = document.getElementById('pipe-toolbar');
    overlay.classList.add('hidden');
    toolbar.classList.add('hidden');
    this.removePipePorts();
    this.hidePipeFilterEditor();
    if (this._pipeResizeHandler) {
      window.removeEventListener('resize', this._pipeResizeHandler);
      this.gridContainer.removeEventListener('scroll', this._pipeResizeHandler);
    }
  }

  updatePipeOverlayPosition() {
    const overlay = document.getElementById('pipe-overlay');
    if (!overlay) return;
    const gridRect = this.gridContainer.getBoundingClientRect();
    const mainRect = document.getElementById('main-container').getBoundingClientRect();
    overlay.style.left = (gridRect.left - mainRect.left) + 'px';
    overlay.style.top = (gridRect.top - mainRect.top) + 'px';
    overlay.setAttribute('width', gridRect.width);
    overlay.setAttribute('height', gridRect.height);
  }

  renderPipePorts() {
    this.removePipePorts();

    for (const [id, info] of this.allPanes) {
      let paneEl;
      if (info.type === 'terminal') {
        paneEl = this.terminals.get(id)?.pane;
        if (paneEl && paneEl.style.display === 'none') continue;
      } else {
        paneEl = this.browserPanes.get(id)?.pane;
      }
      if (!paneEl) continue;

      const outputPort = document.createElement('div');
      outputPort.className = 'pipe-port pipe-port-output';
      outputPort.dataset.paneId = id;
      outputPort.title = 'Drag to connect output';
      paneEl.appendChild(outputPort);

      const inputPort = document.createElement('div');
      inputPort.className = 'pipe-port pipe-port-input';
      inputPort.dataset.paneId = id;
      inputPort.title = 'Drop here to receive input';
      paneEl.appendChild(inputPort);

      this.setupPipePortDrag(outputPort);
    }
  }

  removePipePorts() {
    document.querySelectorAll('.pipe-port').forEach(p => p.remove());
    document.querySelectorAll('.pipe-filter-badge').forEach(b => b.remove());
  }

  setupPipePortDrag(outputPort) {
    outputPort.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const sourceId = outputPort.dataset.paneId;
      const overlay = document.getElementById('pipe-overlay');
      const gridRect = this.gridContainer.getBoundingClientRect();

      const tempCurve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempCurve.classList.add('pipe-temp-curve');
      overlay.appendChild(tempCurve);

      const portRect = outputPort.getBoundingClientRect();
      const startX = portRect.left + portRect.width / 2 - gridRect.left;
      const startY = portRect.top + portRect.height / 2 - gridRect.top;

      const onMouseMove = (ev) => {
        const endX = ev.clientX - gridRect.left;
        const endY = ev.clientY - gridRect.top;
        const dx = Math.max(Math.abs(endX - startX) * 0.4, 40);
        tempCurve.setAttribute('d', `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`);

        document.querySelectorAll('.pipe-port-input').forEach(port => {
          const r = port.getBoundingClientRect();
          const dist = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
          port.classList.toggle('pipe-port-hover', dist < 30 && port.dataset.paneId !== sourceId);
        });
      };

      const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        tempCurve.remove();

        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const inputPort = target?.closest('.pipe-port-input');
        if (inputPort && inputPort.dataset.paneId !== sourceId) {
          this.createPipe(sourceId, inputPort.dataset.paneId, { type: 'passthrough' });
        }

        document.querySelectorAll('.pipe-port-hover').forEach(p => p.classList.remove('pipe-port-hover'));
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  createPipe(sourceId, targetId, filter = { type: 'passthrough' }) {
    // Check for duplicates
    for (const [, pipe] of this.pipes) {
      if (pipe.sourceId === sourceId && pipe.targetId === targetId) {
        this.showToast('Pipe already exists', { type: 'error' });
        return null;
      }
    }

    const id = `pipe-${++this.pipeCounter}`;
    const pipe = { id, sourceId, targetId, filter, active: true, _buffer: '', _flushTimer: null, stats: { messageCount: 0, bytesForwarded: 0, lastActivity: null, created: Date.now() } };
    this.pipes.set(id, pipe);

    if (this.pipeMode) {
      this.renderPipeCurves();
      this.renderPipeToolbar();
    }
    this.renderSidebarPipes();

    const sourceName = this.getPaneName(sourceId);
    const targetName = this.getPaneName(targetId);
    this.showToast(`Pipe: ${sourceName} → ${targetName}`, { type: 'success' });

    this.saveSessionDebounced();
    return pipe;
  }

  deletePipe(pipeId) {
    const pipe = this.pipes.get(pipeId);
    if (pipe) {
      clearTimeout(pipe._flushTimer);
      this.pipes.delete(pipeId);
      if (this.pipeMode) {
        this.renderPipeCurves();
        this.renderPipeToolbar();
      }
      this.renderSidebarPipes();
      this.hidePipeFilterEditor();
      this.saveSessionDebounced();
      this.showToast('Pipe removed', { type: 'info' });
    }
  }

  removePipesForPane(paneId) {
    const toDelete = [];
    for (const [pipeId, pipe] of this.pipes) {
      if (pipe.sourceId === paneId || pipe.targetId === paneId) {
        clearTimeout(pipe._flushTimer);
        toDelete.push(pipeId);
      }
    }
    toDelete.forEach(id => this.pipes.delete(id));
    if (toDelete.length > 0) {
      if (this.pipeMode) this.renderPipeCurves();
      this.renderSidebarPipes();
    }
  }

  getPaneName(paneId) {
    const info = this.allPanes.get(paneId);
    if (!info) return 'Unknown';
    if (info.type === 'terminal') {
      return this.terminals.get(paneId)?.pane.querySelector('.terminal-name')?.value || 'Terminal';
    }
    return this.browserPanes.get(paneId)?.pane.querySelector('.pane-name')?.value || info.type;
  }

  applyPipeFilter(data, filter) {
    // Strip ANSI codes for filtering
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/[\x00-\x08\x0e-\x1f]/g, '');
    if (!clean.trim()) return null;

    switch (filter.type) {
      case 'passthrough':
        return clean;

      case 'errors': {
        const lines = clean.split('\n');
        const errorLines = lines.filter(line =>
          /error|ERR|FAIL|exception|panic|FATAL|TypeError|ReferenceError|SyntaxError|Warning/i.test(line) && line.trim().length > 0
        );
        return errorLines.length > 0 ? errorLines.join('\n') : null;
      }

      case 'regex': {
        if (!filter.pattern) return null;
        try {
          const regex = new RegExp(filter.pattern, 'gmi');
          const lines = clean.split('\n');
          const matched = lines.filter(line => { regex.lastIndex = 0; return regex.test(line) && line.trim().length > 0; });
          return matched.length > 0 ? matched.join('\n') : null;
        } catch {
          return null;
        }
      }

      case 'debounced':
      case 'prompt':
        return clean;

      default:
        return clean;
    }
  }

  forwardPipeData(sourceId, rawData) {
    for (const [, pipe] of this.pipes) {
      if (pipe.sourceId !== sourceId || !pipe.active) continue;

      const filtered = this.applyPipeFilter(rawData, pipe.filter);
      if (!filtered) continue;

      if (pipe.filter.type === 'debounced') {
        pipe._buffer += filtered;
        clearTimeout(pipe._flushTimer);
        pipe._flushTimer = setTimeout(() => {
          if (pipe._buffer.trim()) {
            this.writeToPipe(pipe, pipe._buffer);
            pipe._buffer = '';
          }
        }, pipe.filter.delay || 3000);
      } else if (pipe.filter.type === 'prompt') {
        pipe._buffer += filtered;
        clearTimeout(pipe._flushTimer);
        pipe._flushTimer = setTimeout(() => {
          if (pipe._buffer.trim()) {
            const template = pipe.filter.template || 'Output captured:\n---\n{data}\n---\nPlease analyze.';
            const wrapped = template.replace('{data}', pipe._buffer.trim());
            this.writeToPipe(pipe, wrapped);
            pipe._buffer = '';
          }
        }, pipe.filter.delay || 5000);
      } else {
        this.writeToPipe(pipe, filtered);
      }

      this.flashPipeCurve(pipe.id);
    }
  }

  writeToPipe(pipe, data) {
    const targetInfo = this.allPanes.get(pipe.targetId);
    if (!targetInfo) return;
    if (targetInfo.type === 'terminal') {
      window.terminal.write(pipe.targetId, data);
    }
    // Update stats
    pipe.stats.messageCount++;
    pipe.stats.bytesForwarded += data.length;
    pipe.stats.lastActivity = Date.now();
  }

  flashPipeCurve(pipeId) {
    const curve = document.querySelector(`.pipe-curve[data-pipe-id="${pipeId}"]`);
    if (curve) {
      curve.classList.add('pipe-data-flash');
      setTimeout(() => curve.classList.remove('pipe-data-flash'), 300);
    }
  }

  renderPipeCurves() {
    const overlay = document.getElementById('pipe-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    // Clear existing
    overlay.innerHTML = '';
    document.querySelectorAll('.pipe-filter-badge').forEach(b => b.remove());

    const gridRect = this.gridContainer.getBoundingClientRect();
    overlay.setAttribute('width', gridRect.width);
    overlay.setAttribute('height', gridRect.height);

    for (const [pipeId, pipe] of this.pipes) {
      const sourcePort = document.querySelector(`.pipe-port-output[data-pane-id="${pipe.sourceId}"]`);
      const targetPort = document.querySelector(`.pipe-port-input[data-pane-id="${pipe.targetId}"]`);
      if (!sourcePort || !targetPort) continue;

      const sRect = sourcePort.getBoundingClientRect();
      const tRect = targetPort.getBoundingClientRect();

      const sx = sRect.left + sRect.width / 2 - gridRect.left;
      const sy = sRect.top + sRect.height / 2 - gridRect.top;
      const tx = tRect.left + tRect.width / 2 - gridRect.left;
      const ty = tRect.top + tRect.height / 2 - gridRect.top;

      const dx = Math.max(Math.abs(tx - sx) * 0.4, 50);
      const pathD = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

      // Wide invisible hit area
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', pathD);
      hitPath.classList.add('pipe-curve-hit');
      hitPath.dataset.pipeId = pipeId;
      hitPath.addEventListener('click', (ev) => this.showPipeFilterEditor(pipeId, ev));
      overlay.appendChild(hitPath);

      // Visible animated curve
      const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      curve.setAttribute('d', pathD);
      curve.classList.add('pipe-curve');
      if (pipe.filter.type === 'errors') curve.classList.add('error-filter');
      if (pipe.filter.type === 'prompt') curve.classList.add('prompt-filter');
      curve.dataset.pipeId = pipeId;
      curve.addEventListener('click', (ev) => this.showPipeFilterEditor(pipeId, ev));
      overlay.appendChild(curve);

      // Filter badge at midpoint
      const midX = (sx + tx) / 2;
      const midY = (sy + ty) / 2;
      const filterLabels = { passthrough: '⇢ pass', errors: '⚠ errors', debounced: '⏱ buffer', prompt: '💬 prompt', regex: '/./ regex' };
      const badge = document.createElement('div');
      badge.className = 'pipe-filter-badge';
      badge.textContent = filterLabels[pipe.filter.type] || pipe.filter.type;
      badge.style.left = (gridRect.left + midX - 30) + 'px';
      badge.style.top = (gridRect.top + midY - 10) + 'px';
      badge.addEventListener('click', (ev) => this.showPipeFilterEditor(pipeId, ev));
      document.body.appendChild(badge);
    }
  }

  showPipeFilterEditor(pipeId, event) {
    this.hidePipeFilterEditor();
    const pipe = this.pipes.get(pipeId);
    if (!pipe) return;

    const sourceName = this.getPaneName(pipe.sourceId);
    const targetName = this.getPaneName(pipe.targetId);

    const editor = document.createElement('div');
    editor.className = 'pipe-editor';
    editor.id = 'pipe-editor';
    editor.innerHTML = `
      <h4>${sourceName} → ${targetName}</h4>
      <div class="pipe-editor-row">
        <label>Filter Type</label>
        <select id="pipe-filter-type">
          <option value="passthrough" ${pipe.filter.type === 'passthrough' ? 'selected' : ''}>Passthrough — forward all</option>
          <option value="errors" ${pipe.filter.type === 'errors' ? 'selected' : ''}>Errors Only — error/fail/exception</option>
          <option value="debounced" ${pipe.filter.type === 'debounced' ? 'selected' : ''}>Debounced — collect then forward</option>
          <option value="prompt" ${pipe.filter.type === 'prompt' ? 'selected' : ''}>Prompt Wrap — wrap in AI prompt</option>
          <option value="regex" ${pipe.filter.type === 'regex' ? 'selected' : ''}>Regex — custom pattern</option>
        </select>
      </div>
      <div class="pipe-editor-row" id="pipe-delay-row" style="display:${['debounced', 'prompt'].includes(pipe.filter.type) ? '' : 'none'}">
        <label>Collect for (ms)</label>
        <input type="number" id="pipe-filter-delay" value="${pipe.filter.delay || 3000}" min="500" max="30000" step="500">
      </div>
      <div class="pipe-editor-row" id="pipe-template-row" style="display:${pipe.filter.type === 'prompt' ? '' : 'none'}">
        <label>Prompt template ({data} = captured output)</label>
        <textarea id="pipe-filter-template">${pipe.filter.template || 'The following error occurred:\n---\n{data}\n---\nPlease analyze and suggest a fix.'}</textarea>
      </div>
      <div class="pipe-editor-row" id="pipe-regex-row" style="display:${pipe.filter.type === 'regex' ? '' : 'none'}">
        <label>Regex pattern</label>
        <input type="text" id="pipe-filter-pattern" value="${pipe.filter.pattern || ''}" placeholder="error|fail|warn">
      </div>
      <div class="pipe-editor-actions">
        <button class="pipe-editor-delete">Delete Pipe</button>
        <button class="pipe-editor-save">Save</button>
      </div>
    `;

    editor.style.left = Math.min(event.clientX, window.innerWidth - 290) + 'px';
    editor.style.top = Math.min(event.clientY + 10, window.innerHeight - 320) + 'px';
    document.body.appendChild(editor);

    // Show/hide fields based on filter type
    editor.querySelector('#pipe-filter-type').addEventListener('change', (e) => {
      const type = e.target.value;
      editor.querySelector('#pipe-delay-row').style.display = ['debounced', 'prompt'].includes(type) ? '' : 'none';
      editor.querySelector('#pipe-template-row').style.display = type === 'prompt' ? '' : 'none';
      editor.querySelector('#pipe-regex-row').style.display = type === 'regex' ? '' : 'none';
    });

    // Save
    editor.querySelector('.pipe-editor-save').addEventListener('click', () => {
      const type = editor.querySelector('#pipe-filter-type').value;
      pipe.filter = { type };
      if (['debounced', 'prompt'].includes(type)) pipe.filter.delay = parseInt(editor.querySelector('#pipe-filter-delay').value) || 3000;
      if (type === 'prompt') pipe.filter.template = editor.querySelector('#pipe-filter-template').value;
      if (type === 'regex') pipe.filter.pattern = editor.querySelector('#pipe-filter-pattern').value;
      this.hidePipeFilterEditor();
      this.renderPipeCurves();
      this.renderSidebarPipes();
      this.saveSessionDebounced();
      this.showToast('Filter updated', { type: 'success' });
    });

    // Delete
    editor.querySelector('.pipe-editor-delete').addEventListener('click', () => {
      this.deletePipe(pipeId);
    });

    // Close on Escape
    this._pipeEditorKeyHandler = (e) => { if (e.key === 'Escape') this.hidePipeFilterEditor(); };
    document.addEventListener('keydown', this._pipeEditorKeyHandler);

    // Close on click outside
    setTimeout(() => {
      this._pipeEditorClickHandler = (e) => {
        if (!editor.contains(e.target) && !e.target.closest('.pipe-filter-badge') && !e.target.closest('.pipe-curve-hit') && !e.target.closest('.pipe-curve')) {
          this.hidePipeFilterEditor();
        }
      };
      document.addEventListener('click', this._pipeEditorClickHandler);
    }, 100);
  }

  hidePipeFilterEditor() {
    const editor = document.getElementById('pipe-editor');
    if (editor) editor.remove();
    if (this._pipeEditorKeyHandler) document.removeEventListener('keydown', this._pipeEditorKeyHandler);
    if (this._pipeEditorClickHandler) document.removeEventListener('click', this._pipeEditorClickHandler);
  }

  renderSidebarPipes() {
    const container = document.getElementById('sidebar-pipes');
    if (!container) return;
    container.innerHTML = '';

    if (this.pipes.size === 0) {
      container.innerHTML = '<div class="sidebar-empty-hint">No active pipes</div>';
      return;
    }

    const filterLabels = { passthrough: 'pass', errors: 'errors', debounced: 'buffer', prompt: 'prompt', regex: 'regex' };
    for (const [pipeId, pipe] of this.pipes) {
      const sourceName = this.getPaneName(pipe.sourceId);
      const targetName = this.getPaneName(pipe.targetId);
      const item = document.createElement('div');
      item.className = 'sidebar-pipe-item';
      item.innerHTML = `
        <span class="pipe-source-name">${sourceName}</span>
        <span class="pipe-arrow">→</span>
        <span class="pipe-target-name">${targetName}</span>
        <span class="pipe-filter-tag">${filterLabels[pipe.filter.type] || pipe.filter.type}</span>
        <span class="item-delete" data-pipe-id="${pipeId}">×</span>
      `;
      item.querySelector('.item-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePipe(pipeId);
      });
      item.addEventListener('click', () => {
        if (!this.pipeMode) this.togglePipeMode();
      });
      container.appendChild(item);
    }
  }

  renderPipeToolbar() {
    const toolbar = document.getElementById('pipe-toolbar');
    if (!toolbar) return;

    const presets = this.getPipePresets();
    toolbar.innerHTML = `
      <span class="pipe-toolbar-title">⚡ Pipe Mode</span>
      <span class="pipe-toolbar-divider"></span>
      <span class="pipe-toolbar-info">${this.pipes.size} pipe${this.pipes.size !== 1 ? 's' : ''} · Drag ● to ● to connect</span>
      <span class="pipe-toolbar-divider"></span>
      ${presets.map(p => `<button class="pipe-preset-btn" data-preset="${p.id}" title="${p.description}">${p.icon} ${p.name}</button>`).join('')}
      <button class="pipe-toolbar-exit">Exit ⌘⇧P</button>
    `;

    toolbar.querySelectorAll('.pipe-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = presets.find(p => p.id === btn.dataset.preset);
        if (preset) this.applyPipePreset(preset);
      });
    });

    toolbar.querySelector('.pipe-toolbar-exit').addEventListener('click', () => this.togglePipeMode());
  }

  getPipePresets() {
    const presets = [];
    const claudePanes = [], termPanes = [], bPanes = [];

    for (const [id, info] of this.allPanes) {
      if (info.type === 'terminal') {
        const term = this.terminals.get(id);
        const ai = term?.launchConfig?.aiCommand;
        if (ai?.includes('claude') || ai?.includes('codex')) claudePanes.push(id);
        else termPanes.push(id);
      } else {
        bPanes.push(id);
      }
    }

    if (termPanes.length > 0 && claudePanes.length > 0) {
      presets.push({
        id: 'error-fixer', name: 'Error → AI', icon: '🔧',
        description: 'Send errors from terminals to AI for analysis',
        sourceIds: termPanes, targetId: claudePanes[0],
        filter: { type: 'errors' }
      });
      presets.push({
        id: 'prompt-fixer', name: 'Error → Prompt', icon: '💬',
        description: 'Wrap errors in a prompt and send to AI',
        sourceIds: termPanes, targetId: claudePanes[0],
        filter: { type: 'prompt', delay: 5000, template: 'Error from my terminal:\n---\n{data}\n---\nPlease analyze and suggest a fix.' }
      });
    }

    if (termPanes.length >= 2) {
      presets.push({
        id: 'log-stream', name: 'Log Stream', icon: '📡',
        description: 'Stream output between terminals',
        sourceIds: [termPanes[0]], targetId: termPanes[1],
        filter: { type: 'passthrough' }
      });
    }

    if (bPanes.length > 0 && claudePanes.length > 0) {
      presets.push({
        id: 'browser-errors', name: 'Browser → AI', icon: '🌐',
        description: 'Send browser console errors to AI',
        sourceIds: bPanes, targetId: claudePanes[0],
        filter: { type: 'errors' }
      });
    }

    return presets;
  }

  applyPipePreset(preset) {
    let created = 0;
    for (const sourceId of preset.sourceIds) {
      let exists = false;
      for (const [, pipe] of this.pipes) {
        if (pipe.sourceId === sourceId && pipe.targetId === preset.targetId) { exists = true; break; }
      }
      if (!exists) {
        this.createPipe(sourceId, preset.targetId, { ...preset.filter });
        created++;
      }
    }
    if (created > 0) {
      this.showToast(`"${preset.name}" — ${created} pipe${created > 1 ? 's' : ''}`, { type: 'success' });
    } else {
      this.showToast('Pipes already exist', { type: 'info' });
    }
  }

  // ==========================================
  // Pipe Flow Dashboard
  // ==========================================

  showPipeFlowDashboard() {
    const modal = document.getElementById('pipe-flow-modal');
    modal.classList.remove('hidden');
    this.renderFlowDashboard();

    if (this._flowDashKeyHandler) document.removeEventListener('keydown', this._flowDashKeyHandler);
    this._flowDashKeyHandler = (e) => {
      if (e.key === 'Escape') this.hidePipeFlowDashboard();
    };
    document.addEventListener('keydown', this._flowDashKeyHandler);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hidePipeFlowDashboard();
    });

    // Auto-refresh stats while open
    this._flowDashRefresh = setInterval(() => {
      if (!modal.classList.contains('hidden')) this.renderFlowDashboard();
    }, 2000);
  }

  hidePipeFlowDashboard() {
    document.getElementById('pipe-flow-modal').classList.add('hidden');
    if (this._flowDashKeyHandler) document.removeEventListener('keydown', this._flowDashKeyHandler);
    clearInterval(this._flowDashRefresh);
  }

  renderFlowDashboard() {
    const content = document.querySelector('.flow-dashboard-content');
    if (!content) return;

    const totalMsgs = Array.from(this.pipes.values()).reduce((s, p) => s + (p.stats?.messageCount || 0), 0);
    const totalBytes = Array.from(this.pipes.values()).reduce((s, p) => s + (p.stats?.bytesForwarded || 0), 0);
    const fmtBytes = (b) => b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
    const timeAgo = (ts) => {
      if (!ts) return 'never';
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 5) return 'just now';
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      return `${Math.floor(s / 3600)}h ago`;
    };

    const fLabels = { passthrough: '⇢ pass', errors: '⚠ errors', debounced: '⏱ buffer', prompt: '💬 prompt', regex: '/./ regex' };

    let pipesHtml = '';
    if (this.pipes.size === 0) {
      pipesHtml = '<div class="flow-empty">No pipes configured. Enter Pipe Mode (⌘⇧P) to connect panes.</div>';
    } else {
      for (const [pipeId, pipe] of this.pipes) {
        const src = this.getPaneName(pipe.sourceId);
        const tgt = this.getPaneName(pipe.targetId);
        const st = pipe.stats || {};
        const paused = !pipe.active;
        pipesHtml += `
          <div class="flow-pipe-row${paused ? ' paused' : ''}" data-pipe-id="${pipeId}">
            <div class="flow-node source" title="${src}">${src}</div>
            <div class="flow-connection">
              <div class="flow-line"></div>
              <div class="flow-filter-tag">${fLabels[pipe.filter.type] || pipe.filter.type}</div>
              <div class="flow-line"></div>
            </div>
            <div class="flow-node target" title="${tgt}">${tgt}</div>
            <div class="flow-pipe-stats">
              <span>${st.messageCount || 0} msgs</span>
              <span>${fmtBytes(st.bytesForwarded || 0)}</span>
              <span>${timeAgo(st.lastActivity)}</span>
            </div>
            <div class="flow-pipe-actions">
              <button class="flow-pause-btn" title="${paused ? 'Resume' : 'Pause'}" data-pipe-id="${pipeId}">${paused ? '▶' : '⏸'}</button>
              <button class="flow-edit-btn" title="Edit filter" data-pipe-id="${pipeId}">⚙</button>
              <button class="flow-delete-btn" title="Delete" data-pipe-id="${pipeId}">×</button>
            </div>
          </div>`;
      }
    }

    const orchPresets = this.getOrchestrationPresets();

    content.innerHTML = `
      <div class="flow-dashboard">
        <div class="flow-header">
          <h3>⚡ Pipe Flow Dashboard</h3>
          <span class="flow-stats">${this.pipes.size} pipe${this.pipes.size !== 1 ? 's' : ''} · ${totalMsgs} msgs · ${fmtBytes(totalBytes)}</span>
          <button class="flow-close" title="Close">×</button>
        </div>
        <div class="flow-pipes">${pipesHtml}</div>
        <div class="flow-section-title">Quick Actions</div>
        <div class="flow-action-buttons">
          <button class="flow-action-btn" data-action="pipe-mode">⚡ Pipe Mode</button>
          <button class="flow-action-btn" data-action="broadcast">📡 Broadcast Prompt</button>
          <button class="flow-action-btn" data-action="clear-all" ${this.pipes.size === 0 ? 'disabled' : ''}>🗑 Clear All</button>
        </div>
        ${orchPresets.length > 0 ? `
          <div class="flow-section-title">Orchestration Workflows</div>
          <div class="flow-orch-grid">
            ${orchPresets.map(p => `
              <div class="orch-card" data-orch="${p.id}">
                <div class="orch-card-header">
                  <span class="orch-icon">${p.icon}</span>
                  <span class="orch-title">${p.name}</span>
                </div>
                <div class="orch-desc">${p.description}</div>
                <div class="orch-flow">${p.flow}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>`;

    // Wire up events
    content.querySelector('.flow-close')?.addEventListener('click', () => this.hidePipeFlowDashboard());

    content.querySelectorAll('.flow-pause-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePipePause(btn.dataset.pipeId);
        this.renderFlowDashboard();
      });
    });
    content.querySelectorAll('.flow-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hidePipeFlowDashboard();
        if (!this.pipeMode) this.togglePipeMode();
        setTimeout(() => this.showPipeFilterEditor(btn.dataset.pipeId, e), 200);
      });
    });
    content.querySelectorAll('.flow-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletePipe(btn.dataset.pipeId);
        this.renderFlowDashboard();
      });
    });

    content.querySelectorAll('.flow-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'pipe-mode') { this.hidePipeFlowDashboard(); this.togglePipeMode(); }
        else if (action === 'broadcast') { this.hidePipeFlowDashboard(); this.showBroadcastPrompt(); }
        else if (action === 'clear-all') { this.clearAllPipes(); this.renderFlowDashboard(); }
      });
    });

    content.querySelectorAll('.orch-card').forEach(card => {
      card.addEventListener('click', () => {
        const preset = orchPresets.find(p => p.id === card.dataset.orch);
        if (preset) { this.hidePipeFlowDashboard(); this.launchOrchestration(preset); }
      });
    });
  }

  togglePipePause(pipeId) {
    const pipe = this.pipes.get(pipeId);
    if (pipe) {
      pipe.active = !pipe.active;
      if (this.pipeMode) this.renderPipeCurves();
      this.renderSidebarPipes();
      this.showToast(pipe.active ? 'Pipe resumed' : 'Pipe paused', { type: 'info' });
      this.saveSessionDebounced();
    }
  }

  clearAllPipes() {
    for (const [, pipe] of this.pipes) { clearTimeout(pipe._flushTimer); }
    this.pipes.clear();
    this.pipeCounter = 0;
    if (this.pipeMode) this.renderPipeCurves();
    this.renderSidebarPipes();
    this.saveSessionDebounced();
    this.showToast('All pipes cleared', { type: 'info' });
  }

  // ==========================================
  // AI Orchestration
  // ==========================================

  getOrchestrationPresets() {
    return [
      {
        id: 'claude-codex-review', icon: '🤖', name: 'Claude + Codex Review',
        description: 'Claude implements, Codex reviews the output',
        flow: 'Claude ──prompt──→ Codex',
        create: async () => {
          const dir = this.directories.length > 0 ? this.directories[0].path : null;
          const claudeId = await this.createTerminal({ name: 'Claude (Implement)', directory: dir, aiCommand: 'claude --dangerously-skip-permissions', startupCommands: [] });
          const codexId = await this.createTerminal({ name: 'Codex (Review)', directory: dir, aiCommand: 'codex --full-auto', startupCommands: [] });
          this.createPipe(claudeId, codexId, { type: 'prompt', delay: 10000, template: 'Review this Claude output for correctness and edge cases:\n---\n{data}\n---' });
        }
      },
      {
        id: 'parallel-ai', icon: '⚡', name: 'Parallel AI Compare',
        description: 'Claude and Codex side by side — compare approaches',
        flow: 'Claude ∥ Codex (same dir)',
        create: async () => {
          const dir = this.directories.length > 0 ? this.directories[0].path : null;
          await this.createTerminal({ name: 'Claude', directory: dir, aiCommand: 'claude --dangerously-skip-permissions', startupCommands: [] });
          await this.createTerminal({ name: 'Codex', directory: dir, aiCommand: 'codex --full-auto', startupCommands: [] });
          this.showToast('Use 📡 Broadcast (⌘⇧B) to send same prompt to both', { type: 'info', duration: 5000 });
        }
      },
      {
        id: 'error-watch', icon: '🔧', name: 'Watch & Fix',
        description: 'Dev server errors auto-forwarded to Claude',
        flow: 'Terminal ──errors──→ Claude',
        create: async () => {
          const dir = this.directories.length > 0 ? this.directories[0].path : null;
          const devId = await this.createTerminal({ name: 'Dev Server', directory: dir, aiCommand: '', startupCommands: [] });
          const claudeId = await this.createTerminal({ name: 'Claude (Fixer)', directory: dir, aiCommand: 'claude --dangerously-skip-permissions', startupCommands: [] });
          this.createPipe(devId, claudeId, { type: 'prompt', delay: 5000, template: 'Error from dev server:\n---\n{data}\n---\nPlease analyze and suggest a fix.' });
        }
      },
      {
        id: 'error-chain', icon: '🔗', name: 'Error Chain',
        description: 'Errors → Claude fix → Codex verify — triple check',
        flow: 'Terminal ──→ Claude ──→ Codex',
        create: async () => {
          const dir = this.directories.length > 0 ? this.directories[0].path : null;
          const srcId = await this.createTerminal({ name: 'Source', directory: dir, aiCommand: '', startupCommands: [] });
          const claudeId = await this.createTerminal({ name: 'Claude (Fix)', directory: dir, aiCommand: 'claude --dangerously-skip-permissions', startupCommands: [] });
          const codexId = await this.createTerminal({ name: 'Codex (Verify)', directory: dir, aiCommand: 'codex --full-auto', startupCommands: [] });
          this.createPipe(srcId, claudeId, { type: 'errors' });
          this.createPipe(claudeId, codexId, { type: 'prompt', delay: 10000, template: 'Verify this Claude fix is correct:\n---\n{data}\n---' });
        }
      }
    ];
  }

  async launchOrchestration(preset) {
    this.showToast(`Launching "${preset.name}"...`, { type: 'info' });
    await preset.create();
    this.showToast(`"${preset.name}" ready`, { type: 'success' });
  }

  // ==========================================
  // Broadcast
  // ==========================================

  showBroadcastPrompt() {
    const aiPanes = [];
    for (const [id, info] of this.allPanes) {
      if (info.type !== 'terminal') continue;
      const term = this.terminals.get(id);
      const ai = term?.launchConfig?.aiCommand;
      if (ai?.includes('claude') || ai?.includes('codex')) {
        const name = term.pane.querySelector('.terminal-name')?.value || 'AI';
        aiPanes.push({ id, name });
      }
    }

    if (aiPanes.length === 0) {
      this.showToast('No AI panes open to broadcast to', { type: 'error' });
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'broadcast-overlay';
    overlay.innerHTML = `
      <div class="broadcast-box">
        <div class="broadcast-header">
          <span class="broadcast-title">📡 Broadcast to AI Panes</span>
          <span class="broadcast-targets">${aiPanes.map(p => p.name).join(', ')}</span>
        </div>
        <textarea class="broadcast-input" placeholder="Type your prompt — Cmd+Enter to send to all AI panes..." autofocus></textarea>
        <div class="broadcast-actions">
          <button class="btn-secondary" id="broadcast-cancel">Cancel</button>
          <button class="btn-primary" id="broadcast-send">Send to All (${aiPanes.length})</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.broadcast-input');
    setTimeout(() => input.focus(), 50);

    const cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      cleanup();
      for (const { id } of aiPanes) {
        window.terminal.write(id, text + '\n');
      }
      this.showToast(`Broadcast sent to ${aiPanes.length} pane${aiPanes.length > 1 ? 's' : ''}`, { type: 'success' });
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape') cleanup();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    };
    document.addEventListener('keydown', keyHandler);
    overlay.querySelector('#broadcast-cancel').addEventListener('click', cleanup);
    overlay.querySelector('#broadcast-send').addEventListener('click', send);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  }

  // ==========================================
  // Fuzzy Search & Recent Actions
  // ==========================================

  fuzzyScore(query, text) {
    if (!text) return 0;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 90;
    if (t.includes(q)) return 70;
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    if (qi === q.length) return Math.max(50 - (t.length - q.length), 10);
    return 0;
  }

  trackRecentAction(label) {
    this.recentActions = [label, ...this.recentActions.filter(a => a !== label)].slice(0, 10);
    localStorage.setItem('gridterm-recent-actions', JSON.stringify(this.recentActions));
  }

  // ==========================================
  // Toast Notifications
  // ==========================================
  showToast(message, { type = 'info', duration = 3000, icon = null } = {}) {
    const container = document.getElementById('toast-container');
    const icons = { success: '\u2713', error: '\u2717', info: '\u2139' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icon || icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-dismiss">&times;</button>
    `;

    container.appendChild(toast);

    const remove = () => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove());
    };

    toast.querySelector('.toast-dismiss').addEventListener('click', remove);
    if (duration > 0) setTimeout(remove, duration);

    return { dismiss: remove };
  }

  // ==========================================
  // Settings
  // ==========================================
  showSettings() {
    const modal = document.getElementById('settings-modal');
    // Keyboard: Esc to close
    if (this._settingsKeyHandler) document.removeEventListener('keydown', this._settingsKeyHandler);
    this._settingsKeyHandler = (e) => {
      if (modal.classList.contains('hidden')) return;
      if (e.key === 'Escape') this.hideSettings();
    };
    document.addEventListener('keydown', this._settingsKeyHandler);
    // Load current settings
    const config = this.appSettings || {};
    document.getElementById('settings-font-size').value = config.fontSize || 14;
    document.getElementById('settings-font-size-label').textContent = (config.fontSize || 14) + 'px';
    document.getElementById('settings-theme').value = config.theme || 'dark';
    document.getElementById('settings-grid-gap').value = config.gridGap || '6';
    document.getElementById('settings-default-model').value = config.defaultModel || 'none';
    document.getElementById('settings-auto-restore').checked = config.autoRestore || false;
    modal.classList.remove('hidden');
  }

  hideSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
  }

  setupSettings() {
    document.getElementById('settings-cancel').addEventListener('click', () => this.hideSettings());
    document.getElementById('settings-save').addEventListener('click', () => this.saveSettings());

    document.getElementById('settings-font-size').addEventListener('input', (e) => {
      document.getElementById('settings-font-size-label').textContent = e.target.value + 'px';
    });

    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) this.hideSettings();
    });

    // Settings button in titlebar
    document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());
  }

  async saveSettings() {
    this.appSettings = {
      fontSize: parseInt(document.getElementById('settings-font-size').value),
      theme: document.getElementById('settings-theme').value,
      gridGap: document.getElementById('settings-grid-gap').value,
      defaultModel: document.getElementById('settings-default-model').value,
      autoRestore: document.getElementById('settings-auto-restore').checked,
    };

    // Apply font size to all terminals
    this.terminals.forEach(term => {
      term.xterm.options.fontSize = this.appSettings.fontSize;
      term.fitAddon.fit();
    });

    // Apply grid gap
    document.getElementById('grid-container').style.gap = this.appSettings.gridGap + 'px';
    document.getElementById('grid-container').style.padding = this.appSettings.gridGap + 'px';

    // Save all config (not just settings — avoids overwriting presets/session)
    await this.saveConfig();

    this.hideSettings();
    this.showToast('Settings saved', { type: 'success' });
  }

  // ==========================================
  // Onboarding
  // ==========================================
  showOnboarding() {
    const steps = [
      { icon: '🖥️', title: 'Welcome to GridTerm!', text: 'Manage multiple Claude and Codex AI sessions side by side in one window. Each pane is an independent terminal.' },
      { icon: '➕', title: 'Create Panes', text: 'Click the + button (or press Cmd+T) to open a new terminal. Pick Claude or Codex to start an AI-powered session.' },
      { icon: '⌨️', title: 'Quick Navigation', text: 'Press Cmd+K to search for anything — commands, agents, directories. Use Cmd+1-9 to jump between panes. Right-click panes for more options.' },
    ];

    let currentStep = 0;

    const overlay = document.getElementById('onboarding-overlay');
    const renderStep = () => {
      const step = steps[currentStep];
      document.getElementById('onboarding-icon').textContent = step.icon;
      document.getElementById('onboarding-title').textContent = step.title;
      document.getElementById('onboarding-text').textContent = step.text;
      document.getElementById('onboarding-dots').innerHTML = steps.map((_, i) =>
        `<div class="onboarding-dot ${i === currentStep ? 'active' : ''}"></div>`
      ).join('');
      document.getElementById('onboarding-next').textContent = currentStep === steps.length - 1 ? 'Get Started' : 'Next';
    };

    overlay.classList.remove('hidden');
    renderStep();

    const finishOnboarding = () => {
      overlay.classList.add('hidden');
      localStorage.setItem('gridterm-onboarded', '1');
      document.removeEventListener('keydown', onboardingKeyHandler);
      this.showLaunchModal();
      this.showWelcomeState();
    };

    const nextHandler = () => {
      currentStep++;
      if (currentStep >= steps.length) {
        finishOnboarding();
      } else {
        renderStep();
      }
    };

    const onboardingKeyHandler = (e) => {
      if (overlay.classList.contains('hidden')) return;
      if (e.key === 'Enter' || e.key === 'ArrowRight') nextHandler();
      if (e.key === 'Escape') finishOnboarding();
    };
    document.addEventListener('keydown', onboardingKeyHandler);

    document.getElementById('onboarding-next').addEventListener('click', nextHandler);
    document.getElementById('onboarding-skip').addEventListener('click', finishOnboarding);
  }

  // ==========================================
  // Welcome State (empty grid)
  // ==========================================
  showWelcomeState() {
    if (this.welcomeElement) return;
    const el = document.createElement('div');
    el.className = 'welcome-state';
    el.id = 'welcome-state';
    el.innerHTML = `
      <div class="welcome-icon">🖥️</div>
      <div class="welcome-title">Welcome to GridTerm</div>
      <div class="welcome-subtitle">Manage multiple Claude and Codex sessions in one place. Open a pane to get started.</div>
      <div class="welcome-cta">Click + or press ⌘T to open your first pane</div>
      <div class="welcome-shortcuts">
        <span><kbd class="key-hint">⌘K</kbd> Search</span>
        <span><kbd class="key-hint">⌘T</kbd> New pane</span>
        <span><kbd class="key-hint">⌘1-9</kbd> Switch panes</span>
      </div>
    `;
    this.gridContainer.appendChild(el);
    this.welcomeElement = el;
  }

  hideWelcomeState() {
    if (this.welcomeElement) {
      this.welcomeElement.remove();
      this.welcomeElement = null;
    }
  }

  // ==========================================
  // Auto-rename panes based on context
  // ==========================================
  detectPaneContext(id, data) {
    const term = this.terminals.get(id);
    if (!term) return;

    // Initialize buffer for this terminal (only once — preserve _userRenamed if already set)
    if (term._contextBuffer === undefined) {
      term._contextBuffer = '';
      term._lastAutoName = '';
    }
    if (term._userRenamed === undefined) {
      term._userRenamed = false;
    }

    // If user manually renamed, don't auto-rename
    if (term._userRenamed) return;

    // Capture OSC title sequences before stripping (shells set terminal title via these)
    const oscMatch = data.match(/\x1b\](?:0|2);([^\x07\x1b]{3,60})\x07/);
    if (oscMatch && !term._userRenamed) {
      const oscTitle = oscMatch[1].trim();
      if (oscTitle && oscTitle.length > 2) {
        term._oscTitle = oscTitle;
      }
    }

    // Strip ANSI escape codes for pattern matching
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    term._contextBuffer += clean;

    // Keep buffer manageable (last 500 chars for more recent context)
    if (term._contextBuffer.length > 500) {
      term._contextBuffer = term._contextBuffer.slice(-500);
    }

    // Debounce detection
    if (term._contextTimer) clearTimeout(term._contextTimer);
    term._contextTimer = setTimeout(() => {
      const newName = this.inferPaneName(term._contextBuffer, id);
      if (newName && newName !== term._lastAutoName) {
        term._lastAutoName = newName;
        const nameInput = term.pane.querySelector('.terminal-name');
        if (nameInput) {
          nameInput.value = newName;
        }
      }
    }, 1500);
  }

  inferPaneName(buffer, id) {
    const term = this.terminals.get(id);
    const lower = buffer.toLowerCase();

    // Highest priority: OSC title set by shell
    if (term?._oscTitle) {
      return term._oscTitle;
    }

    // Detect Claude session with task context
    const claudeTaskMatch = buffer.match(/(?:working on|implementing|building|creating|fixing|updating|refactoring|adding)\s+(.{10,60}?)(?:\.|,|\n|$)/i);
    if (claudeTaskMatch && lower.includes('claude')) {
      let task = claudeTaskMatch[1].trim();
      task = task.replace(/[`"']/g, '').replace(/\s+/g, ' ');
      if (task.length > 35) task = task.substring(0, 35) + '...';
      return 'Claude: ' + task;
    }

    // Detect Claude session (generic)
    if (lower.includes('claude code') || /╭─|claude >|human >|╰─/i.test(buffer)) {
      // Try to detect project from the prompt or working directory
      const dirMatch = buffer.match(/(?:cwd|directory|project)[:\s]+([^\n]{5,30})/i);
      if (dirMatch) return 'Claude: ' + dirMatch[1].trim().split('/').pop();
      return 'Claude';
    }

    // Detect Codex
    if (lower.includes('codex') && lower.includes('full-auto')) {
      return 'Codex';
    }

    // Detect common dev tasks
    if (lower.includes('npm run dev') || lower.includes('npm start') || lower.includes('yarn dev')) {
      const portMatch = buffer.match(/localhost:(\d+)/);
      if (portMatch) return 'Dev Server :' + portMatch[1];
      return 'Dev Server';
    }

    if (lower.includes('expo start') || lower.includes('metro bundler')) {
      return 'Expo';
    }

    if (lower.includes('npm test') || lower.includes('jest') || lower.includes('vitest')) {
      return 'Tests';
    }

    if (lower.includes('npm install') || lower.includes('yarn add') || lower.includes('pip install')) {
      return 'Installing...';
    }

    // Detect git operations
    if (lower.includes('git push') || lower.includes('git pull') || lower.includes('git commit')) {
      return 'Git';
    }

    // Detect docker
    if (lower.includes('docker') && (lower.includes('build') || lower.includes('compose') || lower.includes('run'))) {
      return 'Docker';
    }

    // Detect SSH
    if (lower.includes('ssh ') && lower.includes('@')) {
      const hostMatch = buffer.match(/ssh\s+\S+@(\S+)/);
      if (hostMatch) return 'SSH: ' + hostMatch[1];
    }

    // Detect working directory from prompt (common shell prompts)
    const cwdMatch = buffer.match(/(?:^|\n)\s*(?:\w+@\w+:)?~?\/([^\s$#>]{3,25})/m);
    if (cwdMatch) {
      const dirName = cwdMatch[1].split('/').pop();
      if (dirName && dirName.length > 2) return dirName;
    }

    return null;
  }

  // Mark a terminal as user-renamed (stop auto-naming)
  markUserRenamed(id) {
    const term = this.terminals.get(id);
    if (term) {
      term._userRenamed = true;
    }
  }

  // ==========================================
  // Pane number badges
  // ==========================================
  updatePaneNumbers() {
    let index = 1;
    for (const [id, info] of this.allPanes) {
      let paneEl;
      if (info.type === 'terminal') {
        paneEl = this.terminals.get(id)?.pane;
      } else {
        paneEl = this.browserPanes.get(id)?.pane;
      }
      if (!paneEl) continue;

      let badge = paneEl.querySelector('.pane-number-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pane-number-badge';
        const header = paneEl.querySelector('.terminal-header, .browser-header, .expo-header');
        if (header) header.insertBefore(badge, header.firstChild);
      }
      badge.textContent = index;
      index++;
    }
  }
}

// Initialize app
new GridTermApp();
