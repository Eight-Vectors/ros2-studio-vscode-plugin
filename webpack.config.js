const path = require('path');

module.exports = {
  target: 'node',
  mode: 'none',
  entry: './extension.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode',
    // Optional native dependencies for WebSocket performance
    bufferutil: 'commonjs bufferutil',
    'utf-8-validate': 'commonjs utf-8-validate',
    // Don't bundle these node modules
    'node:fs': 'commonjs fs',
    'node:path': 'commonjs path',
    'node:util': 'commonjs util',
    'node:stream': 'commonjs stream',
    'node:crypto': 'commonjs crypto',
    'node:events': 'commonjs events',
    'node:buffer': 'commonjs buffer',
    'node:url': 'commonjs url',
    'node:http': 'commonjs http',
    'node:https': 'commonjs https',
    'node:net': 'commonjs net',
    'node:tls': 'commonjs tls',
    'node:dns': 'commonjs dns',
    'node:zlib': 'commonjs zlib',
    'node:child_process': 'commonjs child_process',
    'node:os': 'commonjs os',
    'node:querystring': 'commonjs querystring',
    'node:assert': 'commonjs assert',
    'node:process': 'commonjs process',
  },
  resolve: {
    extensions: ['.js'],
    fallback: {
      // Provide empty modules for browser-specific dependencies
      'webworkify-webpack': false,
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
      },
    ],
  },
  performance: {
    hints: false,
  },
  optimization: {
    minimize: false,
  },
};