'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const {
  JsonLinesParser, WorkerEventOrder, ProtocolError, createMessage, encodeMessage,
} = require('./protocol');

const ERROR_CODES = Object.freeze({
  SPAWN_FAILED: 'WORKER_SPAWN_FAILED',
  STARTUP_TIMEOUT: 'WORKER_STARTUP_TIMEOUT',
  PROTOCOL_ERROR: 'WORKER_PROTOCOL_ERROR',
  UNEXPECTED_EXIT: 'WORKER_UNEXPECTED_EXIT',
  COMMAND_FAILED: 'WORKER_COMMAND_FAILED',
  SHUTDOWN_TIMEOUT: 'WORKER_SHUTDOWN_TIMEOUT',
});

class WorkerSupervisorError extends Error {
  constructor(code, message) {
    // Child-process provider errors can contain headers or session values.
    // Keep the public error intentionally context-free.
    super(message);
    this.name = 'WorkerSupervisorError';
    this.code = code;
  }
}

function redactText(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:[?&]|\b)(?:token|access_token|refresh_token|password|secret)=)[^&\s]+/gi, '$1[REDACTED]');
}

class WorkerProcessSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    if (typeof options.command !== 'string' || options.command.trim() === '') {
      throw new TypeError('WorkerProcessSupervisor requires a non-empty command');
    }
    this.command = options.command;
    this.args = options.args || [];
    this.cwd = options.cwd;
    this.env = options.env;
    this.spawnProcess = options.spawnProcess || spawn;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.killTimeoutMs = options.killTimeoutMs ?? 1_000;
    this.redact = options.redact || redactText;
    this.child = null;
    this.commandSeq = 0;
    this.events = new WorkerEventOrder();
    this.parser = new JsonLinesParser({ direction: 'event' });
    this.ready = false;
    this.closing = false;
    this.startPromise = null;
    this.startResolve = null;
    this.startReject = null;
    this.startupTimer = null;
    this.shutdownTimer = null;
  }

  get running() { return Boolean(this.child && !this.child.exitCode && !this.child.killed); }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.child) throw new WorkerSupervisorError(ERROR_CODES.COMMAND_FAILED, 'worker has already been started');
    this.startPromise = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      try {
        this.child = this.spawnProcess(this.command, this.args, {
          cwd: this.cwd,
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        this._failStart(new WorkerSupervisorError(ERROR_CODES.SPAWN_FAILED, 'unable to launch worker process', error));
        return;
      }
      this._attachChild(this.child);
      this.startupTimer = setTimeout(() => {
        this._failStart(new WorkerSupervisorError(ERROR_CODES.STARTUP_TIMEOUT, 'worker did not become ready before the startup timeout'));
        this._terminate();
      }, this.startupTimeoutMs);
      this._send('hello', { payload: {} });
    });
    return this.startPromise;
  }

  startTask({ taskId, platform, payload = {} }) {
    return this._command('task.start', { taskId, platform, payload });
  }

  cancelTask({ taskId, platform, payload = {} }) {
    return this._command('task.cancel', { taskId, platform, payload });
  }

  provideAuth({ taskId, platform, payload = {} }) {
    return this._command('auth.provide', { taskId, platform, payload });
  }

  ping(payload = {}) { return this._command('ping', { payload }); }

  async shutdown() {
    if (!this.child) return;
    this.closing = true;
    try { this._send('shutdown', { payload: {} }); } catch (_) { /* process is already gone */ }
    await new Promise(resolve => {
      if (!this.child) return resolve();
      const onStopped = () => resolve();
      this.once('stopped', onStopped);
      this.shutdownTimer = setTimeout(() => {
        this.off('stopped', onStopped);
        this.emit('warning', { code: ERROR_CODES.SHUTDOWN_TIMEOUT, message: 'worker did not exit after shutdown command' });
        this._terminate();
        setTimeout(resolve, this.killTimeoutMs);
      }, this.shutdownTimeoutMs);
    });
  }

  _command(type, fields) {
    if (!this.ready) throw new WorkerSupervisorError(ERROR_CODES.COMMAND_FAILED, 'worker is not ready');
    return this._send(type, fields);
  }

  _send(type, fields) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new WorkerSupervisorError(ERROR_CODES.COMMAND_FAILED, 'worker stdin is unavailable');
    }
    const message = createMessage(type, { ...fields, seq: this.commandSeq++ });
    this.child.stdin.write(encodeMessage(message));
    return message;
  }

  _attachChild(child) {
    child.once('error', error => {
      const wrapped = new WorkerSupervisorError(ERROR_CODES.SPAWN_FAILED, 'worker process failed to start', error);
      this._failStart(wrapped);
      this._emitFault(wrapped);
    });
    child.stdout.on('data', chunk => this._handleStdout(chunk));
    child.stderr.on('data', chunk => {
      const text = this.redact(chunk.toString('utf8'));
      if (text) this.emit('stderr', text);
    });
    child.once('exit', (code, signal) => this._handleExit(code, signal));
  }

  _handleStdout(chunk) {
    try {
      for (const event of this.parser.push(chunk)) {
        this.events.observe(event);
        if (event.type === 'worker.ready') {
          this.ready = true;
          clearTimeout(this.startupTimer);
          this.startResolve?.(event);
          this.startResolve = null;
          this.startReject = null;
        }
        this.emit('event', event);
        this.emit(event.type, event);
      }
    } catch (error) {
      const wrapped = new WorkerSupervisorError(ERROR_CODES.PROTOCOL_ERROR, `worker emitted an invalid protocol event: ${error.message}`, error);
      this._failStart(wrapped);
      this._emitFault(wrapped);
      this._terminate();
    }
  }

  _handleExit(code, signal) {
    clearTimeout(this.startupTimer);
    clearTimeout(this.shutdownTimer);
    try { this.parser.end(); } catch (error) { this._emitFault(new WorkerSupervisorError(ERROR_CODES.PROTOCOL_ERROR, error.message, error)); }
    const wasReady = this.ready;
    this.child = null;
    this.ready = false;
    this.emit('stopped', { code, signal });
    if (!this.closing) {
      const error = new WorkerSupervisorError(
        ERROR_CODES.UNEXPECTED_EXIT,
        `worker exited unexpectedly${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`,
      );
      if (!wasReady) this._failStart(error);
      this._emitFault(error);
    }
  }

  _terminate() {
    const child = this.child;
    if (!child || child.killed) return;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (this.child === child && !child.killed) child.kill('SIGKILL');
    }, this.killTimeoutMs).unref?.();
  }

  _failStart(error) {
    clearTimeout(this.startupTimer);
    if (!this.startReject) return;
    this.startReject(error);
    this.startResolve = null;
    this.startReject = null;
  }

  _emitFault(error) {
    this.emit('fault', error);
  }
}

module.exports = { ERROR_CODES, WorkerSupervisorError, WorkerProcessSupervisor, redactText };
