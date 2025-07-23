# vscode-ros-extension README

## Features

- Display of ros2 `nodes`/`topics`/`action_clients`/`server_clients` from the server connected to dds bridge.
- Subscribe and unsubscribe ros2 `publishers`.
- Advanced visualization support:
  - **Occupancy Grid Maps** - 2D map visualization with zoom and pan
  - **Laser Scan Data** - Real-time laser scan point cloud display
  - **URDF Robot Models** - 3D robot visualization with proper coordinate transformations
- Multiple view modes for all visualizations:
  - **Graphical** - Interactive visual representation
  - **Raw Data** - JSON/XML data with syntax highlighting
  - **Both** - Side-by-side graphical and raw data views
- Copy to clipboard functionality for raw data
- Improved scroll handling for streaming data visualization
- REPL environment **in progress**

## Debugging Setup

Follow these steps to debug/test **vscode-ros-extension** inside vscode editor.

### Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/download)
- [Node JS](https://nodejs.org/en)

### VSCode : Debug

To debug/test the extension on vscode editor:

- Clone the repository and change directory to the repostiory.

```bash
git clone <repository_url>
cd <repository_folder>
code .
```

- Press `F5` to launch the extension in a new VSCode window.

## Extension Settings

This extension contributes the following settings:

### Commands contributions

- `vscode-ros-extension.connect-bridge`: Connect to remote cluster with zenoh ros2dds bridge running.
- `vscode-ros-extension.refresh-connections`: Refresh nodes from the connected cluster.
- `vscode-ros-extension.toggle-subscription`: Sub/unsub available topics.
- `vscode-ros-extension.refresh-connections`: Create a subscriber `N/A`.
- `vscode-ros-extension.refresh-connections`: Publish the subscriber `N/A`.

<!-- ### Configuration contributions

- `vscode-ros-extension.tcpPort`: Set tcp port to listen for `default "7447"`.
- `vscode-ros-extension.websocketPort`: Set tcp port to listen for `default "5001"`. -->

## Usage

### Visualization Features

1. **Subscribe to a topic** - Right-click on a publisher topic in the ROS tree view and select "Subscribe"
2. **View modes** - When visualization opens, choose between:
   - Graphical view for interactive visualization
   - Raw data view for inspecting message structure
   - Both mode for side-by-side comparison
3. **Copy raw data** - Click the "Copy" button in raw data view to copy the content to clipboard
4. **3D navigation** (URDF models):
   - Mouse drag to rotate
   - Scroll to zoom
   - Right-click drag to pan

### Supported Message Types

- `nav_msgs/OccupancyGrid` - 2D occupancy grid maps
- `sensor_msgs/LaserScan` - Laser scan data visualization
- `std_msgs/String` (containing URDF XML) - 3D robot model visualization
