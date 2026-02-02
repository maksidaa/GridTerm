const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');
const { BrowserPane } = require('./panes/browser-pane.js');
const { ExpoPanePreview } = require('./panes/expo-pane.js');
const { ExpoDashboard } = require('./components/expo-dashboard.js');

// Default Claude commands
const DEFAULT_CLAUDE_COMMANDS = [
  { name: 'Status', command: '/status' },
  { name: 'Clear Context', command: '/clear' },
  { name: 'Compact Mode', command: '/compact' },
  { name: 'Help', command: '/help' },
  { name: 'Exit Claude', command: '/exit' },
  { name: 'Review PR', command: '/review-pr' },
  { name: 'Git Commit', command: '/commit' },
  { name: 'Run Tests', command: 'run the tests' },
  { name: 'Explain Code', command: 'explain this code' },
  { name: 'Find Bugs', command: 'find bugs in this code' },
];

// Available subagents for shortcuts dropdown
const SUBAGENTS = [
  { name: 'Explore', description: 'Fast codebase exploration', command: 'Use the Explore agent to ' },
  { name: 'Plan', description: 'Design implementation plans', command: 'Use the Plan agent to ' },
  { name: 'Bash', description: 'Command execution', command: 'Use the Bash agent to ' },
  { name: 'Ralph Loop', description: 'Autonomous task loop', command: '/ralph-loop', autoExec: true },
  { name: 'Cancel Ralph', description: 'Stop Ralph Loop', command: '/cancel-ralph', autoExec: true },
];

// Ralph Wizard prompt - helps users build proper Ralph Loop prompts
const RALPH_WIZARD_PROMPT = `Help me build a proper Ralph Loop prompt. Walk me through this step by step:

**STEP 1: What's the task?**
Ask me to describe what I want to build or accomplish in one sentence.

**STEP 2: Define Clear Completion Criteria**
Help me define specific, measurable success criteria. Guide me to include:
- Specific features/endpoints that must work
- Tests that must pass (with coverage targets if applicable)
- Documentation requirements
- Any other verifiable outcomes

**STEP 3: Break Into Incremental Phases**
Help me break the task into 2-4 phases, each with:
- Clear deliverable
- Tests for that phase
- Dependencies on previous phases

**STEP 4: Add Self-Correction Loop**
Add TDD-style instructions:
1. Write failing tests first
2. Implement to make tests pass
3. If tests fail, debug and fix
4. Refactor if needed
5. Repeat until green

**STEP 5: Add Escape Hatches**
Help me add fallback instructions for if the task gets stuck:
- What to document if blocked
- Alternative approaches to try
- When to stop and report

**STEP 6: Generate the Final Command**
Output the complete /ralph-loop command with:
- The full prompt in quotes
- --completion-promise with a clear trigger phrase
- --max-iterations (recommend 20-50 based on complexity)

Remember Ralph Philosophy:
- Iteration > Perfection
- Failures are data
- Persistence wins

Let's start! What do you want to build?`;

// Detailed subagent descriptions for reference panel
const SUBAGENT_INFO = {
  'Explore': {
    name: 'Explore Agent',
    description: 'Fast agent specialized for exploring codebases. Use for finding files by patterns, searching code for keywords, or answering questions about the codebase.',
    usage: 'Use when you need to quickly find files, search code, or understand codebase structure.',
    example: '"Use the Explore agent to find all API endpoints"'
  },
  'Plan': {
    name: 'Plan Agent',
    description: 'Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    usage: 'Use when you need to plan an implementation strategy before coding.',
    example: '"Use the Plan agent to design the authentication system"'
  },
  'Bash': {
    name: 'Bash Agent',
    description: 'Command execution specialist for running bash commands. Use for git operations, running scripts, installing dependencies, and other terminal tasks.',
    usage: 'Use for git, npm, docker, and other CLI operations.',
    example: '"Use the Bash agent to run the test suite"'
  },
  'general-purpose': {
    name: 'General Purpose Agent',
    description: 'Versatile agent for researching complex questions, searching for code, and executing multi-step tasks. Has access to all tools.',
    usage: 'Use for open-ended searches or tasks requiring multiple rounds of exploration.',
    example: '"Use the general-purpose agent to investigate this error"'
  }
};

