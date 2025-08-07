const vscode = require("vscode");
const { displayMessageIntelligently } = require("./utils/messageDisplay");

let RosbridgeClient,
  PublishersProvider,
  NodeListProvider,
  VisualizationPanel,
  ConnectionDashboard,
  ParametersPanel,
  BagRecorderPanel,
  MessageInspectorPanel,
  extensionHandle;

try {
  RosbridgeClient = require("./rosbridge");
  ({ PublishersProvider } = require("./ui/tree"));
  ({ NodeListProvider } = require("./ui/nodeTree"));
  ({ VisualizationPanel } = require("./ui/visualizationPanel"));
  ConnectionDashboard = require("./ui/connectionDashboard");
  ParametersPanel = require("./ui/parametersPanel");
  BagRecorderPanel = require("./ui/bagRecorderPanel");
  MessageInspectorPanel = require("./ui/messageInspectorPanel");
  ({ extensionHandle } = require("./utils/helpers"));
} catch (error) {
  console.error("Module load error:", error);
  vscode.window.showErrorMessage(`Module load error: ${error.message}`);
}

function formatError(error) {
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

function updateTopicMessageRate(topicName, topicRates) {
  const now = Date.now();

  if (!topicRates.has(topicName)) {
    topicRates.set(topicName, {
      messageCount: 0,
      firstMessageTime: now,
      lastMessageTime: now,
      messagesPerSecond: 0,
    });
  }

  const rateInfo = topicRates.get(topicName);
  rateInfo.messageCount++;
  rateInfo.lastMessageTime = now;

  const timeDiff = (now - rateInfo.firstMessageTime) / 1000;
  if (timeDiff > 0) {
    rateInfo.messagesPerSecond = rateInfo.messageCount / timeDiff;
  }

  if (timeDiff > 60) {
    rateInfo.messageCount = 1;
    rateInfo.firstMessageTime = now;
  }
}

function isStaticTopic(topicName, messageType, topicRates) {
  const config = vscode.workspace.getConfiguration("vscode-ros-extension");

  const staticTopics = config.get("staticTopics", [
    "/robot_description",
    "/tf_static",
    "/map_metadata",
    "/map",
  ]);

  if (staticTopics.includes(topicName)) {
    return true;
  }

  const topicPatterns = config.get("staticTopicPatterns", [
    ".*_static$",
    ".*_description$",
    ".*_metadata$",
  ]);

  for (const pattern of topicPatterns) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(topicName)) {
        return true;
      }
    } catch (e) {
      console.warn(`Invalid regex pattern for static topics: ${pattern}`);
    }
  }

  if (messageType) {
    const messageTypePatterns = config.get("staticMessageTypes", [
      ".*Parameter.*",
      ".*Description.*",
    ]);

    for (const pattern of messageTypePatterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(messageType)) {
          return true;
        }
      } catch (e) {
        console.warn(
          `Invalid regex pattern for static message types: ${pattern}`
        );
      }
    }
  }

  if (topicRates && topicRates.has(topicName)) {
    const rateInfo = topicRates.get(topicName);
    const timeSinceFirstMessage =
      (Date.now() - rateInfo.firstMessageTime) / 1000;
    const rateThreshold = config.get("staticTopicAutoDetectRate", 0.1);

    if (
      timeSinceFirstMessage > 10 &&
      rateInfo.messagesPerSecond < rateThreshold
    ) {
      return true;
    }
  }

  return false;
}

function processMapData(mapData, channels) {
  try {
    if (!mapData || !mapData.info) {
      throw new Error("Invalid map data structure");
    }

    const { width, height, resolution, origin } = mapData.info;

    const cleanMapData = {
      info: {
        width,
        height,
        resolution,
        origin: {
          position: {
            x: origin?.position?.x || 0,
            y: origin?.position?.y || 0,
            z: origin?.position?.z || 0,
          },
        },
      },
      data: [],
    };

    if (mapData.data && mapData.data.length > 0) {
      cleanMapData.data = Array.from(mapData.data);
    }

    return cleanMapData;
  } catch (error) {
    channels["main"].appendLine(`Error processing map data: ${error.message}`);
    return null;
  }
}

function handleServiceResult(serviceName, serviceType, result, channels) {
  const isMapService = serviceType.includes("GetMap") && result?.map;

  if (isMapService) {
    handleMapServiceResult(result.map, channels);
  } else {
    handleGenericServiceResult(serviceName, result, channels);
  }
}

function handleMapServiceResult(mapData, channels) {
  const processedMap = processMapData(mapData, channels);

  if (!processedMap) {
    vscode.window.showErrorMessage("Failed to process map data");
    return;
  }

  vscode.window.showInformationMessage(
    "Map service called successfully. Subscribe to a map topic to visualize."
  );
}

function handleGenericServiceResult(serviceName, result, channels) {
  channels["main"].appendLine(`Service result for ${serviceName}:`);

  try {
    const seen = new WeakSet();
    const jsonString = JSON.stringify(
      result,
      (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
          }
          seen.add(value);
        }
        return value;
      },
      2
    );

    channels["main"].appendLine(jsonString);
  } catch (error) {
    channels["main"].appendLine("Result too complex to display");
    channels["main"].appendLine(`Error: ${error.message}`);
  }

  channels["main"].show();
  vscode.window.showInformationMessage(
    `Service ${serviceName} completed. Check output.`
  );
}

