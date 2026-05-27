import { execa } from "execa";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type { ArisDiagnostics, ExecutorConfig, ExecutorTestResult, SaveExecutorInput } from "../../shared/types";
import { UTF8_PROCESS_ENV } from "./encoding.service";

const BLOCKED_DEFAULT_MODELS = new Set(["", "auto", "default"]);
const DEFAULT_CODEX_ENV = {
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_FALLBACK_MODELS: "gpt-5.5,gpt-5.4-mini,gpt-5.3-codex,gpt-5.2",
  CODEX_REASONING_EFFORT: "high"
};
const ARIS_SKILL_NAMES = [
  "idea-discovery",
  "research-pipeline",
  "experiment-bridge",
  "auto-review-loop",
  "paper-writing",
  "research-wiki"
];

export function ensureDefaultExecutors() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as count FROM executor_configs").get() as { count: number };
  const stamp = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO executor_configs (id, name, kind, executable_path, default_args_json, working_directory, env_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  [
    ["executor-codex", "Codex CLI", "codex-cli", process.platform === "win32" ? "codex.cmd" : "codex", []],
    ["executor-aris", "ARIS-Code CLI", "aris-code", "aris", ["--help"]],
    ["executor-claude", "Claude Code", "claude-code", "claude", []],
    ["executor-custom", "Custom command", "custom", "cmd.exe", ["/c", "echo 请配置自定义执行器"]]
  ].forEach(([eid, name, kind, executable, args]) => {
    insert.run(eid, name, kind, executable, JSON.stringify(args), null, JSON.stringify(kind === "codex-cli" ? DEFAULT_CODEX_ENV : {}), kind === "codex-cli" ? 1 : 0, stamp, stamp);
  });
  if (count.count > 0) {
    db.prepare(
      "UPDATE executor_configs SET enabled = 1, default_args_json = CASE WHEN default_args_json = '[\"--version\"]' THEN '[]' ELSE default_args_json END, updated_at = ? WHERE id = 'executor-codex'"
    ).run(stamp);
    if (process.platform === "win32") {
      db.prepare(
        "UPDATE executor_configs SET executable_path = 'codex.cmd', updated_at = ? WHERE id = 'executor-codex' AND lower(executable_path) IN ('codex', 'codex.ps1')"
      ).run(stamp);
    }
  }
  sanitizePersistedCodexExecutors(db, stamp);
  ensureCodexEnvDefaults(db, stamp);
}

export function listExecutors(): ExecutorConfig[] {
  ensureDefaultExecutors();
  const rows = getDb()
    .prepare(
      `SELECT * FROM executor_configs
       ORDER BY CASE WHEN id = 'executor-codex' THEN 0 ELSE 1 END, enabled DESC, created_at ASC`
    )
    .all() as any[];
  return rows.map(mapExecutor);
}

export function getExecutor(idValue: string): ExecutorConfig {
  ensureDefaultExecutors();
  const row = getDb().prepare("SELECT * FROM executor_configs WHERE id = ?").get(idValue) as any;
  if (!row) throw new Error("执行器不存在");
  return mapExecutor(row);
}

