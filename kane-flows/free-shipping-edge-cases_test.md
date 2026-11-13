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

# Free-shipping edges: SAVE10 on $79 stays at $0.00 shipping; $49.99, $50.00, promo drop, and removal

Spec: the Shipping line amount is $5.99 unless the merchandise subtotal AFTER
the SAVE10 discount (or the raw subtotal if no code is applied) is >= $50.00
inclusive, in which case the Shipping line amount is $0.00. Below the
threshold, the hint shows "Add $X.XX more", where X.XX = 50.00 minus that
discounted subtotal, rounded to cents. Amounts must be exact. Assert the
Shipping line amount and the Total; do not assert the phrases "free shipping"
or "not free shipping", because the below-threshold hint contains "for free
shipping" and that wording collides with those checks. Confirmation must
repeat the cart/checkout totals, including discount and shipping.

Discount = round-half-up(subtotal × 0.10, 2). Discounted subtotal = subtotal
minus that discount. Total = discounted subtotal + shipping.

Catalog used in this flow:
- Wireless Headphones, $79.00 (sku headphones)
- USB-C Cable, $49.99 (sku usb-cable)
- Desk Pad, $50.00 (sku desk-pad)

SAVE10 on one Wireless Headphones leaves $71.10, which is still >= $50.00,
so the Shipping line amount stays $0.00.

Override the start URL with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## SAVE10 on a $79.00 cart still has a Shipping line amount of $0.00
Go to the product listing or catalog.
Add only one Wireless Headphones ($79.00). Do not add any other item.
Open the cart.
Apply the promo code {{valid_code}}.
Verify SAVE10 is applied: subtotal $79.00, discount $7.90, and the subtotal after the discount is $71.10.
Verify the Shipping line amount is $0.00 (not $5.99).
Verify there is no hint that shows "Add $X.XX more".
Verify the Total is $71.10 ($71.10 after discount plus $0.00 shipping), not $77.09.

## Just under $50.00: USB-C Cable $49.99 pays $5.99 and shows the $0.01 hint
Remove every item from the cart so it is empty, then go to the product listing.
Add only one USB-C Cable ($49.99). Do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $49.99.
Verify the Shipping line amount is $5.99 (not $0.00).
Verify the hint shows "Add $0.01 more" (50.00 − 49.99 = 0.01).
Verify the Total is $55.98 (49.99 + 5.99).

## Exactly $50.00: Desk Pad has a Shipping line amount of $0.00
Remove the USB-C Cable (or any other items) so the cart is empty, then go to the product listing.
Add only one Desk Pad ($50.00). Do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $50.00 exactly.
Verify the Shipping line amount is $0.00 (not $5.99).
Verify there is no hint that shows "Add $X.XX more".
Verify the Total is $50.00 ($50.00 plus $0.00 shipping).

## SAVE10 drops a $50.00 cart below the threshold; confirmation includes discount and shipping
Start from the previous step's cart: one Desk Pad, no code, Shipping line amount $0.00.
Apply the promo code {{valid_code}}.
Verify SAVE10 is applied: subtotal $50.00, discount $5.00, and the subtotal after the discount is $45.00.
Verify the Shipping line amount is $5.99 (not $0.00).
Verify the hint shows "Add $5.00 more" (50.00 − 45.00 = 5.00).
Verify the Total is $50.99 (45.00 + 5.99), not $45.00 and not $50.00.
Go to checkout.
Verify checkout matches the cart: subtotal $50.00, SAVE10 discount $5.00, the Shipping line amount is $5.99 (not $0.00), the Total is $50.99, and the hint shows "Add $5.00 more".
Fill the shipping form with valid details: name Test User, address 123 Test Street, city Testville, postal code 12345, and email or phone if those fields are required (test@example.com, 555-0100).
Place the order (use any test/dummy payment option the app offers; do not require a real card).
Verify an order confirmation is shown with an order number.
Verify the confirmation matches checkout: subtotal $50.00, SAVE10 discount $5.00, the Shipping line amount is $5.99 (not $0.00), and the Total is $50.99.

## Removing an item crosses back under the threshold
Go to the product listing. The previous order should have left the cart empty; if anything remains, remove it first.
Add one USB-C Cable ($49.99) and one Desk Pad ($50.00), and do not apply a promo code.
Open the cart.
Verify the merchandise subtotal is $99.99 (49.99 + 50.00), the Shipping line amount is $0.00 (not $5.99), there is no hint that shows "Add $X.XX more", and the Total is $99.99.
Remove only the Desk Pad, leaving the USB-C Cable.
Verify the merchandise subtotal is now $49.99.
Verify the Shipping line amount is $5.99 (not $0.00), the hint shows "Add $0.01 more", and the Total is $55.98 (49.99 + 5.99), not $99.99 and not $49.99.
