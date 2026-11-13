/**
 * Merchandise totals for the Northwind cart.
 *
 * Subtotal is unit price × quantity. There is no tax. SAVE10 takes 10%
 * off the current subtotal. The discount is rounded half-up to the cent
 * (see percentOffCents). One code is stored, so applying it again does
 * not stack.
 *
 * Shipping is a flat SHIPPING_FEE_CENTS ($5.99). It is free when the
 * merchandise total after that discount is at least
 * FREE_SHIPPING_THRESHOLD_CENTS ($50.00). An empty cart is not charged.
 * totalCents is the merchandise total after the discount. orderTotalCents
 * adds shipping, which is what the shopper pays.
 */

export const SAVE10 = "SAVE10";

/** Merchandise after discount must reach this amount for free shipping. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;

/** Flat shipping fee charged when the cart is below the threshold. */
export const SHIPPING_FEE_CENTS = 599;

export function priceToCents(price) {
  const match = String(price).trim().match(/^\$(\d+)\.(\d{2})$/);
  if (!match) {
    throw new Error(`Unrecognized price: ${price}`);
  }
  return Number(match[1]) * 100 + Number(match[2]);
}

export function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${remainder}`;
}

export function merchandiseSubtotalCents(items) {
  return items.reduce((sum, item) => sum + priceToCents(item.price) * item.qty, 0);
}

/**
 * `round_half_up(subtotal * percent / 100)` to the nearest cent.
 * Subtotal is already in cents, so this stays in integer arithmetic.
 */
export function percentOffCents(subtotalCents, percent) {
  return Math.floor((subtotalCents * percent + 50) / 100);
}

function cartHasItems(items) {
  return items.some((item) => item.qty > 0);
}

export function quoteCart(items, promoCode) {
  const subtotalCents = merchandiseSubtotalCents(items);
  const applied = String(promoCode || "").toUpperCase() === SAVE10;
  const discountCents = applied ? percentOffCents(subtotalCents, 10) : 0;
  const merchandiseCents = subtotalCents - discountCents;
  const stocked = cartHasItems(items);
  const freeShipping = stocked && merchandiseCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const shippingCents = stocked && !freeShipping ? SHIPPING_FEE_CENTS : 0;
  const remainingUntilFreeShippingCents = stocked && !freeShipping
    ? FREE_SHIPPING_THRESHOLD_CENTS - merchandiseCents
    : 0;
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    freeShipping,
    remainingUntilFreeShippingCents,
    totalCents: merchandiseCents,
    orderTotalCents: merchandiseCents + shippingCents,
    code: applied ? SAVE10 : "",
    applied,
  };
}

/**
 * A promo belongs to the cart on screen. Removing one item while others
 * remain keeps it. Emptying the cart drops it, so the next item is full
 * price until the shopper applies a code again. The empty-cart page does
 * not show the promo field, and a hidden code must not follow them there.
 */
export function retainedPromo(promoCode, items) {
  const hasItems = Array.isArray(items) && items.some((item) => item.qty > 0);
  if (!hasItems) return "";
  return String(promoCode || "").toUpperCase() === SAVE10 ? SAVE10 : "";
}

/**
 * SAVE10 matches in any letter case. An unrecognized code is rejected
 * and the code already in effect is left in place.
 */
export function applyPromo(currentCode, entered) {
  const current = String(currentCode || "").toUpperCase() === SAVE10 ? SAVE10 : "";
  const typed = String(entered ?? "").trim();
  if (typed.toUpperCase() !== SAVE10) {
    return {
      code: current,
      error: typed ? "Invalid promo code." : "Enter a promo code.",
    };
  }
  return { code: SAVE10, error: "" };
}
