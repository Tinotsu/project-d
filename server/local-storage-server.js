import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";

const port = 8787;
const storageDirectory = resolve(".local-data");
const musicDirectory = resolve(storageDirectory, "music");
mkdirSync(musicDirectory, { recursive: true });

const database = new DatabaseSync(resolve(storageDirectory, "project-d.sqlite"));
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS levels (
    id TEXT PRIMARY KEY,
    level_json TEXT NOT NULL,
    audio_file TEXT,
    audio_type TEXT,
    updated_at INTEGER NOT NULL
  );
`);

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) writeText(response, 500, "Level storage failed");
    else response.destroy();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local SQLite storage: http://127.0.0.1:${port}`);
  console.log(`Database: ${resolve(storageDirectory, "project-d.sqlite")}`);
  console.log(`Music objects: ${musicDirectory}`);
});

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  if (url.pathname === "/api/levels" && request.method === "GET") {
    listLevels(response);
    return;
  }

  const match = url.pathname.match(/^\/api\/levels\/([^/]+)(\/audio)?$/);
  if (!match) {
    writeText(response, 404, "Not found");
    return;
  }

  const id = decodeURIComponent(match[1]);
  if (match[2] === "/audio") {
    if (request.method === "GET" || request.method === "HEAD") {
      loadLevelAudio(request, response, id);
      return;
    }
    if (request.method === "PUT") {
      await storeLevelAudio(request, response, id);
      return;
    }
  } else if (request.method === "PUT") {
    await storeLevel(request, response, id);
    return;
  } else if (request.method === "DELETE") {
    deleteLevel(response, id);
    return;
  }

  writeText(response, 405, "Method not allowed");
}

function listLevels(response) {
  const rows = database.prepare("SELECT id, level_json, audio_file, updated_at FROM levels ORDER BY updated_at DESC").all();
  const levels = rows.map((row) => {
    const level = JSON.parse(row.level_json);
    if (row.audio_file) level.song.audio = `/api/levels/${encodeURIComponent(row.id)}/audio`;
    return { level, updatedAt: row.updated_at };
  });
  writeJson(response, 200, levels);
}

async function storeLevel(request, response, id) {
  const level = JSON.parse((await readRequestBody(request, 2_000_000)).toString("utf8"));
  if (!level.song || level.song.id !== id) {
    writeText(response, 400, "Level ID does not match request path");
    return;
  }

  database.prepare(`
    INSERT INTO levels (id, level_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET level_json = excluded.level_json, updated_at = excluded.updated_at
  `).run(id, JSON.stringify(level), Date.now());
  response.writeHead(204).end();
}

async function storeLevelAudio(request, response, id) {
  const level = database.prepare("SELECT audio_file FROM levels WHERE id = ?").get(id);
  if (!level) {
    writeText(response, 404, "Level not found");
    return;
  }

  const objectName = randomUUID();
  const temporaryPath = resolve(musicDirectory, `.${objectName}.upload`);
  const objectPath = resolve(musicDirectory, objectName);
  try {
    await pipeline(request, createWriteStream(temporaryPath, { flags: "wx" }));
    renameSync(temporaryPath, objectPath);
    database.prepare("UPDATE levels SET audio_file = ?, audio_type = ?, updated_at = ? WHERE id = ?")
      .run(objectName, request.headers["content-type"] ?? "application/octet-stream", Date.now(), id);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    rmSync(objectPath, { force: true });
    throw error;
  }

  if (level.audio_file) rmSync(resolve(musicDirectory, level.audio_file), { force: true });
  response.writeHead(204).end();
}

function deleteLevel(response, id) {
  const level = database.prepare("SELECT audio_file FROM levels WHERE id = ?").get(id);
  if (!level) {
    writeText(response, 404, "Level not found");
    return;
  }

  database.prepare("DELETE FROM levels WHERE id = ?").run(id);
  if (level.audio_file) rmSync(resolve(musicDirectory, level.audio_file), { force: true });
  response.writeHead(204).end();
}

function loadLevelAudio(request, response, id) {
  const level = database.prepare("SELECT audio_file, audio_type FROM levels WHERE id = ?").get(id);
  if (!level?.audio_file) {
    writeText(response, 404, "Audio not found");
    return;
  }

  const objectPath = resolve(musicDirectory, level.audio_file);
  const length = statSync(objectPath).size;
  const range = request.headers.range;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": level.audio_type ?? "application/octet-stream",
  };

  if (!range) {
    response.writeHead(200, { ...headers, "Content-Length": length });
    if (request.method === "HEAD") response.end();
    else createReadStream(objectPath).pipe(response);
    return;
  }

  const bounds = parseRange(range, length);
  if (!bounds) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${length}` }).end();
    return;
  }

  response.writeHead(206, {
    ...headers,
    "Content-Length": bounds.end - bounds.start + 1,
    "Content-Range": `bytes ${bounds.start}-${bounds.end}/${length}`,
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(objectPath, bounds).pipe(response);
}

function parseRange(value, length) {
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;

  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[2] && match[1] ? Number(match[2]) : length - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= length) return undefined;
  return { start, end: Math.min(end, length - 1) };
}

function readRequestBody(request, maximumBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let byteLength = 0;
    request.on("data", (chunk) => {
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        rejectBody(new Error("Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Length": Buffer.byteLength(body), "Content-Type": "application/json" }).end(body);
}

function writeText(response, status, body) {
  response.writeHead(status, { "Content-Length": Buffer.byteLength(body), "Content-Type": "text/plain; charset=utf-8" }).end(body);
}

function shutDown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
