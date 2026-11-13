import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPromo,
  formatCents,
  merchandiseSubtotalCents,
  percentOffCents,
  quoteCart,
  retainedPromo,
} from "../app/pricing.js";

const headphones = { sku: "headphones", name: "Wireless Headphones", price: "$79.00", qty: 1 };
const keyboard = { sku: "keyboard", name: "Mechanical Keyboard", price: "$129.00", qty: 1 };

test("merchandise subtotal is unit price times quantity", () => {
  assert.equal(merchandiseSubtotalCents([headphones, keyboard]), 20800);
  assert.equal(merchandiseSubtotalCents([{ ...headphones, qty: 2 }]), 15800);
  assert.equal(formatCents(20800), "$208.00");
  assert.equal(formatCents(790), "$7.90");
});

test("SAVE10 is 10% of the subtotal, rounded half-up to the cent", () => {
  const both = quoteCart([headphones, keyboard], "SAVE10");
  assert.equal(formatCents(both.subtotalCents), "$208.00");
  assert.equal(formatCents(both.discountCents), "$20.80");
  assert.equal(formatCents(both.totalCents), "$187.20");
  assert.equal(both.code, "SAVE10");

  const phones = quoteCart([headphones], "SAVE10");
  assert.equal(formatCents(phones.discountCents), "$7.90");
  assert.equal(formatCents(phones.totalCents), "$71.10");

  const keys = quoteCart([keyboard], "SAVE10");
  assert.equal(formatCents(keys.discountCents), "$12.90");
  assert.equal(formatCents(keys.totalCents), "$116.10");

  // 1005 cents * 10% = 100.5 cents, which half-up rounds to 101 ($1.01).
  assert.equal(percentOffCents(1005, 10), 101);
  assert.equal(percentOffCents(14, 10), 1);
  assert.equal(percentOffCents(15, 10), 2);
  assert.equal(percentOffCents(4, 10), 0);
  assert.equal(percentOffCents(5, 10), 1);

  const awkward = quoteCart([{ price: "$10.05", qty: 1 }], "SAVE10");
  assert.equal(awkward.discountCents, 101);
  assert.equal(awkward.totalCents, 1005 - 101);
});

test("no code leaves the total equal to the subtotal", () => {
  const quote = quoteCart([headphones, keyboard], "");
  assert.equal(quote.applied, false);
  assert.equal(quote.discountCents, 0);
  assert.equal(quote.totalCents, quote.subtotalCents);
  assert.equal(quote.code, "");
});

test("SAVE10 is case-insensitive and does not stack", () => {
  for (const typed of ["SAVE10", "save10", "Save10", "SaVe10", "  save10  "]) {
    const result = applyPromo("", typed);
    assert.equal(result.error, "");
    assert.equal(result.code, "SAVE10");
  }

  const again = applyPromo("SAVE10", "SAVE10");
  assert.equal(again.code, "SAVE10");
  assert.equal(again.error, "");

  const quote = quoteCart([headphones, keyboard], again.code);
  assert.equal(quote.discountCents, 2080);
  assert.equal(quote.totalCents, 18720);
  assert.notEqual(quote.discountCents, 4160);
  assert.notEqual(quote.totalCents, 16640);
});

test("an invalid code is rejected and leaves an applied code in place", () => {
  const first = applyPromo("", "BOGUS");
  assert.equal(first.error, "Invalid promo code.");
  assert.equal(first.code, "");

  const kept = applyPromo("SAVE10", "NOPE");
  assert.equal(kept.error, "Invalid promo code.");
  assert.equal(kept.code, "SAVE10");

  const quote = quoteCart([headphones, keyboard], kept.code);
  assert.equal(quote.totalCents, 18720);

  const blank = applyPromo("SAVE10", "   ");
  assert.equal(blank.code, "SAVE10");
  assert.equal(blank.error, "Enter a promo code.");
});

test("emptying the cart drops SAVE10 so the next item is full price", () => {
  // Kane exploratory-cart, attempt 1 on pull/2: apply SAVE10, remove every
  // item, then add Wireless Headphones without entering a code. The empty
  // cart hides the promo field, so a code left in the session shows up as
  // a $7.90 discount on a cart the shopper thinks is new.
  assert.equal(retainedPromo("SAVE10", [headphones]), "SAVE10");
  const stillStocked = quoteCart([headphones], retainedPromo("SAVE10", [headphones]));
  assert.equal(formatCents(stillStocked.totalCents), "$71.10");

  assert.equal(retainedPromo("SAVE10", []), "");
  const fresh = quoteCart([headphones], retainedPromo("SAVE10", []));
  assert.equal(fresh.applied, false);
  assert.equal(fresh.discountCents, 0);
  assert.equal(formatCents(fresh.subtotalCents), "$79.00");
  assert.equal(formatCents(fresh.totalCents), "$79.00");
});

test("removing an item recalculates 10% of the new subtotal", () => {
  const full = quoteCart([headphones, keyboard], "SAVE10");
  assert.equal(full.totalCents, 18720);
  const remaining = quoteCart([headphones], "SAVE10");
  assert.equal(formatCents(remaining.subtotalCents), "$79.00");
  assert.equal(formatCents(remaining.discountCents), "$7.90");
  assert.equal(formatCents(remaining.totalCents), "$71.10");
  assert.equal(remaining.code, "SAVE10");
});
