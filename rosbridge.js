const ROSLIB = require("roslib");
const vscode = require("vscode");

class RosbridgeClient {
  constructor(url = "ws://localhost:9090", pChannel) {
    this.url = url;
    this.pChannel = pChannel;
    this.ros = null;
    this.topics = new Map();
    this.subscriptions = new Map();
    this.connectionPromise = this.connect();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = this._getMaxReconnectAttempts();
    this.reconnectDelay = 1000; // Start with 1 second
    this.isReconnecting = false;
    this.shouldReconnect = true;
    this.reconnectTimeout = null;
    this.isManuallyConnecting = false;
    this.eventHandlers = {
      connection: null,
      error: null,
      close: null,
    };
    this.onConnectionCallback = null;
    this.onReconnectionCallback = null;
    this.onConnectionStatusChange = null;
  }

  setConnectionCallbacks(onConnection, onReconnection, onStatusChange) {
    this.onConnectionCallback = onConnection;
    this.onReconnectionCallback = onReconnection;
    this.onConnectionStatusChange = onStatusChange;
  }

  _getMaxReconnectAttempts() {
    const config = vscode.workspace.getConfiguration("vscode-ros-extension");
    const attempts = config.get("maxReconnectAttempts", 10);
    return attempts === 0 ? Infinity : attempts;
  }

  updateMaxReconnectAttempts() {
    this.maxReconnectAttempts = this._getMaxReconnectAttempts();
  }

  formatError(error) {
    // Handle AggregateError specifically
    if (error && error.name === "AggregateError" && error.errors) {
      const errorMessages = error.errors.map((err) => {
        if (err instanceof Error) {
          return err.message;
        } else if (typeof err === "object" && err !== null) {
          return err.message || err.error || err.reason || JSON.stringify(err);
        }
        return String(err);
      });
      return `Errors occurred: ${errorMessages.join("; ")}`;
    }

    if (error instanceof Error) {
      return error.message;
    } else if (typeof error === "object" && error !== null) {
      if (error.message) return error.message;
      if (error.error) return error.error;
      if (error.reason) return error.reason;
      if (error.code) return `Error code: ${error.code}`;
      return JSON.stringify(error);
    } else if (typeof error === "string") {
      return error;
    }
    return String(error);
  }

  connect() {
    if (this.ros && this.ros.isConnected) {
      return Promise.resolve();
    }

    // Prevent multiple simultaneous connections
    if (this.isManuallyConnecting) {
      return Promise.reject(new Error("Connection already in progress"));
    }

    this.isManuallyConnecting = true;

    // Notify about connection attempt starting
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange("connecting");
    }

    // Clean up old event handlers if they exist
    this.cleanupEventHandlers();

