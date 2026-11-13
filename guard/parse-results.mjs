#!/usr/bin/env node
/**
 * Parse Kane CLI --agent NDJSON (and the evidence pack) into a machine-readable
 * summary plus a Markdown PR-comment body.
 *
 * Adapted from the verifier reference parser `parse-results.mjs` (Kane PR Guard,
 * 13 Nov 2026 IST probes). Credit: the test teammate. The zip/screenshot walk,
 * the comment shape, and event-only inference are theirs.
 *
 * Adaptation: when `--exit-code` is passed, that code wins.
 *   0 passed, 1 failed, 2 error, 3 timeout.
 * Exit 2 and 3 stay distinct from an assertion failure even if a partial
 * `run_end` was written. With no `--exit-code`, inference matches the reference
 * (completion event first, exit code only as a fallback).
 *
 * Usage:
 *   node guard/parse-results.mjs [options] <events.ndjson> [more.ndjson ...]
 *
 * Options:
 *   --stderr <file>        Kane stderr log (repeatable). Also auto-detected as
 *                          <ndjson>.stderr, <ndjson>.stderr.log, or stderr.log
 *                          next to the NDJSON file.
 *   --evidence <pack>      Path to a .evidence zip (overrides discovery).
 *   --extract-dir <dir>    Where to write the failure screenshot (default:
 *                          same directory as the NDJSON file).
 *   --flow <name>          Override the flow name (single-input only).
 *   --json-only            Print only the JSON summary (includes `comment`).
 *   --markdown             Print only the Markdown PR-comment body.
 *   --exit-code <n>        Process exit code from kane-cli, if you already have
 *                          it. Otherwise inferred from the completion event.
 *
 * No npm dependencies. Requires no Kane re-run.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const USAGE = `Usage: node parse-results.mjs [options] <events.ndjson> [...]
  --stderr <file>      Kane stderr (also auto-detected next to the NDJSON)
  --evidence <pack>    Path to a .evidence zip
  --extract-dir <dir>  Directory for the extracted failure screenshot
  --flow <name>        Override flow name (single input)
  --json-only          Print only JSON
  --markdown           Print only the PR-comment Markdown
  --exit-code <n>      kane-cli process exit code`;

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    stderrs: [],
    evidence: null,
    extractDir: null,
    flow: null,
    jsonOnly: false,
    markdown: false,
    exitCode: null,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) die(`Missing value for ${a}\n${USAGE}`);
      return v;
    };
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--stderr") opts.stderrs.push(next());
    else if (a === "--evidence") opts.evidence = next();
    else if (a === "--extract-dir") opts.extractDir = next();
    else if (a === "--flow") opts.flow = next();
    else if (a === "--exit-code") opts.exitCode = Number(next());
    else if (a === "--json-only") opts.jsonOnly = true;
    else if (a === "--markdown") opts.markdown = true;
    else if (a.startsWith("-")) die(`Unknown option ${a}\n${USAGE}`);
    else opts.files.push(a);
  }
  if (opts.files.length === 0) die(USAGE);
  return opts;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    die(`Cannot read ${file}: ${err.message}`);
  }
}

function parseNdjson(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip non-JSON (progress leaks, banners)
    }
  }
  return events;
}

function last(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return null;
}

function flowNameFromFile(file) {
  const base = path.basename(file);
  return base
    .replace(/\.ndjson$/i, "")
    .replace(/\.json$/i, "")
    .replace(/_test$/, "")
    .replace(/\.events$/, "")
    .replace(/^events$/, path.basename(path.dirname(file)));
}

function sidecarStderrPaths(ndjsonPath) {
  const dir = path.dirname(ndjsonPath);
  const base = path.basename(ndjsonPath);
  const stem = base.replace(/\.ndjson$/i, "");
  return [
    path.join(dir, `${stem}.stderr`),
    path.join(dir, `${stem}.stderr.log`),
    path.join(dir, "stderr.log"),
    path.join(dir, "stderr.txt"),
  ];
}

function evidencePathFromStderr(text) {
  if (!text) return null;
  // e.g. evidence: view locally with `kane-cli evidence serve /path/to/id.evidence`
  const tick = text.match(/kane-cli evidence serve\s+`([^`]+)`/);
  if (tick) return tick[1].trim();
  const bare = text.match(/kane-cli evidence serve\s+(\S+\.evidence)/);
  if (bare) return bare[1].trim();
  return null;
}

function inferStatus(events, exitCode) {
  // A supplied process exit code is the gate. 2 and 3 are not assertion fails.
  if (exitCode === 0) return "passed";
  if (exitCode === 1) return "failed";
  if (exitCode === 2) return "error";
  if (exitCode === 3) return "timeout";

  const done = last(events, (e) => e && e.type === "test_md_done");
  if (done) return done.overall_status || done.status || null;
  const tr = last(events, (e) => e && (e.type === "testrun_done" || e.type === "remote_done"));
  if (tr) return tr.status || tr.overall_status || null;
  const end = last(events, (e) => e && e.type === "run_end");
  if (end) return end.status || null;
  if (exitCode == null || Number.isNaN(exitCode)) return "unknown";
  return "error";
}

function failingStepFromEvents(events) {
  // Prefer a typed testmd step end if present, else a run-stream failed line.
  const typed = last(
    events,
    (e) =>
      e &&
      (e.type === "test_md_step_end" || e.type === "step_end") &&
      (e.status === "failed" || e.overall_status === "failed")
  );
  if (typed) {
    return (
      typed.heading ||
      typed.name ||
      typed.step_name ||
      typed.remark ||
      typed.reason ||
      (typeof typed.step === "number" ? `step ${typed.step}` : null)
    );
  }
  const line = last(
    events,
    (e) => e && e.status === "failed" && (e.remark || e.message) && e.type !== "run_end"
  );
  if (line) return line.remark || line.message;
  return null;
}

function summarizeOne(ndjsonPath, opts) {
  const events = parseNdjson(readText(ndjsonPath));
  const done = last(events, (e) => e && e.type === "test_md_done");
  const end = last(events, (e) => e && e.type === "run_end");
  const coverage = last(events, (e) => e && e.type === "coverage" && e.pack);

  const status = inferStatus(events, opts.exitCode);
  const failed = status === "failed" || status === "timeout" || status === "error";

  const reason =
    (end && (end.reason || end.one_liner || end.summary)) ||
    (done && (done.reason || done.summary || done.one_liner)) ||
    null;
  const reasonCode = (end && end.reason_code) || (done && done.reason_code) || null;
  const resultCode = (end && end.result_code) || (done && done.result_code) || null;
  const link =
    (done && done.share_url) ||
    (end && end.test_url) ||
    (done && done.test_url) ||
    null;
  const sessionDir = (end && end.session_dir) || (done && done.session_dir) || null;
  const failingStep = failed ? failingStepFromEvents(events) : null;
  const credits =
    (done && done.credits_consumed) ?? (end && end.credits_consumed) ?? null;
  const duration =
    (done && done.duration_s) ?? (end && end.duration) ?? null;

  // Discover the evidence pack.
  let evidence = opts.evidence || null;
  const stderrs = [...(opts.stderrs || [])];
  for (const cand of sidecarStderrPaths(ndjsonPath)) {
    if (fs.existsSync(cand)) stderrs.push(cand);
  }
  let stderrText = "";
  for (const s of stderrs) {
    if (fs.existsSync(s)) stderrText += readText(s) + "\n";
  }
  if (!evidence) evidence = evidencePathFromStderr(stderrText);
  if (!evidence && coverage && coverage.pack) evidence = coverage.pack;
  if (!evidence && sessionDir) {
    const evDir = path.join(sessionDir, "evidence");
    if (fs.existsSync(evDir)) {
      const packs = fs
        .readdirSync(evDir)
        .filter((f) => f.endsWith(".evidence"))
        .map((f) => path.join(evDir, f));
      if (packs.length) evidence = packs[packs.length - 1];
    }
  }

  let screenshot = null;
  let screenshotInPack = null;
  let evidenceError = null;
  if (failed && evidence && fs.existsSync(evidence)) {
    try {
      const found = extractFailureScreenshot(
        evidence,
        opts.extractDir || path.dirname(path.resolve(ndjsonPath)),
        flowNameFromFile(ndjsonPath)
      );
      screenshot = found.extracted;
      screenshotInPack = found.inPack;
    } catch (err) {
      evidenceError = err.message;
    }
  } else if (failed && evidence && !fs.existsSync(evidence)) {
    evidenceError = `evidence pack not found: ${evidence}`;
  }

  return {
    flow: opts.flow || flowNameFromFile(ndjsonPath),
    status: status || "unknown",
    failingStep: failingStep,
    reason: reason,
    reasonCode,
    resultCode,
    link,
    screenshot,
    screenshotInPack,
    evidencePack: evidence,
    sessionDir,
    creditsConsumed: credits,
    duration,
    exitCode: opts.exitCode ?? null,
    source: path.resolve(ndjsonPath),
    ...(evidenceError ? { evidenceError } : {}),
  };
}

/* ---------------- zip (no dependencies; store + deflate) ---------------- */

