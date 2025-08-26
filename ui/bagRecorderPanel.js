const vscode = require("vscode");

class BagRecorderPanel {
  static currentPanel = undefined;

  static createOrShow(extensionUri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (BagRecorderPanel.currentPanel) {
      BagRecorderPanel.currentPanel._panel.reveal(column);
      BagRecorderPanel.currentPanel._update();
    } else {
      const panel = vscode.window.createWebviewPanel(
        "rosBagRecorder",
        "ROS2 Bag Recorder",
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      BagRecorderPanel.currentPanel = new BagRecorderPanel(panel, extensionUri);
    }

    return BagRecorderPanel.currentPanel;
  }

  static addTopic(topicName, topicType) {
    if (BagRecorderPanel.currentPanel) {
      BagRecorderPanel.currentPanel._addTopic(topicName, topicType);
    } else {
      if (!BagRecorderPanel._pendingTopics) {
        BagRecorderPanel._pendingTopics = [];
      }
      BagRecorderPanel._pendingTopics.push({
        name: topicName,
        type: topicType,
      });
    }
  }

  constructor(panel, extensionUri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._disposables = [];
    this._selectedTopics = new Map();
    this._currentCommand = null;
    this._outputChannel =
      vscode.window.createOutputChannel("ROS2 Bag Recorder");

    if (BagRecorderPanel._pendingTopics) {
      BagRecorderPanel._pendingTopics.forEach((topic) => {
        this._selectedTopics.set(topic.name, topic);
      });
      BagRecorderPanel._pendingTopics = [];
    }

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "removeTopic":
            this._removeTopic(message.topic);
            break;
          case "generateCommand":
            this._generateCommand();
            break;
          case "browseOutputPath":
            this._browseOutputPath();
            break;
          case "clearTopics":
            this._clearTopics();
            break;
        }
      },
      null,
      this._disposables
    );

  }

  _addTopic(topicName, topicType) {
    if (!this._selectedTopics.has(topicName)) {
      this._selectedTopics.set(topicName, { name: topicName, type: topicType });
      this._update();
      vscode.window.showInformationMessage(
        `Added topic ${topicName} to bag recorder`
      );
    } else {
      vscode.window.showWarningMessage(
        `Topic ${topicName} is already in the recorder`
      );
    }
  }

  _removeTopic(topicName) {
    this._selectedTopics.delete(topicName);
    this._update();
  }

  _clearTopics() {
    this._selectedTopics.clear();
    this._update();
  }

  _generateCommand() {
    if (this._selectedTopics.size === 0) {
      vscode.window.showWarningMessage("No topics selected");
      return;
    }

    const topics = Array.from(this._selectedTopics.keys());
    const command = this._constructBagCommand(null, topics);
    
    this._currentCommand = command;

    this._outputChannel.clear();
    this._outputChannel.appendLine("=== ROS2 Bag Recorder ===");
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine(
      "Command to run on remote machine:"
    );
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine(command);
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine("Topics:");
    topics.forEach((topic, index) => {
      const topicInfo = this._selectedTopics.get(topic);
      this._outputChannel.appendLine(
        `  ${index + 1}. ${topic} [${topicInfo.type}]`
      );
    });
    this._outputChannel.appendLine("");
    this._outputChannel.appendLine("Note: You can add -o flag to specify output path");
    this._outputChannel.show();

    this._update();

    vscode.window.showInformationMessage(
      `ROS2 bag command generated. You can copy it from the panel.`
    );
  }

  _constructBagCommand(outputPath, topics) {
    let command = "ros2 bag record";

    topics.forEach((topic) => {
      command += ` ${topic}`;
    });

    return command;
  }


  _browseOutputPath() {
    vscode.window
      .showWarningMessage(
        "The browse dialog shows your local filesystem. Please manually enter the remote path where you want to save the bag file on your ROS 2 machine.",
        "OK"
      )
      .then(() => {
        vscode.window
          .showSaveDialog({
            defaultUri: vscode.Uri.file(
              `${process.env.HOME}/rosbag_${Date.now()}`
            ),
            filters: {
              "ROS Bag": ["db3", "bag"],
            },
          })
          .then((fileUri) => {
            if (fileUri) {
              const filename = fileUri.fsPath.split("/").pop();

              const suggestedRemotePath = `/home/ros/bags/${filename}`;

              vscode.window
                .showInputBox({
                  prompt: "Enter the path on your remote ROS 2 machine",
                  value: suggestedRemotePath,
                  placeHolder: "/home/ros/bags/my_recording",
                  validateInput: (value) => {
                    if (!value.startsWith("/")) {
                      return "Path must be absolute (start with /)";
                    }
                    return null;
                  },
                })
                .then((remotePath) => {
                  if (remotePath) {
                    this._panel.webview.postMessage({
                      command: "updateOutputPath",
                      path: remotePath,
                    });
                  }
                });
            }
          });
      });
  }


  _update() {
    this._panel.webview.html = this._getHtmlContent();
  }

  _getHtmlContent() {
    const topicsList = Array.from(this._selectedTopics.values());

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ROS2 Bag Recorder</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 0;
                margin: 0;
            }
            
            .container {
                padding: 20px;
                max-width: 800px;
                margin: 0 auto;
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
            
            .status-badge {
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                text-transform: uppercase;
            }
            
            .status-badge.idle {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
            }
            
            .status-badge.recording {
                background-color: var(--vscode-charts-red);
                color: white;
                animation: pulse 1.5s infinite;
            }
            
            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.7; }
                100% { opacity: 1; }
            }
            
            .section {
                margin-bottom: 30px;
            }
            
            .section-title {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            
            .topics-container {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 4px;
                max-height: 300px;
                overflow-y: auto;
            }
            
            .topic-item {
                display: flex;
                align-items: center;
                padding: 10px 15px;
                border-bottom: 1px solid var(--vscode-widget-border);
            }
            
            .topic-item:last-child {
                border-bottom: none;
            }
            
            .topic-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .topic-info {
                flex-grow: 1;
            }
            
            .topic-name {
                font-weight: 500;
                color: var(--vscode-foreground);
            }
            
            .topic-type {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-top: 2px;
            }
            
            .remove-button {
                padding: 4px 8px;
                background-color: transparent;
                color: var(--vscode-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
                opacity: 0.7;
                transition: opacity 0.2s;
            }
            
            .remove-button:hover {
                opacity: 1;
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .no-topics {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
            }
            
            .output-section {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 4px;
                padding: 15px;
            }
            
            .output-path {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .output-input {
                flex-grow: 1;
                padding: 6px 10px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 3px;
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
            }
            
            .browse-button {
                padding: 6px 12px;
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 13px;
            }
            
            .browse-button:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            
            .control-buttons {
                display: flex;
                gap: 10px;
                margin-top: 20px;
            }
            
            .primary-button {
                padding: 8px 20px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                flex: 1;
            }
            
            .primary-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .primary-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .primary-button.stop {
                background-color: var(--vscode-charts-red);
            }
            
            .secondary-button {
                padding: 8px 16px;
                background-color: transparent;
                color: var(--vscode-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }
            
            .secondary-button:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            
            .stats-container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
                margin-top: 20px;
            }
            
            .stat-item {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 4px;
                padding: 15px;
                text-align: center;
            }
            
            .stat-value {
                font-size: 24px;
                font-weight: bold;
                color: var(--vscode-foreground);
                margin-bottom: 5px;
            }
            
            .stat-label {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
            }
            
            .info-message {
                background-color: var(--vscode-inputValidation-infoBackground);
                border: 1px solid var(--vscode-inputValidation-infoBorder);
                border-radius: 3px;
                padding: 10px 15px;
                margin-top: 15px;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .info-icon {
                flex-shrink: 0;
            }
            
            .command-display {
                background-color: var(--vscode-textBlockQuote-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 4px;
                padding: 15px;
                margin-top: 15px;
                font-family: var(--vscode-editor-font-family);
            }
            
            .command-label {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                margin-bottom: 8px;
                font-weight: 600;
            }
            
            .command-text {
                font-size: 13px;
                color: var(--vscode-foreground);
                word-break: break-all;
                user-select: text;
                cursor: text;
                padding: 8px;
                background-color: var(--vscode-editor-background);
                border-radius: 3px;
                border: 1px solid var(--vscode-input-border);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>ROS2 Bag Recorder</h1>
            </div>
            
            <div class="section">
                <div class="section-title">
                    Selected Topics (${topicsList.length})
                    ${
                      topicsList.length > 0
                        ? `<button class="secondary-button" onclick="clearAllTopics()">Clear All</button>`
                        : ""
                    }
                </div>
                
                <div class="topics-container">
                    ${
                      topicsList.length > 0
                        ? topicsList
                            .map(
                              (topic) => `
                        <div class="topic-item">
                            <div class="topic-info">
                                <div class="topic-name">${topic.name}</div>
                                <div class="topic-type">${topic.type}</div>
                            </div>
                            <button class="remove-button" onclick="removeTopic('${
                              topic.name
                            }')">
                                Remove
                            </button>
                        </div>
                    `
                            )
                            .join("")
                        : `
                        <div class="no-topics">
                            No topics selected. Right-click on topics in the tree view and select "Add to Bag Recorder".
                        </div>
                    `
                    }
                </div>
            </div>
            
            
            <div class="control-buttons">
                <button class="primary-button" onclick="generateCommand()" ${
                  topicsList.length === 0 ? "disabled" : ""
                }>
                    Generate Command
                </button>
            </div>
            
            ${
              this._currentCommand
                ? `
                <div class="command-display">
                    <div class="command-label">ROS2 Bag Command:</div>
                    <div class="command-text">${this._currentCommand}</div>
                </div>
                `
                : ""
            }
            
            <div class="info-message">
                <span class="info-icon">ℹ️</span>
                <span>Generate the ros2 bag record command for the selected topics.</span>
            </div>
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            
            function removeTopic(topicName) {
                vscode.postMessage({ command: 'removeTopic', topic: topicName });
            }
            
            function clearAllTopics() {
                vscode.postMessage({ command: 'clearTopics' });
            }
            
            function generateCommand() {
                vscode.postMessage({ command: 'generateCommand' });
            }
            
            
        </script>
    </body>
    </html>`;
  }

  dispose() {
    BagRecorderPanel.currentPanel = undefined;

    if (this._outputChannel) {
      this._outputChannel.dispose();
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
    if (BagRecorderPanel.currentPanel) {
      BagRecorderPanel.currentPanel.dispose();
    }
  }
}

module.exports = BagRecorderPanel;
