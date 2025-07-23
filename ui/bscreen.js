const vscode = require("vscode");

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

  static updateScan() {}

  static updateMap() {}

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
      </head>
      <body>
        <div id="content">
          <h1>Vscode Ros Extension.</h1>
        </div>
        <div id="data"></div>
        <canvas id="canvas" width="0" height="0"></canvas>
        <script>
          console.log("Webview content loaded");
          let selectedTopics = {};
          let mapdata = {};

          function convertRosMapFrameToCanvas (x,y,originX,originY,resolution,mapHeight){
            const mapX = (x - originX) / resolution;
            const mapY = (y - originY) / resolution;
            // In canvas, Y is flipped (0 is top, but in ROS 0 is bottom)
            const canvasX = mapX;
            const canvasY = mapY;
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
                  mapdata = message.data;
                  // Avoid logging entire mapdata to prevent circular reference errors
                  console.log("Map data received");
                  console.log("Map info - width:", mapdata?.info?.width, "height:", mapdata?.info?.height);
                  console.log("Map data array length:", mapdata?.data?.length);
                  
                  // Set canvas dimensions based on map info
                  const width = mapdata?.info?.width || 0;
                  const height = mapdata?.info?.height || 0;
                  
                  if (width === 0 || height === 0) {
                    console.error("Invalid map dimensions:", width, "x", height);
                    document.getElementById('data').innerHTML = '<p style="color: red;">Invalid map dimensions</p>';
                    break;
                  }
                  
                  canvas.width = width;
                  canvas.height = height;
                  canvas.style.display = 'block';
                  
                  // Clear and prepare canvas
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  
                  // Render map data
                  if (mapdata.data && mapdata.data.length > 0) {
                    const imageData = ctx.createImageData(width, height);
                    const data = imageData.data;
                    const pixels = mapdata.data;
                    
                    console.log("Processing", pixels.length, "pixels for", width + "x" + height, "map");
                    
                    for (let i = 0; i < pixels.length; i++) {
                      let value = pixels[i];
                      // Convert occupancy grid values (-1 = unknown, 0 = free, 100 = occupied)
                      let color;
                      if (value === -1) {
                        color = 128; // Gray for unknown
                      } else if (value === 0) {
                        color = 255; // White for free space
                      } else {
                        color = 255 - Math.round((value / 100.0) * 255); // Black for occupied
                      }
                      
                      data[i * 4] = color;      // R
                      data[i * 4 + 1] = color;  // G
                      data[i * 4 + 2] = color;  // B
                      data[i * 4 + 3] = 255;    // A
                    }
                    
                    ctx.putImageData(imageData, 0, 0);
                    console.log("Map rendered successfully");
                    document.getElementById('data').innerHTML = '<p style="color: green;">Map loaded: ' + width + 'x' + height + '</p>';
                  }
                  break;

                case 'scan_data':
                  const scanObj = message.data;
                  console.log("Scan data received:", scanObj);
                  
                  const angle_min = scanObj.angle_min;
                  const angle_max = scanObj.angle_max;
                  const angle_increment = scanObj.angle_increment;
                  const ranges = scanObj.ranges;
                  console.log("MapData From Scan", mapdata);
                  
                  // Only visualize if we have map data
                  if (mapdata && mapdata.info) {
                    ctx.fillStyle = 'green';
                    
                    const originX = mapdata.info.origin?.position?.x || 0;
                    const originY = mapdata.info.origin?.position?.y || 0;
                    const resolution = mapdata.info.resolution || 0.05;
                    const mapHeight = mapdata.info.height;
                    
                    ranges.forEach((dp, idx) => {
                      if (dp > 0 && dp < 100) { // Filter out invalid ranges
                        const angle = angle_min + (idx * angle_increment);
                        // Convert scan to world coordinates (assuming scan is at robot position 0,0)
                        const worldX = dp * Math.cos(angle);
                        const worldY = dp * Math.sin(angle);
                        
                        // Convert world coordinates to canvas coordinates
                        const coords = convertRosMapFrameToCanvas(worldX, worldY, originX, originY, resolution, mapHeight);
                        
                        const width = 1;
                        const height = 1;
                        
                        ctx.fillRect(coords.canvasX - width/2, coords.canvasY - height/2, width, height);
                      }
                    });
                  } else {
                    // No map loaded - create a simple visualization
                    const scanCanvasSize = 800;
                    canvas.width = scanCanvasSize;
                    canvas.height = scanCanvasSize;
                    
                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Draw background
                    ctx.fillStyle = 'black';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // Set transform to center
                    ctx.save();
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    
                    // Draw origin
                    ctx.strokeStyle = 'red';
                    ctx.beginPath();
                    ctx.moveTo(-10, 0);
                    ctx.lineTo(10, 0);
                    ctx.moveTo(0, -10);
                    ctx.lineTo(0, 10);
                    ctx.stroke();
                    
                    // Draw scan points
                    ctx.fillStyle = 'green';
                    const defaultResolution = 0.05; // Default 5cm per pixel
                    
                    ranges.forEach((dp, idx) => {
                      if (dp > 0 && dp < 100) { // Filter out invalid ranges
                        const angle = angle_min + (idx * angle_increment);
                        const px = 1 * ((dp * Math.cos(angle)) / defaultResolution);
                        const py = -1 * ((dp * Math.sin(angle)) / defaultResolution);
                        
                        const width = 1;
                        const height = 1;
                        
                        ctx.fillRect(px, py, width, height);
                      }
                    });
                    
                    ctx.restore();
                  }
                  break;
                  
                case 'clear_scan':
                  console.log("Clearing scan data");
                  // If we have a map, just redraw the map without scan
                  if (mapdata && mapdata.info) {
                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Redraw map only
                    const width = mapdata?.info?.width || mapdata?.width || 0;
                    const height = mapdata?.info?.height || mapdata?.height || 0;
                    
                    if (mapdata.data && mapdata.data.length > 0) {
                      const imageData = ctx.createImageData(width, height);
                      const data = imageData.data;
                      const pixels = mapdata.data;
                      
                      for (let i = 0; i < pixels.length; i++) {
                        let value = pixels[i];
                        let color;
                        if (value === -1) {
                          color = 128; // Gray for unknown
                        } else if (value === 0) {
                          color = 255; // White for free space
                        } else {
                          color = 255 - Math.round((value / 100.0) * 255); // Black for occupied
                        }
                        
                        data[i * 4] = color;
                        data[i * 4 + 1] = color;
                        data[i * 4 + 2] = color;
                        data[i * 4 + 3] = 255;
                      }
                      
                      ctx.putImageData(imageData, 0, 0);
                    }
                  } else {
                    // No map, just clear the canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  break;
                  
                case 'clear_map':
                  console.log("Clearing map data");
                  mapdata = {};
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  canvas.width = 0;
                  canvas.height = 0;
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
