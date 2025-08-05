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
  constructor(label, type, address, collapsibleState, rosbridgeClient = null, isSubscribed = false) {
    super(label, collapsibleState);
    this.type = type;
    this.address = address;
    this.contextValue = isSubscribed ? "topicSubscribed" : "topic";
    this.tooltip = `${label} (${type})`;
    this.description = "";
    this.messageType = type;
    this.rosbridgeClient = rosbridgeClient;
    this.isSubscribed = isSubscribed;
  }
  
  setSubscribed(state) {
    this.isSubscribed = state;
    this.contextValue = state ? "topicSubscribed" : "topic";
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
    this.iconPath = undefined;
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
    collapsibleState,
    messageType = null
  ) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.messageType = messageType;
    this.contextValue = "subscribers";
    this.iconPath = undefined;
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
    this.topics = {};
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
      return this.getTopicsList(element);
    } else {
      return Promise.resolve([]);
    }
  }

  toggleCheckbox(lbl) {
    const pub = this.pubs[lbl];
    if (pub) {
      pub.toggleChecked();
      this._onDidChangeTreeData.fire(pub);
      
      const topicName = pub.label;
      if (pub.isChecked) {
        this.subscribedTopics.add(topicName);
      } else {
        let anySubscribed = false;
        for (const key in this.pubs) {
          if (this.pubs[key].label === topicName && this.pubs[key].isChecked && key !== lbl) {
            anySubscribed = true;
            break;
          }
        }
        if (!anySubscribed) {
          this.subscribedTopics.delete(topicName);
        }
      }
      
      if (this.topics[topicName]) {
        this.topics[topicName].setSubscribed(this.subscribedTopics.has(topicName));
        this._onDidChangeTreeData.fire(this.topics[topicName]);
      }
    }
    if (pub && pub.isChecked) {
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
    
    this.subscribedTopics.clear();
    for (const topicName in this.topics) {
      this.topics[topicName].setSubscribed(false);
    }
    
    this._onDidChangeTreeData.fire();
  }
  
  setTopicSubscriptionState(topicName, isSubscribed) {
    if (isSubscribed) {
      this.subscribedTopics.add(topicName);
    } else {
      this.subscribedTopics.delete(topicName);
    }
    
    const topicItem = this.topics[topicName];
    if (topicItem) {
      topicItem.setSubscribed(isSubscribed);
      this._onDidChangeTreeData.fire(topicItem);
    }
  }
  
  getTopicItem(topicName) {
    return this.topics[topicName];
  }

  async getTrees() {
    return this.bridgeAddress.map(
      (address) => new Tree(address, vscode.TreeItemCollapsibleState.Expanded)
    );
  }

  async getTopicsList(tree) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        this.rosbridgeClient.getTopics((topics) => {
          const topicItems = topics
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((topic) => {
                const isSubscribed = this.subscribedTopics.has(topic.name);
                const topicItem = new Topic(
                  topic.name,
                  topic.type,
                  tree.address,
                  vscode.TreeItemCollapsibleState.None,
                  this.rosbridgeClient,
                  isSubscribed
                );
                this.topics[topic.name] = topicItem;
                return topicItem;
              }
            );
          resolve(topicItems);
        });
      });
    } else {
      this.channel.appendLine("No rosbridge connection available");
      return [];
    }
  }

  async getTopicDetails(topic) {
    if (this.rosbridgeClient && this.rosbridgeClient.isConnected()) {
      return new Promise((resolve) => {
        this.rosbridgeClient.getNodes((nodes) => {
          const details = [];
          let processedNodes = 0;
          
          if (nodes.length === 0) {
            resolve([]);
            return;
          }
          
          nodes.forEach((nodeName) => {
            this.rosbridgeClient.getNodeDetails(nodeName, (nodeDetails) => {
              if (nodeDetails.publishing && nodeDetails.publishing.includes(topic.label)) {
                const pubKey = `${nodeName}${topic.label}`;
                const existingPub = this.pubs[pubKey];
                const isChecked = existingPub ? existingPub.isChecked : false;
                
                const pub = new Publisher(
                  `${nodeName} (publisher)`,
                  nodeName,
                  topic.address,
                  isChecked,
                  vscode.TreeItemCollapsibleState.None,
                  undefined,
                  topic.type
                );
                this.pubs[pubKey] = pub;
                details.push(pub);
              }
              
              if (nodeDetails.subscribing && nodeDetails.subscribing.includes(topic.label)) {
                const sub = new Subscriber(
                  `${nodeName} (subscriber)`,
                  nodeName,
                  topic.address,
                  vscode.TreeItemCollapsibleState.None,
                  topic.type
                );
                details.push(sub);
              }
              
              processedNodes++;
              if (processedNodes === nodes.length) {
                resolve(details);
              }
            });
          });
        });
      });
    } else {
      return [];
    }
  }

  async getClients() {
    return [];
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
  PublishersProvider,
};
