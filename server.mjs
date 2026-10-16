import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 4174);
const HOST = "127.0.0.1";
const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), "data", "templates.json");
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

function send(response, status, data, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin && ALLOWED_ORIGINS.has(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          Vary: "Origin",
        }
      : {}),
  });
  response.end(status === 204 ? undefined : JSON.stringify(data));
}

async function readTemplates() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Template store must contain a JSON array.");
    return value;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    send(response, 204, {}, origin);
    return;
  }

  try {
    if (request.url === "/api/health" && request.method === "GET") {
      send(response, 200, { status: "ok", storage: "local" }, origin);
      return;
    }

    if (request.url === "/api/templates" && request.method === "GET") {
      send(response, 200, await readTemplates(), origin);
      return;
    }

    if (request.url === "/api/templates" && request.method === "PUT") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 5_000_000) {
          send(response, 413, { error: "Template data exceeds the 5 MB limit." }, origin);
          return;
        }
      }
      const templates = JSON.parse(body);
      if (!Array.isArray(templates)) {
        send(response, 400, { error: "Template data must be an array." }, origin);
        return;
      }
      await mkdir(dirname(DATA_FILE), { recursive: true });
      const temporaryFile = `${DATA_FILE}.tmp`;
      await writeFile(temporaryFile, JSON.stringify(templates, null, 2), "utf8");
      await rename(temporaryFile, DATA_FILE);
      send(response, 200, { saved: templates.length }, origin);
      return;
    }

    send(response, 404, { error: "Route not found." }, origin);
  } catch (error) {
    console.error("Local API request failed:", error);
    send(response, 500, { error: "The local document store could not complete the request." }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local template vault listening at http://${HOST}:${PORT}`);
});
