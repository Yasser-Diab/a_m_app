const crypto = require("node:crypto");
const {normalizeArabic} = require("./domain.cjs");

const CAPABILITIES = [
  "view", "create", "edit_draft", "import", "create_master", "manage_settings",
  "view_collections", "manage_collections", "submit", "approve", "issue", "revise", "export", "view_audit",
];
const parse = (value, fallback = null) => value ? JSON.parse(value) : fallback;
const encode = (value) => JSON.stringify(value);
const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone: "Africa/Cairo", dateStyle: "short"}).format(new Date());
const idOf = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const isAdmin = (row) => Boolean(row?.is_active) && ["admin", "manager"].includes(String(row.role).toLowerCase());

function str(value, limit = 600) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, limit) : "";
}

function lookup(value) {
  return normalizeArabic(str(value).replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x669 ? 0x660 : 0x6f0))));
}

function fail(status, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.extra = extra;
  throw error;
}

function date(value, optional = false) {
  const input = str(value, 20);
  if (!input && optional) return null;
  const parsed = new Date(input + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== input)
    fail(400, "Enter a valid calendar date");
  return input;
}

function currency(value) {
  const input = str(value).toUpperCase() || "EGP";
  if (!/^[A-Z]{3}$/.test(input)) fail(400, "Currency must be a three-letter code");
  return input;
}

function setting(database, key, fallback) {
  return database.get("SELECT value FROM app_settings WHERE key = ?", [key])?.value ?? fallback;
}

function setSetting(database, key, value) {
  database.run("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)", [key, value]);
}

function initializeSessionSecret(database) {
  if (!setting(database, "certificates_session_secret"))
    setSetting(database, "certificates_session_secret", crypto.randomBytes(48).toString("hex"));
}

function featureEnabled(database) {
  return process.env.AM_CERTIFICATES_ENABLED !== "0" && setting(database, "certificates_enabled", "1") === "1";
}

function hmac(database, user, encoded) {
  return crypto.createHmac("sha256", setting(database, "certificates_session_secret"))
    .update(user.pin_hash).update(".").update(encoded).digest();
}

function issueCertificateSession(database, user) {
  const body = Buffer.from(encode({uid: user.id, expiry: Date.now() + 14 * 864e5,
    nonce: crypto.randomBytes(16).toString("hex")})).toString("base64url");
  return body + "." + hmac(database, user, body).toString("base64url");
}

function certificateSessionUser(database, req) {
  try {
    const token = (req.get("authorization") || "").match(/^Bearer ([\w.-]{20,768})$/i)?.[1];
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;
    const claims = parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!idOf(claims?.uid) || !Number.isFinite(claims.expiry) || claims.expiry <= Date.now() ||
        !/^[a-f0-9]{32}$/.test(claims.nonce)) return null;
    const user = database.get("SELECT * FROM users WHERE id = ? AND is_active = 1", [claims.uid]);
    if (!user?.pin_hash) return null;
    const sig = Buffer.from(signature, "base64url");
    const expected = hmac(database, user, encoded);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    if (database.get("SELECT 1 FROM cert_revoked_sessions WHERE nonce = ?", [claims.nonce])) return null;
    return {...user, certificateClaims: claims};
  } catch {
    return null;
  }
}

function revokeCertificateSession(database, req) {
  const user = certificateSessionUser(database, req);
  if (!user) return;
  const {nonce, expiry} = user.certificateClaims;
  database.transaction(() => {
    database.run("DELETE FROM cert_revoked_sessions WHERE expiry <= ?", [Date.now()]);
    database.run("INSERT OR IGNORE INTO cert_revoked_sessions (nonce,expiry) VALUES (?,?)", [nonce, expiry]);
  });
}

