import type { Auth } from "./auth.ts";
import { LevelInputError, readLevelDocument, type LevelDocument } from "./level-validation.ts";

type Visibility = "private" | "public";

type LevelRow = {
  id: string;
  owner_user_id: string;
  level_json: string;
  audio_key: string | null;
  audio_type: string | null;
  updated_at: number;
  visibility: Visibility;
};

type PublicLevelRow = {
  id: string;
  title: string;
  difficulty: string;
  note_count: number;
  updated_at: number;
  owner_name: string;
};

const maximumLevelBytes = 2_000_000;
const maximumAudioBytes = 30 * 1024 * 1024;
const levelIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export async function handleLevelRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  auth: Auth,
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (url.pathname === "/api/levels") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const userId = await authenticatedUserId(request, auth);
    if (!userId) return jsonError(401, "Authentication required");
    return listOwnedLevels(env, userId);
  }

  if (url.pathname === "/api/public-levels") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return searchPublicLevels(env, url);
  }

  const ownedMatch = url.pathname.match(/^\/api\/levels\/([^/]+)(\/audio|\/visibility)?$/);
  if (ownedMatch) {
    const id = readLevelId(ownedMatch[1]);
    if (!id) return jsonError(400, "Invalid level ID");
    const userId = await authenticatedUserId(request, auth);
    if (!userId) return jsonError(401, "Authentication required");

    if (ownedMatch[2] === "/audio") {
      if (request.method === "GET" || request.method === "HEAD") return loadOwnedAudio(request, env, id, userId);
      if (request.method === "PUT") {
        const originError = mutationOriginError(request);
        if (originError) return originError;
        return storeAudio(request, env, ctx, id, userId);
      }
      return methodNotAllowed("GET, HEAD, PUT");
    }

    if (ownedMatch[2] === "/visibility") {
      if (request.method !== "PUT") return methodNotAllowed("PUT");
      const originError = mutationOriginError(request);
      if (originError) return originError;
      return changeVisibility(request, env, id, userId);
    }

    if (request.method === "PUT") {
      const originError = mutationOriginError(request);
      if (originError) return originError;
      return storeLevel(request, env, id, userId);
    }
    if (request.method === "DELETE") {
      const originError = mutationOriginError(request);
      if (originError) return originError;
      return deleteLevel(env, ctx, id, userId);
    }
    return methodNotAllowed("PUT, DELETE");
  }

  const publicMatch = url.pathname.match(/^\/api\/public-levels\/([^/]+)(\/audio)?$/);
  if (publicMatch) {
    const id = readLevelId(publicMatch[1]);
    if (!id) return jsonError(400, "Invalid level ID");
    if (publicMatch[2] === "/audio") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
      return loadPublicAudio(request, env, id);
    }
    if (request.method !== "GET") return methodNotAllowed("GET");
    return loadPublicLevel(env, id);
  }

  return undefined;
}

async function authenticatedUserId(request: Request, auth: Auth): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id;
}

