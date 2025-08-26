const vscode = require("vscode");

class MessageInspectorPanel {
  static currentPanel = undefined;

  static createOrShow(extensionUri, rosbridgeClient) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MessageInspectorPanel.currentPanel) {
      MessageInspectorPanel.currentPanel._panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        "rosMessageInspector",
        "ROS 2 Message/Service Inspector",
        column || vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      MessageInspectorPanel.currentPanel = new MessageInspectorPanel(
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

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    vscode.window.onDidChangeActiveColorTheme(() => {
      this._update();
    }, null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "inspectMessage":
            this._inspectMessageType(message.messageType);
            break;
          case "inspectService":
            this._inspectServiceType(message.serviceType);
            break;
          case "inspectFromTopic":
            this.inspectTopicMessageType(message.topicName);
            break;
          case "generateTemplate":
            this._generateTemplate(message.messageType, message.definition);
            break;
          case "inspectAction":
            if (message.actionType) {
              this.inspectActionWithType(message.actionType);
            } else {
              this._inspectActionType(message.actionName);
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  _inspectMessageType(messageType) {
    this._rosbridgeClient.getMessageDetails(messageType, (details, error) => {
      if (error) {
        vscode.window.showErrorMessage(`Failed to get message details: ${error}`);
        return;
      }

      this._panel.webview.postMessage({
        command: "showMessageDetails",
        messageType: messageType,
        details: details,
      });
    });
  }

  _inspectServiceType(serviceType) {
    this._rosbridgeClient.getServiceRequestDetails(serviceType, (requestDetails, reqError) => {
      if (reqError) {
        vscode.window.showErrorMessage(`Failed to get service request details: ${reqError}`);
        return;
      }

      this._rosbridgeClient.getServiceResponseDetails(serviceType, (responseDetails, resError) => {
        if (resError) {
          vscode.window.showErrorMessage(`Failed to get service response details: ${resError}`);
          return;
        }

        this._panel.webview.postMessage({
          command: "showServiceDetails",
          serviceType: serviceType,
          requestDetails: requestDetails,
          responseDetails: responseDetails,
        });
      });
    });
  }

  inspectTopicMessageType(topicName) {
    this._rosbridgeClient.getTopics((topics) => {
      const topic = topics.find(t => t.name === topicName);
      if (topic) {
        this._inspectMessageType(topic.type);
      } else {
        vscode.window.showErrorMessage(`Topic ${topicName} not found`);
      }
    });
  }

  _inspectActionType(actionName) {
    this._panel.webview.postMessage({
      command: "showActionInspector",
      actionName: actionName
    });
  }

  inspectActionWithType(actionType) {
    const goalType = `${actionType}_Goal`;
    const resultType = `${actionType}_Result`;
    const feedbackType = `${actionType}_Feedback`;
    Promise.all([
      this._getMessageDetailsPromise(goalType),
      this._getMessageDetailsPromise(resultType),
      this._getMessageDetailsPromise(feedbackType)
    ]).then(([goalDetails, resultDetails, feedbackDetails]) => {
      this._panel.webview.postMessage({
        command: "showActionDetails",
        actionType: actionType,
        goalDetails: goalDetails,
        resultDetails: resultDetails,
        feedbackDetails: feedbackDetails
      });
    }).catch(error => {
      vscode.window.showErrorMessage(`Failed to get action details: ${error}`);
    });
  }

  _getMessageDetailsPromise(messageType) {
    return new Promise((resolve, reject) => {
      this._rosbridgeClient.getMessageDetails(messageType, (details, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(details);
        }
      });
    });
  }

  _generateTemplate(messageType, definition) {
    const template = this._createMessageTemplate(definition);
    const json = JSON.stringify(template, null, 2);
    this._panel.webview.postMessage({
      command: "showTemplate",
      messageType: messageType,
      template: json
    });
    vscode.env.clipboard.writeText(json).then(() => {
      vscode.window.showInformationMessage(`Template for ${messageType} copied to clipboard!`);
    });
  }

  _createMessageTemplate(definition) {
    const mainType = Object.keys(definition).find(type => 
      !type.includes('/') || type.split('/').pop() === Object.keys(definition)[0].split('/').pop()
    ) || Object.keys(definition)[0];
    
    return this._createTemplateForType(mainType, definition);
  }
  
  _createTemplateForType(typeName, definition) {
    const template = {};
    const typeDef = definition[typeName];
    
    if (!typeDef || !typeDef.fields) {
      return template;
    }
    
    typeDef.fields.forEach(field => {
      template[field.name] = this._getFieldValue(field.type, definition);
    });
    
    return template;
  }
  
  _getFieldValue(fieldType, definition) {
    if (fieldType.endsWith('[]')) {
      const baseType = fieldType.slice(0, -2);
      if (definition[baseType] && !this._isPrimitiveType(baseType)) {
        return [this._createTemplateForType(baseType, definition)];
      }
      return [];
    }
    
    if (fieldType.startsWith('array(') || fieldType === 'array') {
      return [];
    }
    
    const defaultValue = this._getDefaultValue(fieldType);
    if (defaultValue !== null) {
      return defaultValue;
    }
    
    if (definition[fieldType]) {
      return this._createTemplateForType(fieldType, definition);
    }
    
    if (fieldType === 'float' || fieldType === 'double') {
      return 0.0;
    }
    if (fieldType.includes('int') || fieldType === 'byte' || fieldType === 'char') {
      return 0;
    }
    
    return {};
  }

  _getDefaultValue(fieldType) {
    if (fieldType.endsWith('[]')) {
      return [];
    }
    
    const typeDefaults = {
      'bool': false,
      'boolean': false,
      'byte': 0,
      'char': 0,
      'int8': 0,
      'uint8': 0,
      'int16': 0,
      'uint16': 0,
      'int32': 0,
      'uint32': 0,
      'int64': 0,
      'uint64': 0,
      'float32': 0.0,
      'float64': 0.0,
      'float': 0.0,
      'double': 0.0,
      'string': '',
      'time': { 'secs': 0, 'nsecs': 0 },
      'duration': { 'secs': 0, 'nsecs': 0 }
    };

    if (typeDefaults.hasOwnProperty(fieldType)) {
      return typeDefaults[fieldType];
    }

    return null;
  }
  
  _isPrimitiveType(type) {
    const primitiveTypes = [
      'bool', 'boolean', 'byte', 'char',
      'int8', 'uint8', 'int16', 'uint16',
      'int32', 'uint32', 'int64', 'uint64',
      'float32', 'float64', 'float', 'double',
      'string', 'time', 'duration'
    ];
    return primitiveTypes.includes(type);
  }

  dispose() {
    MessageInspectorPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  _update() {
    try {
      const htmlContent = this._getHtmlContent();
      this._panel.webview.html = htmlContent;
    } catch (error) {
      this._panel.webview.html = `
        <html>
          <body>
            <h1>Error loading inspector</h1>
            <p>${error.message}</p>
          </body>
        </html>
      `;
    }
  }

  _getHtmlContent() {
    const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ROS 2 Message/Service Inspector</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
                margin: 0;
            }
            
            .header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .search-section {
                margin-bottom: 30px;
            }
            
            .search-container {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
            }
            
            input {
                flex: 1;
                padding: 8px 12px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                font-family: var(--vscode-font-family);
            }
            
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-family: var(--vscode-font-family);
            }
            
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            
            .tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
            }
            
            .tab {
                padding: 6px 12px;
                background: var(--vscode-tab-inactiveBackground);
                color: var(--vscode-tab-inactiveForeground);
                border: none;
                border-radius: 4px 4px 0 0;
                cursor: pointer;
            }
            
            .tab.active {
                background: var(--vscode-tab-activeBackground);
                color: var(--vscode-tab-activeForeground);
            }
            
            .definition-container {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 20px;
                margin-top: 20px;
                max-height: 600px;
                overflow-y: auto;
            }
            
            .message-type {
                margin-bottom: 20px;
            }
            
            .type-header {
                font-weight: bold;
                color: var(--vscode-symbolIcon-classForeground);
                margin-bottom: 10px;
                font-size: 1.1em;
            }
            
            .field {
                display: flex;
                align-items: baseline;
                margin: 8px 0;
                padding-left: 20px;
            }
            
            .field-name {
                color: var(--vscode-symbolIcon-fieldForeground);
                margin-right: 10px;
                min-width: 150px;
            }
            
            .field-type {
                color: var(--vscode-symbolIcon-typeForeground);
                font-family: var(--vscode-editor-font-family);
            }
            
            .constant {
                display: flex;
                align-items: baseline;
                margin: 8px 0;
                padding-left: 20px;
                color: var(--vscode-symbolIcon-constantForeground);
            }
            
            .constant-name {
                margin-right: 10px;
                min-width: 150px;
                font-weight: bold;
            }
            
            .constant-value {
                font-family: var(--vscode-editor-font-family);
            }
            
            .array-indicator {
                color: var(--vscode-symbolIcon-arrayForeground);
            }
            
            .nested-type {
                border-left: 2px solid var(--vscode-panel-border);
                margin-left: 20px;
                padding-left: 10px;
                margin-top: 10px;
            }
            
            .no-results {
                text-align: center;
                color: var(--vscode-descriptionForeground);
                padding: 40px;
            }
            
            .template-button {
                margin-top: 15px;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            
            .template-button:hover {
                background: var(--vscode-button-secondaryHoverBackground);
            }
            
            .service-section {
                margin-bottom: 30px;
                padding: 15px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border-radius: 4px;
            }
            
            .section-title {
                font-weight: bold;
                color: var(--vscode-symbolIcon-interfaceForeground);
                margin-bottom: 15px;
                font-size: 1.2em;
            }
            
            .template-container {
                margin-top: 20px;
                padding: 15px;
                background: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            
            .template-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .template-title {
                font-weight: bold;
                color: var(--vscode-symbolIcon-variableForeground);
            }
            
            .copy-button {
                padding: 4px 8px;
                font-size: 0.9em;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
            }
            
            .copy-button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            
            .template-content {
                font-family: var(--vscode-editor-font-family);
                font-size: var(--vscode-editor-font-size);
                white-space: pre;
                overflow-x: auto;
                color: var(--vscode-editor-foreground);
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>ROS 2 Message/Service Inspector</h1>
        </div>
        
        <div class="search-section">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('message')">Messages</button>
                <button class="tab" onclick="switchTab('service')">Services</button>
                <button class="tab" onclick="switchTab('action')">Actions</button>
            </div>
            
            <div id="messageSearch" class="search-container">
                <input type="text" id="messageTypeInput" placeholder="Enter message type (e.g., geometry_msgs/Twist)" />
                <button onclick="inspectMessage()">Inspect Message</button>
            </div>
            
            <div id="serviceSearch" class="search-container" style="display: none;">
                <input type="text" id="serviceTypeInput" placeholder="Enter service type (e.g., std_srvs/SetBool)" />
                <button onclick="inspectService()">Inspect Service</button>
            </div>
            
            <div id="actionSearch" class="search-container" style="display: none;">
                <input type="text" id="actionTypeInput" placeholder="Enter action type (e.g., example_interfaces/action/Fibonacci)" />
                <button onclick="inspectAction()">Inspect Action</button>
            </div>
        </div>
        
        <div id="results"></div>
        
        <script>
            const vscode = acquireVsCodeApi();
            let currentTab = 'message';
            let currentDefinition = null;
            let currentMessageType = null;
            
            function switchTab(tab) {
                currentTab = tab;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                event.target.classList.add('active');
                
                document.getElementById('messageSearch').style.display = 'none';
                document.getElementById('serviceSearch').style.display = 'none';
                document.getElementById('actionSearch').style.display = 'none';
                
                if (tab === 'message') {
                    document.getElementById('messageSearch').style.display = 'flex';
                } else if (tab === 'service') {
                    document.getElementById('serviceSearch').style.display = 'flex';
                } else if (tab === 'action') {
                    document.getElementById('actionSearch').style.display = 'flex';
                }
                
                document.getElementById('results').innerHTML = '';
            }
            
            function inspectMessage() {
                const messageType = document.getElementById('messageTypeInput').value.trim();
                if (messageType) {
                    vscode.postMessage({
                        command: 'inspectMessage',
                        messageType: messageType
                    });
                }
            }
            
            function inspectService() {
                const serviceType = document.getElementById('serviceTypeInput').value.trim();
                if (serviceType) {
                    vscode.postMessage({
                        command: 'inspectService',
                        serviceType: serviceType
                    });
                }
            }
            
            function inspectAction() {
                const actionType = document.getElementById('actionTypeInput').value.trim();
                if (actionType) {
                    vscode.postMessage({
                        command: 'inspectAction',
                        actionType: actionType
                    });
                }
            }
            
            function generateTemplate() {
                if (currentMessageType && currentDefinition) {
                    vscode.postMessage({
                        command: 'generateTemplate',
                        messageType: currentMessageType,
                        definition: currentDefinition
                    });
                }
            }
            
            function generateServiceTemplate(type) {
                if (window.currentServiceType) {
                    const definition = type === 'request' ? window.currentServiceRequestDetails : window.currentServiceResponseDetails;
                    const messageType = window.currentServiceType + ' ' + type.charAt(0).toUpperCase() + type.slice(1);
                    vscode.postMessage({
                        command: 'generateTemplate',
                        messageType: messageType,
                        definition: definition
                    });
                }
            }
            
            function generateActionTemplate(type) {
                if (window.currentActionType) {
                    let definition;
                    if (type === 'goal') {
                        definition = window.currentActionGoalDetails;
                    } else if (type === 'result') {
                        definition = window.currentActionResultDetails;
                    } else if (type === 'feedback') {
                        definition = window.currentActionFeedbackDetails;
                    }
                    
                    const messageType = window.currentActionType + ' ' + type.charAt(0).toUpperCase() + type.slice(1);
                    vscode.postMessage({
                        command: 'generateTemplate',
                        messageType: messageType,
                        definition: definition
                    });
                }
            }
            
            function renderMessageDefinition(messageType, details) {
                currentDefinition = details;
                currentMessageType = messageType;
                
                let html = '<div class="definition-container">';
                html += '<h2>' + messageType + '</h2>';
                
                Object.keys(details).forEach(typeName => {
                    const typeDef = details[typeName];
                    html += '<div class="message-type">';
                    html += '<div class="type-header">' + typeName + '</div>';
                    
                    if (typeDef.constants && typeDef.constants.length > 0) {
                        typeDef.constants.forEach(constant => {
                            html += '<div class="constant">';
                            html += '<span class="constant-name">' + constant.name + '</span>';
                            html += '<span class="constant-value">= ' + constant.value + '</span>';
                            html += '</div>';
                        });
                        if (typeDef.fields.length > 0) {
                            html += '<hr style="margin: 10px 0; border-color: var(--vscode-panel-border);">';
                        }
                    }
                    
                    typeDef.fields.forEach(field => {
                        html += '<div class="field">';
                        html += '<span class="field-name">' + field.name + '</span>';
                        html += '<span class="field-type">' + formatFieldType(field.type) + '</span>';
                        html += '</div>';
                    });
                    
                    html += '</div>';
                });
                
                html += "<button class='template-button' onclick='generateTemplate()'>Generate JSON Template</button>";
                html += '</div>';
                
                document.getElementById('results').innerHTML = html;
            }
            
            function renderServiceDefinition(serviceType, requestDetails, responseDetails) {
                let html = '<div class="definition-container">';
                html += '<h2>' + serviceType + '</h2>';
                
                html += '<div class="service-section">';
                html += '<div class="section-title">Request</div>';
                if (Object.keys(requestDetails).length === 0) {
                    html += '<div class="field"><span style="color: var(--vscode-descriptionForeground);">Empty request</span></div>';
                } else {
                    Object.keys(requestDetails).forEach(typeName => {
                        const typeDef = requestDetails[typeName];
                        html += renderTypeDefinition(typeName, typeDef);
                    });
                }
                html += '</div>';
                
                html += '<div class="service-section">';
                html += '<div class="section-title">Response</div>';
                if (Object.keys(responseDetails).length === 0) {
                    html += '<div class="field"><span style="color: var(--vscode-descriptionForeground);">Empty response</span></div>';
                } else {
                    Object.keys(responseDetails).forEach(typeName => {
                        const typeDef = responseDetails[typeName];
                        html += renderTypeDefinition(typeName, typeDef);
                    });
                }
                html += '</div>';
                
                html += '<button class="template-button" onclick="generateServiceTemplate(&quot;request&quot;)">Generate Request Template</button>';
                html += ' ';
                html += '<button class="template-button" onclick="generateServiceTemplate(&quot;response&quot;)">Generate Response Template</button>';
                
                html += '</div>';
                
                window.currentServiceType = serviceType;
                window.currentServiceRequestDetails = requestDetails;
                window.currentServiceResponseDetails = responseDetails;
                
                document.getElementById('results').innerHTML = html;
            }
            
            function renderTypeDefinition(typeName, typeDef) {
                let html = '<div class="message-type">';
                
                if (typeName !== 'Request' && typeName !== 'Response') {
                    html += '<div class="type-header">' + typeName + '</div>';
                }
                
                if (typeDef.constants && typeDef.constants.length > 0) {
                    typeDef.constants.forEach(constant => {
                        html += '<div class="constant">';
                        html += '<span class="constant-name">' + constant.name + '</span>';
                        html += '<span class="constant-value">= ' + constant.value + '</span>';
                        html += '</div>';
                    });
                    if (typeDef.fields.length > 0) {
                        html += '<hr style="margin: 10px 0; border-color: var(--vscode-panel-border);">';
                    }
                }
                
                typeDef.fields.forEach(field => {
                    html += '<div class="field">';
                    html += '<span class="field-name">' + field.name + '</span>';
                    html += '<span class="field-type">' + formatFieldType(field.type) + '</span>';
                    html += '</div>';
                });
                
                html += '</div>';
                return html;
            }
            
            function formatFieldType(type) {
                if (type.endsWith('[]')) {
                    return type.slice(0, -2) + '<span class="array-indicator">[]</span>';
                }
                return type;
            }
            
            function showJsonTemplate(messageType, templateJson) {
                let templateContainer = document.getElementById('templateContainer');
                if (!templateContainer) {
                    const resultsDiv = document.getElementById('results');
                    templateContainer = document.createElement('div');
                    templateContainer.id = 'templateContainer';
                    resultsDiv.parentNode.insertBefore(templateContainer, resultsDiv.nextSibling);
                }
                
                templateContainer.innerHTML = '<div class="template-container">' +
                    '<div class="template-header">' +
                    '<span class="template-title">JSON Template for ' + messageType + '</span>' +
                    '<button class="copy-button" onclick="copyTemplate()">Copy to Clipboard</button>' +
                    '</div>' +
                    '<pre class="template-content" id="templateContent">' + templateJson + '</pre>' +
                    '</div>';
                
                window.currentTemplate = templateJson;
            }
            
            function copyTemplate() {
                if (window.currentTemplate) {
                    navigator.clipboard.writeText(window.currentTemplate).then(() => {
                        const button = document.querySelector('.copy-button');
                        const originalText = button.textContent;
                        button.textContent = 'Copied!';
                        setTimeout(() => {
                            button.textContent = originalText;
                        }, 2000);
                    });
                }
            }
            
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'showMessageDetails':
                        renderMessageDefinition(message.messageType, message.details);
                        break;
                    case 'showServiceDetails':
                        renderServiceDefinition(message.serviceType, message.requestDetails, message.responseDetails);
                        break;
                    case 'showTemplate':
                        showJsonTemplate(message.messageType, message.template);
                        break;
                    case 'showActionDetails':
                        renderActionDefinition(message.actionType, message.goalDetails, message.resultDetails, message.feedbackDetails);
                        break;
                    case 'showActionInspector':
                        showActionTypePrompt(message.actionName);
                        break;
                }
            });
            
            document.getElementById('messageTypeInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') inspectMessage();
            });
            
            document.getElementById('serviceTypeInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') inspectService();
            });
            
            document.getElementById('actionTypeInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') inspectAction();
            });
            
            function renderActionDefinition(actionType, goalDetails, resultDetails, feedbackDetails) {
                let html = '<div class="definition-container">';
                html += '<h2>' + actionType + '</h2>';
                
                html += '<div class="service-section">';
                html += '<div class="section-title">Goal</div>';
                if (Object.keys(goalDetails).length === 0) {
                    html += '<div class="field"><span style="color: var(--vscode-descriptionForeground);">Empty goal</span></div>';
                } else {
                    Object.keys(goalDetails).forEach(typeName => {
                        const typeDef = goalDetails[typeName];
                        html += renderTypeDefinition(typeName, typeDef);
                    });
                }
                html += '</div>';
                
                html += '<div class="service-section">';
                html += '<div class="section-title">Result</div>';
                if (Object.keys(resultDetails).length === 0) {
                    html += '<div class="field"><span style="color: var(--vscode-descriptionForeground);">Empty result</span></div>';
                } else {
                    Object.keys(resultDetails).forEach(typeName => {
                        const typeDef = resultDetails[typeName];
                        html += renderTypeDefinition(typeName, typeDef);
                    });
                }
                html += '</div>';
                
                html += '<div class="service-section">';
                html += '<div class="section-title">Feedback</div>';
                if (Object.keys(feedbackDetails).length === 0) {
                    html += '<div class="field"><span style="color: var(--vscode-descriptionForeground);">Empty feedback</span></div>';
                } else {
                    Object.keys(feedbackDetails).forEach(typeName => {
                        const typeDef = feedbackDetails[typeName];
                        html += renderTypeDefinition(typeName, typeDef);
                    });
                }
                html += '</div>';
                
                html += '<button class="template-button" onclick="generateActionTemplate(&quot;goal&quot;)">Generate Goal Template</button>';
                html += ' ';
                html += '<button class="template-button" onclick="generateActionTemplate(&quot;result&quot;)">Generate Result Template</button>';
                html += ' ';
                html += '<button class="template-button" onclick="generateActionTemplate(&quot;feedback&quot;)">Generate Feedback Template</button>';
                
                html += '</div>';
                
                window.currentActionType = actionType;
                window.currentActionGoalDetails = goalDetails;
                window.currentActionResultDetails = resultDetails;
                window.currentActionFeedbackDetails = feedbackDetails;
                
                document.getElementById('results').innerHTML = html;
            }
            
            function showActionTypePrompt(actionName) {
                const html = '<div class="definition-container">' +
                    '<h3>Action Type Required</h3>' +
                    '<p>To inspect the action <strong>' + actionName + '</strong>, please enter its type.</p>' +
                    '<p>Action types follow the format: <code>package_name/action/ActionName</code></p>' +
                    '<p>Example: <code>example_interfaces/action/Fibonacci</code></p>' +
                    '<p>Please enter the action type in the input field above and click "Inspect Action".</p>' +
                    '</div>';
                document.getElementById('results').innerHTML = html;
            }
        </script>
    </body>
    </html>`;
    
    return html;
  }
}

module.exports = MessageInspectorPanel;