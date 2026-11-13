/**
 * Northwind Supply — the sample shop Kane PR Guard verifies.
 *
 * Seeded user (must match the Kane flow variables):
 *   test@example.com / password123
 *
 * In-memory sessions and orders. No database. PORT defaults to 3000.
 */
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyPromo, formatCents, quoteCart, retainedPromo } from "./pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SEEDED_USER = {
  email: "test@example.com",
  password: "password123",
  name: "Test User",
};

export const PRODUCTS = [
  { sku: "headphones", name: "Wireless Headphones", price: "$79.00", blurb: "Closed-back, office quiet." },
  { sku: "keyboard", name: "Mechanical Keyboard", price: "$129.00", blurb: "Tactile switches, full size." },
];

export function createApp() {
  const sessions = new Map();
  const orders = [];
  let nextOrder = 1001;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (req, res) => {
    if (currentSession(req)) return res.redirect(302, "/dashboard");
    res.redirect(302, "/login");
  });

  app.get("/login", (req, res) => {
    if (currentSession(req)) return res.redirect(302, "/dashboard");
    send(res, 200, renderLogin(null));
  });

  app.post("/login", (req, res) => {
    const email = String(req.body.email || "").trim();
    const password = String(req.body.password || "");
    const valid = email.toLowerCase() === SEEDED_USER.email && password === SEEDED_USER.password;
    if (!valid) {
      send(res, 401, renderLogin("Incorrect credentials. The password you entered is incorrect.", email));
      return;
    }
    const sid = crypto.randomBytes(16).toString("hex");
    sessions.set(sid, {
      email: SEEDED_USER.email,
      name: SEEDED_USER.name,
      cart: [],
      notice: "",
      promoCode: "",
      promoError: "",
      promoDraft: "",
    });
    setCookie(res, sid);
    res.redirect(303, "/dashboard");
  });

  app.post("/logout", (req, res) => {
    const sid = readCookie(req, "sid");
    if (sid) sessions.delete(sid);
    clearCookie(res);
    res.redirect(303, "/login");
  });

  app.get("/dashboard", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const body = `
      <h1 data-testid="dashboard-heading">Dashboard</h1>
      <p class="lede" data-testid="welcome">Welcome. You are signed in as ${escapeHtml(session.email)}.</p>
      <p><a class="button" href="/products" data-testid="catalog-link">Browse products</a></p>
    `;
    send(res, 200, layout({ title: "Dashboard", session, body }));
  });

  app.get("/products", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const cards = PRODUCTS.map((product) => `
      <li class="product" data-testid="product-${product.sku}">
        <div>
          <h2>${escapeHtml(product.name)}</h2>
          <p class="muted">${escapeHtml(product.blurb)}</p>
          <p class="price">${escapeHtml(product.price)}</p>
        </div>
        <form method="post" action="/cart/items">
          <input type="hidden" name="sku" value="${escapeHtml(product.sku)}">
          <button type="submit" data-testid="add-to-cart-${product.sku}">Add to cart</button>
        </form>
      </li>
    `).join("");
    const body = `
      <h1>Products</h1>
      <p class="lede">Add items to the cart. The badge in the header counts them.</p>
      ${noticeHtml(session)}
      <ul class="products" data-testid="product-list">${cards}</ul>
    `;
    send(res, 200, layout({ title: "Products", session, body }));
  });

  app.post("/cart/items", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const product = PRODUCTS.find((item) => item.sku === req.body.sku);
    if (!product) {
      send(res, 404, layout({
        title: "Products",
        session,
        body: `<p class="alert" role="alert">That product is not in the catalog.</p>`,
      }));
      return;
    }
    const existing = session.cart.find((item) => item.sku === product.sku);
    if (existing) existing.qty += 1;
    else session.cart.push({ sku: product.sku, name: product.name, price: product.price, qty: 1 });
    session.notice = `Added ${product.name} to the cart.`;
    res.redirect(303, "/products");
  });

  app.get("/cart", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    send(res, 200, layout({ title: "Cart", session, body: renderCart(session) }));
  });

  app.post("/cart/items/remove", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    session.cart = session.cart.filter((item) => item.sku !== req.body.sku);
    session.promoCode = retainedPromo(session.promoCode, session.cart);
    if (!session.promoCode) {
      session.promoError = "";
      session.promoDraft = "";
    }
    session.notice = "Removed the item from the cart.";
    res.redirect(303, "/cart");
  });

  app.post("/cart/promo", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    if (cartCount(session) === 0) {
      res.redirect(303, "/cart");
      return;
    }
    const result = applyPromo(session.promoCode, req.body.promo);
    session.promoCode = result.code;
    if (result.error) {
      session.promoError = result.error;
      session.promoDraft = String(req.body.promo || "").trim();
      session.notice = "";
    } else {
      session.promoError = "";
      session.promoDraft = "";
      session.notice = `Promo code ${result.code} applied.`;
    }
    res.redirect(303, "/cart");
  });

  app.get("/checkout", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    if (cartCount(session) === 0) {
      send(res, 200, layout({ title: "Checkout", session, body: renderCheckoutBlocked() }));
      return;
    }
    send(res, 200, layout({ title: "Checkout", session, body: renderCheckoutForm(session, "") }));
  });

  app.post("/checkout", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    if (cartCount(session) === 0) {
      send(res, 422, layout({ title: "Checkout", session, body: renderCheckoutBlocked() }));
      return;
    }
    const shipping = readShipping(req.body);
    const missing = requiredShippingFields().filter((field) => !shipping[field.key]);
    if (missing.length) {
      send(res, 400, layout({
        title: "Checkout",
        session,
        body: renderCheckoutForm(session, "Enter the required shipping details before placing the order."),
      }));
      return;
    }
    const quote = quoteCart(session.cart, session.promoCode);
    const number = `KN-${nextOrder}`;
    nextOrder += 1;
    const order = {
      number,
      email: session.email,
      shipping,
      items: session.cart.map((item) => ({ ...item })),
      promoCode: quote.code,
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
    };
    orders.push(order);
    session.cart = [];
    session.promoCode = "";
    session.promoError = "";
    session.promoDraft = "";
    session.notice = "";
    res.redirect(303, `/orders/${order.number}`);
  });

  app.get("/orders/:number", (req, res) => {
    const session = requireSession(req, res);
    if (!session) return;
    const order = orders.find((item) => item.number === req.params.number && item.email === session.email);
    if (!order) {
      send(res, 404, layout({
        title: "Order",
        session,
        body: `<h1>Order not found</h1><p>That order number is not on this account.</p>`,
      }));
      return;
    }
    const body = `
      <h1 data-testid="order-confirmation">Order confirmation</h1>
      <p class="lede">Thanks, ${escapeHtml(order.shipping.name)}. Your order has been placed.</p>
      <p>Order number</p>
      <p class="order-number" data-testid="order-number">${escapeHtml(order.number)}</p>
      ${renderSummary(orderQuote(order))}
      <p class="muted">A confirmation was prepared for ${escapeHtml(order.shipping.email)}. No real payment was charged.</p>
    `;
    send(res, 200, layout({ title: "Order confirmation", session, body }));
  });

  function currentSession(req) {
    const sid = readCookie(req, "sid");
    if (!sid) return null;
    return sessions.get(sid) || null;
  }

  function requireSession(req, res) {
    const session = currentSession(req);
    if (!session) {
      res.redirect(302, "/login");
      return null;
    }
    return session;
  }

  return app;
}

