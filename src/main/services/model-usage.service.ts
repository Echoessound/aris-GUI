import { getDb, id, nowIso } from "../db/database";
import type { ModelUsageEvent, ModelUsageFilters, ModelUsageSummary } from "../../shared/types";

interface UsageContext {
  projectId: string;
  runId?: string | null;
  chatMessageId?: string | null;
  source: "run" | "chat";
  model?: string | null;
  reasoningEffort?: string | null;
}

interface ParsedUsage {
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  raw: unknown;
}

export function recordUsageFromText(context: UsageContext, text: string) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const usage = extractUsage(parsed);
      if (!usage) continue;
      recordModelUsage({
        ...context,
        model: usage.model ?? context.model ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        rawJson: JSON.stringify(redactUsageJson(usage.raw))
      });
    } catch {
      // Non-JSON log lines stay in stdout/stderr; usage collection is best-effort.
    }
  }
}

export function listModelUsage(projectId: string, filters: ModelUsageFilters = {}): ModelUsageEvent[] {
  const clauses = ["project_id = ?"];
  const params: unknown[] = [projectId];
  if (filters.runId) {
    clauses.push("run_id = ?");
    params.push(filters.runId);
  }
  if (filters.source) {
    clauses.push("source = ?");
    params.push(filters.source);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM model_usage_events WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as any[];
  return rows.map(mapUsageEvent);
}

export function summarizeModelUsage(projectId: string, filters: ModelUsageFilters = {}): ModelUsageSummary {
  const events = listModelUsage(projectId, filters);
  const byModel = new Map<string, ModelUsageSummary["byModel"][number]>();
  const byRun = new Map<string, ModelUsageSummary["byRun"][number]>();
  const byDay = new Map<string, ModelUsageSummary["byDay"][number]>();
  const totals = events.reduce(
    (acc, event) => {
      acc.totalInputTokens += event.inputTokens;
      acc.totalOutputTokens += event.outputTokens;
      acc.totalCachedInputTokens += event.cachedInputTokens;
      acc.totalTokens += event.totalTokens;
      addModelGroup(byModel, event.model ?? "unknown", event);
      addRunGroup(byRun, event.runId ?? event.chatMessageId ?? "chat", event);
      addDayGroup(byDay, event.createdAt.slice(0, 10), event);
      return acc;
    },
    { totalInputTokens: 0, totalOutputTokens: 0, totalCachedInputTokens: 0, totalTokens: 0 }
  );
  return {
    ...totals,
    eventCount: events.length,
    byModel: Array.from(byModel.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    byRun: Array.from(byRun.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  };
}

function recordModelUsage(input: Omit<ModelUsageEvent, "id" | "createdAt">) {
  const totalTokens = input.totalTokens || input.inputTokens + input.outputTokens;
  getDb()
    .prepare(
      `INSERT INTO model_usage_events (
        id, project_id, run_id, chat_message_id, source, model, reasoning_effort,
        input_tokens, output_tokens, cached_input_tokens, total_tokens, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id("usage"),
      input.projectId,
      input.runId ?? null,
      input.chatMessageId ?? null,
      input.source,
      input.model ?? null,
      input.reasoningEffort ?? null,
      input.inputTokens,
      input.outputTokens,
      input.cachedInputTokens,
      totalTokens,
      input.rawJson,
      nowIso()
    );
}

function extractUsage(value: unknown): ParsedUsage | null {
  const candidates = findObjects(value).filter((item) => hasUsageShape(item));
  if (candidates.length === 0) return null;
  const candidate = candidates[candidates.length - 1];
  const usage = isRecord(candidate.usage) ? candidate.usage : candidate;
  const inputTokens = numericField(usage, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  const outputTokens = numericField(usage, ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]);
  const cachedInputTokens =
    numericField(usage, ["cached_input_tokens", "cachedInputTokens", "cached_tokens", "cachedTokens"]) ||
    numericField(usage.input_token_details, ["cached_tokens", "cachedTokens"]) ||
    numericField(usage.prompt_tokens_details, ["cached_tokens", "cachedTokens"]);
  const totalTokens = numericField(usage, ["total_tokens", "totalTokens"]) || inputTokens + outputTokens;
  if (inputTokens + outputTokens + cachedInputTokens + totalTokens <= 0) return null;
  return {
    model: stringField(candidate, ["model", "model_id", "modelId"]) ?? stringField(value, ["model", "model_id", "modelId"]),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    raw: candidate
  };
}

function hasUsageShape(item: Record<string, unknown>) {
  if (isRecord(item.usage)) return hasUsageShape(item.usage);
  return ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens", "output_tokens", "outputTokens", "completion_tokens", "completionTokens", "total_tokens", "totalTokens"].some(
    (key) => typeof item[key] === "number"
  );
}

function findObjects(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) return [];
  const found: Array<Record<string, unknown>> = [value];
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) found.push(...findObjects(item));
    } else {
      found.push(...findObjects(child));
    }
  }
  return found;
}

function numericField(value: unknown, names: string[]) {
  if (!isRecord(value)) return 0;
  for (const name of names) {
    const item = value[name];
    if (typeof item === "number" && Number.isFinite(item)) return Math.max(0, Math.trunc(item));
  }
  return 0;
}

function stringField(value: unknown, names: string[]) {
  if (!isRecord(value)) return null;
  for (const name of names) {
    const item = value[name];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function redactUsageJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUsageJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/(api[_-]?key|token|secret|password)/i.test(key)) return [key, "***"];
      return [key, redactUsageJson(item)];
    })
  );
}

function addModelGroup(group: Map<string, ModelUsageSummary["byModel"][number]>, model: string, event: ModelUsageEvent) {
  const current = group.get(model) ?? { model, totalTokens: 0, inputTokens: 0, outputTokens: 0, eventCount: 0 };
  current.totalTokens += event.totalTokens;
  current.inputTokens += event.inputTokens;
  current.outputTokens += event.outputTokens;
  current.eventCount += 1;
  group.set(model, current);
}

function addRunGroup(group: Map<string, ModelUsageSummary["byRun"][number]>, runId: string, event: ModelUsageEvent) {
  const current = group.get(runId) ?? { runId, totalTokens: 0, inputTokens: 0, outputTokens: 0, eventCount: 0 };
  current.totalTokens += event.totalTokens;
  current.inputTokens += event.inputTokens;
  current.outputTokens += event.outputTokens;
  current.eventCount += 1;
  group.set(runId, current);
}

function addDayGroup(group: Map<string, ModelUsageSummary["byDay"][number]>, day: string, event: ModelUsageEvent) {
  const current = group.get(day) ?? { day, totalTokens: 0, inputTokens: 0, outputTokens: 0, eventCount: 0 };
  current.totalTokens += event.totalTokens;
  current.inputTokens += event.inputTokens;
  current.outputTokens += event.outputTokens;
  current.eventCount += 1;
  group.set(day, current);
}

function mapUsageEvent(row: any): ModelUsageEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    chatMessageId: row.chat_message_id,
    source: row.source,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    totalTokens: row.total_tokens,
    rawJson: row.raw_json,
    createdAt: row.created_at
  };
}
