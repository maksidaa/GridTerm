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
  { name: 'Agent Teams', description: 'Multi-agent team coordination', command: 'Create an agent team to ' },
];

// Ralph Wizard prompt - pure Ralph Loop (no agent teams)
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

// Ralph + Agent Teams combined wizard
const RALPH_TEAM_WIZARD_PROMPT = `Help me build a Ralph Loop prompt that uses Agent Teams to parallelize the work. Walk me through this step by step:

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

**STEP 6: Design the Agent Team**
Help me identify 2-5 specialized agent roles based on the task phases from Step 3.
For each role, define:
- Agent name (e.g., "API Agent", "Testing Agent", "Frontend Agent", "Documentation Agent")
- Specific responsibilities
- Which phases/deliverables this agent owns
- Dependencies on other agents' work

Suggest a coordination strategy:
- Which agent should be the orchestrator/lead
- Task ordering and dependency chains
- How agents should communicate results

Suggest a team pattern based on the task:
- "Builder + Tester" (2 agents: one builds, one writes and runs tests)
- "Full Stack" (3 agents: API/backend, frontend, tests)
- "Feature Teams" (N agents: one per feature or module)
- "Pipeline" (sequential handoff between specialists)

**STEP 7: Generate the Final Command**
Output the complete /ralph-loop command with:
- The full prompt in quotes
- --completion-promise with a clear trigger phrase
- --max-iterations (recommend 20-50 based on complexity)

Include in the generated prompt:
- Instructions for the lead agent to create an agent team
- Team role definitions (e.g., "Create an agent team with N teammates: [role1] handles [tasks], [role2] handles [tasks]...")
- Dependency ordering between agents
- Remind me to check "Enable Agent Teams" in the launch modal (sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)

Remember Ralph Philosophy:
- Iteration > Perfection
- Failures are data
- Persistence wins

Let's start! What do you want to build?`;

