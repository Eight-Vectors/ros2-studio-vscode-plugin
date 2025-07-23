const path = require("path");
const vscode = require("vscode");
const RosbridgeClient = require("./rosbridge");
const { PublishersProvider } = require("./ui/tree");
const { BlackScreenPanel } = require("./ui/bscreen");
const { VisualizationPanel } = require("./ui/visualizationPanel");
const { generateTimestamp, REPL, extensionHandle } = require("./utils/helpers");

// Clean map data to avoid circular reference errors
function processMapData(mapData, channels) {
  try {
    if (!mapData || !mapData.info) {
      throw new Error("Invalid map data structure");
    }

    const { width, height, resolution, origin } = mapData.info;

    channels["main"].appendLine(
      `Processing map: ${width}x${height} pixels, resolution: ${resolution}`
    );

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
      channels["main"].appendLine(
        `Converted ${cleanMapData.data.length} map data points`
      );
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

  if (BlackScreenPanel.currentPanel) {
    BlackScreenPanel.currentPanel._panel.webview.postMessage({
      command: "map_data",
      data: processedMap,
    });
    vscode.window.showInformationMessage("Map loaded in visualization panel");
  } else {
    vscode.window.showInformationMessage(
      "Map received. Open visualization panel to view."
    );
  }
}

function handleGenericServiceResult(serviceName, result, channels) {
  channels["main"].appendLine(`Service result for ${serviceName}:`);

  try {
    // handle circular reference
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
  let bridge = [];
  let channels = {};
  let ws = null;

  channels["main"] = vscode.window.createOutputChannel(extensionHandle);

  let tree = new PublishersProvider(bridge, extensionHandle, channels["main"]);
  vscode.window.registerTreeDataProvider("extNodesView", tree);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${extensionHandle}.connect-bridge`,
      async () => {
        const config = vscode.workspace.getConfiguration(extensionHandle);
        const rosbridgeUrl = config.get(
          "rosbridgeUrl",
          "ws://4.145.88.116:9090"
        );
        const customUrl = await vscode.window.showInputBox({
          placeHolder: rosbridgeUrl,
          prompt: "Rosbridge WebSocket URL",
          value: rosbridgeUrl,
        });

        if (customUrl) {
          vscode.window.showInformationMessage(
            `Connecting to rosbridge at ${customUrl}...`
          );
          bridge.push(customUrl);
          ws = new RosbridgeClient(customUrl, channels["main"]);
          tree.setRosbridgeClient(ws);
          BlackScreenPanel.createOrShow(context.extensionUri, ws);

          // Wait for connection before refreshing tree
          ws.waitForConnection()
            .then(() => {
              channels["main"].appendLine(
                "Connection established, refreshing tree..."
              );
              tree.refresh();
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
        let addr = bridge.pop();
        if (ws) {
          ws.disconnect();
          ws = null;
        }
        tree.refresh();
        vscode.window.showInformationMessage(`Disconnected from ${addr}...`);
      }
    ),
    vscode.commands.registerCommand(
      `${extensionHandle}.refresh-connections`,
      tree.refresh()
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

        channels[channelName] =
          channels[channelName] ||
          vscode.window.createOutputChannel(channelName);

        let state = tree.toggleCheckbox(channelName);

        if (state) {
          // Subscribe using rosbridge
          // messageType is already provided from the tree view
          const topicMessageType = messageType || "std_msgs/String";

          // Store subscription data for cleanup
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

              // Use new visualization panel for supported message types
              const detectedType = VisualizationPanel.detectMessageType(
                topicMessageType,
                msg
              );
              if (
                detectedType === "OccupancyGrid" ||
                detectedType === "LaserScan" ||
                detectedType === "URDF"
              ) {
                // Only create panel if not already creating or created
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

              // Keep legacy visualization for backward compatibility if enabled
              // if (BlackScreenPanel.currentPanel) {
              //   if (topicName === "/scan") {
              //     BlackScreenPanel.currentPanel._panel.webview.postMessage({
              //       command: "scan_data",
              //       data: msg,
              //     });
              //   } else if (topicName.includes("map")) {
              //     BlackScreenPanel.currentPanel._panel.webview.postMessage({
              //       command: "map_data",
              //       data: msg,
              //     });
              //   }
              // }
            }
          );

          if (!subscription) {
            channels[channelName].appendLine("Failed to create subscription");
          } else {
            // Store subscription data for cleanup
            subscription.subscriptionData = subscriptionData;
          }
        } else {
          // Get the subscription to clean up visualization panel
          const topics = ws.topics;
          const subscription = topics ? topics.get(topicName) : null;

          // Clean up visualization panel if it exists
          if (
            subscription &&
            subscription.subscriptionData &&
            subscription.subscriptionData.visualizationPanel
          ) {
            subscription.subscriptionData.visualizationPanel.dispose();
            // Clear the reference to ensure proper cleanup
            subscription.subscriptionData.visualizationPanel = null;
            subscription.subscriptionData.creatingPanel = false;
          }

          ws.unsubscribeTopic(topicName);

          // Clear visualization if unsubscribing from scan or map topics (legacy)
          if (BlackScreenPanel.currentPanel) {
            if (topicName === "/scan") {
              BlackScreenPanel.currentPanel._panel.webview.postMessage({
                command: "clear_scan",
              });
            } else if (topicName.includes("map")) {
              BlackScreenPanel.currentPanel._panel.webview.postMessage({
                command: "clear_map",
              });
            }
          }
        }

        channels[channelName].show();
      }
    ),
    vscode.commands.registerCommand(
      `${extensionHandle}.create-subscriber`,
      async (pub) => {
        const ch = `${pub.nodeLabel}/${pub.label}`;
        channels[ch] = channels[ch] || vscode.window.createOutputChannel(ch);
        channels[ch].show();

        const outputDir = path.join(context.extensionPath, "output-window");
        const replInstance = await REPL.New(
          outputDir,
          `${generateTimestamp()}-${pub.address}-${pub.nodeLabel}-${
            pub.label
          }.py`
        );

        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document === replInstance.vscodeDocument) {
            for (const change of event.contentChanges) {
              if (change.text === "\n") {
                replInstance.lineTriggered = change.range.start.line;
                if (replInstance.pyprocess) {
                  replInstance.pyprocess.stdin.write(
                    replInstance.vscodeDocument.lineAt(change.range.start.line)
                      .text + "\n"
                  );
                }
              }
            }
          }
        });
      }
    ),
    vscode.commands.registerCommand(
      `${extensionHandle}.call-service`,
      async (serviceName, nodeName) => {
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
        } catch (e) {
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
      `${extensionHandle}.visualize-topic`,
      async (treeItem) => {
        if (!treeItem || typeof treeItem !== "object") {
          vscode.window.showErrorMessage("Invalid topic selection");
          return;
        }

        const topicName = treeItem.label.startsWith("/")
          ? treeItem.label
          : "/" + treeItem.label;
        const messageType = treeItem.messageType || "unknown";

        // Open visualization panel directly
        VisualizationPanel.createOrShow(
          context.extensionUri,
          topicName,
          messageType,
          null
        );
      }
    ),
    vscode.commands.registerCommand(
      `${extensionHandle}.reset-visualization-preference`,
      () => {
        vscode.window.showInformationMessage(
          "Visualization view mode will be requested for each topic subscription."
        );
      }
    )
  );

  channels["main"].show();
}

module.exports = { activate };
