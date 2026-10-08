// Store Configuration storage layer (Node ESM).
//
// Two adapters behind one interface:
//   - PostgresStore — production (Render). Selected when a database URL is
//     provided. Runs the SQL migrations in ./migrations at init, guarded by
//     pg_advisory_lock so concurrent boots don't race.
//   - JsonFileStore — local dev fallback (data/store-config.json). Same
//     validated domain objects, same interface, zero infra. NOT for
//     production: lib/productionGuardrails.js fails closed when
//     INQUEUE_DATABASE_URL is missing in prod.
//
// The interface (all async):
//   init()                                      — migrate/ensure rows exist
//   getState()                                  — {configVersion, stores{slot}, presets, sync{tool}}
//   updateStore(slot, patch, expectedRowVersion)— user-editable fields; optimistic concurrency
//   updateStoreSystem(slot, fields)             — server-managed fields (test results, etsy mirror)
//   savePresets(presets)                        — replace shared presets
//   recordSync(tool, fields)                    — sync bookkeeping
//   close()
//
// Errors carry a `code`: 'CONFLICT' (rowVersion mismatch) or 'BAD_SLOT'.
// Every write bumps config_meta.config_version — the monotonically increasing
// version the sync protocol uses for idempotency.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SLOTS, isValidSlot, defaultStore, defaultPresets, withPresetDefaults } from './storeConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// JSON file adapter (dev)
// ---------------------------------------------------------------------------
class JsonFileStore {
  constructor(filePath) {
    this.kind = 'json';
    this.filePath = filePath;
    this._queue = Promise.resolve(); // serialize read-modify-write cycles
  }

