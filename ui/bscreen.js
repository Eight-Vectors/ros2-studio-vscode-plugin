const vscode = require("vscode");
const helpers = require("../utils/helpers");

class BlackScreenPanel {
  static currentPanel;
  static viewType = "blackScreen";

  constructor(panel, extensionUri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._disposables = [];
    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  static createOrShow(extensionUri, socket) {
    console.log(socket);
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (BlackScreenPanel.currentPanel) {
      BlackScreenPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BlackScreenPanel.viewType,
      "ROS 2 Topic Data",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );
    BlackScreenPanel.socket = socket;

    BlackScreenPanel.currentPanel = new BlackScreenPanel(panel, extensionUri);
  }

  static updateScan() {
    if (BlackScreenPanel.currentPanel) {
      this.socket.on("scan", (data) => {
        BlackScreenPanel.currentPanel._panel.webview.postMessage({
          command: "scan_data",
          data: data,
        });
      });
    }
  }

  static updateMap(map_name) {
    if (BlackScreenPanel.currentPanel) {
      this.socket.on(map_name, (data) => {
        data = {
          ...data,
          info: helpers.flattenArrayofObjects(data?.info),
        };
        BlackScreenPanel.currentPanel._panel.webview.postMessage({
          command: "map_data",
          data: data,
        });
      });
    }
  }

  static update(data, checked, topic) {
    if (BlackScreenPanel.currentPanel) {
      BlackScreenPanel.currentPanel._panel.webview.postMessage({
        command: "update",
        data: data,
        checked,
        topic,
      });
    }
  }

  dispose() {
    BlackScreenPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  _getHtmlForWebview() {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ROS 2 Topic Data</title>
        <style>
          body { background-color: black; color: white; }
          h1 { color: white; }
          canvas { background-color: white; }
        </style>
        <script
          src="https://cdn.socket.io/4.7.5/socket.io.min.js"
          integrity="sha384-2huaZvOR9iDzHqslqwpR87isEmrfxqyWOF7hr7BY6KG0+hVKLoEXMPUJw3ynWuhO"
          crossorigin="anonymous"
        ></script>
      </head>
      <body>
        <div id="content">
          <h1>Welcome to ROS VS Code Extension.</h1>
        </div>
        <div id="data"></div>
        <canvas id="canvas" width="0" height="0"></canvas>
        <script>
          console.log("Webview content loaded");
          let selectedTopics = {};
          let mapdata = {};

          function convertRosMapFrameToCanvas (x,y,originX,originY,resolution){
            const mx = -1 * (originX);
            const my = -1 * (originY);
            const canvasX = (x + mx) / resolution;
            const canvasY = (y + my) / resolution;
            return {canvasX,canvasY}
          }

          document.addEventListener('DOMContentLoaded', function() {
            console.log("DOMContentLoaded event fired");
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext('2d');

            window.addEventListener('message', (event) => {
              const message = event.data;
              console.log("Message received: ", message);

              switch (message.command) {
                case 'map_data':
                  mapdata = message.data
                  console.log("map data" + mapdata)
                  canvas.width = mapdata?.width ?? 0;
                  canvas.height = mapdata?.height ?? 0;
                  ctx.translate(canvas.width / 2, canvas.height / 2);
                  // const imageData = ctx.createImageData(mapdata.width,mapdata.height);
                  // const data = imageData.data;
                  // const pixels = mapdata.data;
                  // const maxval = 255;
          
                  // for (let i = 0; i < pixels.length; i++) {
                  //   const intensity = Math.round((pixels[i] / maxval) * 255);
                  //   data[i * 4] = intensity;    // R
                  //   data[i * 4 + 1] = intensity;// G
                  //   data[i * 4 + 2] = intensity;// B
                  //   data[i * 4 + 3] = 255;      // A
                  // }
                  // ctx.putImageData(imageData, 0, 0);
                  break;

                case 'scan_data':
                  const scanObj = message.data;
                  const angle_min = scanObj.angle_min;
                  const angle_max = scanObj.angle_max;
                  const angle_increment = scanObj.angle_increment;
                  const ranges = scanObj.ranges;
                  console.log("MapData From Scan",mapdata);

                  ranges.forEach((dp, idx) => {
                    const angle = angle_min + (idx * angle_increment);
                    const px =1 * ((dp * Math.cos(angle)) / mapdata?.resolution) ;
                    const py =-1 * ((dp * Math.sin(angle)) / mapdata?.resolution);

                    const width = 5;
                    const height = 5;

                    ctx.fillStyle = 'green';
                    ctx.fillRect(px, py, width, height);
                  });
                  break;
              }
            });
          });
        </script>
      </body>
      </html>`;
  }
}

module.exports = {
  BlackScreenPanel,
};
