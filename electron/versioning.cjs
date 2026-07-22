function versionParts(value) {
  return String(value || '0.0.0')
    .split(/[^\d]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function deviceUpdateState({ installedVersion, latestVersion, databaseSchemaVersion }) {
  const installed = String(installedVersion || '0.0.0');
  const latest = String(latestVersion || installed);
  return {
    installedVersion: installed,
    latestVersion: latest,
    databaseSchemaVersion: Number(databaseSchemaVersion) || 0,
    updateAvailable: compareVersions(latest, installed) > 0,
  };
}

module.exports = {
  compareVersions,
  deviceUpdateState,
  versionParts,
};
