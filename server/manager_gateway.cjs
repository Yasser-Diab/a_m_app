const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MANAGER_RECEIVER = "manager.yasserdiab.site";
const MANAGER_PUBLIC_BASE_URL =
  process.env.AM_MANAGER_BASE_URL ||
  process.env.AM_MANAGER_URL ||
  `https://${MANAGER_RECEIVER}`;
const MANAGER_LOCAL_BASE_URL =
  process.env.AM_MANAGER_LOCAL_URL || "http://127.0.0.1:4295";
const MANAGER_PUBLIC_INGEST_URL =
  process.env.AM_MANAGER_INGEST_URL ||
  `${MANAGER_PUBLIC_BASE_URL.replace(/\/$/, "")}/api/ingest/account`;
const MANAGER_LOCAL_INGEST_URL =
  process.env.AM_MANAGER_LOCAL_INGEST_URL ||
  `${MANAGER_LOCAL_BASE_URL.replace(/\/$/, "")}/api/ingest/account`;

const FALLBACK_PLAN_NAMES = {
  starter: "Starter",
  team: "Team",
  company: "Company",
};

function normalizeText(value) {
  return String(value ?? "").trim();
}

function cleanUrl(value) {
  return normalizeText(value).replace(/\/$/, "");
}

function readSetting(database, key, fallback = "") {
  try {
    const row = database.get("SELECT value FROM app_settings WHERE key = ?", [key]);
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(database, key, value) {
  database.run(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    [key, String(value ?? "")],
  );
}

function readJsonSetting(database, key, fallback) {
  try {
    const raw = readSetting(database, key, "");
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonSetting(database, key, value) {
  writeSetting(database, key, JSON.stringify(value));
}

function ensureInstallId(database) {
  const current = normalizeText(readSetting(database, "install_id", ""));
  if (current) return current;
  const next = `am-${crypto.randomBytes(12).toString("hex")}`;
  writeSetting(database, "install_id", next);
  return next;
}

function safeAll(database, sql, params = []) {
  try {
    return database.all(sql, params);
  } catch {
    return [];
  }
}

function safeGet(database, sql, params = []) {
  try {
    return database.get(sql, params) || {};
  } catch {
    return {};
  }
}

function readManagerToken() {
  const candidates = [
    path.join("D:\\manager_app", "data", "manager-ingest-token.txt"),
    process.env.AM_MANAGER_TOKEN_FILE,
    process.env.MANAGER_INGEST_TOKEN_FILE,
    path.join(process.cwd(), ".manager-token"),
    path.join(process.cwd(), "manager-token.txt"),
    path.join(os.homedir(), ".accounting-management-manager-token"),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        const token = fs.readFileSync(candidate, "utf8").trim();
        if (token) return token;
      }
    } catch {
      // Ignore unreadable optional token files.
    }
  }
  const direct = normalizeText(
    process.env.AM_MANAGER_TOKEN ||
      process.env.AM_MANAGER_INGEST_TOKEN ||
      process.env.MANAGER_INGEST_TOKEN,
  );
  if (direct) return direct;
  return "";
}

function requireManagerToken() {
  const token = readManagerToken();
  if (!token) {
    throw new Error(
      "Manager ingest token is missing. Set AM_MANAGER_TOKEN or place the token file at D:\\manager_app\\data\\manager-ingest-token.txt.",
    );
  }
  return token;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function managerRequest(url, options = {}) {
  const { requiresToken, ...fetchOptions } = options || {};
  const token = requiresToken === false ? "" : requireManagerToken();
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: "application/json",
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(token
        ? {
            "X-Manager-Token": token,
            Authorization: `Bearer ${token}`,
          }
        : {}),
      ...(fetchOptions.headers || {}),
    },
  });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Manager HTTP ${response.status}`);
  }
  return data;
}

function companyPayload(database) {
  const profile = readJsonSetting(database, "company_profile", {});
  const branding = readJsonSetting(database, "report_branding", {});
  const name =
    normalizeText(profile.company_name) ||
    normalizeText(branding.companyNameEn) ||
    normalizeText(branding.companyNameAr) ||
    "Accounting Management";
  return {
    external_key: normalizeText(profile.external_key) || name,
    name,
    company_name_en: normalizeText(branding.companyNameEn) || name,
    company_name_ar: normalizeText(branding.companyNameAr),
    contact_name: normalizeText(profile.contact_name),
    owner_name: normalizeText(profile.contact_name),
    owner_email: normalizeText(profile.email),
    owner_phone: normalizeText(profile.phone),
    email: normalizeText(profile.email),
    phone: normalizeText(profile.phone),
    address: normalizeText(profile.address || profile.company_address),
    billing_address: normalizeText(profile.address || profile.company_address),
    website: normalizeText(profile.website || profile.company_website),
    notes: normalizeText(profile.notes),
    status: "active",
    support_status: "ok",
  };
}

function appIdentityPayload(database, options = {}) {
  const installId = ensureInstallId(database);
  const localApiUrl =
    typeof options.defaultPort === "function"
      ? `http://127.0.0.1:${options.defaultPort()}`
      : "";
  return {
    name: "Accounting Management",
    version: options.appVersion || "",
    variant: process.env.AM_APP_VARIANT || process.env.VITE_APP_VARIANT || "main",
    install_id: installId,
    instance_key: installId,
    local_api_url: localApiUrl,
    public_app_url: normalizeText(process.env.AM_PUBLIC_APP_URL),
    platform: process.platform,
    hostname: os.hostname(),
    environment: process.env.NODE_ENV || "production",
  };
}