function requiredShippingFields() {
  return [
    { key: "name", label: "Name", testid: "shipping-name", autocomplete: "name" },
    { key: "address", label: "Address", testid: "shipping-address", autocomplete: "street-address" },
    { key: "city", label: "City", testid: "shipping-city", autocomplete: "address-level2" },
    { key: "postal", label: "Postal code", testid: "shipping-postal", autocomplete: "postal-code" },
    { key: "email", label: "Email", testid: "shipping-email", autocomplete: "email" },
    { key: "phone", label: "Phone", testid: "shipping-phone", autocomplete: "tel" },
  ];
}

function readShipping(body) {
  const shipping = {};
  for (const field of requiredShippingFields()) {
    shipping[field.key] = String(body[field.key] || "").trim();
  }
  return shipping;
}

function cartCount(session) {
  return session.cart.reduce((total, item) => total + item.qty, 0);
}

function renderLogin(error, email = "") {
  const alert = error
    ? `<p class="alert" role="alert" data-testid="login-error">${escapeHtml(error)}</p>`
    : "";
  const body = `
    <h1>Sign in</h1>
    <p class="lede">Use the demo account to reach the dashboard.</p>
    ${alert}
    <form class="stack card" method="post" action="/login" data-testid="login-form">
      <label for="email">Email
        <input id="email" name="email" type="email" autocomplete="username" data-testid="login-email" value="${escapeHtml(email)}">
      </label>
      <label for="password">Password
        <input id="password" name="password" type="password" autocomplete="current-password" data-testid="login-password">
      </label>
      <button type="submit" data-testid="login-submit">Sign in</button>
    </form>
  `;
  return layout({ title: "Sign in", session: null, body });
}