function getGrant(database, userId) {
  const row = database.get("SELECT * FROM cert_access WHERE user_id = ?", [userId]);
  return {
    capabilities: parse(row?.grants_json, []),
    all_projects: Boolean(row?.all_projects),
    allow_project_creation: Boolean(row?.allow_project_creation),
    project_ids: row ? database.all("SELECT project_id FROM cert_project_grants WHERE user_id = ?", [userId])
      .map(({project_id}) => project_id) : [],
  };
}

function audit(database, user, action, {projectId = null, revisionId = null, reason = "", details = null} = {}) {
  database.run(`
    INSERT INTO cert_audit (project_id,revision_id,actor_id,action,reason,details_json) VALUES (?,?,?,?,?,?)
  `, [projectId, revisionId, user?.id || null, action, str(reason, 2000), details === null ? null : encode(details)]);
}

function setGrant(database, requester, userId, input) {
  if (!database.get("SELECT id FROM users WHERE id = ?", [userId])) fail(404, "User not found");
  const capabilities = Array.isArray(input.capabilities)
    ? [...new Set(input.capabilities.map((value) => str(value).replace(/^certificates\./, "")))] : [];
  if (capabilities.some((value) => !CAPABILITIES.includes(value))) fail(400, "Unknown certificate capability");
  if (capabilities.some((value) => value !== "view") && !capabilities.includes("view"))
    fail(400, "Certificate viewing is required for other certificate permissions");
  const projectIds = Array.isArray(input.project_ids) ? [...new Set(input.project_ids.map(idOf))] : [];
  if (projectIds.length > 2000 || projectIds.some((id) =>
    !id || !database.get("SELECT 1 FROM cert_projects WHERE id = ?", [id]))) fail(400, "Invalid project scope");
  return database.transaction(() => {
    const before = getGrant(database, userId);
    database.run(`INSERT INTO cert_access (user_id,grants_json,all_projects,allow_project_creation)
      VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET grants_json=excluded.grants_json,
      all_projects=excluded.all_projects,allow_project_creation=excluded.allow_project_creation`,
    [userId, encode(capabilities), input.all_projects === true ? 1 : 0, input.allow_project_creation === true ? 1 : 0]);
    database.run("DELETE FROM cert_project_grants WHERE user_id = ?", [userId]);
    for (const id of projectIds) database.run("INSERT INTO cert_project_grants VALUES (?,?)", [userId, id]);
    const after = getGrant(database, userId);
    audit(database, requester, "permissions_changed", {details: {user_id: userId, before, after}});
    return after;
  });
}

function scopeSql(grant, column = "project_id") {
  if (grant.all_projects) return {clause: "1=1", params: []};
  return {clause: `${column} IN (SELECT project_id FROM cert_project_grants WHERE user_id = ?)`,
    params: [grant.user.id]};
}

function inScope(grant, projectId) {
  return grant.all_projects || grant.project_ids.includes(projectId);
}

function accessFor(database, req) {
  const user = certificateSessionUser(database, req);
  if (!user) fail(401, "Sign in again to access certificates");
  const enabled = featureEnabled(database);
  return {...getGrant(database, user.id), user, enabled, can_admin: isAdmin(user)};
}

function authorize(database, req, capability, projectId = null) {
  const access = accessFor(database, req);
  if (!access.enabled) fail(403, "Progress certificates are disabled for this company");
  if (!access.capabilities.includes("view") || !access.capabilities.includes(capability))
    fail(403, `Permission required: certificates.${capability}`);
  if (projectId !== null && !inScope(access, projectId)) fail(404, "Project not found");
  return access;
}

function adminAccess(database, req) {
  const access = accessFor(database, req);
  if (!access.can_admin) fail(403, "Manager access is required");
  return access;
}

module.exports = {CAPABILITIES, parse, encode, now, today, idOf, isAdmin, str, lookup, fail, date,
  currency, setting, setSetting, initializeSessionSecret, featureEnabled, issueCertificateSession,
  certificateSessionUser, revokeCertificateSession, getGrant, audit, setGrant, scopeSql, inScope,
  accessFor, authorize, adminAccess};
