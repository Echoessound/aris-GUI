import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type {
  SaveWorkspaceFileSettingsInput,
  WorkspaceExternalPath,
  WorkspaceFileEntry,
  WorkspaceFileSettings,
  WorkspaceImportResult
} from "../../shared/types";
import { getProject } from "./project.service";

const DEFAULT_REPO_DIRS = [
  "idea-stage",
  "implementation-stage",
  "experiment-stage",
  "review-stage",
  "paper",
  "data/raw",
  "data/processed",
  "references",
  "outputs",
  "assets"
];
const DEFAULT_REPO_DIR_DESCRIPTIONS: Record<string, string> = {
  "idea-stage": "选题、idea 报告和问题定义。",
  "implementation-stage": "方法实现、原型代码和工程记录。",
  "experiment-stage": "实验计划、脚本和阶段性结果。",
  "review-stage": "自动评审、多 Agent 评审和修改意见。",
  paper: "论文 LaTeX、草稿、图表引用和编译产物。",
  "data/raw": "原始数据、下载文件和不可直接改写的数据源。",
  "data/processed": "清洗后数据、特征文件和中间数据集。",
  references: "论文、BibTeX、阅读笔记和外部资料。",
  outputs: "报告、导出件、图像、PDF 和最终交付物。",
  assets: "图片、示意图、素材和展示资源。"
};
const IGNORED_SCAN_DIRS = new Set([".git", ".aris-app", "node_modules", ".pnpm-store", ".cache", "dist", "release", ".venv", "venv"]);

export function getWorkspaceFileSettings(projectId: string): WorkspaceFileSettings {
  ensureWorkspaceFileSettings(projectId);
  const row = getDb().prepare("SELECT * FROM workspace_file_settings WHERE project_id = ?").get(projectId) as any;
  return {
    projectId,
    repoDirs: normalizeRepoDirs(parseJson<string[]>(row?.repo_dirs_json, DEFAULT_REPO_DIRS)),
    externalPaths: listExternalPaths(projectId),
    updatedAt: row?.updated_at ?? nowIso()
  };
}

export function saveWorkspaceFileSettings(projectId: string, input: SaveWorkspaceFileSettingsInput): WorkspaceFileSettings {
  getProject(projectId);
  const stamp = nowIso();
  const repoDirs = normalizeRepoDirs(input.repoDirs.length ? input.repoDirs : DEFAULT_REPO_DIRS);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workspace_file_settings (project_id, repo_dirs_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET repo_dirs_json = excluded.repo_dirs_json, updated_at = excluded.updated_at`
    ).run(projectId, JSON.stringify(repoDirs), stamp);
    db.prepare("DELETE FROM workspace_external_paths WHERE project_id = ?").run(projectId);
    const insert = db.prepare(
      `INSERT INTO workspace_external_paths (id, project_id, label, path, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of input.externalPaths) {
      const rawPath = item.path.trim();
      if (!rawPath) continue;
      const externalPath = path.resolve(rawPath);
      insert.run(item.id ?? id("external-path"), projectId, item.label.trim() || path.basename(externalPath), externalPath, item.description ?? null, stamp, stamp);
    }
  });
  tx();
  return getWorkspaceFileSettings(projectId);
}

export function ensureRepoWorkspaceDirs(projectId: string): WorkspaceFileEntry[] {
  const project = requireProjectRepo(projectId);
  const settings = getWorkspaceFileSettings(projectId);
  for (const dir of settings.repoDirs) {
    mkdirSync(path.join(project.repository!.path, dir), { recursive: true });
  }
  return scanWorkspaceFiles(projectId).filter((entry) => entry.kind === "repo-dir");
}

export function importWorkspaceFilesToRepo(projectId: string, targetDir: string, sources: string[]): WorkspaceImportResult {
  const project = requireProjectRepo(projectId);
  const safeTarget = safeRepoRelativeDir(targetDir);
  const targetRoot = path.join(project.repository!.path, safeTarget);
  mkdirSync(targetRoot, { recursive: true });
  for (const source of sources) {
    const sourcePath = path.resolve(source);
    if (!existsSync(sourcePath)) continue;
    const targetPath = path.join(targetRoot, path.basename(sourcePath));
    cpSync(sourcePath, targetPath, { recursive: true, force: true });
  }
  return {
    imported: [summarizeEntry(project.repository!.path, targetRoot, safeTarget, "repo-dir", safeTarget, null)],
    targetDir: safeTarget
  };
}

