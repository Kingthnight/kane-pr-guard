import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp, SEEDED_USER } from "../app/server.js";

async function start() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

function client(base) {
  let cookie = "";
  return async function request(method, pathname, form) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form);
    }
    const response = await fetch(new URL(pathname, base), { method, headers, body, redirect: "manual" });
    const setCookie = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
    for (const raw of setCookie) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("sid=")) cookie = pair;
      if (pair === "sid=") cookie = "";
    }
    const text = await response.text();
    return { status: response.status, text, location: response.headers.get("location") };
  };
}

async function follow(request, method, pathname, form) {
  let current = await request(method, pathname, form);
  for (let i = 0; i < 5 && current.status >= 300 && current.status < 400; i++) {
    current = await request("GET", current.location);
  }
  return current;
}

test("wrong password stays off the dashboard and shows an error", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    const page = await follow(request, "GET", "/");
    assert.match(page.text, /data-testid="login-email"/);
    assert.match(page.text, /data-testid="login-password"/);

    const failed = await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: "wrong-password-xyz",
    });
    assert.equal(failed.status, 401);
    assert.match(failed.text, /data-testid="login-error"/);
    assert.match(failed.text, /password you entered is incorrect/i);
    assert.match(failed.text, /value="test@example.com"/);
    assert.match(failed.text, /credentials/i);
    assert.doesNotMatch(failed.text, /data-testid="dashboard-heading"/);
    assert.doesNotMatch(failed.text, /data-testid="order-number"/);
  } finally {
    await app.close();
  }
});

test("valid user lands on the dashboard", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    const dashboard = await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /data-testid="dashboard-heading"/);
    assert.match(dashboard.text, /Dashboard/);
    assert.match(dashboard.text, new RegExp(SEEDED_USER.email));
    assert.match(dashboard.text, /data-testid="account-menu"/);
    assert.match(dashboard.text, /data-testid="cart-badge"/);
    assert.match(dashboard.text, /data-testid="cart-badge">0</);
  } finally {
    await app.close();
  }
});

test("adding two products makes the cart badge show 2", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const products = await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    assert.match(products.text, /data-testid="cart-badge">2</);
    assert.match(products.text, /data-testid="product-list"/);

    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /Wireless Headphones/);
    assert.match(cart.text, /Mechanical Keyboard/);
    assert.match(cart.text, /data-testid="checkout-link"/);
  } finally {
    await app.close();
  }
});

test("adding the same product twice still counts quantity 2", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const products = await follow(request, "POST", "/cart/items", { sku: "headphones" });
    assert.match(products.text, /data-testid="cart-badge">2</);
  } finally {
    await app.close();
  }
});

test("checkout collects shipping and shows an order number", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const confirmation = await follow(request, "POST", "/checkout", {
      name: "Test User",
      address: "123 Test Street",
      city: "Testville",
      postal: "12345",
      email: "test@example.com",
      phone: "555-0100",
    });
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.text, /data-testid="order-confirmation"/);
    assert.match(confirmation.text, /Order confirmation/);
    assert.match(confirmation.text, /Order number/);
    assert.match(confirmation.text, /data-testid="order-number">KN-1001</);
    assert.match(confirmation.text, /data-testid="cart-badge">0</);
  } finally {
    await app.close();
  }
});

test("checkout with an empty cart is blocked and does not place an order", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /data-testid="cart-empty"/);
    assert.match(cart.text, /Your cart is empty/);
    assert.match(cart.text, /data-testid="cart-badge">0</);

    const blocked = await follow(request, "GET", "/checkout");
    assert.match(blocked.text, /data-testid="checkout-blocked"/);
    assert.match(blocked.text, /Your cart is empty/);
    assert.match(blocked.text, /cannot continue until items are added/);
    assert.doesNotMatch(blocked.text, /data-testid="order-number"/);
    assert.doesNotMatch(blocked.text, /data-testid="place-order"/);

    const posted = await follow(request, "POST", "/checkout", {
      name: "Test User",
      address: "123 Test Street",
      city: "Testville",
      postal: "12345",
      email: "test@example.com",
      phone: "555-0100",
    });
    assert.equal(posted.status, 422);
    assert.match(posted.text, /data-testid="checkout-blocked"/);
    assert.doesNotMatch(posted.text, /data-testid="order-number"/);

    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    const confirmation = await follow(request, "POST", "/checkout", {
      name: "Test User",
      address: "123 Test Street",
      city: "Testville",
      postal: "12345",
      email: "test@example.com",
      phone: "555-0100",
    });
    assert.match(confirmation.text, /data-testid="order-number">KN-1001</);
  } finally {
    await app.close();
  }
});

test("items can be removed until the cart is empty", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await follow(request, "POST", "/login", {
      email: SEEDED_USER.email,
      password: SEEDED_USER.password,
    });
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const emptied = await follow(request, "POST", "/cart/items/remove", { sku: "headphones" });
    assert.match(emptied.text, /Your cart is empty/);
    assert.match(emptied.text, /data-testid="cart-badge">0</);
  } finally {
    await app.close();
  }
});
