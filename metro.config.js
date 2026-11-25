// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared dev machine: keep Metro from claiming every core so other projects stay responsive.
config.maxWorkers = 2;

// The MCP server (mcp/) is a separate Node package with its own node_modules, and ios/ is a
// generated native project. Metro must not crawl or bundle either of them.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const underRoot = (dir) => new RegExp('^' + escapeRe(path.join(__dirname, dir)) + '[\\\\/].*');
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  underRoot('mcp'),
  underRoot('ios'),
];

module.exports = config;
