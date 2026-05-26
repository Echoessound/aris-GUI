import { getDb, id, nowIso } from "../db/database";
import type { CreateProjectInput, Project, UpdateProjectInput } from "../../shared/types";
import { getRepositoryById } from "./repository.service";

export function listProjects(): Project[] {
  ensureProjectDefaults();
  const rows = getDb().prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC").all() as any[];
  return rows.map(mapProjectWithRepo);
}

export function getProject(projectId: string): Project {
  ensureProjectDefaults();
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!row) throw new Error("项目不存在");
  return mapProjectWithRepo(row);
}

export function createProject(input: CreateProjectInput): Project {
  const projectId = id("project");
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO projects (
        id, name, topic, description, target_venue, default_executor_id, default_workflow_id, status, run_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'executor-codex', 'workflow-research-pipeline', 'draft', 0, ?, ?)`
    )
    .run(projectId, input.name, input.topic, input.description ?? null, input.targetVenue ?? null, stamp, stamp);
  return getProject(projectId);
}

export function updateProject(projectId: string, input: UpdateProjectInput): Project {
  const existing = getProject(projectId);
  const nextName = input.name ?? existing.name;
  const nextTopic = input.topic ?? existing.topic;
  const nextDescription = input.description ?? existing.description ?? null;
  const nextTargetVenue = input.targetVenue ?? existing.targetVenue ?? null;
  const nextDefaultExecutorId = input.defaultExecutorId ?? existing.defaultExecutorId ?? "executor-codex";
  const nextDefaultWorkflowId = input.defaultWorkflowId ?? existing.defaultWorkflowId ?? "workflow-research-pipeline";
  const isConfigured = Boolean(nextName?.trim() && nextTopic?.trim() && nextDefaultExecutorId && nextDefaultWorkflowId && existing.repositoryId);
  const nextStatus = input.status ?? deriveProjectStatus(existing.status, isConfigured);
  getDb()
    .prepare(
      `UPDATE projects SET name = ?, topic = ?, description = ?, target_venue = ?,
      default_executor_id = ?, default_workflow_id = ?, status = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      nextName,
      nextTopic,
      nextDescription,
      nextTargetVenue,
      nextDefaultExecutorId,
      nextDefaultWorkflowId,
      nextStatus,
      nowIso(),
      projectId
    );
  return getProject(projectId);
}

export function archiveProject(projectId: string) {
  getDb().prepare("UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?").run(nowIso(), projectId);
}

function mapProjectWithRepo(row: any): Project {
  const repo = row.repository_id ? getRepositoryById(row.repository_id) : null;
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    description: row.description,
    targetVenue: row.target_venue,
    repositoryId: row.repository_id,
    defaultExecutorId: row.default_executor_id,
    defaultWorkflowId: row.default_workflow_id,
    status: row.status,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repository: repo
  };
}

function deriveProjectStatus(currentStatus: Project["status"], isConfigured: boolean): Project["status"] {
  if (["archived", "running", "waiting_approval"].includes(currentStatus)) return currentStatus;
  if (!isConfigured) return "draft";
  return "ready";
}

function ensureProjectDefaults() {
  const db = getDb();
  db
    .prepare(
      `UPDATE projects
       SET default_executor_id = COALESCE(default_executor_id, 'executor-codex'),
           default_workflow_id = COALESCE(default_workflow_id, 'workflow-research-pipeline')
       WHERE status != 'archived'`
    )
    .run();
  db.prepare(
    `UPDATE projects
     SET status = 'draft'
     WHERE status = 'ready'
       AND repository_id IS NULL`
  ).run();
  db.prepare(
    `UPDATE projects
     SET status = 'ready'
     WHERE status = 'draft'
       AND repository_id IS NOT NULL
       AND TRIM(name) != ''
       AND TRIM(topic) != ''
       AND default_executor_id IS NOT NULL
       AND default_workflow_id IS NOT NULL`
  ).run();
}
