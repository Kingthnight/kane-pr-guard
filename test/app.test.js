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

const SHIPPING = {
  name: "Test User",
  address: "123 Test Street",
  city: "Testville",
  postal: "12345",
  email: "test@example.com",
  phone: "555-0100",
};

async function signIn(request) {
  return follow(request, "POST", "/login", {
    email: SEEDED_USER.email,
    password: SEEDED_USER.password,
  });
}

test("the cart shows a subtotal and a promo field before a code is applied", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /data-testid="promo-code"/);
    assert.match(cart.text, /data-testid="apply-promo"/);
    assert.match(cart.text, /Promo code/);
    assert.match(cart.text, />Apply</);
    assert.match(cart.text, /data-testid="subtotal">\$208\.00</);
    assert.match(cart.text, /data-testid="total-due">\$208\.00</);
    assert.doesNotMatch(cart.text, /data-testid="discount-amount"/);
    assert.doesNotMatch(cart.text, /data-testid="promo-error"/);

    const checkout = await follow(request, "GET", "/checkout");
    assert.match(checkout.text, /data-testid="subtotal">\$208\.00</);
    assert.match(checkout.text, /data-testid="total-due">\$208\.00</);
    assert.match(checkout.text, /data-testid="shipping-form"/);
    assert.doesNotMatch(checkout.text, /data-testid="discount-amount"/);
  } finally {
    await app.close();
  }
});

test("an invalid promo code shows an error and leaves the total unchanged", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    const cart = await follow(request, "POST", "/cart/promo", { promo: "BOGUS" });
    assert.equal(cart.status, 200);
    assert.match(cart.text, /data-testid="promo-error"/);
    assert.match(cart.text, /Invalid promo code\./);
    assert.match(cart.text, /value="BOGUS"/);
    assert.match(cart.text, /data-testid="subtotal">\$208\.00</);
    assert.match(cart.text, /data-testid="total-due">\$208\.00</);
    assert.doesNotMatch(cart.text, /data-testid="discount-amount"/);
    assert.doesNotMatch(cart.text, /\$20\.80/);
    assert.doesNotMatch(cart.text, /\$187\.20/);
  } finally {
    await app.close();
  }
});

test("SAVE10 takes 10% off and applying it again does not stack", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    const applied = await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });
    assert.match(applied.text, /Promo code SAVE10 applied/);
    assert.match(applied.text, /data-testid="applied-promo">SAVE10</);
    assert.match(applied.text, /data-testid="subtotal">\$208\.00</);
    assert.match(applied.text, /data-testid="discount-amount">\$20\.80</);
    assert.match(applied.text, /data-testid="total-due">\$187\.20</);
    assert.doesNotMatch(applied.text, /\$41\.60/);
    assert.doesNotMatch(applied.text, /\$166\.40/);

    const again = await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });
    assert.match(again.text, /data-testid="discount-amount">\$20\.80</);
    assert.match(again.text, /data-testid="total-due">\$187\.20</);
    assert.doesNotMatch(again.text, /\$41\.60/);
    assert.doesNotMatch(again.text, /\$166\.40/);
  } finally {
    await app.close();
  }
});

test("save10 is accepted, and a later invalid code does not clear it", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    const applied = await follow(request, "POST", "/cart/promo", { promo: "save10" });
    assert.match(applied.text, /data-testid="applied-promo">SAVE10</);
    assert.match(applied.text, /data-testid="total-due">\$187\.20</);

    const rejected = await follow(request, "POST", "/cart/promo", { promo: "BOGUS" });
    assert.match(rejected.text, /Invalid promo code\./);
    assert.match(rejected.text, /data-testid="applied-promo">SAVE10</);
    assert.match(rejected.text, /data-testid="discount-amount">\$20\.80</);
    assert.match(rejected.text, /data-testid="total-due">\$187\.20</);
  } finally {
    await app.close();
  }
});

test("removing an item keeps SAVE10 and recalculates the discount", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    await follow(request, "POST", "/cart/promo", { promo: "SaVe10" });
    const cart = await follow(request, "POST", "/cart/items/remove", { sku: "keyboard" });
    assert.match(cart.text, /Wireless Headphones/);
    assert.doesNotMatch(cart.text, /Mechanical Keyboard/);
    assert.match(cart.text, /data-testid="applied-promo">SAVE10</);
    assert.match(cart.text, /data-testid="subtotal">\$79\.00</);
    assert.match(cart.text, /data-testid="discount-amount">\$7\.90</);
    assert.match(cart.text, /data-testid="total-due">\$71\.10</);
    assert.doesNotMatch(cart.text, /\$20\.80/);
    assert.doesNotMatch(cart.text, /\$187\.20/);
  } finally {
    await app.close();
  }
});