function managerIdentity(database, options = {}) {
  return {
    account: companyPayload(database),
    app: appIdentityPayload(database, options),
  };
}

function payloadWithManagerIdentity(database, options = {}, body = {}) {
  const identity = managerIdentity(database, options);
  return {
    ...(body || {}),
    account: {
      ...identity.account,
      ...(body?.account || {}),
      external_key: identity.account.external_key,
      name: identity.account.name,
    },
    app: {
      ...identity.app,
      ...(body?.app || {}),
      install_id: identity.app.install_id,
      instance_key: identity.app.instance_key,
    },
  };
}

function usersPayload(database) {
  return safeAll(
    database,
    `SELECT id, username, display_name, role, is_active,
            can_create_invoices, can_create_payments, can_change_status,
            last_login_at, last_seen_at, created_at
       FROM users
      ORDER BY role = 'admin' DESC, role = 'manager' DESC, display_name COLLATE NOCASE`,
  ).map((user) => ({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    is_active: !!Number(user.is_active),
    can_create_invoices: !!Number(user.can_create_invoices),
    can_create_payments: !!Number(user.can_create_payments),
    can_change_status: !!Number(user.can_change_status),
    last_login_at: user.last_login_at,
    last_seen_at: user.last_seen_at,
    created_at: user.created_at,
  }));
}

function statsPayload(database) {
  return {
    users: safeGet(database, "SELECT COUNT(*) AS count FROM users")?.count || 0,
    documents:
      safeGet(database, "SELECT COUNT(*) AS count FROM documents")?.count || 0,
    work_items:
      safeGet(database, "SELECT COUNT(*) AS count FROM work_items")?.count || 0,
    payments:
      safeGet(database, "SELECT COUNT(*) AS count FROM payments")?.count || 0,
    subscriptions:
      safeGet(database, "SELECT COUNT(*) AS count FROM subscriptions")?.count || 0,
    accounting_payments:
      safeGet(
        database,
        "SELECT COUNT(*) AS count FROM active_work_items WHERE accounting_status = 'تحصيل'",
      )?.count || 0,
    accounting_discounts:
      safeGet(
        database,
        "SELECT COUNT(*) AS count FROM active_work_items WHERE accounting_status = 'خصم'",
      )?.count || 0,
  };
}

