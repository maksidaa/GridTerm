// ExpoPanePreview class - specialized browser pane for Expo app previews
const { BrowserPane } = require('./browser-pane.js');
const { QRGenerator } = require('../components/qr-generator.js');

class ExpoPanePreview extends BrowserPane {
  constructor(id, name, gridContainer, metroUrl, options = {}) {
    super(id, name, gridContainer, metroUrl);
    this.metroUrl = metroUrl;
    // Default to showing the actual preview, not the QR overlay
    this.showQR = options.showQR === true;
    this.showDeviceFrame = options.showDeviceFrame || false;
    this.localIp = options.localIp || null;
    this.projectInfo = options.projectInfo || {};
    this.isRunning = true;
    this.qrGenerated = false;
  }

  createPane() {
    this.pane = document.createElement('div');
    this.pane.className = 'browser-pane expo-pane pane';
    this.pane.id = this.id;
    this.pane.innerHTML = `
      <div class="browser-header expo-header pane-header">
        <div class="expo-top-row">
          <div class="expo-info">
            <span class="expo-icon">&#128241;</span>
            <input type="text" class="pane-name" value="${this.name}">
            <span class="expo-status ${this.isRunning ? 'online' : 'offline'}">${this.isRunning ? 'Running' : 'Stopped'}</span>
          </div>
          <div class="expo-controls">
            <button class="qr-toggle-btn ${this.showQR ? 'active' : ''}" title="Show QR Code">QR</button>
            <button class="device-frame-btn ${this.showDeviceFrame ? 'active' : ''}" title="Toggle Device Frame">Frame</button>
            <button class="nav-btn refresh-btn" title="Refresh">&#8635;</button>
          </div>
          <button class="expand-btn" title="Expand">&#10530;</button>
          <button class="close-btn" title="Close">&times;</button>
        </div>
        <div class="url-bar">
          <input type="text" class="url-input" value="${this.url}" placeholder="Metro URL...">
          <button class="go-btn">Go</button>
        </div>
      </div>
      <div class="browser-body expo-body">
        <div class="device-frame-wrapper ${this.showDeviceFrame ? '' : 'hidden'}">
          <div class="device-frame">
            <div class="device-notch"></div>
            <webview src="${this.url}" class="expo-webview browser-webview"></webview>
            <div class="device-home-bar"></div>
          </div>
        </div>
        <webview src="${this.url}" class="expo-webview-bare browser-webview ${this.showDeviceFrame ? 'hidden' : ''}"></webview>
        <div class="qr-overlay ${this.showQR ? '' : 'hidden'}">
          <div class="qr-container">
            <div class="qr-title">Scan with Expo Go</div>
            <canvas class="qr-canvas" width="200" height="200"></canvas>
            <div class="qr-url"></div>
            <div class="qr-instructions">Open Expo Go on your device and scan this code</div>
          </div>
        </div>
      </div>
    `;

    this.gridContainer.appendChild(this.pane);
    this.setupExpoEventListeners();
    this.initializeQRCode();
    return this.pane;
  }

