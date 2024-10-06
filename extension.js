const path = require("path");
const vscode = require("vscode");
const SocketClient = require("./ws");
const { PublishersProvider } = require("./ui/tree");
const { BlackScreenPanel } = require("./ui/bscreen");
const { generateTimestamp, REPL, extensionHandle } = require("./utils/helpers");

function activate(context) {
  let bridge = [];
  let channels = {};
  let subscriptions = {};
  let ws = null;

  channels["main"] = vscode.window.createOutputChannel(extensionHandle);

  let tree = new PublishersProvider(bridge, extensionHandle, channels["main"]);
  vscode.window.registerTreeDataProvider("extNodesView", tree);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${extensionHandle}.connect-bridge`,
      async () => {
        const input = await vscode.window.showInputBox({
          placeHolder: "http://localhost",
          prompt: "Remote Server you want to connect to",
        });
        if (input) {
          vscode.window.showInformationMessage(`Connecting to ${input}...`);
          bridge.push(input);
          ws = new SocketClient(input, channels["main"]);
          BlackScreenPanel.createOrShow(context.extensionUri, ws);
          tree.refresh();
        } else {
          vscode.window.showWarningMessage("No address provided.");
        }
      }
    ),
    vscode.commands.registerCommand(
      `${extensionHandle}.disconnect-bridge`,
      async () => {
        let addr = bridge.pop();
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
      (treeArg) => {
        // looks like {node_name}/{topic_name}`
        let key_expr = treeArg.split("/").slice(1).join("/");
        channels[treeArg] =
          channels[treeArg] || vscode.window.createOutputChannel(treeArg);

        let state = tree.toggleCheckbox(treeArg);
        let event = state ? "subscribe" : "unsubscribe";
        ws.send("message", JSON.stringify({ event, key_expr }));

        if (event == "subscribe") {
          if (!subscriptions[key_expr]) {
            subscriptions[key_expr] = (msg) => {
              channels[treeArg].appendLine("");
              channels[treeArg].appendLine(JSON.stringify(msg));
            };
            updateWs();
          }
        } else {
          delete subscriptions[key_expr];
        }

        channels[treeArg].show();
        if (key_expr === "scan") {
          BlackScreenPanel.updateScan();
        } else if (key_expr.includes("map")) {
          BlackScreenPanel.updateMap(key_expr);
        }
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
    )
  );

  channels["main"].show();
  const updateWs = () => ws.listenSubscriptions(subscriptions);
}

module.exports = { activate }; // Export the activate function for use in your extension
