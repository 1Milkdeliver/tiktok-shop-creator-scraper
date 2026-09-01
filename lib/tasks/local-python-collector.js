'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { WorkerProcessSupervisor } = require('../workers');
const { resolveWorkerEntrypoint } = require('../runtime/python-runtime');
const { CreatorPersistence } = require('./creator-persistence');

const LOCAL_PYTHON_PLATFORMS = new Set(['instagram', 'youtube', 'x']);

function waitForTerminal(supervisor, taskId, persistence, options) {
  return new Promise((resolve, reject) => {
    let chain = Promise.resolve();
    let persistError = null;
    const checkpoints = [];
    const onEvent = event => {
      if (event.taskId !== taskId) return;
      if (event.type === 'item') {
        chain = chain.then(async () => {
          const checkpoint = await persistence.persistItem(event, options);
          checkpoints.push(checkpoint);
        }).catch(error => { persistError = error; });
        return;
      }
      if (event.type === 'progress') {
        // Progress is intentionally forwarded without credentials or raw
        // response data. The desktop shell uses it for the live monitor wall.
        options.onProgress?.({
          platformId: options.platformId,
          taskId,
          state: 'running',
          ...event.payload,
        });
        return;
      }
      if (!['task.completed', 'task.failed'].includes(event.type)) return;
      supervisor.off('event', onEvent);
      chain.then(() => {
        if (persistError) return reject(persistError);
        if (event.type === 'task.failed') {
          const error = new Error('Local platform collection failed');
          error.code = event.payload?.code || 'LOCAL_COLLECTOR_FAILED';
          error.stage = typeof event.payload?.stage === 'string' ? event.payload.stage : null;
          return reject(error);
        }
        resolve(checkpoints);
      }, reject);
    };
    supervisor.on('event', onEvent);
  });
}

async function runLocalPythonCollection(options = {}) {
  const { platformId, databaseManager } = options;
  if (!LOCAL_PYTHON_PLATFORMS.has(platformId)) throw new TypeError('A supported local Python platform is required');
  if (!databaseManager || typeof databaseManager.getRepository !== 'function') throw new TypeError('databaseManager.getRepository is required');
  const region = String(options.region || 'GLOBAL').toUpperCase();
  const repository = await databaseManager.getRepository(platformId);
  const taskId = options.taskId || `${platformId}-${crypto.randomUUID()}`;
  const payload = { ...(options.payload || {}) };
  delete payload.brokerRef; // Account references are supplied only via auth.provide.
  const jobId = await repository.createScrapeJob({ platformId, shopRegion: region, collection: 'local-python', ...payload });
  const runtime = options.runtime || resolveWorkerEntrypoint(platformId, options.runtimeOptions || {});
  const supervisor = options.supervisor || new WorkerProcessSupervisor({
    command: options.pythonCommand || runtime.executable,
    args: [runtime.workerPath], cwd: path.dirname(runtime.workerPath), windowsHide: true,
    env: options.env,
    startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
  });
  try {
    const persistence = new CreatorPersistence({ repository, platformId });
    const terminal = waitForTerminal(supervisor, taskId, persistence, {
      region, jobId, platformId, discoveryMetadata: options.discoveryMetadata || null,
      onProgress: options.onProgress,
    });
    await supervisor.start();
    supervisor.startTask({ taskId, platform: platformId, payload });
    if (platformId === 'x' && typeof options.brokerRef === 'string' && options.brokerRef) {
      supervisor.provideAuth({ taskId, platform: platformId, payload: { brokerRef: options.brokerRef } });
    }
    const checkpoints = await terminal;
    const inserted = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.payload.inserted, 0);
    const updated = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.payload.updated, 0);
    const result = { ok: true, creators: checkpoints.length, database: { saved: checkpoints.length, inserted, updated }, checkpoints };
    await repository.finishScrapeJob(jobId, result);
    return result;
  } catch (error) {
    const result = { ok: false, creators: 0, database: { saved: 0 }, error: error.code || 'LOCAL_COLLECTOR_FAILED' };
    await repository.finishScrapeJob(jobId, result).catch(() => {});
    throw error;
  } finally {
    await supervisor.shutdown().catch(() => {});
  }
}

module.exports = { LOCAL_PYTHON_PLATFORMS, runLocalPythonCollection };
