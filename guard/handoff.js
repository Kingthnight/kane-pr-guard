/**
 * Pluggable failure handoff.
 *
 *   KANE_FIX_HANDOFF=comment  (default) post or update the @agent PR comment
 *   KANE_FIX_HANDOFF=file     write the request markdown and do not call GitHub
 *   KANE_FIX_HANDOFF=none     do nothing
 *   KANE_FIX_HANDOFF=./mod.js a module that exports handoff({ body, report })
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function handoff({ mode = "comment", body, github, filePath = "kane-fix-request.md", report }) {
  const resolved = String(mode || "comment").trim() || "comment";
  if (resolved === "none") return { mode: resolved, posted: false };

  if (resolved === "file" || resolved === "comment") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    fs.writeFileSync(filePath, body);
  }

  if (resolved === "file") return { mode: resolved, posted: false, filePath };

  if (resolved === "comment") {
    if (!github) return { mode: resolved, posted: false, filePath };
    await github.upsert("<!-- kane-pr-guard-fix", body);
    return { mode: resolved, posted: true, filePath };
  }

  const mod = await import(pathToFileURL(path.resolve(resolved)).href);
  if (typeof mod.handoff !== "function") {
    throw new Error(`Fix handoff module ${resolved} does not export handoff()`);
  }
  await mod.handoff({ body, report });
  return { mode: resolved, posted: false };
}
