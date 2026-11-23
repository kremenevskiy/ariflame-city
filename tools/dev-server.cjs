#!/usr/bin/env node
/* Локальный сервер разработки: отдаёт client/ как статику и проксирует /g/* (HTTP и WebSocket /g/ws) на игровой сервер.
 *
 *   npm run dev                         → http://localhost:8080/  (игровой сервер ждём на http://127.0.0.1:8091)
 *   PORT=3000 GAME=http://127.0.0.1:9000 npm run dev
 *
 * Без зависимостей: только node:http. Игровой сервер не запущен — /g/* отвечает 502, игра работает одна (онлайн молчит).
 * Для выкладки не годится: там — любой веб-сервер + обратный прокси (docs/DEPLOY.md).
 */
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "client");
const PORT = +(process.env.PORT || 8080);
const GAME = new URL(process.env.GAME || "http://127.0.0.1:8091");
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function proxy(req, res) {
  const opt = { host: GAME.hostname, port: GAME.port || 80, method: req.method, path: req.url,
    headers: { ...req.headers, host: GAME.host } };
  const up = http.request(opt, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end("игровой сервер не запущен"); });
  req.pipe(up);
}

function serve(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p.endsWith("/")) p += "index.html";
  const file = path.resolve(ROOT, "." + p);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    // папка без «/» на конце — как на боевом сервере: переадресация на «папка/» (короткие адреса вроде /minsk)
    if (!err && st.isDirectory()) { const u = new URL(req.url, "http://x"); res.writeHead(301, { location: u.pathname + "/" + u.search }); res.end(); return; }
    if (err || !st.isFile()) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("нет файла"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": st.size, "cache-control": "no-cache" });
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/g/")) proxy(req, res);
  else serve(req, res);
});

// WebSocket /g/ws — пробрасываем «как есть» сырым TCP после рукопожатия
server.on("upgrade", (req, sock, head) => {
  if (!req.url.startsWith("/g/")) { sock.destroy(); return; }
  const up = net.connect(+(GAME.port || 80), GAME.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      lines.push(`${k}: ${k.toLowerCase() === "host" ? GAME.host : req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    sock.pipe(up); up.pipe(sock);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`Флейм-Сити: http://localhost:${PORT}/  (Минск: http://localhost:${PORT}/?city=minsk)`);
  console.log(`/g/* → ${GAME.origin} (игровой сервер: npm test — тесты, запуск — server/README.md)`);
});
