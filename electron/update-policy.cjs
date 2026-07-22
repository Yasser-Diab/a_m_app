const { compareVersions } = require('./versioning.cjs');

function releaseVersion(release = {}) {
  const raw = String(release.tag_name || release.name || '').trim();
  const match = raw.match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : '';
}

function releaseUpdatePreflight({ installedVersion, release } = {}) {
  const installed = String(installedVersion || '0.0.0').replace(/^v/i, '');
  const latestVersion = releaseVersion(release);
  const releaseUrl = String(release?.html_url || '');
  if (!release || release.draft || release.prerelease || !latestVersion) {
    return {
      status: 'error',
      installedVersion: installed,
      latestVersion: '',
      releaseUrl,
      error: 'تعذر العثور على إصدار مستقر صالح لفحص التحديثات.',
    };
  }
  if (compareVersions(latestVersion, installed) <= 0) {
    return {
      status: 'current',
      installedVersion: installed,
      latestVersion,
      releaseUrl,
      updateAvailable: false,
      canInstall: false,
      error: '',
    };
  }
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const hasMetadata = assets.some(
    (asset) => String(asset?.name || '').toLowerCase() === 'latest.yml',
  );
  if (!hasMetadata) {
    return {
      status: 'error',
      installedVersion: installed,
      latestVersion,
      releaseUrl,
      updateAvailable: true,
      canInstall: false,
      error:
        'يتوفر إصدار أحدث، لكن ملفات التحديث التلقائي غير مكتملة. يرجى تنزيل الإصدار من صفحة الإصدارات أو المحاولة لاحقاً.',
    };
  }
  return {
    status: 'available',
    installedVersion: installed,
    latestVersion,
    releaseUrl,
    updateAvailable: true,
    canInstall: false,
    error: '',
  };
}

function friendlyUpdaterError(error) {
  const raw = String(error?.message || error || '');
  if (/latest\.yml|404|cannot find/i.test(raw)) {
    return 'ملفات التحديث التلقائي غير موجودة في الإصدار المنشور. لن يتأثر التطبيق الحالي؛ يرجى المحاولة بعد اكتمال نشر الإصدار.';
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|network|socket|timed?\s*out/i.test(raw)) {
    return 'تعذر الاتصال بخدمة التحديثات. تحقق من الإنترنت ثم أعد المحاولة.';
  }
  return 'تعذر فحص التحديثات حالياً. لم يتم تغيير الإصدار المثبت.';
}

module.exports = {
  friendlyUpdaterError,
  releaseUpdatePreflight,
  releaseVersion,
};
