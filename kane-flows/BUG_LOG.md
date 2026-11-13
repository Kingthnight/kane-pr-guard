# Kane bug log (demo)

Record every **real product bug** Kane catches against the sample app, plus the
fix and the re-run. Also record **flow / automation bugs** Kane itself flags
(`automation_bug`), clearly marked as not product defects. This log is a
judging/demo artifact.

The 13 Nov 2026 IST verifier probe (deliberate bad assertion against
https://example.com) is **not** a product bug and is not listed below. See
`README.md` and `results/probe/` for that output-format capture.

Times are Asia/Calcutta (IST).

| date IST | flow | what Kane caught | evidence / video | fix | re-run result |
| --- | --- | --- | --- | --- | --- |
| 2026-11-13 17:39 IST | exploratory-cart_test.md | After SAVE10 was applied and every item was removed, adding one new Wireless Headphones ($79.00) silently kept SAVE10: discount $7.90, total $71.10, promo field empty. Kane verdict: SAVE10 persists after an emptied cart is reused (result_code 740, application_issue/functional_defect, confidence 0.98). Earlier steps passed: whitespace ` SAVE10 ` is accepted, reload keeps cart+promo, qty increase recalculates to $258.30, empty cart blocks checkout with no negative total. Expected: a new cart after emptying has subtotal=total $79.00 and no SAVE10 unless the user re-enters the code. Actual: leftover session promoCode auto-applied ($71.10). Reproduced on a second run at 17:49 IST (same totals). | Fail [run](https://test-manager.lambdatest.com/projects/01M7A8FM58XQCJ9DPJZ9WGNGBQ/test-cases/01M7ACPV97KKB1PW2JHFPS5RQR/dashboard/share/US_WT34YXSTGS0PWE8ACKE9NGZQQ63N869NIRXJMT0J0E54PFUKHZWMV6BCWY8IJ85U?type=summary&agentView=true&fqdn=summary-page); screenshot `results/run-20261113-173422/exploratory-cart/exploratory-cart-failure-screenshot.jpg`. Session `57791417-e89a-4cef-a283-17a852a5b431`. | Commit `c63250e` (`c63250e9a49f6fcb2a3435b50cb83d8b78f6c8ae`, PR #2). `POST /cart/items/remove` in `app/server.js` (lines 142–154) now calls `retainedPromo()` from `app/pricing.js` (lines 59–63), which clears `session.promoCode` when the cart has no items left (and also clears `promoError`/`promoDraft`). Removing one of several remaining items still keeps SAVE10. | **PASSED** 2026-11-13 18:28 IST (started 18:25:38 IST, duration 148s, exit 0). [Fixed run](https://test-manager.lambdatest.com/projects/01M7A8FM58XQCJ9DPJZ9WGNGBQ/test-cases/01M7ACPV97KKB1PW2JHFPS5RQR/dashboard/share/US_DWUHRCMPZYXAL1Z2B34V7FBTA63L6MBPEQN72Z8RIJTK662W8USG8DYAYCLMT32J?type=summary&agentView=true&fqdn=summary-page); session `d933d66e-8677-4b2f-b616-3dbd77eb11fa`; after screenshot `results/run-20261113-182527/exploratory-cart/exploratory-cart-after-screenshot.jpg`. Full 8-flow regression all passed. |
| 2026-11-13 19:16 IST | free-shipping-edge-cases_test.md | **Flow bug, not an app bug.** On PR #3 (head `0405e64`), the step "Just under $50.00: USB-C Cable $49.99 pays $5.99 and shows the $0.01 hint" failed. The app was correct: USB-C Cable $49.99, Shipping $5.99, hint "Add $0.01 more for free shipping.", Total $55.98. The checkpoint was "a Shipping line is shown at $5.99 (text contains \"$5.99\"), not free shipping and not $0.00". Kane's `test_md_bug_verdict` was `automation_bug` / `config_issue`, confidence 0.97, `confirmed: false`, `result_code` 720. The "not free shipping" wording collided with the hint, which contains "for free shipping". | [GitHub Actions run 43434216667](https://github.com/Kingthnight/kane-pr-guard/actions/runs/43434216667); [Test Manager](https://test-manager.lambdatest.com/projects/01M7A8FM58XQCJ9DPJZ9WGNGBQ/test-cases/01M7AJCHCPFBT5YKQYYGDZH5EC/dashboard/share/US_LSZXZCI9VHFJ8TXZXF7E6C8LU01MMODGPRJRBKZIV8PWWIGTJCXJ1KUM8N86OPJG?type=summary&agentView=true&fqdn=summary-page); evidence `/tmp/art/results/free-shipping-edge-cases/` (copied to `results/ci-43434216667/free-shipping-edge-cases/`); screenshot `free-shipping-edge-cases-failure-screenshot.jpg`; session `76022a6f-5921-4179-a704-ab4fb706228f`. | Reworded the failing checkpoint and every similar check to assert amounts, not phrases: "the Shipping line amount is $5.99 (not $0.00)", "the hint shows Add $0.01 more", "the Total is $55.98". Dropped "not free shipping" / "no longer free" / "text contains Free shipping". Same amount-only wording applied to the promo-drop, removal, confirmation, and `$0.00`-shipping steps, and to `free-shipping_test.md`. Removed "BLOCKED until…" preambles now that the fixtures exist. | pending in CI |

## How to fill a row

- **date IST** — when Kane reported the failure, e.g. `2026-11-13 16:24 IST`.
- **flow** — the `*_test.md` file (or a `kane-cli run` objective).
- **what Kane caught** — the failed step `remark`, `run_end.reason` / `summary`, and `result_code` if present.
- **evidence / video** — `test_url` or `share_url` (Test Manager share link) and the local evidence pack path from stderr. Kane CLI 0.10.4 does not emit a video file or `video_url`.
- **fix** — what Builder changed in the app (or, if the test was wrong, what changed in the flow).
- **re-run result** — pass/fail, exit code, new `test_url`, credits used.

## 13 Nov 2026, 5:01–5:10 PM IST — first full run against the sample app

All four flows passed on the first authoring run against `http://localhost:3000`
(app from `/workspace/kane-pr-guard`, branch `cursor/kane-pr-guard-e8c4`). No
product-bug rows to add. Artifacts: `results/run-20261113-170059/`
(`summary.json`, `pr-comment.md`, per-flow NDJSON). Credits 11,163.7109 →
10,954.9662 (208.74 spent).

## 13 Nov 2026, 5:18–5:31 PM IST — promo codes + v1 regression

App commit `510b077` on `cursor/cart-promo-code-b39a` at `http://localhost:3000`.
All six flows passed (login, add-to-cart, checkout, empty-cart-guard as
replays; promo-code and promo-edge-cases first authoring). No product-bug
rows to add. Case-insensitive `save10`, no stacking, and discount
recalculation after item removal all passed as specified.

Artifacts: `results/run-20261113-171854/` (`summary.json`, `pr-comment.md`).
Credits 10,954.3699 → 10,690.9492 (263.42 spent).

## 13 Nov 2026, 6:25–6:35 PM IST — stale-promo fix regression (c63250e)

App HEAD `c63250e9a49f6fcb2a3435b50cb83d8b78f6c8ae` on `cursor/cart-promo-code-b39a`, process `node app/server.js` (pid 7073) at `http://localhost:3000`. Kane ran `exploratory-cart_test.md` first as a fresh/healed run (needed a new pass/fail on the changed last step, plus a Test Manager share link for the demo), then the other seven `*_test.md` flows as replays.

All eight passed. No new product bugs. The leftover-SAVE10 case now shows subtotal and total due **$79.00** with an empty promo field and no discount line.

Artifacts: `results/run-20261113-182527/` (`summary.json`, `pr-comment.md`, `run-meta.json`, after screenshot). Demo write-up: `DEMO_BUG_STORY.md`. Credits 9,810.6492 → 9,521.068 (289.58 spent). Replay flows did not upload new share links (expected; upload skipped on cheap replays).

## 13 Nov 2026, 7:16 PM IST — shipping-flow assertion (automation_bug)

PR #3 head `0405e64`, GitHub Actions run
[43434216667](https://github.com/Kingthnight/kane-pr-guard/actions/runs/43434216667).
`free-shipping-edge-cases_test.md` failed at **Just under $50.00**. The cart
was correct (Shipping $5.99, hint Add $0.01 more for free shipping., Total
$55.98). Kane classified it as a flow bug (`automation_bug`, confidence
0.97), not a product defect. The checkpoint "not free shipping" clashed
with the hint copy. Flows were reworded to amount-only assertions; re-run
is pending after Builder commits them to PR #3.
