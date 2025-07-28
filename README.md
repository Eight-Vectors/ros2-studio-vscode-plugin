# ROS Bridge Extension for Visual Studio Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/YOUR-PUBLISHER-ID.vscode-ros-extension)](https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER-ID.vscode-ros-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Connect to ROS systems via rosbridge WebSocket protocol directly from VS Code. Visualize topics, call services, and interact with ROS nodes without leaving your development environment.

## 🚀 Features

### Core Functionality

- **ROS Entity Discovery** - Browse nodes, topics, services, publishers, and subscribers in a tree view
- **Topic Subscriptions** - Subscribe/unsubscribe to ROS topics with real-time message display
- **Service Calls** - Call ROS services with JSON parameters and view responses
- **WebSocket Connection** - Connect to ROS systems via rosbridge WebSocket protocol

### Advanced Visualization

- **Occupancy Grid Maps** - 2D map visualization with zoom and pan
- **Laser Scan Data** - Real-time laser scan point cloud display
- **URDF Robot Models** - 3D robot visualization with proper coordinate transformations
- Multiple view modes for all visualizations:
  - **Graphical** - Interactive visual representation
  - **Raw Data** - JSON/XML data with syntax highlighting
  - **Both** - Side-by-side graphical and raw data views
- Copy to clipboard functionality for raw data
- Improved scroll handling for streaming data visualization

### Developer Tools

- **Auto-reconnection** - Automatic reconnection to rosbridge on disconnect
- **Configurable Connection** - Custom WebSocket URL configuration

## 📋 Requirements

- Visual Studio Code 1.93.0 or higher
- ROS system with rosbridge_server running
- WebSocket connection to rosbridge (default: `ws://localhost:9090`)

## 🔧 Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "ROS Bridge Extension"
4. Click Install


## ⚙️ Configuration

### Extension Settings

| Setting                             | Description             | Default               |
| ----------------------------------- | ----------------------- | --------------------- |
| `vscode-ros-extension.rosbridgeUrl` | Rosbridge WebSocket URL | `ws://localhost:9090` |

### Available Commands

| Command              | Description                 | Access                      |
| -------------------- | --------------------------- | --------------------------- |
| `Connect to Remote`  | Connect to rosbridge server | Command Palette / Tree View |
| `Disconnect`         | Disconnect from rosbridge   | Context Menu                |
| `Refresh connection` | Refresh ROS entities        | Tree View Button            |
| `Subscribe`          | Subscribe to topic          | Context Menu on Publishers  |
| `Visualize Topic`    | Open visualization panel    | Context Menu                |
| `Call Service`       | Call a ROS service          | Context Menu on Services    |

## 📖 Usage

### Getting Started

1. **Start rosbridge** on your ROS system:

   ```bash
   roslaunch rosbridge_server rosbridge_websocket.launch
   ```

2. **Connect to ROS**:

   - Click the robot icon in the activity bar
   - Click "Connect" or use Command Palette: `Connect to Remote`
   - Default connection is `ws://localhost:9090`

3. **Browse ROS entities**:
   - Expand the tree to see nodes, topics, and services
   - Right-click for context actions

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

### Supported Visualization Types

| Message Type             | Visualization | Description                              |
| ------------------------ | ------------- | ---------------------------------------- |
| `nav_msgs/OccupancyGrid` | 2D Map        | Interactive occupancy grid with zoom/pan |
| `sensor_msgs/LaserScan`  | Point Cloud   | Real-time laser scan visualization       |
| `std_msgs/String` (URDF) | 3D Model      | Robot model with Three.js renderer       |

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏢 About

This extension is developed and maintained by EightVectors. For commercial support and custom development, please contact us at [email@company.com].

## 🐛 Known Issues

- Large message rates may impact performance

## 📮 Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/YOUR-USERNAME/vscode-ros-extension/issues).
