# Free shipping — behavior the Kane flows expect

Builder: this is the contract `free-shipping_test.md` and
`free-shipping-edge-cases_test.md` assert on PR #3. The catalog includes
Wireless Headphones, Mechanical Keyboard, and the two boundary fixtures
(USB-C Cable $49.99, Desk Pad $50.00).

Kane flows assert Shipping and Total **amounts**, not the phrases
"free shipping" or "not free shipping". The below-threshold hint is
`Add $X.XX more for free shipping.`, so a "not free shipping" check
collides with that copy (CI run 43434216667; see BUG_LOG.md).

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
- At or above the threshold: the **Shipping line amount is $0.00**
  (not $5.99). The UI may also say "Free shipping"; the Kane flows
  assert the amount, not that phrase.
- Below the threshold: the **Shipping line amount is $5.99** (not $0.00),
  and the hint shows **"Add $X.XX more"**, where
  `X.XX = 50.00 − discounted_subtotal` (already in cents for the cases
  below). Suggested full hint: `Add $X.XX more for free shipping.`
  Assert the hint's dollar amount (`Add $0.01 more`, `Add $5.00 more`);
  do not assert "not free shipping".
- Do not require a specific label string beyond those amount checks.

## Catalog

The catalog, including the two boundary fixtures:

| Product | SKU | Unit price | Role |
| --- | --- | --- | --- |
| Wireless Headphones | `headphones` | $79.00 | Over-threshold carts |
| Mechanical Keyboard | `keyboard` | $129.00 | Over-threshold carts |
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
