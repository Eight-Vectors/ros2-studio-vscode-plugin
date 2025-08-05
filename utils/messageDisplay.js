const vscode = require("vscode");

function displayMessageIntelligently(channel, message, messageType, extensionHandle, isStatic = false) {
  const config = vscode.workspace.getConfiguration(extensionHandle);
  const maxDisplayLength = config.get("maxMessageDisplayLength", 2000);
  const showFullData = config.get("showFullDataForKnownTypes", true);
  
  // Check for known message types first
  if (messageType) {
    if (messageType.includes("OccupancyGrid")) {
      displayOccupancyGridMessage(channel, message, showFullData);
      return;
    }
    
    if (messageType.includes("LaserScan")) {
      displayLaserScanMessage(channel, message, showFullData);
      return;
    }
    
    if (messageType.includes("PointCloud2") || messageType.includes("PointCloud")) {
      displayPointCloudMessage(channel, message, showFullData);
      return;
    }
    
    if (messageType.includes("Image") || messageType.includes("CompressedImage")) {
      displayImageMessage(channel, message, showFullData);
      return;
    }
    
    if (messageType.includes("tf2_msgs/TFMessage")) {
      displayTFMessage(channel, message);
      return;
    }
    
    if (messageType.includes("std_msgs/String")) {
      displayStringMessage(channel, message, isStatic);
      return;
    }
  }
  
  // For other message types
  if (message && typeof message === 'object') {
    if (hasGeometricData(message)) {
      displayGeometricMessage(channel, message, messageType);
      return;
    }
    
    if (hasSensorData(message)) {
      displaySensorMessage(channel, message, messageType, showFullData);
      return;
    }
    
    if (hasBinaryData(message)) {
      displayBinaryMessage(channel, message, messageType, showFullData);
      return;
    }
    
    if (hasArrayData(message)) {
      displayArrayMessage(channel, message, messageType, showFullData);
      return;
    }
  }
  
  // Show other messages as JSON
  displayDefaultMessage(channel, message, maxDisplayLength, isStatic);
}

function hasBinaryData(message) {
  return message.data && (
    ArrayBuffer.isView(message.data) ||
    message.data instanceof ArrayBuffer ||
    (Array.isArray(message.data) && message.data.length > 100 && typeof message.data[0] === 'number')
  );
}

function hasGeometricData(message) {
  return (
    message.transform ||
    message.pose ||
    message.position ||
    message.orientation ||
    message.translation ||
    message.rotation ||
    message.transforms ||
    message.poses
  );
}

function hasSensorData(message) {
  return (
    message.ranges ||
    message.intensities ||
    message.points ||
    (message.height !== undefined && message.width !== undefined) ||
    message.fields ||
    message.channels
  );
}

function isStringMessage(message) {
  return message.data && typeof message.data === 'string';
}

function hasArrayData(message) {
  const arrayFields = Object.keys(message).filter(key => 
    Array.isArray(message[key]) && message[key].length > 0
  );
  return arrayFields.length > 0;
}

// Display functions for ROS message types
function displayOccupancyGridMessage(channel, message, showFullData) {
  channel.appendLine("{");
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  if (message.info) {
    channel.appendLine(`  "info": ${formatJson(message.info, 2)},`);
  }
  if (message.data) {
    if (showFullData) {
      if (message.data.length > 1000) {
        channel.appendLine(`  "data": [`);
        const chunkSize = 100;
        let line = "    ";
        for (let i = 0; i < message.data.length; i++) {
          line += message.data[i];
          if ((i + 1) % chunkSize === 0 || i === message.data.length - 1) {
            if (i < message.data.length - 1) line += ",";
            channel.appendLine(line);
            line = "    ";
          } else {
            line += ", ";
          }
        }
        channel.appendLine(`  ]`);
      } else {
        channel.appendLine(`  "data": ${JSON.stringify(message.data)}`);
      }
    } else {
      channel.appendLine(`  "data": [Array of ${message.data.length} elements]`);
    }
  }
  channel.appendLine("}");
}

