function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function uniqueServerUrls(values = []) {
  return [...new Set(values.map(cleanApiBase).filter(Boolean))];
}

function isLoopbackServerUrl(value) {
  try {
    const host = new URL(cleanApiBase(value)).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function inferConnectionMode(serverUrl, requestedMode = '', localServerUrls = []) {
  if (requestedMode === 'local' || requestedMode === 'remote') return requestedMode;
  const clean = cleanApiBase(serverUrl);
  if (!clean) return 'local';
  if (isLoopbackServerUrl(clean)) return 'local';
  if (uniqueServerUrls(localServerUrls).includes(clean)) return 'local';
  return 'remote';
}

function startupConnectionPlan(settings = {}, fallbackCandidates = []) {
  const serverUrl = cleanApiBase(settings.serverUrl || settings.apiBase);
  const connectionMode = inferConnectionMode(
    serverUrl,
    settings.connectionMode,
    settings.localServerUrls,
  );
  const remotePinned = connectionMode === 'remote' && !!serverUrl;
  return {
    connectionMode,
    serverUrl,
    remotePinned,
    startLocalServer: !remotePinned && settings.startServerOnLaunch !== false,
    candidates: remotePinned
      ? [serverUrl]
      : uniqueServerUrls([serverUrl, ...fallbackCandidates]),
  };
}

module.exports = {
  cleanApiBase,
  inferConnectionMode,
  isLoopbackServerUrl,
  startupConnectionPlan,
  uniqueServerUrls,
};
