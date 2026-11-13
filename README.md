# Kane PR Guard

**Kane tests every pull request in a real browser, and your coding agent fixes what it breaks, until it's green.**

Built for the KaneCLI Hackathon (November 2026). The coding agent is Cursor. Verification is [Kane CLI](https://github.com/LambdaTest/kane-cli) 0.10.4.

Every pull request starts the Northwind Supply sample shop, runs plain-English Kane CLI flows against it in headless Chrome, and posts one comment with the result. A failure becomes a fix request for the coding agent. The agent's push hits `synchronize`, the guard runs again, and the same comment is updated. The loop stops after 3 attempts (change it with `KANE_MAX_ATTEMPTS`).

Kane CLI 0.10.4 does not produce a video. The comment shows the Test Manager run link, the failing step and reason, and the failure screenshot extracted from the evidence pack.

```mermaid
flowchart TD
  pr[Pull request opened or synchronized] --> app[Guard starts the shop]
  app --> auth["CI: kane-cli login with KANE_USERNAME and KANE_ACCESS_KEY"]
  auth --> run["kane-cli testmd run each flow"]
  run --> parse[Parser reads NDJSON and the failure screenshot]
  parse --> comment[Update the single PR comment]
  comment --> gate{All flows passed?}
  gate -->|yes| done[Check is green]
  gate -->|no| cap{Attempt under the cap?}
  cap -->|yes| agent["Fix request to @cursor with step, reason, link, screenshot"]
  agent --> push[Agent pushes to the PR branch]
  push --> pr
  cap -->|no| stop[Leave the last failure and do not ask again]
```

## Try it

You don't need a Kane account to see the report. With Node.js 18 or newer:

```bash
npm install
KANE_RUNNER=mock npm run guard
```

The mock runner checks the shop over HTTP instead of a real browser, so it shows the comment format, not a real Kane verdict. For real Kane runs, follow [Install](#install) and drop `KANE_RUNNER=mock`.

## What Kane caught

All times are 13 Nov 2026, India Standard Time (IST). These are real runs on this repo, including the ones where we were wrong.

### 1. A real money bug: SAVE10 survived an empty cart ([PR #2](https://github.com/Kingthnight/kane-pr-guard/pull/2))

At 17:39, the exploratory cart flow applied `SAVE10`, emptied the cart, and added one Wireless Headphones ($79.00). The promo box was blank, but the order summary still took $7.90 off and billed **$71.10**. Kane classified it as a product defect (`result_code` 740, confidence 0.98), and a second run at 17:49 reproduced the same totals.

The cause: `POST /cart/items/remove` in `app/server.js` removed the item but left `session.promoCode` in place, and the empty-cart view hid the promo field. Commit `c63250e` calls a new `retainedPromo()` from `app/pricing.js`, which drops the code once the cart is empty. Our build agent wrote that fix; this one did not go through the `@cursor` loop. Kane re-ran the flow at 18:28 and it passed ($79.00 due, no discount line), then the rest of the suite passed as replays.

- [Failing run (17:39)](https://test-manager.lambdatest.com/projects/01M7A8FM58XQCJ9DPJZ9WGNGBQ/test-cases/01M7ACPV97KKB1PW2JHFPS5RQR/dashboard/share/US_WT34YXSTGS0PWE8ACKE9NGZQQ63N869NIRXJMT0J0E54PFUKHZWMV6BCWY8IJ85U?type=summary&agentView=true&fqdn=summary-page)
- [Passing run (18:28)](https://test-manager.lambdatest.com/projects/01M7A8FM58XQCJ9DPJZ9WGNGBQ/test-cases/01M7ACPV97KKB1PW2JHFPS5RQR/dashboard/share/US_DWUHRCMPZYXAL1Z2B34V7FBTA63L6MBPEQN72Z8RIJTK662W8USG8DYAYCLMT32J?type=summary&agentView=true&fqdn=summary-page)

### 2. Kane said the bug was in our test, not the app ([PR #3](https://github.com/Kingthnight/kane-pr-guard/pull/3), attempt 1)

PR #3 adds free shipping at $50. At 19:16, on commit `0405e64`, the "just under $50" check failed. The app was right: $5.99 shipping, the hint "Add $0.01 more for free shipping.", and a $55.98 total. Kane labelled the failure `automation_bug` / `config_issue` with confidence 0.97, because our step said "not free shipping" and that wording collided with the hint text on the page. We reworded the flows to check amounts only.

That attempt also exposed a bug in the guard itself. Its first `@cursor` fix request at 19:31 was ignored, because a hidden marker came before the mention. Commit `9273530`, directed by a person through our build agent, moved `@cursor` to the first line and fixed the flow wording.

### 3. The agent fixed a gap from the guard's request ([PR #3](https://github.com/Kingthnight/kane-pr-guard/pull/3), attempts 2 and 3)

At 20:23:41, the guard run on `9273530` failed (`result_code` 750): the empty cart showed no Shipping or Total lines. The guard edited its fix request in place. cursor[bot] replied at 20:23:47 and pushed `09f0480` at 20:24:35, so the empty cart now shows Shipping $0.00 and Total $0.00, is still not billed, and still blocks checkout. The push re-ran the guard, and attempt 3 passed in [Actions run 43447263367](https://github.com/Kingthnight/kane-pr-guard/actions/runs/43447263367), finishing at 21:02. PR #3 was merged into `main` as `0ecbc5e`.

Once the trigger was fixed, this loop ran with no human relaying the request. Two caveats, to be precise: Cursor routed the request to PR #3's existing agent rather than starting a new one, and our build agent had earlier told that agent to act on guard requests. A manual "@cursor reply ok" comment at 20:07 was only a connectivity test and changed no code.

## What the PR comment shows

The guard keeps one result comment per pull request and updates it on every run. On a failure it shows the status, the failing flow and step, Kane's reason, the Test Manager run link, and the failure screenshot from the evidence pack (uploaded with the job artifacts). Before the attempt cap, it also posts or updates a separate fix request that starts with `@cursor`. See the result and fix comments on [PR #3](https://github.com/Kingthnight/kane-pr-guard/pull/3) for real examples.

## Built with

- **Cursor** writes code and answers the guard's `@cursor` fix requests on the pull request.
- **Kane CLI 0.10.4** (`@testmuai/kane-cli`) runs the plain-English flows in headless Chrome, reports NDJSON with `--agent`, and says whether a failure is a product defect or an automation bug.
- **The guard** (`guard/`, `.github/workflows/kane-pr-guard.yml`) starts the shop, runs every flow, writes the comment, and enforces the attempt cap.

## Install

Requires Node.js 18 or newer. Real Kane runs also need Google Chrome and
a TestMu AI account. The guard uses the `kane-cli` binary when it is on
`PATH`. If the binary is missing, `npm run guard` uses an HTTP mock so
you can still see the report. Set `KANE_RUNNER=kane` in CI so a missing
binary fails the job instead of pretending Kane ran.

1. Install the shop and the guard:

   ```bash
   npm install
   ```

2. Install Kane CLI and log in (skip this only if you want the mock):

   ```bash
   npm install -g @testmuai/kane-cli
   export PATH="$(npm prefix -g)/bin:$PATH"
   kane-cli login
   ```

3. Confirm the binary:

   ```bash
   kane-cli --version
   ```

## Run the shop

```bash
npm start
```

The app listens on port **3000**. Override it with `PORT`. Open
[http://localhost:3000](http://localhost:3000).

Seeded user, matching the flows:

| Field | Value |
| --- | --- |
| Email | `test@example.com` |
| Password | `password123` |
| Wrong password | `wrong-password-xyz` |

Shipping values the checkout flow types: name `Test User`, address
`123 Test Street`, city `Testville`, postal code `12345`, email
`test@example.com`, phone `555-0100`.

Promo code `SAVE10` (any letter case) takes 10% off the cart subtotal.
Enter it on the cart page and press Apply. The discount is rounded
half-up to the cent and does not stack if the code is applied again.
Any other code shows "Invalid promo code." and leaves the current total
in place. Removing one item while others remain keeps the code and
recalculates. Emptying the cart drops it, so the next item is full price
until the code is applied again. Checkout and the order confirmation
show the subtotal, the discount, and the total due.
Shipping is a flat $5.99, and free when the merchandise total after any promo discount is $50.00 or more.

## Run the guard locally

The guard starts the shop if nothing is already healthy at `BASE_URL`,
runs the flows, prints the comment, and writes `kane-report.json` plus
`kane-report.md`.

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
export BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
npm run guard
```

Mock, when Kane CLI is not installed:

```bash
KANE_RUNNER=mock npm run guard
```

Run one flow the way CI does:

```bash
kane-cli testmd run kane-flows/login_test.md \
  --agent --headless \
  --url "$BASE_URL" \
  --override-start-url "$BASE_URL" \
  --on-lock-conflict wait \
  --timeout 180
```

Or the whole suite, which writes `kane-flows/results/combined.json`:

```bash
BASE_URL=http://127.0.0.1:3000 kane-flows/run-all.sh
```

Parse a saved NDJSON stream:

```bash
node guard/parse-results.mjs --markdown results/login/events.ndjson
```

## Demo flows

| File | What it checks |
| --- | --- |
| `kane-flows/login_test.md` | Wrong password shows an error, then the seeded user lands on the dashboard |
| `kane-flows/add-to-cart_test.md` | After sign-in, two items make the cart badge show 2 |
| `kane-flows/checkout_test.md` | Shipping form, place order, confirmation with an order number |
| `kane-flows/empty-cart-guard_test.md` | Empty cart blocks checkout and does not place an order |
| `kane-flows/promo-code_test.md` | `BOGUS` is rejected, `SAVE10` takes 10% off, confirmation matches checkout |
| `kane-flows/promo-edge-cases_test.md` | Lowercase `save10` is accepted, a second apply does not stack, removing an item recalculates |
| `kane-flows/exploratory-cart_test.md` | Spaces, reload, quantity change, and a new cart after emptying must not keep a hidden promo |
| `kane-flows/free-shipping_test.md` | Empty cart has no shipping charge, a $79.00 cart has Shipping $0.00, and the confirmation matches cart and checkout |
| `kane-flows/free-shipping-edge-cases_test.md` | SAVE10 on $79.00 keeps Shipping $0.00, $49.99 pays $5.99 with the "Add $0.01 more" hint, exactly $50.00 ships free, SAVE10 drops $50.00 below the threshold ($50.99 total), and removing an item crosses back under |
| `kane-flows/helpers/login.md` | Shared sign-in imported by the cart and checkout flows. Not an entry point |

The guard runs every `kane-flows/*_test.md` file. Helpers under
`kane-flows/helpers/` are imports, not entry points. `kane-flows/SHIPPING_SPEC.md` is the free-shipping
contract the two shipping flows assert on: flat $5.99, $0.00 at a
merchandise total of $50.00 or more after any SAVE10 discount, no charge
on an empty cart, and checks on exact amounts rather than the phrase
"free shipping". `npm test` covers
the shop, the NDJSON parser, the comment body, the attempt cap, the
per-flow early exit, and a local mock run of those flows.

## Pull request loop

`.github/workflows/kane-pr-guard.yml` runs on `pull_request` `opened` and
`synchronize`. It installs Chrome and `@testmuai/kane-cli`, puts the
global npm bin on `PATH`, logs in, and runs `npm run guard`.

The guard posts one comment, found by the marker `kane-pr-guard-result`,
and updates that comment on later runs. The visible body is the reference
parser's: status, failing step, reason, Test Manager link, screenshot
file name. Kane CLI 0.10.4 has no video field. The JPEG extracted from
the evidence pack is uploaded with the job artifacts (`results/` and
`.testmuai/evidence/`), because the GitHub issue-comment API has no
binary attachment field.

`test_md_done` is the end of a flow. Run 43419883242 wrote that event for
`login_test.md` (`overall_status: passed`, with a `share_url`) and then
`kane-cli` never exited, so the next flow never started and Actions
cancelled the job about 27 minutes later. The guard now reads that event,
keeps the result, sends SIGTERM, then SIGKILL a few seconds later, and
moves on. A per-flow wall clock (`KANE_FLOW_WALL_SECS`, default 10
minutes) records a timeout instead of waiting. The job `timeout-minutes`
is 80. If Actions still cancels the job, `guard-finished` fails, so a
cancellation is not a green check.

On a failure before the attempt cap, the guard also writes
`kane-fix-request.md` and posts or updates one fix comment that mentions
the coding agent. The default mention is `@cursor`. The comment includes
the failing flow, the flow file as the expected behavior, the actual
failing step and reason, the run link, and the screenshot path.

| Variable | Default | Role |
| --- | --- | --- |
| `KANE_MAX_ATTEMPTS` | `3` | Guard runs before it stops asking for a fix. A repository variable overrides CI. |
| `KANE_FIX_AGENT` | `@cursor` | Mention in the fix comment. A repository variable overrides CI. |
| `KANE_FIX_HANDOFF` | `comment` | `comment`, `file`, `none`, or a module path that exports `handoff({ body, report })`. |
| `KANE_RUNNER` | `kane` if the binary exists, otherwise `mock` | CI sets `kane`. |
| `TIMEOUT_SECS` | `180` | Passed to Kane as `--timeout`. This does not kill a stuck `kane-cli`. |
| `KANE_FLOW_WALL_SECS` | `600` | Per-flow wall clock. On expiry the flow is a timeout and the next one starts. |
| `BASE_URL` | `http://127.0.0.1:3000` | `--url` and `--override-start-url`. |

A passing re-run replaces the fix comment with a short note that does
not mention the agent again. Assertion failures are also appended to
`BUG_LOG.md`.

## Secrets

Add these in the repository under Settings → Secrets and variables →
Actions. Do not commit them and do not echo them.

| Secret | Needed for | Status |
| --- | --- | --- |
| `KANE_USERNAME` | `kane-cli login` on the runner | Set. Run 43419883242 logged in (`kane-cli login ok`, Authenticated, Token valid) at 11:48:18Z. |
| `KANE_ACCESS_KEY` | `kane-cli login` on the runner | Set. Same run; the value is masked in the log. |
| `KANE_FIX_TOKEN` | Posting the `@cursor` fix comment as a GitHub user | Set. On PR #3, the fix request posted as Kingthnight (not `github-actions[bot]`), and cursor[bot] answered it. It is a PAT that can create and update pull request comments (`pull-requests: write` on this repo). |

`GITHUB_TOKEN` is provided by Actions. The workflow grants
`pull-requests: write`, and the guard uses it for the result comment.
A local login (`kane-cli login`) stores a profile under
`~/.testmuai/kaneai/` and does not need the Kane secrets.

On GitHub Actions, if `KANE_RUNNER=kane` and either Kane secret is missing,
the guard exits 2 before starting `kane-cli`. That path is a backstop.
The 13 Nov hang was not a missing secret.

### Why the fix comment needs `KANE_FIX_TOKEN`

Cursor staff have said this is intentional, not a bug: comments from bots
and GitHub Apps, including `github-actions[bot]` using the default
`GITHUB_TOKEN`, are filtered out of PR comment triggers before the
trigger settings are checked. A comment that mentions `@cursor` and is
posted by Actions does not start a Cursor agent. Sources, all on
forum.cursor.com:

- [Github Actions commenting @cursor not being detected](https://forum.cursor.com/t/github-actions-commenting-cursor-not-being-detected/148135) (staff, 6 Jan 2026: use a PAT so the comment is posted by a real user)
- [Automations — reacting to bot PR comments](https://forum.cursor.com/t/automations-reacting-to-bot-pr-comments/159297) (staff, 1 May 2026: bots are filtered to avoid chained triggers; a PAT is the workaround when you control the workflow)
- [Do Issue comment automations accept github-actions[bot]?](https://forum.cursor.com/t/do-issue-comment-automations-accept-github-actions-bot-when-set-to-anyone/170940) (staff, 8 Sep 2026: the same filter applies even when the trigger is set to Anyone)

What we confirmed: the `@cursor` trigger works on this repo. On PR #3,
attempt 2's fix request (posted with `KANE_FIX_TOKEN`) got a reply from
cursor[bot] 6 seconds later and a fix commit in under a minute. What we
could not confirm from the secret store: `gh secret list` returned 403, so
"set" above comes from run logs and the comment author, not from the
secrets API.

When `KANE_FIX_TOKEN` is set, only the fix-request comment uses it. The
result comment stays on `GITHUB_TOKEN`. When it is unset, the fix
request still posts as `github-actions[bot]` and names that limitation
in the job log.

Optional repository variables: `KANE_MAX_ATTEMPTS`, `KANE_FIX_AGENT`.

## Kane CLI contract

Confirmed against the verifier's Kane CLI 0.10.4 notes and the public
docs at <https://www.testmuai.com/docs/kane-cli-cli-reference>:

- Package: `@testmuai/kane-cli`. Command: `kane-cli`. Node 18+.
- `kane-cli testmd run <file>_test.md` is the command for a committed flow. `kane-cli run` is one-shot and rejects `.md` paths.
- Always pass `--agent` (NDJSON on stdout, one JSON object per line, `v: 1`) and `--headless` (Chrome has no window in CI).
- Pass/fail for a file is `test_md_done.overall_status`. Step `run_end` events are not the file result. The shareable link is `test_md_done.share_url`, else `run_end.test_url`.
- Exit codes: `0` passed, `1` failed, `2` error (the run may have no completion event), `3` timeout or cancel. The guard treats 2 and 3 as `error` and `timeout`, not as an assertion failure.
- Evidence packs are zip files ending in `.evidence`. The path is printed on stderr: ``evidence: view locally with `kane-cli evidence serve <path>` ``. The failure screenshot is the `screenshot.jpg` next to the `failure.yaml` entry inside that zip. Packs contain screenshots and logs, not video.
- CI auth is one `kane-cli login --username "$KANE_USERNAME" --access-key "$KANE_ACCESS_KEY"` at the start of the job, then `kane-cli whoami`. Per-run `--username` / `--access-key` also exist. This repo uses the login command.
- `output-<stem>/` next to a flow is the replay cache. Commit it after the first successful authoring run so later CI can replay. Do not commit `.testmuai/evidence/`.

Not confirmed from the public flag reference fetched on 13 Nov 2026:
`--override-start-url` is not listed there (`--url` is). The verifier's
working 0.10.4 command passes both, and this guard does too. If a future
CLI rejects the flag, the run exits 2 and the comment shows `error`.
