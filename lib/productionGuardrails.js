// Production configuration guardrails for the inQueue hub. Pure function over
// an env snapshot so the matrix is unit-testable; surfaced at hub startup and
// in GET /api/admin/status for the Connections tab.

export function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production' || env.INQUEUE_ENV === 'production';
}

function isLocalhostUrl(value) {
  if (!value) return false;
  return /localhost|127\.0\.0\.1/.test(value);
}

export function computeProductionWarnings(env = process.env) {
  const warnings = [];
  if (!isProductionEnv(env)) return warnings;

  if (!env.INQUEUE_SESSION_SECRET || env.INQUEUE_SESSION_SECRET.length < 32) {
    warnings.push({
      level: 'error',
      code: 'SESSION_SECRET_MISSING',
      message: 'INQUEUE_SESSION_SECRET is missing or shorter than 32 characters.',
      fix: 'Generate a 32+ character secret and set it identically on all four inQueue services.'
    });
  }
  if (!env.INQUEUE_PASSWORD_HASH) {
    warnings.push({
      level: 'error',
      code: env.INQUEUE_PASSWORD ? 'PASSWORD_PLAINTEXT' : 'PASSWORD_HASH_MISSING',
      message: env.INQUEUE_PASSWORD
        ? 'Login uses the plaintext INQUEUE_PASSWORD fallback in production.'
        : 'INQUEUE_PASSWORD_HASH is not set — nobody can log in.',
      fix: 'Set INQUEUE_PASSWORD_HASH (pbkdf2$<iterations>$<salt>$<hash>) and remove INQUEUE_PASSWORD.'
    });
  }
  for (const [key, label] of [
    ['INQUEUE_HUB_URL', 'hub'],
    ['INKLY_BASE_URL', 'Inkly'],
    ['PREPLY_BASE_URL', 'Preply'],
    ['BATCHLY_BASE_URL', 'Batchly']
  ]) {
    if (!env[key] || isLocalhostUrl(env[key])) {
      warnings.push({
        level: 'error',
        code: `${key}_LOCALHOST`,
        message: `${key} is unset or points at localhost in production — ${label} links and status checks will fail.`,
        fix: `Set ${key} to the public HTTPS URL of the ${label} service.`
      });
    }
  }
  // Store-config storage must be Postgres in production. The JSON file adapter
  // is a dev convenience only — Render's ephemeral disk would silently lose
  // store configuration on every deploy.
  if (!env.INQUEUE_DATABASE_URL || env.INQUEUE_DATABASE_URL.startsWith('file:') || isLocalhostUrl(env.INQUEUE_DATABASE_URL)) {
    warnings.push({
      level: 'error',
      code: 'DATABASE_URL_MISSING',
      message: 'INQUEUE_DATABASE_URL is unset, file-based, or points at localhost in production — store configuration would fall back to the ephemeral JSON adapter.',
      fix: 'Provision a managed Postgres instance and set INQUEUE_DATABASE_URL to its connection string.'
    });
  }

  // Render's FREE Postgres tier self-destructs ~30 days after creation,
  // taking store config, OAuth connections, SKU history, and the
  // duplicate-draft guard with it. The platform doesn't expose the expiry to
  // the app, so the operator records it once (Render dashboard shows it) and
  // the hub counts down loudly. scripts/backup-inqueue-db.sh +
  // docs/deployment.md §"Database backup & 30-day expiry" cover recovery.
  const expiresAt = env.INQUEUE_DB_EXPIRES_AT ? Date.parse(env.INQUEUE_DB_EXPIRES_AT) : NaN;
  if (Number.isNaN(expiresAt)) {
    warnings.push({
      level: 'warn',
      code: 'DB_EXPIRY_UNKNOWN',
      message: 'INQUEUE_DB_EXPIRES_AT is not set — if this is a free-tier Render Postgres, it will be deleted ~30 days after creation with no in-app warning.',
      fix: 'Copy the expiry date from the Render database page into INQUEUE_DB_EXPIRES_AT (e.g. 2026-08-10), and run scripts/backup-inqueue-db.sh weekly.'
    });
  } else {
    const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);
    if (daysLeft < 0) {
      warnings.push({
        level: 'error',
        code: 'DB_EXPIRED',
        message: `INQUEUE_DB_EXPIRES_AT says the database expired ${-daysLeft} day(s) ago — all suite state may already be gone.`,
        fix: 'Create a new Postgres, restore the latest backup (docs/deployment.md §Database backup), update the three DB env vars, redeploy, and update INQUEUE_DB_EXPIRES_AT.'
      });
    } else if (daysLeft <= 7) {
      warnings.push({
        level: 'error',
        code: 'DB_EXPIRING',
        message: `The shared Postgres expires in ${daysLeft} day(s) — store config, OAuth tokens, SKU history, and the duplicate-draft guard will be deleted with it.`,
        fix: 'Run scripts/backup-inqueue-db.sh NOW, then follow docs/deployment.md §Database backup to migrate before expiry.'
      });
    } else if (daysLeft <= 14) {
      warnings.push({
        level: 'warn',
        code: 'DB_EXPIRING_SOON',
        message: `The shared Postgres expires in ${daysLeft} days.`,
        fix: 'Take a fresh backup (scripts/backup-inqueue-db.sh) and plan the migration window.'
      });
    }
  }
  return warnings;
}
