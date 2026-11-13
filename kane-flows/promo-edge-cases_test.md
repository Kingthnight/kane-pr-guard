---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [promo, checkout]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
  lowercase_code:
    value: "save10"
  valid_code:
    value: "SAVE10"
---

# Promo edge cases: case-insensitive SAVE10, no stacking, discount recalculates after a removal

ASSUMPTION FOR BUILDER TO CONFIRM: promo codes are case-insensitive.
Applying "save10" (all lowercase) must be accepted and must apply the same
10% SAVE10 discount as "SAVE10". If Builder instead treats codes as
case-sensitive, this file will fail and the spec must be updated.

Catalog prices this flow uses (must match the sample app):
Wireless Headphones $79.00, Mechanical Keyboard $129.00.
One of each: subtotal $208.00, 10% off → discount $20.80, total $187.20.
After removing the keyboard: subtotal $79.00, 10% off → discount $7.90, total $71.10.
Rounding: half-up to the nearest cent. Discounts do not stack.

See PROMO_SPEC.md. Override the start URL with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Add two known items and read the subtotal
Go to the product listing or catalog.
Add one Wireless Headphones ($79.00) and one Mechanical Keyboard ($129.00) to the cart (one of each, not two of the same).
Open the cart.
Verify the cart contains both items and the subtotal shown is $208.00 (79.00 + 129.00).

## Lowercase save10 is accepted (case-insensitive)
Enter the promo code {{lowercase_code}} (all lowercase, not SAVE10) into the promo code field and apply it.
Verify the code is accepted as the SAVE10 promotion (not rejected as invalid).
Verify a discount of $20.80 is shown (10% of $208.00) and the discounted total due is $187.20 (208.00 × 0.90).
Do not treat a case-mismatch rejection as a pass.

## Applying SAVE10 a second time does not stack
With the 10% discount already applied, enter the promo code {{valid_code}} and apply it again.
Verify the discount does not stack to 20%.
Verify the discount is still $20.80 (not $41.60) and the total due is still $187.20 (not $166.40).
Verify only one SAVE10 discount is applied (still 10% of the $208.00 subtotal).

## Removing an item recalculates 10% of the new subtotal
Remove the Mechanical Keyboard ($129.00) from the cart, leaving only the Wireless Headphones.
Verify the subtotal updates to $79.00 (the remaining item only).
Verify SAVE10 remains applied.
Verify the discount is recalculated as 10% of the new $79.00 subtotal, so the discount is $7.90 (not the previous $20.80).
Verify the discounted total due is $71.10 (79.00 × 0.90, or 79.00 − 7.90), not $187.20 and not the undiscounted $79.00.