function renderCart(session) {
  if (session.cart.length === 0) {
    return `
      <h1>Cart</h1>
      ${noticeHtml(session)}
      <p data-testid="cart-empty">Your cart is empty</p>
      <p class="actions">
        <a class="button secondary" href="/products">Browse products</a>
        <a class="button" href="/checkout" data-testid="checkout-link">Checkout</a>
      </p>
    `;
  }
  const rows = session.cart.map((item) => `
    <li class="cart-row" data-testid="cart-item-${item.sku}">
      <div>
        <h2>${escapeHtml(item.name)}</h2>
        <p class="muted">Quantity ${item.qty} · ${escapeHtml(item.price)}</p>
      </div>
      <form method="post" action="/cart/items/remove">
        <input type="hidden" name="sku" value="${escapeHtml(item.sku)}">
        <button class="secondary" type="submit" data-testid="remove-${item.sku}">Remove</button>
      </form>
    </li>
  `).join("");
  const quote = quoteCart(session.cart, session.promoCode);
  return `
    <h1>Cart</h1>
    ${noticeHtml(session)}
    <ul class="cart-list" data-testid="cart-page">${rows}</ul>
    ${renderPromoForm(session)}
    ${renderSummary(quote)}
    <p class="actions"><a class="button" href="/checkout" data-testid="checkout-link">Checkout</a></p>
  `;
}

function orderQuote(order) {
  return {
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    code: order.promoCode || "",
    applied: Boolean(order.promoCode),
  };
}

function renderSummary(quote) {
  const discount = quote.applied
    ? `<div class="summary-row">
        <dt>Promo code</dt>
        <dd data-testid="applied-promo">${escapeHtml(quote.code)}</dd>
      </div>
      <div class="summary-row">
        <dt>Discount</dt>
        <dd data-testid="discount-amount">${formatCents(quote.discountCents)}</dd>
      </div>`
    : "";
  return `
    <section class="card summary" data-testid="order-summary">
      <h2>Order summary</h2>
      <dl>
        <div class="summary-row">
          <dt>Subtotal</dt>
          <dd data-testid="subtotal">${formatCents(quote.subtotalCents)}</dd>
        </div>
        ${discount}
        <div class="summary-row total-row">
          <dt>Total due</dt>
          <dd data-testid="total-due">${formatCents(quote.totalCents)}</dd>
        </div>
      </dl>
    </section>
  `;
}

function renderPromoForm(session) {
  const error = session.promoError || "";
  const draft = session.promoDraft || "";
  session.promoError = "";
  session.promoDraft = "";
  const alert = error
    ? `<p class="alert" role="alert" data-testid="promo-error">${escapeHtml(error)}</p>`
    : "";
  return `
    <div class="promo">
      ${alert}
      <form class="promo-form" method="post" action="/cart/promo" data-testid="promo-form">
        <label for="promo">Promo code
          <input id="promo" name="promo" autocomplete="off" spellcheck="false" data-testid="promo-code" value="${escapeHtml(draft)}">
        </label>
        <button type="submit" data-testid="apply-promo">Apply</button>
      </form>
    </div>
  `;
}

function renderCheckoutBlocked() {
  return `
    <h1>Checkout</h1>
    <p class="alert" role="alert" data-testid="checkout-blocked">Your cart is empty. Checkout cannot continue until items are added.</p>
    <p><a class="button secondary" href="/products">Browse products</a></p>
  `;
}

function renderCheckoutForm(session, error) {
  const fields = requiredShippingFields().map((field) => `
    <label for="${field.key}">${escapeHtml(field.label)}
      <input id="${field.key}" name="${field.key}" autocomplete="${field.autocomplete}" data-testid="${field.testid}" value="${escapeHtml(field.key === "email" ? session.email : "")}">
    </label>
  `).join("");
  const alert = error ? `<p class="alert" role="alert" data-testid="checkout-error">${escapeHtml(error)}</p>` : "";
  const quote = quoteCart(session.cart, session.promoCode);
  return `
    <h1>Checkout</h1>
    <p class="lede">Shipping only. Payment is a dummy step — no card is required.</p>
    ${alert}
    ${renderSummary(quote)}
    <form class="stack card" method="post" action="/checkout" data-testid="shipping-form">
      ${fields}
      <button type="submit" data-testid="place-order">Place order</button>
    </form>
  `;
}

function noticeHtml(session) {
  if (!session?.notice) return "";
  const text = session.notice;
  session.notice = "";
  return `<p class="notice" role="status" data-testid="notice">${escapeHtml(text)}</p>`;
}

function layout({ title, session, body }) {
  const count = session ? cartCount(session) : 0;
  const nav = session
    ? `<a href="/dashboard">Dashboard</a>
       <a href="/products">Products</a>
       <a class="cart-link" href="/cart" data-testid="cart-link">Cart <span class="badge" data-testid="cart-badge">${count}</span></a>`
    : "";
  const account = session
    ? `<nav class="account" data-testid="account-menu">
         <span data-testid="signed-in-as">Signed in as ${escapeHtml(session.email)}</span>
         <form method="post" action="/logout"><button class="secondary" type="submit">Sign out</button></form>
       </nav>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Northwind Supply</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="top">
    <a class="brand" href="${session ? "/dashboard" : "/login"}">Northwind Supply</a>
    <div class="nav">${nav}${account}</div>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function send(res, status, html) {
  res.status(status).type("html").send(html);
}

function setCookie(res, sid) {
  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/`);
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Northwind Supply listening on http://localhost:${port}`);
  });
}
