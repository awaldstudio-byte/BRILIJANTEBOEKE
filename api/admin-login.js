import { clearSessionCookies, requireSameOrigin, setSessionCookies } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError, readJson } from "./_lib/http.js";
import { assertDatabaseResult, publicAuthClient, serviceClient } from "./_lib/supabase.js";
import { text } from "./_lib/validation.js";

export default async function handler(req, res) {
  if (!["POST", "DELETE"].includes(req.method)) return methodNotAllowed(res, ["POST", "DELETE"]);

  try {
    requireSameOrigin(req);
    if (req.method === "DELETE") {
      clearSessionCookies(res);
      return json(res, 200, { ok: true });
    }
    const body = await readJson(req, 8_000);
    const email = text(body.email, 5, 254, "Enter a valid email address.").toLowerCase();
    const password = text(body.password, 8, 200, "Enter your password.");
    const auth = publicAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      return json(res, 401, { error: "The email address or password is incorrect." });
    }

    const database = serviceClient();
    const { data: staff, error: staffError } = await database
      .from("staff_users")
      .select("display_name, role, active")
      .eq("user_id", data.user.id)
      .eq("active", true)
      .maybeSingle();
    assertDatabaseResult(staffError);
    if (!staff) return json(res, 403, { error: "This account does not have administration access." });

    setSessionCookies(res, data.session);
    return json(res, 200, { staff: { display_name: staff.display_name, role: staff.role } });
  } catch (error) {
    console.error("admin-login", { code: error.code, message: error.message });
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
