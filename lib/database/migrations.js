'use strict';

// Append-only migrations. Never edit a migration after it has shipped; add a
// new version instead so existing user databases can upgrade safely.
const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_creator_library',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scrape_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        region TEXT NOT NULL,
        config_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        creators_found INTEGER NOT NULL DEFAULT 0,
        rows_saved INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS creators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        handle TEXT,
        nickname TEXT,
        avatar_url TEXT,
        category TEXT,
        follower_count REAL,
        total_gmv REAL,
        units_sold REAL,
        bio TEXT,
        contact_email TEXT,
        mcn TEXT,
        raw_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_refreshed_at TEXT NOT NULL,
        source_job_id TEXT,
        UNIQUE(region, creator_id),
        FOREIGN KEY(source_job_id) REFERENCES scrape_jobs(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_creators_region ON creators(region);
      CREATE INDEX IF NOT EXISTS idx_creators_handle ON creators(handle);
      CREATE INDEX IF NOT EXISTS idx_creators_refreshed ON creators(last_refreshed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_creators_followers ON creators(follower_count DESC);
      CREATE INDEX IF NOT EXISTS idx_creators_gmv ON creators(total_gmv DESC);

      CREATE TABLE IF NOT EXISTS scrape_job_creators (
        job_id TEXT NOT NULL,
        creator_row_id INTEGER NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY(job_id, creator_row_id),
        FOREIGN KEY(job_id) REFERENCES scrape_jobs(id) ON DELETE CASCADE,
        FOREIGN KEY(creator_row_id) REFERENCES creators(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS export_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        filter_json TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        format TEXT NOT NULL,
        output_path TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
    `,
  },
];

module.exports = { MIGRATIONS };
