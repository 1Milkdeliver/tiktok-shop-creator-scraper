'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { normalizeValue } = require('../exporter');
const { MIGRATIONS } = require('./migrations');

function nowIso() { return new Date().toISOString(); }

function scalar(value) {
  const normalized = normalizeValue(value);
  return normalized === null || normalized === undefined ? '' : String(normalized);
}

function numeric(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.value !== undefined) return numeric(value.value);
    if (value.maximum !== undefined) return numeric(value.maximum);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = scalar(value).replace(/,/g, '').trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let n = Number(match[0]);
  if (/\bK\b/i.test(text) || /\dK/i.test(text)) n *= 1e3;
  else if (/\bM\b/i.test(text) || /\dM/i.test(text)) n *= 1e6;
  else if (/\bB\b/i.test(text) || /\dB/i.test(text)) n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

class CreatorDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = null;
  }

  async open() {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.filePath, err => err ? reject(err) : resolve(db));
    });
    await this.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    await this.migrate();
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null));
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, err => err ? reject(err) : resolve());
    });
  }

  async migrate() {
    await this.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
    const applied = new Set((await this.all('SELECT version FROM schema_migrations')).map(r => r.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await this.exec('BEGIN IMMEDIATE;');
      try {
        await this.exec(migration.sql);
        await this.run('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)', [migration.version, migration.name, nowIso()]);
        await this.exec('COMMIT;');
      } catch (error) {
        await this.exec('ROLLBACK;').catch(() => {});
        throw error;
      }
    }
  }

  async createScrapeJob(config) {
    const id = crypto.randomUUID();
    // Cookie file paths and large dedupe ID arrays are runtime-only state; they
    // add no value to task history and should not be persisted.
    const storedConfig = { ...config };
    delete storedConfig.cookieFiles;
    delete storedConfig.existingIds;
    delete storedConfig.databaseJobId;
    await this.run(
      'INSERT INTO scrape_jobs(id, status, region, config_json, started_at) VALUES(?, ?, ?, ?, ?)',
      [id, 'running', String(config.shopRegion || 'US').toUpperCase(), JSON.stringify(storedConfig), nowIso()]
    );
    return id;
  }

  async getCreatorIds(region) {
    const rows = await this.all('SELECT creator_id FROM creators WHERE region = ?', [String(region || 'US').toUpperCase()]);
    return rows.map(row => String(row.creator_id));
  }

  async finishScrapeJob(id, result) {
    if (!id) return;
    await this.run(
      `UPDATE scrape_jobs SET status = ?, finished_at = ?, creators_found = ?, rows_saved = ?, error = ? WHERE id = ?`,
      [result && result.ok ? 'completed' : 'failed', nowIso(), result?.creators || 0, result?.database?.saved || 0, result?.error || null, id]
    );
  }

  async upsertCreators(rows, options = {}) {
    const region = String(options.region || 'US').toUpperCase();
    const jobId = options.jobId || null;
    const timestamp = nowIso();
    const validRows = (rows || []).filter(row => row && row.creator_oecuid !== null && row.creator_oecuid !== undefined && String(row.creator_oecuid));
    if (!validRows.length) return { saved: 0 };

    const upsertSql = `
      INSERT INTO creators(
        region, creator_id, handle, nickname, avatar_url, category,
        follower_count, total_gmv, units_sold, bio, contact_email, mcn,
        raw_json, first_seen_at, last_seen_at, last_refreshed_at, source_job_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region, creator_id) DO UPDATE SET
        handle = CASE WHEN excluded.handle <> '' THEN excluded.handle ELSE creators.handle END,
        nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE creators.nickname END,
        avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE creators.avatar_url END,
        category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE creators.category END,
        follower_count = COALESCE(excluded.follower_count, creators.follower_count),
        total_gmv = COALESCE(excluded.total_gmv, creators.total_gmv),
        units_sold = COALESCE(excluded.units_sold, creators.units_sold),
        bio = CASE WHEN excluded.bio <> '' THEN excluded.bio ELSE creators.bio END,
        contact_email = CASE WHEN excluded.contact_email <> '' THEN excluded.contact_email ELSE creators.contact_email END,
        mcn = CASE WHEN excluded.mcn <> '' THEN excluded.mcn ELSE creators.mcn END,
        raw_json = excluded.raw_json,
        last_seen_at = excluded.last_seen_at,
        last_refreshed_at = excluded.last_refreshed_at,
        source_job_id = excluded.source_job_id
    `;

    await this.exec('BEGIN IMMEDIATE;');
    try {
      for (const row of validRows) {
        const creatorId = String(row.creator_oecuid);
        await this.run(upsertSql, [
          region, creatorId, scalar(row.handle), scalar(row.nickname), scalar(row.avatar), scalar(row.category),
          numeric(row.follower_cnt), numeric(row.med_gmv_revenue), numeric(row.units_sold),
          scalar(row['简介']), scalar(row['合作邮箱']), scalar(row['MCN机构']),
          JSON.stringify(row), timestamp, timestamp, timestamp, jobId,
        ]);
        if (jobId) {
          await this.run(
            `INSERT OR IGNORE INTO scrape_job_creators(job_id, creator_row_id, seen_at)
             SELECT ?, id, ? FROM creators WHERE region = ? AND creator_id = ?`,
            [jobId, timestamp, region, creatorId]
          );
        }
      }
      await this.exec('COMMIT;');
      return { saved: validRows.length };
    } catch (error) {
      await this.exec('ROLLBACK;').catch(() => {});
      throw error;
    }
  }

  async listCreators(filters = {}) {
    const where = [];
    const params = [];
    if (filters.region) { where.push('region = ?'); params.push(String(filters.region).toUpperCase()); }
    if (filters.search) {
      where.push('(handle LIKE ? OR nickname LIKE ? OR creator_id LIKE ? OR contact_email LIKE ?)');
      const q = `%${String(filters.search).trim()}%`;
      params.push(q, q, q, q);
    }
    if (filters.hasEmail === true) where.push("contact_email IS NOT NULL AND contact_email <> ''");
    if (Number.isFinite(Number(filters.minFollowers))) { where.push('follower_count >= ?'); params.push(Number(filters.minFollowers)); }
    if (Number.isFinite(Number(filters.minGmv))) { where.push('total_gmv >= ?'); params.push(Number(filters.minGmv)); }
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.all(
      `SELECT id, region, creator_id, handle, nickname, avatar_url, category,
              follower_count, total_gmv, units_sold, bio, contact_email, mcn,
              first_seen_at, last_refreshed_at
       FROM creators ${clause}
       ORDER BY last_refreshed_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const count = await this.get(`SELECT COUNT(*) AS count FROM creators ${clause}`, params);
    return { rows, total: count?.count || 0, limit, offset };
  }

  async listScrapeJobs(filters = {}) {
    const where = [];
    const params = [];
    if (filters.status) { where.push('status = ?'); params.push(String(filters.status)); }
    if (filters.region) { where.push('region = ?'); params.push(String(filters.region).toUpperCase()); }
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.all(
      `SELECT id, status, region, config_json, started_at, finished_at,
              creators_found, rows_saved, error
       FROM scrape_jobs ${clause}
       ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const count = await this.get(`SELECT COUNT(*) AS count FROM scrape_jobs ${clause}`, params);
    return {
      rows: rows.map(row => {
        let config = {};
        try { config = JSON.parse(row.config_json || '{}'); } catch (e) { }
        const { config_json: ignored, ...job } = row;
        return { ...job, config };
      }),
      total: count?.count || 0,
      limit,
      offset,
    };
  }

  async getStats() {
    const totals = await this.get(`
      SELECT COUNT(*) AS creators,
             SUM(CASE WHEN contact_email IS NOT NULL AND contact_email <> '' THEN 1 ELSE 0 END) AS with_email,
             COUNT(DISTINCT region) AS regions
      FROM creators
    `);
    const jobs = await this.get(`
      SELECT SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM scrape_jobs
    `);
    let bytes = 0;
    try { bytes = fs.statSync(this.filePath).size; } catch (e) { }
    return { ...totals, jobs, bytes, path: this.filePath };
  }

  async close() {
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    await new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
  }
}

module.exports = { CreatorDatabase, numeric };
