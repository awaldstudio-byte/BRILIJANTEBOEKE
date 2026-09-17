const requiredNames = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ORDER_TOKEN_SECRET",
  "APP_ORIGIN",
];

export function env() {
  const missing = requiredNames.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing server configuration: ${missing.join(", ")}`);
    error.code = "SERVER_CONFIGURATION_MISSING";
    throw error;
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    orderTokenSecret: process.env.ORDER_TOKEN_SECRET,
    appOrigin: process.env.APP_ORIGIN.replace(/\/$/, ""),
    payfastMode: process.env.PAYFAST_MODE === "live" ? "live" : "sandbox",
    payfastMerchantId: process.env.PAYFAST_MERCHANT_ID ?? "",
    payfastMerchantKey: process.env.PAYFAST_MERCHANT_KEY ?? "",
    payfastPassphrase: process.env.PAYFAST_PASSPHRASE ?? "",
    notificationEmails: (process.env.BRILJANTE_NOTIFICATION_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function requirePayFast(config = env()) {
  if (!config.payfastMerchantId || !config.payfastMerchantKey || !config.payfastPassphrase) {
    const error = new Error("PayFast has not been configured for this environment.");
    error.statusCode = 503;
    throw error;
  }
  return config;
}
