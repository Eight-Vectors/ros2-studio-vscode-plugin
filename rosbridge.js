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
  }

  connect() {
    if (this.ros && this.ros.isConnected) {
      this.pChannel.appendLine("Already connected to rosbridge");
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.ros = new ROSLIB.Ros({
        url: this.url,
      });

      // Attempting to connect
      this.ros.on("connection", () => {
        this.pChannel.appendLine("Connected to ROS bridge");
        vscode.window.showInformationMessage("Connected to ROS bridge");
        resolve();
      });

      this.ros.on("error", (error) => {
        this.pChannel.appendLine(`Rosbridge error: ${error}`);
        vscode.window.showErrorMessage(`ROS bridge error: ${error}`);
        reject(error);
      });

      this.ros.on("close", () => {
        this.pChannel.appendLine("Disconnected from rosbridge server");
        vscode.window.showWarningMessage("Disconnected from ROS bridge");
        this.reconnect();
      });
    });
  }

  reconnect() {
    if (this.ros && !this.ros.isConnected) {
      this.pChannel.appendLine("Attempting to reconnect...");
      setTimeout(() => {
        this.connect();
      }, 2000);
    }
  }

  subscribeTopic(topicName, messageType, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      return null;
    }

    const existingTopic = this.topics.get(topicName);
    if (existingTopic) {
      existingTopic.subscribe(callback);
      this.subscriptions.set(topicName, callback);
      this.pChannel.appendLine(`Subscribed to existing topic: ${topicName}`);
      return existingTopic;
    }

    this.pChannel.appendLine(
      `Subscribing to topic: ${topicName} [${messageType}]`
    );

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType,
    });

    topic.subscribe(callback);
    this.topics.set(topicName, topic);
    this.subscriptions.set(topicName, callback);
    this.pChannel.appendLine(
      `Subscribed to topic: ${topicName} [${messageType}]`
    );

    return topic;
  }

  unsubscribeTopic(topicName) {
    const topic = this.topics.get(topicName);
    const callback = this.subscriptions.get(topicName);

    if (topic && callback) {
      topic.unsubscribe(callback);
      this.topics.delete(topicName);
      this.subscriptions.delete(topicName);
      this.pChannel.appendLine(`Unsubscribed from topic: ${topicName}`);
      return true;
    }

    this.pChannel.appendLine(`Topic not found for unsubscribe: ${topicName}`);
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
    this.pChannel.appendLine(`Published to topic: ${topicName}`);

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
        this.pChannel.appendLine(`Got details for node: ${nodeName}`);
        // Convert to object format for backward compatibility
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

  // Get all parameters for a ROS2 node
  async getParameters(nodeName, callback) {
    if (!this.ros || !this.ros.isConnected) {
      this.pChannel.appendLine("No rosbridge connection available");
      callback([], "No connection");
      return;
    }

    // Use ROS2 list_parameters service
    const listParamsService = new ROSLIB.Service({
      ros: this.ros,
      name: `${nodeName}/list_parameters`,
      serviceType: "rcl_interfaces/srv/ListParameters",
    });

    const request = new ROSLIB.ServiceRequest({});

    listParamsService.callService(
      request,
      (result) => {
        // The list of parameter names is in result.result.names
        const paramNames = result.result.names || [];

        this.pChannel.appendLine(
          `Found ${paramNames.length} parameters for node: ${nodeName}`
        );

        if (paramNames.length === 0) {
          callback([], null);
          return;
        }

        // Now get the values using get_parameters service
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
            // Log the raw result to understand the structure
            this.pChannel.appendLine(
              `Raw parameter values: ${JSON.stringify(getResult.values[0])}`
            );

            // Process the parameter values
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
        // If ROS2 services fail, return manual mode
        callback([], "manual_mode");
      }
    );
  }

  // Extract value from ROS2 parameter based on type
  _extractROS2ParamValue(paramValue) {
    // ROS2 parameter type constants:
    // 0: PARAMETER_NOT_SET
    // 1: PARAMETER_BOOL
    // 2: PARAMETER_INTEGER
    // 3: PARAMETER_DOUBLE
    // 4: PARAMETER_STRING
    // 5: PARAMETER_BYTE_ARRAY
    // 6: PARAMETER_BOOL_ARRAY
    // 7: PARAMETER_INTEGER_ARRAY
    // 8: PARAMETER_DOUBLE_ARRAY
    // 9: PARAMETER_STRING_ARRAY

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
        // If no type field, fall back to checking which value is defined
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

  // Get multiple parameter values given an array of parameter names
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

  // Set a parameter for a specific ROS2 node
  async setNodeParameter(nodeName, paramName, value, callback) {
    if (!this.ros || !this.ros.isConnected) {
      callback(false, "No connection");
      return;
    }

    // Get original parameter type to preserve it
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

        // For ROS2, use the node's set_parameters service
        const setParamsService = new ROSLIB.Service({
          ros: this.ros,
          name: `${nodeName}/set_parameters`,
          serviceType: "rcl_interfaces/srv/SetParameters",
        });

        // Create the parameter value in ROS2 format with the original type
        const paramValue = this._createROS2ParamValue(value, originalType);

        // Log for debugging
        this.pChannel.appendLine(
          `Setting parameter ${paramName}: value=${value}, originalType=${originalType}, paramValue=${JSON.stringify(
            paramValue
          )}`
        );

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
            // Check if the parameter was set successfully
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
            // Fallback to ROS1 approach
            this.setParameter(paramName, value, callback);
          }
        );
      },
      (error) => {
        this.pChannel.appendLine(`Error getting parameter type: ${error}`);
        // Try without type info
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

  // Create ROS2 parameter value structure with correct type
  _createROS2ParamValue(value, originalType = null) {
    const paramValue = {
      type: 0, // PARAMETER_NOT_SET
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

    // If we have the original type, use it to determine how to handle numbers
    if (originalType !== null && typeof value === "number") {
      if (originalType === 2) {
        // PARAMETER_INTEGER
        paramValue.type = 2;
        paramValue.integer_value = Math.round(value);
      } else if (originalType === 3) {
        // PARAMETER_DOUBLE
        paramValue.type = 3;
        paramValue.double_value = value;
      }
    } else if (typeof value === "boolean") {
      paramValue.type = 1; // PARAMETER_BOOL
      paramValue.bool_value = value;
    } else if (typeof value === "number") {
      // Without original type info, always treat numbers as doubles to be safe
      paramValue.type = 3; // PARAMETER_DOUBLE
      paramValue.double_value = value;
    } else if (typeof value === "string") {
      paramValue.type = 4; // PARAMETER_STRING
      paramValue.string_value = value;
    } else if (Array.isArray(value)) {
      // Handle arrays based on the type of the first element
      if (value.length > 0) {
        if (typeof value[0] === "boolean") {
          paramValue.type = 6; // PARAMETER_BOOL_ARRAY
          paramValue.bool_array_value = value;
        } else if (typeof value[0] === "number") {
          // For array of numbers, check original type
          if (originalType === 7) {
            // PARAMETER_INTEGER_ARRAY
            paramValue.type = 7;
            paramValue.integer_array_value = value.map((v) => Math.round(v));
          } else {
            // Default to double array
            paramValue.type = 8; // PARAMETER_DOUBLE_ARRAY
            paramValue.double_array_value = value;
          }
        } else if (typeof value[0] === "string") {
          paramValue.type = 9; // PARAMETER_STRING_ARRAY
          paramValue.string_array_value = value;
        }
      }
    }

    return paramValue;
  }

  disconnect() {
    if (this.ros) {
      this.topics.forEach((topic, topicName) => {
        const callback = this.subscriptions.get(topicName);
        if (callback) {
          topic.unsubscribe(callback);
        }
      });

      this.topics.clear();
      this.subscriptions.clear();

      this.ros.close();
      this.ros = null;
      this.pChannel.appendLine("Disconnected from rosbridge server");
    }
  }
}

module.exports = RosbridgeClient;
