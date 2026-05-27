import { BrowserWindow } from "electron";
import { execa } from "execa";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type { ContinueRunInput, ExecuteEvent, Run, RunDetail, RunInsight, RunInsightStatus, RunStep, StartRunInput, WorkflowLaunchConfig, WorkflowType } from "../../shared/types";
import { getExecutor, normalizeCodexExecutablePath } from "./executor.service";
import { rescanArtifacts } from "./artifact.service";
import { appendUtf8Guidance, decodeTextBuffer, readTextFile, UTF8_PROCESS_ENV } from "./encoding.service";
import { getProject } from "./project.service";
import { readGitStatus } from "./repository.service";
import { getWorkflowTemplate } from "./workflow.service";
import { recordUsageFromText } from "./model-usage.service";
import {
  buildRunContinuationPrompt,
  canStartContinuation,
  continuationReasonFromRun,
  findOrCreateChain,
  markContinuationStopped,
  recordContinuationEvent
} from "./auto-continue.service";

const running = new Map<string, ReturnType<typeof execa>>();
const DEFAULT_PRIMARY_MODEL = "gpt-5.4";
const DEFAULT_FALLBACK_MODELS = ["gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"];
const DEFAULT_REASONING_EFFORT = "high";
const SOFT_IDLE_TIMEOUT_MS = 300000;
const DEFAULT_HARD_IDLE_TIMEOUT_MS = 1800000;
const MAX_EVENT_MESSAGE_CHARS = 60000;
const QUALITY_BUDGETS: Record<string, { minMs: number; minMarkdownChars: number; label: string }> = {
  "research-pipeline": { minMs: 10 * 60 * 1000, minMarkdownChars: 12000, label: "完整论文生成" },
  "paper-writing": { minMs: 8 * 60 * 1000, minMarkdownChars: 8000, label: "论文写作" },
  "paper-compile": { minMs: 2 * 60 * 1000, minMarkdownChars: 800, label: "论文 PDF 编译" },
  "multi-agent-paper-review": { minMs: 5 * 60 * 1000, minMarkdownChars: 4000, label: "多 Agent 论文评审" },
  "auto-review-loop": { minMs: 5 * 60 * 1000, minMarkdownChars: 3000, label: "自动审稿" },
  "idea-discovery": { minMs: 3 * 60 * 1000, minMarkdownChars: 2500, label: "立题发现" },
  "experiment-bridge": { minMs: 3 * 60 * 1000, minMarkdownChars: 2500, label: "实验桥接" }
};
const CORE_ARTIFACTS = [
  path.join("idea-stage", "IDEA_REPORT.md"),
  "NARRATIVE_REPORT.md",
  "FINAL_REPORT.md",
  "PIPELINE_REPORT.md",
  path.join("review-stage", "AUTO_REVIEW.md"),
  path.join("review-stage", "MULTI_AGENT_REVIEW.md")
];
const RECOVERED_INTERRUPTED_RUN_MESSAGE = "Executor or app was interrupted, but this run produced recoverable research artifacts.";
const INTERRUPTED_RUN_FAILED_MESSAGE = "Application restart or executor interruption; no recoverable research artifact was detected.";
const RECOVERABLE_ARTIFACT_ROOTS = new Set([
  "",
  "idea-stage",
  "implementation-stage",
  "review-stage",
  "paper",
  "figures",
  "outputs",
  "results",
  "benchmark",
  "experiments",
  "refine-logs",
  "review-logs"
]);
const RECOVERABLE_IGNORED_DIRS = new Set([".git", ".aris-app", ".cache", ".pnpm-store", "node_modules", ".venv", "venv", "__pycache__", "dist", "release"]);
const NON_COMPLETION_ARTIFACT_NAMES = new Set(["RESEARCH_BRIEF.md"]);

interface ProgressInsightState {
  cursor: number;
  activeStageKey?: string;
  seenStageKeys: Set<string>;
}

interface CommandAttempt {
  args: string[];
  stdinText?: string;
}

interface WorkflowPromptBuildInput {
  workflowType: WorkflowType;
  topic: string;
  continuationPrompt?: string;
  launchConfig?: WorkflowLaunchConfig | null;
  extraPrompt?: string | null;
  promptOverride?: string | null;
}

const STAGE_TITLES: Record<string, string> = {
  "idea-discovery": "立题发现",
  "auto-review-loop": "写作前评审",
  "experiment-bridge": "实验桥接",
  "paper-plan": "论文规划",
  "paper-write": "论文写作",
  "paper-compile": "论文编译",
  "multi-agent-paper-review": "成稿后多 Agent 评审",
  "artifact-summary": "成果摘要",
  "run-complete": "运行收尾"
};

export function listRuns(projectId: string): Run[] {
  const rows = getDb().prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC").all(projectId) as any[];
  return rows.map(mapRun);
}

export function getRun(runId: string): RunDetail {
  const run = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  if (!run) throw new Error("运行记录不存在");
  const steps = getDb().prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at ASC").all(runId) as any[];
  const events = readEventsForRun(runId);
  const insights = listRunInsights(runId);
  return { ...mapRun(run), steps: steps.map(mapRunStep), events, insights };
}

export function cleanupInterruptedRuns() {
  if (process.env.ARIS_USE_LEGACY_INTERRUPTED_RUN_CLEANUP === "1") {
    cleanupInterruptedRunsLegacy();
    return;
  }
  const endedAt = nowIso();
  const db = getDb();
  const rows = db.prepare(
    `SELECT
       runs.id,
       runs.project_id,
       runs.status,
       runs.started_at,
       runs.ended_at,
       repositories.path AS repo_path
     FROM runs
     INNER JOIN projects ON projects.id = runs.project_id
     LEFT JOIN repositories ON repositories.id = projects.repository_id
     WHERE runs.status IN ('running', 'failed')
     ORDER BY runs.started_at ASC`
  ).all() as Array<{
    id: string;
    project_id: string;
    status: string;
    started_at?: string | null;
    ended_at?: string | null;
    repo_path?: string | null;
  }>;
  const touchedProjectIds = new Set(rows.map((row) => row.project_id));

  for (const row of rows) {
    const rowEndedAt = row.ended_at ?? endedAt;
    const recovery = recoverInterruptedRunArtifacts(row.project_id, row.id, row.repo_path, row.started_at, rowEndedAt);
    if (recovery.recovered) {
      const message = `${RECOVERED_INTERRUPTED_RUN_MESSAGE} (${recovery.artifactCount} artifacts)`;
      db.prepare(
        `UPDATE run_steps
         SET status = 'completed', ended_at = COALESCE(ended_at, ?), error_message = ?
         WHERE run_id = ? AND status IN ('running', 'failed')`
      ).run(rowEndedAt, message, row.id);
      db.prepare(
        `UPDATE runs
         SET status = 'completed', ended_at = COALESCE(ended_at, ?), error_message = ?
         WHERE id = ?`
      ).run(rowEndedAt, message, row.id);
      db.prepare("UPDATE projects SET status = 'completed', updated_at = ? WHERE id = ?").run(rowEndedAt, row.project_id);
      continue;
    }

    if (row.status === "running") {
      db.prepare(
        `UPDATE run_steps
         SET status = 'failed', ended_at = COALESCE(ended_at, ?), error_message = COALESCE(error_message, ?)
         WHERE run_id = ? AND status = 'running'`
      ).run(rowEndedAt, INTERRUPTED_RUN_FAILED_MESSAGE, row.id);
      db.prepare(
        `UPDATE runs
         SET status = 'failed', ended_at = COALESCE(ended_at, ?), error_message = COALESCE(error_message, ?)
         WHERE id = ?`
      ).run(rowEndedAt, INTERRUPTED_RUN_FAILED_MESSAGE, row.id);
    }
    db.prepare("UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ?").run(rowEndedAt, row.project_id);
  }

  for (const projectId of touchedProjectIds) {
    syncProjectStatusFromLatestRun(projectId, endedAt);
  }
}

