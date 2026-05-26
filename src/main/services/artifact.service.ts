import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type { Artifact, ArtifactType } from "../../shared/types";
import { decodeTextBuffer, readTextFile } from "./encoding.service";
import { getProject } from "./project.service";

const scanDirs = [".", "idea-stage", "review-stage", "paper", "figures", "outputs", "results", "refine-logs", "review-logs", ".aris"];
const ignoredDirs = new Set([".git", "node_modules", ".venv", "__pycache__", "runs"]);

export function listArtifacts(projectId: string): Artifact[] {
  syncRunArtifactSnapshots(projectId);
  const rows = getDb()
    .prepare(
      `SELECT artifacts.* FROM artifacts
       LEFT JOIN runs ON runs.id = artifacts.run_id
       WHERE artifacts.project_id = ?
       ORDER BY
        COALESCE(runs.round_index, 0) DESC,
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
  if (artifact.type === "word") return readWordText(artifact.path);
  return readTextFile(artifact.path);
}

export function artifactFileUrl(artifactId: string): string {
  return pathToFileURL(getArtifact(artifactId).path).toString();
}

export function rescanArtifacts(projectId: string, runId?: string): Artifact[] {
  const project = getProject(projectId);
  const repoPath = project.repository?.path;
  if (!repoPath || !existsSync(repoPath)) throw new Error("项目尚未绑定有效仓库");
  const runStartedAt = runId ? getRunStartedAt(runId) : null;
  const files = new Map<string, { type: ArtifactType; size: number; updatedAt: string }>();
  for (const dir of scanDirs) {
    const root = path.join(repoPath, dir);
    if (existsSync(root)) walk(root, repoPath, files, runStartedAt);
  }
  const db = getDb();
  const stamp = nowIso();
  const tx = db.transaction(() => {
    if (runId) {
      db.prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id = ?").run(projectId, runId);
    } else {
      db.prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id IS NULL").run(projectId);
    }
    const insert = db.prepare(`
      INSERT INTO artifacts (id, project_id, run_id, type, name, path, previewable, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [filePath, meta] of files) {
      const storedPath = runId ? snapshotArtifact(repoPath, runId, filePath) : filePath;
      insert.run(id("artifact"), projectId, runId ?? null, meta.type, path.relative(repoPath, filePath), storedPath, isPreviewable(meta.type) ? 1 : 0, meta.size, stamp, meta.updatedAt);
    }
  });
  tx();
  if (!runId) syncRunArtifactSnapshots(projectId);
  return listArtifacts(projectId);
}

function walk(root: string, repoPath: string, files: Map<string, { type: ArtifactType; size: number; updatedAt: string }>, changedSince: Date | null) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = path.relative(repoPath, full);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(full, repoPath, files, changedSince);
      continue;
    }
    const type = detectArtifactType(full);
    if (type === "other") continue;
    const stat = statSync(full);
    if (changedSince && stat.mtime < changedSince) continue;
    files.set(full, { type, size: stat.size, updatedAt: stat.mtime.toISOString() });
    void rel;
  }
}

function getRunStartedAt(runId: string) {
  const row = getDb().prepare("SELECT started_at FROM runs WHERE id = ?").get(runId) as { started_at?: string } | undefined;
  if (!row?.started_at) return null;
  const startedAt = new Date(row.started_at);
  startedAt.setSeconds(startedAt.getSeconds() - 2);
  return startedAt;
}

function snapshotArtifact(repoPath: string, runId: string, filePath: string) {
  const rel = path.relative(repoPath, filePath);
  const snapshotPath = path.join(repoPath, ".aris-app", "runs", runId, "artifacts", rel);
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  copyFileSync(filePath, snapshotPath);
  return snapshotPath;
}

function syncRunArtifactSnapshots(projectId: string) {
  const project = getProject(projectId);
  const repoPath = project.repository?.path;
  if (!repoPath || !existsSync(repoPath)) return;
  const rows = getDb().prepare("SELECT id FROM runs WHERE project_id = ? ORDER BY round_index ASC").all(projectId) as Array<{ id: string }>;
  const insert = getDb().prepare(`
    INSERT INTO artifacts (id, project_id, run_id, type, name, path, previewable, size_bytes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = getDb().transaction(() => {
    for (const run of rows) {
      const root = path.join(repoPath, ".aris-app", "runs", run.id, "artifacts");
      getDb().prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id = ?").run(projectId, run.id);
      const files = new Map<string, { type: ArtifactType; size: number; updatedAt: string }>();
      if (existsSync(root)) {
        walk(root, root, files, null);
      } else {
        readArtifactJsonSnapshot(repoPath, run.id, files);
      }
      const stamp = nowIso();
      for (const [filePath, meta] of files) {
        insert.run(
          id("artifact"),
          projectId,
          run.id,
          meta.type,
          path.relative(root, filePath),
          filePath,
          isPreviewable(meta.type) ? 1 : 0,
          meta.size,
          stamp,
          meta.updatedAt
        );
      }
    }
  });
  tx();
}

function readArtifactJsonSnapshot(repoPath: string, runId: string, files: Map<string, { type: ArtifactType; size: number; updatedAt: string }>) {
  const manifestPath = path.join(repoPath, ".aris-app", "runs", runId, "artifacts.json");
  if (!existsSync(manifestPath)) return;
  const entries = parseJson<Array<{ path?: string }>>(readTextFile(manifestPath), []);
  for (const entry of entries) {
    if (!entry.path || !existsSync(entry.path)) continue;
    const type = detectArtifactType(entry.path);
    if (type === "other") continue;
    const stat = statSync(entry.path);
    files.set(entry.path, { type, size: stat.size, updatedAt: stat.mtime.toISOString() });
  }
}

function detectArtifactType(filePath: string): ArtifactType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".pdf") return "pdf";
  if ([".docx", ".doc"].includes(ext)) return "word";
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

function readWordText(filePath: string) {
  if (path.extname(filePath).toLowerCase() === ".doc") {
    return "这是旧版 .doc Word 文件。当前内置预览支持 .docx 文本预览；请转换为 .docx 后再预览正文，或在系统 Word/WPS 中打开。";
  }
  const xml = readDocxEntry(filePath, "word/document.xml");
  if (!xml) return "未能读取该 .docx 的 word/document.xml 内容。";
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function readDocxEntry(filePath: string, entryName: string) {
  const data = readFileSync(filePath);
  let offset = 0;
  while (offset < data.length - 30) {
    if (data.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = data.readUInt16LE(offset + 8);
    const compressedSize = data.readUInt32LE(offset + 18);
    const uncompressedSize = data.readUInt32LE(offset + 22);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = data.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const contentStart = nameStart + nameLength + extraLength;
    const content = data.subarray(contentStart, contentStart + compressedSize);
    if (name === entryName) {
      if (method === 0) return decodeTextBuffer(content);
      if (method === 8) return decodeTextBuffer(inflateRawSync(content, { finishFlush: 2 }));
      return null;
    }
    offset = contentStart + (compressedSize || uncompressedSize);
  }
  return null;
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
