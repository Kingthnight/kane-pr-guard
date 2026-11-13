/**
 * Stand-in used only when kane-cli is not installed (or KANE_RUNNER=mock).
 * It drives the sample app over HTTP and writes NDJSON in the testmd shape
 * so the same parser and comment formatter run. It does not call Kane and
 * it does not invent a video or an evidence pack.
 */
import fs from "node:fs";
import path from "node:path";

const USER = { email: "test@example.com", password: "password123" };
const SHIPPING = {
  name: "Test User",
  address: "123 Test Street",
  city: "Testville",
  postal: "12345",
  email: "test@example.com",
  phone: "555-0100",
};

export async function runMockFlow({ flowPath, baseUrl, ndjsonPath, stderrPath }) {
  const name = path.basename(flowPath);
  let result;
  try {
    result = await checkFlow(name, baseUrl);
  } catch (error) {
    result = {
      ok: false,
      exitHint: 2,
      heading: name,
      remark: "mock runner could not reach the app",
      reason: error.message,
    };
  }
  fs.mkdirSync(path.dirname(ndjsonPath), { recursive: true });
  const events = mockEvents(name, result);
  fs.writeFileSync(ndjsonPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const note = result.ok
    ? "mock runner: kane-cli is not on PATH, so this flow was checked over HTTP.\n"
    : `mock runner: ${result.reason}\n`;
  fs.writeFileSync(stderrPath, note);
  if (result.exitHint) return result.exitHint;
  return result.ok ? 0 : 1;
}

async function checkFlow(name, baseUrl) {
  const request = browser(baseUrl);
  if (name === "login_test.md") return checkLogin(request);
  if (name === "add-to-cart_test.md") return checkCart(request);
  if (name === "checkout_test.md") return checkCheckout(request);
  if (name === "empty-cart-guard_test.md") return checkEmpty(request);
  return miss(name, `No mock check for ${name}`);
}

async function checkLogin(request) {
  const page = await follow(request, "GET", "/login");
  if (!page.text.includes('data-testid="login-email"') || !page.text.includes('data-testid="login-password"')) {
    return miss("Open the login page", "email or password field was not visible on the login page");
  }
  const bad = await follow(request, "POST", "/login", {
    email: USER.email,
    password: "wrong-password-xyz",
  });
  if (bad.text.includes('data-testid="dashboard-heading"')) {
    return miss("Case A — wrong password shows an error", "wrong password landed on the dashboard");
  }
  if (!/incorrect/i.test(bad.text) || !/password|credential/i.test(bad.text)) {
    return miss("Case A — wrong password shows an error", "wrong password did not show a visible credentials error");
  }
  const good = await follow(request, "POST", "/login", USER);
  if (!good.text.includes('data-testid="dashboard-heading"') || !good.text.includes(USER.email)) {
    return miss("Case B — valid user signs in and lands on the dashboard", "valid user did not land on the dashboard");
  }
  return { ok: true, heading: "Case B — valid user signs in and lands on the dashboard" };
}

async function checkCart(request) {
  await follow(request, "POST", "/login", USER);
  await follow(request, "POST", "/cart/items", { sku: "headphones" });
  const page = await follow(request, "POST", "/cart/items", { sku: "keyboard" });
  if (!page.text.includes('data-testid="cart-badge">2<')) {
    return miss("Add two items to the cart", "cart badge did not show 2");
  }
  return { ok: true, heading: "Add two items to the cart" };
}

async function checkCheckout(request) {
  await follow(request, "POST", "/login", USER);
  const added = await follow(request, "POST", "/cart/items", { sku: "headphones" });
  if (!/data-testid="cart-badge">[1-9]/.test(added.text)) {
    return miss("Add an item to the cart", "cart was still empty after adding an item");
  }
  const confirmation = await follow(request, "POST", "/checkout", SHIPPING);
  if (!confirmation.text.includes('data-testid="order-confirmation"') || !confirmation.text.includes('data-testid="order-number"')) {
    return miss("Fill shipping and place the order", "order confirmation did not show an order number");
  }
  if (!/KN-\d+/.test(confirmation.text)) {
    return miss("Fill shipping and place the order", "confirmation page had no order number");
  }
  return { ok: true, heading: "Fill shipping and place the order" };
}

async function checkEmpty(request) {
  await follow(request, "POST", "/login", USER);
  const cart = await follow(request, "GET", "/cart");
  if (!cart.text.includes("Your cart is empty")) {
    return miss("Ensure the cart is empty", "cart page did not show an empty-cart message");
  }
  const blocked = await follow(request, "GET", "/checkout");
  if (!blocked.text.includes('data-testid="checkout-blocked"') || !/Your cart is empty/i.test(blocked.text)) {
    return miss("Checkout is blocked", "empty cart did not show a checkout block message");
  }
  if (blocked.text.includes('data-testid="order-number"') || blocked.text.includes('data-testid="place-order"')) {
    return miss("Checkout is blocked", "empty cart still offered a way to place an order");
  }
  const posted = await follow(request, "POST", "/checkout", SHIPPING);
  if (posted.text.includes('data-testid="order-number"')) {
    return miss("Checkout is blocked", "posting checkout with an empty cart placed an order");
  }
  return { ok: true, heading: "Checkout is blocked" };
}

function miss(heading, remark) {
  return { ok: false, heading, remark, reason: remark };
}

function mockEvents(flow, result) {
  const ts = new Date().toISOString();
  const link = `https://test-manager.lambdatest.com/mock/${encodeURIComponent(flow)}`;
  const status = result.ok ? "passed" : "failed";
  const events = [
    { type: "stream_start", surface: "testmd", cli_version: "mock", v: 1, ts },
    { type: "test_md_step_end", status, heading: result.heading || flow, step: 1, v: 1, ts },
  ];
  if (!result.ok) {
    events.push({ step: 1, status: "failed", remark: result.remark, v: 1, ts });
  }
  events.push({
    type: "run_end",
    status,
    reason: result.ok ? "Objective completed" : result.reason,
    reason_code: result.ok ? "success.complete" : "assertion_error.final_verification",
    result_code: result.ok ? 100 : 710,
    test_url: link,
    duration: 0.1,
    v: 1,
    ts,
  });
  events.push({
    type: "test_md_done",
    overall_status: status,
    duration_s: 0.1,
    session_id: `mock-${flow}`,
    share_url: link,
    v: 1,
    ts,
  });
  return events;
}

function browser(baseUrl) {
  let cookie = "";
  return async function request(method, pathname, form) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form);
    }
    const response = await fetch(new URL(pathname, baseUrl), { method, headers, body, redirect: "manual" });
    const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of cookies) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("sid=")) cookie = pair === "sid=" ? "" : pair;
    }
    return {
      status: response.status,
      text: await response.text(),
      location: response.headers.get("location"),
    };
  };
}

async function follow(request, method, pathname, form) {
  let current = await request(method, pathname, form);
  for (let hop = 0; hop < 5 && current.status >= 300 && current.status < 400 && current.location; hop += 1) {
    current = await request("GET", current.location);
  }
  return current;
}
