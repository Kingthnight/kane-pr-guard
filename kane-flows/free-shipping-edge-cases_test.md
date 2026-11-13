---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [shipping, promo, cart, checkout]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
  valid_code:
    value: "SAVE10"
---

# Free-shipping edges: SAVE10 still free on $79; $49.99 / $50.00 / promo-drop / removal need fixtures

Spec: shipping is $5.99 unless the merchandise subtotal AFTER the SAVE10
discount (or the raw subtotal if no code is applied) is >= $50.00 inclusive,
in which case shipping is $0.00 and the page contains "Free shipping".
Below the threshold, shipping is $5.99 and a hint contains "Add $X.XX more",
where X.XX = 50.00 minus that discounted subtotal, rounded to cents.
Amounts must be exact; copy may match loosely. Confirmation must repeat the
cart/checkout totals, including discount and shipping.

Discount = round-half-up(subtotal × 0.10, 2). Discounted subtotal = subtotal
minus that discount. Total = discounted subtotal + shipping.

The first cart case uses the current catalog (Wireless Headphones $79.00):
SAVE10 leaves $71.10, which is still >= $50.00, so shipping stays free.

The $49.99, exactly $50.00, SAVE10-drops-below-$50, and removal-crosses-under
cases CANNOT be built from the current catalog (cheapest item is $79.00;
after SAVE10 it is $71.10). They are written against two dedicated fixtures
Builder must add to the catalog in the same PR, with these exact names and
prices (do not substitute Headphones or Keyboard, and do not assume a price
editor exists):

- USB-C Cable, sku `usb-cable`, unit price $49.99
- Desk Pad, sku `desk-pad`, unit price $50.00

Until both fixtures are in the catalog, those later steps are blocked and
must not be treated as passing. Do not invent other products to approximate
the totals.

Override the start URL with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## SAVE10 on a $79.00 cart still qualifies for free shipping
Go to the product listing or catalog.
Add only one Wireless Headphones ($79.00). Do not add any other item.
Open the cart.
Apply the promo code {{valid_code}}.
Verify SAVE10 is applied: subtotal $79.00, discount $7.90, and the subtotal after the discount is $71.10.
Verify $71.10 is still at or above $50.00, so shipping is free at $0.00 (text contains "Free shipping", amount $0.00, not $5.99).
Verify there is no hint that contains "Add $X.XX more".
Verify the Total is $71.10 ($71.10 after discount plus $0.00 shipping), not $77.09.

## Just under $50.00: USB-C Cable $49.99 pays $5.99 and shows the $0.01 hint
BLOCKED until the catalog includes USB-C Cable at $49.99 (sku usb-cable). Do not use Wireless Headphones, Mechanical Keyboard, or any other existing item for this step, and do not treat a substitute cart as covering this boundary.
Remove every item from the cart so it is empty, then go to the product listing.
Add only one USB-C Cable ($49.99). Do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $49.99 (just under the $50.00 threshold).
Verify a Shipping line is shown at $5.99 (text contains "$5.99"), not free shipping and not $0.00.
Verify a hint contains "Add $0.01 more" (50.00 − 49.99 = 0.01).
Verify the Total is $55.98 (49.99 + 5.99).

## Exactly $50.00: Desk Pad qualifies for free shipping
BLOCKED until the catalog includes Desk Pad at $50.00 (sku desk-pad). Do not substitute any other product.
Remove the USB-C Cable (or any other items) so the cart is empty, then go to the product listing.
Add only one Desk Pad ($50.00). Do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $50.00 exactly.
Verify shipping is free at $0.00 (text contains "Free shipping", amount $0.00, not $5.99).
Verify there is no hint that contains "Add $X.XX more".
Verify the Total is $50.00 ($50.00 plus $0.00 shipping).

## SAVE10 drops a $50.00 cart below the threshold; confirmation includes discount and shipping
BLOCKED until Desk Pad at $50.00 is in the catalog. Start from the previous step's cart: one Desk Pad, no code, currently free shipping.
Apply the promo code {{valid_code}}.
Verify SAVE10 is applied: subtotal $50.00, discount $5.00, and the subtotal after the discount is $45.00.
Verify $45.00 is below $50.00, so shipping is no longer free: Shipping is $5.99 (text contains "$5.99"), not $0.00.
Verify a hint contains "Add $5.00 more" (50.00 − 45.00 = 5.00).
Verify the Total is $50.99 (45.00 + 5.99), not $45.00 and not $50.00.
Go to checkout.
Verify checkout matches the cart: subtotal $50.00, SAVE10 discount $5.00, Shipping $5.99, Total $50.99, and a hint contains "Add $5.00 more".
Fill the shipping form with valid details: name Test User, address 123 Test Street, city Testville, postal code 12345, and email or phone if those fields are required (test@example.com, 555-0100).
Place the order (use any test/dummy payment option the app offers; do not require a real card).
Verify an order confirmation is shown with an order number.
Verify the confirmation matches checkout: subtotal $50.00, SAVE10 discount $5.00, Shipping $5.99, and Total $50.99.

## Removing an item crosses back under the threshold
BLOCKED until both fixtures exist: USB-C Cable $49.99 (sku usb-cable) and Desk Pad $50.00 (sku desk-pad). Do not substitute Headphones or Keyboard; removing either of those always leaves a cart still >= $50.00.
Go to the product listing. The previous order should have left the cart empty; if anything remains, remove it first.
Add one USB-C Cable ($49.99) and one Desk Pad ($50.00), and do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $99.99 (49.99 + 50.00), shipping is free at $0.00 (text contains "Free shipping", amount $0.00), there is no "Add $X.XX more" hint, and the Total is $99.99.
Remove only the Desk Pad, leaving the USB-C Cable.
Verify the merchandise subtotal is now $49.99, below the $50.00 threshold.
Verify shipping is no longer free: Shipping is $5.99 (text contains "$5.99"), a hint contains "Add $0.01 more", and the Total is $55.98 (49.99 + 5.99), not $99.99 and not $49.99.
