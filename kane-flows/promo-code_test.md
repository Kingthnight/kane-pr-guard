---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [promo, checkout, smoke]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
  valid_code:
    value: "SAVE10"
  invalid_code:
    value: "BOGUS"
---

# Promo code: invalid codes are rejected, SAVE10 takes 10% off, confirmation matches checkout

Catalog prices this flow uses (must match the sample app):
Wireless Headphones $79.00, Mechanical Keyboard $129.00.
Subtotal for one of each is $208.00. SAVE10 is 10% off that subtotal:
discount $20.80, discounted total $187.20 (208.00 × 0.9, already exact to the cent).
Rounding rule if a later price is not exact: half-up to the nearest cent.

See PROMO_SPEC.md for the full behavior contract, including the
case-sensitivity assumption covered in promo-edge-cases_test.md.

Override the start URL in CI with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Add two known items and read the subtotal
Go to the product listing or catalog.
Add one Wireless Headphones ($79.00) and one Mechanical Keyboard ($129.00) to the cart (one of each, not two of the same).
Open the cart.
Verify the cart contains both items and the subtotal shown is $208.00 (79.00 + 129.00).
Store the displayed subtotal as 'subtotal'.
If a total is shown before any promo code is applied, verify it also equals $208.00.

## Invalid code BOGUS shows an error and does not change the total
Enter the promo code {{invalid_code}} into the promo code field and apply it.
Verify a visible error is shown that the code is invalid or not recognized.
Verify {{invalid_code}} is not applied as a discount.
Verify the subtotal is still $208.00 and the total due is still $208.00 (unchanged, no discount line, or a discount of $0.00).

## Valid code SAVE10 takes 10% off
Enter the promo code {{valid_code}} into the promo code field and apply it.
Verify the code is accepted and shown as applied (SAVE10).
Verify a discount of $20.80 is shown, which is exactly 10% of the $208.00 subtotal (208.00 × 0.10).
Verify the discounted total due is $187.20, which is the $208.00 subtotal minus $20.80 (equivalently 208.00 × 0.90, rounded to the nearest cent).
Store the discounted total as 'checkout_total'.

## Confirmation total matches the discounted checkout total
Go to checkout.
Verify checkout still shows a $208.00 subtotal, a $20.80 SAVE10 discount, and a total due of $187.20 (the same discounted total stored as checkout_total).
Fill the shipping form with valid details: name Test User, address 123 Test Street, city Testville, postal code 12345, and email or phone if those fields are required (test@example.com, 555-0100).
Place the order (use any test/dummy payment option the app offers; do not require a real card).
Verify an order confirmation is shown with an order number.
Verify the confirmation shows the SAVE10 discount of $20.80 and a total of $187.20, equal to the discounted total shown at checkout.
