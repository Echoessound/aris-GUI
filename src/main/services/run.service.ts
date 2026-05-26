import { BrowserWindow } from "electron";
import { execa } from "execa";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type { ExecuteEvent, Run, RunDetail, RunStep, StartRunInput, WorkflowType } from "../../shared/types";
import { getExecutor } from "./executor.service";
import { rescanArtifacts } from "./artifact.service";
import { getProject } from "./project.service";
import { readGitStatus } from "./repository.service";

const running = new Map<string, ReturnType<typeof execa>>();
const DEFAULT_FALLBACK_MODELS = ["gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"];
const SOFT_IDLE_TIMEOUT_MS = 120000;
const DEFAULT_HARD_IDLE_TIMEOUT_MS = 600000;
const MAX_EVENT_MESSAGE_CHARS = 8192;
const CORE_ARTIFACTS = [
  path.join("idea-stage", "IDEA_REPORT.md"),
  "NARRATIVE_REPORT.md",
  "FINAL_REPORT.md",
  "PIPELINE_REPORT.md",
  path.join("review-stage", "AUTO_REVIEW.md")
];

export function listRuns(projectId: string): Run[] {
  const rows = getDb().prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC").all(projectId) as any[];
  return rows.map(mapRun);
}

export function getRun(runId: string): RunDetail {
  const run = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  if (!run) throw new Error("运行记录不存在");
  const steps = getDb().prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at ASC").all(runId) as any[];
  const events = readEventsForRun(runId);
  return { ...mapRun(run), steps: steps.map(mapRunStep), events };
}

export function cleanupInterruptedRuns() {
  const endedAt = nowIso();
  const db = getDb();
  db.prepare(
    `UPDATE run_steps
     SET status = 'failed', ended_at = COALESCE(ended_at, ?), error_message = COALESCE(error_message, '应用重启或执行器中断，运行已标记为失败')
     WHERE status = 'running'`
  ).run(endedAt);
  db.prepare(
    `UPDATE runs
     SET status = 'failed', ended_at = COALESCE(ended_at, ?), error_message = COALESCE(error_message, '应用重启或执行器中断，运行已标记为失败')
     WHERE status = 'running'`
  ).run(endedAt);
  db.prepare(
    `UPDATE projects
     SET status = CASE WHEN repository_id IS NULL THEN 'draft' ELSE 'ready' END, updated_at = ?
     WHERE status = 'running'`
  ).run(endedAt);
}

