# Free shipping — behavior the Kane flows expect

Builder: implement this contract in the sample app, and add the two fixture
products below, so `free-shipping_test.md` and
`free-shipping-edge-cases_test.md` can pass on PR #3. Do not treat these
flows as a full pass against today's two-product catalog: the $49.99 /
$50.00 boundaries are blocked until the fixtures exist.

## Rule

- Flat shipping is **$5.99**.
- Shipping is **FREE ($0.00)** when the merchandise subtotal **after** any
  SAVE10 discount is **>= $50.00 inclusive**. With no code applied, that
  figure is the raw merchandise subtotal.
- An **empty cart has no shipping charge** (do not bill $5.99).
- Currency is USD, `$X.XX`. Amounts are rounded to cents. SAVE10 discount =
  `round_half_up(subtotal × 0.10, 2)`. Discounted subtotal = subtotal −
  discount. **Total** = discounted subtotal + shipping.

## Copy (match loosely; amounts exactly)

- Cart, checkout, and order confirmation show a **Shipping** line and a
  **Total**.
- At or above the threshold: the page contains **"Free shipping"** and the
  shipping amount is **$0.00**.
- Below the threshold: shipping is **$5.99**, and a hint contains
  **"Add $X.XX more"**, where `X.XX = 50.00 − discounted_subtotal`
  (already in cents for the cases below). Suggested full hint:
  `Add $X.XX more for free shipping.`
- Do not require a specific label string beyond those substrings.

## Catalog

Already in the app:

| Product | SKU | Unit price |
| --- | --- | --- |
| Wireless Headphones | `headphones` | $79.00 |
| Mechanical Keyboard | `keyboard` | $129.00 |

**Add these fixtures** (exact name and price; the edge-case flow looks them
up by name). They are required because no combination of $79.00 / $129.00
can produce a merchandise total of $49.99 or $50.00, and SAVE10 on the
cheapest current item still leaves $71.10, which stays above $50.00.
There is no price editor in the shop; do not invent other products.

| Product | SKU | Unit price | Why |
| --- | --- | --- | --- |
| USB-C Cable | `usb-cable` | $49.99 | Just under $50.00; remainder after a removal crosses under |
| Desk Pad | `desk-pad` | $50.00 | Exactly $50.00; SAVE10 drops it to $45.00 |

## Worked totals the tests assert

| Cart | Code | Subtotal | Discount | After discount | Ship | Hint | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Empty | — | — | — | — | no $5.99 charge | — | no $5.99 due |
| 1× Headphones | none | $79.00 | — | $79.00 | Free $0.00 | none | $79.00 |
| 1× Headphones | SAVE10 | $79.00 | $7.90 | $71.10 | Free $0.00 | none | $71.10 |
| 1× USB-C Cable | none | $49.99 | — | $49.99 | $5.99 | Add $0.01 more | $55.98 |
| 1× Desk Pad | none | $50.00 | — | $50.00 | Free $0.00 | none | $50.00 |
| 1× Desk Pad | SAVE10 | $50.00 | $5.00 | $45.00 | $5.99 | Add $5.00 more | $50.99 |
| Cable + Desk Pad | none | $99.99 | — | $99.99 | Free $0.00 | none | $99.99 |
| After removing Desk Pad (Cable only) | none | $49.99 | — | $49.99 | $5.99 | Add $0.01 more | $55.98 |

`free-shipping_test.md` covers empty cart, the $79.00 over-threshold case,
and confirmation match at $79.00 / Free $0.00.

`free-shipping-edge-cases_test.md` covers SAVE10-on-$79 still free, then the
fixture cases (just under, exactly $50, SAVE10 drop with confirmation at
$50.99, removal crossing under).

Seeded user and address values are unchanged: `test@example.com` /
`password123`; name `Test User`, address `123 Test Street`, city
`Testville`, postal code `12345`, phone `555-0100`.
