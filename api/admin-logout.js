import { clearSessionCookies, requireSameOrigin } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    requireSameOrigin(req);
    clearSessionCookies(res);
    return json(res, 200, { ok: true });
  } catch (error) {
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
