---
mode: testing
max_steps: 50
url: http://localhost:3000
tags: [smoke, checkout]
variables:
  email:
    value: "test@example.com"
  password:
    value: "password123"
    secret: true
---

# Checkout: place an order and see a confirmation with an order number

Builder must provide a shipping form, a way to place the order (payment may
be a test/dummy gateway or skipped in the sample app), and a confirmation
page that shows an order number. Use these shipping values when the form
asks for them: name "Test User", address "123 Test Street", city "Testville",
postal code "12345", email test@example.com, phone 555-0100. Skip any field
the form does not have.

Override the start URL in CI with `--url "$BASE_URL" --override-start-url "$BASE_URL"`.

## Sign in
@import ./helpers/login.md

## Add an item to the cart
Go to the product listing or catalog and add at least one item to the cart.
Verify the cart is no longer empty (badge or cart page shows at least 1 item).

## Fill shipping and place the order
Go to checkout. Fill the shipping form with valid details: name Test User, address 123 Test Street, city Testville, postal code 12345, and email or phone if those fields are required (test@example.com, 555-0100).
Place the order (use any test/dummy payment option the app offers; do not require a real card).
Verify an order confirmation is shown and that an order number is visible on the page.
