import { env } from "./env.js";
import { loadStaffSession, authorisedStaff } from './staff-session.js';
export { clearSessionCookies, setSessionCookies, parseCookies } from './staff-session.js';

export async function requireStaff(req, res, allowedRoles = ["administrator", "viewer"]) {
  const context = await loadStaffSession(req, res);
  const staff = await authorisedStaff(context, allowedRoles);
  return { user: context.user, staff, accessToken: context.accessToken };
}

export function requireSameOrigin(req) {
  const origin = req.headers.origin;
  const expected = env().appOrigin;
  if (!origin || origin.replace(/\/$/, "") !== expected || req.headers['sec-fetch-site'] === 'cross-site') {
    const error = new Error("The request origin is invalid.");
    error.statusCode = 403;
    throw error;
  }
}

