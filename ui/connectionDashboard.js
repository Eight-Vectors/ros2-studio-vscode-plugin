const vscode = require("vscode");

class ConnectionDashboard {
  static currentPanel = undefined;

  static createOrShow(extensionUri, rosbridgeClient) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ConnectionDashboard.currentPanel) {
      ConnectionDashboard.currentPanel._panel.reveal(column);
      ConnectionDashboard.currentPanel._updateContent(rosbridgeClient);
    } else {
      const panel = vscode.window.createWebviewPanel(
        "rosConnectionDashboard",
        "ROS 2 Connection Dashboard",
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      ConnectionDashboard.currentPanel = new ConnectionDashboard(
        panel,
        extensionUri,
        rosbridgeClient
      );
    }
  }

  constructor(panel, extensionUri, rosbridgeClient) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._rosbridgeClient = rosbridgeClient;
    this._disposables = [];
    this._systemInfo = {
      nodes: [],
      topics: [],
      connectionTime: new Date().toLocaleString(),
      messageCount: 0,
      reconnectAttempts: 0,
      isReconnecting: false,
    };

    this._updateContent(rosbridgeClient);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    if (this._updateInterval) {
      clearInterval(this._updateInterval);
    }
    
    this._updateInterval = setInterval(() => {
      this._updateSystemInfo();
    }, 5000);
  }

  async _updateSystemInfo() {
    if (!this._rosbridgeClient || !this._rosbridgeClient.isConnected()) {
      return;
    }

    try {
      this._rosbridgeClient.getNodes((nodes) => {
        this._systemInfo.nodes = nodes || [];
        this._updateDashboard();
      });

      this._rosbridgeClient.getTopics((topics) => {
        this._systemInfo.topics = topics || [];
        this._updateDashboard();
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update ROS 2 system info: ${error.message || error}`);
    }
  }

  _updateDashboard() {
    const isConnected = this._rosbridgeClient?.isConnected() || false;
    const isReconnecting = this._rosbridgeClient?.isReconnecting || false;
    const reconnectAttempts = this._rosbridgeClient?.reconnectAttempts || 0;
    const maxReconnectAttempts = this._rosbridgeClient?.maxReconnectAttempts || 10;
    
    this._panel.webview.postMessage({
      command: "updateInfo",
      data: {
        isConnected: isConnected,
        isReconnecting: isReconnecting,
        reconnectAttempts: reconnectAttempts,
        maxReconnectAttempts: maxReconnectAttempts,
        url: this._rosbridgeClient?.url || "Not connected",
        connectionTime: this._systemInfo.connectionTime,
        nodeCount: this._systemInfo.nodes.length,
        topicCount: this._systemInfo.topics.length
      },
    });
  }

  _updateContent(rosbridgeClient) {
    this._rosbridgeClient = rosbridgeClient;
    this._panel.webview.html = this._getHtmlContent();
    
    this._updateDashboard();
    
    setTimeout(() => {
      this._updateSystemInfo();
    }, 1000);

    this._panel.webview.onDidReceiveMessage(
      () => {
      },
      null,
      this._disposables
    );
  }

  _getHtmlContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ROS 2 Connection Dashboard</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
                margin: 0;
            }
            
            .header {
                display: flex;
                align-items: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--vscode-widget-border);
            }
            
            .header h1 {
                margin: 0;
                font-size: 24px;
                flex-grow: 1;
            }
            
            .status {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .status-indicator {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background-color: var(--vscode-charts-red);
            }
            
            .status-indicator.connected {
                background-color: var(--vscode-charts-green);
            }
            
            .dashboard-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            
            .card {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 8px;
                padding: 20px;
            }
            
            .card h2 {
                margin: 0 0 15px 0;
                font-size: 18px;
                color: var(--vscode-foreground);
            }
            
            .info-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                padding: 5px 0;
            }
            
            .label {
                color: var(--vscode-descriptionForeground);
            }
            
            .value {
                font-weight: bold;
                color: var(--vscode-foreground);
            }
            
            .metric-card {
                text-align: center;
                padding: 15px;
            }
            
            .metric-value {
                font-size: 36px;
                font-weight: bold;
                color: var(--vscode-editor-foreground);
                margin: 10px 0;
            }
            
            .metric-label {
                color: var(--vscode-descriptionForeground);
                font-size: 14px;
            }
            
            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin-right: 10px;
            }
            
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            
            .robot-icon {
                width: 40px;
                height: 40px;
                margin-right: 15px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <svg class="robot-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C13.1 2 14 2.9 14 4V5H18C19.1 5 20 5.9 20 7V19C20 20.1 19.1 21 18 21H6C4.9 21 4 20.1 4 19V7C4 5.9 4.9 5 6 5H10V4C10 2.9 10.9 2 12 2M6 7V19H18V7H6M9 9.5C9.83 9.5 10.5 10.17 10.5 11C10.5 11.83 9.83 12.5 9 12.5C8.17 12.5 7.5 11.83 7.5 11C7.5 10.17 8.17 9.5 9 9.5M15 9.5C15.83 9.5 16.5 10.17 16.5 11C16.5 11.83 15.83 12.5 15 12.5C14.17 12.5 13.5 11.83 13.5 11C13.5 10.17 14.17 9.5 15 9.5M9 15H15V16.5C15 17.33 14.33 18 13.5 18H10.5C9.67 18 9 17.33 9 16.5V15Z" fill="currentColor"/>
            </svg>
            <h1>ROS 2 Connection Dashboard</h1>
            <div class="status">
                <div class="status-indicator" id="statusIndicator"></div>
                <span id="statusText">Connecting...</span>
            </div>
        </div>
        
        <div class="dashboard-grid">
            <div class="card">
                <h2>Connection Details</h2>
                <div class="info-row">
                    <span class="label">Status:</span>
                    <span class="value" id="connectionStatus">Connecting...</span>
                </div>
                <div class="info-row" id="reconnectRow" style="display: none;">
                    <span class="label">Reconnect Attempts:</span>
                    <span class="value" id="reconnectInfo">-</span>
                </div>
                <div class="info-row">
                    <span class="label">URL:</span>
                    <span class="value" id="connectionUrl">-</span>
                </div>
                <div class="info-row">
                    <span class="label">Connected Since:</span>
                    <span class="value" id="connectionTime">-</span>
                </div>
            </div>
            
            <div class="card metric-card">
                <div class="metric-label">Active Nodes</div>
                <div class="metric-value" id="nodeCount">0</div>
            </div>
            
            <div class="card metric-card">
                <div class="metric-label">Topics</div>
                <div class="metric-value" id="topicCount">0</div>
            </div>
            
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            
            
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'updateInfo') {
                    const data = message.data;
                    
                    const statusIndicator = document.getElementById('statusIndicator');
                    const statusText = document.getElementById('statusText');
                    const connectionStatus = document.getElementById('connectionStatus');
                    
                    const reconnectRow = document.getElementById('reconnectRow');
                    const reconnectInfo = document.getElementById('reconnectInfo');
                    
                    if (data.isConnected) {
                        statusIndicator.classList.add('connected');
                        statusText.textContent = 'Connected';
                        connectionStatus.textContent = 'Connected';
                        reconnectRow.style.display = 'none';
                    } else if (data.isReconnecting) {
                        statusIndicator.classList.remove('connected');
                        statusText.textContent = 'Reconnecting...';
                        connectionStatus.textContent = 'Reconnecting...';
                        reconnectRow.style.display = 'flex';
                        reconnectInfo.textContent = data.reconnectAttempts + ' / ' + data.maxReconnectAttempts;
                    } else {
                        statusIndicator.classList.remove('connected');
                        statusText.textContent = 'Disconnected';
                        connectionStatus.textContent = 'Disconnected';
                        reconnectRow.style.display = 'none';
                    }
                    
                    document.getElementById('connectionUrl').textContent = data.url;
                    document.getElementById('connectionTime').textContent = data.connectionTime;
                    
                    document.getElementById('nodeCount').textContent = data.nodeCount;
                    document.getElementById('topicCount').textContent = data.topicCount;
                }
            });
        </script>
    </body>
    </html>`;
  }

  dispose() {
    ConnectionDashboard.currentPanel = undefined;

    if (this._updateInterval) {
      clearInterval(this._updateInterval);
    }

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
  
  static dispose() {
    if (ConnectionDashboard.currentPanel) {
      ConnectionDashboard.currentPanel.dispose();
    }
  }
}

module.exports = ConnectionDashboard;