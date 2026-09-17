import { requireStaff } from "./_lib/auth.js";
import { json, methodNotAllowed, publicError } from "./_lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const { staff } = await requireStaff(req, res);
    return json(res, 200, { staff });
  } catch (error) {
    const result = publicError(error);
    return json(res, result.status, { error: result.message });
  }
}
