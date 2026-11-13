/**
 * Real Kane CLI 0.10.4 invocation. Flags match the verifier's working command.
 * `--override-start-url` is part of that command. The public flag page fetched
 * on 13 Nov 2026 lists `--url` and not this flag; the guard still passes both
 * because that is what Kane 0.10.4 accepted on the verifier workstation.
 */
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
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

export async function loginIfConfigured(env, cwd) {
  const username = String(env.KANE_USERNAME || "").trim();
  const accessKey = String(env.KANE_ACCESS_KEY || "").trim();
  if (!username || !accessKey) return { loggedIn: false };
  const login = await spawnCapture("kane-cli", ["login", "--username", username, "--access-key", accessKey], env, cwd);
  if (login.code !== 0) {
    const error = new Error("kane-cli login failed");
    error.stderr = redact(login.stderr, accessKey);
    throw error;
  }
  const who = await spawnCapture("kane-cli", ["whoami"], env, cwd);
  if (who.code !== 0) {
    const error = new Error("kane-cli whoami failed after login");
    error.stderr = redact(who.stderr, accessKey);
    throw error;
  }
  return { loggedIn: true, whoami: who.stdout.trim() };
}

export function runKaneFlow({ flowPath, baseUrl, timeoutSecs, ndjsonPath, stderrPath, env, cwd }) {
  const args = kaneArgs(flowPath, baseUrl, timeoutSecs);
  return spawnToFiles("kane-cli", args, {
    env,
    cwd,
    stdoutPath: ndjsonPath,
    stderrPath,
    killAfterMs: (Number(timeoutSecs) + 45) * 1000,
  });
}

export function redact(text, secret) {
  if (!secret) return text;
  return String(text).split(secret).join("[redacted]");
}

function spawnCapture(command, args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => resolve({ code: 2, stdout: "", stderr: error.message }));
    child.on("close", (code) => {
      resolve({
        code: code ?? 2,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function spawnToFiles(command, args, { env, cwd, stdoutPath, stderrPath, killAfterMs }) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
    fs.mkdirSync(path.dirname(stderrPath), { recursive: true });
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    let child;
    try {
      child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      stdout.end();
      stderr.end();
      fs.appendFileSync(stderrPath, `${error.message}\n`);
      resolve(2);
      return;
    }
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 3000);
      killer.unref?.();
    }, killAfterMs);
    child.on("error", (error) => {
      stderr.write(`${error.message}\n`);
      finish(2);
    });
    child.on("close", (code) => {
      Promise.allSettled([once(stdout, "finish"), once(stderr, "finish")]).then(() => {
        finish(code == null ? 2 : code);
      });
    });
  });
}
