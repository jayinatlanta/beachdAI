// webpack.config.js

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  // Use 'development' for easier debugging, change to 'production' for release
  mode: 'development',
  // Disables eval() for CSP compliance in Chrome extensions
  devtool: 'cheap-module-source-map',

  // Define the entry points for our extension's scripts
  entry: {
    background: path.resolve(__dirname, 'src', 'background.ts'),
    content: path.resolve(__dirname, 'src', 'content.ts'),
    sidebar: path.resolve(__dirname, 'src', 'sidebar', 'index.tsx'),
    options: path.resolve(__dirname, 'src', 'options', 'index.tsx'),
  },

  // Define where the compiled files will be placed
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js', // [name] will be replaced by the entry point key
    // This is the critical fix for Edge on Android.
    // It tells webpack how to name dynamically imported chunks
    // without the leading underscore that Edge blocks.
    chunkFilename: 'chunks/[name].[id].chunk.js',
    clean: true, // Clean the dist folder before each build
  },

  // Define how to handle different file types
  module: {
    rules: [
      {
        // Use ts-loader for all .ts and .tsx files
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },

  // Define how to resolve module imports
  resolve: {
    // Automatically resolve these file extensions
    extensions: ['.tsx', '.ts', '.js'],
  },

  // Use plugins to copy static files to the output directory
  plugins: [
    new CopyPlugin({
      patterns: [
        // Copy all files from the 'public' directory to the root of 'dist'
        { from: 'public', to: '.' },
      ],
    }),
  ],
};