class GridTermApp {
  constructor() {
    this.terminals = new Map();
    this.browserPanes = new Map();
    this.allPanes = new Map(); // Unified pane tracking: { type: 'terminal'|'browser'|'expo', pane: object }
    this.paneCounter = 0;
    this.terminalCounter = 0; // Keep for backwards compatibility
    this.commands = [];
    this.directories = [];
    this.loadedSubagents = [];
    this.libraryAgents = [];
    this.activeDropdown = null;
    this.modalMode = 'command'; // 'command' or 'directory'
    this.selectedModel = 'none';
    this.selectedPaneType = 'terminal'; // 'terminal', 'browser', or 'expo'
    this.sidebarVisible = true;
    this.currentProjectDir = null;
    this.activePaneId = null; // Track which pane is focused (replaces activeTerminalId)
    this.activeTerminalId = null; // Keep for backwards compatibility
    this.expoDashboard = null; // Expo dashboard instance

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

      // Load subagents from directory
      try {
        this.loadedSubagents = await window.subagents.load() || [];
      } catch (e) {
        console.error('Error loading subagents:', e);
        this.loadedSubagents = [];
      }

      // Load library agents
      await this.loadLibraryAgents();

      // Listen for library updates (from file watchers)
      window.library.onUpdated(() => {
        console.log('Library updated, refreshing...');
        this.loadLibraryAgents();
      });

      // Populate sidebar
      this.renderSidebar();

      // Set up IPC listeners
      window.terminal.onData((id, data) => {
        const term = this.terminals.get(id);
        if (term) {
          term.xterm.write(data);
        }
      });

      window.terminal.onExit((id) => {
        this.removeTerminal(id);
      });

      // Event listeners
      this.addButton.addEventListener('click', () => this.showLaunchModal());

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

    // Model selector buttons
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectModel(btn.dataset.model));
    });

    // Ralph Loop checkbox toggle
    document.getElementById('startup-ralph').addEventListener('change', (e) => {
      document.getElementById('ralph-options').classList.toggle('hidden', !e.target.checked);
    });

    // Ralph Wizard button (titlebar)
    document.getElementById('ralph-wizard-btn').addEventListener('click', () => {
      this.launchRalphWizard();
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      this.toggleSidebar();
    });

    // Sidebar Ralph Wizard button
    document.getElementById('sidebar-ralph-wizard').addEventListener('click', () => {
      this.launchRalphWizard();
    });

    // Sidebar add buttons
    document.getElementById('sidebar-add-dir').addEventListener('click', () => {
      this.showModal('directory');
    });

    document.getElementById('sidebar-add-cmd').addEventListener('click', () => {
      this.showModal('command');
    });

    // Import agents button
    document.getElementById('import-agents-btn').addEventListener('click', async () => {
      await this.importAgentsFromBrowse();
    });

    // Expo Dashboard button
    document.getElementById('open-expo-dashboard').addEventListener('click', () => {
      this.showExpoDashboard();
    });

    // Listen for server events to update sidebar
    this.setupServerEventListeners();

    // Collapsible sidebar sections
    document.querySelectorAll('.sidebar-header[data-section]').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.sidebar-section');
        section.classList.toggle('collapsed');
      });
    });

    // Directory selection in launch modal - load project subagents and auto-import to library
    this.launchDirSelect.addEventListener('change', async (e) => {
      const dirIndex = e.target.value;
      if (dirIndex !== '') {
        const dir = this.directories[parseInt(dirIndex)];
        if (dir) {
          await this.loadProjectSubagents(dir.path);
          // Auto-import to library
          try {
            const result = await window.library.importFromDir(dir.path);
            if (result && result.count > 0) {
              await this.loadLibraryAgents();
              console.log(`Auto-imported ${result.count} agent(s) to library`);
            }
          } catch (e) {
            console.error('Error auto-importing agents:', e);
          }
        }
      } else {
        this.projectSubagents = [];
        this.renderProjectSubagents();
      }
    });

    // Subagent selector
    document.getElementById('subagent-select').addEventListener('change', (e) => {
      const descEl = document.getElementById('subagent-description');
      const info = SUBAGENT_INFO[e.target.value];
      if (info) {
        descEl.innerHTML = `
          <div class="agent-name">${info.name}</div>
          <div>${info.description}</div>
          <div class="agent-use">💡 ${info.usage}</div>
          <div class="agent-use">📝 Example: ${info.example}</div>
        `;
      } else {
        descEl.innerHTML = '';
      }
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

    // Show launch modal on first launch
    this.showLaunchModal();
    } catch (err) {
      console.error('Error in init():', err);
    }
  }

  showLaunchModal() {
    console.log('showLaunchModal called, launchModal element:', this.launchModal);
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

    this.selectedModel = 'none';
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.model === 'none');
    });
    this.claudeOptions.classList.add('hidden');
    this.codexOptions.classList.add('hidden');

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
    document.getElementById('startup-ralph').checked = false;
    document.getElementById('ralph-options').classList.add('hidden');
    document.getElementById('ralph-prompt').value = '';
    document.getElementById('ralph-promise').value = '';
    document.getElementById('ralph-iterations').value = '50';
    document.getElementById('subagent-select').value = '';
    document.getElementById('subagent-description').innerHTML = '';

    this.launchModal.classList.remove('hidden');
  }

  launchRalphWizard() {
    if (this.terminals.size === 0) {
      alert('Please open a terminal with Claude first');
      return;
    }

    // Use active terminal or fall back to first terminal
    let targetId = this.activeTerminalId;
    if (!targetId || !this.terminals.has(targetId)) {
      targetId = this.terminals.keys().next().value;
    }

    const term = this.terminals.get(targetId);

    if (term) {
      // Send the Ralph Wizard prompt to Claude and auto-execute
      window.terminal.write(targetId, RALPH_WIZARD_PROMPT + '\n\n');
      term.xterm.focus();
    }
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    this.sidebar.classList.toggle('collapsed', !this.sidebarVisible);
    // Refit terminals after sidebar toggle
    setTimeout(() => this.fitAllTerminals(), 250);
  }

  renderSidebar() {
    // Render subagents
    const subagentsContainer = document.getElementById('sidebar-subagents');
    subagentsContainer.innerHTML = '';

    this.loadedSubagents.forEach(agent => {
      const item = document.createElement('div');
      item.className = 'sidebar-subagent';
      item.innerHTML = `
        <div class="subagent-name">
          <span>${agent.icon || '🔧'}</span>
          <span>${agent.name}</span>
        </div>
        <div class="subagent-desc">${agent.description}</div>
      `;
      item.addEventListener('click', () => {
        this.sendToActiveTerminal(agent.command, agent.autoExec);
      });
      subagentsContainer.appendChild(item);
    });

    // Render Claude commands
    const claudeContainer = document.getElementById('sidebar-claude-commands');
    claudeContainer.innerHTML = '';

    DEFAULT_CLAUDE_COMMANDS.forEach(cmd => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.innerHTML = `
        <span class="item-icon">🤖</span>
        <span class="item-name">${cmd.name}</span>
      `;
      item.addEventListener('click', () => {
        this.sendToActiveTerminal(cmd.command + '\n', false);
      });
      claudeContainer.appendChild(item);
    });

    // Render directories
    this.renderSidebarDirectories();

    // Render commands
    this.renderSidebarCommands();

    // Render library agents
    this.renderLibraryAgents();
  }

  renderSidebarDirectories() {
    const container = document.getElementById('sidebar-directories');
    container.innerHTML = '';

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

  async loadLibraryAgents() {
    try {
      this.libraryAgents = await window.library.loadAgents() || [];
      this.renderLibraryAgents();
      this.updateLibraryStats();
    } catch (e) {
      console.error('Error loading library agents:', e);
      this.libraryAgents = [];
    }
  }

  renderLibraryAgents() {
    const container = document.getElementById('sidebar-library-agents');
    container.innerHTML = '';

    if (this.libraryAgents.length === 0) {
      container.innerHTML = '<div class="sidebar-empty">No agents in library yet</div>';
      return;
    }

    this.libraryAgents.forEach(agent => {
      const item = document.createElement('div');
      item.className = 'sidebar-subagent library-agent';
      item.innerHTML = `
        <div class="subagent-name">
          <span>${agent.icon || '📚'}</span>
          <span>${agent.name}</span>
        </div>
        <div class="subagent-desc">${agent.description || 'No description'}</div>
        <div class="agent-source">From: ${agent._projectName || 'Unknown'}</div>
      `;
      item.addEventListener('click', () => {
        this.sendToActiveTerminal(agent.command, agent.autoExec);
      });
      container.appendChild(item);
    });
  }

  async updateLibraryStats() {
    try {
      const stats = await window.library.getStats();
      const statsEl = document.getElementById('library-stats');
      if (stats.totalAgents > 0) {
        statsEl.innerHTML = `<span class="stat-count">${stats.totalAgents} agents</span> from <span class="stat-count">${stats.projectCount} projects</span>`;
      } else {
        statsEl.innerHTML = '';
      }
    } catch (e) {
      console.error('Error getting library stats:', e);
    }
  }

  async importAgentsFromBrowse() {
    try {
      const result = await window.library.browseAndImport();
      if (result && result.count > 0) {
        await this.loadLibraryAgents();
        alert(`Imported ${result.count} agent(s) from ${result.dirPath}`);
      } else if (result) {
        alert('No agents found in the selected directory');
      }
    } catch (e) {
      console.error('Error importing agents:', e);
      alert('Error importing agents: ' + e.message);
    }
  }

  async loadProjectSubagents(dirPath) {
    this.currentProjectDir = dirPath;
    try {
      this.projectSubagents = await window.subagents.loadFromDir(dirPath) || [];
    } catch (e) {
      console.error('Error loading project subagents:', e);
      this.projectSubagents = [];
    }
    this.renderProjectSubagents();
  }

  renderProjectSubagents() {
    const container = document.getElementById('sidebar-project-subagents');
    container.innerHTML = '';

    if (this.projectSubagents.length === 0) {
      container.innerHTML = '<div class="sidebar-empty">No subagents found in project</div>';
      return;
    }

    this.projectSubagents.forEach(agent => {
      const item = document.createElement('div');
      item.className = 'sidebar-subagent project-agent';
      item.innerHTML = `
        <div class="subagent-name">
          <span>${agent.icon || '📂'}</span>
          <span>${agent.name}</span>
        </div>
        <div class="subagent-desc">${agent.description}</div>
      `;
      item.addEventListener('click', () => {
        this.sendToActiveTerminal(agent.command, agent.autoExec);
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
      term.xterm.focus();
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
    term.xterm.focus();
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
      const url = document.getElementById('expo-url').value.trim() || 'http://localhost:8081';
      const showQR = document.getElementById('expo-show-qr').checked;
      await this.createExpoPanePreview({
        name: name || 'Expo Preview',
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
        if (document.getElementById('startup-ralph').checked) {
          const prompt = document.getElementById('ralph-prompt').value.trim();
          const promise = document.getElementById('ralph-promise').value.trim();
          const iterations = document.getElementById('ralph-iterations').value.trim();

          let ralphCmd = '/ralph-loop';
          if (prompt) {
            ralphCmd += ` "${prompt.replace(/"/g, '\\"')}"`;
          }
          if (promise) {
            ralphCmd += ` --completion-promise "${promise}"`;
          }
          if (iterations) {
            ralphCmd += ` --max-iterations ${iterations}`;
          }
          startupCommands.push(ralphCmd);
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

  async createTerminal({ name, directory, aiCommand, startupCommands = [] }) {
    const id = `term-${++this.terminalCounter}`;
    const displayName = name || `Terminal ${this.terminalCounter}`;

    // Create pane HTML
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.id = id;
    pane.innerHTML = `
      <div class="terminal-header">
        <input type="text" class="terminal-name" placeholder="Terminal ${this.terminalCounter}" value="${displayName}">
        <div class="commands-wrapper">
          <button class="commands-btn">Shortcuts ▾</button>
          <div class="commands-dropdown hidden"></div>
        </div>
        <button class="expand-btn" title="Expand">⤢</button>
        <button class="close-btn" title="Close">×</button>
      </div>
      <div class="terminal-body"></div>
    `;

    this.gridContainer.appendChild(pane);

    // Set up terminal
    const termBody = pane.querySelector('.terminal-body');
    const xterm = new Terminal({
      fontSize: 13,
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

    // Store terminal info
    this.terminals.set(id, { xterm, fitAddon, pane });
    this.allPanes.set(id, { type: 'terminal', pane: { pane } });

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
    const expandBtn = pane.querySelector('.expand-btn');
    const closeBtn = pane.querySelector('.close-btn');

    commandsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown(dropdown, id);
    });

    expandBtn.addEventListener('click', () => {
      this.toggleExpand(id);
    });

    closeBtn.addEventListener('click', () => {
      this.closeTerminal(id);
    });

    // Click to focus terminal
    pane.addEventListener('click', () => {
      this.setActiveTerminal(id);
    });

    // Drag and drop for images/screenshots
    this.setupImageDragDrop(pane, termBody, id);

    // Set as active terminal
    this.setActiveTerminal(id);

    // Update grid and fit terminals
    this.updateGridLayout();

    // Fit after a short delay to ensure DOM is ready
    setTimeout(async () => {
      this.fitAllTerminals();
      xterm.focus();

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
      }
    }, 50);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    browserPane.closeBtn.addEventListener('click', () => {
      this.closeBrowserPane(id);
    });

    // Click to focus
    browserPane.pane.addEventListener('click', () => {
      this.setActivePaneId(id);
    });

    // Set as active pane
    this.setActivePaneId(id);

    // Update grid layout
    this.updateGridLayout();

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

    expoPane.closeBtn.addEventListener('click', () => {
      this.closeBrowserPane(id);
    });

    // Click to focus
    expoPane.pane.addEventListener('click', () => {
      this.setActivePaneId(id);
    });

    // Set as active pane
    this.setActivePaneId(id);

    // Update grid layout
    this.updateGridLayout();

    return expoPane;
  }

  closeBrowserPane(id) {
    const browserPane = this.browserPanes.get(id);
    if (browserPane) {
      browserPane.destroy();
      this.browserPanes.delete(id);
      this.allPanes.delete(id);
      this.updateGridLayout();
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
      return;
    }

    // Check if it's a browser pane
    const bp = this.browserPanes.get(id);
    if (bp) {
      bp.pane.classList.add('active-pane');
    }
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
      term.xterm.focus();
    }, 50);
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

    // Claude Commands section
    const claudeHeader = document.createElement('div');
    claudeHeader.className = 'dropdown-section-header';
    claudeHeader.textContent = 'Claude Commands';
    dropdown.appendChild(claudeHeader);

    DEFAULT_CLAUDE_COMMANDS.forEach((cmd) => {
      const item = document.createElement('div');
      item.className = 'command-item claude-cmd';
      item.innerHTML = `
        <span class="item-icon">🤖</span>
        <span class="command-name">${cmd.name}</span>
        <span class="command-text">${cmd.command}</span>
      `;

      item.addEventListener('click', () => {
        // Auto-execute Claude commands with newline
        this.pasteCommand(termId, cmd.command + '\n');
        dropdown.classList.add('hidden');
        this.activeDropdown = null;
      });

      dropdown.appendChild(item);
    });

    // Subagents section
    const agentHeader = document.createElement('div');
    agentHeader.className = 'dropdown-section-header';
    agentHeader.textContent = 'Subagents';
    dropdown.appendChild(agentHeader);

    SUBAGENTS.forEach((agent) => {
      const item = document.createElement('div');
      item.className = 'command-item subagent-item';
      const icon = agent.name.includes('Ralph') ? '🔄' : '🔧';
      item.innerHTML = `
        <span class="item-icon">${icon}</span>
        <span class="command-name">${agent.name}</span>
        <span class="command-text">${agent.description}</span>
      `;

      item.addEventListener('click', () => {
        // Auto-execute if flagged, otherwise just paste
        const cmd = agent.autoExec ? agent.command + '\n' : agent.command;
        this.pasteCommand(termId, cmd);
        dropdown.classList.add('hidden');
        this.activeDropdown = null;
      });

      dropdown.appendChild(item);
    });

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
      term.xterm.focus();
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

        // Sync the new directory's agents to library and global commands
        try {
          const result = await window.library.syncDirectory(value);
          if (result && result.count > 0) {
            console.log(`Auto-synced ${result.count} agents from ${name}`);
            await this.loadLibraryAgents();
          }
        } catch (e) {
          console.error('Error syncing new directory:', e);
        }
      } else {
        this.commands.push({ name, command: value });
        this.renderSidebarCommands();
      }
      await this.saveConfig();
      this.hideModal();
    }
  }

  async saveConfig() {
    await window.config.save({
      commands: this.commands,
      directories: this.directories
    });
  }

  async deleteCommand(index) {
    this.commands.splice(index, 1);
    await this.saveConfig();
  }

  async deleteDirectory(index) {
    this.directories.splice(index, 1);
    await this.saveConfig();
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
      this.updateGridLayout();
      this.fitAllTerminals();
    }

    // If no panes left, show launch modal
    if (this.allPanes.size === 0) {
      this.showLaunchModal();
    }
  }

  updateGridLayout() {
    // Count all panes (terminals + browser panes)
    const count = this.allPanes.size;

    // Remove old count classes
    this.gridContainer.className = 'count-' + Math.min(count, 9);
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
      const servers = await window.servers.getActive();
      const container = document.getElementById('running-expo-servers');

      if (!container) return;

      // Filter to show only Expo servers
      const expoServers = servers.filter(s => s.type === 'expo');

      if (expoServers.length === 0) {
        container.innerHTML = '<div class="sidebar-empty">No running Expo servers</div>';
        return;
      }

      container.innerHTML = '';
      for (const server of expoServers) {
        const item = document.createElement('div');
        item.className = 'running-server-item';
        item.innerHTML = `
          <span class="server-status"></span>
          <span class="server-name">${server.name || 'Expo'}</span>
          <span class="server-port">:${server.port}</span>
        `;
        item.addEventListener('click', () => {
          this.createExpoPanePreview({
            name: server.name || `Expo (${server.port})`,
            url: server.url,
            showQR: true
          });
        });
        container.appendChild(item);
      }
    } catch (e) {
      console.error('Error updating running servers list:', e);
    }
  }
}

// Initialize app
new GridTermApp();
