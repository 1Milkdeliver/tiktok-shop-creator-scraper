'use strict';
const {MARKETS} = require('./partner-contacts');

// An explicit task option, never a global library-filter or email gate. The
// base run owns admission to the library; this stage only patches saved rows.
async function startCollectionContacts({config, result, db, client, job, isCanceled = () => false}) {
  if (config?.enrichContacts !== true) return {outcome:'disabled'};
  if (isCanceled() || !result?.ok || result.testMode || result.database?.error || !config.databaseJobId || !db)
    return {outcome:'skipped'};
  const region = String(config.shopRegion || 'US').toUpperCase();
  if (!Object.hasOwn(MARKETS, region)) return {outcome:'unsupported', region};
  const targets = await db.contactTargets({}, region, true, config.databaseJobId);
  if (isCanceled()) return {outcome:'skipped'};
  if (!targets.length) return {outcome:'complete', total:0, region};
  if (!client) return {outcome:'needs_auth', total:targets.length, region};
  job.start({client, db, region, targets, mode:'contacts', resume:true});
  return {outcome:'started', total:targets.length, region};
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
module.exports = {startCollectionContacts, serializeCreatorWrites};