function cleanupInterruptedRunsLegacy() {
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

function recoverInterruptedRunArtifacts(
  projectId: string,
  runId: string,
  repoPath: string | null | undefined,
  startedAtValue: string | null | undefined,
  endedAtValue: string | null | undefined
) {
  if (!repoPath || !existsSync(repoPath) || !startedAtValue) return { recovered: false, artifactCount: 0 };
  const startedAt = new Date(startedAtValue);
  if (Number.isNaN(startedAt.getTime())) return { recovered: false, artifactCount: 0 };
  const endedAt = endedAtValue ? new Date(endedAtValue) : null;
  try {
    rescanArtifacts(projectId, runId);
  } catch {
    return { recovered: false, artifactCount: 0 };
  }
  const artifactCount = countRecoverableRunArtifacts(runId);
  const producedResearchArtifact = artifactCount > 0 || hasRecoverableArtifact(repoPath, startedAt, endedAt);
  return { recovered: producedResearchArtifact, artifactCount };
}

function countRecoverableRunArtifacts(runId: string) {
  const rows = getDb().prepare("SELECT name FROM artifacts WHERE run_id = ?").all(runId) as Array<{ name: string }>;
  return rows.filter((row) => isCompletionArtifactName(row.name)).length;
}

function isCompletionArtifactName(name: string) {
  const normalized = name.replace(/\\/g, "/");
  const base = path.basename(normalized);
  if (NON_COMPLETION_ARTIFACT_NAMES.has(base)) return false;
  if (normalized.startsWith(".aris-app/")) return false;
  return true;
}

function hasRecoverableArtifact(repoPath: string, startedAt: Date, endedAt: Date | null) {
  const lowerBound = new Date(startedAt);
  lowerBound.setSeconds(lowerBound.getSeconds() - 2);
  const upperBound = endedAt && !Number.isNaN(endedAt.getTime()) ? new Date(endedAt) : null;
  if (upperBound) upperBound.setSeconds(upperBound.getSeconds() + 2);
  for (const artifactPath of CORE_ARTIFACTS) {
    const fullPath = path.join(repoPath, artifactPath);
    if (isChangedRecoverableFile(fullPath, repoPath, lowerBound, upperBound)) return true;
  }
  return scanRecoverableArtifacts(repoPath, repoPath, lowerBound, upperBound);
}

function scanRecoverableArtifacts(root: string, repoPath: string, lowerBound: Date, upperBound: Date | null): boolean {
  if (!existsSync(root)) return false;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (RECOVERABLE_IGNORED_DIRS.has(entry.name)) continue;
      const relRoot = path.relative(repoPath, full).replace(/\\/g, "/").split("/")[0] ?? "";
      if (!RECOVERABLE_ARTIFACT_ROOTS.has(relRoot)) continue;
      if (scanRecoverableArtifacts(full, repoPath, lowerBound, upperBound)) return true;
      continue;
    }
    if (isChangedRecoverableFile(full, repoPath, lowerBound, upperBound)) return true;
  }
  return false;
}

function isChangedRecoverableFile(filePath: string, repoPath: string, lowerBound: Date, upperBound: Date | null) {
  const rel = path.relative(repoPath, filePath).replace(/\\/g, "/");
  const root = rel.includes("/") ? rel.split("/")[0] : "";
  if (!RECOVERABLE_ARTIFACT_ROOTS.has(root)) return false;
  if (!isCompletionArtifactName(rel)) return false;
  if (!isResearchArtifactExtension(filePath)) return false;
  const mtime = statMtime(filePath);
  if (mtime < lowerBound) return false;
  if (upperBound && mtime > upperBound) return false;
  return true;
}

function isResearchArtifactExtension(filePath: string) {
  return [".md", ".pdf", ".docx", ".doc", ".json", ".jsonl", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".tex", ".csv", ".html", ".htm", ".txt"].includes(
    path.extname(filePath).toLowerCase()
  );
}

function syncProjectStatusFromLatestRun(projectId: string, fallbackUpdatedAt: string) {
  const row = getDb()
    .prepare(
      `SELECT runs.status, runs.started_at, runs.ended_at, projects.repository_id
       FROM projects
       LEFT JOIN runs ON runs.project_id = projects.id
       WHERE projects.id = ?
       ORDER BY runs.started_at DESC
       LIMIT 1`
    )
    .get(projectId) as { status?: string | null; started_at?: string | null; ended_at?: string | null; repository_id?: string | null } | undefined;
  if (!row) return;
  const status = row.status && ["completed", "failed", "running", "waiting_approval"].includes(row.status)
    ? row.status
    : row.repository_id
      ? "ready"
      : "draft";
  getDb().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, row.ended_at ?? row.started_at ?? fallbackUpdatedAt, projectId);
}