function displayLaserScanMessage(channel, message, showFullData) {
  channel.appendLine("{");
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  channel.appendLine(`  "angle_min": ${message.angle_min},`);
  channel.appendLine(`  "angle_max": ${message.angle_max},`);
  channel.appendLine(`  "angle_increment": ${message.angle_increment},`);
  channel.appendLine(`  "time_increment": ${message.time_increment},`);
  channel.appendLine(`  "scan_time": ${message.scan_time},`);
  channel.appendLine(`  "range_min": ${message.range_min},`);
  channel.appendLine(`  "range_max": ${message.range_max},`);
  if (message.ranges) {
    const rangesStr = JSON.stringify(message.ranges);
    if (rangesStr.length > 50000) {
      channel.appendLine(`  "ranges": [`);
      const chunkSize = 50;
      for (let i = 0; i < message.ranges.length; i += chunkSize) {
        const chunk = message.ranges.slice(i, i + chunkSize);
        const chunkStr = chunk.map(v => v.toFixed(3)).join(", ");
        channel.appendLine(`    ${chunkStr}${i + chunkSize < message.ranges.length ? "," : ""}`);
      }
      channel.appendLine(`  ],`);
    } else {
      channel.appendLine(`  "ranges": ${rangesStr},`);
    }
  }
  if (message.intensities) {
    if (showFullData && message.intensities.length > 0) {
      channel.appendLine(`  "intensities": ${JSON.stringify(message.intensities)}`);
    } else {
      channel.appendLine(`  "intensities": [${message.intensities.length} values]`);
    }
  }
  channel.appendLine("}");
}

function displayPointCloudMessage(channel, message, showFullData) {
  channel.appendLine("{");
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  if (message.height !== undefined && message.width !== undefined) {
    channel.appendLine(`  "height": ${message.height},`);
    channel.appendLine(`  "width": ${message.width},`);
    channel.appendLine(`  "point_step": ${message.point_step},`);
    channel.appendLine(`  "row_step": ${message.row_step},`);
  }
  if (message.fields) {
    channel.appendLine(`  "fields": ${formatJson(message.fields, 2)},`);
  }
  if (message.data) {
    if (showFullData) {
      if (message.data.length > 1000) {
        channel.appendLine(`  "data": "[Binary data: ${message.data.length} bytes, base64: ${Buffer.from(message.data).toString('base64').substring(0, 100)}...]",`);
      } else {
        channel.appendLine(`  "data": ${JSON.stringify(Array.from(message.data))},`);
      }
    } else {
      channel.appendLine(`  "data": [${message.data.length} bytes]`);
    }
  }
  channel.appendLine("}");
}

function displayImageMessage(channel, message, showFullData) {
  channel.appendLine("{");
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  if (message.height !== undefined && message.width !== undefined) {
    channel.appendLine(`  "height": ${message.height},`);
    channel.appendLine(`  "width": ${message.width},`);
    channel.appendLine(`  "encoding": "${message.encoding}",`);
    channel.appendLine(`  "step": ${message.step},`);
  }
  if (message.data) {
    if (showFullData) {
      const dataPreview = Buffer.from(message.data.slice(0, 1000)).toString('base64');
      channel.appendLine(`  "data": "[Image data: ${message.data.length} bytes, preview: ${dataPreview.substring(0, 100)}...]",`);
    } else {
      channel.appendLine(`  "data": [${message.data.length} bytes]`);
    }
  }
  if (message.format) {
    channel.appendLine(`  "format": "${message.format}"`);
  }
  channel.appendLine("}");
}

function displayTFMessage(channel, message) {
  channel.appendLine("{");
  channel.appendLine(`  "transforms": [`);
  if (message.transforms) {
    message.transforms.forEach((tf, index) => {
      channel.appendLine(`    {`);
      channel.appendLine(`      "header": { "frame_id": "${tf.header.frame_id}", "stamp": ${JSON.stringify(tf.header.stamp)} },`);
      channel.appendLine(`      "child_frame_id": "${tf.child_frame_id}",`);
      channel.appendLine(`      "transform": {`);
      channel.appendLine(`        "translation": ${JSON.stringify(tf.transform.translation)},`);
      channel.appendLine(`        "rotation": ${JSON.stringify(tf.transform.rotation)}`);
      channel.appendLine(`      }`);
      channel.appendLine(`    }${index < message.transforms.length - 1 ? ',' : ''}`);
    });
  }
  channel.appendLine(`  ]`);
  channel.appendLine("}");
}

