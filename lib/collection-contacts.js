'use strict';
const {MARKETS} = require('./partner-contacts');

// One contact consumer per seller run. Admission happens AFTER the base write
// commits; neither its network requests nor retry delays hold the database gate.
class CollectionContacts {
  constructor({config, db, client, job, isPaused = () => false, isCanceled = () => false}) {
    this.config = config; this.db = db; this.job = job; this.examined = new Set();
    this.region = String(config?.shopRegion || 'US').toUpperCase();
    this.outcome = config?.enrichContacts !== true ? 'disabled'
      : config.testMode || !config.databaseJobId || !db ? 'skipped'
      : !Object.hasOwn(MARKETS, this.region) ? 'unsupported'
      : !client ? 'needs_auth' : 'streaming';
    if (this.outcome === 'streaming') job.startStream({client, db, region:this.region, isPaused, isCanceled});
  }
  snapshot() { return {outcome:this.outcome, region:this.region}; }
  async saved(rows, config) {
    if (this.outcome !== 'streaming' || !this.job.state.running || !this.job.input?.open
        || config.databaseJobId !== this.config.databaseJobId
        || String(config.shopRegion || 'US').toUpperCase() !== this.region) return;
    const ids = [...new Set(rows.map(row => String(row.creator_oecuid || '')).filter(id => /^\d{1,30}$/.test(id) && !this.examined.has(id)))];
    if (!ids.length) return;
    const pending = await this.db.contactTargets({}, this.region, true, config.databaseJobId, ids);
    this.job.append(pending);
    ids.forEach(id => this.examined.add(id));
  }
  finish(result) {
    if (this.outcome !== 'streaming') return;
    if (!result?.ok || result.testMode || result.database?.error) this.job.stop();
    else this.job.closeInput();
  }
  stop() { if (this.outcome === 'streaming') this.job.stop(); }
}

// Serialize page, detail and periodic writes from concurrent seller sessions.
// A rejected transaction must not poison subsequent flushes or overlap BEGIN.
function serializeCreatorWrites(write) {
  let pending = Promise.resolve();
  return (...args) => {
    const result = pending.then(() => write(...args));
    pending = result.catch(() => {});
    return result;
  };
}
function contactDatabase(db, write) {
  const adapter = Object.create(db);
  for (const name of ['updateCreatorContacts','markContactPending','updatePartnerProfile'])
    adapter[name] = (...args) => write(() => db[name](...args));
  return adapter;
}
module.exports = {CollectionContacts, serializeCreatorWrites, contactDatabase};
