import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number.parseInt(process.env.AUTH_FIXTURE_PORT ?? "54321", 10);
const origin = `http://127.0.0.1:${port}`;
const issuer = `${origin}/auth/v1`;
const keyId = "roavia-browser-smoke";
const users = new Map();
const refreshTokens = new Map();
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "ES256",
  kid: keyId,
  key_ops: ["verify"],
  use: "sig",
};

function json(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function accessToken(user, expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = encoded({
    aal: "aal1",
    amr: [{ method: "password", timestamp: now }],
    aud: "authenticated",
    email: user.email,
    exp: now + expiresIn,
    iat: now,
    is_anonymous: false,
    iss: issuer,
    role: "authenticated",
    session_id: user.sessionId,
    sub: user.id,
  });
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign({ dsaEncoding: "ieee-p1363", key: privateKey });
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

function publicUser(user) {
  return {
    app_metadata: { provider: "email", providers: ["email"] },
    aud: "authenticated",
    confirmed_at: user.createdAt,
    created_at: user.createdAt,
    email: user.email,
    email_confirmed_at: user.createdAt,
    id: user.id,
    identities: [],
    is_anonymous: false,
    role: "authenticated",
    updated_at: user.createdAt,
    user_metadata: {},
  };
}

function session(user, expiresIn) {
  const refreshToken = randomUUID();
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken(user, expiresIn),
    expires_in: expiresIn,
    refresh_token: refreshToken,
    token_type: "bearer",
    user: publicUser(user),
  };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function userById(id) {
  return [...users.values()].find((user) => user.id === id);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", origin);

  if (request.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") {
    log("jwks");
    return json(response, 200, { keys: [publicJwk] });
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/signup") {
    const body = await requestBody(request);
    const email = String(body.email ?? "").toLowerCase();

    if (!email || typeof body.password !== "string") {
      return json(response, 400, { code: "validation_failed", msg: "Invalid credentials" });
    }

    if (users.has(email)) {
      return json(response, 400, { code: "user_already_exists", msg: "User already exists" });
    }

    const now = new Date().toISOString();
    const user = {
      createdAt: now,
      email,
      id: randomUUID(),
      password: body.password,
      sessionId: randomUUID(),
    };
    users.set(email, user);
    log("signup", { email });
    return json(response, 200, session(user, 3_600));
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "password"
  ) {
    const body = await requestBody(request);
    const email = String(body.email ?? "").toLowerCase();
    const user = users.get(email);

    if (!user || user.password !== body.password) {
      return json(response, 400, { code: "invalid_credentials", msg: "Invalid credentials" });
    }

    user.sessionId = randomUUID();
    log("sign-in", { email });
    return json(response, 200, session(user, 100));
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "refresh_token"
  ) {
    const body = await requestBody(request);
    const refreshToken = String(body.refresh_token ?? "");
    const userId = refreshTokens.get(refreshToken);
    const user = userId ? userById(userId) : undefined;

    if (!user) {
      return json(response, 400, { code: "refresh_token_not_found", msg: "Invalid refresh token" });
    }

    refreshTokens.delete(refreshToken);
    log("refresh", { email: user.email });
    return json(response, 200, session(user, 3_600));
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/logout") {
    log("sign-out", { scope: url.searchParams.get("scope") ?? "global" });
    response.writeHead(204, { "cache-control": "no-store" });
    return response.end();
  }

  return json(response, 404, { code: "not_found", msg: "Fixture route not found" });
});

server.listen(port, "127.0.0.1", () => {
  log("ready", { origin });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
