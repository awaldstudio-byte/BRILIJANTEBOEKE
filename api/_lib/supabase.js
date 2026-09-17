import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export function serviceClient() {
  const config = env();
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function publicAuthClient() {
  const config = env();
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function assertDatabaseResult(error) {
  if (!error) return;
  const wrapped = new Error(error.message || "Database request failed.");
  wrapped.code = error.code;
  wrapped.details = error.details;
  throw wrapped;
}
