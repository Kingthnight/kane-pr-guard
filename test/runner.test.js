import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { doneEventFromLine, exitCodeForDone, runCaptured } from "../guard/runner.js";

test("only a test_md_done line completes a flow", () => {
  assert.equal(doneEventFromLine('{"type":"run_end","status":"passed"}'), null);
  assert.equal(doneEventFromLine("not json"), null);
  const event = doneEventFromLine('{"type":"test_md_done","overall_status":"passed","share_url":"https://example.test/run"}');
  assert.equal(event.overall_status, "passed");
  assert.equal(exitCodeForDone(event), 0);
  assert.equal(exitCodeForDone({ type: "test_md_done", overall_status: "failed" }), 1);
  assert.equal(exitCodeForDone({ type: "test_md_done", overall_status: "error" }), 2);
  assert.equal(exitCodeForDone({ type: "test_md_done", overall_status: "timeout" }), 3);
  assert.equal(exitCodeForDone({ type: "test_md_done", overall_status: "cancelled" }), 3);
});

test("test_md_done ends a process that keeps running", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kane-runner-"));
  const pidPath = path.join(dir, "pid");
  const script = `
    const fs = require("node:fs");
    fs.writeFileSync(process.argv[1], String(process.pid));
    console.log(JSON.stringify({ type: "run_end", status: "passed" }));
    console.log(JSON.stringify({ type: "test_md_done", overall_status: "passed", share_url: "https://example.test/done" }));
    setInterval(() => {}, 1000);
  `;
  const started = Date.now();
  const code = await runCaptured(process.execPath, ["-e", script, pidPath], {
    cwd: dir,
    stdoutPath: path.join(dir, "events.ndjson"),
    stderrPath: path.join(dir, "stderr.log"),
    wallMs: 20_000,
    graceMs: 300,
  });
  const elapsed = Date.now() - started;
  assert.equal(code, 0);
  assert.ok(elapsed < 5000, `returned in ${elapsed}ms`);
  const ndjson = fs.readFileSync(path.join(dir, "events.ndjson"), "utf8");
  assert.match(ndjson, /"type":"test_md_done"/);
  const pid = Number(fs.readFileSync(pidPath, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.throws(() => process.kill(pid, 0));
});

test("a flow with no test_md_done times out instead of hanging", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kane-runner-"));
  const pidPath = path.join(dir, "pid");
  const script = `
    const fs = require("node:fs");
    fs.writeFileSync(process.argv[1], String(process.pid));
    console.log(JSON.stringify({ type: "run_end", status: "passed" }));
    setInterval(() => {}, 1000);
  `;
  const started = Date.now();
  const code = await runCaptured(process.execPath, ["-e", script, pidPath], {
    cwd: dir,
    stdoutPath: path.join(dir, "events.ndjson"),
    stderrPath: path.join(dir, "stderr.log"),
    wallMs: 400,
    graceMs: 200,
  });
  const elapsed = Date.now() - started;
  assert.equal(code, 3);
  assert.ok(elapsed < 4000, `returned in ${elapsed}ms`);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "events.ndjson"), "utf8"), /test_md_done/);
  const pid = Number(fs.readFileSync(pidPath, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.throws(() => process.kill(pid, 0));
});
