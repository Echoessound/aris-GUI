import { getDb, nowIso, parseJson } from "../db/database";
import type {
  SaveWorkflowLaunchSettingsInput,
  WorkflowLaunchConfig,
  WorkflowLaunchSettings,
  WorkflowPromptPreview,
  WorkflowPromptPreviewInput
} from "../../shared/types";
import { getProject } from "./project.service";
import { buildWorkflowPromptForPreview } from "./run.service";

export function getWorkflowLaunchSettings(projectId: string): WorkflowLaunchSettings {
  const project = getProject(projectId);
  const row = getDb().prepare("SELECT * FROM workflow_launch_settings WHERE project_id = ?").get(projectId) as any;
  if (!row) {
    return {
      projectId,
      config: defaultWorkflowLaunchConfig(project.topic),
      extraPrompt: "",
      promptOverride: "",
      updatedAt: nowIso()
    };
  }
  return {
    projectId,
    config: {
      ...defaultWorkflowLaunchConfig(project.topic),
      ...parseJson<WorkflowLaunchConfig>(row.config_json, {})
    },
    extraPrompt: row.extra_prompt ?? "",
    promptOverride: row.prompt_override ?? "",
    updatedAt: row.updated_at
  };
}

export function saveWorkflowLaunchSettings(projectId: string, input: SaveWorkflowLaunchSettingsInput): WorkflowLaunchSettings {
  getProject(projectId);
  const stamp = nowIso();
  const config = normalizeConfig(input.config);
  getDb()
    .prepare(
      `INSERT INTO workflow_launch_settings (project_id, config_json, extra_prompt, prompt_override, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         config_json = excluded.config_json,
         extra_prompt = excluded.extra_prompt,
         prompt_override = excluded.prompt_override,
         updated_at = excluded.updated_at`
    )
    .run(projectId, JSON.stringify(config), input.extraPrompt ?? "", input.promptOverride ?? "", stamp);
  return getWorkflowLaunchSettings(projectId);
}

export function previewWorkflowPrompt(input: WorkflowPromptPreviewInput): WorkflowPromptPreview {
  const project = getProject(input.projectId);
  return {
    prompt: buildWorkflowPromptForPreview({
      workflowType: input.launchConfig?.workflowType ?? input.workflowType,
      topic: input.launchConfig?.topic?.trim() || input.topic || project.topic,
      continuationPrompt: input.continuationPrompt ?? undefined,
      launchConfig: input.launchConfig ?? undefined,
      extraPrompt: input.extraPrompt ?? undefined,
      promptOverride: input.promptOverride ?? undefined
    })
  };
}

function defaultWorkflowLaunchConfig(topic: string): WorkflowLaunchConfig {
  return {
    workflowType: "research-pipeline",
    topic,
    model: "gpt-5.4",
    reasoningEffort: "high",
    sandbox: "danger-full-access",
    approval: "never",
    minRuntimeMinutes: 10,
    minMarkdownChars: 12000,
    autoContinueEnabled: true,
    maxContinuations: 5,
    rerunExistingReview: false,
    pdfCompileMode: "codex-skill-first"
  };
}

function normalizeConfig(input: WorkflowLaunchConfig): WorkflowLaunchConfig {
  return {
    ...input,
    workflowType: input.workflowType ?? "research-pipeline",
    reasoningEffort: input.reasoningEffort ?? "high",
    sandbox: input.sandbox ?? "danger-full-access",
    approval: input.approval ?? "never",
    minRuntimeMinutes: clampPositive(input.minRuntimeMinutes, 10),
    minMarkdownChars: clampPositive(input.minMarkdownChars, 12000),
    autoContinueEnabled: input.autoContinueEnabled ?? true,
    maxContinuations: clampPositive(input.maxContinuations, 5),
    rerunExistingReview: input.rerunExistingReview ?? false,
    pdfCompileMode: input.pdfCompileMode ?? "codex-skill-first"
  };
}

function clampPositive(value: number | null | undefined, fallback: number) {
  const next = Math.trunc(Number(value ?? fallback));
  return Number.isFinite(next) && next > 0 ? next : fallback;
}
