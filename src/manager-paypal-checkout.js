const DEFAULT_API_BASE = "http://192.168.137.1:4181";

function cleanApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function localRequest(apiBase = DEFAULT_API_BASE, path, options = {}) {
  const base = cleanApiBase(apiBase) || DEFAULT_API_BASE;
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
  const data = text ? JSON.parse(text) : null;
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
  if (config.sdk_url || config.sdkUrl) return config.sdk_url || config.sdkUrl;
  const clientId = config.client_id || config.clientId;
  if (!clientId) throw new Error("Manager did not return PayPal SDK config.");
  const sdkUrl = new URL("https://www.paypal.com/sdk/js");
  sdkUrl.searchParams.set("client-id", clientId);
  sdkUrl.searchParams.set("currency", config.currency || currency || "USD");
  sdkUrl.searchParams.set("intent", intent === "subscription" ? "subscription" : "capture");
  sdkUrl.searchParams.set(
    "components",
    intent === "subscription" ? "buttons" : "buttons,card-fields",
  );
  sdkUrl.searchParams.set("enable-funding", "card,credit,paylater,venmo");
  if (intent === "subscription") sdkUrl.searchParams.set("vault", "true");
  return sdkUrl.toString();
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
    script.dataset.sdkIntegrationSource = "am-manager-v1.4.1";
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
  const [publicData, plansData] = await Promise.all([
    localRequest(apiBase, "/api/manager/public").catch(() => null),
    localRequest(apiBase, "/api/subscription/plans").catch(() => ({ plans: [] })),
  ]);
  return {
    company: null,
    access: null,
    subscription: null,
    plans: publicData?.plans || plansData?.plans || [],
    paypal: null,
    api: null,
  };
}

export async function loadManagerSubscriptionStatus(apiBase = DEFAULT_API_BASE) {
  return localRequest(apiBase, "/api/subscription/status");
}

export async function loadManagerPayments(apiBase = DEFAULT_API_BASE) {
  const rows = await localRequest(apiBase, "/api/payments").catch(() => []);
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
  const publicConfig = await localRequest(apiBase, "/api/manager/public").catch(() => null);
  const clientConfig = publicConfig?.paypal || publicConfig?.settings?.paypal || null;
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
    const data = await localRequest(apiBase, "/api/payments/create-checkout", {
      method: "POST",
      body: orderPayload,
    });
    const id = data.id || data.orderID || data.order_id;
    if (!id) throw new Error("Manager did not return a PayPal order id.");
    return id;
  };

  const approve = async (data) => {
    if (isCancelled()) return;
    const orderId = data.orderID || data.id;
    const capture = await localRequest(
      apiBase,
      "/api/payments/paypal/capture",
      {
        method: "POST",
        body: { ...orderPayload, order_id: orderId },
      },
    );
    await onApproved?.(capture);
  };

  let preparedSubscription = null;
  const prepareSubscriptionPlan = async () => {
    if (isCancelled()) throw new Error("PayPal checkout was replaced.");
    throw new Error("Recurring PayPal subscription checkout is not configured in the local Manager yet.");
  };

  const createSubscription = async (data, actions) => {
    const paypalPlanId = await prepareSubscriptionPlan();
    return actions.subscription.create({
      plan_id: paypalPlanId,
      custom_id: `${plan.id}:${orderPayload.billing_cycle}`,
      subscriber: customer.email ? { email_address: customer.email } : undefined,
    });
  };

  const approveSubscription = async (data) => {
    if (isCancelled()) return;
    const subscriptionId = data.subscriptionID || data.subscriptionId || data.id;
    if (!subscriptionId) throw new Error("PayPal did not return a subscription id.");
    await onApproved?.({ subscription_id: subscriptionId });
  };

  const reportError = (error) => {
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
    onError: reportError,
  });
  if (!buttons.isEligible || buttons.isEligible()) {
    await buttons.render(buttonsHost);
  }

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
