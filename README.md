# vscode-ros-extension README

## Features

- Display of ros2 `nodes`/`topics`/`action_clients`/`server_clients` from the sever connected to dds bridge.
- Subscribe and unsubscribe ros2 `publishers`.
- Visualization `map`/`laser scan`.
- REPL enviroment **in progress**

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

- `vscode-ros-extension.connect-bridge"`: Connect to remote cluster with zenoh ros2dds bridge running.
- `vscode-ros-extension.refresh-connections`: Refresh nodes from the connected cluster.
- `vscode-ros-extension.toggle-subscription`: Sub/unsub available topics.
- `vscode-ros-extension.refresh-connections`: Create a subscriber `N/A`.
- `vscode-ros-extension.refresh-connections`: Publish the subscriber `N/A`.

### Configuration contributions

- `vscode-ros-extension.tcpPort`: Set tcp port to listen for `default "7447"`.
- `vscode-ros-extension.websocketPort`: Set tcp port to listen for `default "5001"`.
