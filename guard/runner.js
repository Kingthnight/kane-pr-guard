/**
 * Real Kane CLI 0.10.4 invocation. Flags match the verifier's working command.
 * `--override-start-url` is part of that command. The public flag page fetched
 * on 13 Nov 2026 lists `--url` and not this flag; the guard still passes both
 * because that is what Kane 0.10.4 accepted on the verifier workstation.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function prependNpmBin(env) {
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8", env }).trim();
    const bin = path.join(prefix, "bin");
    const parts = String(env.PATH || "").split(path.delimiter).filter(Boolean);
    if (!parts.includes(bin)) env.PATH = [bin, ...parts].join(path.delimiter);
  } catch {
    // npm is missing; kane-cli may already be on PATH.
  }
  return env;
}

export function commandExists(name, env = process.env) {
  return String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => fs.existsSync(path.join(dir, name)));
}

export function kaneArgs(flowPath, baseUrl, timeoutSecs) {
  return [
    "testmd", "run", flowPath,
    "--agent",
    "--headless",
    "--url", baseUrl,
    "--override-start-url", baseUrl,
    "--on-lock-conflict", "wait",
    "--timeout", String(timeoutSecs),
  ];
}

export async function selectRunner(env = process.env) {
  const forced = String(env.KANE_RUNNER || "").trim();
  const available = commandExists("kane-cli", env);
  if (forced === "mock") return "mock";
  if (forced === "kane" && !available) {
    throw new Error("KANE_RUNNER=kane but kane-cli is not on PATH. Install with: npm install -g @testmuai/kane-cli");
  }
  if (forced && forced !== "kane") {
    throw new Error(`Unknown KANE_RUNNER=${forced}. Use "kane" or "mock".`);
  }
  return available ? "kane" : "mock";
}

/**
 * GitHub Actions has no saved Kane profile. An empty secret must fail the
 * job instead of letting kane-cli sit on a prompt. Local runs may still
 * use the profile from `kane-cli login`.
 */
export function missingKaneSecrets(env) {
  if (String(env.KANE_RUNNER || "").trim() !== "kane") return "";
  if (String(env.GITHUB_ACTIONS || "") !== "true") return "";
  const username = String(env.KANE_USERNAME || "").trim();
  const accessKey = String(env.KANE_ACCESS_KEY || "").trim();
  if (username && accessKey) return "";
  return "KANE_USERNAME and KANE_ACCESS_KEY must both be set to run Kane on GitHub Actions. Add the repository secrets and re-run. The guard will not start kane-cli without them.";
}

export async function loginIfConfigured(env, cwd) {
  const username = String(env.KANE_USERNAME || "").trim();
  const accessKey = String(env.KANE_ACCESS_KEY || "").trim();
  if (!username || !accessKey) return { loggedIn: false };
  const login = await spawnCapture("kane-cli", ["login", "--username", username, "--access-key", accessKey], env, cwd, 60_000);
  if (login.code !== 0) {
    const error = new Error(login.timedOut ? "kane-cli login timed out" : "kane-cli login failed");
    error.stderr = redact(login.stderr, accessKey);
    throw error;
  }
  const who = await spawnCapture("kane-cli", ["whoami"], env, cwd, 60_000);
  if (who.code !== 0) {
    const error = new Error(who.timedOut ? "kane-cli whoami timed out after login" : "kane-cli whoami failed after login");
    error.stderr = redact(who.stderr, accessKey);
    throw error;
  }
  return { loggedIn: true, whoami: who.stdout.trim() };
}

/**
 * Kane's `--timeout` is not a hard kill of the CLI process. Run 43419883242
 * wrote test_md_done for login and then left kane-cli alive until Actions
 * cancelled the job ~27 minutes later. The wall clock is our own cap.
 * Ten minutes covers the longest flow seen so far (exploratory, ~317s).
 */
