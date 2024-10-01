const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { spawn } = require("child_process");

function ensurePort(address, defaultPort = 8000) {
  const addressWithPortPattern = /:(\d+)$/;
  if (addressWithPortPattern.test(address)) {
    return address; // Address already has a port
  } else {
    return `${address}:${defaultPort}`;
  }
}

function flattenArrayofObjects(array) {
  return array.reduce((acc, curr) => {
    return { ...acc, ...curr }; // Merge each object into the accumulator
  }, {});
}

function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}_${month}_${day}_${hours}_${minutes}_${seconds}`;
}

class REPL {
  constructor(
    sessionName,
    outputDirectory,
    lineTriggered = null,
    pyprocess = null,
    vscodeDocument = null,
    vscodeEditor = null,
    outputFilePath = null,
    outputChannel = null
  ) {
    this.sessionName = sessionName;
    this.outputDirectory = outputDirectory;
    this.lineTriggered = lineTriggered;
    this.pyprocess = pyprocess;
    this.vscodeDocument = vscodeDocument;
    this.vscodeEditor = vscodeEditor;
    this.outputFilePath = outputFilePath;
    this.outputChannel = outputChannel;
  }

  static async New(outputDir, session) {
    return await new REPL(session, outputDir).startSession();
  }

  async startSession() {
    return await this.spawnREPL();
  }

  async showOutputChannel() {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel(this.sessionName);
    }
    this.outputChannel.show();
  }

  async loadVscodeEditor() {
    if (!this.vscodeEditor) {
      this.vscodeEditor = await vscode.window.showTextDocument(
        this.vscodeDocument,
        {
          viewColumn: vscode.ViewColumn.Two,
          preview: false,
        }
      );
      return this.vscodeEditor;
    }
  }

  async loadVscodeDocument() {
    if (!this.vscodeDocument) {
      this.vscodeDocument = await vscode.workspace.openTextDocument(
        vscode.Uri.file(this.outputFilePath)
      );
    }
    return this.vscodeDocument;
  }

  async loadOutputPath() {
    await fs.promises.mkdir(this.outputDirectory, { recursive: true });
    // path of output file joined with extension folder
    this.outputFilePath = path.join(
      this.outputDirectory,
      this.sessionName.replace(/\//g, "")
    );
    if (!fs.existsSync(this.outputFilePath)) {
      await fs.promises.writeFile(
        this.outputFilePath,
        `"""\n\tPython REPL Session\n\tPress [Enter] to execute by line\n\tSelect [subscribe_callback] code block from (ln:8) and press [Ctrl + Shift + K] to edit subscription\n"""\n\ndef subscribe_callback(msg_in, msg_out):\n\treturn msg_out\n`
      );
    }
    return this.outputFilePath;
  }

  startPyprocess() {
    // python process
    if (!this.pyprocess) {
      this.pyprocess = spawn("python", ["-i"]);
    }

    const handleExecutionResult = (rawResult) => {
      if (rawResult.includes("Python")) return;

      if (!rawResult) return;

      const result = rawResult.replace(/^>>>|>>>$/gm, "").trim();

      let line = this.lineTriggered;
      let insert = line + 1;

      let cursor = insert + result.split("\n").length;

      const vscodePosition = (line, char) => {
        return new vscode.Position(line, char);
      };

      const moveCursorToLine = (line) => {
        if (this.vscodeEditor && this.vscodeEditor.selection) {
          this.vscodeEditor.selection = new vscode.Selection(
            vscodePosition(line, 0),
            vscodePosition(line, 0)
          );
        }
      };

      this.vscodeEditor
        .edit((builder) =>
          builder.insert(
            vscodePosition(insert, 0),
            result.length > 0 ? result + "\n" : result
          )
        )
        .then((success) => success && moveCursorToLine(cursor));
    };

    this.pyprocess.stdout.on("data", (data) => {
      handleExecutionResult(data.toString());
    });

    this.pyprocess.stderr.on("data", (data) => {
      handleExecutionResult(data.toString());
    });

    this.pyprocess.on("close", (code) => {
      this.pyprocess = null;
      // this.outputChannel.appendLine(`close : Python REPL exited with code ${code}`);
    });

    return this.pyprocess;
  }

  async spawnREPL() {
    this.startPyprocess();

    await this.loadOutputPath();
    await this.loadVscodeDocument();
    await this.loadVscodeEditor();
    return this;
  }
}

module.exports = {
  ensurePort,
  generateTimestamp,
  flattenArrayofObjects,
  REPL,
};
