---
mode: testing
max_steps: 40
url: http://localhost:3000
tags: [smoke, cart, checkout]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
---

# Empty-cart guard: checkout is blocked with a message when the cart is empty

Builder must block checkout when the cart has no items and show a clear
message (for example "Your cart is empty"). Do not place an order in this
flow.

Override the start URL in CI with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Ensure the cart is empty
Open the cart. If any items are present, remove them all so the cart is empty.
Verify the cart is empty (empty-cart state or a count of 0).

## Checkout is blocked
Try to go to checkout or place an order with the empty cart.
Verify checkout does not complete, no order is placed, and a visible message is shown that the cart is empty or that checkout cannot continue until items are added.
