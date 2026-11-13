import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const file = ".github/workflows/kane-pr-guard.yml";

test("the Kane workflow is valid YAML and uses the documented secrets", () => {
  const text = fs.readFileSync(file, "utf8");
  const doc = parse(text);
  assert.equal(doc.name, "Kane PR Guard");
  assert.deepEqual(doc.on.pull_request.types, ["opened", "synchronize"]);
  assert.equal(doc.permissions["pull-requests"], "write");
  assert.equal(doc.jobs.guard.steps.some((step) => step.run && step.run.includes("npm run guard")), true);
  assert.match(text, /secrets\.KANE_USERNAME/);
  assert.match(text, /secrets\.KANE_ACCESS_KEY/);
  assert.match(text, /secrets\.KANE_FIX_TOKEN/);
  assert.match(text, /KANE_RUNNER: kane/);
  assert.equal(doc.jobs.guard["timeout-minutes"], 80);
  const guardStep = doc.jobs.guard.steps.find((step) => step.run && step.run.includes("npm run guard"));
  assert.equal(guardStep["timeout-minutes"], 75);
  assert.equal(doc.jobs["guard-finished"].needs, "guard");
  assert.match(String(doc.jobs["guard-finished"].if), /cancelled/);
  assert.doesNotMatch(text, /LT_USERNAME|LT_ACCESS_KEY/);
  assert.doesNotMatch(text, /password123|KANE_ACCESS_KEY:\s*[^$\s]/);
});
