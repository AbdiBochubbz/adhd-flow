/**
 * Account server for Still.
 * Email is the account name. A login proof (not the email alone, and not the raw password)
 * is required. The server stores a hash of that proof, a wrapped sync key, and ciphertext.
 * It cannot read tasks.
 *
 *   node server/account.mjs
 *   STILL_ACCOUNT_PORT=47323 node server/account.mjs
 *
 * Nothing is deployed by the app. Until this process is reachable at a URL you type
 * into Still, sync does not run.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const MAX_BODY = 1_500_000;

export function hashProof(loginProof) {
  const raw = Buffer.from(String(loginProof || ""), "base64");
  if (raw.length !== 32) return null;
  return createHash("sha256").update(raw).digest();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function sameHash(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAccountServer({ port = 0, host = "127.0.0.1" } = {}) {
  const users = new Map();
  const sessions = new Map();
  const attempts = new Map();

  function tooMany(email) {
    const now = Date.now();
    const recent = (attempts.get(email) || []).filter((at) => now - at < 10 * 60 * 1000);
    recent.push(now);
    attempts.set(email, recent);
    return recent.length > 40;
  }

  function userView(user) {
    return {
      wrapSalt: user.wrapSalt,
      wrappedSyncKey: user.wrappedSyncKey,
      revision: user.revision,
      blob: user.blob,
    };
  }

  function bearer(req) {
    const header = req.headers.authorization || "";
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(header);
    if (!match) return null;
    const tokenHash = createHash("sha256").update(match[1]).digest("hex");
    const email = sessions.get(tokenHash);
    if (!email) return null;
    const user = users.get(email);
    if (!user) return null;
    return { email, user, tokenHash };
  }

  function issue(email) {
    const token = randomBytes(32).toString("base64url");
    sessions.set(createHash("sha256").update(token).digest("hex"), email);
    return token;
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error("too large");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      const error = new Error("bad json");
      error.status = 400;
      throw error;
    }
  }

  function send(res, status, body) {
    const payload = body == null ? "" : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    });
    res.end(payload);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "OPTIONS") {
        send(res, 204, null);
        return;
      }
      if (req.method === "POST" && (url.pathname === "/v1/register" || url.pathname === "/v1/login")) {
        const body = await readBody(req);
        const email = normalizeEmail(body.email);
        const loginHash = hashProof(body.loginProof);
        if (!email || !loginHash) {
          send(res, 400, { error: "Email and login proof are required." });
          return;
        }
        if (tooMany(email)) {
          send(res, 429, { error: "Too many attempts. Wait and try again." });
          return;
        }
        if (url.pathname === "/v1/register") {
          if (users.has(email)) {
            send(res, 409, { error: "That email already has an account." });
            return;
          }
          const user = {
            loginHash,
            wrapSalt: randomBytes(16).toString("base64"),
            wrappedSyncKey: null,
            revision: 0,
            blob: null,
          };
          users.set(email, user);
          send(res, 201, { token: issue(email), ...userView(user) });
          return;
        }
        const user = users.get(email);
        if (!user || !sameHash(user.loginHash, loginHash)) {
          send(res, 401, { error: "Email or password is wrong." });
          return;
        }
        send(res, 200, { token: issue(email), ...userView(user) });
        return;
      }
      const auth = bearer(req);
      if (!auth) {
        send(res, 401, { error: "Sign in is required." });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/logout") {
        sessions.delete(auth.tokenHash);
        send(res, 204, null);
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/vault") {
        send(res, 200, userView(auth.user));
        return;
      }
      if (req.method === "PUT" && url.pathname === "/v1/vault") {
        const body = await readBody(req);
        if (!body.blob || typeof body.blob.iv !== "string" || typeof body.blob.ct !== "string") {
          send(res, 400, { error: "A ciphertext blob is required. An empty body cannot replace the list." });
          return;
        }
        if (body.blob.iv.length > 100 || body.blob.ct.length > MAX_BODY) {
          send(res, 413, { error: "That list is too large." });
          return;
        }
        if (Number(body.baseRevision) !== auth.user.revision) {
          send(res, 409, { error: "The account list changed.", ...userView(auth.user) });
          return;
        }
        auth.user.blob = { iv: body.blob.iv, ct: body.blob.ct };
        auth.user.revision += 1;
        if (!auth.user.wrappedSyncKey && body.wrappedSyncKey && typeof body.wrappedSyncKey.iv === "string" && typeof body.wrappedSyncKey.ct === "string") {
          auth.user.wrappedSyncKey = { iv: body.wrappedSyncKey.iv, ct: body.wrappedSyncKey.ct };
        }
        send(res, 200, { revision: auth.user.revision });
        return;
      }
      send(res, 404, { error: "Not found." });
    } catch (error) {
      send(res, error.status || 500, { error: "The account server could not finish that." });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.STILL_ACCOUNT_PORT || 47323);
  const host = process.env.STILL_ACCOUNT_HOST || "127.0.0.1";
  const running = await createAccountServer({ port, host });
  console.log(`Still account server listening on ${running.url}`);
}
