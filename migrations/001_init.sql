-- Store Configuration Hub — initial schema.
-- Applied by the ~50-line runner in lib/db.js at hub boot when
-- INQUEUE_DATABASE_URL is set (each file in one transaction, recorded in
-- schema_migrations, guarded by pg_advisory_lock).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer PRIMARY KEY,
  name        text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_config (
  slot                     text PRIMARY KEY
                           CHECK (slot ~ '^Store_[A-F]$'),
  display_name             text NOT NULL DEFAULT '',
  enabled                  boolean NOT NULL DEFAULT false,
  -- SKU
  sku_prefix               text NOT NULL DEFAULT ''
                           CHECK (sku_prefix = '' OR sku_prefix ~ '^[A-Z]{1,6}$'),
  sku_prefix_source        text NOT NULL DEFAULT 'unset'
                           CHECK (sku_prefix_source IN ('unset','manual','inferred_confirmed')),
  -- Google Drive SKU folder
  drive_folder_id          text NOT NULL DEFAULT ''
                           CHECK (drive_folder_id = '' OR drive_folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  drive_test_status        text NOT NULL DEFAULT 'untested'
                           CHECK (drive_test_status IN ('untested','ok','failed')),
  drive_test_detail        text,
  drive_tested_at          timestamptz,
  -- Etsy connection mirror (status only; tokens live in Batchly — never here)
  etsy_shop_id             text,
  etsy_shop_name           text,
  etsy_connected           boolean NOT NULL DEFAULT false,
  etsy_status_checked_at   timestamptz,
  -- Per-store Etsy resource IDs (hub-authoritative once the sync flag flips)
  etsy_taxonomy_id         bigint,
  etsy_shipping_profile_id bigint,
  etsy_readiness_state_id  bigint,
  etsy_return_policy_id    bigint,
  etsy_section_id          bigint,
  notes                    text NOT NULL DEFAULT '',
  row_version              integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Shared draft presets. scope='global' today; per-store overrides later become
-- additional rows (scope='Store_X') — a migration, not a redesign.
CREATE TABLE IF NOT EXISTS presets (
  scope        text PRIMARY KEY DEFAULT 'global',
  listing      jsonb,
  variation    jsonb,
  supplemental jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_meta (
  id             integer PRIMARY KEY CHECK (id = 1),
  config_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  tool                  text PRIMARY KEY CHECK (tool IN ('preply','batchly')),
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  pushed_config_version bigint,
  acked_config_version  bigint,
  mode                  text
);

INSERT INTO config_meta (id, config_version) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;