  setupExpoEventListeners() {
    // Set up webview reference - use the visible one
    this.webview = this.pane.querySelector('.expo-webview-bare:not(.hidden)') ||
                   this.pane.querySelector('.expo-webview');

    const urlInput = this.pane.querySelector('.url-input');
    const goBtn = this.pane.querySelector('.go-btn');
    const refreshBtn = this.pane.querySelector('.refresh-btn');
    const qrToggleBtn = this.pane.querySelector('.qr-toggle-btn');
    const deviceFrameBtn = this.pane.querySelector('.device-frame-btn');

    // URL bar events
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.navigateTo(urlInput.value);
        this.updateQRCode();
      }
    });

    goBtn.addEventListener('click', () => {
      this.navigateTo(urlInput.value);
      this.updateQRCode();
    });

    refreshBtn.addEventListener('click', () => {
      if (this.webview.isLoading && this.webview.isLoading()) {
        this.webview.stop();
      } else {
        this.webview.reload();
      }
    });

    // QR toggle
    qrToggleBtn.addEventListener('click', () => {
      this.toggleQROverlay();
      qrToggleBtn.classList.toggle('active', this.showQR);
    });

    // Device frame toggle
    deviceFrameBtn.addEventListener('click', () => {
      this.toggleDeviceFrame();
      deviceFrameBtn.classList.toggle('active', this.showDeviceFrame);
    });

    // Webview events
    this.webview.addEventListener('did-start-loading', () => {
      refreshBtn.textContent = '\u2715';
    });

    this.webview.addEventListener('did-stop-loading', () => {
      refreshBtn.textContent = '\u21BB';
    });

    // Store button references
    this.expandBtn = this.pane.querySelector('.expand-btn');
    this.closeBtn = this.pane.querySelector('.close-btn');
  }

  async initializeQRCode() {
    // Get local IP if not provided
    if (!this.localIp) {
      try {
        this.localIp = await window.expo.getLocalIp();
      } catch (e) {
        console.error('Error getting local IP:', e);
        this.localIp = '192.168.1.1';
      }
    }

    if (this.showQR) {
      await this.generateQRCode();
    }
  }

  async generateQRCode() {
    const expUrl = this.getExpoUrl();
    const qrCanvas = this.pane.querySelector('.qr-canvas');
    const qrUrlDisplay = this.pane.querySelector('.qr-url');

    if (qrCanvas && expUrl) {
      const success = await QRGenerator.generate(expUrl, qrCanvas, { size: 200 });
      if (success) {
        this.qrGenerated = true;
        if (qrUrlDisplay) {
          qrUrlDisplay.textContent = expUrl;
        }
      }
    }
  }

  async updateQRCode() {
    if (this.showQR) {
      await this.generateQRCode();
    }
  }

  getExpoUrl() {
    // Convert localhost URL to exp:// format for Expo Go
    try {
      const url = new URL(this.url);
      const port = url.port || '8081';

      // Use the local IP address for the exp:// URL
      return `exp://${this.localIp}:${port}`;
    } catch (e) {
      // If URL parsing fails, try to extract port manually
      const portMatch = this.url.match(/:(\d+)/);
      const port = portMatch ? portMatch[1] : '8081';
      return `exp://${this.localIp}:${port}`;
    }
  }

  toggleQROverlay() {
    this.showQR = !this.showQR;
    const overlay = this.pane.querySelector('.qr-overlay');
    overlay.classList.toggle('hidden', !this.showQR);

    if (this.showQR && !this.qrGenerated) {
      this.generateQRCode();
    }
  }

  toggleDeviceFrame() {
    this.showDeviceFrame = !this.showDeviceFrame;
    const frameWrapper = this.pane.querySelector('.device-frame-wrapper');
    const bareWebview = this.pane.querySelector('.expo-webview-bare');

    frameWrapper.classList.toggle('hidden', !this.showDeviceFrame);
    bareWebview.classList.toggle('hidden', this.showDeviceFrame);

    // Update webview reference
    this.webview = this.showDeviceFrame
      ? this.pane.querySelector('.device-frame .expo-webview')
      : bareWebview;

    // Sync URLs
    const url = this.pane.querySelector('.url-input').value;
    this.webview.src = url;
  }

  setStatus(isRunning) {
    this.isRunning = isRunning;
    const statusEl = this.pane.querySelector('.expo-status');
    if (statusEl) {
      statusEl.className = `expo-status ${isRunning ? 'online' : 'offline'}`;
      statusEl.textContent = isRunning ? 'Running' : 'Stopped';
    }
  }

  navigateTo(url) {
    // Auto-add http if missing for localhost URLs
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.startsWith('localhost') || url.match(/^\d+\.\d+\.\d+\.\d+/)) {
        url = 'http://' + url;
      } else {
        url = 'https://' + url;
      }
    }

    this.url = url;
    this.metroUrl = url;

    // Update both webviews
    const webviews = this.pane.querySelectorAll('webview');
    webviews.forEach(wv => {
      wv.src = url;
    });
  }

  focus() {
    this.webview.focus();
  }

  destroy() {
    this.pane.remove();
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ExpoPanePreview };
}
