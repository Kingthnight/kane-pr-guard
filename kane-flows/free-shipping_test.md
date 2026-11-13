---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [shipping, cart, checkout, smoke]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
---

# Free shipping: empty cart has no shipping charge; a cart over $50 has Shipping $0.00; confirmation matches

Spec: flat $5.99 shipping, and the Shipping line amount is $0.00 when the
merchandise subtotal after any SAVE10 discount is >= $50.00 inclusive. The
Shipping line and Total appear on the cart and on checkout/confirmation.
Below the threshold, the hint shows "Add $X.XX more" where X.XX = 50.00
minus that discounted subtotal, rounded to cents. Assert exact amounts on
the Shipping line and the Total. Do not assert the phrases "free shipping"
or "not free shipping", because the below-threshold hint contains "for free
shipping" and that wording collides with those checks.

This file uses Wireless Headphones $79.00 (already over $50). Just-under
($49.99), exactly $50.00, and SAVE10 dropping a cart below $50 are in
free-shipping-edge-cases_test.md, using USB-C Cable $49.99 and Desk Pad
$50.00.

Override the start URL with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Empty cart has no shipping charge
Open the cart. If any items are present, remove them all so the cart is empty.
Verify the cart is empty (empty-cart state or a badge of 0).
Verify there is no shipping charge: the Shipping line amount is not $5.99, and the Total is not $5.99. An empty cart must not be billed for shipping.

## A cart over $50 has a Shipping line amount of $0.00
Go to the product listing or catalog.
Add only one Wireless Headphones ($79.00). Do not add any other item and do not apply a promo code.
Open the cart.
Verify the cart contains only that item and the merchandise subtotal is $79.00.
Verify the Shipping line amount is $0.00 (not $5.99).
Verify there is no hint that shows "Add $X.XX more".
Verify the Total is $79.00 (the $79.00 subtotal plus $0.00 shipping).

## Confirmation totals match the cart and checkout, including shipping
Go to checkout.
Verify checkout shows the same figures: subtotal $79.00, the Shipping line amount is $0.00 (not $5.99), and the Total is $79.00.
Fill the shipping form with valid details: name Test User, address 123 Test Street, city Testville, postal code 12345, and email or phone if those fields are required (test@example.com, 555-0100).
Place the order (use any test/dummy payment option the app offers; do not require a real card).
Verify an order confirmation is shown with an order number.
Verify the confirmation matches checkout and the cart: subtotal $79.00, the Shipping line amount is $0.00 (not $5.99), and the Total is $79.00.
