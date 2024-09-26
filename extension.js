const path = require("path");
const vscode = require("vscode");
const { PublishersProvider } = require("./ui/tree");
const SocketClient = require("./ws"); // assuming default export
const { BlackScreenPanel } = require("./ui/bscreen");
const { generateTimestamp, REPL } = require("./utils/helpers");
const bridge = require("zenoh_socketio_bridge");

function activate(context) {
  let bridgeAddresses = [];
  let subscriptions = {};
  let channels = {};
  channels["main"] = vscode.window.createOutputChannel("ros2-plugin");

  const ws = new SocketClient(undefined, channels["main"]);

  // Views
  const trees = new PublishersProvider(bridgeAddresses, channels["main"]);
  vscode.window.registerTreeDataProvider("nodes", trees);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ros2-plugin.connect-bridge", async () => {
      const address = await vscode.window.showInputBox({
        placeHolder: "http://localhost",
        prompt: "Remote Server you want to connect to",
      });
      if (address) {
        bridge.start(`tcp/${address.split("://")[1]}:7447`);
        vscode.window.showInformationMessage(`Connecting to ${address}...`);
        bridgeAddresses.push(address);
        BlackScreenPanel.createOrShow(context.extensionUri, ws);
        trees.refresh();
      } else {
        vscode.window.showWarningMessage("No address provided.");
      }
    }),
    vscode.commands.registerCommand(
      "ros2-plugin.refresh-connections",
      trees.refresh.bind(trees)
    ),
    vscode.commands.registerCommand(
      "ros2-plugin.toggle-subscription",
      (treeArg) => {
        // looks like {node_name}/{topic_name}`
        let key_expr = treeArg.split("/")[1];
        channels[treeArg] =
          channels[treeArg] || vscode.window.createOutputChannel(treeArg);

        let state = trees.toggleCheckbox(treeArg);
        let event = state ? "subscribe" : "unsubscribe";
        ws.send("message", JSON.stringify({ event, key_expr }));

        if (!subscriptions[key_expr]) {
          subscriptions[key_expr] = (msg) => {
            channels[treeArg].appendLine("");
            channels[treeArg].appendLine(JSON.stringify(msg));
          };
          updateWs();
        }

        channels[treeArg].show();
        BlackScreenPanel.updateScan();
      }
    ),
    vscode.commands.registerCommand(
      "ros2-plugin.create-subscriber",
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
    )
  );

  channels["main"].show();
  const updateWs = () => ws.listenSubscriptions(subscriptions);
}

module.exports = { activate }; // Export the activate function for use in your extension
