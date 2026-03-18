// BrowserPane class - creates webview-based browser panes

class BrowserPane {
  constructor(id, name, gridContainer, initialUrl = 'about:blank') {
    this.id = id;
    this.name = name;
    this.gridContainer = gridContainer;
    this.url = initialUrl;
    this.webview = null;
    this.pane = null;
    this.isMaximized = false;
  }

  createPane() {
    this.pane = document.createElement('div');
    this.pane.className = 'browser-pane pane';
    this.pane.id = this.id;

    // Build the pane structure with a compact single-row header
    this.pane.innerHTML = `
      <div class="browser-header pane-header">
        <input type="text" class="pane-name" value="${this.name}">
        <div class="nav-controls">
          <button class="nav-btn back-btn" disabled title="Back">&#8592;</button>
          <button class="nav-btn forward-btn" disabled title="Forward">&#8594;</button>
          <button class="nav-btn refresh-btn" title="Refresh">&#8635;</button>
        </div>
        <div class="url-bar">
          <input type="text" class="url-input" value="${this.url}" placeholder="Enter URL...">
          <button class="go-btn">Go</button>
        </div>
        <button class="expand-btn" title="Expand">&#10530;</button>
        <button class="close-btn" title="Close">&times;</button>
      </div>
      <div class="browser-body">
        <webview src="${this.url}" class="browser-webview"></webview>
      </div>
    `;

    this.gridContainer.appendChild(this.pane);
    this.setupEventListeners();
    return this.pane;
  }

  setupEventListeners() {
    this.webview = this.pane.querySelector('webview');
    const urlInput = this.pane.querySelector('.url-input');
    const goBtn = this.pane.querySelector('.go-btn');
    const backBtn = this.pane.querySelector('.back-btn');
    const forwardBtn = this.pane.querySelector('.forward-btn');
    const refreshBtn = this.pane.querySelector('.refresh-btn');
    const expandBtn = this.pane.querySelector('.expand-btn');
    const closeBtn = this.pane.querySelector('.close-btn');

    // Navigation events from webview
    this.webview.addEventListener('did-navigate', (e) => {
      this.updateUrlBar(e.url);
      this.updateNavButtons();
    });

    this.webview.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        this.updateUrlBar(e.url);
        this.updateNavButtons();
      }
    });

    this.webview.addEventListener('did-start-loading', () => {
      refreshBtn.textContent = '\u2715'; // X symbol
      refreshBtn.title = 'Stop';
    });

    this.webview.addEventListener('did-stop-loading', () => {
      refreshBtn.textContent = '\u21BB'; // Refresh symbol
      refreshBtn.title = 'Refresh';
      this.updateNavButtons();
    });

    this.webview.addEventListener('page-title-updated', (e) => {
      const nameInput = this.pane.querySelector('.pane-name');
      if (nameInput.value === this.name || nameInput.value === 'Browser') {
        nameInput.value = e.title.substring(0, 30);
      }
    });

    // URL bar submission
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(urlInput.value);
      }
    });

    goBtn.addEventListener('click', () => {
      this.navigateTo(urlInput.value);
    });

    // Navigation buttons
    backBtn.addEventListener('click', () => {
      if (this.webview.canGoBack()) {
        this.webview.goBack();
      }
    });

    forwardBtn.addEventListener('click', () => {
      if (this.webview.canGoForward()) {
        this.webview.goForward();
      }
    });

    refreshBtn.addEventListener('click', () => {
      if (this.webview.isLoading()) {
        this.webview.stop();
      } else {
        this.webview.reload();
      }
    });

    // Handle webview crashes - automatically reload
    this.webview.addEventListener('did-fail-load', (e) => {
      console.log('Webview failed to load:', e.errorCode, e.errorDescription);
    });

    this.webview.addEventListener('crashed', () => {
      console.log('Webview crashed, reloading...');
      setTimeout(() => {
        this.webview.reload();
      }, 500);
    });

    this.webview.addEventListener('unresponsive', () => {
      console.log('Webview unresponsive, reloading...');
      setTimeout(() => {
        this.webview.reload();
      }, 500);
    });

    this.webview.addEventListener('responsive', () => {
      console.log('Webview responsive again');
    });

    // Expand/close buttons are handled by parent app
    // Store references for external use
    this.expandBtn = expandBtn;
    this.closeBtn = closeBtn;
  }

  navigateTo(url) {
    // Auto-add protocol if missing
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
      // Check if it looks like a URL (has a dot)
      if (url.includes('.')) {
        url = 'https://' + url;
      } else {
        // Treat as search query
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    this.webview.src = url;
    this.url = url;
  }

  updateUrlBar(url) {
    const urlInput = this.pane.querySelector('.url-input');
    urlInput.value = url;
    this.url = url;
  }

  updateNavButtons() {
    const backBtn = this.pane.querySelector('.back-btn');
    const forwardBtn = this.pane.querySelector('.forward-btn');

    // Small delay to let webview state update
    setTimeout(() => {
      backBtn.disabled = !this.webview.canGoBack();
      forwardBtn.disabled = !this.webview.canGoForward();
    }, 100);
  }

  focus() {
    this.webview.focus();
  }

  toggleExpand() {
    this.isMaximized = !this.isMaximized;
    this.pane.classList.toggle('maximized', this.isMaximized);
    this.expandBtn.innerHTML = this.isMaximized ? '&#10529;' : '&#10530;';
    this.expandBtn.title = this.isMaximized ? 'Collapse' : 'Expand';
  }

  destroy() {
    this.pane.remove();
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BrowserPane };
}
