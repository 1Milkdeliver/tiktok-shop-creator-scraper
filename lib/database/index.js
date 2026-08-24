'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { normalizeValue } = require('../exporter');
const { MIGRATIONS } = require('./migrations');
const { applyActivity } = require('../activity');

function nowIso() { return new Date().toISOString(); }

// Escape % and _ for LIKE patterns (raw_json text matching)
function escapeLike(s) { return String(s).replace(/[%_\\]/g, m => '\\' + m); }

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
    const updateFields = Array.isArray(options.updateFields)
      ? new Set(options.updateFields.map(String))
      : null;
    const canUpdate = key => !updateFields || updateFields.has(key);
    const validRows = (rows || []).filter(row => row && row.creator_oecuid !== null && row.creator_oecuid !== undefined && String(row.creator_oecuid));
    if (!validRows.length) return { saved: 0 };

    const upsertSql = `
      INSERT INTO creators(
        region, creator_id, handle, nickname, avatar_url, category,
        follower_count, total_gmv, units_sold, bio, contact_email, mcn,
        raw_json, first_seen_at, last_seen_at, last_refreshed_at, source_job_id,
        last_publish_at, activity_status, activity_reason, vertical_category
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region, creator_id) DO UPDATE SET
        handle = CASE WHEN excluded.handle <> '' THEN excluded.handle ELSE creators.handle END,
        nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE creators.nickname END,
        avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE creators.avatar_url END,
        category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE creators.category END,
        vertical_category = CASE WHEN excluded.vertical_category <> '' THEN excluded.vertical_category ELSE creators.vertical_category END,
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
        ,last_publish_at = COALESCE(excluded.last_publish_at, creators.last_publish_at)
        ,activity_status = excluded.activity_status
        ,activity_reason = excluded.activity_reason
    `;

    await this.exec('BEGIN IMMEDIATE;');
    try {
      let inserted = 0;
      let updated = 0;
      for (const row of validRows) {
        const activity = applyActivity(row);
        const creatorId = String(row.creator_oecuid);
        const existing = await this.get('SELECT raw_json FROM creators WHERE region = ? AND creator_id = ?', [region, creatorId]);
        const isNew = !existing;
        if (isNew) inserted++; else updated++;
        let previousRaw = {};
        try { previousRaw = JSON.parse(existing?.raw_json || '{}'); } catch (e) { }
        const selectedRaw = updateFields
          ? Object.fromEntries(Object.entries(row).filter(([key]) => canUpdate(key)))
          : row;
        const mergedRaw = { ...previousRaw, ...selectedRaw, creator_oecuid: creatorId };
        // Avatar images are heavy — do NOT store them in the database.
        delete mergedRaw.avatar;
        delete mergedRaw.avatar_url;
        // Store TEXT-ONLY display values: convert every object/array field
        // (GPM ranges, gender distribution, etc.) to its readable form so the
        // library table renders correctly without carrying raw structures.
        for (const key of Object.keys(mergedRaw)) {
          const v = mergedRaw[key];
          if (v && typeof v === 'object') mergedRaw[key] = normalizeValue(v);
        }
        await this.run(upsertSql, [
          region, creatorId,
          canUpdate('handle') ? scalar(row.handle) : '',
          canUpdate('nickname') ? scalar(row.nickname) : '',
          '', // avatar_url: intentionally empty — images are not stored
          canUpdate('category') ? scalar(row.category) : '',
          canUpdate('follower_cnt') ? numeric(row.follower_cnt) : null,
          canUpdate('med_gmv_revenue') ? numeric(row.med_gmv_revenue) : null,
          canUpdate('units_sold') ? numeric(row.units_sold) : null,
          canUpdate('简介') ? scalar(row['简介']) : '',
          canUpdate('合作邮箱') ? scalar(row['合作邮箱']) : '',
          canUpdate('MCN机构') ? scalar(row['MCN机构']) : '',
          JSON.stringify(mergedRaw), timestamp, timestamp, timestamp, jobId,
          activity.last_publish_time || null, activity.activity_status, activity.activity_reason,
          canUpdate('垂直类目') ? scalar(row['垂直类目']) : '',
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
      return { saved: validRows.length, inserted, updated };
    } catch (error) {
      await this.exec('ROLLBACK;').catch(() => {});
      throw error;
    }
  }

  // Build the shared WHERE clause + params for listCreators / listCreatorIds.
  // Supports multi-select arrays: region[], category[], followerBuckets[].
  _buildWhere(filters = {}) {
    const where = [];
    const params = [];
    const regions = Array.isArray(filters.region) ? filters.region.filter(Boolean) : (filters.region ? [filters.region] : []);
    if (regions.length) {
      where.push(`region IN (${regions.map(() => '?').join(',')})`);
      params.push(...regions.map(r => String(r).toUpperCase()));
    }
    if (filters.search) {
      where.push('(handle LIKE ? OR nickname LIKE ? OR creator_id LIKE ? OR contact_email LIKE ?)');
      const q = `%${String(filters.search).trim()}%`;
      params.push(q, q, q, q);
    }
    if (filters.hasEmail === true) where.push("contact_email IS NOT NULL AND contact_email <> ''");
    if (filters.activityStatus) { where.push('activity_status = ?'); params.push(String(filters.activityStatus)); }
    const followerBuckets = Array.isArray(filters.followerBuckets) ? filters.followerBuckets.filter(Boolean) : [];
    if (followerBuckets.length) {
      const bucketClauses = [];
      for (const b of followerBuckets) {
        const m = String(b).match(/^([<>]?=?)([\d.]+)([kKmM]?)$/);
        if (!m) continue;
        let n = parseFloat(m[2]); const u = m[3].toLowerCase();
        if (u === 'k') n *= 1e3; else if (u === 'm') n *= 1e6;
        const op = m[1];
        if (op === '<') { bucketClauses.push('follower_count < ?'); params.push(n); }
        else if (op === '>') { bucketClauses.push('follower_count >= ?'); params.push(n); }
        else { bucketClauses.push('follower_count >= ? AND follower_count < ?'); params.push(n, n * 10); }
      }
      if (bucketClauses.length) where.push(`(${bucketClauses.join(' OR ')})`);
    }
    if (Number.isFinite(Number(filters.minFollowers))) { where.push('follower_count >= ?'); params.push(Number(filters.minFollowers)); }
    if (Number.isFinite(Number(filters.maxFollowers))) { where.push('follower_count <= ?'); params.push(Number(filters.maxFollowers)); }
    if (Number.isFinite(Number(filters.minGmv))) { where.push('total_gmv >= ?'); params.push(Number(filters.minGmv)); }
    if (Number.isFinite(Number(filters.maxGmv))) { where.push('total_gmv <= ?'); params.push(Number(filters.maxGmv)); }
    if (Number.isFinite(Number(filters.minUnits))) { where.push('units_sold >= ?'); params.push(Number(filters.minUnits)); }
    if (Number.isFinite(Number(filters.maxUnits))) { where.push('units_sold <= ?'); params.push(Number(filters.maxUnits)); }
    const cats = Array.isArray(filters.category) ? filters.category.filter(c => String(c).trim()) : (filters.category ? [filters.category] : []);
    if (cats.length) {
      const catClauses = [];
      for (const c of cats) { catClauses.push('(category LIKE ? OR raw_json LIKE ?)'); const q = `%${String(c).trim()}%`; params.push(q, q); }
      where.push(`(${catClauses.join(' OR ')})`);
    }
    // generic enum multi-select: fieldFilters = { 'top_follower_ages': ['25-34','35-44'], ... }
    // each selected value → raw_json match, OR'd together (AND across fields).
    // Prefer the key:"value" / key: value forms so "Male" never matches "Female".
    const fieldFilters = filters.fieldFilters && typeof filters.fieldFilters === 'object' ? filters.fieldFilters : {};
    for (const [key, values] of Object.entries(fieldFilters)) {
      const list = (Array.isArray(values) ? values : [values]).filter(v => String(v).trim());
      if (!list.length) continue;
      const clauses = [];
      for (const v of list) {
        const val = String(v).trim();
        // Prefix match on the JSON value: `"key":"val…`. Field isolation comes
        // from the key, so "Male" can never hit "Female". Values are stored in
        // short form (vertical category has its prefix stripped), so the
        // prefix match is exact for both.
        clauses.push(`raw_json LIKE ?`);
        params.push(`%"${key}":"${val}%`);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    // generic numeric multi-select: numericFieldFilters = { 'pps_score': [['3.5',null], [null,'3']], ... }
    // each tuple = [min, max] (null = unbounded), OR'd together (AND across fields)
    const numericFilters = filters.numericFieldFilters && typeof filters.numericFieldFilters === 'object' ? filters.numericFieldFilters : {};
    for (const [key, ranges] of Object.entries(numericFilters)) {
      const list = Array.isArray(ranges) ? ranges : [];
      if (!list.length) continue;
      const clauses = [];
      for (const pair of list) {
        const min = pair && pair[0] != null && pair[0] !== '' ? Number(pair[0]) : null;
        const max = pair && pair[1] != null && pair[1] !== '' ? Number(pair[1]) : null;
        if (min == null && max == null) continue;
        // raw_json stores text values (normalized), so extract + cast numerically
        const expr = `CAST(JSON_EXTRACT(raw_json, '$.${key}') AS REAL)`;
        if (min != null && max != null) { clauses.push(`(${expr} >= ? AND ${expr} < ?)`); params.push(min, max); }
        else if (min != null) { clauses.push(`${expr} >= ?`); params.push(min); }
        else { clauses.push(`${expr} < ?`); params.push(max); }
      }
      if (clauses.length) where.push(`(${clauses.join(' OR ')})`);
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }
  // distinct-ish value options for a given enum field (from raw_json text)
  async getFilterOptions(key) {
    try {
      const rows = await this.all(`SELECT raw_json FROM creators WHERE raw_json LIKE ?`, [`%"${key}"%`]);
      const seen = new Set(); const out = [];
      for (const r of rows) {
        let raw = {}; try { raw = JSON.parse(r.raw_json || '{}'); } catch (e) { }
        const v = raw[key];
        if (v === undefined || v === null || v === '') continue;
        for (const part of String(v).split(',')) {
          const t = part.trim();
          if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        }
      }
      return out.slice(0, 200);
    } catch (e) { return []; }
  }

  async listCreators(filters = {}) {
    const { clause, params } = this._buildWhere(filters);
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const sortable = new Set(['handle', 'nickname', 'creator_id', 'region', 'follower_count', 'total_gmv', 'units_sold', 'contact_email', 'last_publish_at', 'activity_status', 'last_refreshed_at']);
    const sortBy = sortable.has(filters.sortBy) ? filters.sortBy : 'last_refreshed_at';
    const sortDirection = String(filters.sortDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.all(
      `SELECT id, region, creator_id, handle, nickname, avatar_url, category, vertical_category,
              follower_count, total_gmv, units_sold, bio, contact_email, mcn,
              first_seen_at, last_refreshed_at, last_publish_at, activity_status, activity_reason, raw_json
       FROM creators ${clause}
       ORDER BY ${sortBy} ${sortDirection}, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const count = await this.get(`SELECT COUNT(*) AS count FROM creators ${clause}`, params);
    return {
      rows: rows.map(row => {
        let raw = {};
        try { raw = JSON.parse(row.raw_json || '{}'); } catch (e) { }
        const { raw_json: ignored, ...summary } = row;
        const merged = { ...raw, ...summary };
        // The library table shows TEXT only — turn every object/array value into
        // its display form (e.g. GPM ranges "$0.00 - $5.00", gender "Female: 79.47%").
        // Avatar is excluded: image URLs are heavy and not shown in the library.
        delete merged.avatar;
        delete merged.avatar_url;
        for (const key of Object.keys(merged)) {
          const v = merged[key];
          if (v && typeof v === 'object') merged[key] = normalizeValue(v);
        }
        return merged;
      }),
      total: count?.count || 0,
      limit,
      offset,
    };
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

  async listCreatorIds(filters = {}) {
    const where = [];
    const params = [];
    if (filters.region) { where.push('region = ?'); params.push(String(filters.region).toUpperCase()); }
    if (filters.search) { where.push('(handle LIKE ? OR nickname LIKE ? OR creator_id LIKE ? OR contact_email LIKE ?)'); const q = `%${String(filters.search).trim()}%`; params.push(q, q, q, q); }
    if (filters.hasEmail === true) where.push("contact_email IS NOT NULL AND contact_email <> ''");
    if (filters.activityStatus) { where.push('activity_status = ?'); params.push(String(filters.activityStatus)); }
    if (Number.isFinite(Number(filters.minFollowers))) { where.push('follower_count >= ?'); params.push(Number(filters.minFollowers)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.all(`SELECT creator_id FROM creators ${clause} ORDER BY id`, params);
    return rows.map(row => String(row.creator_id)).filter(Boolean);
  }

  async getStats() {
    const totals = await this.get(`
      SELECT COUNT(*) AS creators,
             SUM(CASE WHEN contact_email IS NOT NULL AND contact_email <> '' THEN 1 ELSE 0 END) AS with_email,
             COUNT(DISTINCT region) AS regions,
             SUM(CASE WHEN activity_status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
             MAX(last_refreshed_at) AS last_refreshed_at
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
