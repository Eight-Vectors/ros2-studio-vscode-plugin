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
    this.contextValue = "nodeTopic";
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


class NodeListProvider {
  constructor(bridgeAddress, extHandle, channel) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.pubs = {};
    this.subs = {};
    this.subscribedTopics = new Set();

    this.channel = channel;

    this.bridgeData = {};
    this.bridgeAddress = bridgeAddress;
    this.rosbridgeClient = null;
  }

  setRosbridgeClient(client) {
    this.rosbridgeClient = client;
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
      if (pub.isChecked) {
        return [pub.isChecked, pub.address];
      }
      return [false];
    }
    
    const sub = this.subs[lbl];
    if (sub) {
      sub.toggleChecked();
      this._onDidChangeTreeData.fire(sub);
      if (sub.isChecked) {
        return [sub.isChecked, sub.address];
      }
      return [false];
    }
    
    return [false];
  }
  
  resetAllCheckboxes() {
    this.subscribedTopics.clear();
    
    for (const key in this.pubs) {
      if (this.pubs[key].isChecked) {
        this.pubs[key].isChecked = false;
        this.pubs[key].updateIcon();
      }
    }
    for (const key in this.subs) {
      if (this.subs[key].isChecked) {
        this.subs[key].isChecked = false;
        this.subs[key].updateIcon();
      }
    }
    this._onDidChangeTreeData.fire();
  }
  
  setTopicSubscriptionState(topicName, isSubscribed) {
    if (isSubscribed) {
      this.subscribedTopics.add(topicName);
    } else {
      this.subscribedTopics.delete(topicName);
    }
    
    const affectedNodes = new Set();
    
    for (const key in this.pubs) {
      const pub = this.pubs[key];
      if (pub.label === topicName) {
        pub.isChecked = isSubscribed;
        pub.updateIcon();
        affectedNodes.add(pub.nodeLabel);
      }
    }
    
    for (const key in this.subs) {
      const sub = this.subs[key];
      if (sub.label === topicName) {
        sub.isChecked = isSubscribed;
        sub.updateIcon();
        affectedNodes.add(sub.nodeLabel);
      }
    }
    
    if (affectedNodes.size > 0) {
      this._onDidChangeTreeData.fire();
    }
  }

  async getTrees() {
    return this.bridgeAddress.map(
      (address) => new Tree(address, vscode.TreeItemCollapsibleState.Expanded)
    );
  }

  async getNodes(tree) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        this.rosbridgeClient.getNodes((nodes) => {
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
    return [];
  }

  async getPublishers(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        const nodeName = topic.node.label;
        
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const publishingTopics = details.publishing || [];
          
          this.rosbridgeClient.getTopics((allTopics) => {
            const topicTypeMap = {};
            allTopics.forEach(topicInfo => {
              topicTypeMap[topicInfo.name] = topicInfo.type;
            });
            
            const publishers = publishingTopics.map((topicName) => {
              const topicType = topicTypeMap[topicName] || "unknown";
              const pubKey = `${nodeName}${topicName}`;
              const existingPub = this.pubs[pubKey];
              const isChecked = existingPub ? existingPub.isChecked : this.subscribedTopics.has(topicName);
              
              const pub = new Publisher(
                topicName,
                nodeName,
                topic.node.address,
                isChecked,
                vscode.TreeItemCollapsibleState.None,
                {
                  command: `${extensionHandle}.toggle-subscription`,
                  title: "Toggle Publisher",
                  arguments: [`${nodeName}${topicName}`, topicType],
                },
                topicType
              );
              this.pubs[pubKey] = pub;
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
        
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const subscribingTopics = details.subscribing || [];
          
          this.rosbridgeClient.getTopics((allTopics) => {
            const topicTypeMap = {};
            allTopics.forEach(topicInfo => {
              topicTypeMap[topicInfo.name] = topicInfo.type;
            });
            
            const subscribers = subscribingTopics.map((topicName) => {
              const topicType = topicTypeMap[topicName] || "unknown";
              const subKey = `${nodeName}_sub_${topicName}`;
              const existingSub = this.subs[subKey];
              const isChecked = existingSub ? existingSub.isChecked : this.subscribedTopics.has(topicName);
              
              const sub = new Subscriber(
                topicName,
                nodeName,
                topic.node.address,
                isChecked,
                vscode.TreeItemCollapsibleState.None,
                {
                  command: `${extensionHandle}.toggle-subscription`,
                  title: "Toggle Subscription",
                  arguments: [`${nodeName}_sub_${topicName}`, topicType],
                },
                topicType
              );
              this.subs[subKey] = sub;
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
        
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const services = details.services || [];
          
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
        
        this.rosbridgeClient.getNodeDetails(nodeName, (details) => {
          const actionClients = details.action_clients || [];
          
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
  NodeListProvider,
};