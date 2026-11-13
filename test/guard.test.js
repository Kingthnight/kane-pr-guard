import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { capNote, nextAttempt, readAttempt, shouldRequestFix, stampResult, statusToExit } from "../guard/attempts.js";
import { buildFixRequest } from "../guard/fix-request.js";
import { listFlowFiles, runGuard, tokenForFixComment } from "../guard/cli.js";
import { createGitHub } from "../guard/github.js";
import { kaneArgs, missingKaneSecrets } from "../guard/runner.js";

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isolatedEnv(dir, overrides = {}) {
  const env = {
    ...process.env,
    KANE_RUNNER: "mock",
    KANE_BUG_LOG: "off",
    KANE_FIX_HANDOFF: "file",
    RESULTS_DIR: path.join(dir, "results"),
    KANE_REPORT_JSON: path.join(dir, "kane-report.json"),
    KANE_REPORT_MD: path.join(dir, "kane-report.md"),
    KANE_FIX_REQUEST: path.join(dir, "kane-fix-request.md"),
    ...overrides,
  };
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_REPOSITORY;
  delete env.PR_NUMBER;
  delete env.KANE_USERNAME;
  delete env.KANE_ACCESS_KEY;
  return env;
}

test("attempt counter resets after a pass and stops at the cap", () => {
  assert.equal(nextAttempt(null), 1);
  assert.equal(nextAttempt({ attempt: 2, status: "failed" }), 3);
  assert.equal(nextAttempt({ attempt: 4, status: "passed" }), 1);
  assert.equal(shouldRequestFix("failed", 1, 3), true);
  assert.equal(shouldRequestFix("failed", 2, 3), true);
  assert.equal(shouldRequestFix("failed", 3, 3), false);
  assert.equal(shouldRequestFix("passed", 1, 3), false);
  assert.equal(shouldRequestFix("timeout", 1, 3), true);
  assert.equal(statusToExit("passed"), 0);
  assert.equal(statusToExit("failed"), 1);
  assert.equal(statusToExit("error"), 2);
  assert.equal(statusToExit("timeout"), 3);

  const stamped = stampResult("## Kane PR Guard\n", 2, "failed");
  assert.deepEqual(readAttempt(stamped), { attempt: 2, status: "failed" });
  assert.match(capNote(3, 3), /Retry cap reached \(3\/3\)/);
});

test("fix request names the step, the reason, the run link, and the screenshot", () => {
  const body = buildFixRequest({
    agent: "@cursor",
    attempt: 1,
    maxAttempts: 3,
    branch: "cursor/kane-pr-guard-e8c4",
    baseUrl: "http://127.0.0.1:3000",
    flows: [{
      flow: "kane-flows/checkout_test.md",
      status: "failed",
      failingStep: "Fill shipping and place the order",
      reason: "Final verification failed: an order number is visible",
      link: "https://test-manager.lambdatest.com/projects/01EXAMPLE/dashboard/share/FILEURL",
      screenshot: "/tmp/results/checkout/checkout-failure-screenshot.jpg",
      expected: "Place the order and verify an order number is visible.",
    }],
  });
  assert.match(body, /@cursor/);
  assert.match(body, /Fill shipping and place the order/);
  assert.match(body, /order number is visible/);
  assert.match(body, /https:\/\/test-manager\.lambdatest\.com\/projects\/01EXAMPLE\/dashboard\/share\/FILEURL/);
  assert.match(body, /checkout-failure-screenshot\.jpg/);
  assert.match(body, /does not produce a video/);
  assert.doesNotMatch(body, /video_url/);
});

test("an existing PR comment is updated instead of duplicated", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if ((options.method || "GET") === "GET") {
      return json([{ id: 9, body: "<!-- kane-pr-guard-result attempt:1 status:failed -->\nold" }]);
    }
    return json({ id: 9, body: "updated" });
  };
  const github = createGitHub({ token: "token", repository: "acme/shop", prNumber: 4, fetchImpl });
  await github.upsert("<!-- kane-pr-guard-result", "<!-- kane-pr-guard-result attempt:2 status:passed -->\nnew");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/issues\/comments\/9$/);
  assert.equal(calls[1].method, "PATCH");

  calls.length = 0;
  const empty = createGitHub({
    token: "token",
    repository: "acme/shop",
    prNumber: 4,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      if ((options.method || "GET") === "GET") return json([]);
      return json({ id: 11 });
    },
  });
  await empty.upsert("<!-- kane-pr-guard-result", "first");
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/issues\/4\/comments$/);
});

