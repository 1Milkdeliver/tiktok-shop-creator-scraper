'use strict';
// Verification-only adapter. Never instantiate an updater or register install hooks.
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const { NsisUpdater } = require('electron-updater/out/NsisUpdater');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder');
const { CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME } = require('builder-util-runtime');

const quietLogger = { info() {}, warn() {}, error() {} };

function summarizePlan(oldMap, newMap) {
  const operations = computeOperations(oldMap, newMap, quietLogger);
  const copyBytes = operations.filter(op => op.kind === OperationKind.COPY)
    .reduce((sum, op) => sum + op.end - op.start, 0);
  const downloadBytes = operations.filter(op => op.kind === OperationKind.DOWNLOAD)
    .reduce((sum, op) => sum + op.end - op.start, 0);
  return { copyBytes, downloadBytes, newInstallerBytes: copyBytes + downloadBytes,
    reusePercent: Number((100 * copyBytes / (copyBytes + downloadBytes)).toFixed(2)),
    operationCount: operations.length,
    rangeOperationCount: operations.filter(op => op.kind === OperationKind.DOWNLOAD).length };
}

function createVerification({ executor, cacheDir, pendingDir, oldVersion, newVersion, fileInfo,
  strict = true, onProgress = () => {} }) {
  const host = {
    app: { version: oldVersion },
    httpExecutor: executor,
    downloadedUpdateHelper: { cacheDir, cacheDirForPendingUpdate: pendingDir },
    // Strict mode prohibits silently passing a failed differential test via full download.
    _testOnlyOptions: strict ? { isUseDifferentialDownload: true } : null,
    _logger: quietLogger,
    requestHeaders: {},
    listenerCount: () => 1,
    emit: (_event, progress) => onProgress(progress),
    differentialDownloadInstaller: AppUpdater.prototype.differentialDownloadInstaller,
  };
  const provider = new GitHubProvider({ provider: 'github', owner: '1Milkdeliver',
    repo: 'tiktok-shop-creator-scraper' }, host, { executor, platform: 'win32' });
  // File selection is explicit; getBlockMapFiles and range policy are the real provider's.
  provider.resolveFiles = () => [fileInfo];
  const options = { requestHeaders: {}, cancellationToken: new CancellationToken(),
    disableDifferentialDownload: false, disableWebInstaller: true,
    updateInfoAndProvider: { provider, info: { version: newVersion } } };
  return {
    options,
    provider,
    differential: destination => host.differentialDownloadInstaller(fileInfo, options,
      destination, provider, CURRENT_APP_INSTALLER_FILE_NAME),
    // Exercise actual NSIS download/fallback task only. No install/signature claim.
    downloadWithFallback: destination => NsisUpdater.prototype.doDownloadUpdate.call({ ...host,
      verifySignature: async () => null,
      executeDownload: ({ task }) => task(destination, { cancellationToken: options.cancellationToken,
        headers: {}, sha512: fileInfo.info.sha512 }, null, async () => {}),
    }, options),
  };
}

module.exports = { createVerification, summarizePlan, CURRENT_APP_INSTALLER_FILE_NAME };