async function listOwnedLevels(env: Env, userId: string): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT id, owner_user_id, level_json, audio_key, audio_type, updated_at, visibility
    FROM levels
    WHERE owner_user_id = ?
    ORDER BY updated_at DESC
  `).bind(userId).all<LevelRow>();

  const levels = result.results.map((row) => ({
    level: levelFromRow(row, `/api/levels/${encodeURIComponent(row.id)}/audio`),
    updatedAt: row.updated_at,
    visibility: row.visibility,
  }));
  return json(levels, { headers: { "Cache-Control": "private, no-store" } });
}

async function searchPublicLevels(env: Env, url: URL): Promise<Response> {
  const query = url.searchParams.get("q") ?? "";
  const difficulty = url.searchParams.get("difficulty") ?? "";
  if (query.length > 100) return jsonError(400, "Search query is too long");
  if (difficulty.length > 40) return jsonError(400, "Difficulty is too long");

  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const result = difficulty
    ? await env.DB.prepare(`
        SELECT levels.id, levels.title, levels.difficulty, levels.note_count, levels.updated_at, "user".name AS owner_name
        FROM levels
        INNER JOIN "user" ON "user".id = levels.owner_user_id
        WHERE levels.visibility = 'public'
          AND LOWER(levels.title) LIKE LOWER(?) ESCAPE '\\'
          AND LOWER(levels.difficulty) = LOWER(?)
        ORDER BY levels.published_at DESC, levels.updated_at DESC
        LIMIT 50
      `).bind(pattern, difficulty).all<PublicLevelRow>()
    : await env.DB.prepare(`
        SELECT levels.id, levels.title, levels.difficulty, levels.note_count, levels.updated_at, "user".name AS owner_name
        FROM levels
        INNER JOIN "user" ON "user".id = levels.owner_user_id
        WHERE levels.visibility = 'public'
          AND LOWER(levels.title) LIKE LOWER(?) ESCAPE '\\'
        ORDER BY levels.published_at DESC, levels.updated_at DESC
        LIMIT 50
      `).bind(pattern).all<PublicLevelRow>();

  return json(result.results.map((row) => ({
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    noteCount: row.note_count,
    updatedAt: row.updated_at,
    ownerName: row.owner_name,
  })), { headers: { "Cache-Control": "public, max-age=30" } });
}

async function loadPublicLevel(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT id, owner_user_id, level_json, audio_key, audio_type, updated_at, visibility
    FROM levels
    WHERE id = ? AND visibility = 'public'
  `).bind(id).first<LevelRow>();
  if (!row) return jsonError(404, "Level not found");
  return json(levelFromRow(row, `/api/public-levels/${encodeURIComponent(id)}/audio`), {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}

async function storeLevel(request: Request, env: Env, id: string, userId: string): Promise<Response> {
  if (!isJsonRequest(request)) return jsonError(415, "Content-Type must be application/json");
  const body = await readBoundedJson(request, maximumLevelBytes);
  if (body instanceof Response) return body;

  let level: LevelDocument;
  try {
    level = readLevelDocument(body, id);
  } catch (error) {
    if (error instanceof LevelInputError) return jsonError(400, error.message);
    throw error;
  }

  const existing = await env.DB.prepare("SELECT owner_user_id FROM levels WHERE id = ?").bind(id).first<{ owner_user_id: string }>();
  if (existing && existing.owner_user_id !== userId) return jsonError(403, "You do not own this level");

  const now = Date.now();
  const storedJson = JSON.stringify(level);
  const noteCount = level.chart.notes.filter((note) => note.type !== "STAY").length;
  if (existing) {
    await env.DB.prepare(`
      UPDATE levels
      SET title = ?, difficulty = ?, note_count = ?, level_json = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).bind(level.song.title, level.chart.level.difficulty, noteCount, storedJson, now, id, userId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO levels (
        id, owner_user_id, title, difficulty, note_count, visibility,
        level_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'private', ?, ?, ?)
    `).bind(id, userId, level.song.title, level.chart.level.difficulty, noteCount, storedJson, now, now).run();
  }
  return new Response(null, { status: 204 });
}

async function changeVisibility(request: Request, env: Env, id: string, userId: string): Promise<Response> {
  if (!isJsonRequest(request)) return jsonError(415, "Content-Type must be application/json");
  const body = await readBoundedJson(request, 1_000);
  if (body instanceof Response) return body;
  if (!isRecord(body) || (body.visibility !== "private" && body.visibility !== "public")) {
    return jsonError(400, "Visibility must be private or public");
  }

  const visibility = body.visibility;
  const result = await env.DB.prepare(`
    UPDATE levels
    SET visibility = ?, published_at = CASE WHEN ? = 'public' THEN ? ELSE NULL END, updated_at = ?
    WHERE id = ? AND owner_user_id = ?
  `).bind(visibility, visibility, Date.now(), Date.now(), id, userId).run();
  if (result.meta.changes === 0) return jsonError(404, "Level not found");
  return new Response(null, { status: 204 });
}

async function storeAudio(request: Request, env: Env, ctx: ExecutionContext, id: string, userId: string): Promise<Response> {
  const level = await env.DB.prepare("SELECT owner_user_id, audio_key FROM levels WHERE id = ?")
    .bind(id).first<{ owner_user_id: string; audio_key: string | null }>();
  if (!level) return jsonError(404, "Level not found");
  if (level.owner_user_id !== userId) return jsonError(403, "You do not own this level");
  if (!request.body) return jsonError(400, "Audio body is required");

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("audio/") || contentType.length > 100) {
    return jsonError(415, "An audio Content-Type is required");
  }
  const declaredLength = request.headers.get("Content-Length");
  if (!declaredLength) return jsonError(411, "Content-Length is required for audio uploads");
  const bytes = Number(declaredLength);
  if (!Number.isSafeInteger(bytes) || bytes < 1) return jsonError(400, "Invalid Content-Length");
  if (bytes > maximumAudioBytes) return jsonError(413, "Audio must be 30 MiB or smaller");

  const objectKey = `levels/${userId}/${id}/${crypto.randomUUID()}`;
  await env.LEVEL_AUDIO.put(objectKey, request.body, {
    httpMetadata: { contentType },
  });

  try {
    const result = await env.DB.prepare(`
      UPDATE levels SET audio_key = ?, audio_type = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).bind(objectKey, contentType, Date.now(), id, userId).run();
    if (result.meta.changes === 0) {
      await env.LEVEL_AUDIO.delete(objectKey);
      return jsonError(404, "Level not found");
    }
  } catch (error) {
    await env.LEVEL_AUDIO.delete(objectKey);
    throw error;
  }

  if (level.audio_key) {
    ctx.waitUntil(env.LEVEL_AUDIO.delete(level.audio_key).catch((error: unknown) => {
      console.error(JSON.stringify({
        message: "old level audio cleanup failed",
        levelId: id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
  }
  return new Response(null, { status: 204 });
}

async function deleteLevel(env: Env, ctx: ExecutionContext, id: string, userId: string): Promise<Response> {
  const level = await env.DB.prepare("SELECT owner_user_id, audio_key FROM levels WHERE id = ?")
    .bind(id).first<{ owner_user_id: string; audio_key: string | null }>();
  if (!level) return jsonError(404, "Level not found");
  if (level.owner_user_id !== userId) return jsonError(403, "You do not own this level");

  await env.DB.prepare("DELETE FROM levels WHERE id = ? AND owner_user_id = ?").bind(id, userId).run();
  if (level.audio_key) {
    ctx.waitUntil(env.LEVEL_AUDIO.delete(level.audio_key).catch((error: unknown) => {
      console.error(JSON.stringify({
        message: "deleted level audio cleanup failed",
        levelId: id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }));
  }
  return new Response(null, { status: 204 });
}

async function loadOwnedAudio(request: Request, env: Env, id: string, userId: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT audio_key FROM levels WHERE id = ? AND owner_user_id = ?")
    .bind(id, userId).first<{ audio_key: string | null }>();
  if (!row?.audio_key) return jsonError(404, "Audio not found");
  return loadAudioObject(request, env.LEVEL_AUDIO, row.audio_key);
}

async function loadPublicAudio(request: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare("SELECT audio_key FROM levels WHERE id = ? AND visibility = 'public'")
    .bind(id).first<{ audio_key: string | null }>();
  if (!row?.audio_key) return jsonError(404, "Audio not found");
  return loadAudioObject(request, env.LEVEL_AUDIO, row.audio_key);
}

async function loadAudioObject(request: Request, bucket: R2Bucket, key: string): Promise<Response> {
  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return jsonError(404, "Audio not found");
    const headers = audioHeaders(object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = request.headers.get("Range");
  if (!rangeHeader) {
    const object = await bucket.get(key);
    if (!object) return jsonError(404, "Audio not found");
    const headers = audioHeaders(object);
    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }

  const metadata = await bucket.head(key);
  if (!metadata) return jsonError(404, "Audio not found");
  const range = parseRange(rangeHeader, metadata.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${metadata.size}` },
    });
  }
  const object = await bucket.get(key, { range });
  if (!object) return jsonError(404, "Audio not found");
  const headers = audioHeaders(object);
  headers.set("Content-Length", String(range.length));
  headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  return new Response(object.body, { status: 206, headers });
}

function audioHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store");
  headers.set("ETag", object.httpEtag);
  return headers;
}

function parseRange(value: string, size: number): { offset: number; length: number } | undefined {
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return undefined;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

function levelFromRow(row: LevelRow, audioPath: string): LevelDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.level_json);
  } catch {
    throw new Error(`Stored level ${row.id} contains invalid JSON`);
  }
  const level = readLevelDocument(parsed, row.id);
  level.song.audio = row.audio_key ? audioPath : "";
  return level;
}

async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown | Response> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return jsonError(400, "Invalid Content-Length");
    if (bytes > maximumBytes) return jsonError(413, "Request body is too large");
  }
  const data = await request.arrayBuffer();
  if (data.byteLength > maximumBytes) return jsonError(413, "Request body is too large");
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    return jsonError(400, "Request body must contain valid JSON");
  }
}

function mutationOriginError(request: Request): Response | undefined {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) return jsonError(403, "Request origin is not allowed");
  return undefined;
}

function readLevelId(encodedId: string): string | undefined {
  try {
    const id = decodeURIComponent(encodedId);
    return levelIdPattern.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json") === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function methodNotAllowed(allow: string): Response {
  return jsonError(405, "Method not allowed", { Allow: allow });
}

function jsonError(status: number, error: string, headers?: HeadersInit): Response {
  return json({ error }, { status, headers });
}

function json(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}
