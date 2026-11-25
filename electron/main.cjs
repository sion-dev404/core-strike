// 코어 스트라이크 설치형: 게임 파일(dist)을 이 PC 안의 작은 서버로 띄워 창에 연다
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.normalize(path.join(ROOT, p));
      if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let win = null;
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const port = await startServer();
    win = new BrowserWindow({
      width: 1600, height: 900, minWidth: 960, minHeight: 540, title: '코어 스트라이크',
      backgroundColor: '#0f141b', autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.setMenu(null);
    win.maximize();
    win.loadURL(`http://127.0.0.1:${port}/`);
    // F11: 전체 화면
    win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  });
  app.on('window-all-closed', () => app.quit());
}
