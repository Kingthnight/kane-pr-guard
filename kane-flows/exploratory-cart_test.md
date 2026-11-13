---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [exploratory, promo, cart]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
---

# Exploratory cart: whitespace codes, reload, quantity change, leftover promo after emptying

These cases were not in the original promo flows or PROMO_SPEC.md. Catalog:
Wireless Headphones $79.00, Mechanical Keyboard $129.00.

Override the start URL with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Add two items, apply SAVE10 with surrounding spaces, and reload
Go to the product listing or catalog.
Add one Wireless Headphones ($79.00) and one Mechanical Keyboard ($129.00) to the cart (one of each).
Open the cart.
In the promo code field, type a leading space, then SAVE10, then a trailing space (the value must be the eight characters of SAVE10 with a space before and after, not the trimmed code alone), and apply it.
Verify the code is accepted as SAVE10 and the subtotal is $208.00, the discount is $20.80, and the total due is $187.20.
Reload or refresh the cart page (do not log out).
Verify both items are still in the cart, SAVE10 is still applied, and the totals are still subtotal $208.00, discount $20.80, total due $187.20.

## Increasing quantity recalculates the 10% discount
From the product listing, add one more Wireless Headphones so the cart has two headphones and one keyboard.
Open the cart.
Verify the quantity of Wireless Headphones is 2 and the cart badge shows 3.
Verify the subtotal is $287.00 (79.00 × 2 + 129.00), the SAVE10 discount is $28.70 (exactly 10% of 287.00), and the total due is $258.30 (287.00 × 0.90), not the previous $187.20.

## Emptying the cart blocks checkout with no negative total, and a new cart must not keep a hidden promo
Remove every item from the cart so the cart is empty (remove both the headphones and the keyboard).
Verify the cart shows it is empty and the cart badge is 0.
Verify no negative total is shown, and no discount amount such as $28.70 or $20.80 remains visible as a due total.
Go to checkout.
Verify checkout is blocked with a message that the cart is empty, no order is placed, and no negative total is shown.
Go back to products and add only one Wireless Headphones ($79.00), then open the cart.
Verify this is a new cart with only that item.
Verify the subtotal is $79.00.
Verify SAVE10 is not still silently applied from the previous emptied cart: the total due must be $79.00, and there must not be a $7.90 SAVE10 discount unless the user has just entered and applied the code again on this new cart.
