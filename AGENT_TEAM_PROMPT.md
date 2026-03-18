# GridTerm Modernization - Agent Team Prompt

Copy everything below the line and paste it into a Claude Code terminal with Agent Teams enabled.

---

You are the lead agent for modernizing GridTerm, a multi-terminal Electron app. The user is NOT a developer — they use Claude Code and Codex in terminals and that's it. Every improvement must be intuitive, self-explanatory, and guide the user. No feature should require reading docs or understanding code.

Create an agent team with 4 teammates to modernize GridTerm. Here are the roles:

## Teammate 1: "UI Polish Agent"
**Focus: Make GridTerm look and feel like a modern, premium app.**

Do these things:
- Increase font sizes for readability — sidebar labels to 13px, buttons to 13px, terminal font to 14px
- Add more breathing room: increase grid gap between panes to 6px, sidebar item padding to 10px, terminal body padding to 8px
- Improve contrast: make active pane border thicker (3px) and brighter, make sidebar text lighter (#ccc instead of #888)
- Add smooth animations: panes should fade in when created, sidebar sections should slide open/closed
- Add subtle hover effects on all clickable things so users know what they can interact with
- Style alert dialogs as proper in-app modals instead of ugly browser alerts
- Add a polished "empty state" when no terminals are open — show a welcome message with "Click + to get started" and a brief description of what GridTerm does
- Make the titlebar look cleaner with better spacing and a subtle bottom border
- Add focus ring styles for keyboard navigation (subtle blue glow around focused elements)
- Replace the plain "+" button with a nicer floating action button with a subtle shadow and hover animation

Files to modify: `src/styles.css`, `src/index.html`, `src/renderer.js`

## Teammate 2: "Navigation Agent"
**Focus: Make it effortless to move between terminals and find features.**

Do these things:
- Add keyboard shortcuts: Cmd+T (new terminal), Cmd+W (close active pane), Cmd+1/2/3/4/5/6/7/8/9 (switch to pane by number), Cmd+] and Cmd+[ (next/previous pane)
- Show pane numbers on each terminal header (small badge like "1", "2", "3") so users know which shortcut goes where
- Add a command palette (Cmd+K): a search popup that lets users quickly find and trigger any action — launch agents, run commands, switch directories, open settings. This is the single most important navigation feature.
- Add right-click context menus on terminal panes: Close, Minimize, Duplicate, Rename
- Add a "Quick Switch" dropdown to the titlebar showing all open panes with their names
- Show keyboard shortcut hints on sidebar buttons (small grey text like "⌘1" next to the button)
- Persist which sidebar sections are expanded/collapsed between app restarts
- When a terminal is minimized, show a small indicator in the sidebar with a "restore" button

Files to modify: `src/renderer.js`, `src/index.html`, `src/styles.css`, `main.js` (for native menu shortcuts)

## Teammate 3: "Quality of Life Agent"
**Focus: Add features that save the user time and prevent frustration.**

Do these things:
- Session save/restore: automatically save the current layout (which panes are open, their names, working directories, whether Claude/Codex is running) when the app closes, and restore it when the app opens. Add a "Restore Last Session" button to the welcome/empty state.
- Add a Settings panel (gear icon in titlebar) with these options:
  - Terminal font size (slider, 11-18px)
  - Terminal theme (Dark, Darker, Light — just 3 presets)
  - Grid gap size (Compact, Normal, Spacious)
  - Default AI model (None, Claude, Codex)
  - Auto-restore last session (on/off)
- Add "Duplicate Pane" — creates a new terminal with the same working directory and AI model
- Add tooltips on every button and feature in the app. Each tooltip should explain what the thing does in plain language (not technical jargon). Examples:
  - Ralph Wizard: "Helps you write a detailed task for Claude to work on in a loop"
  - Agent Teams: "Lets Claude split work across multiple agents working at the same time"
  - Skip Permissions: "Lets Claude make changes without asking for approval each time"
  - Compact Mode: "Reduces Claude's memory usage by summarizing old messages"
- When the user first opens the app (no saved session), show a brief 3-step onboarding overlay:
  1. "Welcome to GridTerm! Manage multiple Claude and Codex sessions in one place."
  2. "Click + to open a terminal. Choose Claude or Codex to start an AI session."
  3. "Use the sidebar to access agents, commands, and shortcuts. Press Cmd+K anytime to search."
- Add a notification when a terminal finishes a long-running task (terminal bell → show a badge on the pane header)

Files to modify: `src/renderer.js`, `src/index.html`, `src/styles.css`, `main.js` (for window state persistence), `preload.js` (for new IPC if needed)

## Teammate 4: "Testing Agent"
**Focus: Make sure everything works and nothing is broken.**

Do these things:
- After each teammate completes a batch of changes, review the modified files for:
  - Syntax errors in JavaScript, HTML, and CSS
  - Missing event listener cleanup
  - Broken references (DOM elements that don't exist, CSS classes that don't match)
  - Console errors when running the app
- Test these critical workflows by reading the code and tracing the logic:
  - Opening a new terminal with Claude + Agent Teams enabled
  - Using the Ralph Wizard and Agent Teams Wizard
  - Sidebar navigation and section toggling
  - Keyboard shortcuts don't conflict with terminal/Claude shortcuts
  - Settings save and load correctly
  - Session restore works after simulated close
- Fix any issues found immediately
- At the end, run `npm start` to verify the app launches without errors

Files to review: ALL modified files

## Coordination Rules

- UI Polish Agent and Navigation Agent can work in parallel — they touch different parts of the code
- Quality of Life Agent should start after UI Polish and Navigation are mostly done, since it builds on their changes (especially the titlebar for Settings and the empty state for onboarding)
- Testing Agent should do a review pass after each major batch of changes, and a final comprehensive pass at the end
- All agents: DO NOT add any new npm dependencies. Work with what's already installed (Electron, xterm.js, node-pty). Use vanilla JS, CSS, and HTML.
- All agents: Keep the code simple and readable. No over-engineering. This app should be easy to maintain.
- All agents: Every user-facing element needs a tooltip or label that explains what it does in plain English.

## Success Criteria

When the team is done, GridTerm should:
1. Look visually polished with good spacing, contrast, and modern feel
2. Have keyboard shortcuts for all common actions (new pane, close, switch)
3. Have a working Cmd+K command palette
4. Save and restore sessions automatically
5. Have a Settings panel with font size, theme, and preferences
6. Show helpful tooltips on every button and control
7. Show a welcoming onboarding for first-time users
8. Launch without errors via `npm start`

Start by exploring the full codebase to understand the current architecture, then begin working.