export function scanWorkspaceFiles(projectId: string): WorkspaceFileEntry[] {
  const project = getProject(projectId);
  const settings = getWorkspaceFileSettings(projectId);
  const entries: WorkspaceFileEntry[] = [];
  const repoPath = project.repository?.path;
  for (const repoDir of settings.repoDirs) {
    const fullPath = repoPath ? path.join(repoPath, repoDir) : repoDir;
    entries.push(summarizeEntry(repoPath ?? "", fullPath, repoDir, "repo-dir", repoDir, DEFAULT_REPO_DIR_DESCRIPTIONS[repoDir] ?? null));
  }
  for (const external of settings.externalPaths) {
    entries.push(summarizeEntry("", external.path, undefined, "external-dir", external.label, external.description ?? null, external.id));
  }
  return entries;
}

export async function chooseWorkspaceFiles(): Promise<string[]> {
  const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
  return result.canceled ? [] : result.filePaths;
}

export async function chooseWorkspaceDirectory(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
}

function ensureWorkspaceFileSettings(projectId: string) {
  getProject(projectId);
  const row = getDb().prepare("SELECT project_id FROM workspace_file_settings WHERE project_id = ?").get(projectId);
  if (row) return;
  getDb()
    .prepare("INSERT INTO workspace_file_settings (project_id, repo_dirs_json, updated_at) VALUES (?, ?, ?)")
    .run(projectId, JSON.stringify(DEFAULT_REPO_DIRS), nowIso());
}

function listExternalPaths(projectId: string): WorkspaceExternalPath[] {
  const rows = getDb()
    .prepare("SELECT * FROM workspace_external_paths WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as any[];
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    path: row.path,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function requireProjectRepo(projectId: string) {
  const project = getProject(projectId);
  if (!project.repository?.path || !existsSync(project.repository.path)) throw new Error("项目尚未绑定有效仓库");
  return project;
}

function normalizeRepoDirs(values: string[]) {
  const seen = new Set<string>();
  return [...DEFAULT_REPO_DIRS, ...values]
    .map(safeRepoRelativeDir)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function safeRepoRelativeDir(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.includes("..")) return "";
  return normalized;
}

function summarizeEntry(
  repoPath: string,
  fullPath: string,
  relativePath: string | undefined,
  kind: WorkspaceFileEntry["kind"],
  label: string,
  description: string | null,
  key = `${kind}:${relativePath ?? fullPath}`
): WorkspaceFileEntry {
  if (!existsSync(fullPath)) {
    return { key, label, path: fullPath, relativePath, kind, exists: false, fileCount: 0, sizeBytes: 0, updatedAt: null, description };
  }
  const summary = summarizeDirectory(fullPath);
  const rel = relativePath ?? (repoPath ? path.relative(repoPath, fullPath).replace(/\\/g, "/") : undefined);
  return {
    key,
    label,
    path: fullPath,
    relativePath: rel,
    kind,
    exists: true,
    fileCount: summary.fileCount,
    sizeBytes: summary.sizeBytes,
    updatedAt: summary.updatedAt?.toISOString() ?? null,
    description
  };
}

function summarizeDirectory(root: string) {
  const stat = statSync(root);
  if (stat.isFile()) return { fileCount: 1, sizeBytes: stat.size, updatedAt: stat.mtime };
  let fileCount = 0;
  let sizeBytes = 0;
  let updatedAt = stat.mtime;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_SCAN_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    const child = summarizeDirectory(full);
    fileCount += child.fileCount;
    sizeBytes += child.sizeBytes;
    if (child.updatedAt > updatedAt) updatedAt = child.updatedAt;
  }
  return { fileCount, sizeBytes, updatedAt };
}