export function saveExecutor(input: SaveExecutorInput): ExecutorConfig {
  const db = getDb();
  const executorId = input.id ?? id("executor");
  const stamp = nowIso();
  const existing = db.prepare("SELECT id FROM executor_configs WHERE id = ?").get(executorId);
  const sanitizedArgs = input.kind === "codex-cli" ? sanitizeCodexDefaultArgs(input.defaultArgs ?? []) : input.defaultArgs ?? [];
  const sanitizedEnv = input.kind === "codex-cli" ? sanitizeCodexEnv(input.env ?? {}) : input.env ?? {};
  if (existing) {
    db.prepare(`
      UPDATE executor_configs SET name = ?, kind = ?, executable_path = ?, default_args_json = ?,
      working_directory = ?, env_json = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(
      input.name,
      input.kind,
      input.executablePath,
      JSON.stringify(sanitizedArgs),
      input.workingDirectory ?? null,
      JSON.stringify(sanitizedEnv),
      input.enabled === false ? 0 : 1,
      stamp,
      executorId
    );
  } else {
    db.prepare(`
      INSERT INTO executor_configs (id, name, kind, executable_path, default_args_json, working_directory, env_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      executorId,
      input.name,
      input.kind,
      input.executablePath,
      JSON.stringify(sanitizedArgs),
      input.workingDirectory ?? null,
      JSON.stringify(sanitizedEnv),
      input.enabled === false ? 0 : 1,
      stamp,
      stamp
    );
  }
  return getExecutor(executorId);
}

export async function testExecutor(executorId: string): Promise<ExecutorTestResult> {
  const executor = getExecutor(executorId);
  const args = executor.defaultArgs.length > 0 ? executor.defaultArgs : ["--version"];
  try {
    const result = await execa(executor.executablePath, args, {
      cwd: executor.workingDirectory || undefined,
      env: { ...UTF8_PROCESS_ENV, ...(executor.env ?? {}) },
      timeout: 15000,
      reject: false
    });
    return {
      ok: result.exitCode === 0,
      command: [executor.executablePath, ...args].join(" "),
      output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
      error: result.exitCode === 0 ? undefined : `退出码 ${result.exitCode}`
    };
  } catch (error) {
    return {
      ok: false,
      command: [executor.executablePath, ...args].join(" "),
      output: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function diagnoseAris(): Promise<ArisDiagnostics> {
  const [release, arisCli, codexCli, claudeCli] = await Promise.all([
    fetchLatestRelease().catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    })),
    detectCommand(["aris", "aris.exe"]),
    detectCommand(["codex.cmd", "codex.exe", "codex"]),
    detectCommand(["claude", "claude.cmd", "claude.exe"])
  ]);
  const skills = detectArisSkills();
  const releaseUrl = "html_url" in release ? release.html_url : undefined;
  const releaseName = "name" in release ? release.name : undefined;
  const releaseError = "error" in release ? release.error : undefined;

  if (arisCli.found) {
    return {
      found: true,
      executable: arisCli.executable,
      versionOutput: arisCli.versionOutput,
      codexFound: codexCli.found,
      codexVersionOutput: codexCli.versionOutput,
      claudeFound: claudeCli.found,
      claudeVersionOutput: claudeCli.versionOutput,
      skillsFound: skills.found,
      skillLocations: skills.locations,
      latestReleaseUrl: releaseUrl,
      latestReleaseName: releaseName,
      installHint: buildInstallHint(true, skills.found, codexCli.found, claudeCli.found),
      error: releaseError
    };
  }

  return {
    found: false,
    codexFound: codexCli.found,
    codexVersionOutput: codexCli.versionOutput,
    claudeFound: claudeCli.found,
    claudeVersionOutput: claudeCli.versionOutput,
    skillsFound: skills.found,
    skillLocations: skills.locations,
    latestReleaseUrl: releaseUrl,
    latestReleaseName: releaseName,
    installHint: buildInstallHint(false, skills.found, codexCli.found, claudeCli.found),
    error: releaseError
  };
}

async function detectCommand(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const result = await execa(candidate, ["--version"], { timeout: 10000, reject: false, env: UTF8_PROCESS_ENV });
      if (result.exitCode === 0 || result.stdout || result.stderr) {
        return {
          found: true,
          executable: candidate,
          versionOutput: [result.stdout, result.stderr].filter(Boolean).join("\n")
        };
      }
    } catch {
      // Try next candidate.
    }
  }
  return { found: false };
}

function detectArisSkills() {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".codex", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(process.cwd(), ".agents", "skills"),
    path.join(process.cwd(), ".claude", "skills")
  ];
  const locations = candidates.filter((root) => containsArisSkill(root));
  return { found: locations.length > 0, locations };
}