function readU32(buf, off) {
  return buf.readUInt32LE(off);
}
function readU16(buf, off) {
  return buf.readUInt16LE(off);
}

function openZip(filePath) {
  const buf = fs.readFileSync(filePath);
  // End of central directory: 0x06054b50, then comment length at +20.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (readU32(buf, i) === 0x06054b50) {
      const commentLen = readU16(buf, i + 20);
      if (i + 22 + commentLen === buf.length) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) throw new Error(`not a zip (no EOCD): ${filePath}`);
  const cdOff = readU32(buf, eocd + 16);
  const cdSize = readU32(buf, eocd + 12);
  const entries = [];
  let p = cdOff;
  const cdEnd = cdOff + cdSize;
  while (p < cdEnd) {
    if (readU32(buf, p) !== 0x02014b50) break;
    const method = readU16(buf, p + 10);
    const compSize = readU32(buf, p + 20);
    const uncompSize = readU32(buf, p + 24);
    const nameLen = readU16(buf, p + 28);
    const extraLen = readU16(buf, p + 30);
    const commentLen = readU16(buf, p + 32);
    const localOff = readU32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compSize, uncompSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  function extract(name) {
    const ent = entries.find((e) => e.name === name);
    if (!ent) throw new Error(`zip entry not found: ${name}`);
    const lo = ent.localOff;
    if (readU32(buf, lo) !== 0x04034b50) throw new Error(`bad local header: ${name}`);
    const nameLen = readU16(buf, lo + 26);
    const extraLen = readU16(buf, lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const compact = buf.slice(start, start + ent.compSize);
    if (ent.method === 0) return Buffer.from(compact);
    if (ent.method === 8) return zlib.inflateRawSync(compact);
    throw new Error(`unsupported zip method ${ent.method} for ${name}`);
  }
  return { entries, extract };
}

function yamlPathValue(text, key) {
  // Very small YAML getter for "    path: tests/.../failure.yaml"
  const re = new RegExp(String.raw`(?:^|\n)[ \t]*${key}:[ \t]*(\S[^\n]*)`, "m");
  const m = text.match(re);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function extractFailureScreenshot(packPath, extractDir, flowStem) {
  const zip = openZip(packPath);
  const names = zip.entries.map((e) => e.name);

  let inPack = null;

  // 1. Root failure.yaml lists failures[].path → sibling screenshot.jpg
  if (names.includes("failure.yaml")) {
    const root = zip.extract("failure.yaml").toString("utf8");
    // May list several; take the first with a path.
    const paths = [...root.matchAll(/(?:^|\n)[ \t]*path:[ \t]*(\S[^\n]*)/g)].map((m) =>
      m[1].trim().replace(/^['"]|['"]$/g, "")
    );
    for (const pth of paths) {
      const shot = pth.replace(/failure\.yaml$/, "screenshot.jpg");
      if (names.includes(shot)) {
        inPack = shot;
        break;
      }
    }
  }

  // 2. Any per-step failure.yaml; page_state.screenshot is relative to the test dir.
  if (!inPack) {
    const stepFailures = names.filter((n) => /\/steps\/[^/]+\/failure\.yaml$/.test(n));
    for (const failPath of stepFailures) {
      const dir = failPath.replace(/\/failure\.yaml$/, "");
      const shot = `${dir}/screenshot.jpg`;
      if (names.includes(shot)) {
        inPack = shot;
        break;
      }
    }
  }

  // 3. Fallback: step.json with "status": "failed"
  if (!inPack) {
    for (const n of names.filter((x) => /\/steps\/[^/]+\/step\.json$/.test(x))) {
      try {
        const st = JSON.parse(zip.extract(n).toString("utf8"));
        if (st && st.status === "failed") {
          const shot = n.replace(/step\.json$/, "screenshot.jpg");
          if (names.includes(shot)) {
            inPack = shot;
            break;
          }
        }
      } catch {
        // ignore unreadable step.json
      }
    }
  }

  if (!inPack) {
    throw new Error("no failure screenshot found inside evidence pack");
  }

  fs.mkdirSync(extractDir, { recursive: true });
  const outName = `${flowStem}-failure-screenshot.jpg`;
  const outPath = path.join(extractDir, outName);
  fs.writeFileSync(outPath, zip.extract(inPack));
  return { extracted: path.resolve(outPath), inPack };
}

function overallStatus(summaries) {
  const order = ["timeout", "error", "failed", "unknown", "passed"];
  let best = "passed";
  for (const s of summaries) {
    if (order.indexOf(s.status) !== -1 && order.indexOf(s.status) < order.indexOf(best)) {
      best = s.status;
    }
  }
  return best;
}

function formatComment(summaries) {
  const overall = overallStatus(summaries);
  const icon = { passed: "✅", failed: "❌", timeout: "⏱️", error: "⚠️", unknown: "❓" }[overall] || "•";
  const lines = [];
  lines.push(`## Kane PR Guard ${icon} ${overall}`);
  lines.push("");
  if (summaries.length > 1) {
    lines.push(`Overall: **${overall}** (${summaries.length} flows)`);
    lines.push("");
  }
  for (const s of summaries) {
    const si = { passed: "✅", failed: "❌", timeout: "⏱️", error: "⚠️", unknown: "❓" }[s.status] || "•";
    lines.push(`### ${si} ${s.flow} — ${s.status}`);
    if (s.failingStep) lines.push(`- **Failing step:** ${s.failingStep}`);
    if (s.reason) lines.push(`- **Reason:** ${s.reason}`);
    if (s.reasonCode || s.resultCode) {
      const bits = [];
      if (s.reasonCode) bits.push(s.reasonCode);
      if (s.resultCode != null) bits.push(`result_code ${s.resultCode}`);
      lines.push(`- **Code:** ${bits.join(", ")}`);
    }
    if (s.link) lines.push(`- **Run:** [Open in Test Manager](${s.link})`);
    else lines.push(`- **Run:** no Test Manager link (upload may have failed)`);
    if (s.screenshot) {
      lines.push(`- **Screenshot:** \`${path.basename(s.screenshot)}\` (attached from the evidence pack)`);
    } else if (s.status === "failed") {
      lines.push(`- **Screenshot:** not found in the evidence pack${s.evidenceError ? ` (${s.evidenceError})` : ""}`);
    }
    if (s.duration != null) lines.push(`- **Duration:** ${s.duration}s`);
    lines.push("");
  }
  lines.push("_No video is produced by Kane CLI 0.10.4. The Test Manager link and the failure screenshot are the artifacts for this comment._");
  return lines.join("\n");
}

export {
  parseNdjson,
  summarizeOne,
  formatComment,
  inferStatus,
  overallStatus,
  failingStepFromEvents,
  extractFailureScreenshot,
  evidencePathFromStderr,
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summaries = opts.files.map((f, i) =>
    summarizeOne(f, {
      ...opts,
      flow: opts.files.length === 1 ? opts.flow : opts.flow && i === 0 ? opts.flow : undefined,
    })
  );

  const comment = formatComment(summaries);
  const payload =
    summaries.length === 1
      ? { ...summaries[0], comment }
      : { status: overallStatus(summaries), flows: summaries, comment };

  if (opts.markdown && opts.jsonOnly) die("Use only one of --markdown or --json-only");
  if (opts.markdown) {
    process.stdout.write(comment + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  if (!opts.jsonOnly) {
    process.stdout.write("\n--- PR COMMENT ---\n" + comment + "\n");
  }
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

if (invokedDirectly()) main();
