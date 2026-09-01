'use strict';

// Platform-neutral lifecycle owner. Adapters run native workflows; this class
// supplies one consistent task boundary for the desktop process and future
// platform implementations.
const TASK_STATES = Object.freeze({
  IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped', DONE: 'done', ERROR: 'error',
});

const TASK_ERROR_CODES = Object.freeze({
  INVALID_PLATFORM: 'INVALID_PLATFORM',
  TASK_ALREADY_ACTIVE: 'TASK_ALREADY_ACTIVE',
  NO_ACTIVE_TASK: 'NO_ACTIVE_TASK',
  TASK_NOT_PAUSED: 'TASK_NOT_PAUSED',
  ADAPTER_OPERATION_FAILED: 'ADAPTER_OPERATION_FAILED',
});

class TaskSupervisorError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'TaskSupervisorError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

class TaskSupervisor {
  constructor({ adapters = {} } = {}) {
    this.adapters = new Map(Object.entries(adapters));
    this.activeTask = null;
    this.lastTask = null;
  }

  register(platformId, adapter) { this.adapters.set(platformId, adapter); return this; }

  start(platformId, config) {
    if (this._isActive()) throw new TaskSupervisorError(TASK_ERROR_CODES.TASK_ALREADY_ACTIVE, 'A task is already active');
    const adapter = this.adapters.get(platformId);
    if (!adapter) throw new TaskSupervisorError(TASK_ERROR_CODES.INVALID_PLATFORM, `No adapter registered for ${platformId}`);

    const task = this.activeTask = { platformId, adapter, state: TASK_STATES.RUNNING, error: null, startedAt: Date.now() };
    let run;
    try { run = Promise.resolve(adapter.start(config)); }
    catch (error) { run = Promise.reject(error); }
    task.promise = run.then(
      (result) => { this._finish(task, result); return result; },
      (error) => { this._fail(task, error); throw error; },
    );
    // Callers historically fire-and-forget MultiRunner.start(), so return the
    // completion promise while publishing running synchronously above.
    return task.promise;
  }

  pause() { return this._control('pause', TASK_STATES.RUNNING, TASK_STATES.PAUSED); }
  resume() { return this._control('resume', TASK_STATES.PAUSED, TASK_STATES.RUNNING); }
  async resumeWithRefresh() {
    const task = this._requireActive();
    if (task.state !== TASK_STATES.PAUSED) throw new TaskSupervisorError(TASK_ERROR_CODES.TASK_NOT_PAUSED, 'The active task is not paused');
    try {
      if (typeof task.adapter.resumeWithRefresh === 'function') await task.adapter.resumeWithRefresh();
      else task.adapter.resume();
      task.state = TASK_STATES.RUNNING;
      return this.status();
    } catch (error) { throw new TaskSupervisorError(TASK_ERROR_CODES.ADAPTER_OPERATION_FAILED, 'Unable to resume task', error); }
  }
  stop() {
    const task = this._requireActive();
    try { task.adapter.stop(); task.state = TASK_STATES.STOPPED; return this.status(); }
    catch (error) { throw new TaskSupervisorError(TASK_ERROR_CODES.ADAPTER_OPERATION_FAILED, 'Unable to stop task', error); }
  }
  status() {
    const task = this.activeTask || this.lastTask;
    return task ? { platformId: task.platformId, state: task.state, error: task.error, startedAt: task.startedAt, finishedAt: task.finishedAt || null, active: this._isActive() } : { platformId: null, state: TASK_STATES.IDLE, error: null, startedAt: null, finishedAt: null, active: false };
  }
  _isActive() { return !!this.activeTask && [TASK_STATES.RUNNING, TASK_STATES.PAUSED, TASK_STATES.STOPPED].includes(this.activeTask.state); }
  _requireActive() { if (!this._isActive()) throw new TaskSupervisorError(TASK_ERROR_CODES.NO_ACTIVE_TASK, 'There is no active task'); return this.activeTask; }
  _control(method, expected, next) {
    const task = this._requireActive();
    if (task.state !== expected) return this.status();
    try { task.adapter[method](); task.state = next; return this.status(); }
    catch (error) { throw new TaskSupervisorError(TASK_ERROR_CODES.ADAPTER_OPERATION_FAILED, `Unable to ${method} task`, error); }
  }
  _finish(task, result) { if (this.activeTask !== task) return; task.state = TASK_STATES.DONE; task.result = result; task.finishedAt = Date.now(); this.lastTask = task; this.activeTask = null; }
  _fail(task, error) { if (this.activeTask !== task) return; task.state = TASK_STATES.ERROR; task.error = { code: error.code || TASK_ERROR_CODES.ADAPTER_OPERATION_FAILED, message: error.message }; task.finishedAt = Date.now(); this.lastTask = task; this.activeTask = null; }
}

module.exports = { TaskSupervisor, TaskSupervisorError, TASK_STATES, TASK_ERROR_CODES };