function displayBinaryMessage(channel, message, messageType, showFullData) {
  channel.appendLine("{");
  
  // Display header if present
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  
  // Display metadata fields
  const metadataFields = ['height', 'width', 'encoding', 'step', 'point_step', 
                         'row_step', 'is_bigendian', 'is_dense', 'format'];
  
  metadataFields.forEach(field => {
    if (message[field] !== undefined) {
      channel.appendLine(`  "${field}": ${JSON.stringify(message[field])},`);
    }
  });
  
  // Display fields array if present
  if (message.fields) {
    channel.appendLine(`  "fields": ${formatJson(message.fields, 2)},`);
  }
  
  // Display data
  if (message.data) {
    const dataLength = message.data.length || message.data.byteLength;
    
    if (showFullData && dataLength < 1000) {
      channel.appendLine(`  "data": ${JSON.stringify(Array.from(message.data))}`);
    } else {
      const preview = showFullData ? getDataPreview(message.data) : '';
      channel.appendLine(`  "data": "[${dataLength} bytes${preview}]"`);
    }
  }
  
  channel.appendLine("}");
}

function displayGeometricMessage(channel, message, messageType) {
  channel.appendLine("{");
  
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  
  // Handle transforms array
  if (message.transforms && Array.isArray(message.transforms)) {
    channel.appendLine(`  "transforms": [`);
    message.transforms.forEach((tf, index) => {
      channel.appendLine(`    ${formatTransform(tf, 4)}${index < message.transforms.length - 1 ? ',' : ''}`);
    });
    channel.appendLine(`  ]`);
  } else {
    // Handle single transform/pose
    const geometricFields = ['transform', 'pose', 'position', 'orientation', 
                           'translation', 'rotation', 'twist', 'accel'];
    
    const fields = Object.keys(message).filter(key => 
      geometricFields.includes(key) || message[key]?.x !== undefined
    );
    
    fields.forEach((field, index) => {
      const isLast = index === fields.length - 1 && !hasOtherFields(message, [...fields, 'header']);
      channel.appendLine(`  "${field}": ${formatJson(message[field], 2)}${isLast ? '' : ','}`);
    });
    
    // Add other fields
    displayOtherFields(channel, message, [...geometricFields, 'header', ...fields], 2);
  }
  
  channel.appendLine("}");
}

function displaySensorMessage(channel, message, messageType, showFullData) {
  channel.appendLine("{");
  
  if (message.header) {
    channel.appendLine(`  "header": ${formatJson(message.header, 2)},`);
  }
  
  // Display scan parameters
  const scanParams = ['angle_min', 'angle_max', 'angle_increment', 
                     'time_increment', 'scan_time', 'range_min', 'range_max'];
  
  scanParams.forEach(param => {
    if (message[param] !== undefined) {
      channel.appendLine(`  "${param}": ${message[param]},`);
    }
  });
  
  // Display ranges/intensities
  if (message.ranges) {
    displayArray(channel, "ranges", message.ranges, showFullData, 2);
  }
  
  if (message.intensities) {
    displayArray(channel, "intensities", message.intensities, showFullData && message.intensities.length > 0, 2);
  }
  
  // Display other sensor data fields
  displayOtherFields(channel, message, [...scanParams, 'header', 'ranges', 'intensities'], 2);
  
  channel.appendLine("}");
}

function displayStringMessage(channel, message, isStatic = false) {
  if (message.data.trim().startsWith('<') && 
      (message.data.includes('robot') || message.data.includes('xml'))) {
    channel.appendLine(`[XML/URDF Content - ${message.data.length} characters]`);
    channel.appendLine("---");
    channel.appendLine(message.data);
    channel.appendLine("---");
  } else if (message.data.includes('\n') && message.data.length > 100) {
    channel.appendLine(`[Multi-line text - ${message.data.length} characters]`);
    channel.appendLine("---");
    channel.appendLine(message.data);
    channel.appendLine("---");
  } else {
    channel.appendLine(`{ "data": ${JSON.stringify(message.data)} }`);
  }
}

