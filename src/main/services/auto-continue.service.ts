import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, id, nowIso } from "../db/database";
import type {
  AutoContinueSettings,
  ContinuationChain,
  ContinuationEvent,
  ContinuationItemType,
  SaveAutoContinueSettingsInput
} from "../../shared/types";
import { readTextFile } from "./encoding.service";
import { getProject } from "./project.service";

const DEFAULT_SETTINGS: Omit<AutoContinueSettings, "updatedAt"> = {
  projectId: null,
  enabled: true,
  scope: "all",
  fullyAutomatic: true,
  maxContinuations: 5,
  triggerOnFailure: true,
  triggerOnTimeout: true,
  triggerOnPartialArtifacts: true,
  triggerOnQualityRisk: true,
  inheritExecutorModel: true
};

export function getAutoContinueSettings(projectId?: string | null): AutoContinueSettings {
  if (projectId) {
    const projectRow = readSettingsRow(scopeId(projectId));
    if (projectRow) return mapSettings(projectRow);
  }
  const globalRow = readSettingsRow(scopeId(null));
  if (globalRow) return mapSettings(globalRow);
  return saveAutoContinueSettings(null, {});
}

export function saveAutoContinueSettings(projectId: string | null | undefined, input: SaveAutoContinueSettingsInput): AutoContinueSettings {
  if (projectId) getProject(projectId);
  const previous = projectId ? getAutoContinueSettings(null) : { ...DEFAULT_SETTINGS, updatedAt: nowIso() };
  const next: AutoContinueSettings = {
    ...previous,
    projectId: projectId ?? null,
    enabled: input.enabled ?? previous.enabled,
    scope: input.scope ?? previous.scope,
    fullyAutomatic: input.fullyAutomatic ?? previous.fullyAutomatic,
    maxContinuations: clampMax(input.maxContinuations ?? previous.maxContinuations),
    triggerOnFailure: input.triggerOnFailure ?? previous.triggerOnFailure,
    triggerOnTimeout: input.triggerOnTimeout ?? previous.triggerOnTimeout,
    triggerOnPartialArtifacts: input.triggerOnPartialArtifacts ?? previous.triggerOnPartialArtifacts,
    triggerOnQualityRisk: input.triggerOnQualityRisk ?? previous.triggerOnQualityRisk,
    inheritExecutorModel: input.inheritExecutorModel ?? previous.inheritExecutorModel,
    updatedAt: nowIso()
  };
  getDb()
    .prepare(
      `INSERT INTO auto_continue_settings (
        scope_id, project_id, enabled, scope, fully_automatic, max_continuations,
        trigger_on_failure, trigger_on_timeout, trigger_on_partial_artifacts,
        trigger_on_quality_risk, inherit_executor_model, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id) DO UPDATE SET
        project_id = excluded.project_id,
        enabled = excluded.enabled,
        scope = excluded.scope,
        fully_automatic = excluded.fully_automatic,
        max_continuations = excluded.max_continuations,
        trigger_on_failure = excluded.trigger_on_failure,
        trigger_on_timeout = excluded.trigger_on_timeout,
        trigger_on_partial_artifacts = excluded.trigger_on_partial_artifacts,
        trigger_on_quality_risk = excluded.trigger_on_quality_risk,
        inherit_executor_model = excluded.inherit_executor_model,
        updated_at = excluded.updated_at`
    )
    .run(
      scopeId(projectId ?? null),
      projectId ?? null,
      next.enabled ? 1 : 0,
      next.scope,
      next.fullyAutomatic ? 1 : 0,
      next.maxContinuations,
      next.triggerOnFailure ? 1 : 0,
      next.triggerOnTimeout ? 1 : 0,
      next.triggerOnPartialArtifacts ? 1 : 0,
      next.triggerOnQualityRisk ? 1 : 0,
      next.inheritExecutorModel ? 1 : 0,
      next.updatedAt
    );
  return next;
}