  async init() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await this._mutate((state) => state); // materializes defaults on first run
  }

  _readRaw() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  _normalize(raw) {
    const state = {
      configVersion: Number(raw?.configVersion) || 0,
      stores: {},
      presets: withPresetDefaults(raw?.presets),
      sync: {
        preply: raw?.sync?.preply || null,
        batchly: raw?.sync?.batchly || null,
      },
    };
    for (const slot of SLOTS) {
      state.stores[slot] = { ...defaultStore(slot), ...(raw?.stores?.[slot] || {}) };
      state.stores[slot].etsyIds = { ...defaultStore(slot).etsyIds, ...(raw?.stores?.[slot]?.etsyIds || {}) };
    }
    return state;
  }

  async _mutate(fn) {
    // Chain on the queue so concurrent requests can't interleave file writes.
    const run = this._queue.then(async () => {
      const state = this._normalize(this._readRaw());
      const result = await fn(state);
      const tmp = `${this.filePath}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
      await fsp.rename(tmp, this.filePath);
      return result;
    });
    // Keep the queue alive even if this mutation throws.
    this._queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async getState() {
    return this._normalize(this._readRaw());
  }

  async updateStore(slot, patch, expectedRowVersion) {
    if (!isValidSlot(slot)) throw codedError('BAD_SLOT', `invalid slot ${slot}`);
    return this._mutate((state) => {
      const store = state.stores[slot];
      if (expectedRowVersion !== undefined && store.rowVersion !== expectedRowVersion) {
        throw codedError('CONFLICT', `rowVersion mismatch for ${slot}: expected ${expectedRowVersion}, have ${store.rowVersion}`);
      }
      applyStorePatch(store, patch);
      store.rowVersion += 1;
      store.updatedAt = new Date().toISOString();
      if (!store.createdAt) store.createdAt = store.updatedAt;
      state.configVersion += 1;
      return { store: structuredClone(store), configVersion: state.configVersion };
    });
  }

  async updateStoreSystem(slot, fields) {
    if (!isValidSlot(slot)) throw codedError('BAD_SLOT', `invalid slot ${slot}`);
    return this._mutate((state) => {
      const store = state.stores[slot];
      applySystemFields(store, fields);
      store.rowVersion += 1;
      store.updatedAt = new Date().toISOString();
      state.configVersion += 1;
      return { store: structuredClone(store), configVersion: state.configVersion };
    });
  }

  async savePresets(presets) {
    return this._mutate((state) => {
      state.presets = structuredClone(presets);
      state.configVersion += 1;
      return { presets: structuredClone(state.presets), configVersion: state.configVersion };
    });
  }

  async recordSync(tool, fields) {
    return this._mutate((state) => {
      state.sync[tool] = { ...(state.sync[tool] || {}), ...fields };
      return structuredClone(state.sync[tool]);
    });
  }

  async close() {}
}

// Shared patch application (both adapters funnel through these so the two
// backends can never drift on which fields are writable).
function applyStorePatch(store, patch) {
  // Changing the folder (to a different value) invalidates the previous test.
  const folderChanged = 'driveFolderId' in patch && patch.driveFolderId !== store.driveFolderId;
  for (const key of ['displayName', 'enabled', 'skuPrefix', 'skuPrefixSource', 'driveFolderId', 'notes']) {
    if (key in patch) store[key] = patch[key];
  }
  if (folderChanged) {
    store.driveTestStatus = 'untested';
    store.driveTestDetail = null;
    store.driveTestedAt = null;
  }
  if (patch.etsyIds) {
    for (const key of Object.keys(patch.etsyIds)) store.etsyIds[key] = patch.etsyIds[key];
  }
}

function applySystemFields(store, fields) {
  const ALLOWED = new Set([
    'driveTestStatus', 'driveTestDetail', 'driveTestedAt',
    'etsyShopId', 'etsyShopName', 'etsyConnected', 'etsyStatusCheckedAt',
    'etsyIds',
  ]);
  for (const key of Object.keys(fields)) {
    if (!ALLOWED.has(key)) continue;
    if (key === 'etsyIds') {
      for (const idKey of Object.keys(fields.etsyIds || {})) store.etsyIds[idKey] = fields.etsyIds[idKey];
    } else {
      store[key] = fields[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Postgres adapter (production)
// ---------------------------------------------------------------------------

const ROW_FIELDS = `slot, display_name, enabled, sku_prefix, sku_prefix_source,
  drive_folder_id, drive_test_status, drive_test_detail, drive_tested_at,
  etsy_shop_id, etsy_shop_name, etsy_connected, etsy_status_checked_at,
  etsy_taxonomy_id, etsy_shipping_profile_id, etsy_readiness_state_id,
  etsy_return_policy_id, etsy_section_id, notes, row_version, created_at, updated_at`;

function rowToStore(row) {
  return {
    slot: row.slot,
    displayName: row.display_name,
    enabled: row.enabled,
    skuPrefix: row.sku_prefix,
    skuPrefixSource: row.sku_prefix_source,
    driveFolderId: row.drive_folder_id,
    driveTestStatus: row.drive_test_status,
    driveTestDetail: row.drive_test_detail,
    driveTestedAt: row.drive_tested_at ? new Date(row.drive_tested_at).toISOString() : null,
    etsyShopId: row.etsy_shop_id,
    etsyShopName: row.etsy_shop_name,
    etsyConnected: row.etsy_connected,
    etsyStatusCheckedAt: row.etsy_status_checked_at ? new Date(row.etsy_status_checked_at).toISOString() : null,
    etsyIds: {
      taxonomyId: row.etsy_taxonomy_id !== null ? Number(row.etsy_taxonomy_id) : null,
      shippingProfileId: row.etsy_shipping_profile_id !== null ? Number(row.etsy_shipping_profile_id) : null,
      readinessStateId: row.etsy_readiness_state_id !== null ? Number(row.etsy_readiness_state_id) : null,
      returnPolicyId: row.etsy_return_policy_id !== null ? Number(row.etsy_return_policy_id) : null,
      sectionId: row.etsy_section_id !== null ? Number(row.etsy_section_id) : null,
    },
    notes: row.notes,
    rowVersion: row.row_version,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

const PATCH_COLUMNS = {
  displayName: 'display_name',
  enabled: 'enabled',
  skuPrefix: 'sku_prefix',
  skuPrefixSource: 'sku_prefix_source',
  driveFolderId: 'drive_folder_id',
  notes: 'notes',
};
const SYSTEM_COLUMNS = {
  driveTestStatus: 'drive_test_status',
  driveTestDetail: 'drive_test_detail',
  driveTestedAt: 'drive_tested_at',
  etsyShopId: 'etsy_shop_id',
  etsyShopName: 'etsy_shop_name',
  etsyConnected: 'etsy_connected',
  etsyStatusCheckedAt: 'etsy_status_checked_at',
};
const ETSY_ID_COLUMNS = {
  taxonomyId: 'etsy_taxonomy_id',
  shippingProfileId: 'etsy_shipping_profile_id',
  readinessStateId: 'etsy_readiness_state_id',
  returnPolicyId: 'etsy_return_policy_id',
  sectionId: 'etsy_section_id',
};

class PostgresStore {
  constructor(databaseUrl, options = {}) {
    this.kind = 'postgres';
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
        this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 5 });
      }
    }
    await runMigrations(this.pool);
    // Ensure the six fixed slot rows + the global presets row exist.
    for (const slot of SLOTS) {
      await this.pool.query('INSERT INTO store_config (slot) VALUES ($1) ON CONFLICT (slot) DO NOTHING', [slot]);
    }
    const d = defaultPresets();
    await this.pool.query(
      `INSERT INTO presets (scope, listing, variation, supplemental) VALUES ('global', $1, $2, $3)
       ON CONFLICT (scope) DO NOTHING`,
      [d.listing, d.variation, d.supplemental],
    );
  }

  async _bumpVersion(client) {
    const res = await client.query('UPDATE config_meta SET config_version = config_version + 1 WHERE id = 1 RETURNING config_version');
    return Number(res.rows[0].config_version);
  }

  async getState() {
    const [meta, stores, presets, sync] = await Promise.all([
      this.pool.query('SELECT config_version FROM config_meta WHERE id = 1'),
      this.pool.query(`SELECT ${ROW_FIELDS} FROM store_config`),
      this.pool.query("SELECT listing, variation, supplemental FROM presets WHERE scope = 'global'"),
      this.pool.query('SELECT * FROM sync_state'),
    ]);
    const state = {
      configVersion: Number(meta.rows[0]?.config_version || 0),
      stores: {},
      presets: withPresetDefaults(presets.rows[0]
        ? { listing: presets.rows[0].listing, variation: presets.rows[0].variation, supplemental: presets.rows[0].supplemental }
        : null),
      sync: { preply: null, batchly: null },
    };
    for (const slot of SLOTS) state.stores[slot] = defaultStore(slot);
    for (const row of stores.rows) state.stores[row.slot] = rowToStore(row);
    for (const row of sync.rows) {
      state.sync[row.tool] = {
        lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
        lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
        lastError: row.last_error,
        pushedConfigVersion: row.pushed_config_version !== null ? Number(row.pushed_config_version) : null,
        ackedConfigVersion: row.acked_config_version !== null ? Number(row.acked_config_version) : null,
        mode: row.mode,
      };
    }
    return state;
  }

  async _writeStore(slot, patch, expectedRowVersion, columnMap, { resetDriveTest = false } = {}) {
    if (!isValidSlot(slot)) throw codedError('BAD_SLOT', `invalid slot ${slot}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(`SELECT ${ROW_FIELDS} FROM store_config WHERE slot = $1 FOR UPDATE`, [slot]);
      if (!current.rows.length) throw codedError('BAD_SLOT', `no row for ${slot}`);
      if (expectedRowVersion !== undefined && current.rows[0].row_version !== expectedRowVersion) {
        throw codedError('CONFLICT', `rowVersion mismatch for ${slot}: expected ${expectedRowVersion}, have ${current.rows[0].row_version}`);
      }
      const sets = [];
      const params = [slot];
      const push = (column, value) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      for (const [field, column] of Object.entries(columnMap)) {
        if (field in patch) push(column, patch[field]);
      }
      if (patch.etsyIds) {
        for (const [field, column] of Object.entries(ETSY_ID_COLUMNS)) {
          if (field in patch.etsyIds) push(column, patch.etsyIds[field]);
        }
      }
      if (resetDriveTest && 'driveFolderId' in patch && patch.driveFolderId !== current.rows[0].drive_folder_id) {
        sets.push("drive_test_status = 'untested'", 'drive_test_detail = NULL', 'drive_tested_at = NULL');
      }
      sets.push('row_version = row_version + 1', 'updated_at = now()');
      const updated = await client.query(
        `UPDATE store_config SET ${sets.join(', ')} WHERE slot = $1 RETURNING ${ROW_FIELDS}`,
        params,
      );
      const configVersion = await this._bumpVersion(client);
      await client.query('COMMIT');
      return { store: rowToStore(updated.rows[0]), configVersion };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async updateStore(slot, patch, expectedRowVersion) {
    return this._writeStore(slot, patch, expectedRowVersion, PATCH_COLUMNS, { resetDriveTest: true });
  }

  async updateStoreSystem(slot, fields) {
    return this._writeStore(slot, fields, undefined, SYSTEM_COLUMNS);
  }

  async savePresets(presets) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO presets (scope, listing, variation, supplemental, updated_at)
         VALUES ('global', $1, $2, $3, now())
         ON CONFLICT (scope) DO UPDATE SET listing = $1, variation = $2, supplemental = $3, updated_at = now()`,
        [presets.listing, presets.variation, presets.supplemental],
      );
      const configVersion = await this._bumpVersion(client);
      await client.query('COMMIT');
      return { presets, configVersion };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async recordSync(tool, fields) {
    const columns = {
      lastAttemptAt: 'last_attempt_at',
      lastSuccessAt: 'last_success_at',
      lastError: 'last_error',
      pushedConfigVersion: 'pushed_config_version',
      ackedConfigVersion: 'acked_config_version',
      mode: 'mode',
    };
    const insertCols = ['tool'];
    const insertVals = ['$1'];
    const updates = [];
    const params = [tool];
    for (const [field, column] of Object.entries(columns)) {
      if (field in fields) {
        params.push(fields[field]);
        insertCols.push(column);
        insertVals.push(`$${params.length}`);
        updates.push(`${column} = $${params.length}`);
      }
    }
    await this.pool.query(
      `INSERT INTO sync_state (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})
       ON CONFLICT (tool) DO UPDATE SET ${updates.join(', ')}`,
      params,
    );
  }

  async close() {
    if (this.pool) await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// Migration runner (~50 lines). Numbered .sql files, applied in order inside
// individual transactions, recorded in schema_migrations, serialized across
// concurrent boots with an advisory lock.
// ---------------------------------------------------------------------------
export async function runMigrations(pool, migrationsDir = MIGRATIONS_DIR) {
  const files = (await fsp.readdir(migrationsDir))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const LOCK_KEY = 727707; // arbitrary constant shared by all hub instances
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const appliedRes = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => Number(r.version)));
    for (const file of files) {
      const version = Number(file.split('_')[0]);
      if (applied.has(version)) continue;
      const sql = await fsp.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [version, file],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createConfigStore(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.INQUEUE_DATABASE_URL;
  if (databaseUrl) return new PostgresStore(databaseUrl, options);
  // INQUEUE_STORE_CONFIG_FILE lets tests point the dev adapter at a scratch
  // file; normal dev uses data/store-config.json at the hub root.
  const filePath = options.filePath
    || process.env.INQUEUE_STORE_CONFIG_FILE
    || path.join(__dirname, '..', 'data', 'store-config.json');
  return new JsonFileStore(filePath);
}
