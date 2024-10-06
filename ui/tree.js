const axios = require("axios");
const vscode = require("vscode");
const {
  validateAndFormatEndpoint,
  logOutputChannel,
  extensionHandle,
} = require("../utils/helpers");

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
  constructor(label, nodeLabel, address, isChecked, collapsibleState, command) {
    super(label, collapsibleState);
    this.nodeLabel = nodeLabel;
    this.address = address;
    this.isChecked = isChecked;
    this.command = command;
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

const config = vscode.workspace.getConfiguration(extensionHandle);

class PublishersProvider {
  constructor(bridgeAddress, extHandle, channel) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.pubs = {};
    this.subs = {};

    this.channel = channel;

    this.bridgeData = {};
    this.bridgeAddress = bridgeAddress;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    return !element
      ? this.getTrees()
      : element instanceof Tree
      ? this.getNodes(element)
      : element instanceof Node
      ? this.getTopics(element)
      : element instanceof Topic && element.label === "publishers"
      ? this.getPublishers(element)
      : element instanceof Topic && element.label !== "publishers"
      ? this.getClients(element)
      : Promise.resolve([]);
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
  }

  async getTrees() {
    return this.bridgeAddress.map(
      (address) => new Tree(address, vscode.TreeItemCollapsibleState.Expanded)
    );
  }

  async getNodes(tree) {
    try {
      const [http, error] = validateAndFormatEndpoint(
        tree.address,
        config.get("httpPort")
      );
      if (error) {
        this.bridgeData = [];
        this.bridgeAddress = "";
        throw error;
      }
      this.bridgeData = await this.fetchData(http + "/@ros2/**/node/**");
      vscode.window.showInformationMessage(
        `Connected to ${this.bridgeAddress}.`
      );
      return this.bridgeData.map(
        (nodeData) =>
          new Node(
            nodeData.key.split("/").pop(),
            tree.address,
            vscode.TreeItemCollapsibleState.Collapsed
          )
      );
    } catch (error) {
      if (typeof error === "object" && "message" in error) {
        logOutputChannel(this.channel, "error", error.message);
      }
      vscode.window.showWarningMessage(
        `Failed to connect to ${this.bridgeAddress}.`
      );
    }
  }

  getTopics(node) {
    return ["publishers", "action_clients", "service_clients"].map(
      (label) =>
        new Topic(label, node, vscode.TreeItemCollapsibleState.Collapsed)
    );
  }

  async getClients(topic) {
    const leaves = this.bridgeData.find((nd) =>
      nd.key.includes(topic.node.label)
    ).value[topic.label];

    return leaves.map((leave) => {
      const lbl = leave.name.substring(1);
      const nodename = topic.node.label;
      return new Publisher(
        lbl,
        nodename,
        topic.node.address,
        false,
        vscode.TreeItemCollapsibleState.None
      );
    });
  }

  async getPublishers(topic) {
    const leaves = this.bridgeData.find((nd) =>
      nd.key.includes(topic.node.label)
    ).value[topic.label];

    return leaves.map((leave) => {
      const lbl = leave.name.substring(1);
      const nodename = topic.node.label;
      const pub = new Publisher(
        lbl,
        nodename,
        topic.node.address,
        false,
        vscode.TreeItemCollapsibleState.None,
        {
          command: `${extensionHandle}.toggle-subscription`,
          title: "Toggle Publisher",
          arguments: [`${nodename}/${lbl}`],
        }
      );
      this.pubs[`${nodename}/${lbl}`] = pub;
      return this.pubs[`${nodename}/${lbl}`];
    });
  }

  async fetchData(url) {
    const response = await axios.get(url);
    return response.data;
  }
}

module.exports = {
  PublishersProvider,
};
