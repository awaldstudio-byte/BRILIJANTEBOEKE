export function applyApiHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function json(res, status, payload) {
  applyApiHeaders(res);
  return res.status(status).json(payload);
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return json(res, 405, { error: "Method not allowed." });
}

export async function readJson(req, maxBytes = 32_000) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = await readRaw(req, maxBytes);
  if (!raw.length) return {};

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

export async function readRaw(req, maxBytes = 64_000) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw tooLarge();
    return req.body;
  }

  if (typeof req.body === "string") {
    const body = Buffer.from(req.body, "utf8");
    if (body.length > maxBytes) throw tooLarge();
    return body;
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function tooLarge() {
  const error = new Error("Request body is too large.");
  error.statusCode = 413;
  return error;
}

export function publicError(error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) return { status, message: "The request could not be completed." };
  return { status, message: error.message };
}