test("kane-cli is invoked with the verifier's flags", () => {
  assert.deepEqual(kaneArgs("/repo/kane-flows/login_test.md", "http://127.0.0.1:3000", 180), [
    "testmd", "run", "/repo/kane-flows/login_test.md",
    "--agent",
    "--headless",
    "--url", "http://127.0.0.1:3000",
    "--override-start-url", "http://127.0.0.1:3000",
    "--on-lock-conflict", "wait",
    "--timeout", "180",
  ]);
});

test("local guard runs every *_test.md against the sample app", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kane-guard-"));
  const port = await freePort();
  const code = await runGuard(isolatedEnv(dir, { BASE_URL: `http://127.0.0.1:${port}` }));
  const report = JSON.parse(fs.readFileSync(path.join(dir, "kane-report.json"), "utf8"));
  assert.equal(code, 0);
  assert.equal(report.status, "passed");
  assert.equal(report.runner, "mock");
  const names = listFlowFiles(path.join(process.cwd(), "kane-flows"));
  assert.deepEqual(report.flows.map((flow) => path.basename(flow.flow)), names);
  assert.ok(names.includes("exploratory-cart_test.md"));
  assert.ok(names.includes("promo-code_test.md"));
  assert.ok(!names.includes("login.md"));
  assert.ok(report.flows.every((flow) => flow.status === "passed"));
  const markdown = fs.readFileSync(path.join(dir, "kane-report.md"), "utf8");
  assert.match(markdown, /Kane PR Guard ✅ passed/);
  assert.equal(fs.existsSync(path.join(dir, "kane-fix-request.md")), false);
});

test("a fix comment uses KANE_FIX_TOKEN when it is set", () => {
  assert.equal(tokenForFixComment({ KANE_FIX_TOKEN: "pat", GITHUB_TOKEN: "actions" }), "pat");
  assert.equal(tokenForFixComment({ GITHUB_TOKEN: "actions" }), "actions");
  assert.equal(tokenForFixComment({ KANE_FIX_TOKEN: "  ", GITHUB_TOKEN: "actions" }), "actions");
});

test("GitHub Actions refuses to start Kane without both secrets", () => {
  const message = missingKaneSecrets({
    KANE_RUNNER: "kane",
    GITHUB_ACTIONS: "true",
    KANE_USERNAME: "",
    KANE_ACCESS_KEY: "",
  });
  assert.match(message, /KANE_USERNAME and KANE_ACCESS_KEY/);
  assert.equal(missingKaneSecrets({
    KANE_RUNNER: "kane",
    GITHUB_ACTIONS: "true",
    KANE_USERNAME: "user",
    KANE_ACCESS_KEY: "key",
  }), "");
  assert.equal(missingKaneSecrets({ KANE_RUNNER: "mock", GITHUB_ACTIONS: "true" }), "");
  assert.equal(missingKaneSecrets({ KANE_RUNNER: "kane", KANE_USERNAME: "" }), "");
});

test("local guard writes a fix request when the app does not match the flows", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kane-guard-bad-"));
  const port = await freePort();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>empty</title><p>nothing here</p>");
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  try {
    const code = await runGuard(isolatedEnv(dir, {
      BASE_URL: `http://127.0.0.1:${port}`,
      KANE_FIX_AGENT: "@cursor",
      KANE_BUG_LOG: path.join(dir, "BUG_LOG.md"),
    }));
    const report = JSON.parse(fs.readFileSync(path.join(dir, "kane-report.json"), "utf8"));
    assert.equal(code, 1);
    assert.equal(report.status, "failed");
    assert.ok(report.flows.every((flow) => flow.status === "failed"));
    assert.ok(report.flows.every((flow) => flow.failingStep && flow.reason && flow.link));
    const fix = fs.readFileSync(path.join(dir, "kane-fix-request.md"), "utf8");
    assert.match(fix, /@cursor/);
    assert.match(fix, /Failing step/);
    assert.match(fix, /test-manager\.lambdatest\.com\/mock\//);
    assert.match(fix, /does not produce a video/);
    const bugLog = fs.readFileSync(path.join(dir, "BUG_LOG.md"), "utf8");
    assert.match(bugLog, /login_test\.md/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

function json(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}
