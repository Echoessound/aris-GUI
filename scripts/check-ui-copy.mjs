import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("src", "renderer");
const patterns = [
  "Project Q&A",
  "Edit preview",
  "Whole project",
  "Review run",
  "Summarize run issues",
  "Edit run artifacts",
  "Plan next round",
  "Send to Codex",
  "No Codex chat messages yet",
  "default model",
  "default effort",
  "Global auto continue",
  "Project auto continue",
  "Execution diagnostics"
];
const allowed = [
  "Codex",
  "Workflow",
  "Git",
  "PDF",
  "API",
  "CLI",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_FALLBACK_MODELS",
  "CODEX_APPROVAL_MODE",
  "CODEX_SANDBOX_MODE"
];

const findings = [];
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (line.includes(pattern) && !allowed.some((term) => pattern === term)) {
        findings.push(`${path.relative(process.cwd(), file)}:${index + 1}: ${pattern}`);
      }
    }
  });
}

if (findings.length) {
  console.error("发现疑似残留英文 UI 文案：");
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log("中文化文案检查通过。");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      yield full;
    }
  }
}
