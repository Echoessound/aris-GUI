import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, id, nowIso } from "../db/database";
import type { Artifact, ArtifactType } from "../../shared/types";
import { getProject } from "./project.service";

const scanDirs = [".", "idea-stage", "review-stage", "paper", "figures", "outputs", "results", "refine-logs", "review-logs", ".aris"];
const ignoredDirs = new Set([".git", "node_modules", ".venv", "__pycache__", "runs"]);

export function listArtifacts(projectId: string): Artifact[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM artifacts WHERE project_id = ?
       ORDER BY
        CASE
          WHEN name IN ('IDEA_REPORT.md', 'NARRATIVE_REPORT.md', 'FINAL_REPORT.md', 'AUTO_REVIEW.md') THEN 0
          WHEN type = 'pdf' THEN 1
          WHEN type = 'markdown' THEN 2
          ELSE 3
        END,
        updated_at DESC`
    )
    .all(projectId) as any[];
  return rows.map(mapArtifact);
}

export function readArtifactText(artifactId: string): string {
  const artifact = getArtifact(artifactId);
  if (!artifact.previewable) throw new Error("该产物不可预览");
  return readFileSync(artifact.path, "utf8");
}

export function artifactFileUrl(artifactId: string): string {
  return pathToFileURL(getArtifact(artifactId).path).toString();
}

export function rescanArtifacts(projectId: string, runId?: string): Artifact[] {
  const project = getProject(projectId);
  const repoPath = project.repository?.path;
  if (!repoPath || !existsSync(repoPath)) throw new Error("项目尚未绑定有效仓库");
  const files = new Map<string, { type: ArtifactType; size: number; updatedAt: string }>();
  for (const dir of scanDirs) {
    const root = path.join(repoPath, dir);
    if (existsSync(root)) walk(root, repoPath, files);
  }
  const db = getDb();
  const stamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(projectId);
    const insert = db.prepare(`
      INSERT INTO artifacts (id, project_id, run_id, type, name, path, previewable, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [filePath, meta] of files) {
      insert.run(id("artifact"), projectId, runId ?? null, meta.type, path.basename(filePath), filePath, isPreviewable(meta.type) ? 1 : 0, meta.size, stamp, meta.updatedAt);
    }
  });
  tx();
  return listArtifacts(projectId);
}

function walk(root: string, repoPath: string, files: Map<string, { type: ArtifactType; size: number; updatedAt: string }>) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = path.relative(repoPath, full);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(full, repoPath, files);
      continue;
    }
    const type = detectArtifactType(full);
    if (type === "other") continue;
    const stat = statSync(full);
    files.set(full, { type, size: stat.size, updatedAt: stat.mtime.toISOString() });
    void rel;
  }
}

function detectArtifactType(filePath: string): ArtifactType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".pdf") return "pdf";
  if (ext === ".json") return "json";
  if (ext === ".jsonl") return "jsonl";
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".tex") return "latex";
  if (ext === ".log") return "log";
  if (ext === ".txt") return "text";
  return "other";
}

function isPreviewable(type: ArtifactType) {
  return type !== "other";
}

function getArtifact(artifactId: string): Artifact {
  const row = getDb().prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId) as any;
  if (!row) throw new Error("产物不存在");
  return mapArtifact(row);
}

function mapArtifact(row: any): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    type: row.type,
    name: row.name,
    path: row.path,
    previewable: Boolean(row.previewable),
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