function displayArrayMessage(channel, message, messageType, showFullData) {
  channel.appendLine("{");
  
  const keys = Object.keys(message);
  keys.forEach((key, index) => {
    const value = message[key];
    const isLast = index === keys.length - 1;
    
    if (Array.isArray(value)) {
      displayArray(channel, key, value, showFullData, 2);
      if (!isLast) channel.appendLine(",");
    } else if (typeof value === 'object' && value !== null) {
      channel.appendLine(`  "${key}": ${formatJson(value, 2)}${isLast ? '' : ','}`);
    } else {
      channel.appendLine(`  "${key}": ${JSON.stringify(value)}${isLast ? '' : ','}`);
    }
  });
  
  channel.appendLine("}");
}

function displayDefaultMessage(channel, message, maxDisplayLength, isStatic = false) {
  try {
    const msgStr = JSON.stringify(message, null, 2);
    
    // Keep full message for static topics
    if (!isStatic && msgStr.length > maxDisplayLength) {
      const truncated = msgStr.substring(0, maxDisplayLength);
      const lastNewline = truncated.lastIndexOf('\n');
      channel.appendLine(truncated.substring(0, lastNewline));
      channel.appendLine(`... [Message truncated - ${msgStr.length} total characters]`);
    } else {
      channel.appendLine(msgStr);
    }
  } catch (e) {
    // Handle circular references
    try {
      const seen = new WeakSet();
      const filtered = JSON.stringify(message, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      }, 2);
      channel.appendLine(filtered);
    } catch (e2) {
      channel.appendLine(`[Unable to display message: ${e2.message}]`);
    }
  }
}

// Helper functions
function formatJson(obj, indent) {
  return JSON.stringify(obj, null, 2).split('\n').join('\n' + ' '.repeat(indent));
}

function formatTransform(tf, indent) {
  const spaces = ' '.repeat(indent);
  return `{
${spaces}  "header": { "frame_id": "${tf.header?.frame_id}", "stamp": ${JSON.stringify(tf.header?.stamp)} },
${spaces}  "child_frame_id": "${tf.child_frame_id}",
${spaces}  "transform": ${formatJson(tf.transform, indent + 2)}
${spaces}}`;
}

function displayArray(channel, name, array, showFull, indent) {
  const spaces = ' '.repeat(indent);
  
  if (!showFull || array.length > 1000) {
    channel.appendLine(`${spaces}"${name}": [Array of ${array.length} elements]`);
  } else if (array.length > 100) {
    // Format large arrays nicely
    channel.appendLine(`${spaces}"${name}": [`);
    const chunkSize = 20;
    for (let i = 0; i < array.length; i += chunkSize) {
      const chunk = array.slice(i, i + chunkSize);
      const formatted = chunk.map(v => 
        typeof v === 'number' ? v.toFixed(3) : JSON.stringify(v)
      ).join(", ");
      channel.appendLine(`${spaces}  ${formatted}${i + chunkSize < array.length ? ',' : ''}`);
    }
    channel.appendLine(`${spaces}]`);
  } else {
    channel.appendLine(`${spaces}"${name}": ${JSON.stringify(array)}`);
  }
}

function displayOtherFields(channel, message, excludeFields, indent) {
  const spaces = ' '.repeat(indent);
  const otherKeys = Object.keys(message).filter(key => !excludeFields.includes(key));
  
  otherKeys.forEach((key, index) => {
    const isLast = index === otherKeys.length - 1;
    const value = message[key];
    
    if (value !== undefined && value !== null) {
      if (typeof value === 'object') {
        channel.appendLine(`${spaces}"${key}": ${formatJson(value, indent)}${isLast ? '' : ','}`);
      } else {
        channel.appendLine(`${spaces}"${key}": ${JSON.stringify(value)}${isLast ? '' : ','}`);
      }
    }
  });
}

function hasOtherFields(obj, excludeFields) {
  return Object.keys(obj).some(key => !excludeFields.includes(key));
}

function getDataPreview(data) {
  try {
    const preview = Buffer.from(data.slice(0, 50)).toString('base64');
    return `, preview: ${preview}...`;
  } catch {
    return '';
  }
}

module.exports = {
  displayMessageIntelligently
};