function recentAccountingPayments(database) {
  return safeAll(
    database,
    `SELECT document_id, operation_no, accounting_status, base_party_name,
            customer_display_name, entry_date, ROUND(net_total, 2) AS amount,
            created_at
       FROM active_work_items
      WHERE accounting_status IN ('تحصيل', 'خصم')
      ORDER BY COALESCE(entry_date, created_at) DESC, id DESC
      LIMIT 50`,
  ).map((row) => ({
    document_id: row.document_id,
    reference: row.operation_no,
    type: row.accounting_status,
    party: row.customer_display_name || row.base_party_name,
    amount: Math.abs(Number(row.amount || 0)),
    signed_amount: Number(row.amount || 0),
    currency: "EGP",
    date: row.entry_date || row.created_at,
  }));
}

function diagnosticsPayload(database, options = {}) {
  const stats = statsPayload(database);
  return {
    reason: normalizeText(options.reason) || "manual sync",
    generated_at: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      uptime_seconds: Math.round(process.uptime()),
    },
    stats,
  };
}

function accountPayload(database, options = {}) {
  const identity = managerIdentity(database, options);
  const diagnostics = diagnosticsPayload(database, options);
  const payments = recentAccountingPayments(database);
  return {
    ...identity,
    users: usersPayload(database),
    stats: diagnostics.stats,
    payments,
    metadata: {
      receiver: MANAGER_RECEIVER,
      diagnostics,
      recent_payments: payments,
    },
    logs: [
      {
        type: "system",
        title: "App sync",
        details: `Accounting Management sent account, users, stats, diagnostics, and ${payments.length} recent payment row(s).`,
        created_by: "Accounting Management",
        created_at: diagnostics.generated_at,
        metadata: diagnostics,
      },
    ],
    generated_at: diagnostics.generated_at,
  };
}

function candidateIngestUrls() {
  return [...new Set([MANAGER_PUBLIC_INGEST_URL, MANAGER_LOCAL_INGEST_URL].filter(Boolean))];
}

function baseUrlFromUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function candidateManagerBaseUrls() {
  return [
    MANAGER_PUBLIC_BASE_URL,
    baseUrlFromUrl(MANAGER_PUBLIC_INGEST_URL),
    MANAGER_LOCAL_BASE_URL,
    baseUrlFromUrl(MANAGER_LOCAL_INGEST_URL),
  ]
    .map(cleanUrl)
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index);
}