function containsArisSkill(root: string) {
  if (!existsSync(root)) return false;
  try {
    const entries = new Set(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    return ARIS_SKILL_NAMES.some((name) => entries.has(name));
  } catch {
    return false;
  }
}

function buildInstallHint(arisFound: boolean, skillsFound: boolean, codexFound: boolean, claudeFound: boolean) {
  const messages: string[] = [];
  if (arisFound) {
    messages.push("已在 PATH 中找到 ARIS CLI。");
  } else {
    messages.push("未在 PATH 中找到 aris/aris.exe，可从官方 release 安装 ARIS CLI。");
  }
  if (skillsFound) {
    messages.push("已检测到 ARIS skills，Codex/Claude 可调用 ARIS workflow。");
  } else {
    messages.push("未检测到 ARIS skills，请运行 scripts/install-aris-skills.ps1。");
  }
  if (!codexFound) messages.push("未检测到 Codex CLI，如需使用默认执行器请先安装 codex。");
  if (!claudeFound) messages.push("未检测到 Claude Code；如果只使用 Codex 或 ARIS CLI 可以忽略。");
  return messages.join(" ");
}

async function fetchLatestRelease(): Promise<{ html_url?: string; name?: string }> {
  const response = await fetch("https://api.github.com/repos/wanshuiyin/Auto-claude-code-research-in-sleep/releases/latest", {
    headers: { "User-Agent": "ARIS-Paper-Studio" }
  });
  if (!response.ok) throw new Error(`GitHub release 查询失败：${response.status}`);
  return (await response.json()) as { html_url?: string; name?: string };
}

function mapExecutor(row: any): ExecutorConfig {
  const kind = row.kind;
  const defaultArgs = parseJson<string[]>(row.default_args_json, []);
  const env = parseJson<Record<string, string>>(row.env_json, {});
  return {
    id: row.id,
    name: row.name,
    kind,
    executablePath: row.executable_path,
    defaultArgs: kind === "codex-cli" ? sanitizeCodexDefaultArgs(defaultArgs) : defaultArgs,
    workingDirectory: row.working_directory ?? undefined,
    env: kind === "codex-cli" ? sanitizeCodexEnv(env) : env,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeCodexExecutablePath(executablePath: string) {
  const candidate = executablePath.trim() || "codex";
  if (process.platform !== "win32") return candidate;

  const basename = path.basename(candidate).toLowerCase();
  if (basename === "codex.cmd" || basename === "codex.exe") return candidate;
  if (basename === "codex.ps1") {
    const cmdPath = path.join(path.dirname(candidate), "codex.cmd");
    return existsSync(cmdPath) ? cmdPath : "codex.cmd";
  }
  if (basename === "codex") {
    const exePath = path.join(path.dirname(candidate), "codex.exe");
    if (path.dirname(candidate) !== "." && existsSync(exePath)) return exePath;
    const cmdPath = path.dirname(candidate) === "." ? "codex.cmd" : path.join(path.dirname(candidate), "codex.cmd");
    return cmdPath === "codex.cmd" || existsSync(cmdPath) ? cmdPath : "codex.cmd";
  }
  return candidate;
}

function sanitizePersistedCodexExecutors(db: ReturnType<typeof getDb>, stamp: string) {
  const rows = db.prepare("SELECT id, default_args_json, env_json FROM executor_configs WHERE kind = 'codex-cli'").all() as any[];
  const update = db.prepare("UPDATE executor_configs SET default_args_json = ?, env_json = ?, updated_at = ? WHERE id = ?");
  for (const row of rows) {
    const args = parseJson<string[]>(row.default_args_json, []);
    const env = parseJson<Record<string, string>>(row.env_json, {});
    const nextArgs = sanitizeCodexDefaultArgs(args);
    const nextEnv = sanitizeCodexEnv(env);
    const nextArgsJson = JSON.stringify(nextArgs);
    const nextEnvJson = JSON.stringify(nextEnv);
    if (nextArgsJson !== row.default_args_json || nextEnvJson !== (row.env_json ?? "{}")) {
      update.run(nextArgsJson, nextEnvJson, stamp, row.id);
    }
  }
}

function ensureCodexEnvDefaults(db: ReturnType<typeof getDb>, stamp: string) {
  const rows = db.prepare("SELECT id, env_json FROM executor_configs WHERE kind = 'codex-cli'").all() as any[];
  const update = db.prepare("UPDATE executor_configs SET env_json = ?, updated_at = ? WHERE id = ?");
  for (const row of rows) {
    const env = parseJson<Record<string, string>>(row.env_json, {});
    const next = {
      ...env,
      OPENAI_MODEL: env.OPENAI_MODEL?.trim() ? env.OPENAI_MODEL : DEFAULT_CODEX_ENV.OPENAI_MODEL,
      OPENAI_FALLBACK_MODELS: env.OPENAI_FALLBACK_MODELS?.trim() ? env.OPENAI_FALLBACK_MODELS : DEFAULT_CODEX_ENV.OPENAI_FALLBACK_MODELS,
      CODEX_REASONING_EFFORT: env.CODEX_REASONING_EFFORT?.trim() ? env.CODEX_REASONING_EFFORT : DEFAULT_CODEX_ENV.CODEX_REASONING_EFFORT
    };
    if (JSON.stringify(next) !== (row.env_json ?? "{}")) {
      update.run(JSON.stringify(next), stamp, row.id);
    }
  }
}

function sanitizeCodexEnv(env: Record<string, string>) {
  const next = { ...env };
  const model = next.OPENAI_MODEL?.trim().toLowerCase();
  if (model !== undefined && BLOCKED_DEFAULT_MODELS.has(model)) {
    delete next.OPENAI_MODEL;
  }
  return next;
}

function sanitizeCodexDefaultArgs(args: string[]) {
  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const lower = arg.toLowerCase();
    const value = args[index + 1]?.toLowerCase();
    if ((lower === "-m" || lower === "--model") && (value === "auto" || value === "default")) {
      index += 1;
      continue;
    }
    if (lower === "--model=auto" || lower === "--model=default") continue;
    next.push(arg);
  }
  return next;
}