export function listContinuationChain(projectId: string, rootId: string): ContinuationChain | null {
  const row = getDb()
    .prepare("SELECT * FROM continuation_chains WHERE project_id = ? AND root_id = ?")
    .get(projectId, rootId) as any;
  if (row) return mapChain(row);
  const event = getDb()
    .prepare(
      `SELECT continuation_chains.* FROM continuation_events
       INNER JOIN continuation_chains ON continuation_chains.id = continuation_events.chain_id
       WHERE continuation_events.project_id = ?
         AND (continuation_events.item_id = ? OR continuation_events.parent_item_id = ?)
       ORDER BY continuation_events.created_at DESC LIMIT 1`
    )
    .get(projectId, rootId, rootId) as any;
  return event ? mapChain(event) : null;
}

export function stopContinuationChain(chainId: string) {
  const row = getDb().prepare("SELECT * FROM continuation_chains WHERE id = ?").get(chainId) as any;
  getDb()
    .prepare("UPDATE continuation_chains SET stopped = 1, stop_reason = COALESCE(stop_reason, '用户停止续接'), updated_at = ? WHERE id = ?")
    .run(nowIso(), chainId);
  if (row) {
    recordContinuationEvent({
      chainId,
      projectId: row.project_id,
      itemType: row.root_type,
      itemId: row.root_id,
      parentItemId: null,
      continuationIndex: 0,
      reason: "manual_stop",
      status: "stopped",
      summary: "User stopped this continuation chain."
    });
  }
}

export function canStartContinuation(projectId: string, itemType: ContinuationItemType, parentItemId: string, nextIndex: number, reason: string) {
  const settings = getAutoContinueSettings(projectId);
  if (!settings.enabled || !settings.fullyAutomatic) return { ok: false, settings, reason: "自动续接未启用" };
  if (!scopeAllows(settings.scope, itemType)) return { ok: false, settings, reason: "当前范围未启用续接" };
  if (nextIndex > settings.maxContinuations) return { ok: false, settings, reason: `已达到最多 ${settings.maxContinuations} 次续接` };
  const chain = findOrCreateChain(projectId, itemType, parentItemId);
  if (chain.stopped) return { ok: false, settings, reason: chain.stopReason ?? "续接链已停止" };
  if (!triggerAllows(settings, reason)) return { ok: false, settings, reason: "当前原因未启用自动续接" };
  return { ok: true, settings, chain, reason: "" };
}

