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

    // Add debug logging for the callback
    const wrappedCallback = (message) => {
      this.pChannel.appendLine(`Received message on ${topicName}`);
      callback(message);
    };

    topic.subscribe(wrappedCallback);
    this.topics.set(topicName, topic);
    this.subscriptions.set(topicName, wrappedCallback);
    this.pChannel.appendLine(
      `Subscribed to topic: ${topicName} [${messageType}]`
    );

    // Test if subscription is active
    setTimeout(() => {
      this.pChannel.appendLine(
        `Topic ${topicName} subscription active: ${topic.isAdvertised}`
      );
    }, 1000);

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

        // this.pChannel.appendLine(`Result: ${JSON.stringify(result, null, 2)}`);
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
