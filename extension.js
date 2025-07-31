const vscode = require("vscode");

let RosbridgeClient,
  PublishersProvider,
  VisualizationPanel,
  ConnectionDashboard,
  ParametersPanel,
  BagRecorderPanel,
  extensionHandle;

try {
  RosbridgeClient = require("./rosbridge");
  ({ PublishersProvider } = require("./ui/tree"));
  ({ VisualizationPanel } = require("./ui/visualizationPanel"));
  ConnectionDashboard = require("./ui/connectionDashboard");
  ParametersPanel = require("./ui/parametersPanel");
  BagRecorderPanel = require("./ui/bagRecorderPanel");
  ({ extensionHandle } = require("./utils/helpers"));
} catch (error) {
  vscode.window.showErrorMessage(`Module load error: ${error.message}`);
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

    let bridge = [];
    let channels = {};
    let ws = null;

    // Create a Map to track all output channels for proper cleanup
    const outputChannels = new Map();

    // Create main output channel for extension logs
    channels["main"] = vscode.window.createOutputChannel(
      "ROS Bridge Extension"
    );
    outputChannels.set("main", channels["main"]);

    // Create and register tree view provider
    let tree = new PublishersProvider(
      bridge,
      extensionHandle,
      channels["main"]
    );
    vscode.window.registerTreeDataProvider("extNodesView", tree);

    context.subscriptions.push(
      vscode.commands.registerCommand(
        `${extensionHandle}.connect-bridge`,
        async () => {
          if (ws && ws.isConnected()) {
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
          }

          const config = vscode.workspace.getConfiguration(extensionHandle);
          const rosbridgeUrl = config.get(
            "rosbridgeUrl",
            "ws://localhost:9090"
          );
          const customUrl = await vscode.window.showInputBox({
            placeHolder: "ws://localhost:9090",
            prompt:
              "Enter ROS Bridge WebSocket URL (e.g., ws://192.168.1.100:9090)",
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
            vscode.window.showInformationMessage(
              `Connecting to rosbridge at ${customUrl}...`
            );
            bridge.push(customUrl);
            ws = new RosbridgeClient(customUrl, channels["main"]);
            tree.setRosbridgeClient(ws);

            ws.waitForConnection()
              .then(() => {
                vscode.commands.executeCommand(
                  "setContext",
                  "vscode-ros-extension.isConnected",
                  true
                );
                tree.refresh();
                ConnectionDashboard.createOrShow(context.extensionUri, ws);
              })
              .catch((error) => {
                channels["main"].appendLine(`Failed to connect: ${error}`);
                vscode.window.showErrorMessage(
                  `Failed to connect to rosbridge: ${error}`
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

          tree.setRosbridgeClient(null);
          tree.resetAllCheckboxes();
          tree.refresh();

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
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.refresh-connections`,
        () => tree.refresh()
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.toggle-subscription`,
        (treeItem, messageType) => {
          if (!ws || !(ws instanceof RosbridgeClient)) {
            vscode.window.showErrorMessage(
              "No connection to ROS bridge. Please connect first."
            );
            return;
          }

          let channelName;
          let topicName;

          if (typeof treeItem === "string") {
            channelName = treeItem;
            // Extract topic name, removing node name prefix
            const parts = treeItem.split("/");
            topicName = "/" + parts.slice(2).join("/");
          } else if (treeItem && typeof treeItem === "object") {
            const nodeName = treeItem.nodeLabel;
            // Ensure topic starts with / and avoid double slashes
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

          let stateResult = tree.toggleCheckbox(channelName);
          let state = stateResult && stateResult[0];

          if (state) {
            // Subscribe using rosbridge
            const topicMessageType = messageType || "std_msgs/String";

            let subscriptionData = {
              visualizationPanel: null,
              creatingPanel: false,
              topicName: topicName,
              messageType: topicMessageType,
            };

            const subscription = ws.subscribeTopic(
              topicName,
              topicMessageType,
              (msg) => {
                const timestamp = new Date().toISOString();
                channels[channelName].appendLine(
                  `[${timestamp}] Message received:`
                );
                channels[channelName].appendLine(JSON.stringify(msg, null, 2));
                channels[channelName].appendLine("");

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

            // Clean up output channel for non-visualizable topics
            if (channels[channelName]) {
              channels[channelName].clear();
              channels[channelName].appendLine(
                `[Unsubscribed from ${topicName}]`
              );
              channels[channelName].hide();
            }
          }

          // Only show channel if we're subscribing (state is true)
          if (state && channels[channelName]) {
            channels[channelName].show();
          }
        }
      ),
      vscode.commands.registerCommand(
        `${extensionHandle}.call-service`,
        async (serviceName) => {
          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("Not connected to ROS bridge");
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
            vscode.window.showErrorMessage("Please select a valid ROS node");
            return;
          }

          if (!ws || !ws.isConnected()) {
            vscode.window.showErrorMessage("No active ROS bridge connection");
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
      )
    );

    channels["main"].show();
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to activate ROS Bridge Extension: ${error.message}`
    );
    throw error;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
