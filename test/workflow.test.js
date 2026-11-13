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
  assert.match(text, /KANE_RUNNER: kane/);
  assert.doesNotMatch(text, /LT_USERNAME|LT_ACCESS_KEY/);
  assert.doesNotMatch(text, /password123|KANE_ACCESS_KEY:\s*[^$\s]/);
});