export function findOrCreateChain(projectId: string, itemType: ContinuationItemType, itemId: string): ContinuationChain {
  const existing = findChainForItem(projectId, itemType, itemId);
  if (existing) return existing;
  const chainId = id("continue-chain");
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO continuation_chains (id, project_id, root_type, root_id, stopped, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(chainId, projectId, itemType, itemId, stamp, stamp);
  recordContinuationEvent({
    chainId,
    projectId,
    itemType,
    itemId,
    parentItemId: null,
    continuationIndex: 0,
    reason: "root",
    status: "completed",
    summary: "续接链根节点"
  });
  return mapChain(getDb().prepare("SELECT * FROM continuation_chains WHERE id = ?").get(chainId) as any);
}

export function recordContinuationEvent(input: Omit<ContinuationEvent, "id" | "createdAt">) {
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO continuation_events (
        id, chain_id, project_id, item_type, item_id, parent_item_id,
        continuation_index, reason, status, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id("continue-event"),
      input.chainId,
      input.projectId,
      input.itemType,
      input.itemId,
      input.parentItemId ?? null,
      input.continuationIndex,
      input.reason,
      input.status,
      input.summary ?? null,
      stamp
    );
  getDb().prepare("UPDATE continuation_chains SET updated_at = ? WHERE id = ?").run(stamp, input.chainId);
}

export function markContinuationStopped(chainId: string, reason: string) {
  getDb().prepare("UPDATE continuation_chains SET stopped = 1, stop_reason = ?, updated_at = ? WHERE id = ?").run(reason, nowIso(), chainId);
}

export function buildRunContinuationPrompt(runId: string, reason: string) {
  const row = getDb()
    .prepare(
      `SELECT runs.*, projects.topic, repositories.path AS repo_path
       FROM runs
       INNER JOIN projects ON projects.id = runs.project_id
       LEFT JOIN repositories ON repositories.id = projects.repository_id
       WHERE runs.id = ?`
    )
    .get(runId) as any;
  if (!row) throw new Error("运行记录不存在");
  const runDir = row.repo_path ? path.join(row.repo_path, ".aris-app", "runs", runId) : "";
  const events = runDir ? readMaybe(path.join(runDir, "events.jsonl"), 8000) : "";
  const progress = runDir ? readMaybe(path.join(runDir, "progress.zh.jsonl"), 8000) : "";
  const artifactIndex = runDir ? readMaybe(path.join(runDir, "artifacts", "ARTIFACT_INDEX.zh.md"), 12000) : "";
  const artifactSummaries = row.repo_path ? summarizeCoreArtifacts(row.repo_path) : [];
  const completedStages = summarizeCompletedStages(progress);
  const blockedStages = summarizeBlockedStages(progress);
  return [
    "这是 ARIS Paper Studio 续接生成的新 Codex 会话。不要使用 codex exec resume；必须基于上一轮真实产物继续推进。",
    "",
    `续接原因：${reason}`,
    `上一段 Run ID：${runId}`,
    `上一段状态：${row.status}`,
    `上一段错误：${row.error_message ?? "无"}`,
    `研究主题：${row.topic ?? ""}`,
    "",
    "## 上一轮已完成内容",
    completedStages.length ? completedStages.join("\n") : "未能从 progress.zh.jsonl 中稳定识别已完成阶段，请结合产物索引和事件日志判断。",
    "",
    "## 上一轮未完成/受阻阶段",
    blockedStages.length ? blockedStages.join("\n") : (row.status === "completed" ? "上一轮记录为 completed，暂无明确受阻阶段。" : "上一轮未完成，请优先定位失败、timeout、质量风险或产物不足原因。"),
    "",
    "## 已有产物清单与摘要",
    artifactIndex || "未读取到 ARTIFACT_INDEX.zh.md。",
    artifactSummaries.length ? ["", "### 核心产物摘要", ...artifactSummaries].join("\n") : "",
    "",
    "## progress.zh.jsonl 摘要",
    progress || "未读取到 progress.zh.jsonl。",
    "",
    "## events.jsonl 摘要",
    events || "未读取到 events.jsonl。",
    "",
    "## 本轮必须继续的阶段",
    inferNextStage(row.workflow_type, completedStages, blockedStages),
    "",
    "## 续接硬性要求",
    "1. 禁止重复生成已有产物，除非用户本轮明确要求修改或重跑。",
    "2. 已存在 review-stage/MULTI_AGENT_REVIEW.md 时，不要重复多 Agent 评审；除非配置允许 rerunExistingReview 或用户明确要求。",
    "3. 优先补齐上一轮未完成、失败、timeout、质量风险或有效产物不足的阶段。",
    "4. 把新进展写入本轮 run 的 progress.zh.jsonl，而不是改写上一轮 run 目录。",
    "5. 如果仍然受阻，写出清晰的中文 Markdown 阻塞报告，并列出下一轮可执行动作。"
  ].join("\n");
}

export function buildChatContinuationMessage(messageId: string, reason: string) {
  const message = getDb().prepare("SELECT * FROM codex_chat_messages WHERE id = ?").get(messageId) as any;
  if (!message) throw new Error("对话消息不存在");
  const rows = getDb()
    .prepare(
      `SELECT * FROM codex_chat_messages
       WHERE project_id = ? AND COALESCE(conversation_id, id) = ?
       ORDER BY created_at ASC`
    )
    .all(message.project_id, message.conversation_id ?? message.id) as any[];
  const originalUser = rows.find((row) => row.role === "user")?.content ?? "";
  const recent = rows.slice(-8).map((row) => {
    const role = row.role === "user" ? "用户" : "Codex";
    return `### ${role} / ${row.intent ?? "project_qa"} / ${row.status ?? "completed"}\n${String(row.content ?? "").slice(0, 4000)}`;
  });
  const handoffHeader = [
    "Fresh Codex session handoff. Do not use codex resume.",
    "The original user request remains the primary request; answer it directly instead of acknowledging setup.",
    "",
    "## Original User Request",
    originalUser || "No original user request was found.",
    ""
  ];
  return [
    ...handoffHeader,
    "这是 ARIS Paper Studio 自动续接的新 Codex 对话。请不要 resume 旧会话，而是基于下面交接摘要继续回答。",
    "",
    `续接原因：${reason}`,
    `上一条消息 ID：${messageId}`,
    `关联 Run ID：${message.run_id ?? "无"}`,
    "",
    "## 最近对话摘要",
    recent.join("\n\n") || "没有可用的历史消息。",
    "",
    "## 续接要求",
    "1. 先简短说明你接上了哪一段上下文。",
    "2. 继续完成用户原始目标，不要要求用户重新粘贴上下文。",
    "3. 如果上一段失败，优先解释失败点并给出下一步可执行结果。",
    "4. 如果需要修改文件，仍然只输出可确认后应用的 unified diff。"
  ].join("\n");
}

export function continuationReasonFromRun(status: string, exitCode: number | null | undefined, errorMessage?: string | null) {
  const text = `${errorMessage ?? ""}`.toLowerCase();
  if (text.includes("timeout") || text.includes("idle") || text.includes("no output")) return "timeout";
  if (status === "failed" || (exitCode ?? 0) !== 0) return "failure";
  if (text.includes("quality") || text.includes("质量")) return "quality";
  return "";
}

export function continuationReasonFromChat(ok: boolean, stderr: string) {
  const text = stderr.toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("context") || text.includes("token") || text.includes("too large")) return "failure";
  if (!ok) return "failure";
  return "";
}