export async function startRun(input: StartRunInput): Promise<Run> {
  const project = getProject(input.projectId);
  if (!project.repository?.path) throw new Error("项目尚未绑定 Git 仓库");
  const executor = getExecutor(input.executorId ?? project.defaultExecutorId ?? "executor-codex");
  const workflowType = input.workflowType;
  const runId = id("run");
  const stepId = id("step");
  const startedAt = nowIso();
  const runDir = path.join(project.repository.path, ".aris-app", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const eventsPath = path.join(runDir, "events.jsonl");
  writeFileSync(stdoutPath, "", "utf8");
  writeFileSync(stderrPath, "", "utf8");
  writeFileSync(eventsPath, "", "utf8");
  writeResearchBrief(project.repository.path, workflowType, input.topic ?? project.topic, runId);

  const gitBefore = await readGitStatus(project.repository.path).catch((error) => ({ error: String(error) }));
  writeFileSync(path.join(runDir, "git-before.json"), JSON.stringify(gitBefore, null, 2), "utf8");

  const commandPlan = buildWorkflowCommandPlan(executor, workflowType, input.topic ?? project.topic, project.repository.path);
  const args = commandPlan[0];
  const command = executor.executablePath;
  const hardIdleTimeoutMs = parsePositiveInt(executor.env?.ARIS_HARD_IDLE_TIMEOUT_MS, DEFAULT_HARD_IDLE_TIMEOUT_MS);
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (id, project_id, workflow_template_id, executor_id, status, current_node_id, round_index, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`
  ).run(runId, project.id, project.defaultWorkflowId ?? null, executor.id, stepId, project.runCount + 1, startedAt);
  db.prepare(
    `INSERT INTO run_steps (id, run_id, status, command, args_json, stdout_path, stderr_path, started_at)
    VALUES (?, ?, 'running', ?, ?, ?, ?, ?)`
  ).run(stepId, runId, command, JSON.stringify(args), stdoutPath, stderrPath, startedAt);
  db.prepare("UPDATE projects SET status = 'running', run_count = run_count + 1, updated_at = ? WHERE id = ?").run(startedAt, project.id);

  emit(runDir, { runId, stepId, type: "start", message: [command, ...args].join(" "), timestamp: startedAt });
  if (executor.kind === "codex-cli") {
    emit(runDir, { runId, stepId, type: "stderr", message: `Codex model plan: ${describeModelPlan(commandPlan)}`, timestamp: nowIso() });
  }

  let activeChild = startChild(command, args, project.repository.path, executor.env, executor.kind === "codex-cli");
  running.set(runId, activeChild);
  let lastOutputAt = Date.now();
  let softIdleWarningSent = false;
  let artifactWaitNoticeSent = false;
  const idleTimer = setInterval(() => {
    const idleFor = Date.now() - lastOutputAt;
    if (idleFor >= SOFT_IDLE_TIMEOUT_MS && !softIdleWarningSent) {
      softIdleWarningSent = true;
      emit(runDir, {
        runId,
        stepId,
        type: "stderr",
        message: "Executor produced no output for 120 seconds; keeping it alive and waiting for progress.",
        timestamp: nowIso()
      });
    }
    if (idleFor < hardIdleTimeoutMs) return;
    if (hasCoreArtifact(project.repository!.path)) {
      if (!artifactWaitNoticeSent) {
        artifactWaitNoticeSent = true;
        emit(runDir, {
          runId,
          stepId,
          type: "stderr",
          message: "Core artifact detected after idle period; waiting for executor shutdown instead of killing it.",
          timestamp: nowIso()
        });
      }
      return;
    }
    activeChild.kill("SIGTERM");
    const idleMessage = `Executor produced no output for ${Math.round(hardIdleTimeoutMs / 1000)} seconds and no core artifact was found; stopped.`;
    ensureFallbackArtifact(project.repository!.path, runId, workflowType, input.topic ?? project.topic, null, idleMessage);
    emit(runDir, {
      runId,
      stepId,
      type: "error",
      message: idleMessage,
      timestamp: nowIso()
    });
    clearInterval(idleTimer);
  }, 15000);
  const attachStreams = (activeChild: ReturnType<typeof startChild>) => {
    activeChild.stdout?.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      const message = chunk.toString();
      appendFileSync(stdoutPath, message, "utf8");
      emit(runDir, { runId, stepId, type: "stdout", message: redact(message), timestamp: nowIso() });
    });
    activeChild.stderr?.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      const message = chunk.toString();
      appendFileSync(stderrPath, message, "utf8");
      emit(runDir, { runId, stepId, type: "stderr", message: redact(message), timestamp: nowIso() });
    });
  };
  attachStreams(activeChild);
  activeChild
    .then(async (firstResult) => {
      let result = firstResult;
      let attemptIndex = 1;
      while (shouldRetryForModelCapacity(result.stderr || result.stdout) && attemptIndex < commandPlan.length) {
        const nextArgs = commandPlan[attemptIndex];
        const retryMessage = `Model capacity is unavailable; retrying with fallback arguments: ${redact([command, ...nextArgs].join(" "))}`;
        appendFileSync(stderrPath, `${retryMessage}\n`, "utf8");
        emit(runDir, { runId, stepId, type: "stderr", message: retryMessage, timestamp: nowIso() });
        db.prepare("UPDATE run_steps SET args_json = ? WHERE id = ?").run(JSON.stringify(nextArgs), stepId);
        activeChild = startChild(command, nextArgs, project.repository!.path, executor.env, executor.kind === "codex-cli");
        running.set(runId, activeChild);
        attachStreams(activeChild);
        result = await activeChild;
        attemptIndex += 1;
      }
      running.delete(runId);
      clearInterval(idleTimer);
      const endedAt = nowIso();
      const gitAfter = await readGitStatus(project.repository!.path).catch((error) => ({ error: String(error) }));
      writeFileSync(path.join(runDir, "git-after.json"), JSON.stringify(gitAfter, null, 2), "utf8");
      ensureFallbackArtifact(project.repository!.path, runId, workflowType, input.topic ?? project.topic, result.exitCode ?? null, result.stderr || result.stdout || "");
      const artifacts = rescanArtifacts(project.id, runId);
      const producedCoreArtifact = hasCoreArtifact(project.repository!.path);
      const status = result.exitCode === 0 || producedCoreArtifact ? "completed" : "failed";
      const errorMessage =
        result.exitCode === 0
          ? null
          : producedCoreArtifact
            ? "Executor exited non-zero after producing core artifacts."
            : summarizeForDb(result.stderr || result.stdout || `Exit code ${result.exitCode}`);
      db.prepare("UPDATE run_steps SET status = ?, ended_at = ?, exit_code = ?, error_message = ? WHERE id = ?").run(
        status,
        endedAt,
        result.exitCode,
        errorMessage,
        stepId
      );
      db.prepare("UPDATE runs SET status = ?, ended_at = ?, exit_code = ?, error_message = ? WHERE id = ?").run(
        status,
        endedAt,
        result.exitCode,
        errorMessage,
        runId
      );
      db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, endedAt, project.id);
      writeFileSync(path.join(runDir, "artifacts.json"), JSON.stringify(artifacts, null, 2), "utf8");
      db.prepare(
        `INSERT INTO git_events (id, project_id, run_id, event_type, branch, commit_hash, summary_json, created_at)
        VALUES (?, ?, ?, 'run_snapshot', ?, ?, ?, ?)`
      ).run(id("git-event"), project.id, runId, "branch" in gitAfter ? gitAfter.branch : null, "lastCommitHash" in gitAfter ? gitAfter.lastCommitHash : null, JSON.stringify(gitAfter), endedAt);
      emit(runDir, {
        runId,
        stepId,
        type: "exit",
        message: status === "completed" && result.exitCode !== 0 ? "Core artifacts produced; executor exited non-zero during shutdown." : status === "completed" ? "运行完成" : "运行失败",
        exitCode: result.exitCode,
        timestamp: endedAt
      });
    })
    .catch((error) => {
      running.delete(runId);
      clearInterval(idleTimer);
      const endedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      ensureFallbackArtifact(project.repository!.path, runId, workflowType, input.topic ?? project.topic, null, message);
      db.prepare("UPDATE run_steps SET status = 'failed', ended_at = ?, error_message = ? WHERE id = ?").run(endedAt, message, stepId);
      db.prepare("UPDATE runs SET status = 'failed', ended_at = ?, error_message = ? WHERE id = ?").run(endedAt, message, runId);
      db.prepare("UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ?").run(endedAt, project.id);
      emit(runDir, { runId, stepId, type: "error", message, timestamp: endedAt });
    });

  return getRun(runId);
}

export async function stopRun(runId: string) {
  const child = running.get(runId);
  if (child) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (running.has(runId)) child.kill("SIGKILL");
    }, 5000);
    running.delete(runId);
  }
  const endedAt = nowIso();
  getDb().prepare("UPDATE run_steps SET status = 'cancelled', ended_at = ? WHERE run_id = ? AND status = 'running'").run(endedAt, runId);
  const row = getDb().prepare("SELECT project_id FROM runs WHERE id = ?").get(runId) as { project_id?: string } | undefined;
  getDb().prepare("UPDATE runs SET status = 'cancelled', ended_at = ?, error_message = COALESCE(error_message, '用户停止运行') WHERE id = ?").run(endedAt, runId);
  if (row?.project_id) {
    getDb().prepare("UPDATE projects SET status = CASE WHEN repository_id IS NULL THEN 'draft' ELSE 'ready' END, updated_at = ? WHERE id = ?").run(endedAt, row.project_id);
  }
}

function startChild(command: string, args: string[], cwd: string, env?: Record<string, string>, syncCodexModelEnv = false) {
  const childEnv = { ...process.env, ...(env ?? {}) };
  if (syncCodexModelEnv) {
    const modelFlagIndex = args.indexOf("-m");
    if (modelFlagIndex >= 0 && args[modelFlagIndex + 1]) {
      childEnv.OPENAI_MODEL = args[modelFlagIndex + 1];
    } else {
      delete childEnv.OPENAI_MODEL;
    }
  }
  return execa(command, args, {
    cwd,
    env: childEnv,
    stdin: "ignore",
    reject: false,
    all: false
  });
}

function shouldRetryForModelCapacity(output: string) {
  return /model is at capacity|selected model is at capacity|try a different model/i.test(output);
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseModelList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeModels(models: Array<string | undefined>) {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = model ?? "__codex_default__";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildWorkflowCommandPlan(
  executor: ReturnType<typeof getExecutor>,
  workflowType: WorkflowType,
  topic: string,
  repoPath: string
) {
  if (executor.kind === "codex-cli") {
    const makeArgs = (model?: string) => {
      const args = ["exec", "-C", repoPath, "--skip-git-repo-check"];
      const sandbox = executor.env?.CODEX_SANDBOX_MODE || "danger-full-access";
      const approval = executor.env?.CODEX_APPROVAL_MODE || "never";
      if (sandbox === "danger-full-access" && approval === "never") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else {
        args.push("--sandbox", sandbox);
      }
      if (model) args.push("-m", model);
      args.push(buildCodexWorkflowPrompt(workflowType, topic));
      return args;
    };
    const configuredModel = executor.env?.OPENAI_MODEL?.trim();
    const configuredFallbacks = parseModelList(executor.env?.OPENAI_FALLBACK_MODELS);
    const fallbackModels = configuredFallbacks.length ? configuredFallbacks : DEFAULT_FALLBACK_MODELS;
    const shouldUseConfiguredModel = configuredModel && !["auto", "default", "gpt-5.4"].includes(configuredModel.toLowerCase());
    const modelPlan = dedupeModels([undefined, ...fallbackModels, shouldUseConfiguredModel ? configuredModel : undefined]);
    return modelPlan.map((item) => makeArgs(item));
  }
  if (executor.kind === "aris-code") {
    return [[workflowType, topic, "--auto-proceed"]];
  }
  if (executor.kind === "claude-code") {
    return [[`/${workflowType} "${topic}" --auto proceed: true`]];
  }
  if (executor.defaultArgs.length > 0 && !executor.defaultArgs.includes("--help") && !executor.defaultArgs.includes("--version")) {
    return [executor.defaultArgs];
  }
  return [[workflowType, topic, "--auto-proceed"]];
}

function describeModelPlan(commandPlan: string[][]) {
  return commandPlan
    .map((args) => {
      const modelIndex = args.indexOf("-m");
      return modelIndex >= 0 && args[modelIndex + 1] ? args[modelIndex + 1] : "auto";
    })
    .join(" -> ");
}

function buildCodexWorkflowPrompt(workflowType: WorkflowType, topic: string) {
  return [
    `请在当前仓库中执行 ARIS workflow：/${workflowType}`,
    `研究主题：${topic}`,
    "当前仓库可能是一个新的研究工作区。请以 RESEARCH_BRIEF.md 作为主要输入，不要把 .aris-app/runs 的历史运行日志当作研究材料反复分析。",
    "硬性要求：在做长时间探索之前，先创建 idea-stage/IDEA_REPORT.md，写入初步研究问题、相关方向、候选 idea 和下一步计划。即使后续工具失败，也必须留下这个 Markdown 成果。",
    "要求：",
    "1. 按 ARIS workflow 的语义真实推进任务，不要只输出说明。",
    "2. 首个产物必须是 idea-stage/IDEA_REPORT.md；随后可生成 NARRATIVE_REPORT.md 或 FINAL_REPORT.md。",
    "3. 如果可以继续推进，请生成阶段性报告、日志、LaTeX 或 PDF 产物，并写入当前仓库中的合理位置。",
    "4. 如果当前环境缺少某个外部工具，先记录清楚缺失项，并产出可检查的 Markdown 报告。",
    "5. 不要执行 destructive Git 命令，不要自动 commit 或 push。",
    "6. 不要长时间只读取旧日志；如果需要参考运行记录，只读最近一次 run 的摘要即可。"
  ].join("\n");
}

function writeResearchBrief(repoPath: string, workflowType: WorkflowType, topic: string, runId: string) {
  const brief = [
    "# Research Brief",
    "",
    `- Topic: ${topic}`,
    `- Workflow: /${workflowType}`,
    `- Run ID: ${runId}`,
    `- Created At: ${nowIso()}`,
    "",
    "## Objective",
    "",
    "Run the ARIS research workflow and produce concrete local artifacts in this repository.",
    "",
    "## Required First Output",
    "",
    "Create `idea-stage/IDEA_REPORT.md` first. It should include problem framing, candidate ideas, novelty hypotheses, and next actions.",
    "",
    "## Constraints",
    "",
    "- Do not treat `.aris-app/runs` as primary research content.",
    "- Do not commit or push automatically.",
    "- If any tool or model fails, write a Markdown report explaining what was completed and what blocked progress.",
    ""
  ].join("\n");
  writeFileSync(path.join(repoPath, "RESEARCH_BRIEF.md"), brief, "utf8");
}

function ensureFallbackArtifact(repoPath: string, runId: string, workflowType: WorkflowType, topic: string, exitCode: number | null, output: string) {
  const expected = [
    path.join(repoPath, "idea-stage", "IDEA_REPORT.md"),
    path.join(repoPath, "NARRATIVE_REPORT.md"),
    path.join(repoPath, "FINAL_REPORT.md")
  ];
  if (expected.some((file) => existsSync(file))) return;
  const outDir = path.join(repoPath, "idea-stage");
  mkdirSync(outDir, { recursive: true });
  const report = [
    "# IDEA_REPORT",
    "",
    `**Run ID**: ${runId}`,
    `**Workflow**: /${workflowType}`,
    `**Topic**: ${topic}`,
    `**Exit Code**: ${exitCode ?? "unknown"}`,
    "",
    "## Status",
    "",
    "The workflow did not create a primary Markdown artifact before exiting. ARIS Paper Studio generated this fallback report so the run leaves a concrete, inspectable result.",
    "",
    "## Diagnosis",
    "",
    output.trim() ? output.slice(0, 8000) : "No executor output was captured.",
    "",
    "## Next Step",
    "",
    "Retry the workflow with a lighter model or provide more project context in `RESEARCH_BRIEF.md`.",
    ""
  ].join("\n");
  writeFileSync(path.join(outDir, "IDEA_REPORT.md"), report, "utf8");
}

function emit(runDir: string, event: ExecuteEvent) {
  const safeEvent = { ...event, message: prepareEventMessage(event.message) };
  const line = JSON.stringify(safeEvent);
  appendFileSync(path.join(runDir, "events.jsonl"), `${line}\n`, "utf8");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("run:event", safeEvent);
  }
}

function hasCoreArtifact(repoPath: string) {
  return CORE_ARTIFACTS.some((artifactPath) => existsSync(path.join(repoPath, artifactPath)));
}

function prepareEventMessage(message: string) {
  const folded = foldLargeDiff(message);
  if (folded.length <= MAX_EVENT_MESSAGE_CHARS) return folded;
  return `${folded.slice(0, MAX_EVENT_MESSAGE_CHARS)}\n...[truncated, see stdout.log/stderr.log]`;
}

function foldLargeDiff(message: string) {
  if (!message.includes("diff --git") || message.length <= MAX_EVENT_MESSAGE_CHARS) return message;
  const files = Array.from(message.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)).map((match) => match[2]);
  const preview = message.split(/\r?\n/).slice(0, 80).join("\n");
  const fileList = files.slice(0, 80).map((file) => `- ${file}`).join("\n");
  const more = files.length > 80 ? `\n- ... ${files.length - 80} more files` : "";
  return [
    "[large git diff folded for UI; full output is in stderr.log/stdout.log]",
    "",
    "Changed files:",
    fileList || "- unable to parse changed files",
    more,
    "",
    "Preview:",
    preview
  ].join("\n");
}

function summarizeForDb(message: string) {
  const prepared = prepareEventMessage(message);
  return prepared.length <= 4000 ? prepared : `${prepared.slice(0, 4000)}\n...[truncated]`;
}

function readEventsForRun(runId: string): ExecuteEvent[] {
  const step = getDb().prepare("SELECT stdout_path FROM run_steps WHERE run_id = ? LIMIT 1").get(runId) as any;
  if (!step?.stdout_path) return [];
  const eventsPath = path.join(path.dirname(step.stdout_path), "events.jsonl");
  try {
    return readFileSync(eventsPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line: string) => JSON.parse(line));
  } catch {
    return [];
  }
}

function redact(message: string) {
  return message.replace(/([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)[A-Z0-9_]*=)[^\s]+/gi, "$1***");
}

function mapRun(row: any): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    workflowTemplateId: row.workflow_template_id,
    executorId: row.executor_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    roundIndex: row.round_index,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    errorMessage: row.error_message
  };
}

function mapRunStep(row: any): RunStep {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    status: row.status,
    command: row.command,
    args: parseJson<string[]>(row.args_json, []),
    stdoutPath: row.stdout_path,
    stderrPath: row.stderr_path,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    errorMessage: row.error_message
  };
}
