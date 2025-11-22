#!/usr/bin/env node

/**
 * Simple static file server for the order execution frontend
 * Serves public/index.html on port 3001 (or PORT env var)
 * No external dependencies
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.FRONTEND_PORT || '3001', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  // Enable CORS for WebSocket upgrade
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route to index.html for root
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Serve the file
    const contentType = filePath.endsWith('.html') ? 'text/html' : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Frontend server listening on http://localhost:${PORT}\n`);
  console.log(`📂 Serving files from: ${PUBLIC_DIR}\n`);
  console.log('🌐 Open http://localhost:3001 in your browser\n');
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