function triggerAllows(settings: AutoContinueSettings, reason: string) {
  if (reason === "timeout") return settings.triggerOnTimeout;
  if (reason === "partial") return settings.triggerOnPartialArtifacts;
  if (reason === "quality") return settings.triggerOnQualityRisk;
  return settings.triggerOnFailure;
}

function summarizeCompletedStages(progressText: string) {
  return parseProgressLines(progressText)
    .filter((item) => item.status === "completed")
    .slice(-8)
    .map((item) => `- ${item.title || item.stageKey}: ${(item.bullets ?? []).slice(0, 3).join("；") || "已完成"}`);
}

function summarizeBlockedStages(progressText: string) {
  return parseProgressLines(progressText)
    .filter((item) => item.status === "blocked" || item.status === "failed")
    .slice(-8)
    .map((item) => `- ${item.title || item.stageKey}: ${(item.blockers ?? item.bullets ?? []).slice(0, 3).join("；") || item.status}`);
}

type ProgressLineSummary = { stageKey: string; title?: string; status?: string; bullets?: string[]; blockers?: string[] };

function parseProgressLines(progressText: string): ProgressLineSummary[] {
  return progressText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ProgressLineSummary | null => {
      try {
        const parsed = JSON.parse(line);
        return {
          stageKey: String(parsed.stageKey ?? ""),
          title: parsed.title ? String(parsed.title) : undefined,
          status: parsed.status ? String(parsed.status) : undefined,
          bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : undefined,
          blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String) : undefined
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is ProgressLineSummary => Boolean(item?.stageKey));
}

function summarizeCoreArtifacts(repoPath: string) {
  const artifactPaths = [
    "idea-stage/IDEA_REPORT.md",
    "NARRATIVE_REPORT.md",
    "AUTO_REVIEW.md",
    "review-stage/AUTO_REVIEW.md",
    "MULTI_AGENT_REVIEW.md",
    "review-stage/MULTI_AGENT_REVIEW.md",
    "paper/paper.tex"
  ];
  return artifactPaths
    .map((relativePath) => summarizeArtifact(repoPath, relativePath))
    .filter((line): line is string => Boolean(line));
}

function summarizeArtifact(repoPath: string, relativePath: string) {
  const fullPath = path.join(repoPath, relativePath);
  if (!existsSync(fullPath)) return null;
  const text = readMaybe(fullPath, 1800);
  const heading = text.split(/\r?\n/).find((line) => /^#{1,3}\s+/.test(line))?.replace(/^#{1,3}\s+/, "").trim();
  const excerpt = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, 3)
    .join(" ");
  return `- ${relativePath}: ${heading ? `${heading}。` : ""}${excerpt.slice(0, 500)}`;
}

function inferNextStage(workflowType: string | null | undefined, completedStages: string[], blockedStages: string[]) {
  if (blockedStages.length) return "优先处理上一轮受阻或失败的阶段，并只补齐缺失产物。";
  const completedText = completedStages.join("\n");
  const orderedStages = workflowType === "paper-writing"
    ? ["paper-plan", "paper-write", "paper-compile", "multi-agent-paper-review"]
    : ["idea-discovery", "auto-review-loop", "experiment-bridge", "paper-plan", "paper-write", "paper-compile", "multi-agent-paper-review"];
  const next = orderedStages.find((stage) => !completedText.includes(stage));
  return next ? `继续推进 ${next}，复用已有产物作为输入。` : "上一轮核心阶段看起来已完成，本轮应做查漏补缺、质量审计或用户指定修改。";
}

function scopeAllows(scope: AutoContinueSettings["scope"], itemType: ContinuationItemType) {
  if (scope === "all") return true;
  if (scope === "chat") return itemType === "chat";
  return itemType === "run";
}

function findChainForItem(projectId: string, itemType: ContinuationItemType, itemId: string): ContinuationChain | null {
  const root = getDb()
    .prepare("SELECT * FROM continuation_chains WHERE project_id = ? AND root_type = ? AND root_id = ?")
    .get(projectId, itemType, itemId) as any;
  if (root) return mapChain(root);
  const event = getDb()
    .prepare(
      `SELECT continuation_chains.* FROM continuation_events
       INNER JOIN continuation_chains ON continuation_chains.id = continuation_events.chain_id
       WHERE continuation_events.project_id = ? AND continuation_events.item_type = ? AND continuation_events.item_id = ?
       ORDER BY continuation_events.created_at DESC LIMIT 1`
    )
    .get(projectId, itemType, itemId) as any;
  return event ? mapChain(event) : null;
}

function mapChain(row: any): ContinuationChain {
  const events = getDb()
    .prepare("SELECT * FROM continuation_events WHERE chain_id = ? ORDER BY continuation_index ASC, created_at ASC")
    .all(row.id) as any[];
  return {
    id: row.id,
    projectId: row.project_id,
    rootType: row.root_type,
    rootId: row.root_id,
    stopped: Boolean(row.stopped),
    stopReason: row.stop_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.map(mapEvent)
  };
}

function mapEvent(row: any): ContinuationEvent {
  return {
    id: row.id,
    chainId: row.chain_id,
    projectId: row.project_id,
    itemType: row.item_type,
    itemId: row.item_id,
    parentItemId: row.parent_item_id,
    continuationIndex: row.continuation_index,
    reason: row.reason,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at
  };
}

function readSettingsRow(idValue: string) {
  return getDb().prepare("SELECT * FROM auto_continue_settings WHERE scope_id = ?").get(idValue) as any;
}

function mapSettings(row: any): AutoContinueSettings {
  return {
    projectId: row.project_id,
    enabled: Boolean(row.enabled),
    scope: row.scope,
    fullyAutomatic: Boolean(row.fully_automatic),
    maxContinuations: row.max_continuations,
    triggerOnFailure: Boolean(row.trigger_on_failure),
    triggerOnTimeout: Boolean(row.trigger_on_timeout),
    triggerOnPartialArtifacts: Boolean(row.trigger_on_partial_artifacts),
    triggerOnQualityRisk: Boolean(row.trigger_on_quality_risk),
    inheritExecutorModel: Boolean(row.inherit_executor_model),
    updatedAt: row.updated_at
  };
}

function scopeId(projectId: string | null | undefined) {
  return projectId ? `project:${projectId}` : "global";
}

function clampMax(value: number) {
  return Math.max(1, Math.min(10, Math.trunc(value || DEFAULT_SETTINGS.maxContinuations)));
}

function readMaybe(filePath: string, maxChars: number) {
  if (!existsSync(filePath)) return "";
  try {
    const text = readTextFile(filePath).trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.floor(maxChars / 2))}\n\n...[中间内容已截断]...\n\n${text.slice(-Math.floor(maxChars / 2))}`;
  } catch {
    return "";
  }
}
