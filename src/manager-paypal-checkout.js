const DEFAULT_API_BASE = "http://192.168.137.1:4181";
const MANAGER_RECEIVER_HOST = "manager.yasserdiab.site";

function cleanApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function defaultApiBaseForCurrentPage() {
  if (typeof location !== "undefined" && location.protocol === "https:") {
    return cleanApiBase(location.origin);
  }
  return DEFAULT_API_BASE;
}

function safeApiBaseForCurrentPage(value) {
  const clean = cleanApiBase(value);
  if (!clean) return defaultApiBaseForCurrentPage();
  try {
    const url = new URL(clean);
    if (
      typeof location !== "undefined" &&
      location.protocol === "https:" &&
      url.protocol === "http:"
    ) {
      return defaultApiBaseForCurrentPage();
    }
  } catch {
    return defaultApiBaseForCurrentPage();
  }
  return clean;
}

async function localRequest(apiBase = defaultApiBaseForCurrentPage(), path, options = {}) {
  const base = safeApiBaseForCurrentPage(apiBase);
  const body =
    options.body && typeof options.body !== "string"
      ? JSON.stringify(options.body)
      : options.body;
  const response = await fetch(`${base}${path}`, {
    ...options,
    body,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      response.ok
        ? "The payment server returned an unreadable response."
        : `Payment server error (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return data;
}

function resolveElement(target) {
  if (!target) return null;
  if (typeof target === "string") return document.querySelector(target);
  return target;
}

function clearElement(element) {
  resolveElement(element)?.replaceChildren();
}

function planPrice(plan, billingCycle) {
  const amount =
    billingCycle === "annually" || billingCycle === "yearly"
      ? plan?.annually ?? plan?.annual ?? plan?.yearly ?? plan?.monthly
      : plan?.monthly ?? plan?.amount ?? plan?.price;
  return Number(amount || 0);
}

function paypalSdkUrl(config = {}, currency = "USD", intent = "capture") {
  const clientId = config.client_id || config.clientId;
  let sdkUrl;
  try {
    sdkUrl = new URL(config.sdk_url || config.sdkUrl || "https://www.paypal.com/sdk/js");
  } catch {
    sdkUrl = new URL("https://www.paypal.com/sdk/js");
  }
  if (clientId) sdkUrl.searchParams.set("client-id", clientId);
  if (!sdkUrl.searchParams.get("client-id")) {
    throw new Error("Manager did not return PayPal SDK config.");
  }
  sdkUrl.searchParams.set("currency", config.currency || currency || "USD");
  sdkUrl.searchParams.set("intent", intent === "subscription" ? "subscription" : "capture");
  sdkUrl.searchParams.set(
    "components",
    intent === "subscription" ? "buttons" : "buttons,card-fields",
  );
  if (intent === "subscription") {
    sdkUrl.searchParams.set("vault", "true");
    sdkUrl.searchParams.delete("commit");
  } else {
    sdkUrl.searchParams.delete("vault");
    sdkUrl.searchParams.set("commit", "true");
    sdkUrl.searchParams.set("enable-funding", "card,credit,paylater,venmo");
  }
  return sdkUrl.toString();
}

function paypalClientConfigPath(currency, intent) {
  const query = new URLSearchParams({
    currency: currency || "USD",
    mode: intent === "subscription" ? "subscription" : "capture",
    intent,
  });
  return `/api/paypal/client-config?${query.toString()}`;
}

function validEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function loadPayPalSdk(src, isCancelled = () => false) {
  if (isCancelled()) return Promise.reject(new Error("PayPal checkout was replaced."));
  if (window.paypal && window.__managerPayPalSdkSrc === src) return Promise.resolve();
  document
    .querySelectorAll("script[data-manager-paypal-sdk]")
    .forEach((existing) => existing.remove());
  window.paypal = undefined;
  const generation = (window.__managerPayPalSdkGeneration || 0) + 1;
  window.__managerPayPalSdkGeneration = generation;
  window.__managerPayPalSdkSrc = src;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.managerPaypalSdk = "true";
    script.dataset.sdkIntegrationSource = "am-manager-v1.4.3";
    script.onload = () => {
      if (isCancelled() || window.__managerPayPalSdkGeneration !== generation) {
        reject(new Error("PayPal checkout was replaced."));
        return;
      }
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load PayPal checkout."));
    document.head.appendChild(script);
  });
}

export async function loadManagerSubscriptionConfig(apiBase = DEFAULT_API_BASE) {
  const gatewayData = await localRequest(apiBase, "/api/subscription/config").catch(
    () => null,
  );
  const [publicData, plansData] = gatewayData
    ? [gatewayData, { plans: gatewayData.plans || [] }]
    : await Promise.all([
        localRequest(apiBase, "/api/manager/public").catch(() => null),
        localRequest(apiBase, "/api/subscription/plans").catch(() => ({ plans: [] })),
      ]);
  return {
    company: null,
    access: null,
    subscription: null,
    plans: publicData?.plans || plansData?.plans || [],
    paypal: publicData?.paypal || publicData?.settings?.paypal || null,
    api: null,
    receiver: MANAGER_RECEIVER_HOST,
    source: publicData?.source || "",
  };
}

export async function loadManagerSubscriptionStatus(apiBase = DEFAULT_API_BASE) {
  return localRequest(apiBase, "/api/manager-subscription/status");
}

export async function loadManagerPayments(apiBase = DEFAULT_API_BASE) {
  const rows = await localRequest(apiBase, "/api/manager-payments").catch(() => []);
  return { payments: Array.isArray(rows) ? rows : rows?.payments || [] };
}

export async function renderManagerPayPalCheckout({
  apiBase = DEFAULT_API_BASE,
  buttonsContainer,
  cardContainer,
  cardSubmitButton,
  plan,
  billingCycle = "monthly",
  amount = planPrice(plan, billingCycle),
  currency = plan?.currency || "USD",
  customer = {},
  app = {},
  account = {},
  buttonColor = "blue",
  paymentMode = "recurring",
  onApproved,
  onError,
  isCancelled = () => false,
} = {}) {
  const buttonsHost = resolveElement(buttonsContainer);
  const cardHost = resolveElement(cardContainer);
  const submitButton = resolveElement(cardSubmitButton);
  if (!buttonsHost) return () => {};
  clearElement(buttonsHost);
  clearElement(cardHost);
  if (submitButton) {
    submitButton.hidden = true;
    submitButton.onclick = null;
  }
  if (!plan?.id) throw new Error("Choose a subscription plan first.");
  if (!Number(amount)) throw new Error("The selected subscription plan has no price.");

  const recurring = paymentMode === "recurring";
  const paypalIntent = recurring ? "subscription" : "capture";
  const publicConfig =
    (await localRequest(apiBase, paypalClientConfigPath(currency, paypalIntent), {
      method: "GET",
    }).catch(() => null)) ||
    (await localRequest(apiBase, "/api/subscription/config").catch(() => null)) ||
    (await localRequest(apiBase, "/api/manager/public").catch(() => null));
  const clientConfig =
    publicConfig?.paypal || publicConfig?.settings?.paypal || publicConfig || null;
  if (!clientConfig?.client_id && !clientConfig?.clientId && !clientConfig?.sdk_url) {
    throw new Error("PayPal credentials are not configured in the Manager app yet.");
  }
  if (isCancelled()) return () => {};
  const paypalConfig = clientConfig.paypal || clientConfig;
  await loadPayPalSdk(paypalSdkUrl(paypalConfig, currency, paypalIntent), isCancelled);
  if (isCancelled()) return () => {};
  const paypal = window.paypal;
  if (!paypal?.Buttons) throw new Error("PayPal buttons are not available.");

  const orderPayload = {
    plan_id: plan.id,
    plan_name: plan.name,
    billing_cycle: billingCycle === "annually" ? "yearly" : billingCycle,
    amount: Number(amount),
    currency,
    customer,
    account,
    app,
  };

  const createOrder = async () => {
    if (isCancelled()) throw new Error("PayPal checkout was replaced.");
    const data = await localRequest(apiBase, "/api/paypal/orders", {
      method: "POST",
      body: orderPayload,
    });
    const id = data.id || data.orderID || data.order_id || data.paypal_order_id;
    if (!id) throw new Error("Manager did not return a PayPal order id.");
    return id;
  };

  const approve = async (data) => {
    if (isCancelled()) return;
    const orderId = data.orderID || data.id;
    const capture = await localRequest(
      apiBase,
      `/api/paypal/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        body: { ...orderPayload, order_id: orderId },
      },
    );
    await onApproved?.(capture);
  };

  const prepareSubscriptionPlan = async () => {
    if (isCancelled()) throw new Error("PayPal checkout was replaced.");
    const data = await localRequest(apiBase, "/api/paypal/subscription-plan", {
      method: "POST",
      body: orderPayload,
    });
    const id =
      data.paypal_plan_id ||
      data.subscription_plan_id ||
      data.paypalPlanId ||
      data.subscriptionPlanId ||
      data.plan?.paypal_plan_id ||
      data.plan?.paypalPlanId ||
      data.plan_id ||
      data.id ||
      data.planId;
    if (!id) throw new Error("Manager did not return a PayPal subscription plan id.");
    if (!/^P-[A-Z0-9]+$/i.test(String(id))) {
      throw new Error(
        "Manager returned an invalid recurring plan. A real active PayPal billing plan is required.",
      );
    }
    const status = String(data.status || data.plan_status || "").toUpperCase();
    if (status && status !== "ACTIVE") {
      throw new Error(`The PayPal recurring plan is ${status.toLowerCase()}, not active.`);
    }
    return id;
  };

  const createSubscription = async (data, actions) => {
    const paypalPlanId = await prepareSubscriptionPlan();
    return actions.subscription.create({
      plan_id: paypalPlanId,
      custom_id: `${plan.id}:${orderPayload.billing_cycle}`,
      subscriber: validEmailAddress(customer.email)
        ? { email_address: String(customer.email).trim() }
        : undefined,
    });
  };

  const approveSubscription = async (data) => {
    if (isCancelled()) return;
    const subscriptionId = data.subscriptionID || data.subscriptionId || data.id;
    if (!subscriptionId) throw new Error("PayPal did not return a subscription id.");
    const activation = await localRequest(apiBase, "/api/paypal/subscriptions/activate", {
      method: "POST",
      body: { ...orderPayload, subscription_id: subscriptionId },
    });
    const activatedId =
      activation.subscription_id ||
      activation.provider_subscription_id ||
      activation.paypal_subscription?.id ||
      activation.paypalSubscription?.id ||
      activation.subscription?.provider_subscription_id ||
      activation.activatedSubscription?.provider_subscription_id;
    if (activatedId && String(activatedId) !== String(subscriptionId)) {
      throw new Error("Manager verified a different PayPal subscription id.");
    }
    const providerStatus = String(
      activation.provider_status ||
        activation.paypal_status ||
        activation.paypal_subscription?.status ||
        activation.paypalSubscription?.status ||
        "",
    ).toUpperCase();
    if (activation.verified !== true && providerStatus !== "ACTIVE") {
      throw new Error(
        "PayPal approved the request, but Manager could not verify an active recurring subscription.",
      );
    }
    await onApproved?.(activation);
  };

  const reportError = (error) => {
    if (
      isCancelled() ||
      String(error?.message || "").includes("PayPal checkout was replaced")
    ) {
      return;
    }
    onError?.(error);
  };

  const buttons = paypal.Buttons({
    style: {
      layout: "vertical",
      color: buttonColor === "gold" ? "gold" : "blue",
      shape: "rect",
      label: recurring ? "subscribe" : "paypal",
      height: 48,
    },
    ...(recurring
      ? { createSubscription, onApprove: approveSubscription }
      : { createOrder, onApprove: approve }),
    onCancel: () => {
      if (!isCancelled()) {
        onError?.(new Error("PayPal checkout was canceled before payment approval."));
      }
    },
    onError: reportError,
  });
  if (buttons.isEligible && !buttons.isEligible()) {
    throw new Error("PayPal checkout is not eligible for this account or payment mode.");
  }
  await buttons.render(buttonsHost);

  let cardFields = null;
  if (!recurring && paypal.CardFields?.isEligible?.() && cardHost && submitButton) {
    const fieldShell = document.createElement("div");
    fieldShell.className = "paypal-card-field-grid";
    const numberField = document.createElement("div");
    const expiryField = document.createElement("div");
    const cvvField = document.createElement("div");
    const nameField = document.createElement("div");
    for (const [className, element] of [
      ["paypal-card-field wide", numberField],
      ["paypal-card-field", expiryField],
      ["paypal-card-field", cvvField],
      ["paypal-card-field wide", nameField],
    ]) {
      element.className = className;
      fieldShell.appendChild(element);
    }
    cardHost.appendChild(fieldShell);
    cardFields = paypal.CardFields({
      createOrder,
      onApprove: approve,
      onError: reportError,
    });
    await Promise.all([
      cardFields.NumberField().render(numberField),
      cardFields.ExpiryField().render(expiryField),
      cardFields.CVVField().render(cvvField),
      cardFields.NameField().render(nameField),
    ]);
    submitButton.hidden = false;
    submitButton.onclick = () => {
      if (!isCancelled()) cardFields.submit();
    };
  }

  return () => {
    buttons.close?.();
    cardFields?.close?.();
    clearElement(buttonsHost);
    clearElement(cardHost);
    if (submitButton) {
      submitButton.hidden = true;
      submitButton.onclick = null;
    }
  };
}
