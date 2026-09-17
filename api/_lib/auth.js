import { env } from "./env.js";
import { publicAuthClient, serviceClient, assertDatabaseResult } from "./supabase.js";

const accessCookie = "bb_admin_access";
const refreshCookie = "bb_admin_refresh";

export async function requireStaff(req, res, allowedRoles = ["administrator", "viewer"]) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  let accessToken = cookies[accessCookie];
  const refreshToken = cookies[refreshCookie];
  const auth = publicAuthClient();
  let user = null;

  if (accessToken) {
    const result = await auth.auth.getUser(accessToken);
    user = result.data.user;
  }

  if (!user && refreshToken) {
    const refreshed = await auth.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.data.session) {
      accessToken = refreshed.data.session.access_token;
      user = refreshed.data.user;
      setSessionCookies(res, refreshed.data.session);
    }
  }

  if (!user) throw unauthorized();

  const database = serviceClient();
  const { data: staff, error } = await database
    .from("staff_users")
    .select("user_id, display_name, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  assertDatabaseResult(error);
  if (!staff || !allowedRoles.includes(staff.role)) throw unauthorized();

  return { user, staff, accessToken };
}

export function requireSameOrigin(req) {
  const origin = req.headers.origin;
  const expected = env().appOrigin;
  if (!origin || origin.replace(/\/$/, "") !== expected) {
    const error = new Error("The request origin is invalid.");
    error.statusCode = 403;
    throw error;
  }
}

export function setSessionCookies(res, session) {
  const secure = env().appOrigin.startsWith("https://") ? "; Secure" : "";
  const accessMaxAge = Math.max(60, Number(session.expires_in ?? 3600));
  const common = `Path=/; HttpOnly; SameSite=Strict${secure}`;
  res.setHeader("Set-Cookie", [
    `${accessCookie}=${encodeURIComponent(session.access_token)}; Max-Age=${accessMaxAge}; ${common}`,
    `${refreshCookie}=${encodeURIComponent(session.refresh_token)}; Max-Age=604800; ${common}`,
  ]);
}

export function clearSessionCookies(res) {
  const secure = env().appOrigin.startsWith("https://") ? "; Secure" : "";
  const common = `Path=/; HttpOnly; SameSite=Strict${secure}`;
  res.setHeader("Set-Cookie", [
    `${accessCookie}=; Max-Age=0; ${common}`,
    `${refreshCookie}=; Max-Age=0; ${common}`,
  ]);
}

export function parseCookies(value) {
  return Object.fromEntries(
    value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function unauthorized() {
  const error = new Error("Sign in is required.");
  error.statusCode = 401;
  return error;
}