async function syncAccountToManager(database, options = {}) {
  const payload = accountPayload(database, options);
  let lastError = null;
  for (const url of candidateIngestUrls()) {
    try {
      const data = await managerRequest(url, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = {
        ok: true,
        receiver: MANAGER_RECEIVER,
        endpoint: url,
        data,
        synced_at: new Date().toISOString(),
      };
      writeJsonSetting(database, "manager_ingest_response", result);
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not sync account with manager.");
}

function responseRoot(data) {
  if (!data || typeof data !== "object") return {};
  return data.data && typeof data.data === "object" ? data.data : data;
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const id = normalizeText(plan.id || plan.plan_id || plan.slug || plan.name).toLowerCase();
  if (!id) return null;
  const monthly = Number(plan.monthly ?? plan.monthly_price ?? plan.price ?? plan.amount ?? 0);
  const annually = Number(
    plan.annually ?? plan.annual ?? plan.yearly ?? plan.yearly_price ?? monthly * 12,
  );
  return {
    id,
    name: normalizeText(plan.name || FALLBACK_PLAN_NAMES[id] || id),
    users: Number(plan.users ?? plan.max_users ?? plan.seats ?? 1),
    monthly,
    annually,
    currency: normalizeText(plan.currency || "USD") || "USD",
    description: normalizeText(plan.description),
  };
}

function extractPlans(data) {
  const root = responseRoot(data);
  const plans =
    root.plans ||
    root.subscription_plans ||
    root.subscriptionPlans ||
    root.subscription?.plans ||
    root.subscription_config?.plans ||
    root.config?.plans ||
    root.payment?.plans ||
    root.payments?.plans ||
    [];
  return Array.isArray(plans) ? plans.map(normalizePlan).filter(Boolean) : [];
}

function extractPayPal(data) {
  const root = responseRoot(data);
  const paypal =
    root.paypal ||
    root.payPal ||
    root.payment?.paypal ||
    root.payments?.paypal ||
    root.subscription_config?.paypal ||
    root.config?.paypal ||
    root.settings?.paypal ||
    (root.client_id || root.clientId || root.sdk_url || root.sdkUrl ? root : {}) ||
    {};
  return {
    enabled: paypal.enabled !== false,
    client_id: normalizeText(paypal.client_id || paypal.clientId),
    merchant_id: normalizeText(paypal.merchant_id || paypal.merchantId),
    currency: normalizeText(paypal.currency || root.currency || "USD") || "USD",
    receiver: normalizeText(paypal.receiver || root.receiver || MANAGER_RECEIVER),
    environment: normalizeText(paypal.environment || root.environment),
    sdk_url: normalizeText(paypal.sdk_url || paypal.sdkUrl || root.sdk_url),
  };
}

function extractManagerName(data) {
  const root = responseRoot(data);
  const server = root.server && typeof root.server === "object" ? root.server : {};
  const settings = root.settings && typeof root.settings === "object" ? root.settings : {};
  const account = root.account && typeof root.account === "object" ? root.account : {};
  const named = normalizeText(
    root.manager_name ||
      root.managerName ||
      root.receiver_name ||
      root.receiverName ||
      root.businessName ||
      root.business_name ||
      root.sellerName ||
      root.seller_name ||
      root.name ||
      server.managerName ||
      server.receiverName ||
      server.businessName ||
      settings.managerName ||
      settings.businessName ||
      settings.sellerName ||
      account.name,
  );
  if (named) return named;
  if (root.ingestEndpoint || root.localIngestEndpoint || root.tokenRequired !== undefined) {
    return "Accounting Management Manager";
  }
  return "";
}

function configFromManagerData(data) {
  const paypal = extractPayPal(data);
  const managerName = extractManagerName(data);
  return {
    receiver: managerName || paypal.receiver || MANAGER_RECEIVER,
    manager_name: managerName,
    plans: extractPlans(data),
    paypal,
    source: responseRoot(data)?.source || "manager",
  };
}

function fallbackConfig(database) {
  const storedPlans = readJsonSetting(database, "subscription_plans", []);
  const settings = readJsonSetting(database, "manager_settings", {});
  const managerName = normalizeText(settings.businessName || settings.sellerName);
  return {
    receiver: managerName || MANAGER_RECEIVER,
    manager_name: managerName,
    plans: Array.isArray(storedPlans) ? storedPlans.map(normalizePlan).filter(Boolean) : [],
    paypal: {
      enabled: false,
      client_id: "",
      merchant_id: "",
      currency: "USD",
      receiver: MANAGER_RECEIVER,
      environment: "",
      sdk_url: "",
    },
    source: "local-fallback",
  };
}

async function fetchManagerConfig(database, options = {}) {
  const paths = [
    { path: "/api/receiver", requiresToken: false },
    { path: "/api/subscription/config" },
    { path: "/api/paypal/client-config" },
    { path: "/api/paypal/config" },
    { path: "/api/public/subscription-config", requiresToken: false },
  ];
  let lastError = null;
  let bestConfig = null;
  for (const base of candidateManagerBaseUrls()) {
    for (const item of paths) {
      try {
        const data = await managerRequest(`${base}${item.path}`, {
          requiresToken: item.requiresToken,
        });
        const config = configFromManagerData(data);
        bestConfig = {
          receiver: config.receiver || bestConfig?.receiver || MANAGER_RECEIVER,
          manager_name: config.manager_name || bestConfig?.manager_name || "",
          plans: config.plans.length ? config.plans : bestConfig?.plans || [],
          paypal: config.paypal.client_id ? config.paypal : bestConfig?.paypal || config.paypal,
          source: config.source || bestConfig?.source || "manager",
        };
        if (bestConfig.plans.length && bestConfig.paypal?.client_id) return bestConfig;
      } catch (error) {
        lastError = error;
      }
    }
  }
  if (bestConfig?.plans?.length || bestConfig?.paypal?.client_id) return bestConfig;
  try {
    const synced = await syncAccountToManager(database, options);
    const config = configFromManagerData(synced.data);
    if (config.plans.length || config.paypal.client_id) return config;
  } catch (error) {
    lastError = error;
  }
  const cached = readJsonSetting(database, "manager_ingest_response", null);
  if (cached?.data) {
    const config = configFromManagerData(cached.data);
    if (config.plans.length || config.paypal.client_id) return config;
  }
  const fallback = fallbackConfig(database);
  if (!fallback.plans.length && lastError) fallback.warning = lastError.message;
  return fallback;
}

async function fetchManagerSubscriptionStatus(database, options = {}) {
  const { account, app } = managerIdentity(database, options);
  const query = new URLSearchParams({
    external_key: account.external_key || "",
    install_id: app.install_id || "",
    account_name: account.name || "",
  });
  let lastError = null;
  for (const base of candidateManagerBaseUrls()) {
    try {
      const status = await managerRequest(`${base}/api/subscription/status?${query.toString()}`);
      writeJsonSetting(database, "manager_subscription_status", {
        fetched_at: new Date().toISOString(),
        source: base,
        status,
      });
      return status;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not load subscription status from manager.");
}

function cachedManagerData(database) {
  const cached = readJsonSetting(database, "manager_ingest_response", null);
  const data = responseRoot(cached?.data || {});
  const managerName = extractManagerName(data);
  return {
    receiver: managerName || MANAGER_RECEIVER,
    manager_name: managerName,
    synced_at: cached?.synced_at || "",
    company: data,
    payments: Array.isArray(data.payments) ? data.payments : [],
    subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
  };
}

function registerManagerGatewayRoutes(app, database, options = {}) {
  app.post("/api/manager-sync", async (req, res) => {
    try {
      const result = await syncAccountToManager(database, options);
      res.json({
        ok: true,
        receiver: result.receiver,
        synced_at: result.synced_at,
        payments: Array.isArray(responseRoot(result.data).payments)
          ? responseRoot(result.data).payments
          : [],
        subscriptions: Array.isArray(responseRoot(result.data).subscriptions)
          ? responseRoot(result.data).subscriptions
          : [],
      });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.get("/api/subscription/config", async (req, res) => {
    try {
      res.json(await fetchManagerConfig(database, options));
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.get("/api/manager-subscription/status", async (req, res) => {
    try {
      res.json(await fetchManagerSubscriptionStatus(database, options));
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.get("/api/manager-payments", async (req, res) => {
    res.json(cachedManagerData(database));
  });

  app.get("/api/paypal/client-config", async (req, res) => {
    try {
      const query = new URLSearchParams();
      if (req.query.currency) query.set("currency", normalizeText(req.query.currency));
      if (req.query.mode) query.set("mode", normalizeText(req.query.mode));
      if (req.query.intent) query.set("intent", normalizeText(req.query.intent));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      for (const base of candidateManagerBaseUrls()) {
        try {
          return res.json(
            await managerRequest(`${base}/api/paypal/client-config${suffix}`),
          );
        } catch {
          // Fall back to the merged config below.
        }
      }
      const config = await fetchManagerConfig(database, options);
      if (config.paypal?.client_id) {
        return res.json({ paypal: config.paypal });
      }
      res.status(502).json({
        error:
          config.warning || "PayPal credentials are not configured in the Manager app yet.",
      });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  app.post("/api/paypal/subscription-plan", async (req, res) => {
    const payload = payloadWithManagerIdentity(database, options, req.body || {});
    let lastError = null;
    for (const base of candidateManagerBaseUrls()) {
      try {
        return res.json(
          await managerRequest(`${base}/api/paypal/subscription-plan`, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        );
      } catch (error) {
        lastError = error;
      }
    }
    res.status(502).json({ error: lastError?.message || "Could not prepare recurring PayPal subscription." });
  });

  app.post("/api/paypal/orders", async (req, res) => {
    const payload = payloadWithManagerIdentity(database, options, req.body || {});
    const paths = ["/api/paypal/orders", "/api/paypal/create-order", "/api/payments/paypal/orders"];
    let lastError = null;
    for (const base of candidateManagerBaseUrls()) {
      for (const item of paths) {
        try {
          return res.json(
            await managerRequest(`${base}${item}`, {
              method: "POST",
              body: JSON.stringify(payload),
            }),
          );
        } catch (error) {
          lastError = error;
        }
      }
    }
    res.status(502).json({ error: lastError?.message || "Could not create PayPal order." });
  });

  app.post("/api/paypal/orders/:orderID/capture", async (req, res) => {
    const orderID = normalizeText(req.params.orderID);
    const payload = payloadWithManagerIdentity(database, options, {
      ...(req.body || {}),
      order_id: orderID,
    });
    const paths = [
      `/api/paypal/orders/${encodeURIComponent(orderID)}/capture`,
      `/api/payments/paypal/orders/${encodeURIComponent(orderID)}/capture`,
      "/api/paypal/capture-order",
    ];
    let lastError = null;
    for (const base of candidateManagerBaseUrls()) {
      for (const item of paths) {
        try {
          const capture = await managerRequest(`${base}${item}`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          const cached = readJsonSetting(database, "manager_paypal_captures", []);
          writeJsonSetting(database, "manager_paypal_captures", [
            { captured_at: new Date().toISOString(), order_id: orderID, capture },
            ...(Array.isArray(cached) ? cached : []).slice(0, 49),
          ]);
          return res.json(capture);
        } catch (error) {
          lastError = error;
        }
      }
    }
    res.status(502).json({ error: lastError?.message || "Could not capture PayPal order." });
  });

  app.post("/api/paypal/subscriptions/activate", async (req, res) => {
    const payload = payloadWithManagerIdentity(database, options, req.body || {});
    let lastError = null;
    for (const base of candidateManagerBaseUrls()) {
      try {
        const activation = await managerRequest(`${base}/api/paypal/subscriptions/activate`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const cached = readJsonSetting(database, "manager_paypal_subscriptions", []);
        writeJsonSetting(database, "manager_paypal_subscriptions", [
          { activated_at: new Date().toISOString(), activation },
          ...(Array.isArray(cached) ? cached : []).slice(0, 49),
        ]);
        return res.json(activation);
      } catch (error) {
        lastError = error;
      }
    }
    res.status(502).json({ error: lastError?.message || "Could not activate PayPal subscription." });
  });

  app.post("/api/subscription/cancel", async (req, res) => {
    const payload = payloadWithManagerIdentity(database, options, req.body || {});
    let lastError = null;
    for (const base of candidateManagerBaseUrls()) {
      try {
        return res.json(
          await managerRequest(`${base}/api/subscription/cancel`, {
            method: "POST",
            body: JSON.stringify(payload),
          }),
        );
      } catch (error) {
        lastError = error;
      }
    }
    res.status(502).json({ error: lastError?.message || "Could not cancel subscription." });
  });

}

module.exports = {
  MANAGER_RECEIVER,
  MANAGER_PUBLIC_INGEST_URL,
  MANAGER_LOCAL_INGEST_URL,
  registerManagerGatewayRoutes,
  syncAccountToManager,
};
