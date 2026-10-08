// Postgres-backed durable state for Preply's JSON state files.
//
// Why: on Render without a persistent disk, everything under PREPLY_DATA_DIR
// is wiped on every deploy — including the Google Drive refresh token and the
// SKU ledger (the cross-batch duplicate-SKU guard). When PREPLY_DATABASE_URL
// is set, the JSON state files become a write-through cache: reads stay on
// disk (fast, synchronous semantics preserved), every write also upserts the
// same JSON into a single key/value table, and boot hydrates the disk files
// from the table before the server starts serving. The database is the source
// of truth; the disk is a local cache.
//
// When PREPLY_DATABASE_URL is unset (local dev, tests), createStateStore
// returns null and Preply behaves exactly as before (disk only).
//
// The URL may point at the same Render Postgres instance the hub uses — the
// table is namespaced (preply_state) and never collides with the hub's
// store-config tables.

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS preply_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

class PgStateStore {
  constructor(databaseUrl, options = {}) {
    this.databaseUrl = databaseUrl;
    this._poolFactory = options.poolFactory || null; // test seam
    this.pool = null;
  }

  async init() {
    if (!this.pool) {
      if (this._poolFactory) {
        this.pool = this._poolFactory();
      } else {
        const { default: pg } = await import('pg');
        this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 3 });
      }
    }
    await this.pool.query(CREATE_TABLE_SQL);
  }

  async getAll() {
    const res = await this.pool.query('SELECT key, value FROM preply_state');
    const map = new Map();
    for (const row of res.rows) map.set(row.key, row.value);
    return map;
  }

  async put(key, value) {
    await this.pool.query(
      `INSERT INTO preply_state (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }

  async remove(key) {
    await this.pool.query('DELETE FROM preply_state WHERE key = $1', [key]);
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

export function createStateStore(databaseUrl, options = {}) {
  if (!databaseUrl) return null;
  return new PgStateStore(databaseUrl, options);
}
