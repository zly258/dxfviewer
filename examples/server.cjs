const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const DXF_DIR = path.join(__dirname, 'dxf');

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.url === '/api/files') {
    fs.readdir(DXF_DIR, (err, files) => {
      if (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      const dxfFiles = files.filter(f => f.toLowerCase().endsWith('.dxf'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(dxfFiles));
    });
    return;
  }

  if (req.url.startsWith('/dxf/')) {
    const fileName = decodeURIComponent(req.url.substring(5));
    const filePath = path.join(DXF_DIR, fileName);
    
    // Safety check to prevent directory traversal
    if (!filePath.startsWith(DXF_DIR)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`DXF Server running at http://localhost:${PORT}`);
  console.log(`DXF directory: ${DXF_DIR}`);
});