    return new Promise((resolve, reject) => {
      this.ros = new ROSLIB.Ros({
        url: this.url,
      });

      // Store event handlers for cleanup
      this.eventHandlers.connection = () => {
        vscode.window.showInformationMessage("Connected to ROS 2 bridge");
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.isReconnecting = false;
        this.isManuallyConnecting = false;

        // Notify about successful connection
        if (this.onConnectionStatusChange) {
          this.onConnectionStatusChange("connected");
        }

        if (this.onConnectionCallback) {
          this.onConnectionCallback();
        }

        resolve();
      };

      this.eventHandlers.error = (error) => {
        const errorMessage = this.formatError(error);

        // Log error to output channel
        this.pChannel.appendLine(
          `ROS 2 bridge connection error: ${errorMessage}`
        );

        // Auto-show the output channel on error
        this.pChannel.show(true);

        this.isManuallyConnecting = false;

        // Notify about connection failure
        if (this.onConnectionStatusChange) {
          this.onConnectionStatusChange("disconnected");
        }

        vscode.window.showErrorMessage(`ROS 2 bridge error: ${errorMessage}`);
        reject(error);
      };

      this.eventHandlers.close = () => {
        if (this.shouldReconnect) {
          vscode.window.showWarningMessage(
            "Disconnected from ROS 2 bridge. Attempting to reconnect..."
          );
          this.handleReconnection();
        } else {
          vscode.window.showWarningMessage("Disconnected from ROS 2 bridge");
        }
      };

      this.ros.on("connection", this.eventHandlers.connection);
      this.ros.on("error", this.eventHandlers.error);
      this.ros.on("close", this.eventHandlers.close);
    });
  }

  handleReconnection() {
    if (this.isReconnecting || !this.shouldReconnect) {
      return;
    }

    this.isReconnecting = true;

    // Notify about reconnection attempt
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange("reconnecting");
    }

    // Update context for UI
    vscode.commands.executeCommand(
      "setContext",
      "vscode-ros-extension.isReconnecting",
      true
    );

    if (
      this.maxReconnectAttempts !== Infinity &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      vscode.window.showErrorMessage(
        `Failed to reconnect to ROS 2 bridge after ${this.maxReconnectAttempts} attempts. Please check your rosbridge server.`
      );
      this.isReconnecting = false;
      vscode.commands.executeCommand(
        "setContext",
        "vscode-ros-extension.isReconnecting",
        false
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    const maxAttemptsStr =
      this.maxReconnectAttempts === Infinity ? "∞" : this.maxReconnectAttempts;
    this.pChannel.appendLine(
      `Reconnection attempt ${this.reconnectAttempts}/${maxAttemptsStr} in ${
        delay / 1000
      } seconds...`
    );

    this.reconnectTimeout = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connectionPromise = this.connect()
          .then(() => {
            vscode.window.showInformationMessage(
              "Successfully reconnected to ROS 2 bridge"
            );
            this.resubscribeTopics();

            if (this.onReconnectionCallback) {
              this.onReconnectionCallback();
            }
          })
          .catch(() => {
            this.handleReconnection();
          });
      } else {
        this.isReconnecting = false;
        vscode.commands.executeCommand(
          "setContext",
          "vscode-ros-extension.isReconnecting",
          false
        );
      }
    }, delay);
  }

  resubscribeTopics() {
    const topicsToResubscribe = [];

    this.topics.forEach((topic, topicName) => {
      const callback = this.subscriptions.get(topicName);
      if (callback) {
        topicsToResubscribe.push({
          name: topic.name,
          messageType: topic.messageType,
          callback: callback,
        });

        topic.unsubscribe(callback);
      }
      topic.ros = null;
    });

    this.topics.clear();
    this.subscriptions.clear();

    topicsToResubscribe.forEach((topicInfo) => {
      this.pChannel.appendLine(`Resubscribing to topic: ${topicInfo.name}`);
      this.subscribeTopic(
        topicInfo.name,
        topicInfo.messageType,
        topicInfo.callback
      );
    });
  }

  subscribeTopic(topicName, messageType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      return null;
    }

    const existingTopic = this.topics.get(topicName);
    if (existingTopic) {
      // Unsubscribe previous callback if exists
      const oldCallback = this.subscriptions.get(topicName);
      if (oldCallback) {
        existingTopic.unsubscribe(oldCallback);
      }
      existingTopic.subscribe(callback);
      this.subscriptions.set(topicName, callback);
      return existingTopic;
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType,
      throttle_rate: 500, // Throttle to max 2 messages per second for better performance
      queue_size: 1, // Only keep latest message
      compression: "none",
    });

    topic.subscribe(callback);
    this.topics.set(topicName, topic);
    this.subscriptions.set(topicName, callback);

    return topic;
  }

  unsubscribeTopic(topicName) {
    const topic = this.topics.get(topicName);
    const callback = this.subscriptions.get(topicName);

    if (topic && callback) {
      topic.unsubscribe(callback);
      // Properly dispose of the topic to free resources
      topic.ros = null;
      this.topics.delete(topicName);
      this.subscriptions.delete(topicName);
      return true;
    }

    return false;
  }

  publishTopic(topicName, messageType, message) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      return false;
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType,
    });

    const rosMessage = new ROSLIB.Message(message);
    topic.publish(rosMessage);

    return true;
  }

  getNodeDetails(nodeName, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine(
        "No rosbridge connection available for getNodeDetails"
      );
      callback({ publishing: [], subscribing: [], services: [] });
      return;
    }

    this.ros.getNodeDetails(
      nodeName,
      (subscriptions, publications, services) => {
        const details = {
          subscribing: subscriptions || [],
          publishing: publications || [],
          services: services || [],
        };
        callback(details);
      },
      (error) => {
        this.pChannel.appendLine(
          `Error getting node details for ${nodeName}: ${error}`
        );
        callback({ publishing: [], subscribing: [], services: [] });
      }
    );
  }

  getNodes(callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback([]);
      return;
    }

    this.ros.getNodes(
      (nodes) => {
        callback(nodes);
      },
      (error) => {
        this.pChannel.appendLine(`Error getting nodes: ${error}`);
        callback([]);
      }
    );
  }

  getTopics(callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      callback([]);
      return;
    }

    this.ros.getTopics(
      (result) => {
        const topics = result.topics || [];
        const types = result.types || [];
        const topicsWithTypes = topics.map((topic, index) => ({
          name: topic,
          type: types[index] || "unknown",
        }));

        callback(topicsWithTypes);
      },
      (error) => {
        this.pChannel.appendLine(`Error getting topics: ${error}`);
        callback([]);
      }
    );
  }

  getServices(callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback([]);
      return;
    }

    this.ros.getServices(
      (services) => {
        callback(services);
      },
      (error) => {
        this.pChannel.appendLine(`Error getting services: ${error}`);
        callback([]);
      }
    );
  }

  callService(serviceName, serviceType, request, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      callback(null, "No connection");
      return;
    }

    const service = new ROSLIB.Service({
      ros: this.ros,
      name: serviceName,
      serviceType: serviceType,
    });

    const serviceRequest = new ROSLIB.ServiceRequest(request);

    service.callService(
      serviceRequest,
      (result) => {
        this.pChannel.appendLine(`Service call successful: ${serviceName}`);
        callback(result, null);
      },
      (error) => {
        this.pChannel.appendLine(`Service call failed: ${error}`);
        callback(null, error);
      }
    );
  }

  isConnected() {
    return this.ros && this.ros.isConnected;
  }

  async waitForConnection() {
    return this.connectionPromise;
  }

  async getParameters(nodeName, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      callback([], "No connection");
      return;
    }

    const listParamsService = new ROSLIB.Service({
      ros: this.ros,
      name: `${nodeName}/list_parameters`,
      serviceType: "rcl_interfaces/srv/ListParameters",
    });

    const request = new ROSLIB.ServiceRequest({});

    listParamsService.callService(
      request,
      (result) => {
        const paramNames = result.result.names || [];

        if (paramNames.length === 0) {
          callback([], null);
          return;
        }

        const getParamsService = new ROSLIB.Service({
          ros: this.ros,
          name: `${nodeName}/get_parameters`,
          serviceType: "rcl_interfaces/srv/GetParameters",
        });

        const getRequest = new ROSLIB.ServiceRequest({
          names: paramNames,
        });

        getParamsService.callService(
          getRequest,
          (getResult) => {
            const parameters = paramNames.map((name, index) => {
              const value = this._extractROS2ParamValue(
                getResult.values[index]
              );
              return {
                name: name,
                value: value,
                error: null,
              };
            });

            this.pChannel.appendLine(
              `Got ${parameters.length} parameter values for node: ${nodeName}`
            );
            callback(parameters, null);
          },
          (error) => {
            this.pChannel.appendLine(
              `Error getting parameter values: ${error}`
            );
            callback([], error);
          }
        );
      },
      (error) => {
        this.pChannel.appendLine(
          `Error listing parameters for ${nodeName}: ${error}`
        );
        callback([], "manual_mode");
      }
    );
  }

  _extractROS2ParamValue(paramValue) {
    const type = paramValue.type;

    switch (type) {
      case 1:
        return paramValue.bool_value;
      case 2:
        return paramValue.integer_value;
      case 3:
        return paramValue.double_value;
      case 4:
        return paramValue.string_value;
      case 5:
        return paramValue.byte_array_value;
      case 6:
        return paramValue.bool_array_value;
      case 7:
        return paramValue.integer_array_value;
      case 8:
        return paramValue.double_array_value;
      case 9:
        return paramValue.string_array_value;
      default:
        if (paramValue.bool_value !== undefined) return paramValue.bool_value;
        if (paramValue.integer_value !== undefined)
          return paramValue.integer_value;
        if (paramValue.double_value !== undefined)
          return paramValue.double_value;
        if (paramValue.string_value !== undefined)
          return paramValue.string_value;
        return null;
    }
  }

  getParameterValues(paramNames, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback([], "No connection");
      return;
    }

    const paramPromises = paramNames.map((paramName) => {
      return new Promise((resolve) => {
        this.getParameter(paramName, (value, error) => {
          resolve({
            name: paramName,
            value: error ? null : value,
            error: error,
          });
        });
      });
    });

    Promise.all(paramPromises).then((parameters) => {
      this.pChannel.appendLine(`Got ${parameters.length} parameter values`);
      callback(parameters, null);
    });
  }

  getParameter(paramName, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(null, "No connection");
      return;
    }

    const param = new ROSLIB.Param({
      ros: this.ros,
      name: paramName,
    });

    param.get(
      (value) => {
        this.pChannel.appendLine(
          `Got parameter ${paramName}: ${JSON.stringify(value)}`
        );
        callback(value, null);
      },
      (error) => {
        this.pChannel.appendLine(
          `Error getting parameter ${paramName}: ${error}`
        );
        callback(null, error);
      }
    );
  }

  setParameter(paramName, value, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(false, "No connection");
      return;
    }

    const param = new ROSLIB.Param({
      ros: this.ros,
      name: paramName,
    });

    param.set(
      value,
      () => {
        this.pChannel.appendLine(
          `Set parameter ${paramName} to: ${JSON.stringify(value)}`
        );
        callback(true, null);
      },
      (error) => {
        this.pChannel.appendLine(
          `Error setting parameter ${paramName}: ${error}`
        );
        callback(false, error);
      }
    );
  }

  async setNodeParameter(nodeName, paramName, value, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(false, "No connection");
      return;
    }

    const getParamsService = new ROSLIB.Service({
      ros: this.ros,
      name: `${nodeName}/get_parameters`,
      serviceType: "rcl_interfaces/srv/GetParameters",
    });

    const getRequest = new ROSLIB.ServiceRequest({
      names: [paramName],
    });

    getParamsService.callService(
      getRequest,
      (getResult) => {
        let originalType = 0;
        if (getResult.values && getResult.values[0]) {
          originalType = getResult.values[0].type;
        }

        const setParamsService = new ROSLIB.Service({
          ros: this.ros,
          name: `${nodeName}/set_parameters`,
          serviceType: "rcl_interfaces/srv/SetParameters",
        });

        const paramValue = this._createROS2ParamValue(value, originalType);

        const request = new ROSLIB.ServiceRequest({
          parameters: [
            {
              name: paramName,
              value: paramValue,
            },
          ],
        });

        setParamsService.callService(
          request,
          (result) => {
            if (
              result.results &&
              result.results[0] &&
              result.results[0].successful
            ) {
              this.pChannel.appendLine(
                `Set parameter ${paramName} to: ${JSON.stringify(value)}`
              );
              callback(true, null);
            } else {
              const reason = result.results[0]?.reason || "Unknown error";
              this.pChannel.appendLine(
                `Failed to set parameter ${paramName}: ${reason}`
              );
              callback(false, reason);
            }
          },
          (error) => {
            this.pChannel.appendLine(
              `Error calling set_parameters service: ${error}`
            );
            this.setParameter(paramName, value, callback);
          }
        );
      },
      (error) => {
        this.pChannel.appendLine(`Error getting parameter type: ${error}`);
        this._setNodeParameterWithoutType(nodeName, paramName, value, callback);
      }
    );
  }

  _setNodeParameterWithoutType(nodeName, paramName, value, callback) {
    const setParamsService = new ROSLIB.Service({
      ros: this.ros,
      name: `${nodeName}/set_parameters`,
      serviceType: "rcl_interfaces/srv/SetParameters",
    });

    const paramValue = this._createROS2ParamValue(value);

    const request = new ROSLIB.ServiceRequest({
      parameters: [
        {
          name: paramName,
          value: paramValue,
        },
      ],
    });

    setParamsService.callService(
      request,
      (result) => {
        if (
          result.results &&
          result.results[0] &&
          result.results[0].successful
        ) {
          this.pChannel.appendLine(
            `Set parameter ${paramName} to: ${JSON.stringify(value)}`
          );
          callback(true, null);
        } else {
          const reason = result.results[0]?.reason || "Unknown error";
          this.pChannel.appendLine(
            `Failed to set parameter ${paramName}: ${reason}`
          );
          callback(false, reason);
        }
      },
      (error) => {
        this.pChannel.appendLine(
          `Error calling set_parameters service: ${error}`
        );
        this.setParameter(paramName, value, callback);
      }
    );
  }

  _createROS2ParamValue(value, originalType = null) {
    const paramValue = {
      type: 0,
      bool_value: false,
      integer_value: 0,
      double_value: 0.0,
      string_value: "",
      byte_array_value: [],
      bool_array_value: [],
      integer_array_value: [],
      double_array_value: [],
      string_array_value: [],
    };

    if (originalType !== null && typeof value === "number") {
      if (originalType === 2) {
        paramValue.type = 2;
        paramValue.integer_value = Math.round(value);
      } else if (originalType === 3) {
        paramValue.type = 3;
        paramValue.double_value = value;
      }
    } else if (typeof value === "boolean") {
      paramValue.type = 1;
      paramValue.bool_value = value;
    } else if (typeof value === "number") {
      paramValue.type = 3;
      paramValue.double_value = value;
    } else if (typeof value === "string") {
      paramValue.type = 4;
      paramValue.string_value = value;
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        if (typeof value[0] === "boolean") {
          paramValue.type = 6;
          paramValue.bool_array_value = value;
        } else if (typeof value[0] === "number") {
          if (originalType === 7) {
            paramValue.type = 7;
            paramValue.integer_array_value = value.map((v) => Math.round(v));
          } else {
            paramValue.type = 8;
            paramValue.double_array_value = value;
          }
        } else if (typeof value[0] === "string") {
          paramValue.type = 9;
          paramValue.string_array_value = value;
        }
      }
    }

    return paramValue;
  }

  getMessageDetails(messageType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(null, "No connection");
      return;
    }

    const service = new ROSLIB.Service({
      ros: this.ros,
      name: "/rosapi/message_details",
      serviceType: "rosapi/MessageDetails",
    });

    const request = new ROSLIB.ServiceRequest({
      type: messageType,
    });

    service.callService(
      request,
      (result) => {
        const details = this._parseMessageDefinition(result.typedefs || []);
        callback(details, null);
      },
      (error) => {
        callback(null, error);
      }
    );
  }

  getServiceDetails(serviceType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(null, "No connection");
      return;
    }

    const service = new ROSLIB.Service({
      ros: this.ros,
      name: "/rosapi/service_type",
      serviceType: "rosapi/ServiceType",
    });

    const request = new ROSLIB.ServiceRequest({
      service: serviceType,
    });

    service.callService(
      request,
      (result) => {
        callback(result.type, null);
      },
      (error) => {
        callback(null, error);
      }
    );
  }

  getServiceRequestDetails(serviceType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(null, "No connection");
      return;
    }

    const requestService = new ROSLIB.Service({
      ros: this.ros,
      name: "/rosapi/service_request_details",
      serviceType: "rosapi/ServiceRequestDetails",
    });

    const request = new ROSLIB.ServiceRequest({
      type: serviceType,
    });

    requestService.callService(
      request,
      (result) => {
        const details = this._parseMessageDefinition(result.typedefs || []);
        callback(details, null);
      },
      (error) => {
        callback(null, error);
      }
    );
  }

  getServiceResponseDetails(serviceType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(null, "No connection");
      return;
    }

    const responseService = new ROSLIB.Service({
      ros: this.ros,
      name: "/rosapi/service_response_details",
      serviceType: "rosapi/ServiceResponseDetails",
    });

    const request = new ROSLIB.ServiceRequest({
      type: serviceType,
    });

    responseService.callService(
      request,
      (result) => {
        const details = this._parseMessageDefinition(result.typedefs || []);
        callback(details, null);
      },
      (error) => {
        callback(null, error);
      }
    );
  }

  _parseMessageDefinition(typedefs) {
    const parsed = {};

    typedefs.forEach((typedef) => {
      const type = typedef.type;
      const fieldList = typedef.fieldnames || [];
      const fieldTypes = typedef.fieldtypes || [];
      const examples = typedef.examples || [];
      const constnames = typedef.constnames || [];
      const constvalues = typedef.constvalues || [];

      const fieldarraylen = typedef.fieldarraylen || [];

      const fields = [];
      for (let i = 0; i < fieldList.length; i++) {
        if (
          fieldList[i] === "SLOT_TYPES" ||
          fieldList[i] === "_slot_types" ||
          fieldList[i].startsWith("_")
        ) {
          continue;
        }

        let fieldType = fieldTypes[i];
        const arrayLen = fieldarraylen[i];

        if (arrayLen === 0) {
          fieldType = fieldType + "[]";
        } else if (arrayLen > 0) {
          fieldType = fieldType + `[${arrayLen}]`;
        }

        fields.push({
          name: fieldList[i],
          type: fieldType,
          example: examples[i] || null,
        });
      }

      const constants = [];
      for (let i = 0; i < constnames.length; i++) {
        if (constnames[i] === "SLOT_TYPES" || constnames[i].startsWith("_")) {
          continue;
        }

        if (fieldList.includes(constnames[i])) {
          continue;
        }

        constants.push({
          name: constnames[i],
          value: constvalues[i],
        });
      }

      parsed[type] = {
        fields: fields,
        constants: constants,
      };
    });

    return parsed;
  }

  cleanupEventHandlers() {
    if (this.ros) {
      if (this.eventHandlers.connection) {
        this.ros.off("connection", this.eventHandlers.connection);
      }
      if (this.eventHandlers.error) {
        this.ros.off("error", this.eventHandlers.error);
      }
      if (this.eventHandlers.close) {
        this.ros.off("close", this.eventHandlers.close);
      }
    }
    this.eventHandlers = {
      connection: null,
      error: null,
      close: null,
    };
  }

  stopReconnection() {
    this.shouldReconnect = false;
    this.isReconnecting = false;
    this.isManuallyConnecting = false; // Reset this flag too

    // Notify about stopping reconnection
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange("disconnected");
    }

    // Clear any pending reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Close the current connection if it exists
    if (this.ros) {
      this.cleanupEventHandlers();
      this.ros.close();
      this.ros = null;
    }

    vscode.commands.executeCommand(
      "setContext",
      "vscode-ros-extension.isReconnecting",
      false
    );

    this.pChannel.appendLine("Stopped reconnection attempts");
    vscode.window.showInformationMessage("Stopped reconnection attempts");
  }

  forceReset() {
    this.pChannel.appendLine("Force resetting connection...");

    // First disconnect completely
    this.disconnect();

    // Reset connection state
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.shouldReconnect = true;
    this.isManuallyConnecting = false;

    // Reconnect
    return this.connect();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.isManuallyConnecting = false;

    // Clear any pending reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Notify about disconnection
    if (this.onConnectionStatusChange) {
      this.onConnectionStatusChange("disconnected");
    }

    // Update context
    vscode.commands.executeCommand(
      "setContext",
      "vscode-ros-extension.isReconnecting",
      false
    );

    if (this.ros) {
      // Unsubscribe and clean up all topics
      this.topics.forEach((topic, topicName) => {
        const callback = this.subscriptions.get(topicName);
        if (callback) {
          topic.unsubscribe(callback);
        }
        // Properly dispose of the topic
        topic.ros = null;
      });

      this.topics.clear();
      this.subscriptions.clear();

      // Clean up event handlers
      this.cleanupEventHandlers();

      this.ros.close();
      this.ros = null;
    }
  }
}

module.exports = RosbridgeClient;
