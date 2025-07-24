# Change Log

All notable changes to the "vscode-ros-extension" will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial release of ROS Bridge Extension
- ROS entity discovery (nodes, topics, services, publishers, subscribers)
- Topic subscription/unsubscription with real-time message display
- Advanced visualization support:
  - Occupancy Grid Maps (nav_msgs/OccupancyGrid)
  - Laser Scan Data (sensor_msgs/LaserScan)
  - URDF Robot Models (std_msgs/String containing URDF XML)
- Multiple view modes (Graphical, Raw Data, Both)
- Service calling functionality with JSON parameters
- Auto-reconnection to rosbridge
- Configurable WebSocket URL
- Tree view in activity bar with custom robot icon
- Context menus for different ROS entities
- Copy to clipboard for raw data

### Fixed
- URDF visualization orientation issues
- Improved scroll handling for streaming data

### Changed
- Migrated from previous communication method to rosbridge WebSocket protocol
- Modernized visualization panel UI
- Enhanced message type detection