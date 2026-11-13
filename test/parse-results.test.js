import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  evidencePathFromStderr,
  formatComment,
  inferStatus,
  overallStatus,
  parseNdjson,
  summarizeOne,
} from "../guard/parse-results.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const parser = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../guard/parse-results.mjs");

function storeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("skips non-JSON lines and keeps Kane events", () => {
  const events = parseNdjson(fs.readFileSync(path.join(fixtures, "fail.ndjson"), "utf8"));
  assert.equal(events.length, 2);
  assert.equal(events[0].status, "failed");
  assert.equal(events[1].type, "run_end");
});

test("probe failure matches the verifier's comment fields", () => {
  const summary = summarizeOne(path.join(fixtures, "fail.ndjson"), {});
  assert.equal(summary.flow, "fail");
  assert.equal(summary.status, "failed");
  assert.equal(
    summary.failingStep,
    "assert: the main heading says This Text Does Not Exist Anywhere On The Page"
  );
  assert.equal(
    summary.reason,
    'Final verification failed: "the main heading says This Text Does Not Exist Anywhere On The Page"'
  );
  assert.match(summary.link, /^https:\/\/test-manager\.lambdatest\.com\//);
  assert.equal(summary.reasonCode, "assertion_error.final_verification");
  assert.equal(summary.resultCode, 710);
  assert.equal(summary.screenshot, null);
});

test("a passing run_end has no failing step and links test_url", () => {
  const summary = summarizeOne(path.join(fixtures, "pass.ndjson"), {});
  assert.equal(summary.status, "passed");
  assert.equal(summary.failingStep, null);
  assert.equal(summary.reason, "Objective completed");
  assert.match(summary.link, /summary-page/);
  const comment = formatComment([summary]);
  assert.match(comment, /## Kane PR Guard ✅ passed/);
  assert.match(comment, /Open in Test Manager/);
  assert.match(comment, /No video is produced by Kane CLI 0\.10\.4/);
  assert.doesNotMatch(comment, /video_url/);
  assert.doesNotMatch(comment, /Failing step/);
});

test("test_md_done.overall_status wins over a step run_end, and share_url is the link", () => {
  const passed = summarizeOne(path.join(fixtures, "testmd-pass.ndjson"), {});
  assert.equal(passed.status, "passed");
  assert.equal(passed.failingStep, null);
  assert.equal(passed.link, "https://test-manager.lambdatest.com/projects/FILE/dashboard/share/file-pass");

  const failed = summarizeOne(path.join(fixtures, "testmd-fail.ndjson"), {});
  assert.equal(failed.status, "failed");
  assert.equal(failed.failingStep, "Fill shipping and place the order");
  assert.equal(failed.link, "https://test-manager.lambdatest.com/projects/01EXAMPLE/test-cases/01FILE/dashboard/share/FILEURL");
  assert.match(failed.reason, /order number is visible/);

  const comment = formatComment([passed, failed]);
  assert.match(comment, /## Kane PR Guard ❌ failed/);
  assert.match(comment, /Fill shipping and place the order/);
  assert.match(comment, /FILEURL/);
  assert.match(comment, /\*\*Screenshot:\*\* not found in the evidence pack/);
  assert.match(comment, /No video/);
});

test("exit codes 2 and 3 are error and timeout, separate from fail", () => {
  const file = path.join(fixtures, "fail.ndjson");
  assert.equal(summarizeOne(file, { exitCode: 2 }).status, "error");
  assert.equal(summarizeOne(file, { exitCode: 3 }).status, "timeout");
  assert.equal(summarizeOne(file, { exitCode: 1 }).status, "failed");
  assert.equal(summarizeOne(file, { exitCode: 0 }).status, "passed");
  assert.equal(summarizeOne(path.join(fixtures, "empty.ndjson"), { exitCode: 2 }).status, "error");
  assert.equal(summarizeOne(path.join(fixtures, "empty.ndjson"), { exitCode: 3 }).status, "timeout");
  assert.equal(inferStatus([], null), "unknown");
  assert.equal(
    overallStatus([{ status: "failed" }, { status: "timeout" }, { status: "error" }]),
    "timeout"
  );
  const comment = formatComment([summarizeOne(path.join(fixtures, "empty.ndjson"), { exitCode: 3 })]);
  assert.match(comment, /⏱️ timeout/);
  assert.doesNotMatch(comment, /❌ failed/);
});

test("stderr hint and failure.yaml both yield the failure screenshot", () => {
  const hint = "evidence: view locally with `kane-cli evidence serve /tmp/packs/run.evidence`\n";
  assert.equal(evidencePathFromStderr(hint), "/tmp/packs/run.evidence");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kane-shot-"));
  const shot = Buffer.from("jpeg-bytes-not-a-real-image");
  const failureYaml = [
    "failures:",
    "  - test: checkout",
    "    ordinal: 4",
    "    step: 0-4",
    "    path: tests/checkout/steps/4-0-4/failure.yaml",
    "",
  ].join("\n");
  const pack = path.join(dir, "run.evidence");
  fs.writeFileSync(
    pack,
    storeZip([
      { name: "failure.yaml", data: failureYaml },
      { name: "tests/checkout/steps/4-0-4/failure.yaml", data: "page_state:\n  screenshot: steps/4-0-4/screenshot.jpg\n" },
      { name: "tests/checkout/steps/4-0-4/screenshot.jpg", data: shot },
      { name: "tests/checkout/steps/4-0-4/step.json", data: JSON.stringify({ status: "failed", id: "0-4", ordinal: 4 }) },
    ])
  );
  const ndjson = path.join(dir, "events.ndjson");
  fs.copyFileSync(path.join(fixtures, "testmd-fail.ndjson"), ndjson);
  const summary = summarizeOne(ndjson, { evidence: pack, flow: "checkout_test.md" });
  assert.equal(summary.status, "failed");
  assert.equal(summary.screenshotInPack, "tests/checkout/steps/4-0-4/screenshot.jpg");
  assert.equal(fs.readFileSync(summary.screenshot).equals(shot), true);
  assert.match(path.basename(summary.screenshot), /failure-screenshot\.jpg$/);

  const comment = formatComment([summary]);
  assert.match(comment, /attached from the evidence pack/);
  assert.match(comment, /Open in Test Manager/);
  assert.match(comment, /No video is produced by Kane CLI 0\.10\.4/);
});

test("the CLI prints JSON and the Markdown comment", () => {
  const json = spawnSync(process.execPath, [parser, "--json-only", path.join(fixtures, "fail.ndjson")], {
    encoding: "utf8",
  });
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.status, "failed");
  assert.match(payload.comment, /Kane PR Guard/);
  assert.match(payload.link, /test-manager\.lambdatest\.com/);

  const md = spawnSync(process.execPath, [parser, "--markdown", path.join(fixtures, "pass.ndjson"), path.join(fixtures, "fail.ndjson")], {
    encoding: "utf8",
  });
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /Overall: \*\*failed\*\*/);
  assert.match(md.stdout, /No video is produced by Kane CLI 0\.10\.4/);
});