function activate(context) {
  try {
    // Set initial connection state
    vscode.commands.executeCommand(
      "setContext",
      "vscode-ros-extension.isConnected",
      false
    );
    vscode.commands.executeCommand(
      "setContext",
      "vscode-ros-extension.isConnecting",
      false
    );

    let bridge = [];
    let channels = {};
    let ws = null;

    // Create a Map to track all output channels for proper cleanup
    const outputChannels = new Map();

    // Track topic message rates for auto-detection
    const topicMessageRates = new Map();

    // Create main output channel for extension logs
    channels["main"] = vscode.window.createOutputChannel(
      "ROS 2 Bridge Extension"
    );
    outputChannels.set("main", channels["main"]);

    // Periodic cleanup interval
    let cleanupInterval = null;

    // Track active connections to prevent duplicates
    let activeConnections = new Set();

    // Create and register tree view providers
    let tree = new PublishersProvider(
      bridge,
      extensionHandle,
      channels["main"]
    );
    vscode.window.registerTreeDataProvider("extNodesView", tree);

    // Create and register node list provider
    let nodeTree = new NodeListProvider(
      bridge,
      extensionHandle,
      channels["main"]
    );
    vscode.window.registerTreeDataProvider("extNodeListView", nodeTree);

    // Register empty welcome view provider
    vscode.window.registerTreeDataProvider("extWelcomeView", {
      getTreeItem: () => null,
      getChildren: () => [],
    });

    // Listen for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`${extensionHandle}.maxReconnectAttempts`) &&
          ws
        ) {
          ws.updateMaxReconnectAttempts();
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        `${extensionHandle}.connect-bridge`,
        async () => {
          if (ws) {
            if (ws.isConnected()) {
              const action = await vscode.window.showWarningMessage(
                `Already connected to ${ws.url}. Disconnect first?`,
                "Disconnect",
                "Cancel"
              );
              if (action === "Disconnect") {
                await vscode.commands.executeCommand(
                  `${extensionHandle}.disconnect-bridge`
                );
              } else {
                return;
              }
            } else if (ws.isManuallyConnecting || ws.isReconnecting) {
              vscode.window.showWarningMessage(
                `Connection attempt already in progress.`
              );
              return;
            }
          }

          // Check if we're already trying to connect to this URL
          if (ws && ws.isManuallyConnecting) {
            vscode.window.showWarningMessage(
              "Connection already in progress. Please wait..."
            );
            return;
          }

          const config = vscode.workspace.getConfiguration(extensionHandle);
          const rosbridgeUrl = config.get(
            "rosbridgeUrl",
            "ws://localhost:9090"
          );
          const customUrl = await vscode.window.showInputBox({
            placeHolder: "ws://localhost:9090",
            prompt:
              "Enter ROS 2 Bridge WebSocket URL (e.g., ws://192.168.1.100:9090)",
            value: rosbridgeUrl,
            validateInput: (value) => {
              if (!value) {
                return "URL is required";
              }
              if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
                return "URL must start with ws:// or wss://";
              }
              return null;
            },
          });

          if (customUrl) {
            // Check if we're already connected to this URL
            if (activeConnections.has(customUrl)) {
              vscode.window.showWarningMessage(
                `Already connected or connecting to ${customUrl}`
              );
              return;
            }

            vscode.window.showInformationMessage(
              `Connecting to rosbridge at ${customUrl}...`
            );
            activeConnections.add(customUrl);

            // Set connecting state immediately
            vscode.commands.executeCommand(
              "setContext",
              "vscode-ros-extension.isConnecting",
              true
            );
            vscode.commands.executeCommand(
              "setContext",
              "vscode-ros-extension.isConnected",
              false
            );
            vscode.commands.executeCommand(
              "setContext",
              "vscode-ros-extension.isReconnecting",
              false
            );

            bridge.push(customUrl);
            ws = new RosbridgeClient(customUrl, channels["main"]);
            tree.setRosbridgeClient(ws);
            nodeTree.setRosbridgeClient(ws);

            ws.setConnectionCallbacks(
              () => {
                tree.refresh();
                nodeTree.refresh();
              },
              () => {
                tree.refresh();
                nodeTree.refresh();
              },
              (status) => {
                // Handle connection status changes
                switch (status) {
                  case "connecting":
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnecting",
                      true
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnected",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isReconnecting",
                      false
                    );
                    break;
                  case "connected":
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnecting",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnected",
                      true
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isReconnecting",
                      false
                    );
                    break;
                  case "reconnecting":
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnecting",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnected",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isReconnecting",
                      true
                    );
                    break;
                  case "disconnected":
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnecting",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isConnected",
                      false
                    );
                    vscode.commands.executeCommand(
                      "setContext",
                      "vscode-ros-extension.isReconnecting",
                      false
                    );
                    break;
                }
              }
            );

            ws.waitForConnection()
              .then(() => {
                vscode.commands.executeCommand(
                  "setContext",
                  "vscode-ros-extension.isConnected",
                  true
                );
                tree.refresh();
                nodeTree.refresh();
                ConnectionDashboard.createOrShow(context.extensionUri, ws);

                // Clean up memory periodically
                cleanupInterval = setInterval(() => {
                  // Force garbage collection
                  if (global.gc) {
                    global.gc();
                  }

                  for (const [name, channel] of outputChannels.entries()) {
                    if (name !== "main" && channel.subscriptionData) {
                      // Don't clear static topics
                      if (channel.subscriptionData.isStatic) {
                        continue;
                      }
                      // Keep memory usage under control
                      const config =
                        vscode.workspace.getConfiguration(extensionHandle);
                      const maxMessagesToRetain = config.get(
                        "maxMessagesToRetain",
                        10
                      );
                      const maxMemoryMB = config.get("maxMemoryMB", 1);

                      // Check topics with message buffer
                      if (
                        channel.subscriptionData.messageBuffer &&
                        channel.subscriptionData.messageBuffer.length > 0
                      ) {
                        // Keep only last N messages
                        if (
                          channel.subscriptionData.messageBuffer.length >
                          maxMessagesToRetain
                        ) {
                          channel.subscriptionData.messageBuffer =
                            channel.subscriptionData.messageBuffer.slice(
                              -maxMessagesToRetain
                            );

                          // Refresh the output
                          channel.clear();
                          channel.appendLine(
                            `Topic: ${channel.subscriptionData.topicName} (Retaining last ${maxMessagesToRetain} messages)`
                          );
                          channel.appendLine("");

                          channel.subscriptionData.messageBuffer.forEach(
                            (entry) => {
                              channel.appendLine(
                                `[${entry.timestamp}] Message received:`
                              );
                              displayMessageIntelligently(
                                channel,
                                entry.message,
                                channel.subscriptionData.messageType,
                                extensionHandle,
                                channel.subscriptionData.isStatic
                              );
                              channel.appendLine("");
                            }
                          );
                        }

                        // Check if using too much memory
                        try {
                          const estimatedSize = JSON.stringify(
                            channel.subscriptionData.messageBuffer
                          ).length;
                          if (estimatedSize > maxMemoryMB * 1024 * 1024) {
                            // Cut it in half
                            const halfLength = Math.max(
                              1,
                              Math.floor(
                                channel.subscriptionData.messageBuffer.length /
                                  2
                              )
                            );
                            channel.subscriptionData.messageBuffer =
                              channel.subscriptionData.messageBuffer.slice(
                                -halfLength
                              );

                            channel.clear();
                            channel.appendLine(
                              `Topic: ${channel.subscriptionData.topicName} (Memory limit exceeded, reduced to ${halfLength} messages)`
                            );
                            channel.appendLine("");
                          }
                        } catch (e) {
                          // Skip errors
                        }
                      }

                      // Handle line count limits
                      if (
                        channel.subscriptionData.outputLineCount >
                        channel.subscriptionData.maxOutputLines
                      ) {
                        channel.subscriptionData.outputLineCount = Math.min(
                          channel.subscriptionData.outputLineCount,
                          channel.subscriptionData.maxOutputLines
                        );
                      }
                    }
                  }
                }, 60000); // Run every minute
              })
              .catch((error) => {
                const errorMessage = formatError(error);

                // Remove from active connections on failure
                activeConnections.delete(customUrl);

                // Reset connection states on failure
                vscode.commands.executeCommand(
                  "setContext",
                  "vscode-ros-extension.isConnecting",
                  false
                );
                vscode.commands.executeCommand(
                  "setContext",
                  "vscode-ros-extension.isConnected",
                  false
                );
                vscode.commands.executeCommand(
                  "setContext",
                  "vscode-ros-extension.isReconnecting",
                  false
                );

                // Log error to output channel
                channels["main"].appendLine(
                  `Failed to connect to rosbridge at ${customUrl}`
                );
                channels["main"].appendLine(`Error: ${errorMessage}`);

                // Auto-show the output channel on error
                channels["main"].show(true);

                // Show user-friendly error message
                vscode.window.showErrorMessage(
                  `Failed to connect to rosbridge: ${errorMessage}`
                );
              });
          } else {
            vscode.window.showWarningMessage("No URL provided.");
          }
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.disconnect-bridge`,
        async () => {
          if (!ws) {
            vscode.window.showWarningMessage(
              "No active connection to disconnect"
            );
            return;
          }

          const disconnectedUrl = ws.url;

          // Remove from active connections
          activeConnections.delete(disconnectedUrl);

          if (ws.topics) {
            for (const [topicName, topic] of ws.topics.entries()) {
              if (
                topic.subscriptionData &&
                topic.subscriptionData.visualizationPanel
              ) {
                topic.subscriptionData.visualizationPanel.dispose();
              }
              ws.unsubscribeTopic(topicName);
            }
          }

          // Close all output channels except main
          const channelsToDispose = [];
          for (const [name, channel] of outputChannels.entries()) {
            if (name !== "main") {
              channelsToDispose.push([name, channel]);
            }
          }

          for (const [name, channel] of channelsToDispose) {
            // Extract topic name from channel name if it's a topic channel
            if (name.startsWith("ROS Topic: ")) {
              const topicName = name.substring("ROS Topic: ".length);
              // Update tree state to show topic as unsubscribed
              tree.setTopicSubscriptionState(topicName, false);
            }

            channel.clear();
            channel.hide();
            // Actually dispose on disconnect
            channel.dispose();
            outputChannels.delete(name);
            if (channels[name]) {
              delete channels[name];
            }
          }

          ws.disconnect();
          ws = null;

          // Clear topic message rates
          topicMessageRates.clear();

          // Clear cleanup interval
          if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
          }

          tree.setRosbridgeClient(null);
          tree.resetAllCheckboxes();
          tree.refresh();

          nodeTree.setRosbridgeClient(null);
          nodeTree.resetAllCheckboxes();
          nodeTree.refresh();

          if (ConnectionDashboard.currentPanel) {
            ConnectionDashboard.currentPanel.dispose();
          }

          // Dispose ParametersPanel instances
          if (ParametersPanel && ParametersPanel.disposeAll) {
            ParametersPanel.disposeAll();
          }

          // Dispose BagRecorderPanel
          if (BagRecorderPanel.currentPanel) {
            BagRecorderPanel.currentPanel.dispose();
          }

          bridge.pop();
          vscode.window.showInformationMessage(
            `Disconnected from ${disconnectedUrl}`
          );

          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnected",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnecting",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isReconnecting",
            false
          );
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.force-reset`,
        async () => {
          if (!ws) {
            vscode.window.showWarningMessage("No active connection to reset");
            return;
          }

          const currentUrl = ws.url;
          vscode.window.showInformationMessage(
            `Force resetting - cleaning up all connections...`
          );

          // Remove from active connections
          activeConnections.delete(currentUrl);

          // Stop any reconnection attempts
          ws.stopReconnection();

          // Disconnect
          ws.disconnect();

          // Clean up all subscriptions
          if (outputChannels) {
            for (const [topicName, channel] of outputChannels) {
              // Skip the main channel - we want to keep it
              if (topicName === "main") {
                channel.clear();
                channel.appendLine(
                  "Force reset completed. All connections and subscriptions cleared."
                );
                continue;
              }

              if (
                channel.subscriptionData &&
                channel.subscriptionData.subscription
              ) {
                channel.subscriptionData.subscription.unsubscribe();
              }
              channel.clear();
              channel.dispose();
            }

            // Clear all except main channel
            const mainChannel = outputChannels.get("main");
            outputChannels.clear();
            if (mainChannel) {
              outputChannels.set("main", mainChannel);
              channels["main"] = mainChannel;
            }
          }

          // Clear the cleanup interval if it exists
          if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
          }

          // Reset all context states
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnecting",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnected",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isReconnecting",
            false
          );

          // Clear the websocket reference
          ws = null;

          // Clear the rosbridge clients from trees
          tree.setRosbridgeClient(null);
          nodeTree.setRosbridgeClient(null);

          // Refresh trees to show empty state
          tree.refresh();
          nodeTree.refresh();

          // Close any open panels
          if (ConnectionDashboard.currentPanel) {
            ConnectionDashboard.currentPanel.dispose();
          }

          if (MessageInspectorPanel && MessageInspectorPanel.currentPanel) {
            MessageInspectorPanel.currentPanel.dispose();
          }

          if (BagRecorderPanel && BagRecorderPanel.currentPanel) {
            BagRecorderPanel.currentPanel.dispose();
          }

          if (ParametersPanel && ParametersPanel.disposeAll) {
            ParametersPanel.disposeAll();
          }

          if (VisualizationPanel && VisualizationPanel.disposeAll) {
            VisualizationPanel.disposeAll();
          }

          vscode.window.showInformationMessage(
            "Force reset complete. You can now connect to a ROS 2 bridge."
          );
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.stop-retry`,
        async () => {
          if (!ws) {
            vscode.window.showWarningMessage("No active connection");
            return;
          }

          // Get the current URL before cleaning up
          const currentUrl = ws.url;

          // Remove from active connections to allow new connection attempts
          if (currentUrl) {
            activeConnections.delete(currentUrl);
          }

          // Stop reconnection or initial connection
          ws.stopReconnection();

          // If in connecting state, also disconnect
          if (ws.isManuallyConnecting || ws.isReconnecting) {
            ws.disconnect();
          }

          // Clear the websocket reference
          ws = null;

          // Reset all connection states
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnecting",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isReconnecting",
            false
          );
          vscode.commands.executeCommand(
            "setContext",
            "vscode-ros-extension.isConnected",
            false
          );

          vscode.window.showInformationMessage("Connection attempt stopped");
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.refresh-connections`,
        () => {
          tree.refresh();
          nodeTree.refresh();
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.toggle-subscription`,
        async (treeItem, messageType) => {
          if (!ws || !(ws instanceof RosbridgeClient)) {
            vscode.window.showErrorMessage(
              "No connection to ROS 2 bridge. Please connect first."
            );
            return;
          }

          let channelName;
          let topicName;

          if (typeof treeItem === "string") {
            channelName = treeItem;
            // Handle subscriber topics
            if (treeItem.includes("_sub_")) {
              // Get the topic name
              const parts = treeItem.split("_sub_");
              topicName = parts[1];
            } else {
              // Extract topic name, removing node name prefix
              const parts = treeItem.split("/");
              topicName = "/" + parts.slice(2).join("/");
            }
          } else if (treeItem && typeof treeItem === "object") {
            const nodeName = treeItem.nodeLabel;
            const topicLabel = treeItem.label.startsWith("/")
              ? treeItem.label
              : "/" + treeItem.label;
            channelName = `${nodeName}${topicLabel}`;
            topicName = topicLabel;
            // Use the messageType from the treeItem or the passed messageType parameter
            messageType = treeItem.messageType || messageType;
          } else {
            vscode.window.showErrorMessage("Invalid subscription target");
            return;
          }

          if (!channels[channelName]) {
            channels[channelName] =
              vscode.window.createOutputChannel(channelName);
            outputChannels.set(channelName, channels[channelName]);
          }

          const topics = ws.topics;
          const existingSubscription = topics ? topics.get(topicName) : null;

          let stateResult = tree.toggleCheckbox(channelName);
          if (!stateResult || !stateResult[0]) {
            stateResult = nodeTree.toggleCheckbox(channelName);
          }
          let state = stateResult && stateResult[0];

          if (existingSubscription && state) {
            vscode.window.showInformationMessage(
              `Already subscribed to topic: ${topicName}`
            );
            return;
          }

          if (state) {
            const topicMessageType = messageType || "std_msgs/String";

            tree.setTopicSubscriptionState(topicName, true);

            const config = vscode.workspace.getConfiguration(extensionHandle);
            const messageThrottle = config.get("messageThrottleRate", 100);
            const maxBufferSize = config.get("maxMessageBufferSize", 100);
            const maxMessagesToRetain = config.get("maxMessagesToRetain", 10);

            let subscriptionData = {
              visualizationPanel: null,
              creatingPanel: false,
              topicName: topicName,
              messageType: topicMessageType,
              messageBuffer: [],
              maxBufferSize: Math.min(maxBufferSize, maxMessagesToRetain), // Use retention limit
              lastMessageTime: 0,
              messageThrottle: messageThrottle,
              isStatic: isStaticTopic(
                topicName,
                topicMessageType,
                topicMessageRates
              ),
            };

            const subscription = ws.subscribeTopic(
              topicName,
              topicMessageType,
              (msg) => {
                const now = Date.now();

                updateTopicMessageRate(topicName, topicMessageRates);

                // Skip if too soon
                if (
                  now - subscriptionData.lastMessageTime <
                  subscriptionData.messageThrottle
                ) {
                  return;
                }
                subscriptionData.lastMessageTime = now;

                const timestamp = new Date().toISOString();

                // Add to buffer
                subscriptionData.messageBuffer.push({
                  timestamp,
                  message: msg,
                });

                // Remove old messages if buffer is full
                if (
                  subscriptionData.messageBuffer.length >
                  subscriptionData.maxBufferSize
                ) {
                  subscriptionData.messageBuffer.shift();
                }

                // Update output
                channels[channelName].clear();
                channels[channelName].appendLine(
                  `Topic: ${topicName} (Retaining ${subscriptionData.messageBuffer.length} messages)`
                );
                channels[channelName].appendLine("");

                // Show all messages
                const messagesToShow = subscriptionData.messageBuffer;
                messagesToShow.forEach((entry) => {
                  channels[channelName].appendLine(
                    `[${entry.timestamp}] Message received:`
                  );
                  displayMessageIntelligently(
                    channels[channelName],
                    entry.message,
                    topicMessageType,
                    extensionHandle,
                    subscriptionData.isStatic
                  );
                  channels[channelName].appendLine("");
                });

                const detectedType = VisualizationPanel.detectMessageType(
                  topicMessageType,
                  msg
                );
                if (
                  detectedType === "OccupancyGrid" ||
                  detectedType === "LaserScan" ||
                  detectedType === "URDF"
                ) {
                  if (
                    !subscriptionData.visualizationPanel &&
                    !subscriptionData.creatingPanel
                  ) {
                    subscriptionData.creatingPanel = true;
                    VisualizationPanel.createOrShow(
                      context.extensionUri,
                      topicName,
                      topicMessageType,
                      msg
                    )
                      .then((panel) => {
                        subscriptionData.creatingPanel = false;
                        if (panel) {
                          subscriptionData.visualizationPanel = panel;
                          panel.updateData(msg);
                        }
                      })
                      .catch(() => {
                        subscriptionData.creatingPanel = false;
                      });
                  } else if (subscriptionData.visualizationPanel) {
                    subscriptionData.visualizationPanel.updateData(msg);
                  }
                }
              }
            );

            if (!subscription) {
              channels[channelName].appendLine("Failed to create subscription");
            } else {
              subscription.subscriptionData = subscriptionData;
            }
          } else {
            const topics = ws.topics;
            const subscription = topics ? topics.get(topicName) : null;

            if (
              subscription &&
              subscription.subscriptionData &&
              subscription.subscriptionData.visualizationPanel
            ) {
              subscription.subscriptionData.visualizationPanel.dispose();
              subscription.subscriptionData.visualizationPanel = null;
              subscription.subscriptionData.creatingPanel = false;
            }

            ws.unsubscribeTopic(topicName);

            tree.setTopicSubscriptionState(topicName, false);

            if (subscription && subscription.subscriptionData) {
              subscription.subscriptionData.messageBuffer = [];
              subscription.subscriptionData = null;
            }

            // Clean up output channel for non-visualizable topics
            if (channels[channelName]) {
              channels[channelName].clear();
              channels[channelName].appendLine(
                `[Unsubscribed from ${topicName}]`
              );
              channels[channelName].hide();
              // Dispose the channel to fully clean up
              channels[channelName].dispose();
              delete channels[channelName];
              outputChannels.delete(channelName);
            }
          }

          if (state && channels[channelName]) {
            channels[channelName].show();
          }

          // Refresh tree to update button state
          tree.refresh();
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.call-service`,
        async (serviceName) => {
          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS 2 bridge");
            return;
          }

          const serviceType = await vscode.window.showInputBox({
            prompt: `Enter service type for ${serviceName}`,
            placeHolder: "e.g., nav_msgs/srv/GetMap, std_srvs/Empty",
            value: serviceName.includes("map") ? "nav_msgs/srv/GetMap" : "",
          });

          if (!serviceType) return;

          const requestStr = await vscode.window.showInputBox({
            prompt: "Enter request parameters as JSON",
            placeHolder: 'e.g., {} or {"data": true}',
            value: "{}",
          });

          if (requestStr === undefined) return;

          let request;
          try {
            request = JSON.parse(requestStr || "{}");
          } catch {
            vscode.window.showErrorMessage("Invalid JSON format");
            return;
          }

          ws.callService(serviceName, serviceType, request, (result, error) => {
            if (error) {
              vscode.window.showErrorMessage(`Service call failed: ${error}`);
              return;
            }

            handleServiceResult(serviceName, serviceType, result, channels);
          });
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.get-parameters`,
        async (treeItem) => {
          if (
            !treeItem ||
            typeof treeItem !== "object" ||
            treeItem.contextValue !== "node"
          ) {
            vscode.window.showErrorMessage("Please select a valid ROS 2 node");
            return;
          }

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("No active ROS 2 bridge connection");
            return;
          }

          const nodeName = treeItem.label;

          ParametersPanel.createOrShow(context.extensionUri, ws, nodeName);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.reset-visualization-preference`,
        () => {
          vscode.window.showInformationMessage(
            "Visualization view mode will be requested for each topic subscription."
          );
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.add-to-bag-recorder`,
        async (treeItem) => {
          if (!treeItem || typeof treeItem !== "object") {
            vscode.window.showErrorMessage("Invalid topic selection");
            return;
          }

          const topicName = treeItem.label.startsWith("/")
            ? treeItem.label
            : "/" + treeItem.label;
          const messageType = treeItem.messageType || "unknown";

          // Create panel if it doesn't exist
          if (!BagRecorderPanel.currentPanel) {
            BagRecorderPanel.createOrShow(context.extensionUri);
          }

          // Add topic to the recorder
          BagRecorderPanel.addTopic(topicName, messageType);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.open-bag-recorder`,
        () => {
          BagRecorderPanel.createOrShow(context.extensionUri);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.open-message-inspector`,
        () => {
          if (!MessageInspectorPanel) {
            vscode.window.showErrorMessage("MessageInspectorPanel not loaded");
            return;
          }
          MessageInspectorPanel.createOrShow(context.extensionUri, ws);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.inspect-topic-message`,
        async (treeItem) => {
          if (!treeItem) {
            vscode.window.showErrorMessage("No topic selected");
            return;
          }

          const topicName = treeItem.label || treeItem.id;

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS 2 bridge");
            return;
          }

          MessageInspectorPanel.createOrShow(context.extensionUri, ws);
          setTimeout(() => {
            if (MessageInspectorPanel.currentPanel) {
              if (treeItem.messageType) {
                MessageInspectorPanel.currentPanel._inspectMessageType(
                  treeItem.messageType
                );
              } else {
                MessageInspectorPanel.currentPanel.inspectTopicMessageType(
                  topicName
                );
              }
            } else {
              vscode.window.showErrorMessage(
                "Failed to open message inspector"
              );
            }
          }, 500);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.subscribe-to-topic`,
        async (topic) => {
          if (!topic || !topic.label) {
            vscode.window.showErrorMessage("No topic selected");
            return;
          }

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS 2 bridge");
            return;
          }

          const topicName = topic.label;
          const messageType =
            topic.type || topic.messageType || "std_msgs/String";

          tree.setTopicSubscriptionState(topicName, true);
          nodeTree.setTopicSubscriptionState(topicName, true);

          const channelName = `ROS Topic: ${topicName}`;

          // Create output channel if it doesn't exist
          if (!channels[channelName]) {
            channels[channelName] =
              vscode.window.createOutputChannel(channelName);
            outputChannels.set(channelName, channels[channelName]);
          }

          // Show the channel immediately
          channels[channelName].show();

          // Get configuration values
          const config = vscode.workspace.getConfiguration(extensionHandle);
          const messageThrottle = config.get("messageThrottleRate", 100);
          const maxBufferSize = config.get("maxMessageBufferSize", 100);
          const maxOutputLines = config.get("maxOutputLines", 500);

          // Create subscription data
          let subscriptionData = {
            visualizationPanel: null,
            creatingPanel: false,
            topicName: topicName,
            messageType: messageType,
            messageCount: 0,
            lastMessageTime: 0,
            messageThrottle: messageThrottle,
            channelName: channelName,
            outputThrottle: 1000, // Only update output every 1 second
            lastOutputTime: 0,
            pendingMessage: null,
            outputLineCount: 0,
            maxOutputLines: maxOutputLines, // Use configured value
            isStatic: isStaticTopic(topicName, messageType, topicMessageRates),
            firstMessageTime: 0,
          };

          // Subscribe to the topic
          channels[channelName].appendLine(
            `Attempting to subscribe to ${topicName} with type ${messageType}...`
          );

          const subscription = ws.subscribeTopic(
            topicName,
            messageType,
            (msg) => {
              const now = Date.now();

              updateTopicMessageRate(topicName, topicMessageRates);

              // Skip if message comes too fast
              if (
                subscriptionData.messageThrottle > 0 &&
                now - subscriptionData.lastMessageTime <
                  subscriptionData.messageThrottle
              ) {
                return;
              }
              subscriptionData.lastMessageTime = now;
              subscriptionData.messageCount++;
              if (!subscriptionData.firstMessageTime) {
                subscriptionData.firstMessageTime = now;
              }

              // Store only the latest message for output
              subscriptionData.pendingMessage = msg;

              // Throttle output channel updates to reduce UI overhead
              if (
                now - subscriptionData.lastOutputTime >=
                subscriptionData.outputThrottle
              ) {
                subscriptionData.lastOutputTime = now;

                // Don't clear the entire channel - just append new info
                const timestamp = new Date().toISOString();
                const channel = channels[channelName];

                // Only show a summary and the latest message
                if (subscriptionData.messageCount === 1) {
                  channel.appendLine(`Topic: ${topicName}`);
                  channel.appendLine(`Message Type: ${messageType}`);
                  if (subscriptionData.isStatic) {
                    channel.appendLine(
                      `Static/Latched Topic - Message received at ${timestamp}`
                    );
                  } else {
                    channel.appendLine(
                      `First message received at ${timestamp}`
                    );
                  }
                  channel.appendLine("");
                }

                // Show message count and rate
                const rate =
                  subscriptionData.messageCount > 1
                    ? `(~${Math.round(
                        (1000 / (now - subscriptionData.firstMessageTime)) *
                          subscriptionData.messageCount
                      )} Hz)`
                    : "";
                channel.appendLine(
                  `[${timestamp}] Message #${subscriptionData.messageCount} ${rate}`
                );

                // Show message
                try {
                  displayMessageIntelligently(
                    channel,
                    subscriptionData.pendingMessage,
                    messageType,
                    extensionHandle,
                    subscriptionData.isStatic
                  );
                } catch (e) {
                  channel.appendLine(
                    `[Error displaying message: ${e.message}]`
                  );
                }
                channel.appendLine("");

                // Track output lines and clear if too many
                // Guess how many lines this will take
                let estimatedLines = 5; // Default
                if (
                  messageType &&
                  messageType.includes("LaserScan") &&
                  subscriptionData.pendingMessage?.ranges
                ) {
                  estimatedLines += Math.ceil(
                    subscriptionData.pendingMessage.ranges.length / 50
                  );
                } else if (
                  messageType &&
                  messageType.includes("OccupancyGrid") &&
                  subscriptionData.pendingMessage?.data
                ) {
                  estimatedLines += Math.ceil(
                    subscriptionData.pendingMessage.data.length / 100
                  );
                } else if (
                  messageType &&
                  messageType.includes("std_msgs/String") &&
                  subscriptionData.pendingMessage?.data
                ) {
                  estimatedLines +=
                    subscriptionData.pendingMessage.data.split("\n").length;
                }

                subscriptionData.outputLineCount += estimatedLines;

                if (
                  subscriptionData.outputLineCount >
                    subscriptionData.maxOutputLines &&
                  !subscriptionData.isStatic
                ) {
                  channel.clear();
                  channel.appendLine(
                    `Topic: ${topicName} (Output cleared after ${subscriptionData.maxOutputLines} lines)`
                  );
                  channel.appendLine(
                    `Total messages received: ${subscriptionData.messageCount}`
                  );
                  channel.appendLine("");
                  subscriptionData.outputLineCount = 3;
                }

                // Clear the pending message after displaying
                subscriptionData.pendingMessage = null;
              }

              // See if we can visualize this
              const detectedType = VisualizationPanel.detectMessageType(
                messageType,
                msg
              );
              if (
                detectedType === "OccupancyGrid" ||
                detectedType === "LaserScan" ||
                detectedType === "URDF"
              ) {
                if (
                  !subscriptionData.visualizationPanel &&
                  !subscriptionData.creatingPanel
                ) {
                  subscriptionData.creatingPanel = true;
                  VisualizationPanel.createOrShow(
                    context.extensionUri,
                    topicName,
                    messageType,
                    msg
                  )
                    .then((panel) => {
                      subscriptionData.creatingPanel = false;
                      if (panel) {
                        subscriptionData.visualizationPanel = panel;
                        panel.updateData(msg);
                      }
                    })
                    .catch(() => {
                      subscriptionData.creatingPanel = false;
                    });
                } else if (subscriptionData.visualizationPanel) {
                  subscriptionData.visualizationPanel.updateData(msg);
                }
              }
            }
          );

          if (subscription) {
            subscription.subscriptionData = subscriptionData;
            channels[channelName].appendLine(
              `Successfully subscribed to topic: ${topicName}`
            );
            channels[channelName].appendLine(`Message Type: ${messageType}`);
            if (subscriptionData.isStatic) {
              channels[channelName].appendLine(
                `Note: This appears to be a static/latched topic. Output will be preserved.`
              );
            }
            channels[channelName].appendLine(`Waiting for messages...`);
            channels[channelName].appendLine("");

            // Store the subscription data in channels for cleanup tracking
            channels[channelName].subscriptionData = subscriptionData;
            channels[channelName].topicName = topicName;

            vscode.window.showInformationMessage(
              `Subscribed to topic: ${topicName}`
            );
          } else {
            tree.setTopicSubscriptionState(topicName, false);
            nodeTree.setTopicSubscriptionState(topicName, false);
            channels[channelName].appendLine("Failed to create subscription");
            vscode.window.showErrorMessage(
              `Failed to subscribe to topic: ${topicName}`
            );
          }
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.unsubscribe-from-topic`,
        async (topic) => {
          if (!topic || !topic.label) {
            vscode.window.showErrorMessage("No topic selected");
            return;
          }

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS 2 bridge");
            return;
          }

          const topicName = topic.label;

          tree.setTopicSubscriptionState(topicName, false);
          nodeTree.setTopicSubscriptionState(topicName, false);

          const topics = ws.topics;
          const subscription = topics ? topics.get(topicName) : null;

          // Clean up visualization panel if exists
          if (
            subscription &&
            subscription.subscriptionData &&
            subscription.subscriptionData.visualizationPanel
          ) {
            subscription.subscriptionData.visualizationPanel.dispose();
            subscription.subscriptionData.visualizationPanel = null;
            subscription.subscriptionData.creatingPanel = false;
          }

          // Unsubscribe from the topic
          const unsubscribed = ws.unsubscribeTopic(topicName);

          // Clean up subscription data
          if (subscription && subscription.subscriptionData) {
            subscription.subscriptionData.pendingMessage = null;
            subscription.subscriptionData = null;
          }

          // Clean up output channels
          const channelName = `ROS Topic: ${topicName}`;
          if (channels[channelName]) {
            channels[channelName].clear();
            channels[channelName].appendLine(
              `[Unsubscribed from ${topicName}]`
            );
            channels[channelName].hide();
            // Dispose the channel
            channels[channelName].dispose();
            delete channels[channelName];
            outputChannels.delete(channelName);
          }

          // Also clean up any legacy node-based channels
          for (const [name, channel] of outputChannels) {
            if (name !== "main" && name.includes(topicName)) {
              channel.clear();
              channel.hide();
              channel.dispose();
              outputChannels.delete(name);
              if (channels[name]) {
                delete channels[name];
              }
            }
          }

          if (unsubscribed) {
            vscode.window.showInformationMessage(
              `Unsubscribed from topic: ${topicName}`
            );
          } else {
            // Revert UI state if unsubscribe failed
            tree.setTopicSubscriptionState(topicName, true);
            vscode.window.showWarningMessage(
              `Failed to unsubscribe from topic: ${topicName}`
            );
          }
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.inspect-topic-from-tree`,
        async (topic) => {
          if (!topic) {
            vscode.window.showErrorMessage("No topic selected");
            return;
          }

          // Use the existing inspect-topic-message command
          vscode.commands.executeCommand(
            `${extensionHandle}.inspect-topic-message`,
            topic
          );
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.inspect-service-type`,
        async (treeItem) => {
          if (!treeItem) {
            vscode.window.showErrorMessage("No service selected");
            return;
          }

          const serviceName = treeItem.label || treeItem.id;

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS 2 bridge");
            return;
          }

          MessageInspectorPanel.createOrShow(context.extensionUri, ws);
          setTimeout(() => {
            if (MessageInspectorPanel.currentPanel) {
              ws.getServiceDetails(serviceName, (serviceType, error) => {
                if (error) {
                  vscode.window.showErrorMessage(
                    `Failed to get service type: ${error}`
                  );
                  return;
                }
                MessageInspectorPanel.currentPanel._inspectServiceType(
                  serviceType
                );
              });
            }
          }, 500);
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.inspect-action-type`,
        async (treeItem) => {
          if (!treeItem) {
            vscode.window.showErrorMessage("No action selected");
            return;
          }

          const actionName = treeItem.label || treeItem.id;

          MessageInspectorPanel.createOrShow(context.extensionUri, ws);
          setTimeout(() => {
            if (MessageInspectorPanel.currentPanel) {
              MessageInspectorPanel.currentPanel._inspectActionType(actionName);
            }
          }, 500);
        }
      )
    );

    channels["main"].show();

    // Store references for cleanup in deactivate
    global.vsCodeRosExtensionContext = {
      ws,
      outputChannels,
      channels,
      tree,
    };
  } catch (error) {
    console.error("Activation error:", error);
    vscode.window.showErrorMessage(
      `Failed to activate ROS 2 Bridge Extension: ${error.message}`
    );
    throw error;
  }
}

