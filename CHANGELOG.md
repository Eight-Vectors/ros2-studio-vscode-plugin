# Change Log

All notable changes to the "ROS 2 Studio" will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.1] - 2025-08-06

### Added

- Initial release of ROS 2 Studio Extension
- ROS 2 entity discovery (nodes, topics, services, publishers, subscribers)
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
- Context menus for different ROS 2 entities
- Copy to clipboard for raw data
- Node Parameter Configuration panel:
  - View and edit ROS 2 node parameters in real-time
  - Type validation for bool, int, double, string, and arrays
  - Search and filter parameters
  - Manual mode for systems without rosapi
- ROS 2 Bag Recorder panel:
  - Select topics for recording
  - Generate ros2 bag record commands
  - Topic management interface
- Connection Dashboard showing ROS 2 system information

### Fixed

- URDF visualization orientation issues
- Improved scroll handling for streaming data

### Changed

- Migrated from previous communication method to rosbridge WebSocket protocol
- Modernized visualization panel UI
- Enhanced message type detection
