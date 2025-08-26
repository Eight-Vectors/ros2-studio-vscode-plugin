const vscode = require("vscode");

class ParametersPanel {
  static panels = new Map();

  static createOrShow(extensionUri, rosbridgeClient, nodeName) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const panelKey = `parameters-${nodeName}`;
    
    if (ParametersPanel.panels.has(panelKey)) {
      const existingPanel = ParametersPanel.panels.get(panelKey);
      existingPanel._panel.reveal(column);
      existingPanel._refreshParameters();
    } else {
      const panel = vscode.window.createWebviewPanel(
        "rosParametersPanel",
        `Parameters: ${nodeName}`,
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      const parametersPanel = new ParametersPanel(
        panel,
        extensionUri,
        rosbridgeClient,
        nodeName
      );
      
      ParametersPanel.panels.set(panelKey, parametersPanel);
    }
  }

  constructor(panel, extensionUri, rosbridgeClient, nodeName) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._rosbridgeClient = rosbridgeClient;
    this._nodeName = nodeName;
    this._disposables = [];
    this._parameters = [];
    this._manualMode = false;
    this._manualParameterNames = this._loadStoredParameters();

    this._panel.webview.html = this._getHtmlContent();
    
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "refresh":
            this._refreshParameters(true);
            break;
          case "updateParameter":
            this._updateParameter(message.name, message.value);
            break;
          case "filterParameters":
            this._filterParameters(message.filter);
            break;
          case "addParameter":
            this._addManualParameter(message.name);
            break;
          case "removeParameter":
            this._removeManualParameter(message.name);
            break;
        }
      },
      null,
      this._disposables
    );

    this._refreshParameters();
  }

  _refreshParameters() {
    this._panel.webview.postMessage({
      command: "loading",
      message: "Loading parameters..."
    });

    this._rosbridgeClient.getParameters(this._nodeName, (parameters, error) => {
      if (error === "manual_mode") {
        this._manualMode = true;
        vscode.window.showInformationMessage(
          "rosapi node not found. Using manual parameter mode. You can add parameters manually."
        );
        
        if (this._manualParameterNames.length > 0) {
          this._rosbridgeClient.getParameterValues(this._manualParameterNames, (params) => {
            this._parameters = params.filter(p => p.value !== null);
            this._panel.webview.postMessage({
              command: "updateParameters",
              parameters: this._parameters,
              nodeName: this._nodeName,
              manualMode: true
            });
          });
        } else {
          this._panel.webview.postMessage({
            command: "updateParameters",
            parameters: [],
            nodeName: this._nodeName,
            manualMode: true
          });
        }
        return;
      }

      if (error) {
        vscode.window.showErrorMessage(`Error getting parameters: ${error}`);
        this._panel.webview.postMessage({
          command: "error",
          message: `Failed to load parameters: ${error}`
        });
        return;
      }

      this._manualMode = false;
      this._parameters = parameters;
      this._panel.webview.postMessage({
        command: "updateParameters",
        parameters: parameters,
        nodeName: this._nodeName,
        manualMode: false
      });
    });
  }

  _updateParameter(name, value) {
    let parsedValue = value;
    
    const originalParam = this._parameters.find(p => p.name === name);
    const originalValue = originalParam ? originalParam.value : null;
    const originalType = originalValue !== null ? typeof originalValue : null;
    
    if (typeof value === 'string') {
      try {
        const jsonParsed = JSON.parse(value);
        if (Array.isArray(jsonParsed)) {
          parsedValue = jsonParsed;
        } else if (value === "true" || value === "false") {
          parsedValue = value === "true";
        } else if (!isNaN(Number(value))) {
          if (originalType === 'number' && !Number.isInteger(originalValue)) {
            parsedValue = parseFloat(value);
          } else if (value.includes('.')) {
            parsedValue = parseFloat(value);
          } else {
            parsedValue = parseInt(value, 10);
          }
        }
      } catch {
        if (value === "true" || value === "false") {
          parsedValue = value === "true";
        } else if (!isNaN(Number(value))) {
          if (originalType === 'number' && !Number.isInteger(originalValue)) {
            parsedValue = parseFloat(value);
          } else if (value.includes('.')) {
            parsedValue = parseFloat(value);
          } else {
            parsedValue = parseInt(value, 10);
          }
        }
      }
    }

    this._rosbridgeClient.setNodeParameter(this._nodeName, name, parsedValue, (success, error) => {
      if (error) {
        vscode.window.showErrorMessage(`Error setting parameter ${name}: ${error}`);
        this._panel.webview.postMessage({
          command: "parameterUpdateFailed",
          name: name,
          error: error,
        });
      } else {
        vscode.window.showInformationMessage(`Parameter ${name} updated successfully`);
        this._refreshParameters();
      }
    });
  }

  _filterParameters(filter) {
    const filtered = this._parameters.filter(param => 
      param.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    this._panel.webview.postMessage({
      command: "updateParameters",
      parameters: filtered,
      nodeName: this._nodeName,
      manualMode: this._manualMode
    });
  }

  _addManualParameter(paramName) {
    if (!paramName || paramName.trim() === '') {
      return;
    }

    let fullParamName = paramName;
    if (!paramName.startsWith('/')) {
      const nodePrefix = this._nodeName.startsWith('/') ? this._nodeName : '/' + this._nodeName;
      fullParamName = `${nodePrefix}/${paramName}`;
    }

    if (this._manualParameterNames.includes(fullParamName)) {
      vscode.window.showWarningMessage(`Parameter ${fullParamName} already exists`);
      return;
    }

    this._manualParameterNames.push(fullParamName);
    this._saveStoredParameters();

    this._rosbridgeClient.getParameter(fullParamName, (value, error) => {
      if (error) {
        vscode.window.showErrorMessage(`Parameter ${fullParamName} not found on ROS 2 parameter server`);
        this._manualParameterNames = this._manualParameterNames.filter(p => p !== fullParamName);
        this._saveStoredParameters();
      } else {
        this._refreshParameters();
      }
    });
  }

  _removeManualParameter(paramName) {
    this._manualParameterNames = this._manualParameterNames.filter(p => p !== paramName);
    this._saveStoredParameters();
    this._refreshParameters();
  }

  _loadStoredParameters() {
    return [];
  }

  _saveStoredParameters() {
  }

  _getHtmlContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ROS 2 Parameters</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 0;
                margin: 0;
            }

            .header {
                position: sticky;
                top: 0;
                background-color: var(--vscode-editor-background);
                padding: 16px 20px;
                border-bottom: 1px solid var(--vscode-widget-border);
                z-index: 100;
            }

            .title {
                font-size: 14px;
                font-weight: 600;
                color: var(--vscode-foreground);
                margin: 0;
            }

            .subtitle {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-top: 4px;
            }

            .search-container {
                padding: 8px 20px;
                background-color: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-widget-border);
            }

            .search-box {
                width: 100%;
                padding: 4px 8px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 3px;
                font-size: 13px;
            }

            .search-box:focus {
                outline: 1px solid var(--vscode-focusBorder);
                border-color: var(--vscode-focusBorder);
            }

            .parameters-container {
                padding: 8px 0;
            }

            .parameter-item {
                padding: 12px 20px;
                border-left: 2px solid transparent;
                position: relative;
            }

            .parameter-item.modified {
                border-left-color: var(--vscode-gitDecoration-modifiedResourceForeground);
            }

            .parameter-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .parameter-header {
                display: flex;
                align-items: center;
                margin-bottom: 4px;
            }

            .parameter-name {
                font-size: 13px;
                font-weight: 500;
                color: var(--vscode-foreground);
                flex: 1;
            }

            .parameter-description {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 8px;
                line-height: 1.4;
            }

            .parameter-value-container {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-left: 0;
                flex-wrap: wrap;
            }

            .parameter-input {
                padding: 3px 6px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
                min-width: 200px;
                width: 100%;
                max-width: 600px;
            }

            .parameter-input[type="text"] {
                text-overflow: ellipsis;
            }

            .parameter-input:focus {
                outline: 1px solid var(--vscode-focusBorder);
                border-color: var(--vscode-focusBorder);
            }

            textarea.parameter-input {
                resize: vertical;
                width: 100%;
                max-width: 400px;
                line-height: 1.4;
            }

            .parameter-select {
                padding: 3px 6px;
                background-color: var(--vscode-dropdown-background);
                color: var(--vscode-dropdown-foreground);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 2px;
                font-size: 13px;
                min-width: 100px;
            }

            .parameter-type {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                padding: 2px 6px;
                background-color: var(--vscode-badge-background);
                border-radius: 2px;
            }

            .parameter-actions {
                display: flex;
                gap: 6px;
                opacity: 0;
                transition: opacity 0.2s;
            }

            .parameter-item:hover .parameter-actions,
            .parameter-item.has-changes .parameter-actions {
                opacity: 1;
            }

            .set-button {
                padding: 2px 8px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
            }

            .set-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .reset-button {
                padding: 2px 8px;
                background-color: transparent;
                color: var(--vscode-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                cursor: pointer;
                font-size: 11px;
            }

            .reset-button:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .no-parameters {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
            }

            .loading {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
            }

            .error {
                color: var(--vscode-errorForeground);
                padding: 20px;
                text-align: center;
            }

            .manual-mode-controls {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 3px;
                padding: 15px;
                margin-bottom: 20px;
            }

            .manual-mode-info {
                color: var(--vscode-descriptionForeground);
                font-size: 12px;
                margin-bottom: 10px;
            }

            .remove-button {
                padding: 2px 8px;
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
                margin-left: 8px;
            }

            .remove-button:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            
            .controls {
                display: flex;
                gap: 10px;
                margin-top: 10px;
            }
            
            .controls .search-box {
                flex: 1;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h1 class="title">ROS 2 Parameters</h1>
                    <div class="subtitle" id="nodeInfo">Loading...</div>
                </div>
                <button class="refresh-button" onclick="refresh()" title="Refresh parameters (clears cache)" style="margin-top: 2px;">
                    Refresh
                </button>
            </div>
        </div>

        <div class="search-container">
            <input type="text" 
                   class="search-box" 
                   id="searchBox" 
                   placeholder="Search parameters..."
                   aria-label="Search parameters">
        </div>

        <div id="manualModeControls" class="manual-mode-controls" style="display: none;">
            <div class="manual-mode-info">
                Manual Mode: Add parameters by name (e.g., "param_name" or "/node/param_name")
            </div>
            <div class="controls">
                <input type="text" 
                       class="search-box" 
                       id="addParamInput" 
                       placeholder="Enter parameter name...">
                <button class="refresh-button" onclick="addParameter()">
                    Add Parameter
                </button>
            </div>
        </div>

        <div id="parametersContainer" class="loading">
            Loading parameters...
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let currentParameters = [];
            let originalValues = new Map();
            let pendingChanges = new Map();
            let isManualMode = false;

            function refresh() {
                vscode.postMessage({ command: 'refresh' });
            }

            function updateParameter(name) {
                const value = pendingChanges.get(name);
                if (value !== undefined) {
                    vscode.postMessage({ 
                        command: 'updateParameter',
                        name: name,
                        value: value
                    });
                    pendingChanges.delete(name);
                }
            }

            function onParameterChange(name, value, inputElement) {
                const original = originalValues.get(name);
                let parsedValue = value;
                let hasChanged = false;
                
                if (inputElement.dataset.paramType === 'array') {
                    try {
                        parsedValue = JSON.parse(value);
                        hasChanged = JSON.stringify(parsedValue) !== JSON.stringify(original);
                    } catch (e) {
                        hasChanged = true;
                        inputElement.style.borderColor = 'var(--vscode-errorForeground)';
                        inputElement.title = 'Invalid JSON: ' + e.message;
                    }
                } else {
                    hasChanged = value !== String(original);
                    inputElement.style.borderColor = '';
                    inputElement.title = '';
                }
                
                if (hasChanged) {
                    pendingChanges.set(name, parsedValue);
                    inputElement.closest('.parameter-item').classList.add('has-changes');
                } else {
                    pendingChanges.delete(name);
                    inputElement.closest('.parameter-item').classList.remove('has-changes');
                }
                
                updateParameterActions(name, hasChanged);
            }

            function updateParameterActions(name, hasChanged) {
                const item = document.querySelector('[data-param-name="' + name + '"]').closest('.parameter-item');
                const actions = item.querySelector('.parameter-actions');
                
                if (hasChanged) {
                    actions.innerHTML = '<button class="set-button" onclick="updateParameter(\\'' + name + '\\')">Set</button>' +
                                      '<button class="reset-button" onclick="resetParameter(\\'' + name + '\\')">Reset</button>';
                } else {
                    actions.innerHTML = '';
                }
            }

            function resetParameter(name) {
                const original = originalValues.get(name);
                const input = document.querySelector('[data-param-name="' + name + '"]');
                
                if (input.tagName === 'SELECT') {
                    input.value = String(original);
                } else if (input.tagName === 'TEXTAREA') {
                    input.value = JSON.stringify(original, null, 2);
                    input.style.borderColor = '';
                    input.title = '';
                } else {
                    input.value = original;
                }
                
                pendingChanges.delete(name);
                input.closest('.parameter-item').classList.remove('has-changes');
                updateParameterActions(name, false);
            }

            function addParameter() {
                const input = document.getElementById('addParamInput');
                const paramName = input.value.trim();
                if (paramName) {
                    vscode.postMessage({ 
                        command: 'addParameter',
                        name: paramName
                    });
                    input.value = '';
                }
            }

            function removeParameter(name) {
                vscode.postMessage({ 
                    command: 'removeParameter',
                    name: name
                });
            }

            function getParameterType(value) {
                if (typeof value === 'boolean') return 'bool';
                if (typeof value === 'number') {
                    return Number.isInteger(value) ? 'int' : 'double';
                }
                if (typeof value === 'string') return 'string';
                if (Array.isArray(value)) return 'array';
                if (typeof value === 'object') return 'object';
                return 'unknown';
            }

            function renderParameters(parameters) {
                const container = document.getElementById('parametersContainer');
                
                if (!parameters || parameters.length === 0) {
                    container.innerHTML = '<div class="no-parameters">No parameters found for this node</div>';
                    return;
                }

                container.innerHTML = '';
                container.className = 'parameters-container';

                parameters.forEach(param => {
                    const item = document.createElement('div');
                    item.className = 'parameter-item';
                    
                    if (pendingChanges.has(param.name)) {
                        item.classList.add('has-changes');
                    }

                    const type = getParameterType(param.value);
                    const isSimpleType = ['bool', 'int', 'float', 'double', 'string'].includes(type);
                    
                    const description = getParameterDescription(param.name);

                    let valueInput = '';
                    if (type === 'bool') {
                        valueInput = '<select class="parameter-select" data-param-name="' + param.name + '"' +
                                   ' oninput="onParameterChange(\\'' + param.name + '\\', this.value, this)">' +
                                   '<option value="true"' + (param.value === true ? ' selected' : '') + '>true</option>' +
                                   '<option value="false"' + (param.value === false ? ' selected' : '') + '>false</option>' +
                                   '</select>';
                    } else if (isSimpleType) {
                        const titleAttr = (type === 'string' && param.value.length > 50) ? ' title="' + param.value + '"' : '';
                        valueInput = '<input type="text" class="parameter-input"' +
                                   ' value="' + param.value + '"' +
                                   ' data-param-name="' + param.name + '"' +
                                   titleAttr +
                                   ' oninput="onParameterChange(\\'' + param.name + '\\', this.value, this)">';
                    } else if (type === 'array') {
                        valueInput = '<textarea class="parameter-input" style="min-height: 60px; font-family: monospace;"' +
                                   ' data-param-name="' + param.name + '"' +
                                   ' data-param-type="array"' +
                                   ' oninput="onParameterChange(\\'' + param.name + '\\', this.value, this)">' +
                                   JSON.stringify(param.value, null, 2) + '</textarea>';
                    } else {
                        valueInput = '<pre class="parameter-input" style="color: var(--vscode-descriptionForeground); margin: 0; font-size: 12px;">' +
                                   JSON.stringify(param.value, null, 2) + '</pre>';
                    }

                    item.innerHTML = 
                        '<div class="parameter-header">' +
                            '<div class="parameter-name">' + param.name + '</div>' +
                        '</div>' +
                        (description ? '<div class="parameter-description">' + description + '</div>' : '') +
                        '<div class="parameter-value-container">' +
                            valueInput +
                            '<span class="parameter-type">' + type + '</span>' +
                            '<div class="parameter-actions"></div>' +
                            (isManualMode ? 
                                '<button class="remove-button" onclick="removeParameter(\\'' + param.name + '\\')">Remove</button>' 
                                : '') +
                        '</div>';

                    container.appendChild(item);
                    
                    if (pendingChanges.has(param.name)) {
                        updateParameterActions(param.name, true);
                    }
                });
            }

            function getParameterDescription(name) {
                const descriptions = {
                    'use_sim_time': 'Use simulation time instead of wall-clock time',
                    'frame_id': 'The TF frame ID for this node',
                    'bond_heartbeat_period': 'Period between heartbeat messages in seconds',
                    'autostart_node': 'Automatically start the node on launch',
                    'yaml_filename': 'Path to the YAML configuration file',
                    'topic_name': 'Name of the ROS 2 topic to publish/subscribe'
                };
                
                if (descriptions[name]) return descriptions[name];
                
                for (const [key, desc] of Object.entries(descriptions)) {
                    if (name.includes(key)) return desc;
                }
                
                return '';
            }

            document.getElementById('searchBox').addEventListener('input', (e) => {
                vscode.postMessage({ 
                    command: 'filterParameters',
                    filter: e.target.value
                });
            });

            document.getElementById('addParamInput')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    addParameter();
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                const container = document.getElementById('parametersContainer');
                
                switch (message.command) {
                    case 'loading':
                        container.className = 'loading';
                        container.innerHTML = message.message || 'Loading parameters...';
                        break;
                    case 'error':
                        container.className = 'error';
                        container.innerHTML = message.message || 'Error loading parameters';
                        break;
                    case 'updateParameters':
                        currentParameters = message.parameters;
                        isManualMode = message.manualMode || false;
                        originalValues.clear();
                        message.parameters.forEach(param => {
                            originalValues.set(param.name, param.value);
                        });
                        pendingChanges.clear();
                        document.getElementById('nodeInfo').textContent = 
                            \`Node: \${message.nodeName} | \${message.parameters.length} parameters\${isManualMode ? ' (Manual Mode)' : ''}\`;
                        document.getElementById('manualModeControls').style.display = 
                            isManualMode ? 'block' : 'none';
                        renderParameters(message.parameters);
                        break;
                    case 'parameterUpdateFailed':
                        const input = document.querySelector(\`[data-param-name="\${message.name}"]\`);
                        if (input) {
                            input.style.borderColor = 'var(--vscode-errorForeground)';
                            setTimeout(() => {
                                input.style.borderColor = '';
                            }, 2000);
                        }
                        break;
                }
            });
        </script>
    </body>
    </html>`;
  }

  dispose() {
    const panelKey = `parameters-${this._nodeName}`;
    ParametersPanel.panels.delete(panelKey);

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  
  static disposeAll() {
    if (ParametersPanel.panels && ParametersPanel.panels.size > 0) {
      const panelsToDispose = Array.from(ParametersPanel.panels.values());
      for (const panel of panelsToDispose) {
        panel.dispose();
      }
      ParametersPanel.panels.clear();
    }
  }
}

module.exports = ParametersPanel;