function deactivate() {
  // Dispose all resources to prevent memory leaks
  try {
    // Access variables from activate scope if they exist
    const context = global.vsCodeRosExtensionContext;
    if (!context) return;

    const { ws, outputChannels, channels, tree } = context;

    // Disconnect from ROS 2 bridge if connected
    if (ws && ws.isConnected()) {
      ws.disconnect();
    }

    // Dispose all output channels
    if (outputChannels) {
      outputChannels.forEach((channel) => {
        channel.dispose();
      });
      outputChannels.clear();
    }

    // Dispose main channels
    if (channels) {
      Object.values(channels).forEach((channel) => {
        if (channel && channel.dispose) {
          channel.dispose();
        }
      });
    }

    // Dispose all webview panels
    if (VisualizationPanel && VisualizationPanel.disposeAll) {
      VisualizationPanel.disposeAll();
    }

    if (ConnectionDashboard && ConnectionDashboard.currentPanel) {
      ConnectionDashboard.currentPanel.dispose();
    }

    if (ParametersPanel && ParametersPanel.disposeAll) {
      ParametersPanel.disposeAll();
    }

    if (BagRecorderPanel && BagRecorderPanel.currentPanel) {
      BagRecorderPanel.currentPanel.dispose();
    }

    if (MessageInspectorPanel && MessageInspectorPanel.currentPanel) {
      MessageInspectorPanel.currentPanel.dispose();
    }

    // Clear tree provider
    if (tree) {
      tree.resetAllCheckboxes();
    }

    // Clear global context
    global.vsCodeRosExtensionContext = null;
  } catch (error) {
    console.error("Error during deactivation:", error);
  }
}

module.exports = { activate, deactivate };