export async function startRun(input: StartRunInput): Promise<Run> {
  const project = getProject(input.projectId);
  if (!project.repository?.path) throw new Error("项目尚未绑定 Git 仓库");
  const executor = getExecutor(input.executorId ?? project.defaultExecutorId ?? "executor-codex");
  const workflowType = (input.launchConfig?.workflowType ?? input.workflowType) as WorkflowType;
  const topic = input.launchConfig?.topic?.trim() || input.topic || project.topic;
  const runId = id("run");
  const stepId = id("step");
  const startedAt = nowIso();
  const runStartedAt = new Date(startedAt);
  const runDir = path.join(project.repository.path, ".aris-app", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const stdoutPath = path.join(runDir, "stdout.log");
  const stderrPath = path.join(runDir, "stderr.log");
  const eventsPath = path.join(runDir, "events.jsonl");
  const progressPath = path.join(runDir, "progress.zh.jsonl");
  writeFileSync(stdoutPath, "", "utf8");
  writeFileSync(stderrPath, "", "utf8");
  writeFileSync(eventsPath, "", "utf8");
  writeFileSync(progressPath, "", "utf8");
  writeResearchBrief(project.repository.path, workflowType, topic, runId, input.launchConfig ?? undefined);

  const gitBefore = await readGitStatus(project.repository.path).catch((error) => ({ error: String(error) }));
  writeFileSync(path.join(runDir, "git-before.json"), JSON.stringify(gitBefore, null, 2), "utf8");

  const commandPlan = buildWorkflowCommandPlan(executor, workflowType, topic, project.repository.path, input.continuationPrompt ?? undefined, input.launchConfig ?? undefined, input.extraPrompt ?? undefined, input.promptOverride ?? undefined);
  const firstAttempt = commandPlan[0];
  const args = firstAttempt.args;
  const command = executor.kind === "codex-cli" ? normalizeCodexExecutablePath(executor.executablePath) : executor.executablePath;
  const hardIdleTimeoutMs = parsePositiveInt(executor.env?.ARIS_HARD_IDLE_TIMEOUT_MS, DEFAULT_HARD_IDLE_TIMEOUT_MS);
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (
      id, project_id, workflow_template_id, workflow_type, executor_id, status, current_node_id,
      round_index, parent_run_id, continuation_index, continuation_reason,
      launch_config_json, extra_prompt, prompt_override, started_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    project.id,
    project.defaultWorkflowId ?? null,
    workflowType,
    executor.id,
    stepId,
    project.runCount + 1,
    input.parentRunId ?? null,
    input.continuationIndex ?? 0,
    input.continuationReason ?? null,
    input.launchConfig ? JSON.stringify(input.launchConfig) : null,
    input.extraPrompt ?? null,
    input.promptOverride ?? null,
    startedAt
  );
  db.prepare(
    `INSERT INTO run_steps (id, run_id, status, command, args_json, stdout_path, stderr_path, started_at)
    VALUES (?, ?, 'running', ?, ?, ?, ?, ?)`
  ).run(stepId, runId, command, JSON.stringify(args), stdoutPath, stderrPath, startedAt);
  db.prepare("UPDATE projects SET status = 'running', run_count = run_count + 1, updated_at = ? WHERE id = ?").run(startedAt, project.id);

  emit(runDir, { runId, stepId, type: "start", message: [command, ...args].join(" "), timestamp: startedAt });
  const progressState = createProgressInsightState();
  emitInitialStage(runDir, runId, buildRunStages(project.defaultWorkflowId, workflowType), progressState, stepId, startedAt);
  if (executor.kind === "codex-cli") {
    emit(runDir, { runId, stepId, type: "stderr", message: `Codex model plan: ${describeModelPlan(commandPlan)}`, timestamp: nowIso() });
  }

  let activeChild = startChild(command, args, project.repository.path, executor.env, executor.kind === "codex-cli", firstAttempt.stdinText);
  running.set(runId, activeChild);
  let lastOutputAt = Date.now();
  let softIdleWarningSent = false;
  let artifactWaitNoticeSent = false;
  let artifactSummarySent = false;
  const flushProgressInsights = () => {
    emitProgressInsights(progressPath, runDir, runId, stepId, progressState);
  };
  const progressWatcher = watchProgressFile(progressPath, flushProgressInsights);
  const idleTimer = setInterval(() => {
    flushProgressInsights();
    if (!artifactSummarySent && hasCoreArtifact(project.repository!.path, runStartedAt)) {
      artifactSummarySent = true;
      emitArtifactSummary(project.repository!.path, runDir, runId, stepId, runStartedAt);
    }
    const idleFor = Date.now() - lastOutputAt;
    if (idleFor >= SOFT_IDLE_TIMEOUT_MS && !softIdleWarningSent) {
      softIdleWarningSent = true;
      emit(runDir, {
        runId,
        stepId,
        type: "stderr",
        message: "Executor produced no output for 300 seconds; keeping it alive and waiting for progress.",
        timestamp: nowIso()
      });
    }
    if (idleFor < hardIdleTimeoutMs) return;
    if (hasCoreArtifact(project.repository!.path, runStartedAt)) {
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
    ensureFallbackArtifact(project.repository!.path, runId, workflowType, topic, null, idleMessage);
    emit(runDir, {
      runId,
      stepId,
      type: "error",
      message: idleMessage,
      timestamp: nowIso()
    });
    clearInterval(idleTimer);
  }, 15000);
  const attachStreams = (activeChild: ReturnType<typeof startChild>, activeArgs: string[]) => {
    activeChild.stdout?.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      const message = decodeTextBuffer(chunk);
      appendFileSync(stdoutPath, message, "utf8");
      if (executor.kind === "codex-cli") {
        recordUsageFromText({
          projectId: project.id,
          runId,
          source: "run",
          model: modelFromArgs(activeArgs),
          reasoningEffort: reasoningEffortFromExecutor(executor, input.launchConfig)
        }, message);
      }
      emit(runDir, { runId, stepId, type: "stdout", message: redact(message), timestamp: nowIso() });
    });
    activeChild.stderr?.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      const message = decodeTextBuffer(chunk);
      appendFileSync(stderrPath, message, "utf8");
      if (executor.kind === "codex-cli") {
        recordUsageFromText({
          projectId: project.id,
          runId,
          source: "run",
          model: modelFromArgs(activeArgs),
          reasoningEffort: reasoningEffortFromExecutor(executor, input.launchConfig)
        }, message);
      }
      emit(runDir, { runId, stepId, type: "stderr", message: redact(message), timestamp: nowIso() });
    });
  };
  attachStreams(activeChild, args);
  activeChild
    .then(async (firstResult) => {
      let result = firstResult;
      let attemptIndex = 1;
      while (shouldRetryForModelCapacity(result.stderr || result.stdout) && attemptIndex < commandPlan.length) {
        const nextAttempt = commandPlan[attemptIndex];
        const nextArgs = nextAttempt.args;
        const retryMessage = `Model capacity is unavailable; retrying with fallback arguments: ${redact([command, ...nextArgs].join(" "))}`;
        appendFileSync(stderrPath, `${retryMessage}\n`, "utf8");
        emit(runDir, { runId, stepId, type: "stderr", message: retryMessage, timestamp: nowIso() });
        db.prepare("UPDATE run_steps SET args_json = ? WHERE id = ?").run(JSON.stringify(nextArgs), stepId);
        activeChild = startChild(command, nextArgs, project.repository!.path, executor.env, executor.kind === "codex-cli", nextAttempt.stdinText);
        running.set(runId, activeChild);
        attachStreams(activeChild, nextArgs);
        result = await activeChild;
        attemptIndex += 1;
      }
      flushProgressInsights();
      running.delete(runId);
      progressWatcher.close();
      clearInterval(idleTimer);
      const endedAt = nowIso();
      const gitAfter = await readGitStatus(project.repository!.path).catch((error) => ({ error: String(error) }));
      writeFileSync(path.join(runDir, "git-after.json"), JSON.stringify(gitAfter, null, 2), "utf8");
      ensureFallbackArtifact(project.repository!.path, runId, workflowType, topic, result.exitCode ?? null, result.stderr || result.stdout || "");
      if (shouldRunMultiAgentPaperReview(workflowType)) {
        await runMultiAgentPaperReview(project.repository!.path, runDir, runId, stepId, topic, input.launchConfig);
      }
      const artifacts = rescanArtifacts(project.id, runId);
      const producedCoreArtifact = hasCoreArtifact(project.repository!.path, runStartedAt);
      const status = result.exitCode === 0 || producedCoreArtifact ? "completed" : "failed";
      if (producedCoreArtifact) emitArtifactSummary(project.repository!.path, runDir, runId, stepId, runStartedAt);
      emitQualityRiskIfNeeded(project.repository!.path, runDir, runId, stepId, workflowType, runStartedAt, new Date(endedAt), input.launchConfig);
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
      emitInsight(runDir, {
        runId,
        stageKey: "run-complete",
        title: "运行收尾",
        status,
        bullets: [status === "completed" ? "Workflow 已结束，并已扫描本地成果。" : "Workflow 已结束，但没有检测到核心成果。"],
        blockers: status === "failed" && errorMessage ? [errorMessage] : [],
        nextActions: status === "completed" ? ["打开成果预览查看 Markdown、PDF 和评审报告。"] : ["查看原始日志，修正执行器或环境问题后重试。"],
        agentName: "ARIS Paper Studio",
        timestamp: endedAt
      }, stepId);
      await maybeAutoContinueRun({
        projectId: project.id,
        runId,
        workflowType,
        executorId: executor.id,
        topic,
        status,
        exitCode: result.exitCode ?? null,
        errorMessage,
        continuationIndex: input.continuationIndex ?? 0,
        launchConfig: input.launchConfig ?? null
      });
    })
    .catch(async (error) => {
      running.delete(runId);
      progressWatcher.close();
      clearInterval(idleTimer);
      const endedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      ensureFallbackArtifact(project.repository!.path, runId, workflowType, topic, null, message);
      const artifacts = rescanArtifacts(project.id, runId);
      const producedCoreArtifact = hasCoreArtifact(project.repository!.path, runStartedAt);
      const status = producedCoreArtifact ? "completed" : "failed";
      if (producedCoreArtifact) emitArtifactSummary(project.repository!.path, runDir, runId, stepId, runStartedAt);
      emitQualityRiskIfNeeded(project.repository!.path, runDir, runId, stepId, workflowType, runStartedAt, new Date(endedAt), input.launchConfig);
      const errorMessage = producedCoreArtifact
        ? "Executor failed before normal exit, but a fallback artifact was produced."
        : message;
      db.prepare("UPDATE run_steps SET status = ?, ended_at = ?, error_message = ? WHERE id = ?").run(status, endedAt, errorMessage, stepId);
      db.prepare("UPDATE runs SET status = ?, ended_at = ?, error_message = ? WHERE id = ?").run(status, endedAt, errorMessage, runId);
      db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, endedAt, project.id);
      writeFileSync(path.join(runDir, "artifacts.json"), JSON.stringify(artifacts, null, 2), "utf8");
      emit(runDir, {
        runId,
        stepId,
        type: producedCoreArtifact ? "exit" : "error",
        message: producedCoreArtifact ? "运行完成；执行器异常退出，但已生成可检查成果。" : message,
        timestamp: endedAt
      });
      emitInsight(runDir, {
        runId,
        stageKey: "run-complete",
        title: "运行收尾",
        status,
        bullets: [producedCoreArtifact ? "执行器异常退出，但已留下可检查的中文成果。" : "执行器异常退出，且没有检测到核心成果。"],
        blockers: status === "failed" ? [message] : [],
        nextActions: producedCoreArtifact ? ["打开成果预览继续检查输出质量。"] : ["查看日志定位执行器错误后重试。"],
        agentName: "ARIS Paper Studio",
        timestamp: endedAt
      }, stepId);
      await maybeAutoContinueRun({
        projectId: project.id,
        runId,
        workflowType,
        executorId: executor.id,
        topic,
        status,
        exitCode: null,
        errorMessage,
        continuationIndex: input.continuationIndex ?? 0,
        launchConfig: input.launchConfig ?? null
      });
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

export async function continueRun(runId: string, input: ContinueRunInput = {}): Promise<Run> {
  const row = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
  if (!row) throw new Error("运行记录不存在");
  const project = getProject(row.project_id);
  const workflowType = (input.launchConfig?.workflowType ?? row.workflow_type ?? "research-pipeline") as WorkflowType;
  const nextIndex = (row.continuation_index ?? 0) + 1;
  const reason = "manual";
  const chain = findOrCreateChain(project.id, "run", runId);
  const continuationPrompt = joinPromptParts(
    buildRunContinuationPrompt(runId, "用户手动续接"),
    input.extraPrompt?.trim() ? `## 用户本轮续接干预\n\n${input.extraPrompt.trim()}` : ""
  );
  const next = await startRun({
    projectId: project.id,
    workflowType,
    executorId: row.executor_id ?? project.defaultExecutorId ?? "executor-codex",
    topic: input.launchConfig?.topic?.trim() || project.topic,
    parentRunId: runId,
    continuationIndex: nextIndex,
    continuationReason: reason,
    continuationPrompt,
    launchConfig: input.launchConfig ?? parseJson<WorkflowLaunchConfig | null>(row.launch_config_json, null),
    extraPrompt: input.extraPrompt ?? null,
    promptOverride: input.promptOverride ?? null
  });
  recordContinuationEvent({
    chainId: chain.id,
    projectId: project.id,
    itemType: "run",
    itemId: next.id,
    parentItemId: runId,
    continuationIndex: nextIndex,
    reason,
    status: "started",
    summary: "用户手动续接 Workflow"
  });
  return next;
}

async function maybeAutoContinueRun(input: {
  projectId: string;
  runId: string;
  workflowType: WorkflowType;
  executorId: string;
  topic: string;
  status: Run["status"];
  exitCode: number | null;
  errorMessage?: string | null;
  continuationIndex: number;
  launchConfig?: WorkflowLaunchConfig | null;
}) {
  const reasonKey = continuationReasonFromRun(input.status, input.exitCode, input.errorMessage);
  if (!reasonKey) return;
  const nextIndex = input.continuationIndex + 1;
  if (input.launchConfig?.autoContinueEnabled === false) {
    const chain = findOrCreateChain(input.projectId, "run", input.runId);
    recordContinuationEvent({
      chainId: chain.id,
      projectId: input.projectId,
      itemType: "run",
      itemId: input.runId,
      parentItemId: null,
      continuationIndex: input.continuationIndex,
      reason: reasonKey,
      status: "skipped",
      summary: "本轮配置已关闭自动续接"
    });
    return;
  }
  if (input.launchConfig?.maxContinuations && nextIndex > input.launchConfig.maxContinuations) {
    const chain = findOrCreateChain(input.projectId, "run", input.runId);
    markContinuationStopped(chain.id, "已达到本轮配置的最大续接次数");
    recordContinuationEvent({
      chainId: chain.id,
      projectId: input.projectId,
      itemType: "run",
      itemId: input.runId,
      parentItemId: null,
      continuationIndex: input.continuationIndex,
      reason: reasonKey,
      status: "stopped",
      summary: "已达到本轮配置的最大续接次数"
    });
    return;
  }
  const noArtifactStopReason = consecutiveNoArtifactStopReason(input.runId);
  if (noArtifactStopReason) {
    const chain = findOrCreateChain(input.projectId, "run", input.runId);
    markContinuationStopped(chain.id, noArtifactStopReason);
    recordContinuationEvent({
      chainId: chain.id,
      projectId: input.projectId,
      itemType: "run",
      itemId: input.runId,
      parentItemId: null,
      continuationIndex: input.continuationIndex,
      reason: reasonKey,
      status: "stopped",
      summary: noArtifactStopReason
    });
    return;
  }
  const decision = canStartContinuation(input.projectId, "run", input.runId, nextIndex, reasonKey);
  if (!decision.ok || !decision.chain) {
    const chain = findOrCreateChain(input.projectId, "run", input.runId);
    recordContinuationEvent({
      chainId: chain.id,
      projectId: input.projectId,
      itemType: "run",
      itemId: input.runId,
      parentItemId: null,
      continuationIndex: input.continuationIndex,
      reason: reasonKey,
      status: chain.stopped ? "stopped" : "skipped",
      summary: decision.reason
    });
    return;
  }
  const next = await startRun({
    projectId: input.projectId,
    workflowType: input.workflowType,
    executorId: input.executorId,
    topic: input.topic,
    parentRunId: input.runId,
    continuationIndex: nextIndex,
    continuationReason: reasonKey,
    continuationPrompt: buildRunContinuationPrompt(input.runId, reasonKey),
    launchConfig: input.launchConfig ?? null
  });
  recordContinuationEvent({
    chainId: decision.chain.id,
    projectId: input.projectId,
    itemType: "run",
    itemId: next.id,
    parentItemId: input.runId,
    continuationIndex: nextIndex,
    reason: reasonKey,
    status: "started",
    summary: `自动续接 Workflow：${reasonKey}`
  });
}

function consecutiveNoArtifactStopReason(runId: string) {
  if (countRecoverableRunArtifacts(runId) > 0) return "";
  const row = getDb().prepare("SELECT parent_run_id FROM runs WHERE id = ?").get(runId) as { parent_run_id?: string | null } | undefined;
  if (!row?.parent_run_id) return "";
  if (countRecoverableRunArtifacts(row.parent_run_id) > 0) return "";
  return "连续两段没有新增有效产物，自动续接已停止";
}

function startChild(command: string, args: string[], cwd: string, env?: Record<string, string>, syncCodexModelEnv = false, stdinText?: string) {
  const childEnv = { ...process.env, ...UTF8_PROCESS_ENV, ...(env ?? {}) };
  if (syncCodexModelEnv) {
    const modelFlagIndex = args.indexOf("-m");
    if (modelFlagIndex >= 0 && args[modelFlagIndex + 1]) {
      childEnv.OPENAI_MODEL = args[modelFlagIndex + 1];
    } else {
      delete childEnv.OPENAI_MODEL;
    }
  }
  const child = execa(command, args, {
    cwd,
    env: childEnv,
    stdin: stdinText ? "pipe" : "ignore",
    reject: false,
    all: false
  });
  if (stdinText) child.stdin?.end(`${stdinText}\n`);
  return child;
}

function shouldRunMultiAgentPaperReview(workflowType: WorkflowType) {
  return workflowType === "research-pipeline" || workflowType === "paper-writing" || workflowType === "multi-agent-paper-review";
}

async function runMultiAgentPaperReview(repoPath: string, runDir: string, runId: string, stepId: string, topic: string, launchConfig?: WorkflowLaunchConfig | null) {
  const reviewDir = path.join(repoPath, "review-stage");
  const summaryPath = path.join(reviewDir, "MULTI_AGENT_REVIEW.md");
  if (existsSync(summaryPath) && !launchConfig?.rerunExistingReview) {
    emitInsight(runDir, {
      runId,
      stageKey: "multi-agent-paper-review",
      title: "成稿后多 Agent 评审",
      status: "completed",
      bullets: ["已检测到现有综合评审报告，跳过重复评审。"],
      blockers: [],
      nextActions: ["打开 review-stage/MULTI_AGENT_REVIEW.md 查看综合评分。"],
      agentName: "ARIS Paper Studio",
      timestamp: nowIso()
    }, stepId);
    return;
  }
  mkdirSync(reviewDir, { recursive: true });
  emitInsight(runDir, {
    runId,
    stageKey: "multi-agent-paper-review",
    title: "成稿后多 Agent 评审",
    status: "running",
    bullets: ["正在启动 3 个独立评审 agent：创新性、实验可信度、写作/投稿适配。"],
    blockers: [],
    nextActions: ["等待分项评审报告和综合评分。"],
    agentName: "ARIS Paper Studio",
    timestamp: nowIso()
  }, stepId);

  const reviewers = [
    { key: "innovation", name: "创新性评审 Agent", file: "AGENT_INNOVATION_REVIEW.md", focus: "创新性、相关工作差异、方法新颖程度" },
    { key: "evidence", name: "实验可信度评审 Agent", file: "AGENT_EVIDENCE_REVIEW.md", focus: "实验设计、结果可信度、消融和统计证据" },
    { key: "writing", name: "写作与投稿适配评审 Agent", file: "AGENT_WRITING_REVIEW.md", focus: "论文结构、表达质量、目标会议或期刊适配性" }
  ];
  const executor = getExecutor("executor-codex");
  const results = await Promise.all(reviewers.map(async (reviewer) => {
    const prompt = buildReviewerPrompt(topic, reviewer.name, reviewer.focus, path.join("review-stage", reviewer.file));
    const command = normalizeCodexExecutablePath(executor.executablePath);
    const child = startChild(command, ["exec", "-C", repoPath, "--skip-git-repo-check", "--sandbox", "workspace-write", "-"], repoPath, executor.env, false, prompt);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 300000);
    const result = await child.catch((error) => ({ exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
    clearTimeout(timeout);
    return { reviewer, result };
  }));
  const failures = results.filter((item) => item.result.exitCode !== 0);
  writeMultiAgentSummary(repoPath, topic, results.map((item) => item.reviewer.file), failures.map((item) => `${item.reviewer.name}: ${item.result.stderr || item.result.stdout}`));
  emitInsight(runDir, {
    runId,
    stageKey: "multi-agent-paper-review",
    title: "成稿后多 Agent 评审",
    status: failures.length === reviewers.length ? "blocked" : "completed",
    bullets: [
      `已完成 ${reviewers.length - failures.length}/${reviewers.length} 个评审 agent。`,
      "综合评审已写入 review-stage/MULTI_AGENT_REVIEW.md。"
    ],
    blockers: failures.slice(0, 3).map((item) => `${item.reviewer.name} 失败：${item.result.stderr || item.result.stdout || "无输出"}`),
    nextActions: ["查看综合评分、主要拒稿风险和必须修改项。"],
    agentName: "ARIS Paper Studio",
    timestamp: nowIso()
  }, stepId);
}

function buildReviewerPrompt(topic: string, agentName: string, focus: string, outputPath: string) {
  return [
    `你是 ${agentName}。`,
    `研究主题：${topic}`,
    `评审重点：${focus}`,
    "请读取当前仓库中的论文、报告、实验结果和已有产物，完成独立中文评审。",
    "必须写入指定 Markdown 文件，不要只在终端输出。",
    `输出文件：${outputPath}`,
    "报告必须包含：0-10 分评分、主要优点、主要问题、拒稿风险、必须修改项、可选增强项。",
    "正文以中文为主；论文标题、术语、代码、引用可保留英文。",
    "不要执行 destructive Git 命令，不要 commit 或 push。"
  ].join("\n");
}

function writeMultiAgentSummary(repoPath: string, topic: string, reviewFiles: string[], failures: string[]) {
  const reviewDir = path.join(repoPath, "review-stage");
  mkdirSync(reviewDir, { recursive: true });
  const summaries = reviewFiles.map((file) => {
    const fullPath = path.join(reviewDir, file);
    if (!existsSync(fullPath)) return `- ${file}: 未生成。`;
    const text = readTextFile(fullPath).slice(0, 2500);
    return `## ${file}\n\n${text}`;
  });
  const content = [
    "# 多 Agent 综合论文评审",
    "",
    `- 研究主题：${topic}`,
    `- 生成时间：${nowIso()}`,
    "",
    "## 总体评分",
    "",
    "请结合下方三个评审 agent 的分报告进行人工复核。若某个 agent 未成功生成报告，本节评分应视为暂定。",
    "",
    "## 分项评审摘录",
    "",
    summaries.join("\n\n"),
    "",
    "## 主要拒稿风险",
    "",
    "- 请优先检查创新性是否足够清晰、实验是否能支撑核心主张、写作是否匹配目标会议或期刊。",
    "",
    "## 必须修改项",
    "",
    "- 根据三个评审 agent 的意见，逐条修复高风险问题后再进入下一轮写作或投稿准备。",
    "",
    "## 可选增强项",
    "",
    "- 补充更强的消融、可视化和相关工作对照，以提高论文说服力。",
    failures.length ? "\n## 评审执行问题\n\n" + failures.map((item) => `- ${item}`).join("\n") : "",
    ""
  ].join("\n");
  writeFileSync(path.join(reviewDir, "MULTI_AGENT_REVIEW.md"), content, "utf8");
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
  repoPath: string,
  continuationPrompt?: string,
  launchConfig?: WorkflowLaunchConfig | null,
  extraPrompt?: string | null,
  promptOverride?: string | null
): CommandAttempt[] {
  if (executor.kind === "codex-cli") {
    const stdinText = buildWorkflowPromptForPreview({ workflowType, topic, continuationPrompt, launchConfig, extraPrompt, promptOverride });
    const makeArgs = (model?: string) => {
      const args = ["exec", "-C", repoPath, "--skip-git-repo-check", "--json", "--color", "never"];
      const sandbox = launchConfig?.sandbox?.trim() || executor.env?.CODEX_SANDBOX_MODE || "danger-full-access";
      const approval = launchConfig?.approval?.trim() || executor.env?.CODEX_APPROVAL_MODE || "never";
      if (sandbox === "danger-full-access" && approval === "never") {
        args.push("--dangerously-bypass-approvals-and-sandbox");
      } else {
        args.push("--sandbox", sandbox);
      }
      if (model) args.push("-m", model);
      args.push("-c", `model_reasoning_effort="${reasoningEffortFromExecutor(executor, launchConfig)}"`);
      args.push("-");
      return args;
    };
    const configuredModel = launchConfig?.model?.trim() || executor.env?.OPENAI_MODEL?.trim();
    const configuredFallbacks = parseModelList(executor.env?.OPENAI_FALLBACK_MODELS);
    const fallbackModels = configuredFallbacks.length ? configuredFallbacks : DEFAULT_FALLBACK_MODELS;
    const primaryModel = configuredModel && !["auto", "default"].includes(configuredModel.toLowerCase()) ? configuredModel : DEFAULT_PRIMARY_MODEL;
    const modelPlan = dedupeModels([primaryModel, ...fallbackModels]);
    return modelPlan.map((item) => ({ args: makeArgs(item), stdinText }));
  }
  if (executor.kind === "aris-code") {
    return [{ args: [workflowType, topic, "--auto-proceed"] }];
  }
  if (executor.kind === "claude-code") {
    return [{ args: [`/${workflowType} "${topic}" --auto proceed: true`] }];
  }
  if (executor.defaultArgs.length > 0 && !executor.defaultArgs.includes("--help") && !executor.defaultArgs.includes("--version")) {
    return [{ args: executor.defaultArgs }];
  }
  return [{ args: [workflowType, topic, "--auto-proceed"] }];
}

function describeModelPlan(commandPlan: CommandAttempt[]) {
  return commandPlan
    .map((attempt) => {
      const modelIndex = attempt.args.indexOf("-m");
      return modelIndex >= 0 && attempt.args[modelIndex + 1] ? attempt.args[modelIndex + 1] : "auto";
    })
    .join(" -> ");
}

function modelFromArgs(args: string[]) {
  const modelIndex = args.indexOf("-m");
  return modelIndex >= 0 && args[modelIndex + 1] ? args[modelIndex + 1] : DEFAULT_PRIMARY_MODEL;
}

function reasoningEffortFromExecutor(executor: ReturnType<typeof getExecutor>, launchConfig?: WorkflowLaunchConfig | null) {
  const value = launchConfig?.reasoningEffort?.trim() || executor.env?.CODEX_REASONING_EFFORT?.trim() || executor.env?.OPENAI_REASONING_EFFORT?.trim() || DEFAULT_REASONING_EFFORT;
  return ["low", "medium", "high", "xhigh"].includes(value) ? value : DEFAULT_REASONING_EFFORT;
}

export function buildWorkflowPromptForPreview(input: WorkflowPromptBuildInput) {
  if (input.promptOverride?.trim()) return input.promptOverride.trim();
  return buildCodexWorkflowPrompt(input.workflowType, input.topic, input.continuationPrompt, input.launchConfig, input.extraPrompt);
}

function joinPromptParts(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function buildCodexWorkflowPrompt(workflowType: WorkflowType, topic: string, continuationPrompt?: string, launchConfig?: WorkflowLaunchConfig | null, extraPrompt?: string | null) {
  const qualityBudget = qualityBudgetFor(workflowType, launchConfig);
  const pdfCompileGuidance = buildPdfCompileGuidance(workflowType, launchConfig);
  return appendUtf8Guidance([
    `请在当前仓库中执行 ARIS workflow：/${workflowType}`,
    `研究主题：${topic}`,
    "当前仓库可能是一个新的研究工作区。请以 RESEARCH_BRIEF.md 作为主要输入，不要把 .aris-app/runs 的历史运行日志当作研究材料反复分析。",
    "硬性要求：所有由你生成的 Markdown 报告、计划、评审和总结都必须以中文为主；英文论文标题、专有术语、代码、命令输出和引用可保留英文，不要机械翻译。",
    "硬性要求：在做长时间探索之前，先创建 idea-stage/IDEA_REPORT.md，写入初步研究问题、相关方向、候选 idea 和下一步计划。即使后续工具失败，也必须留下这个 Markdown 成果。",
    "运行可视化要求：每完成一个关键阶段，向 .aris-app/runs 目录下最新 run 的 progress.zh.jsonl 追加一行 JSON，字段为 stageKey、title、status、bullets、blockers、nextActions、agentName、timestamp。bullets、blockers、nextActions 必须是中文数组。",
    "运行可视化约束：只在真实进入、完成、受阻或失败某个阶段时写 progress.zh.jsonl；不要提前写未来阶段的 pending 记录，也不要伪造尚未发生的阶段。",
    "完整论文生成要求：如果 workflow 是 /research-pipeline，请按顺序推进：idea-discovery、写作前 auto-review-loop、experiment-bridge、paper-plan、paper-write、paper-compile、成稿后 multi-agent-paper-review。",
    pdfCompileGuidance,
    "成稿后 multi-agent-paper-review 要求：默认模拟或调用 3 个评审 agent，分别负责创新性、实验可信度、写作/投稿适配；每个 agent 输出中文分报告和 0-10 分，最后生成 review-stage/MULTI_AGENT_REVIEW.md，包含总分、分项分、主要拒稿风险、必须修改项、可选增强项。",
    `质量预算要求：本次任务属于“${qualityBudget.label}”，不要用几段占位文字快速结束。除非仓库已有充分成果可复用，否则应进行接近 ${Math.round(qualityBudget.minMs / 60000)} 分钟量级的阅读、分析、比较、写作或评审，并产出至少约 ${qualityBudget.minMarkdownChars} 个中文 Markdown 字符的实质内容。`,
    "如果你因为模型、环境或资料不足无法深入推进，请明确写出阻塞原因和已完成工作，不要伪装成完整论文生成已经完成。",
    "要求：",
    "1. 按 ARIS workflow 的语义真实推进任务，不要只输出说明。",
    "2. 首个产物必须是 idea-stage/IDEA_REPORT.md；随后可生成 NARRATIVE_REPORT.md、FINAL_REPORT.md、paper/paper.tex、paper/paper.pdf 或 review-stage/MULTI_AGENT_REVIEW.md。",
    "3. 如果可以继续推进，请生成阶段性中文报告、日志、LaTeX 或 PDF 产物，并写入当前仓库中的合理位置。",
    "4. 如果当前环境缺少某个外部工具，先用中文记录清楚缺失项，并产出可检查的 Markdown 报告。",
    "5. 不要执行 destructive Git 命令，不要自动 commit 或 push。",
    "6. 不要长时间只读取旧日志；如果需要参考运行记录，只读最近一次 run 的摘要即可。",
    launchConfig?.rerunExistingReview ? "7. 本轮用户允许重跑已有成稿后多 Agent 评审；如需重跑，请先说明为何需要覆盖旧评审。" : "",
    extraPrompt?.trim() ? "\n## 用户本轮附加干预\n\n" + extraPrompt.trim() : "",
    continuationPrompt ? "\n## 自动续接交接摘要\n\n" + continuationPrompt : ""
  ]).join("\n");
}

function buildPdfCompileGuidance(workflowType: WorkflowType, launchConfig?: WorkflowLaunchConfig | null) {
  const mode = launchConfig?.pdfCompileMode ?? "codex-skill-first";
  if (mode === "local-latex-first") {
    return "论文 PDF 编译要求：进入 paper-compile 阶段时，可以优先使用本地 LaTeX 工具链生成或修复 `paper/paper.pdf`；如果本地工具链缺失，请写入中文报告说明缺失项。";
  }
  if (workflowType === "paper-compile") {
    return "本次任务只做 paper-compile：请优先调用已安装的 `paper-compile` skill 生成或修复 `paper/paper.pdf`，不要重跑完整 research-pipeline。若 skill 不存在，再退回本地 LaTeX 工具链，并在 `paper/PDF_COMPILE_REPORT.zh.md` 中说明缺失原因、执行命令、错误和后续修复建议。";
  }
  return "论文 PDF 编译要求：进入 paper-compile 阶段时，优先调用已安装的 `paper-compile` skill 生成或修复 `paper/paper.pdf`。若 skill 不存在，再退回本地 LaTeX 工具链，并在报告中写明缺失原因、执行命令和修复建议。";
}

function writeResearchBrief(repoPath: string, workflowType: WorkflowType, topic: string, runId: string, launchConfig?: WorkflowLaunchConfig | null) {
  const qualityBudget = qualityBudgetFor(workflowType, launchConfig);
  const brief = appendUtf8Guidance([
    "# Research Brief",
    "",
    `- Topic: ${topic}`,
    `- Workflow: /${workflowType}`,
    `- Run ID: ${runId}`,
    `- Created At: ${nowIso()}`,
    "",
    "## 目标",
    "",
    "运行 ARIS 科研 workflow，并在当前仓库中产出可检查的中文 Markdown 报告、论文草稿、PDF 或评审结果。",
    "",
    "## 中文输出要求",
    "",
    "所有 Markdown 正文必须以中文为主；英文论文标题、专有术语、代码、命令输出和引用可以保留英文。",
    "",
    "## 质量预算",
    "",
    `本次任务属于“${qualityBudget.label}”。除非当前仓库已有充分可复用成果，否则不要快速生成占位式报告；请投入接近 ${Math.round(qualityBudget.minMs / 60000)} 分钟量级的分析/写作/评审，并产出至少约 ${qualityBudget.minMarkdownChars} 个中文 Markdown 字符的实质内容。`,
    "",
    "## 必须优先产出",
    "",
    "先创建 `idea-stage/IDEA_REPORT.md`，内容应包含问题定义、候选 idea、创新性假设和下一步行动。",
    "",
    "## 运行进展",
    "",
    `请把阶段进展逐行追加到 \`.aris-app/runs/${runId}/progress.zh.jsonl\`，每行 JSON 至少包含 \`stageKey\`、\`title\`、\`status\`、\`bullets\`、\`nextActions\`。`,
    "只记录真实阶段进展：阶段开始时 status 写 running，完成时写 completed，受阻或失败时写 blocked/failed；不要提前写未来阶段的 pending 行。",
    "",
    "## 约束",
    "",
    "- Do not treat `.aris-app/runs` as primary research content.",
    "- Do not commit or push automatically.",
    "- If any tool or model fails, write a Chinese Markdown report explaining what was completed and what blocked progress.",
    ""
  ]).join("\n");
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
    "## 状态",
    "",
    "Workflow 在退出前没有创建主要 Markdown 产物。ARIS Paper Studio 自动生成这份中文兜底报告，确保本次运行留下可检查结果。",
    "",
    "## 诊断",
    "",
    output.trim() ? output.slice(0, 8000) : "没有捕获到执行器输出。",
    "",
    "## 下一步",
    "",
    "请检查运行日志；如果是模型或环境问题，可以换用更轻量模型后重试，或在 `RESEARCH_BRIEF.md` 中补充更多项目上下文。",
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

function emitInsight(runDir: string, input: Omit<RunInsight, "id">, stepId?: string) {
  const insight: RunInsight = { ...input, id: id("insight") };
  getDb().prepare(
    `INSERT INTO run_insights (
      id, run_id, stage_key, title, status, bullets_json, blockers_json, next_actions_json, agent_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    insight.id,
    insight.runId,
    insight.stageKey,
    insight.title,
    insight.status,
    JSON.stringify(insight.bullets),
    JSON.stringify(insight.blockers),
    JSON.stringify(insight.nextActions),
    insight.agentName ?? null,
    insight.timestamp
  );
  emit(runDir, {
    runId: insight.runId,
    stepId,
    type: "insight",
    message: `${insight.title}：${insight.bullets[0] ?? insight.status}`,
    timestamp: insight.timestamp,
    payload: insight
  });
}

function listRunInsights(runId: string): RunInsight[] {
  const rows = getDb()
    .prepare("SELECT * FROM run_insights WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as any[];
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    stageKey: row.stage_key,
    title: row.title,
    status: row.status,
    bullets: parseJson<string[]>(row.bullets_json, []),
    blockers: parseJson<string[]>(row.blockers_json, []),
    nextActions: parseJson<string[]>(row.next_actions_json, []),
    agentName: row.agent_name,
    timestamp: row.created_at
  }));
}

function buildRunStages(defaultWorkflowId: string | null | undefined, workflowType: WorkflowType) {
  const canonical = canonicalStagesFor(workflowType);
  if (canonical.length > 0) return canonical;
  if (defaultWorkflowId) {
    try {
      const template = getWorkflowTemplate(defaultWorkflowId);
      const stages = template.nodes.filter((node) => node.enabled).map((node) => node.nodeKey);
      if (stages.length > 0) return stages;
    } catch {
      // Fall back to the launch type below.
    }
  }
  return [workflowType];
}

function canonicalStagesFor(workflowType: WorkflowType) {
  if (workflowType === "research-pipeline") {
    return ["idea-discovery", "auto-review-loop", "experiment-bridge", "paper-plan", "paper-write", "paper-compile", "multi-agent-paper-review"];
  }
  if (workflowType === "paper-writing") return ["paper-plan", "paper-write", "paper-compile", "multi-agent-paper-review"];
  if (workflowType === "paper-compile") return ["paper-compile"];
  if (workflowType === "multi-agent-paper-review") return ["multi-agent-paper-review"];
  return [];
}

function createProgressInsightState(): ProgressInsightState {
  return {
    cursor: 0,
    seenStageKeys: new Set<string>()
  };
}

function emitInitialStage(
  runDir: string,
  runId: string,
  stages: string[],
  state: ProgressInsightState,
  stepId: string | undefined,
  timestamp = nowIso()
) {
  const firstStageKey = stages[0];
  if (!firstStageKey) return;
  state.seenStageKeys.add(firstStageKey);
  state.activeStageKey = firstStageKey;
  emitInsight(runDir, {
    runId,
    stageKey: firstStageKey,
    title: STAGE_TITLES[firstStageKey] ?? firstStageKey,
    status: "running",
    bullets: ["正在启动该阶段。"],
    blockers: [],
    nextActions: ["等待执行器写入真实阶段进展。"],
    agentName: "ARIS Paper Studio",
    timestamp
  }, stepId);
}

function watchProgressFile(progressPath: string, onChange: () => void) {
  let watcher: FSWatcher | undefined;
  let closed = false;
  let pending = false;
  const flushSoon = () => {
    if (closed || pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (!closed) onChange();
    }, 100);
  };
  try {
    watcher = watch(progressPath, { persistent: false }, flushSoon);
  } catch {
    watcher = undefined;
  }
  const poller = setInterval(onChange, 3000);
  return {
    close() {
      closed = true;
      clearInterval(poller);
      watcher?.close();
    }
  };
}

function emitProgressInsights(
  progressPath: string,
  runDir: string,
  runId: string,
  stepId: string | undefined,
  state: ProgressInsightState
) {
  if (!existsSync(progressPath)) return;
  let lines: string[];
  try {
    const text = readTextFile(progressPath);
    const rawLines = text.split(/\r?\n/);
    if (rawLines.at(-1) === "") {
      rawLines.pop();
    } else {
      rawLines.pop();
    }
    lines = rawLines.filter(Boolean);
  } catch {
    return;
  }
  for (const line of lines.slice(state.cursor)) {
    try {
      const parsed = JSON.parse(line) as Partial<RunInsight>;
      emitProgressInsight(runDir, runId, stepId, state, {
        stageKey: parsed.stageKey ?? "artifact-summary",
        title: parsed.title ?? STAGE_TITLES[parsed.stageKey ?? "artifact-summary"] ?? "运行进展",
        status: coerceProgressStatus(parsed.status),
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String).slice(0, 8) : [],
        blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String).slice(0, 5) : [],
        nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions.map(String).slice(0, 5) : [],
        agentName: parsed.agentName ?? "执行器",
        timestamp: parsed.timestamp ?? nowIso()
      });
    } catch {
      emitProgressInsight(runDir, runId, stepId, state, {
        stageKey: "artifact-summary",
        title: "运行进展",
        status: "running",
        bullets: [line.slice(0, 300)],
        blockers: [],
        nextActions: [],
        agentName: "执行器",
        timestamp: nowIso()
      });
    }
  }
  state.cursor = lines.length;
}

function emitProgressInsight(
  runDir: string,
  runId: string,
  stepId: string | undefined,
  state: ProgressInsightState,
  insight: Omit<RunInsight, "id" | "runId">
) {
  const isNewStage = !state.seenStageKeys.has(insight.stageKey);
  if (isNewStage && state.activeStageKey && state.activeStageKey !== insight.stageKey) {
    emitInsight(runDir, {
      runId,
      stageKey: state.activeStageKey,
      title: STAGE_TITLES[state.activeStageKey] ?? state.activeStageKey,
      status: "completed",
      bullets: ["已进入下一阶段，上一阶段自动标记为完成。"],
      blockers: [],
      nextActions: [],
      agentName: "ARIS Paper Studio",
      timestamp: offsetIso(insight.timestamp, -1)
    }, stepId);
  }
  state.seenStageKeys.add(insight.stageKey);
  state.activeStageKey = insight.status === "running" ? insight.stageKey : undefined;
  emitInsight(runDir, {
    runId,
    ...insight
  }, stepId);
}

function offsetIso(value: string, offsetMs: number) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return nowIso();
  return new Date(parsed + offsetMs).toISOString();
}

function coerceProgressStatus(value: unknown): RunInsightStatus {
  return value === "completed" || value === "blocked" || value === "failed" || value === "running"
    ? value
    : "running";
}

function emitArtifactSummary(repoPath: string, runDir: string, runId: string, stepId: string | undefined, changedSince: Date) {
  const summaries = CORE_ARTIFACTS
    .map((artifactPath) => summarizeArtifact(repoPath, artifactPath, changedSince))
    .filter(Boolean) as string[];
  if (summaries.length === 0) return;
  emitInsight(runDir, {
    runId,
    stageKey: "artifact-summary",
    title: "成果摘要",
    status: "completed",
    bullets: summaries.slice(0, 6),
    blockers: [],
    nextActions: ["打开成果预览查看完整 Markdown、PDF 和多 Agent 评审报告。"],
    agentName: "ARIS Paper Studio",
    timestamp: nowIso()
  }, stepId);
}

function emitQualityRiskIfNeeded(
  repoPath: string,
  runDir: string,
  runId: string,
  stepId: string,
  workflowType: WorkflowType,
  startedAt: Date,
  endedAt: Date,
  launchConfig?: WorkflowLaunchConfig | null
) {
  const budget = qualityBudgetFor(workflowType, launchConfig);
  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  const markdownChars = countChangedMarkdownChars(repoPath, startedAt);
  const risks: string[] = [];
  if (elapsedMs < budget.minMs) {
    risks.push(`运行耗时约 ${Math.max(1, Math.round(elapsedMs / 60000))} 分钟，低于“${budget.label}”建议的 ${Math.round(budget.minMs / 60000)} 分钟深度工作预算。`);
  }
  if (markdownChars < budget.minMarkdownChars) {
    risks.push(`本轮新增/更新 Markdown 实质内容约 ${markdownChars} 字符，低于建议阈值 ${budget.minMarkdownChars} 字符。`);
  }
  if (risks.length === 0) return;
  emitInsight(runDir, {
    runId,
    stageKey: "quality-risk",
    title: "质量风险",
    status: "blocked",
    bullets: risks,
    blockers: ["本轮输出可能偏浅，建议不要直接视为完整高质量成果。"],
    nextActions: ["重新运行并延长分析预算，或在 Codex 对话中要求针对当前成果做深度补写/评审。"],
    agentName: "ARIS Paper Studio",
    timestamp: nowIso()
  }, stepId);
}

function qualityBudgetFor(workflowType: WorkflowType, launchConfig?: WorkflowLaunchConfig | null) {
  const fallback = QUALITY_BUDGETS[workflowType] ?? { minMs: 2 * 60 * 1000, minMarkdownChars: 1500, label: workflowType };
  return {
    label: fallback.label,
    minMs: launchConfig?.minRuntimeMinutes ? Math.max(1, Math.trunc(launchConfig.minRuntimeMinutes)) * 60 * 1000 : fallback.minMs,
    minMarkdownChars: launchConfig?.minMarkdownChars ? Math.max(1, Math.trunc(launchConfig.minMarkdownChars)) : fallback.minMarkdownChars
  };
}

function countChangedMarkdownChars(repoPath: string, changedSince: Date) {
  const files = [
    path.join(repoPath, "idea-stage", "IDEA_REPORT.md"),
    path.join(repoPath, "NARRATIVE_REPORT.md"),
    path.join(repoPath, "FINAL_REPORT.md"),
    path.join(repoPath, "PIPELINE_REPORT.md"),
    path.join(repoPath, "review-stage", "AUTO_REVIEW.md"),
    path.join(repoPath, "review-stage", "MULTI_AGENT_REVIEW.md"),
    path.join(repoPath, "paper", "paper.tex")
  ];
  return files.reduce((total, filePath) => {
    if (!existsSync(filePath) || statMtime(filePath) < changedSince) return total;
    try {
      return total + readTextFile(filePath).trim().length;
    } catch {
      return total;
    }
  }, 0);
}

function summarizeArtifact(repoPath: string, artifactPath: string, changedSince: Date) {
  const fullPath = path.join(repoPath, artifactPath);
  if (!existsSync(fullPath)) return null;
  if (statMtime(fullPath) < changedSince) return null;
  try {
    const text = readTextFile(fullPath);
    const heading = text.split(/\r?\n/).find((line) => /^#{1,3}\s+/.test(line))?.replace(/^#{1,3}\s+/, "").trim();
    return `${artifactPath} 已生成${heading ? `：${heading}` : ""}`;
  } catch {
    return `${artifactPath} 已生成`;
  }
}

function hasCoreArtifact(repoPath: string, changedSince?: Date) {
  return hasRecoverableArtifact(repoPath, changedSince ?? new Date(0), null);
}

function statMtime(filePath: string) {
  try {
    return statSync(filePath).mtime;
  } catch {
    return new Date(0);
  }
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
    return readTextFile(eventsPath)
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
    workflowType: row.workflow_type,
    executorId: row.executor_id,
    status: row.status,
    currentNodeId: row.current_node_id,
    roundIndex: row.round_index,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    errorMessage: row.error_message,
    parentRunId: row.parent_run_id,
    continuationIndex: row.continuation_index ?? 0,
    continuationReason: row.continuation_reason,
    launchConfig: parseJson<WorkflowLaunchConfig | null>(row.launch_config_json, null),
    extraPrompt: row.extra_prompt,
    promptOverride: row.prompt_override
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