test("emptying the cart drops SAVE10 so the next item is full price", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });
    const emptied = await follow(request, "POST", "/cart/items/remove", { sku: "headphones" });
    assert.match(emptied.text, /Your cart is empty/);
    assert.doesNotMatch(emptied.text, /SAVE10/);
    assert.doesNotMatch(emptied.text, /data-testid="promo-form"/);

    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /data-testid="promo-code" value=""/);
    assert.doesNotMatch(cart.text, /data-testid="applied-promo"/);
    assert.doesNotMatch(cart.text, /data-testid="discount-amount"/);
    assert.doesNotMatch(cart.text, /\$7\.90/);
    assert.doesNotMatch(cart.text, /\$71\.10/);
    assert.match(cart.text, /data-testid="subtotal">\$79\.00</);
    assert.match(cart.text, /data-testid="total-due">\$79\.00</);
  } finally {
    await app.close();
  }
});

test("checkout and the confirmation show the same discounted total", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    await follow(request, "POST", "/cart/items", { sku: "keyboard" });
    await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });

    const checkout = await follow(request, "GET", "/checkout");
    assert.match(checkout.text, /data-testid="subtotal">\$208\.00</);
    assert.match(checkout.text, /data-testid="applied-promo">SAVE10</);
    assert.match(checkout.text, /data-testid="discount-amount">\$20\.80</);
    assert.match(checkout.text, /data-testid="total-due">\$187\.20</);
    assert.match(checkout.text, /data-testid="place-order"/);

    const confirmation = await follow(request, "POST", "/checkout", SHIPPING);
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.text, /data-testid="order-confirmation"/);
    assert.match(confirmation.text, /data-testid="order-number">KN-1001</);
    assert.match(confirmation.text, /data-testid="applied-promo">SAVE10</);
    assert.match(confirmation.text, /data-testid="discount-amount">\$20\.80</);
    assert.match(confirmation.text, /data-testid="total-due">\$187\.20</);
    assert.match(confirmation.text, /data-testid="cart-badge">0</);
  } finally {
    await app.close();
  }
});

function assertFreeShipping(text, total) {
  assert.match(text, /data-testid="free-shipping">Free shipping</);
  assert.match(text, /data-testid="shipping-amount">\$0\.00</);
  assert.match(text, new RegExp(`data-testid="total-due">${total.replace("$", "\\$")}<`));
  assert.doesNotMatch(text, /\$5\.99/);
  assert.doesNotMatch(text, /data-testid="free-shipping-hint"/);
  assert.doesNotMatch(text, /Add \$/);
}

function assertPaidShipping(text, { subtotal, hint, total, discount }) {
  assert.match(text, new RegExp(`data-testid="subtotal">${subtotal.replace("$", "\\$")}<`));
  assert.match(text, /data-testid="shipping-amount">\$5\.99</);
  assert.match(text, new RegExp(`data-testid="free-shipping-hint">Add ${hint.replace("$", "\\$")} more for free shipping.<`));
  assert.match(text, new RegExp(`data-testid="total-due">${total.replace("$", "\\$")}<`));
  assert.doesNotMatch(text, /data-testid="free-shipping"/);
  assert.doesNotMatch(text, /\$0\.00/);
  if (discount) {
    assert.match(text, new RegExp(`data-testid="discount-amount">${discount.replace("$", "\\$")}<`));
  }
}

test("catalog lists the USB-C Cable and Desk Pad at their fixture prices", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    const products = await follow(request, "GET", "/products");
    assert.match(products.text, /data-testid="product-usb-cable"/);
    assert.match(products.text, /USB-C Cable/);
    assert.match(products.text, /\$49\.99/);
    assert.match(products.text, /data-testid="add-to-cart-usb-cable"/);
    assert.match(products.text, /data-testid="product-desk-pad"/);
    assert.match(products.text, /Desk Pad/);
    assert.match(products.text, /\$50\.00/);
    assert.match(products.text, /data-testid="add-to-cart-desk-pad"/);
    assert.match(products.text, /Wireless Headphones/);
    assert.match(products.text, /Mechanical Keyboard/);
  } finally {
    await app.close();
  }
});

