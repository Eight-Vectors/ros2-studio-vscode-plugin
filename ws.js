const io = require("socket.io-client");
const vscode = require("vscode");

const socket_endpoint = "ws://localhost:5001";

class SocketClient {
  constructor(url = socket_endpoint, pChannel) {
    this.url = url;
    this.pChannel = pChannel;
    this.socket = null;
    this.connect();
  }

  connect() {
    if (this.socket) {
      this.pChannel.appendLine("Already connected");
      return;
    }

    this.socket = io(this.url);

    this.socket.on("connect", () => {
      this.pChannel.appendLine("Connected to websocket server");
    });

    this.socket.on("disconnect", (reason) => {
      this.pChannel.appendLine(`Disconnected from server: ${reason}`);
      this.reconnect();
    });

    this.socket.on("error", (error) => {
      this.pChannel.appendLine(`Socket error: ${error}`);
    });
  }

  reconnect() {
    if (this.socket && !this.socket.connected) {
      this.pChannel.appendLine("Attempting to reconnect...");
      this.connect();
    }
  }

  send(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    } else {
      this.pChannel.appendLine("No socket connection available");
    }
  }

  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    } else {
      this.pChannel.appendLine("No socket connection available");
    }
  }

  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    } else {
      this.pChannel.appendLine("No socket connection available");
    }
  }

  listenSubscriptions(subscriptions) {
    for (const [event, callback] of Object.entries(subscriptions)) {
      this.socket?.on(event, callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.pChannel.appendLine("Disconnected from server");
    }
  }
}

module.exports = SocketClient; // Export the class for use in your extension
