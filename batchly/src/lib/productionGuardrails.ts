// Production configuration guardrails for Batchly. Pure function over an env
// snapshot so the matrix is unit-testable; surfaced at startup (once) and in
// GET /api/settings/status for UI banners.

export interface ProductionWarning {
  level: "error" | "warn";
  code: string;
  message: string;
  fix: string;
}

type EnvLike = Record<string, string | undefined>;

export function isProductionEnv(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === "production" || env.INQUEUE_ENV === "production";
}

function isLocalhostUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /localhost|127\.0\.0\.1/.test(value);
}

export function computeProductionWarnings(env: EnvLike = process.env): ProductionWarning[] {
  const warnings: ProductionWarning[] = [];
  const production = isProductionEnv(env);

  if (production) {
    if (!env.INQUEUE_SESSION_SECRET || env.INQUEUE_SESSION_SECRET.length < 32) {
      warnings.push({
        level: "error",
        code: "SESSION_SECRET_MISSING",
        message: "INQUEUE_SESSION_SECRET is missing or shorter than 32 characters.",
        fix: "Set INQUEUE_SESSION_SECRET to the same 32+ character secret used by the inQueue hub.",
      });
    }
    if (!env.DATABASE_URL || env.DATABASE_URL.startsWith("file:")) {
      warnings.push({
        level: "error",
        code: "DATABASE_URL_SQLITE",
        message: "DATABASE_URL is unset or points at a SQLite file — production requires Postgres.",
        fix: "Provision Postgres on Render and set DATABASE_URL to its connection string, then run prisma migrate deploy.",
      });
    }
    if (isLocalhostUrl(env.ETSY_REDIRECT_URI)) {
      warnings.push({
        level: "error",
        code: "ETSY_REDIRECT_URI_LOCALHOST",
        message: "ETSY_REDIRECT_URI points at localhost in production.",
        fix: "Set ETSY_REDIRECT_URI to the public Batchly URL + /api/auth/etsy/callback and register it in the Etsy developer portal.",
      });
    }
    if (isLocalhostUrl(env.GOOGLE_REDIRECT_URI)) {
      warnings.push({
        level: "error",
        code: "GOOGLE_REDIRECT_URI_LOCALHOST",
        message: "GOOGLE_REDIRECT_URI points at localhost in production.",
        fix: "Set GOOGLE_REDIRECT_URI to the public Batchly URL + /api/auth/google/callback and add it to the Google Cloud OAuth client.",
      });
    }
  }

  const missingLevel: ProductionWarning["level"] = production ? "error" : "warn";
  if (!env.ETSY_CLIENT_ID) {
    warnings.push({
      level: missingLevel,
      code: "ETSY_CLIENT_MISSING",
      message: "ETSY_CLIENT_ID is not set — Etsy stores cannot connect.",
      fix: "Set ETSY_CLIENT_ID (and ETSY_CLIENT_SECRET) from your Etsy developer app.",
    });
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    warnings.push({
      level: missingLevel,
      code: "GOOGLE_CLIENT_MISSING",
      message: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — Google Drive cannot connect.",
      fix: "Create an OAuth client in the Google Cloud console and set both env vars.",
    });
  }

  return warnings;
}

// Log the guardrail summary once per process (from a Node route handler, not
// edge middleware).
let _logged = false;

export function logProductionWarningsOnce(): void {
  if (_logged) return;
  _logged = true;
  for (const w of computeProductionWarnings()) {
    const tag = w.level === "error" ? "ERROR" : "WARN";
    console.warn(`[batchly config ${tag}] ${w.code}: ${w.message} Fix: ${w.fix}`);
  }
}
