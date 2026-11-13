---
mode: testing
max_steps: 40
url: http://localhost:3000
tags: [smoke, cart]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
---

# Add two items and verify the cart badge shows 2

Builder must expose a catalog where two distinct items can be added to the
cart, and a cart badge (or equivalent count) that shows the number of items.
If the app requires auth, the imported login helper uses
`test@example.com` / `password123`.

Override the start URL in CI with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Add two items to the cart
Go to the product listing or catalog.
Add two items to the cart (two different products, or the same product twice if the app counts quantity that way — the badge must end up showing 2).
Verify a cart badge or cart count is visible and that it shows 2.
