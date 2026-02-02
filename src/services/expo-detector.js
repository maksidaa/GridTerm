// ExpoDetector - Specialized detection for Expo/Metro bundlers
const http = require('http');
const fs = require('fs');
const path = require('path');

class ExpoDetector {
  static EXPO_PORTS = [8081, 19000, 19001, 19002, 19006];

  static async detectExpoServers() {
    const servers = [];

    for (const port of this.EXPO_PORTS) {
      const info = await this.checkExpoPort(port);
      if (info) {
        servers.push(info);
      }
    }

    return servers;
  }

  static async checkExpoPort(port) {
    try {
      // Try to get Metro status endpoint
      const statusResponse = await this.httpGet(`http://localhost:${port}/status`, 2000);
      if (statusResponse) {
        try {
          const status = JSON.parse(statusResponse.body);
          return {
            port,
            type: 'expo',
            projectRoot: status.root || null,
            platforms: status.platforms || ['ios', 'android', 'web'],
            sdkVersion: status.sdkVersion,
            webUrl: `http://localhost:${port}`,
            expUrl: `exp://localhost:${port}`,
            bundlerStatus: status.packagerStatus || 'running'
          };
        } catch (e) {
          // Not valid JSON, but port is open
        }
      }

      // Fallback: Just check if port is responding
      const rootResponse = await this.httpGet(`http://localhost:${port}/`, 2000);
      if (rootResponse && (
          rootResponse.body.includes('expo') ||
          rootResponse.body.includes('metro') ||
          rootResponse.body.includes('React Native')
      )) {
        return {
          port,
          type: 'expo',
          webUrl: `http://localhost:${port}`,
          expUrl: `exp://localhost:${port}`
        };
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  static httpGet(url, timeout = 2000) {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body.substring(0, 5000)
          });
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  static async getProjectInfo(projectPath) {
    try {
      const appJsonPath = path.join(projectPath, 'app.json');
      const appConfigPath = path.join(projectPath, 'app.config.js');
      const packageJsonPath = path.join(projectPath, 'package.json');

      let appConfig = {};
      let packageConfig = {};

      // Try app.json first
      if (fs.existsSync(appJsonPath)) {
        const content = fs.readFileSync(appJsonPath, 'utf8');
        appConfig = JSON.parse(content);
      }
      // Try app.config.js (can't execute, but can check existence)
      else if (fs.existsSync(appConfigPath)) {
        // Just note that it exists - we'd need to run it to get config
        appConfig = { expo: { name: 'Expo App' } };
      }

      // Get package.json for additional info
      if (fs.existsSync(packageJsonPath)) {
        const content = fs.readFileSync(packageJsonPath, 'utf8');
        packageConfig = JSON.parse(content);
      }

      // Check for Expo SDK version in dependencies
      const expoVersion = packageConfig.dependencies?.expo ||
                          packageConfig.devDependencies?.expo;

      return {
        name: appConfig.expo?.name || appConfig.name || packageConfig.name || 'Unknown',
        slug: appConfig.expo?.slug,
        version: appConfig.expo?.version || packageConfig.version,
        sdkVersion: appConfig.expo?.sdkVersion,
        expoVersion: expoVersion,
        icon: appConfig.expo?.icon,
        platforms: appConfig.expo?.platforms || ['ios', 'android'],
        isExpoProject: !!(appConfig.expo || expoVersion)
      };
    } catch (e) {
      console.error('Error getting Expo project info:', e);
      return { name: 'Unknown Project', isExpoProject: false };
    }
  }

  static async scanDirectoryForExpoProjects(baseDir, maxDepth = 3) {
    const projects = [];

    const scan = (dir, depth) => {
      if (depth > maxDepth) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // Check if this directory is an Expo project
        const hasAppJson = entries.some(e => e.name === 'app.json');
        const hasExpoConfig = entries.some(e => e.name === 'app.config.js');

        if (hasAppJson || hasExpoConfig) {
          const info = this.getProjectInfoSync(dir);
          if (info.isExpoProject) {
            projects.push({
              path: dir,
              ...info
            });
          }
        }

        // Recurse into subdirectories
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === 'node_modules' || entry.name === '.git') continue;

          scan(path.join(dir, entry.name), depth + 1);
        }
      } catch (e) {
        // Permission denied or other error
      }
    };

    scan(baseDir, 0);
    return projects;
  }

  static getProjectInfoSync(projectPath) {
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

      const expoVersion = packageConfig.dependencies?.expo ||
                          packageConfig.devDependencies?.expo;

      return {
        name: appConfig.expo?.name || appConfig.name || packageConfig.name || path.basename(projectPath),
        slug: appConfig.expo?.slug,
        version: appConfig.expo?.version || packageConfig.version,
        sdkVersion: appConfig.expo?.sdkVersion,
        isExpoProject: !!(appConfig.expo || expoVersion)
      };
    } catch (e) {
      return { name: path.basename(projectPath), isExpoProject: false };
    }
  }
}

module.exports = { ExpoDetector };
