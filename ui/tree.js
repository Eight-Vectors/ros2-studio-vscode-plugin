const vscode = require("vscode");
const { extensionHandle } = require("../utils/helpers");

class Item extends vscode.TreeItem {
  constructor(label, collapsibleState, command) {
    super(label, collapsibleState);
    this.command = command;
  }
}

class Tree extends Item {
  constructor(address, collapsibleState) {
    super(address, collapsibleState);
    this.address = address;
    this.contextValue = "nodeTree";
  }
}

class Node extends Item {
  constructor(label, address, collapsibleState) {
    super(label, collapsibleState);
    this.address = address;
    this.contextValue = "node";
  }
}

class Topic extends Item {
  constructor(label, node, collapsibleState) {
    super(label, collapsibleState);
    this.node = node;
    this.contextValue = "topic";
  }
}

class Publisher extends vscode.TreeItem {
  constructor(
    label,
    nodeLabel,
    address,
    isChecked,
    collapsibleState,
    command,
    messageType = null
  ) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.isChecked = isChecked;
    this.command = command;
    this.messageType = messageType;
    this.contextValue = "publisher";
    this.updateIcon();
  }

  updateIcon() {
    this.iconPath = new vscode.ThemeIcon(
      this.isChecked ? "check" : "circle-outline"
    );
  }

  toggleChecked() {
    this.isChecked = !this.isChecked;
    this.updateIcon();
  }
}

class Subscriber extends vscode.TreeItem {
  constructor(
    label,
    nodeLabel,
    address,
    isChecked,
    collapsibleState,
    command,
    messageType = null
  ) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.isChecked = isChecked;
    this.command = command;
    this.messageType = messageType;
    this.contextValue = "subscribers";
    this.updateIcon();
  }

  updateIcon() {
    this.iconPath = new vscode.ThemeIcon(
      this.isChecked ? "check" : "circle-outline"
    );
  }

  toggleChecked() {
    this.isChecked = !this.isChecked;
    this.updateIcon();
  }
}

class Service extends vscode.TreeItem {
  constructor(label, nodeLabel, address, collapsibleState, command = null) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.command = command;
    this.contextValue = "service";
  }
}

class ActionClient extends vscode.TreeItem {
  constructor(label, nodeLabel, address, collapsibleState, command = null) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.command = command;
    this.contextValue = "actionClient";
    this.iconPath = new vscode.ThemeIcon("run-all");
  }
}


class PublishersProvider {
  constructor(bridgeAddress, extHandle, channel) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.pubs = {};
    this.subs = {};

    this.channel = channel;