// Agent Teams Wizard prompt - standalone (no Ralph Loop)
const AGENT_TEAMS_WIZARD_PROMPT = `Help me set up an Agent Team for my current task. Walk me through this:

**STEP 1: What's the task?**
Ask me to describe the task I want to parallelize across multiple agents.

**STEP 2: Identify Team Roles**
Based on my task, suggest 2-5 specialized agent roles. For each:
- Role name (e.g., "API Agent", "Database Agent", "Testing Agent")
- Primary responsibilities
- Key deliverables

**STEP 3: Define Dependencies**
Help me map out:
- Which roles can work in parallel from the start
- Which roles depend on another agent's output
- The optimal execution order

**STEP 4: Choose a Team Pattern**
Suggest the best pattern for my task:
- "Builder + Tester" (2 agents: one implements, one writes and runs tests)
- "Full Stack" (3 agents: backend + frontend + tests)
- "Feature Teams" (N agents: one per feature or module)
- "Pipeline" (sequential handoff between specialists)
- Custom (help me define my own)

**STEP 5: Generate Team Instructions**
Output the natural language instructions I should give to Claude to create this team.
The output should be a complete prompt I can paste that includes:
- "Create an agent team with N teammates:"
- Each teammate's name, role, and specific tasks
- Dependency and ordering instructions
- Coordination rules (e.g., "Testing Agent should validate each feature as Builder Agent completes it")

Remind me:
- CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 must be enabled (check "Enable Agent Teams" in the GridTerm launch modal)
- Key controls: Shift+Up/Down to select teammates, Shift+Tab for delegate mode, Ctrl+T for task list

Let's start! What task do you want to distribute across an agent team?`;

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
    this.agentCustomNames = {}; // Custom display names for agents
    this.currentInfoAgent = null; // Currently displayed agent in info popup
    this.activeDropdown = null;
    this.modalMode = 'command'; // 'command' or 'directory'
    this.selectedModel = 'none';
    this.selectedPaneType = 'terminal'; // 'terminal', 'browser', or 'expo'
    this.appSettings = {};
    this.paletteSelectedIndex = 0;
    this.welcomeElement = null;
    this.gridLayout = 'auto'; // 'auto', '1', '4', '9'
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
      this.agentCustomNames = config.agentCustomNames || {};

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
          this.detectPaneContext(id, data);
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

    // Expo project scan button
    document.getElementById('scan-expo-projects').addEventListener('click', () => {
      this.populateExpoProjects();
    });

    // Model selector buttons
    document.querySelectorAll('.model-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectModel(btn.dataset.model));
    });

    // Ralph Loop checkbox toggle
    document.getElementById('startup-ralph').addEventListener('change', (e) => {
      document.getElementById('ralph-options').classList.toggle('hidden', !e.target.checked);
    });

    // Agent Teams checkbox toggle
    document.getElementById('enable-agent-teams').addEventListener('change', (e) => {
      document.getElementById('agent-teams-info').classList.toggle('hidden', !e.target.checked);
    });

    // Ralph Wizard button (titlebar)
    document.getElementById('ralph-wizard-btn').addEventListener('click', () => {
      this.launchRalphWizard();
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

    // Sidebar Ralph Wizard button
    document.getElementById('sidebar-ralph-wizard').addEventListener('click', () => {
      this.launchRalphWizard();
    });

    // Sidebar Ralph Team Wizard button
    document.getElementById('sidebar-ralph-team-wizard').addEventListener('click', () => {
      this.launchRalphTeamWizard();
    });

    // Sidebar Agent Teams Wizard button
    document.getElementById('sidebar-agent-teams-wizard').addEventListener('click', () => {
      this.launchAgentTeamsWizard();
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

    // Set up agent info popup
    this.setupAgentInfoPopup();

    // Set up command palette, keyboard shortcuts, context menu, settings
    this.setupCommandPalette();
    this.setupKeyboardShortcuts();
    this.setupContextMenu();
    this.setupSettings();

    // Load app settings
    this.appSettings = config.appSettings || {};
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

    // Show onboarding on first run, then launch modal
    if (!localStorage.getItem('gridterm-onboarded')) {
      this.showOnboarding();
    }
    this.showLaunchModal();
    this.showWelcomeState();
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
    document.getElementById('enable-agent-teams').checked = true;
    document.getElementById('agent-teams-info').classList.remove('hidden');

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

  launchRalphTeamWizard() {
    if (this.terminals.size === 0) {
      alert('Please open a terminal with Claude first');
      return;
    }

    let targetId = this.activeTerminalId;
    if (!targetId || !this.terminals.has(targetId)) {
      targetId = this.terminals.keys().next().value;
    }

    const term = this.terminals.get(targetId);

    if (term) {
      window.terminal.write(targetId, RALPH_TEAM_WIZARD_PROMPT + '\n\n');
      term.xterm.focus();
    }
  }

  launchAgentTeamsWizard() {
    if (this.terminals.size === 0) {
      alert('Please open a terminal with Claude first (with Agent Teams enabled)');
      return;
    }

    // Use active terminal or fall back to first terminal
    let targetId = this.activeTerminalId;
    if (!targetId || !this.terminals.has(targetId)) {
      targetId = this.terminals.keys().next().value;
    }

    const term = this.terminals.get(targetId);

    if (term) {
      // Send the Agent Teams Wizard prompt to Claude and auto-execute
      window.terminal.write(targetId, AGENT_TEAMS_WIZARD_PROMPT + '\n\n');
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
      const agentKey = `builtin:${agent.name}`;
      const displayName = this.agentCustomNames[agentKey] || agent.name;
      const item = document.createElement('div');
      item.className = 'sidebar-subagent-compact builtin-agent';
      item.innerHTML = `
        <span class="agent-icon">${agent.icon || '🔧'}</span>
        <span class="agent-name">${displayName}</span>
        <button class="agent-info-btn" title="Info">i</button>
      `;

      // Click on name area to use agent
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('agent-info-btn')) {
          this.sendToActiveTerminal(agent.command, agent.autoExec);
        }
      });

      // Click on info button to show popup
      item.querySelector('.agent-info-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAgentInfo(agent, 'builtin');
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
      const agentKey = `library:${agent.name}`;
      const displayName = this.agentCustomNames[agentKey] || agent.name;
      const item = document.createElement('div');
      item.className = 'sidebar-subagent-compact library-agent';
      item.innerHTML = `
        <span class="agent-icon">${agent.icon || '📚'}</span>
        <span class="agent-name">${displayName}</span>
        <button class="agent-info-btn" title="Info">i</button>
      `;

      // Click on name area to use agent
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('agent-info-btn')) {
          this.sendToActiveTerminal(agent.command, agent.autoExec);
        }
      });

      // Click on info button to show popup
      item.querySelector('.agent-info-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAgentInfo(agent, 'library');
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
      const agentKey = `project:${agent.name}`;
      const displayName = this.agentCustomNames[agentKey] || agent.name;
      const item = document.createElement('div');
      item.className = 'sidebar-subagent-compact project-agent';
      item.innerHTML = `
        <span class="agent-icon">${agent.icon || '📂'}</span>
        <span class="agent-name">${displayName}</span>
        <button class="agent-info-btn" title="Info">i</button>
      `;

      // Click on name area to use agent
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('agent-info-btn')) {
          this.sendToActiveTerminal(agent.command, agent.autoExec);
        }
      });

      // Click on info button to show popup
      item.querySelector('.agent-info-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAgentInfo(agent, 'project');
      });

      container.appendChild(item);
    });
  }

  showAgentInfo(agent, agentType) {
    this.currentInfoAgent = { agent, type: agentType };
    const agentKey = `${agentType}:${agent.name}`;
    const displayName = this.agentCustomNames[agentKey] || agent.name;

    const popup = document.getElementById('agent-info-popup');
    document.getElementById('agent-info-icon').textContent = agent.icon || '🔧';
    document.getElementById('agent-info-name').value = displayName;
    document.getElementById('agent-info-description').textContent = agent.description || 'No description';
    document.getElementById('agent-info-command').textContent = agent.command || '';

    // Show/hide optional fields
    const usageField = document.getElementById('agent-info-usage-field');
    const exampleField = document.getElementById('agent-info-example-field');
    const sourceField = document.getElementById('agent-info-source-field');

    if (agent.usage) {
      usageField.style.display = 'block';
      document.getElementById('agent-info-usage').textContent = agent.usage;
    } else {
      usageField.style.display = 'none';
    }

    if (agent.example) {
      exampleField.style.display = 'block';
      document.getElementById('agent-info-example').textContent = agent.example;
    } else {
      exampleField.style.display = 'none';
    }

    const sourceName = agent._projectName || agent._sourceProject || agent._source || '';
    if (sourceName) {
      sourceField.style.display = 'block';
      document.getElementById('agent-info-source').textContent = sourceName;
    } else {
      sourceField.style.display = 'none';
    }

    popup.classList.remove('hidden');
  }

  hideAgentInfo() {
    document.getElementById('agent-info-popup').classList.add('hidden');
    this.currentInfoAgent = null;
  }

  async saveAgentName() {
    if (!this.currentInfoAgent) return;

    const { agent, type } = this.currentInfoAgent;
    const agentKey = `${type}:${agent.name}`;
    const newName = document.getElementById('agent-info-name').value.trim();

    if (newName && newName !== agent.name) {
      this.agentCustomNames[agentKey] = newName;
    } else {
      delete this.agentCustomNames[agentKey];
    }

    await this.saveConfig();

    // Re-render the appropriate list
    if (type === 'builtin') {
      this.renderSidebar();
    } else if (type === 'library') {
      this.renderLibraryAgents();
    } else if (type === 'project') {
      this.renderProjectSubagents();
    }
  }

  useAgentFromPopup() {
    if (!this.currentInfoAgent) return;
    const { agent } = this.currentInfoAgent;
    this.sendToActiveTerminal(agent.command, agent.autoExec);
    this.hideAgentInfo();
  }

  setupAgentInfoPopup() {
    const popup = document.getElementById('agent-info-popup');
    const closeBtn = document.getElementById('agent-info-close');
    const useBtn = document.getElementById('agent-info-use');
    const nameInput = document.getElementById('agent-info-name');

    // Close on X button
    closeBtn.addEventListener('click', () => this.hideAgentInfo());

    // Close on backdrop click
    popup.addEventListener('click', (e) => {
      if (e.target === popup) this.hideAgentInfo();
    });

    // Use agent button
    useBtn.addEventListener('click', () => this.useAgentFromPopup());

    // Save name on blur or enter
    nameInput.addEventListener('blur', () => this.saveAgentName());
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popup.classList.contains('hidden')) {
        this.hideAgentInfo();
      }
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
        // Prepend Agent Teams env var if enabled
        if (document.getElementById('enable-agent-teams').checked) {
          aiCommand = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude';
        } else {
          aiCommand = 'claude';
        }
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

  async createTerminal({ name, directory, aiCommand, startupCommands = [], autoMinimize = false }) {
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
    const minimizeBtn = pane.querySelector('.minimize-btn');
    const expandBtn = pane.querySelector('.expand-btn');
    const closeBtn = pane.querySelector('.close-btn');

    commandsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown(dropdown, id);
    });

    minimizeBtn.addEventListener('click', () => {
      this.toggleMinimize(id);
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
        term.xterm.focus();
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
      directories: this.directories,
      agentCustomNames: this.agentCustomNames,
      appSettings: this.appSettings
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
    actions.push({ icon: '⚙', label: 'Settings', hint: 'Font size, theme, preferences', action: () => this.showSettings(), category: 'Actions' });
    actions.push({ icon: '✨', label: 'Ralph Wizard', hint: 'Build a Ralph Loop task prompt', action: () => { this.hideCommandPalette(); this.launchRalphWizard(); }, category: 'Actions' });
    actions.push({ icon: '✨', label: 'Ralph + Teams', hint: 'Ralph Loop with parallel agent teams', action: () => { this.hideCommandPalette(); this.launchRalphTeamWizard(); }, category: 'Actions' });
    actions.push({ icon: '👥', label: 'Agent Teams', hint: 'Set up agent team without Ralph Loop', action: () => { this.hideCommandPalette(); this.launchAgentTeamsWizard(); }, category: 'Actions' });

    // Open panes
    let paneIndex = 1;
    for (const [id, term] of this.terminals) {
      const name = term.pane.querySelector('.terminal-name')?.value || `Terminal ${paneIndex}`;
      actions.push({ icon: '💻', label: name, hint: `Switch to pane`, shortcut: paneIndex <= 9 ? `⌘${paneIndex}` : '', action: () => { this.setActiveTerminal(id); term.xterm.focus(); }, category: 'Panes' });
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

    // Claude commands
    DEFAULT_CLAUDE_COMMANDS.forEach(cmd => {
      actions.push({ icon: '🤖', label: cmd.name, hint: cmd.command, action: () => { this.hideCommandPalette(); this.sendToActiveTerminal(cmd.command + '\n', false); }, category: 'Claude' });
    });

    // Subagents
    SUBAGENTS.forEach(agent => {
      actions.push({ icon: '🔧', label: agent.name, hint: agent.description, action: () => { this.hideCommandPalette(); this.sendToActiveTerminal(agent.command, agent.autoExec); }, category: 'Agents' });
    });

    return actions;
  }

  renderPaletteResults(query) {
    const container = document.getElementById('command-palette-results');
    const actions = this.getPaletteActions();
    const q = query.toLowerCase().trim();

    const filtered = q ? actions.filter(a => a.label.toLowerCase().includes(q) || (a.hint && a.hint.toLowerCase().includes(q))) : actions;

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
        ${item.shortcut ? `<span class="palette-shortcut">${item.shortcut}</span>` : ''}
      `;
      el.addEventListener('click', () => {
        this.hideCommandPalette();
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

      // Cmd+W - Close active pane
      if (isMeta && e.key === 'w') {
        e.preventDefault();
        if (this.activeTerminalId && this.terminals.has(this.activeTerminalId)) {
          this.closeTerminal(this.activeTerminalId);
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
        const paneIds = Array.from(this.terminals.keys());
        if (paneNum <= paneIds.length) {
          const id = paneIds[paneNum - 1];
          this.setActiveTerminal(id);
          this.terminals.get(id)?.xterm.focus();
        }
        return;
      }

      // Cmd+, - Settings
      if (isMeta && e.key === ',') {
        e.preventDefault();
        this.showSettings();
        return;
      }
    });
  }

  switchPane(direction) {
    const paneIds = Array.from(this.terminals.keys());
    if (paneIds.length === 0) return;

    const currentIndex = paneIds.indexOf(this.activeTerminalId);
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = paneIds.length - 1;
    if (nextIndex >= paneIds.length) nextIndex = 0;

    const nextId = paneIds[nextIndex];
    this.setActiveTerminal(nextId);
    this.terminals.get(nextId)?.xterm.focus();
  }

  // ==========================================
  // Context Menu
  // ==========================================
  setupContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      const pane = e.target.closest('.terminal-pane');
      if (!pane) {
        this.hideContextMenu();
        return;
      }

      e.preventDefault();
      const termId = pane.id;

      const menu = document.getElementById('context-menu');
      menu.innerHTML = `
        <div class="context-menu-item" data-action="rename"><span class="ctx-icon">✏️</span>Rename<span class="ctx-shortcut"></span></div>
        <div class="context-menu-item" data-action="duplicate"><span class="ctx-icon">📋</span>Duplicate Pane<span class="ctx-shortcut"></span></div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="minimize"><span class="ctx-icon">─</span>Minimize<span class="ctx-shortcut"></span></div>
        <div class="context-menu-item" data-action="expand"><span class="ctx-icon">⤢</span>Expand<span class="ctx-shortcut"></span></div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="close" style="color:#f85149;"><span class="ctx-icon">✕</span>Close<span class="ctx-shortcut">⌘W</span></div>
      `;

      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      menu.classList.remove('hidden');

      menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          this.hideContextMenu();
          const action = item.dataset.action;
          if (action === 'close') this.closeTerminal(termId);
          else if (action === 'minimize') this.toggleMinimize(termId);
          else if (action === 'expand') this.toggleExpand(termId);
          else if (action === 'rename') pane.querySelector('.terminal-name')?.focus();
          else if (action === 'duplicate') this.duplicatePane(termId);
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

  async duplicatePane(termId) {
    const term = this.terminals.get(termId);
    if (!term) return;
    const name = term.pane.querySelector('.terminal-name')?.value || '';
    await this.createTerminal({ name: name + ' (copy)' });
  }

  // ==========================================
  // Settings
  // ==========================================
  showSettings() {
    const modal = document.getElementById('settings-modal');
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

    // Save to config
    await window.config.save({
      commands: this.commands,
      directories: this.directories,
      agentCustomNames: this.agentCustomNames,
      appSettings: this.appSettings
    });

    this.hideSettings();
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

    const nextHandler = () => {
      currentStep++;
      if (currentStep >= steps.length) {
        overlay.classList.add('hidden');
        document.getElementById('onboarding-next').removeEventListener('click', nextHandler);
        localStorage.setItem('gridterm-onboarded', '1');
      } else {
        renderStep();
      }
    };

    document.getElementById('onboarding-next').addEventListener('click', nextHandler);
    document.getElementById('onboarding-skip').addEventListener('click', () => {
      overlay.classList.add('hidden');
      localStorage.setItem('gridterm-onboarded', '1');
    });
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

    // Initialize buffer for this terminal
    if (!term._contextBuffer) {
      term._contextBuffer = '';
      term._userRenamed = false;
      term._lastAutoName = '';
    }

    // If user manually renamed, don't auto-rename
    if (term._userRenamed) return;

    // Strip ANSI escape codes for pattern matching
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    term._contextBuffer += clean;

    // Keep buffer manageable (last 2000 chars)
    if (term._contextBuffer.length > 2000) {
      term._contextBuffer = term._contextBuffer.slice(-2000);
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
    const lower = buffer.toLowerCase();

    // Detect Claude session with task context
    // Look for Claude's task description or what it's working on
    const claudeTaskMatch = buffer.match(/(?:working on|implementing|building|creating|fixing|updating|refactoring|adding)\s+(.{10,60}?)(?:\.|,|\n|$)/i);
    if (claudeTaskMatch && lower.includes('claude')) {
      let task = claudeTaskMatch[1].trim();
      // Clean up and truncate
      task = task.replace(/[`"']/g, '').replace(/\s+/g, ' ');
      if (task.length > 35) task = task.substring(0, 35) + '...';
      return 'Claude: ' + task;
    }

    // Detect Ralph Loop
    if (lower.includes('ralph loop') || lower.includes('/ralph-loop')) {
      const promptMatch = buffer.match(/ralph-loop\s+"([^"]{5,40})/i);
      if (promptMatch) return 'Ralph: ' + promptMatch[1];
      return 'Ralph Loop';
    }

    // Detect Agent Teams
    if (lower.includes('agent team') || lower.includes('teammate')) {
      return 'Agent Team';
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
    for (const [id, term] of this.terminals) {
      let badge = term.pane.querySelector('.pane-number-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pane-number-badge';
        const header = term.pane.querySelector('.terminal-header');
        header.insertBefore(badge, header.firstChild);
      }
      badge.textContent = index;
      index++;
    }
  }
}

// Initialize app
new GridTermApp();
