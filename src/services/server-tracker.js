// ServerTracker - Background service for monitoring dev servers
const net = require('net');
const http = require('http');
const { EventEmitter } = require('events');

class ServerTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.trackedServers = new Map();
    this.pollInterval = null;
    this.pollIntervalMs = options.pollInterval || 5000;

    // Common development server ports
    this.COMMON_PORTS = [
      3000, 3001, 3002, 3003,     // Common dev servers (React, Next.js, etc.)
      4000, 4200,                  // Angular
      5000, 5173, 5174,            // Vite, Flask
      8000, 8080, 8081, 8082,      // Web servers, Metro
      19000, 19001, 19002, 19006,  // Expo
    ];
  }

  start() {
    console.log('ServerTracker: Starting with poll interval', this.pollIntervalMs, 'ms');
    this.pollInterval = setInterval(() => this.scanPorts(), this.pollIntervalMs);
    this.scanPorts(); // Initial scan
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('ServerTracker: Stopped');
  }

  async scanPorts() {
    const results = [];

    for (const port of this.COMMON_PORTS) {
      try {
        const isOpen = await this.checkPort(port);
        if (isOpen) {
          const serverInfo = await this.identifyServer(port);
          results.push(serverInfo);
          this.handleServerFound(port, serverInfo);
        } else {
          this.handleServerLost(port);
        }
      } catch (e) {
        this.handleServerLost(port);
      }
    }

    return results;
  }

  checkPort(port) {
    return new Promise((resolve) => {
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

  async identifyServer(port) {
    const serverInfo = {
      port,
      type: 'unknown',
      url: `http://localhost:${port}`,
      detectedAt: new Date().toISOString()
    };

    try {
      const response = await this.httpGet(`http://127.0.0.1:${port}`, 2000);

      // Check response headers and content to identify server type
      const headers = response.headers || {};
      const body = response.body || '';

      // Expo/Metro detection
      if (body.includes('expo') || body.includes('metro') ||
          headers['x-react-native-project-root']) {
        serverInfo.type = 'expo';
        serverInfo.name = 'Expo/Metro Bundler';
      }
      // Next.js detection
      else if (headers['x-powered-by']?.includes('Next') ||
               body.includes('__NEXT_DATA__')) {
        serverInfo.type = 'nextjs';
        serverInfo.name = 'Next.js';
      }
      // Vite detection
      else if (body.includes('vite') || body.includes('@vite')) {
        serverInfo.type = 'vite';
        serverInfo.name = 'Vite';
      }
      // Create React App detection
      else if (body.includes('react') && body.includes('root')) {
        serverInfo.type = 'react';
        serverInfo.name = 'React App';
      }
      // Angular detection
      else if (body.includes('ng-app') || body.includes('angular')) {
        serverInfo.type = 'angular';
        serverInfo.name = 'Angular';
      }
      // Vue detection
      else if (body.includes('vue') || body.includes('__vue__')) {
        serverInfo.type = 'vue';
        serverInfo.name = 'Vue.js';
      }
      // Generic web server
      else {
        serverInfo.type = 'webserver';
        serverInfo.name = 'Web Server';
      }
    } catch (e) {
      // If HTTP request fails, it might still be a valid server
      // (e.g., WebSocket server, API that doesn't respond to GET /)
      serverInfo.type = 'unknown';
      serverInfo.name = 'Server';
    }

    return serverInfo;
  }

  httpGet(url, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body.substring(0, 5000) // Limit body size
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  handleServerFound(port, serverInfo) {
    const existing = this.trackedServers.get(port);
    if (!existing) {
      this.trackedServers.set(port, serverInfo);
      console.log(`ServerTracker: Found ${serverInfo.type} server on port ${port}`);
      this.emit('server:found', serverInfo);
    } else if (existing.type !== serverInfo.type) {
      // Server type changed (e.g., different app started on same port)
      this.trackedServers.set(port, serverInfo);
      this.emit('server:found', serverInfo);
    }
  }

  handleServerLost(port) {
    const existing = this.trackedServers.get(port);
    if (existing) {
      this.trackedServers.delete(port);
      console.log(`ServerTracker: Lost server on port ${port}`);
      this.emit('server:lost', { port, ...existing });
    }
  }

  getActiveServers() {
    return Array.from(this.trackedServers.values());
  }

  addCustomPort(port) {
    if (!this.COMMON_PORTS.includes(port)) {
      this.COMMON_PORTS.push(port);
    }
  }

  removeCustomPort(port) {
    const index = this.COMMON_PORTS.indexOf(port);
    if (index > -1) {
      this.COMMON_PORTS.splice(index, 1);
    }
  }
}

module.exports = { ServerTracker };
