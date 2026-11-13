#!/usr/bin/env node
/**
 * Local and CI entry point.
 *
 *   npm run guard
 *
 * Starts the sample app when it is not already healthy, runs every
 * kane-flows/*_test.md file, writes kane-report.json and kane-report.md,
 * and (when GITHUB_TOKEN and PR_NUMBER are set) updates a single pull
 * request comment. The fix-request comment uses KANE_FIX_TOKEN when that
 * secret is set, so the author is a GitHub user rather than github-actions[bot].
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { capNote, nextAttempt, readAttempt, shouldRequestFix, stampResult, statusToExit } from "./attempts.js";
import { buildFixRequest, expectedFromFlow } from "./fix-request.js";
import { commentHasMarker, createGitHub } from "./github.js";
import { handoff } from "./handoff.js";
import { runMockFlow } from "./mock-runner.js";
import { formatComment, overallStatus, summarizeOne } from "./parse-results.mjs";
import { loginIfConfigured, missingKaneSecrets, prependNpmBin, runKaneFlow, selectRunner } from "./runner.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function listFlowFiles(flowsDir) {
  return fs.readdirSync(flowsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith("_test.md"))
    .map((entry) => entry.name)
    .sort();
}

export function tokenForFixComment(env) {
  return nonempty(env.KANE_FIX_TOKEN) || nonempty(env.GITHUB_TOKEN);
}

export async function runGuard(env = process.env) {
  prependNpmBin(env);
  const baseUrl = nonempty(env.BASE_URL) || "http://127.0.0.1:3000";
  const timeoutSecs = numberOr(env.TIMEOUT_SECS, 180);
  const maxAttempts = numberOr(env.KANE_MAX_ATTEMPTS, 3);
  const agent = nonempty(env.KANE_FIX_AGENT) || "@cursor";
  const flowsDir = nonempty(env.KANE_FLOWS_DIR) || path.join(repoRoot, "kane-flows");
  const resultsDir = nonempty(env.RESULTS_DIR) || path.join(repoRoot, "results");
  const reportJson = nonempty(env.KANE_REPORT_JSON) || path.join(repoRoot, "kane-report.json");
  const reportMd = nonempty(env.KANE_REPORT_MD) || path.join(repoRoot, "kane-report.md");
  const fixPath = nonempty(env.KANE_FIX_REQUEST) || path.join(repoRoot, "kane-fix-request.md");
  const startedAt = new Date().toISOString();
  const flows = listFlowFiles(flowsDir).map((name) => path.join(flowsDir, name));

  let app;
  try {
    app = await ensureApp(baseUrl, env);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  let runner;
  try {
    runner = await selectRunner(env);
    const missing = missingKaneSecrets({ ...env, KANE_RUNNER: runner === "kane" ? "kane" : env.KANE_RUNNER });
    if (missing) throw new Error(missing);
    if (runner === "kane") {
      const login = await loginIfConfigured(env, repoRoot);
      if (login.loggedIn) console.error(`kane-cli login ok\n${login.whoami}`);
      else console.error("kane-cli login skipped (KANE_USERNAME / KANE_ACCESS_KEY unset; using the saved profile)");
    } else {
      console.error("kane-cli is not on PATH; using the mock runner. The real path is `kane-cli testmd run`.");
    }
  } catch (error) {
    console.error(error.message);
    if (error.stderr) console.error(error.stderr);
    await app.stop();
    return 2;
  }

  const summaries = [];
  try {
    for (const flowPath of flows) {
      const stem = path.basename(flowPath).replace(/_test\.md$/, "");
      const ndjsonPath = path.join(resultsDir, stem, "events.ndjson");
      const stderrPath = path.join(resultsDir, stem, "stderr.log");
      const exitCode = runner === "mock"
        ? await runMockFlow({ flowPath, baseUrl, ndjsonPath, stderrPath })
        : await runKaneFlow({
          flowPath,
          baseUrl,
          timeoutSecs,
          ndjsonPath,
          stderrPath,
          env,
          cwd: repoRoot,
        });
      const summary = summarizeOne(ndjsonPath, {
        exitCode,
        stderrs: [stderrPath],
        flow: path.relative(repoRoot, flowPath),
      });
      summaries.push(summary);
      console.error(`${summary.flow} ${summary.status} (exit ${exitCode})`);
    }
  } finally {
    await app.stop();
  }

  const status = overallStatus(summaries);
  const exitCode = statusToExit(status);
  const github = githubClient(env);
  const fixGithub = fixGithubClient(env);
  const previous = await previousAttempt(github);
  const attempt = nextAttempt(previous);

  let comment = formatComment(summaries);
  comment += `\nAttempt ${attempt} of ${maxAttempts}.\n`;
  if (runner === "mock") {
    comment += "\n> Local mock runner: Kane CLI was not on PATH. The run links are placeholders and no evidence pack was produced.\n";
  }
  if (status !== "passed" && attempt >= maxAttempts) comment += capNote(attempt, maxAttempts);
  const stamped = stampResult(comment, attempt, status);

  const report = {
    baseUrl,
    runner,
    attempt,
    maxAttempts,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    exitCode,
    flows: summaries.map((summary) => ({
      flow: summary.flow,
      status: summary.status,
      failingStep: summary.failingStep,
      reason: summary.reason,
      link: summary.link,
      screenshot: summary.screenshot,
      exitCode: summary.exitCode,
      evidencePack: summary.evidencePack || null,
      duration: summary.duration,
      ndjson: summary.source,
    })),
  };

  fs.mkdirSync(path.dirname(path.resolve(reportJson)), { recursive: true });
  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMd, stamped);
  console.log(stamped);
  console.error(`Wrote ${reportJson}`);

  if (github) {
    try {
      await github.upsert("<!-- kane-pr-guard-result", stamped);
    } catch (error) {
      console.error(`Could not update the PR comment: ${error.message}`);
    }
  }

  if (shouldRequestFix(status, attempt, maxAttempts)) {
    const failing = summaries.filter((summary) => summary.status !== "passed").map((summary) => ({
      ...summary,
      expected: readExpected(path.join(flowsDir, path.basename(summary.flow))),
    }));
    const body = buildFixRequest({ agent, attempt, maxAttempts, branch: env.PR_HEAD_REF || "", baseUrl, flows: failing });
    try {
      if (fixGithub && nonempty(env.KANE_FIX_TOKEN)) {
        console.error("Posting the fix request with KANE_FIX_TOKEN so the comment author is a GitHub user.");
      } else if (fixGithub) {
        console.error("Posting the fix request with GITHUB_TOKEN. github-actions[bot] comments are filtered by Cursor and do not start an agent. Set the KANE_FIX_TOKEN secret to a user PAT.");
      }
      const result = await handoff({
        mode: nonempty(env.KANE_FIX_HANDOFF) || "comment",
        body,
        github: fixGithub,
        filePath: fixPath,
        report,
      });
      if (!result.posted && result.filePath) console.error(`Wrote fix request to ${result.filePath}`);
      else if (!result.posted) console.error(body);
    } catch (error) {
      console.error(`Fix handoff failed: ${error.message}`);
    }
  } else if (status === "passed" && fixGithub) {
    await clearFixComment(fixGithub, attempt);
  }

  appendBugLog(env, report);
  return exitCode;
}

function githubClient(env) {
  return githubClientWith(env.GITHUB_TOKEN, env);
}

function fixGithubClient(env) {
  return githubClientWith(tokenForFixComment(env), env);
}

function githubClientWith(token, env) {
  if (!nonempty(token) || !nonempty(env.GITHUB_REPOSITORY) || !nonempty(env.PR_NUMBER)) return null;
  return createGitHub({
    token,
    repository: env.GITHUB_REPOSITORY,
    prNumber: env.PR_NUMBER,
  });
}

async function previousAttempt(github) {
  if (!github) return null;
  try {
    const comments = await github.listComments();
    const existing = comments.find((comment) => comment.body && comment.body.includes("<!-- kane-pr-guard-result"));
    return readAttempt(existing?.body);
  } catch (error) {
    console.error(`Could not read the existing PR comment: ${error.message}`);
    return null;
  }
}

async function clearFixComment(github, attempt) {
  try {
    const comments = await github.listComments();
    const existing = comments.find((comment) => commentHasMarker(comment.body, "<!-- kane-pr-guard-fix"));
    if (!existing) return;
    await github.upsert(
      "<!-- kane-pr-guard-fix",
      `<!-- kane-pr-guard-fix -->\nThe latest Kane PR Guard run passed on attempt ${attempt}. No code change is requested.\n`
    );
  } catch (error) {
    console.error(`Could not update the fix comment: ${error.message}`);
  }
}

function readExpected(flowPath) {
  try {
    return expectedFromFlow(fs.readFileSync(flowPath, "utf8"));
  } catch {
    return "";
  }
}

function appendBugLog(env, report) {
  if (env.KANE_BUG_LOG === "off") return;
  const failures = report.flows.filter((flow) => flow.status === "failed");
  if (failures.length === 0) return;
  const file = nonempty(env.KANE_BUG_LOG) || path.join(repoRoot, "BUG_LOG.md");
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  const lines = ["", `## ${when} IST — attempt ${report.attempt} (${report.runner})`, ""];
  for (const failure of failures) {
    lines.push(`- **Flow:** ${failure.flow}`);
    lines.push(`- **What Kane caught:** ${failure.failingStep || failure.reason || failure.status}`);
    lines.push(`- **Reason:** ${failure.reason || ""}`);
    lines.push(`- **Link:** ${failure.link || ""}`);
    lines.push(`- **Screenshot:** ${failure.screenshot || ""}`);
    lines.push("- **Fix:**");
    lines.push("- **Re-run:**");
    lines.push("");
  }
  fs.appendFileSync(file, `${lines.join("\n")}\n`);
}

async function ensureApp(baseUrl, env) {
  if (await isHealthy(baseUrl)) {
    console.error(`Using the app already running at ${baseUrl}`);
    return { async stop() {} };
  }
  const url = new URL(baseUrl);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const appEnv = { ...env, PORT: port };
  delete appEnv.KANE_ACCESS_KEY;
  delete appEnv.GITHUB_TOKEN;
  const child = spawn(process.execPath, [path.join(repoRoot, "app", "server.js")], {
    env: appEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    if (await isHealthy(baseUrl)) {
      return {
        async stop() {
          if (child.exitCode != null) return;
          child.kill("SIGTERM");
          await Promise.race([
            once(child, "close"),
            delay(2000).then(() => {
              if (child.exitCode == null) child.kill("SIGKILL");
            }),
          ]);
        },
      };
    }
    await delay(150);
  }
  if (child.exitCode == null) child.kill("SIGTERM");
  throw new Error(`Sample app did not become healthy at ${baseUrl}\n${logs.join("")}`);
}

async function isHealthy(baseUrl) {
  try {
    const response = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function nonempty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runGuard()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(2);
    });
}
