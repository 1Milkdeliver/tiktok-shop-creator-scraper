'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { WorkerProcessSupervisor } = require('../workers');
const { CreatorPersistence } = require('./creator-persistence');

// Fixture-only main-process integration boundary; intentionally not exposed
// through normal application IPC or renderer controls.
const INSTAGRAM_FIXTURE_PLATFORM = 'instagram';

function defaultWorkerPath() {
  return path.join(__dirname, '..', '..', 'runtime', 'python', 'workers', 'instagram_worker.py');
}

function waitForTerminal(supervisor, taskId, persistence, options) {
  return new Promise((resolve, reject) => {
    let persistChain = Promise.resolve();
    let persistenceError = null;
    const checkpoints = [];
    const onEvent = event => {
      if (event.taskId !== taskId) return;
      if (event.type === 'item') {
        persistChain = persistChain.then(async () => {
          const checkpoint = await persistence.persistItem(event, options);
          checkpoints.push(checkpoint);
          return checkpoint;
        }).catch(error => { persistenceError = error; });
        return;
      }
      if (event.type !== 'task.completed' && event.type !== 'task.failed') return;
      supervisor.off('event', onEvent);
      persistChain.then(() => {
        if (persistenceError) return reject(persistenceError);
        if (event.type === 'task.failed') {
          const error = new Error('Instagram fixture worker failed');
          error.code = event.payload?.code || 'INSTAGRAM_FIXTURE_FAILED';
          return reject(error);
        }
        resolve({ event, checkpoints });
      }, reject);
    };
    supervisor.on('event', onEvent);
  });
}

async function runInstagramFixtureCollection(options = {}) {
  const databaseManager = options.databaseManager;
  if (!databaseManager || typeof databaseManager.getRepository !== 'function') {
    throw new TypeError('databaseManager.getRepository is required');
  }
  const scenario = typeof options.scenario === 'string' && options.scenario ? options.scenario : 'profile';
  const region = String(options.region || 'GLOBAL').toUpperCase();
  const repository = await databaseManager.getRepository(INSTAGRAM_FIXTURE_PLATFORM);
  const taskId = options.taskId || `instagram-fixture-${crypto.randomUUID()}`;
  const jobId = await repository.createScrapeJob({
    platformId: INSTAGRAM_FIXTURE_PLATFORM,
    fixtureMode: true,
    fixtureScenario: scenario,
    shopRegion: region,
  });
  const persistence = new CreatorPersistence({ repository, platformId: INSTAGRAM_FIXTURE_PLATFORM });
  const workerPath = options.workerPath || defaultWorkerPath();
  const supervisor = options.supervisor || new WorkerProcessSupervisor({
    command: options.pythonCommand || process.env.PYTHON || 'python',
    args: [workerPath],
    cwd: options.workerCwd || path.dirname(workerPath),
    startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
  });

  try {
    const terminalPromise = waitForTerminal(supervisor, taskId, persistence, { region, jobId });
    await supervisor.start();
    supervisor.startTask({ taskId, platform: INSTAGRAM_FIXTURE_PLATFORM, payload: { fixtureMode: true, fixtureScenario: scenario } });
    const terminal = await terminalPromise;
    const inserted = terminal.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.payload.inserted, 0);
    const updated = terminal.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.payload.updated, 0);
    const result = { ok: true, creators: terminal.checkpoints.length, database: { saved: terminal.checkpoints.length, inserted, updated }, checkpoints: terminal.checkpoints };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    const result = { ok: false, creators: 0, database: { saved: 0 }, error: error.code || 'INSTAGRAM_FIXTURE_COLLECTION_FAILED' };
    await repository.finishScrapeJob(jobId, result).catch(() => {});
    throw error;
  } finally {
    await supervisor.shutdown().catch(() => {});
  }
}

module.exports = { INSTAGRAM_FIXTURE_PLATFORM, defaultWorkerPath, runInstagramFixtureCollection };
