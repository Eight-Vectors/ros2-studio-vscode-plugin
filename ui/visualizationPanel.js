const vscode = require("vscode");

class VisualizationPanel {
  static currentPanels = new Map();
  static viewType = "rosVisualization";
  static pendingPanels = new Map();

  constructor(panel, extensionUri, topicName, messageType, viewMode) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._topicName = topicName;
    this._messageType = messageType;
    this._viewMode = viewMode;
    this._disposables = [];
    this._rawData = null;

    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
          case "changeViewMode":
            this._viewMode = message.viewMode;
            this.updateView();
            return;
        }
      },
      null,
      this._disposables
    );
  }

  static async createOrShow(extensionUri, topicName, messageType, initialData) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const detectedType = VisualizationPanel.detectMessageType(
      messageType,
      initialData
    );
    const panelKey = `${topicName}_${messageType}`;

    // Check if panel is already being created
    if (VisualizationPanel.pendingPanels.has(panelKey)) {
      return VisualizationPanel.pendingPanels.get(panelKey);
    }

    // Check if panel already exists
    if (VisualizationPanel.currentPanels.has(panelKey)) {
      const existingPanel = VisualizationPanel.currentPanels.get(panelKey);
      // Check if the panel is still valid (not disposed)
      try {
        existingPanel._panel.reveal(column);
        if (initialData) {
          existingPanel.updateData(initialData);
        }
        return existingPanel;
      } catch (e) {
        // Panel was disposed but not properly cleaned up, remove it
        VisualizationPanel.currentPanels.delete(panelKey);
      }
    }

    // Create promise for panel creation
    const panelPromise = (async () => {
      // Always prompt for view mode for each new topic
      const viewMode = await VisualizationPanel.promptViewMode(
        detectedType,
        topicName
      );
      if (!viewMode) {
        VisualizationPanel.pendingPanels.delete(panelKey);
        return null;
      }

      const panel = vscode.window.createWebviewPanel(
        VisualizationPanel.viewType,
        `ROS Visualization: ${topicName}`,
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      const visualizationPanel = new VisualizationPanel(
        panel,
        extensionUri,
        topicName,
        detectedType,
        viewMode
      );

      VisualizationPanel.currentPanels.set(panelKey, visualizationPanel);
      VisualizationPanel.pendingPanels.delete(panelKey);

      if (initialData) {
        visualizationPanel.updateData(initialData);
      }

      return visualizationPanel;
    })();

    VisualizationPanel.pendingPanels.set(panelKey, panelPromise);
    return panelPromise;
  }

  static detectMessageType(messageType, data) {
    if (
      messageType.includes("OccupancyGrid") ||
      (data && data.info && data.data && data.info.width && data.info.height)
    ) {
      return "OccupancyGrid";
    }

    if (
      messageType.includes("LaserScan") ||
      messageType.includes("sensor_msgs/LaserScan") ||
      (data &&
        data.ranges &&
        data.angle_min !== undefined &&
        data.angle_max !== undefined)
    ) {
      return "LaserScan";
    }

    if (
      messageType.includes("String") &&
      data &&
      typeof data.data === "string"
    ) {
      try {
        if (data.data.includes("<robot") && data.data.includes("</robot>")) {
          return "URDF";
        }
      } catch (e) {}
    }

    return messageType;
  }

  static async promptViewMode(messageType, topicName) {
    // Create human-friendly message based on message type
    let detectedMessage = "";
    switch (messageType) {
      case "OccupancyGrid":
        detectedMessage = "an occupancy grid map";
        break;
      case "LaserScan":
        detectedMessage = "laser scan data";
        break;
      case "URDF":
        detectedMessage = "a robot model (URDF)";
        break;
      default:
        detectedMessage = `${messageType} data`;
    }

    const options = [
      {
        label: "📊 Graphical View",
        value: "graphical",
        description: "Display as an interactive visualization",
      },
      {
        label: "📄 Raw Data",
        value: "raw",
        description: "Show the raw JSON data",
      },
      {
        label: "🔀 Both",
        value: "both",
        description: "Show graphic and raw data side by side",
      },
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: `I've detected ${detectedMessage} on ${topicName}. How would you like to display it?`,
      canPickMany: false,
      ignoreFocusOut: true,
    });

    return selected ? selected.value : null;
  }

  updateData(data) {
    this._rawData = data;

    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage({
        command: "updateData",
        data: data,
        messageType: this._messageType,
        viewMode: this._viewMode,
      });
    }
  }

  updateView() {
    if (this._rawData) {
      this.updateData(this._rawData);
    }
  }

  dispose() {
    const panelKey = `${this._topicName}_${this._messageType}`;
    VisualizationPanel.currentPanels.delete(panelKey);
    VisualizationPanel.pendingPanels.delete(panelKey);

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  _getHtmlForWebview() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>ROS Visualization: ${this._topicName}</title>
      <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
      <style>
        body { 
          margin: 0;
          padding: 0;
          background-color: #1e1e1e;
          color: #cccccc;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: hidden;
        }
        .container {
          display: flex;
          height: 100vh;
          position: relative;
        }
        .visualization-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: #252526;
          border-right: 1px solid #464647;
        }
        .raw-data-panel {
          flex: 1;
          overflow: auto;
          background-color: #1e1e1e;
          padding: 10px;
        }
        .header {
          padding: 10px;
          background-color: #2d2d30;
          border-bottom: 1px solid #464647;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .title {
          font-weight: 500;
          font-size: 14px;
        }
        .view-mode-selector {
          display: flex;
          gap: 5px;
        }
        .view-mode-btn {
          padding: 4px 8px;
          background-color: #3c3c3c;
          border: 1px solid #464647;
          color: #cccccc;
          cursor: pointer;
          font-size: 12px;
          border-radius: 3px;
        }
        .view-mode-btn:hover {
          background-color: #484848;
        }
        .view-mode-btn.active {
          background-color: #007acc;
          border-color: #007acc;
        }
        #canvas {
          background-color: #0d0d0d;
          margin: 10px;
          border: 1px solid #333333;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
          display: block;
        }
        #raw-data {
          white-space: pre-wrap;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.5;
        }
        .full-width {
          width: 100% !important;
        }
        #canvasContainer {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: auto;
        }
        .hidden {
          display: none !important;
        }
        .error {
          color: #f48771;
          padding: 20px;
          text-align: center;
        }
        .info {
          color: #3794ff;
          padding: 10px;
          font-size: 12px;
          background-color: #1e1e1e;
          border-top: 1px solid #464647;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="visualization-panel" id="visualizationPanel">
          <div class="header">
            <div class="title">Topic: ${this._topicName} (${
      this._messageType
    })</div>
            <div class="view-mode-selector">
              <button class="view-mode-btn ${
                this._viewMode === "graphical" ? "active" : ""
              }" 
                      onclick="changeViewMode('graphical')">Graphical</button>
              <button class="view-mode-btn ${
                this._viewMode === "raw" ? "active" : ""
              }" 
                      onclick="changeViewMode('raw')">Raw Data</button>
              <button class="view-mode-btn ${
                this._viewMode === "both" ? "active" : ""
              }" 
                      onclick="changeViewMode('both')">Both</button>
            </div>
          </div>
          <div id="canvasContainer">
            <canvas id="canvas"></canvas>
          </div>
          <div class="info" id="info"></div>
        </div>
        <div class="raw-data-panel ${
          this._viewMode !== "both" ? "hidden" : ""
        }" id="rawDataPanel">
          <div class="header">
            <div class="title">Raw Data</div>
            <button id="copyRawButton" style="
              padding: 4px 12px;
              background-color: #3c3c3c;
              border: 1px solid #464647;
              color: #cccccc;
              cursor: pointer;
              font-size: 12px;
              border-radius: 3px;
            " onmouseover="this.style.backgroundColor='#484848'" 
               onmouseout="this.style.backgroundColor='#3c3c3c'">Copy</button>
          </div>
          <pre id="raw-data"></pre>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        let currentData = null;
        let currentMessageType = '${this._messageType}';
        let currentViewMode = '${this._viewMode}';
        function changeViewMode(mode) {
          currentViewMode = mode;
          updateViewMode();
          vscode.postMessage({
            command: 'changeViewMode',
            viewMode: mode
          });
        }
        function updateViewMode() {
          const buttons = document.querySelectorAll('.view-mode-btn');
          buttons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent.toLowerCase() === currentViewMode || 
                (btn.textContent === 'Both' && currentViewMode === 'both') ||
                (btn.textContent === 'Raw Data' && currentViewMode === 'raw') ||
                (btn.textContent === 'Graphical' && currentViewMode === 'graphical')) {
              btn.classList.add('active');
            }
          });
          const vizPanel = document.getElementById('visualizationPanel');
          const rawPanel = document.getElementById('rawDataPanel');
          const canvasContainer = document.getElementById('canvasContainer');
          switch (currentViewMode) {
            case 'graphical':
              vizPanel.classList.remove('hidden');
              rawPanel.classList.add('hidden');
              vizPanel.classList.add('full-width');
              canvasContainer.classList.remove('hidden');
              // Ensure canvas exists
              if (!document.getElementById('canvas')) {
                canvasContainer.innerHTML = '<canvas id="canvas"></canvas>';
              }
              break;
            case 'raw':
              vizPanel.classList.remove('hidden');
              rawPanel.classList.add('hidden');
              vizPanel.classList.add('full-width');
              canvasContainer.classList.add('hidden');
              
              // Create a container with copy button
              const rawContainer = document.createElement('div');
              rawContainer.style.width = '100%';
              rawContainer.style.height = '100%';
              rawContainer.style.display = 'flex';
              rawContainer.style.flexDirection = 'column';
              
              // Create copy button container
              const buttonContainer = document.createElement('div');
              buttonContainer.style.padding = '10px';
              buttonContainer.style.backgroundColor = '#2d2d30';
              buttonContainer.style.borderBottom = '1px solid #464647';
              buttonContainer.style.display = 'flex';
              buttonContainer.style.justifyContent = 'flex-end';
              
              const copyButton = document.createElement('button');
              copyButton.textContent = 'Copy';
              copyButton.style.padding = '4px 12px';
              copyButton.style.backgroundColor = '#3c3c3c';
              copyButton.style.border = '1px solid #464647';
              copyButton.style.color = '#cccccc';
              copyButton.style.cursor = 'pointer';
              copyButton.style.fontSize = '12px';
              copyButton.style.borderRadius = '3px';
              
              copyButton.onmouseover = () => {
                copyButton.style.backgroundColor = '#484848';
              };
              copyButton.onmouseout = () => {
                copyButton.style.backgroundColor = '#3c3c3c';
              };
              
              buttonContainer.appendChild(copyButton);
              
              // Create a scrollable container for raw data
              const scrollContainer = document.createElement('div');
              scrollContainer.style.flex = '1';
              scrollContainer.style.overflow = 'auto';
              scrollContainer.style.position = 'relative';
              
              const mainRawData = document.createElement('pre');
              mainRawData.id = 'main-raw-data';
              mainRawData.style.padding = '20px';
              mainRawData.style.margin = '0';
              mainRawData.style.whiteSpace = 'pre-wrap';
              mainRawData.style.fontFamily = "'Consolas', 'Courier New', monospace";
              mainRawData.style.fontSize = '12px';
              mainRawData.style.lineHeight = '1.5';
              mainRawData.style.color = '#cccccc';
              
              // Set the content based on message type
              let rawContent = '';
              if (currentData) {
                if (currentMessageType === 'URDF' && currentData.data) {
                  rawContent = currentData.data;
                } else {
                  rawContent = JSON.stringify(currentData, null, 2);
                }
                mainRawData.textContent = rawContent;
              }
              
              // Copy button click handler
              copyButton.onclick = () => {
                navigator.clipboard.writeText(rawContent).then(() => {
                  copyButton.textContent = 'Copied!';
                  copyButton.style.backgroundColor = '#007acc';
                  setTimeout(() => {
                    copyButton.textContent = 'Copy';
                    copyButton.style.backgroundColor = '#3c3c3c';
                  }, 2000);
                }).catch(err => {
                  vscode.postMessage({
                    command: 'alert',
                    text: 'Failed to copy: ' + err.message
                  });
                });
              };
              
              scrollContainer.appendChild(mainRawData);
              rawContainer.appendChild(buttonContainer);
              rawContainer.appendChild(scrollContainer);
              canvasContainer.innerHTML = '';
              canvasContainer.appendChild(rawContainer);
              canvasContainer.classList.remove('hidden');
              // Scroll to top
              scrollContainer.scrollTop = 0;
              break;
            case 'both':
              vizPanel.classList.remove('hidden', 'full-width');
              rawPanel.classList.remove('hidden', 'full-width');
              canvasContainer.classList.remove('hidden');
              // Restore canvas if needed
              if (!document.getElementById('canvas')) {
                canvasContainer.innerHTML = '<canvas id="canvas"></canvas>';
              }
              break;
          }
          if (currentData && currentViewMode !== 'raw') {
            setTimeout(() => renderVisualization(currentData), 100);
          }
        }
        function renderVisualization(data) {
          if (currentViewMode === 'raw') return;
          const canvas = document.getElementById('canvas');
          if (!canvas) return;
          const info = document.getElementById('info');
          try {
            switch (currentMessageType) {
              case 'OccupancyGrid':
                renderOccupancyGrid(data, canvas, info);
                break;
              case 'LaserScan':
                renderLaserScan(data, canvas, info);
                break;
              case 'URDF':
                renderURDF(data, canvas, info);
                break;
              default:
                info.textContent = 'Visualization not available for this message type';
            }
          } catch (e) {
            console.error('Visualization error:', e);
            info.textContent = 'Error rendering visualization: ' + e.message;
          }
        }
        function renderOccupancyGrid(data, canvas, info) {
          if (!data.info || !data.data) {
            info.textContent = 'Invalid OccupancyGrid data';
            return;
          }
          const ctx = canvas.getContext('2d');
          const width = data.info.width;
          const height = data.info.height;
          const resolution = data.info.resolution;
          canvas.width = width;
          canvas.height = height;
          canvas.style.display = 'block';
          ctx.clearRect(0, 0, width, height);
          const imageData = ctx.createImageData(width, height);
          const pixels = imageData.data;
          for (let i = 0; i < data.data.length; i++) {
            const value = data.data[i];
            let color;
            if (value === -1) {
              color = 128; // Gray for unknown
            } else if (value === 0) {
              color = 255; // White for free space
            } else {
              color = 255 - Math.round((value / 100.0) * 255); // Black for occupied
            }
            pixels[i * 4] = color;
            pixels[i * 4 + 1] = color;
            pixels[i * 4 + 2] = color;
            pixels[i * 4 + 3] = 255;
          }
          ctx.putImageData(imageData, 0, 0);
          info.textContent = '';
        }
        function renderLaserScan(data, canvas, info) {
          if (!data.ranges || data.angle_min === undefined || data.angle_max === undefined) {
            info.textContent = 'Invalid LaserScan data';
            return;
          }
          const ctx = canvas.getContext('2d');
          const canvasSize = 600;
          canvas.width = canvasSize;
          canvas.height = canvasSize;
          canvas.style.display = 'block';
          ctx.clearRect(0, 0, canvasSize, canvasSize);
          // Background - dark theme with subtle gradient
          const gradient = ctx.createRadialGradient(canvasSize/2, canvasSize/2, 0, canvasSize/2, canvasSize/2, canvasSize/2);
          gradient.addColorStop(0, '#1a1a1a'); // Dark gray at center
          gradient.addColorStop(0.7, '#0d0d0d'); // Darker toward edges
          gradient.addColorStop(1, '#000000'); // Black at edges
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvasSize, canvasSize);
          // Grid with subtle styling
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 0.5;
          for (let i = 0; i <= 10; i++) {
            const pos = (canvasSize / 10) * i;
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, canvasSize);
            ctx.moveTo(0, pos);
            ctx.lineTo(canvasSize, pos);
            ctx.stroke();
          }
          // Concentric circles for distance reference
          ctx.strokeStyle = '#2a2a2a';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([5, 5]);
          for (let i = 1; i <= 4; i++) {
            ctx.beginPath();
            ctx.arc(canvasSize/2, canvasSize/2, (canvasSize * 0.4 * i) / 4, 0, 2 * Math.PI);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.save();
          ctx.translate(canvasSize / 2, canvasSize / 2);
          // Origin with enhanced visibility
          ctx.strokeStyle = '#ffffff'; // White for origin
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-15, 0);
          ctx.lineTo(15, 0);
          ctx.moveTo(0, -15);
          ctx.lineTo(0, 15);
          ctx.stroke();
          // Origin circle
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          // Scan points with enhanced visualization
          const maxRange = Math.max(...data.ranges.filter(r => r > 0 && r < Infinity));
          const scale = (canvasSize * 0.4) / maxRange;
          const angleIncrement = data.angle_increment || 
            (data.angle_max - data.angle_min) / data.ranges.length;
          
          // Draw scan lines for better visualization
          ctx.strokeStyle = 'rgba(0, 255, 100, 0.1)'; // Transparent green
          ctx.lineWidth = 1;
          data.ranges.forEach((range, i) => {
            if (range > 0 && range < data.range_max) {
              const angle = data.angle_min + (i * angleIncrement);
              const x = range * Math.cos(angle) * scale;
              const y = -range * Math.sin(angle) * scale;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
          });
          
          // Draw scan points with glow effect
          data.ranges.forEach((range, i) => {
            if (range > 0 && range < data.range_max) {
              const angle = data.angle_min + (i * angleIncrement);
              const x = range * Math.cos(angle) * scale;
              const y = -range * Math.sin(angle) * scale;
              
              // Outer glow
              ctx.fillStyle = 'rgba(0, 255, 100, 0.3)';
              ctx.fillRect(x - 3, y - 3, 6, 6);
              
              // Inner bright point
              ctx.fillStyle = '#00ff64'; // Bright green
              ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
            }
          });
          ctx.restore();
          // Add field of view indicator
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([10, 5]);
          const fovRadius = canvasSize * 0.4;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          const startX = fovRadius * Math.cos(data.angle_min);
          const startY = -fovRadius * Math.sin(data.angle_min);
          ctx.lineTo(startX, startY);
          ctx.moveTo(0, 0);
          const endX = fovRadius * Math.cos(data.angle_max);
          const endY = -fovRadius * Math.sin(data.angle_max);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          ctx.setLineDash([]);
          
          const validRanges = data.ranges.filter(r => r > 0 && r < data.range_max).length;
          const fovDegrees = ((data.angle_max - data.angle_min) * 180 / Math.PI).toFixed(1);
          info.textContent = \`LaserScan: \${validRanges}/\${data.ranges.length} points | Max range: \${maxRange.toFixed(2)}m | FOV: \${fovDegrees}°\`;
        }
        let urdfScene = null;
        let urdfRenderer = null;
        let urdfAnimationId = null;
        function cleanupURDF() {
          if (urdfAnimationId) {
            cancelAnimationFrame(urdfAnimationId);
            urdfAnimationId = null;
          }
          if (urdfRenderer) {
            urdfRenderer.dispose();
            urdfRenderer = null;
          }
          if (urdfScene) {
            urdfScene = null;
          }
        }
        function renderURDF(data, canvas, info) {
          canvas.style.display = 'none';
          const container = document.getElementById('canvasContainer');
          // Clean up previous URDF visualization
          cleanupURDF();
          let urdfDisplay = document.getElementById('urdfDisplay');
          if (urdfDisplay) {
            urdfDisplay.remove();
          }
          urdfDisplay = document.createElement('div');
          urdfDisplay.id = 'urdfDisplay';
          urdfDisplay.style.width = '100%';
          urdfDisplay.style.height = '100%';
          urdfDisplay.style.minHeight = '500px';
          urdfDisplay.style.position = 'relative';
          container.appendChild(urdfDisplay);
          try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(data.data, 'text/xml');
            if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
              throw new Error('Invalid XML');
            }
            const robot = xmlDoc.querySelector('robot');
            const robotName = robot ? robot.getAttribute('name') : 'Unknown';
            const links = xmlDoc.querySelectorAll('link');
            const joints = xmlDoc.querySelectorAll('joint');
            // Check if Three.js is loaded
            if (typeof THREE !== 'undefined') {
              createURDF3D(urdfDisplay, xmlDoc, robotName, links.length, joints.length, info);
            } else {
              // Fallback to text display
              let html = \`<div style="padding: 20px; color: white;">
                <h3>URDF: \${robotName}</h3>
                <p style="color: #ff6666;">3D visualization not available. Showing structure:</p>
                <h4>Links (\${links.length})</h4>
                <ul>\`;
              links.forEach(link => {
                html += \`<li>\${link.getAttribute('name')}</li>\`;
              });
              html += \`</ul><h4>Joints (\${joints.length})</h4><ul>\`;
              joints.forEach(joint => {
                const type = joint.getAttribute('type');
                const parent = joint.querySelector('parent')?.getAttribute('link');
                const child = joint.querySelector('child')?.getAttribute('link');
                html += \`<li>\${joint.getAttribute('name')} (Type: \${type}, Parent: \${parent}, Child: \${child})</li>\`;
              });
              html += '</ul></div>';
              urdfDisplay.innerHTML = html;
            }
            info.textContent = \`URDF Robot: \${robotName}, Links: \${links.length}, Joints: \${joints.length}\`;
          } catch (e) {
            urdfDisplay.innerHTML = '<div class="error">Failed to parse URDF: ' + e.message + '</div>';
            info.textContent = 'Error parsing URDF data';
          }
        }
        function createURDF3D(container, xmlDoc, robotName, linkCount, jointCount, info) {
          const THREE = window.THREE;
          if (!THREE) {
            throw new Error('Three.js not loaded');
          }
          if (!THREE.OrbitControls) {
            throw new Error('OrbitControls not loaded. Make sure Three.js OrbitControls script is included.');
          }
          // Create controls overlay
          const overlay = document.createElement('div');
          overlay.style.position = 'absolute';
          overlay.style.top = '10px';
          overlay.style.left = '10px';
          overlay.style.background = 'rgba(0,0,0,0.7)';
          overlay.style.padding = '10px';
          overlay.style.borderRadius = '5px';
          overlay.style.color = 'white';
          overlay.style.fontSize = '12px';
          overlay.style.zIndex = '10';
          overlay.innerHTML = \`
            <div><strong>\${robotName}</strong></div>
            <div style="margin-top: 5px;">Mouse: Rotate | Scroll: Zoom | Right-click: Pan</div>
          \`;
          container.appendChild(overlay);
          // Create Three.js scene
          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0xf0f0f0); // Light gray background
          urdfScene = scene;
          // Camera
          const camera = new THREE.PerspectiveCamera(
            50,
            container.clientWidth / container.clientHeight,
            0.01,
            100
          );
          camera.position.set(0.5, 0.5, 0.5);
          // Renderer
          const renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(container.clientWidth, container.clientHeight - 50);
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          container.appendChild(renderer.domElement);
          urdfRenderer = renderer;
          // Lights
          const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
          scene.add(ambientLight);
          const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
          directionalLight.position.set(5, 10, 5);
          directionalLight.castShadow = true;
          scene.add(directionalLight);
          // Add another light from the opposite direction
          const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
          directionalLight2.position.set(-5, 10, -5);
          scene.add(directionalLight2);
          // Grid and axes
          const gridHelper = new THREE.GridHelper(2, 20, 0x666666, 0xcccccc);
          scene.add(gridHelper);
          const axesHelper = new THREE.AxesHelper(0.3);
          scene.add(axesHelper);
          // Controls
          const controls = new THREE.OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.05;
          // Robot group with coordinate system transformation
          const robotGroup = new THREE.Group();
          // URDF uses Z-up convention, Three.js uses Y-up
          // Rotate -90 degrees around X axis to convert from Z-up to Y-up
          robotGroup.rotation.x = -Math.PI / 2;
          scene.add(robotGroup);
          // Materials
          const materials = {
            body: new THREE.MeshStandardMaterial({ color: 0x4a90e2, metalness: 0.6, roughness: 0.4 }), // Blue
            wheel: new THREE.MeshStandardMaterial({ color: 0x2c3e50, metalness: 0.8, roughness: 0.3 }), // Dark blue-gray
            sensor: new THREE.MeshStandardMaterial({ color: 0xe74c3c, metalness: 0.7, roughness: 0.3 }), // Red
            caster: new THREE.MeshStandardMaterial({ color: 0x7f8c8d, metalness: 0.9, roughness: 0.2 }), // Silver
            default: new THREE.MeshStandardMaterial({ color: 0x3498db, metalness: 0.5, roughness: 0.5 }) // Light blue
          };

          // Helper function to convert RPY to Quaternion
          function rpyToQuaternion(rpy) {
            const [roll, pitch, yaw] = rpy;
            const q = new THREE.Quaternion();
            // URDF uses XYZ fixed axis rotations, Three.js Euler uses intrinsic rotations
            q.setFromEuler(new THREE.Euler(roll, pitch, yaw, 'XYZ'));
            return q;
          }


          // Parse URDF and create geometry from collision shapes
          const links = xmlDoc.querySelectorAll('link');
          const linkMap = new Map();
          
          // First pass: Create all link groups and their visual/collision geometry
          links.forEach(link => {
            const linkName = link.getAttribute('name');
            const linkGroup = new THREE.Group();
            linkGroup.name = linkName;
            
            // Use collision geometry (since we can't load mesh files)
            const collision = link.querySelector('collision');
            if (collision) {
              const geometry = collision.querySelector('geometry');
              const origin = collision.querySelector('origin');
            
            if (geometry) {
                let mesh = null;
                
                // Box
                const box = geometry.querySelector('box');
                if (box) {
                  const size = box.getAttribute('size').split(' ').map(parseFloat);
                  const geom = new THREE.BoxGeometry(size[0], size[1], size[2]);
                  const material = linkName.includes('base') ? materials.body :
                                 linkName.includes('lidar') || linkName.includes('camera') || linkName.includes('sensor') ? materials.sensor :
                                 linkName.includes('caster') ? materials.caster :
                                 materials.default;
                  mesh = new THREE.Mesh(geom, material);
                }
                
                // Cylinder handling
                const cylinder = geometry.querySelector('cylinder');
                if (cylinder) {
                  const radius = parseFloat(cylinder.getAttribute('radius'));
                  const length = parseFloat(cylinder.getAttribute('length'));
                  const geom = new THREE.CylinderGeometry(radius, radius, length, 24);
                  const material = linkName.includes('wheel') ? materials.wheel :
                                linkName.includes('base') ? materials.body :
                                linkName.includes('scan') || linkName.includes('lidar') ? materials.sensor :
                                materials.default;
                  mesh = new THREE.Mesh(geom, material);

                  // URDF cylinders are Z-aligned, Three.js cylinders are Y-aligned
                  // All cylinders need to be rotated to align with URDF's Z-axis
                  mesh.rotation.x = Math.PI / 2;
                }
                
                // Sphere (not in this URDF, but good to have)
                const sphere = geometry.querySelector('sphere');
                if (sphere) {
                  const radius = parseFloat(sphere.getAttribute('radius'));
                  const geom = new THREE.SphereGeometry(radius, 16, 16);
                  mesh = new THREE.Mesh(geom, materials.caster);
                }
                
                if (mesh) {
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                  
                  // Apply local origin transform for this geometry within the link
                  if (origin) {
                    const xyz = origin.getAttribute('xyz');
                    const rpy = origin.getAttribute('rpy');
                    if (xyz) {
                      const pos = xyz.split(' ').map(parseFloat);
                      mesh.position.set(pos[0], pos[1], pos[2]);
                    }
                    if (rpy) {
                      const rot = rpy.split(' ').map(parseFloat);
                      // Convert RPY to quaternion and apply to the mesh
                      const q = rpyToQuaternion(rot);
                      mesh.quaternion.multiply(q); // Apply relative rotation
                    }
                  }
                  linkGroup.add(mesh);
                }
              }
            }
            
            // Debug axes removed - comment this back in if needed for debugging
            // if (linkGroup.children.length > 0 || linkName === 'base_footprint') {
            //   const linkAxes = new THREE.AxesHelper(0.05);
            //   linkGroup.add(linkAxes);
            // }
            
            // Store the link group even if it has no geometry so joints work
            linkMap.set(linkName, linkGroup);
            robotGroup.add(linkGroup);
          });
          
          // Second pass: Process joints to build hierarchy and apply joint transforms
          const joints = xmlDoc.querySelectorAll('joint');
          joints.forEach(joint => {
            const parentName = joint.querySelector('parent')?.getAttribute('link');
            const childName = joint.querySelector('child')?.getAttribute('link');
            const origin = joint.querySelector('origin');
            
            if (parentName && childName && linkMap.has(parentName) && linkMap.has(childName)) {
              const parentLink = linkMap.get(parentName);
              const childLink = linkMap.get(childName);
              
              // Remove from root and add to parent
              robotGroup.remove(childLink);
              parentLink.add(childLink);
              
              // Apply joint transform
              if (origin) {
                const xyz = origin.getAttribute('xyz');
                const rpy = origin.getAttribute('rpy');
                
                if (xyz) {
                  const pos = xyz.split(' ').map(parseFloat);
                  childLink.position.set(pos[0], pos[1], pos[2]);
                }
                
                if (rpy) {
                  const rot = rpy.split(' ').map(parseFloat);
                  const q = rpyToQuaternion(rot); // Convert RPY to Quaternion
                  childLink.quaternion.multiply(q); // Apply relative rotation
                }
              }
            }
          });

          // Center camera on robot
          const box = new THREE.Box3().setFromObject(robotGroup);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const distance = maxDim * 2; // Adjusted distance
          camera.position.set(distance, distance, distance);
          camera.lookAt(center); // Look directly at the center
          controls.target.copy(center);
          controls.update();
          
          // Animation loop
          function animate() {
            urdfAnimationId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
          }
          animate();
          
          // Handle resize
          const resizeHandler = () => {
            const width = container.clientWidth;
            const height = container.clientHeight - 50;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
          };
          window.addEventListener('resize', resizeHandler);
          
          // Store cleanup function
          container.cleanup = () => {
            window.removeEventListener('resize', resizeHandler);
            cleanupURDF();
          };
          
          info.textContent = \`URDF Robot: \${robotName}, Links: \${linkCount}, Joints: \${jointCount} (3D View)\`;
        }
        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.command) {
            case 'updateData':
              const previousViewMode = currentViewMode;
              currentData = message.data;
              currentMessageType = message.messageType;
              currentViewMode = message.viewMode;
              
              // Only update view mode if it changed
              if (previousViewMode !== currentViewMode) {
                updateViewMode();
              }
              // Update raw data
              if (currentViewMode !== 'graphical') {
                const rawDataEl = document.getElementById('raw-data');
                const mainRawDataEl = document.getElementById('main-raw-data');
                
                // Update both raw data elements if they exist
                if (rawDataEl) {
                  try {
                    // For URDF, display the XML content directly
                    if (currentMessageType === 'URDF' && currentData.data) {
                      rawDataEl.textContent = currentData.data;
                    } else {
                      rawDataEl.textContent = JSON.stringify(currentData, null, 2);
                    }
                  } catch (e) {
                    rawDataEl.textContent = 'Error displaying data: ' + e.message;
                  }
                }
                
                // Update main raw data (in raw-only mode) preserving scroll position
                if (mainRawDataEl && currentViewMode === 'raw') {
                  // Find the scroll container
                  const scrollContainer = mainRawDataEl.parentElement;
                  if (scrollContainer) {
                    // Save current scroll position
                    const scrollTop = scrollContainer.scrollTop;
                    const scrollLeft = scrollContainer.scrollLeft;
                    
                    try {
                      // Update content
                      if (currentMessageType === 'URDF' && currentData.data) {
                        mainRawDataEl.textContent = currentData.data;
                      } else {
                        mainRawDataEl.textContent = JSON.stringify(currentData, null, 2);
                      }
                      
                      // Restore scroll position
                      scrollContainer.scrollTop = scrollTop;
                      scrollContainer.scrollLeft = scrollLeft;
                    } catch (e) {
                      mainRawDataEl.textContent = 'Error displaying data: ' + e.message;
                    }
                  }
                }
              }
              // Render visualization
              if (currentViewMode !== 'raw') {
                renderVisualization(currentData);
              }
              break;
          }
        });
        // Copy button handler for both mode
        document.getElementById('copyRawButton').onclick = () => {
          let content = '';
          if (currentData) {
            if (currentMessageType === 'URDF' && currentData.data) {
              content = currentData.data;
            } else {
              content = JSON.stringify(currentData, null, 2);
            }
          }
          
          navigator.clipboard.writeText(content).then(() => {
            const btn = document.getElementById('copyRawButton');
            btn.textContent = 'Copied!';
            btn.style.backgroundColor = '#007acc';
            setTimeout(() => {
              btn.textContent = 'Copy';
              btn.style.backgroundColor = '#3c3c3c';
            }, 2000);
          }).catch(err => {
            vscode.postMessage({
              command: 'alert',
              text: 'Failed to copy: ' + err.message
            });
          });
        };
        
        // Initial setup
        updateViewMode();
      </script>
    </body>
    </html>`;
  }
}

module.exports = {
  VisualizationPanel,
};
