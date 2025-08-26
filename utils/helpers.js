function logOutputChannel(ch, level, value) {
  switch (level) {
    case "error":
      ch.appendLine(
        `\u001b[31m${new Date().toLocaleTimeString()} - ERROR: ${value}\u001b[31m`
      );
      break;
    case "info":
      ch.appendLine(
        `\u001b[33m${new Date().toLocaleTimeString()} - INFO: ${value}\u001b[33m`
      );
      break;
    case "success":
      ch.appendLine(
        `\u001b[32m${new Date().toLocaleTimeString()} - SUCCESS: ${value}\u001b[32m`
      );
      break;
    default:
      ch.appendLine(
        `${new Date().toLocaleTimeString()} - ${level.toUpperCase()}: ${value}`
      );
      break;
  }
  ch.show();
}

function validateAndFormatEndpoint(url, port, protocol) {
  const protocolRegex = /^(https?)/;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;

  function isValidUrl(input) {
    try {
      if (protocolRegex.test(input)) {
        new URL(input);
        return true;
      }
      new URL("http://" + input);
      return true;
    } catch {
      return false;
    }
  }

  function sanitize(input) {
    if (ipRegex.test(input)) {
      return input;
    }

    if (!protocol && protocolRegex.test(input)) {
      protocol = protocolRegex.exec(input)[0];
    }


    try {
      const parsedUrl = new URL(input);
      return parsedUrl.hostname;
    } catch {
      return null;
    }
  }

  if (!isValidUrl(url)) {
    return [null, "Invalid URL provided"];
  }

  const sanitizedUrl = sanitize(url);
  if (!sanitizedUrl) {
    return [null, "Failed to sanitize the URL"];
  }

  switch (protocol) {
    case "tcp":
      return [`tcp/${sanitizedUrl}:${port}`, null];
    case "http":
    case "https":
      return [`${protocol + "://"}${sanitizedUrl}:${port}`, null];
    case "websocket":
      return [`ws://${sanitizedUrl}:${port}`, null];
    default:
      return [
        null,
        "Invalid format provided. Use 'tcp', 'http', 'https', or 'websocket'.",
      ];
  }
}

function ensurePort(address, defaultPort = 8000) {
  const addressWithPortPattern = /:(\d+)$/;
  if (addressWithPortPattern.test(address)) {
    return address;
  } else {
    return `${address}:${defaultPort}`;
  }
}

function flattenArrayofObjects(array) {
  return array.reduce((acc, curr) => {
    return { ...acc, ...curr };
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

const extensionHandle = "ros2-studio";

module.exports = {
  validateAndFormatEndpoint,
  ensurePort,
  generateTimestamp,
  flattenArrayofObjects,
  logOutputChannel,
  extensionHandle,
};