test("an empty cart shows a readable Shipping and Total of $0.00", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /data-testid="cart-empty"/);
    assert.match(cart.text, /Your cart is empty/);
    assert.match(cart.text, /data-testid="cart-badge">0</);
    assert.match(cart.text, />Shipping</);
    assert.match(cart.text, /data-testid="shipping-amount">\$0\.00</);
    assert.match(cart.text, />Total due</);
    assert.match(cart.text, /data-testid="total-due">\$0\.00</);
    assert.doesNotMatch(cart.text, /\$5\.99/);
    assert.doesNotMatch(cart.text, /data-testid="free-shipping-hint"/);
    assert.doesNotMatch(cart.text, /Add \$/);
  } finally {
    await app.close();
  }
});

test("a cart over $50 shows free shipping on the cart, checkout, and confirmation", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const cart = await follow(request, "GET", "/cart");
    assert.match(cart.text, /data-testid="subtotal">\$79\.00</);
    assertFreeShipping(cart.text, "$79.00");

    const checkout = await follow(request, "GET", "/checkout");
    assert.match(checkout.text, /data-testid="subtotal">\$79\.00</);
    assertFreeShipping(checkout.text, "$79.00");

    const confirmation = await follow(request, "POST", "/checkout", SHIPPING);
    assert.match(confirmation.text, /data-testid="order-confirmation"/);
    assert.match(confirmation.text, /data-testid="order-number">KN-1001</);
    assert.match(confirmation.text, /data-testid="subtotal">\$79\.00</);
    assertFreeShipping(confirmation.text, "$79.00");
  } finally {
    await app.close();
  }
});

test("USB-C Cable is just under the threshold and Desk Pad is exactly free until SAVE10", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "usb-cable" });
    const cable = await follow(request, "GET", "/cart");
    assertPaidShipping(cable.text, { subtotal: "$49.99", hint: "$0.01", total: "$55.98" });

    await follow(request, "POST", "/cart/items/remove", { sku: "usb-cable" });
    await follow(request, "POST", "/cart/items", { sku: "desk-pad" });
    const pad = await follow(request, "GET", "/cart");
    assert.match(pad.text, /data-testid="subtotal">\$50\.00</);
    assertFreeShipping(pad.text, "$50.00");

    const discounted = await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });
    assert.match(discounted.text, /data-testid="applied-promo">SAVE10</);
    assert.match(discounted.text, /data-testid="discount-amount">\$5\.00</);
    assert.match(discounted.text, /data-testid="after-discount">\$45\.00</);
    assertPaidShipping(discounted.text, { subtotal: "$50.00", hint: "$5.00", total: "$50.99", discount: "$5.00" });

    const checkout = await follow(request, "GET", "/checkout");
    assert.match(checkout.text, /data-testid="after-discount">\$45\.00</);
    assertPaidShipping(checkout.text, { subtotal: "$50.00", hint: "$5.00", total: "$50.99", discount: "$5.00" });

    const confirmation = await follow(request, "POST", "/checkout", SHIPPING);
    assert.match(confirmation.text, /data-testid="order-number">KN-1001</);
    assert.match(confirmation.text, /data-testid="applied-promo">SAVE10</);
    assert.match(confirmation.text, /data-testid="after-discount">\$45\.00</);
    assertPaidShipping(confirmation.text, { subtotal: "$50.00", hint: "$5.00", total: "$50.99", discount: "$5.00" });
  } finally {
    await app.close();
  }
});

test("removing the Desk Pad drops a free-shipping cart under the threshold", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "usb-cable" });
    await follow(request, "POST", "/cart/items", { sku: "desk-pad" });
    const both = await follow(request, "GET", "/cart");
    assert.match(both.text, /data-testid="subtotal">\$99\.99</);
    assertFreeShipping(both.text, "$99.99");

    const cable = await follow(request, "POST", "/cart/items/remove", { sku: "desk-pad" });
    assert.match(cable.text, /USB-C Cable/);
    assert.doesNotMatch(cable.text, /Desk Pad/);
    assertPaidShipping(cable.text, { subtotal: "$49.99", hint: "$0.01", total: "$55.98" });
  } finally {
    await app.close();
  }
});

test("SAVE10 on headphones stays free because $71.10 is still over $50", async () => {
  const app = await start();
  const request = client(app.base);
  try {
    await signIn(request);
    await follow(request, "POST", "/cart/items", { sku: "headphones" });
    const cart = await follow(request, "POST", "/cart/promo", { promo: "SAVE10" });
    assert.match(cart.text, /data-testid="subtotal">\$79\.00</);
    assert.match(cart.text, /data-testid="discount-amount">\$7\.90</);
    assert.match(cart.text, /data-testid="after-discount">\$71\.10</);
    assertFreeShipping(cart.text, "$71.10");
    assert.doesNotMatch(cart.text, /\$77\.09/);
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
