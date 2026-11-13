/**
 * The message handed to the coding agent. Same facts as the PR comment:
 * status, failing step, reason, Test Manager link, screenshot path.
 */

export function expectedFromFlow(markdown) {
  return String(markdown).replace(/^---[\s\S]*?---\s*/, "").trim();
}

export function buildFixRequest({ agent, attempt, maxAttempts, branch, baseUrl, flows }) {
  const lines = [
    "<!-- kane-pr-guard-fix -->",
    `${agent} Kane PR Guard found failures on attempt ${attempt} of ${maxAttempts}.`,
    "",
    "Please fix the sample app on this pull request branch and push. The synchronize event re-runs the guard.",
  ];
  if (branch) lines.push(`Branch: \`${branch}\`.`);
  lines.push(`App under test: ${baseUrl}.`, "");

  for (const flow of flows) {
    lines.push(`### ${flow.flow} — ${flow.status}`);
    lines.push(`- **Status:** ${flow.status}`);
    if (flow.expected) {
      lines.push("- **Expected:**");
      lines.push("");
      lines.push("<details><summary>Flow file</summary>");
      lines.push("");
      lines.push("```md");
      lines.push(flow.expected);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    lines.push(`- **Actual:** ${flow.reason || flow.failingStep || flow.status}`);
    if (flow.failingStep) lines.push(`- **Failing step:** ${flow.failingStep}`);
    if (flow.reason) lines.push(`- **Reason:** ${flow.reason}`);
    if (flow.link) lines.push(`- **Run:** [Open in Test Manager](${flow.link})`);
    else lines.push("- **Run:** no Test Manager link (upload may have failed)");
    if (flow.screenshot) lines.push(`- **Screenshot:** \`${flow.screenshot}\``);
    else lines.push("- **Screenshot:** not found in the evidence pack");
    lines.push("");
  }

  lines.push("Kane CLI 0.10.4 does not produce a video. Use the Test Manager link and the failure screenshot.");
  return `${lines.join("\n")}\n`;
}