    this.bridgeData = {};
    this.bridgeAddress = bridgeAddress;
    this.rosbridgeClient = null;
  }

  setRosbridgeClient(client) {
    this.rosbridgeClient = client;
    // Rosbridge client set
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      return this.getTrees();
    } else if (element instanceof Tree) {
      return this.getNodes(element);
    } else if (element instanceof Node) {
      return this.getTopics(element);
    } else if (element instanceof Topic) {
      switch (element.label) {
        case "publishers":
          return this.getPublishers(element);
        case "subscribers":
          return this.getSubscribers(element);
        case "service_clients":
          return this.getServiceClients(element);
        case "action_clients":
          return this.getActionClients(element);
        default:
          return Promise.resolve([]);
      }
    } else {
      return Promise.resolve([]);
    }
  }

  toggleCheckbox(lbl) {
    const pub = this.pubs[lbl];
    if (pub) {
      pub.toggleChecked();
      this._onDidChangeTreeData.fire(pub);
    }
    if (pub.isChecked) {
      return [pub.isChecked, pub.address];
    }
    return [false];
  }
  
  resetAllCheckboxes() {
    for (const key in this.pubs) {
      if (this.pubs[key].isChecked) {
        this.pubs[key].isChecked = false;
        this.pubs[key].updateIcon();
      }
    }
    this._onDidChangeTreeData.fire();
  }

  async getTrees() {
    return this.bridgeAddress.map(
      (address) => new Tree(address, vscode.TreeItemCollapsibleState.Expanded)
    );
  }

  async getNodes(tree) {
    // Getting nodes from rosbridge

    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      // Use rosbridge to get nodes
      // Using rosbridge to get nodes
      return new Promise((resolve) => {
        this.rosbridgeClient.getNodes((nodes) => {
          // Received nodes from rosbridge
          const nodeItems = nodes.map(
            (nodeName) =>
              new Node(
                nodeName,
                tree.address,
                vscode.TreeItemCollapsibleState.Collapsed
              )
          );
          resolve(nodeItems);
        });
      });
    } else {
      this.channel.appendLine("No rosbridge connection available");
      return [];
    }
  }

  getTopics(node) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      // Return categories for publishers, subscribers, service_clients, and action_clients
      const categories = ["publishers", "subscribers", "service_clients", "action_clients"];
      return categories.map(
        (label) =>
          new Topic(label, node, vscode.TreeItemCollapsibleState.Collapsed)
      );
    } else {
      return [];
    }
  }

  async getClients() {
    // Not used with rosbridge
    return [];
  }

  async getPublishers(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        const nodeName = topic.node.label;
        
        // Get node-specific details
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const publishingTopics = details.publishing || [];
          
          // Get all topics to find their types
          this.rosbridgeClient.getTopics((allTopics) => {
            // Create a map of topic names to types
            const topicTypeMap = {};
            allTopics.forEach(topicInfo => {
              topicTypeMap[topicInfo.name] = topicInfo.type;
            });
            
            // Create publishers only for topics this node publishes
            const publishers = publishingTopics.map((topicName) => {
              const topicType = topicTypeMap[topicName] || "unknown";
              const pub = new Publisher(
                topicName,
                nodeName,
                topic.node.address,
                false,
                vscode.TreeItemCollapsibleState.None,
                {
                  command: `${extensionHandle}.toggle-subscription`,
                  title: "Toggle Publisher",
                  arguments: [`${nodeName}${topicName}`, topicType],
                },
                topicType
              );
              this.pubs[`${nodeName}${topicName}`] = pub;
              return pub;
            });
            
            resolve(publishers);
          });
        });
      });
    } else {
      return [];
    }
  }

  async getSubscribers(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        const nodeName = topic.node.label;
        
        // Get node-specific details
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const subscribingTopics = details.subscribing || [];
          
          // Get all topics to find their types
          this.rosbridgeClient.getTopics((allTopics) => {
            // Create a map of topic names to types
            const topicTypeMap = {};
            allTopics.forEach(topicInfo => {
              topicTypeMap[topicInfo.name] = topicInfo.type;
            });
            
            // Create subscribers only for topics this node subscribes to
            const subscribers = subscribingTopics.map((topicName) => {
              const topicType = topicTypeMap[topicName] || "unknown";
              const sub = new Subscriber(
                topicName,
                nodeName,
                topic.node.address,
                false,
                vscode.TreeItemCollapsibleState.None,
                {
                  command: `${extensionHandle}.toggle-subscription`,
                  title: "Toggle Subscriber",
                  arguments: [`${nodeName}${topicName}`, topicType],
                },
                topicType
              );
              return sub;
            });
            
            resolve(subscribers);
          });
        });
      });
    } else {
      return [];
    }
  }

  async getServiceClients(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        const nodeName = topic.node.label;
        
        // Get node-specific details
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const services = details.services || [];
          
          // Create service clients for services this node provides
          const serviceClients = services.map((serviceName) => {
            return new Service(
              serviceName,
              nodeName,
              topic.node.address,
              vscode.TreeItemCollapsibleState.None,
              {
                command: `${extensionHandle}.call-service`,
                title: "Call Service",
                arguments: [serviceName, nodeName]
              }
            );
          });
          
          resolve(serviceClients);
        });
      });
    } else {
      return [];
    }
  }

  async getActionClients(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        const nodeName = topic.node.label;
        
        // Get node-specific details
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          // Check if action_clients is available in the details
          const actionClients = details.action_clients || [];
          
          // Create action clients for this node
          const actionClientItems = actionClients.map((actionName) => {
            return new ActionClient(
              actionName,
              nodeName,
              topic.node.address,
              vscode.TreeItemCollapsibleState.None
            );
          });
          
          resolve(actionClientItems);
        });
      });
    } else {
      return [];
    }
  }
}

module.exports = {
  PublishersProvider,
};