export function flowWallMs(timeoutSecs, env = process.env) {
  const explicit = Number(env.KANE_FLOW_WALL_SECS);
  if (Number.isFinite(explicit) && explicit > 0) return explicit * 1000;
  const kane = Number(timeoutSecs);
  const floor = Number.isFinite(kane) && kane > 0 ? (kane + 120) * 1000 : 0;
  return Math.max(floor, 10 * 60 * 1000);
}

export function doneEventFromLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const event = JSON.parse(trimmed);
    if (event && event.type === "test_md_done") return event;
  } catch {
    return null;
  }
  return null;
}

/** Map test_md_done.overall_status onto the exit codes the parser already trusts. */
export function exitCodeForDone(event) {
  const status = String(event?.overall_status || event?.status || "").toLowerCase();
  if (status === "passed") return 0;
  if (status === "failed") return 1;
  if (status === "timeout" || status === "cancelled" || status === "canceled") return 3;
  if (status === "error") return 2;
  return 1;
}

export function runKaneFlow({ flowPath, baseUrl, timeoutSecs, ndjsonPath, stderrPath, env, cwd }) {
  const args = kaneArgs(flowPath, baseUrl, timeoutSecs);
  return runCaptured("kane-cli", args, {
    env,
    cwd,
    stdoutPath: ndjsonPath,
    stderrPath,
    wallMs: flowWallMs(timeoutSecs, env),
  });
}

export function redact(text, secret) {
  if (!secret) return text;
  return String(text).split(secret).join("[redacted]");
}

function spawnCapture(command, args, env, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { env, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: 2, stdout: "", stderr: error.message, timedOut: false });
      return;
    }
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 3000);
      finish({
        code: 2,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}\ncommand timed out after ${timeoutMs}ms\n`,
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish({ code: 2, stdout: "", stderr: error.message, timedOut: false }));
    child.on("close", (code) => {
      finish({
        code: code ?? 2,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut: false,
      });
    });
  });
}

/**
 * Run a Kane flow (or a test double) until test_md_done, the process exits,
 * or the wall clock fires. The promise resolves on that event. It does not
 * wait for a CLI that has already printed test_md_done to exit on its own.
 *
 * graceMs is the gap between SIGTERM and SIGKILL. The default is a few seconds
 * so a trailing evidence path on stderr can land before the process is killed.
 */
export function runCaptured(command, args, {
  env,
  cwd,
  stdoutPath,
  stderrPath,
  wallMs,
  graceMs = 3000,
}) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
    fs.mkdirSync(path.dirname(stderrPath), { recursive: true });
    fs.writeFileSync(stdoutPath, "");
    fs.writeFileSync(stderrPath, "");
    let child;
    try {
      child = spawn(command, args, { env, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      fs.appendFileSync(stderrPath, `${error.message}\n`);
      resolve(2);
      return;
    }

    let settled = false;
    let decided = null;
    let pendingOut = "";
    const wall = setTimeout(() => stop(3), wallMs);

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(wall);
      resolve(code);
    };

    function stop(code) {
      if (decided != null) return;
      decided = code;
      killTree(child, "SIGTERM");
      setTimeout(() => {
        killTree(child, "SIGKILL");
        finish(decided);
      }, graceMs);
    }

    child.stdout.on("data", (chunk) => {
      fs.appendFileSync(stdoutPath, chunk);
      pendingOut += chunk.toString("utf8");
      let nl = pendingOut.indexOf("\n");
      while (nl >= 0) {
        const line = pendingOut.slice(0, nl);
        pendingOut = pendingOut.slice(nl + 1);
        const event = doneEventFromLine(line);
        if (event) stop(exitCodeForDone(event));
        nl = pendingOut.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      fs.appendFileSync(stderrPath, chunk);
    });
    child.on("error", (error) => {
      fs.appendFileSync(stderrPath, `${error.message}\n`);
      finish(decided ?? 2);
    });
    child.on("close", (code) => {
      if (pendingOut.trim()) {
        const event = doneEventFromLine(pendingOut);
        if (event && decided == null) decided = exitCodeForDone(event);
      }
      finish(decided ?? (code == null ? 2 : code));
    });
  });
}

function killTree(child, signal) {
  if (!child || child.pid == null || child.exitCode != null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}
