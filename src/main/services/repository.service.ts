import { dialog } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import simpleGit from "simple-git";
import { getDb, id, nowIso } from "../db/database";
import type { GitCommitResult, GitPushResult, GitStatus, Repository, RepositoryInspection } from "../../shared/types";

export async function chooseDirectory() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
}

export async function inspectRepository(repoPath: string): Promise<RepositoryInspection> {
  const exists = existsSync(repoPath);
  if (!exists) return { path: repoPath, exists, isGitRepository: false, error: "目录不存在" };
  const git = simpleGit(repoPath);
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { path: repoPath, exists, isGitRepository: false };
    const status = await readGitStatus(repoPath);
    return {
      path: repoPath,
      exists,
      isGitRepository: true,
      branch: status.branch,
      remoteOrigin: status.remoteOrigin,
      lastCommitHash: status.lastCommitHash,
      isDirty: status.isDirty,
      status
    };
  } catch (error) {
    return {
      path: repoPath,
      exists,
      isGitRepository: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function bindRepository(projectId: string, repoPath: string): Promise<Repository> {
  const inspection = await inspectRepository(repoPath);
  if (!inspection.isGitRepository) throw new Error(inspection.error ?? "请选择有效 Git 仓库");
  return persistRepositoryBinding(projectId, repoPath, inspection);
}

export async function bindOrInitRepository(projectId: string, repoPath: string): Promise<Repository> {
  let inspection = await inspectRepository(repoPath);
  if (!inspection.exists) throw new Error(inspection.error ?? "目录不存在");
  if (!inspection.isGitRepository) {
    await simpleGit(repoPath).init();
    inspection = await inspectRepository(repoPath);
  }
  if (!inspection.isGitRepository) throw new Error(inspection.error ?? "无法初始化 Git 仓库");
  return persistRepositoryBinding(projectId, repoPath, inspection);
}

function persistRepositoryBinding(projectId: string, repoPath: string, inspection: RepositoryInspection): Repository {
  const db = getDb();
  const normalized = path.resolve(repoPath);
  const existing = db.prepare("SELECT * FROM repositories WHERE path = ?").get(normalized) as any;
  const stamp = nowIso();
  const repoId = existing?.id ?? id("repo");
  const values = {
    id: repoId,
    path: normalized,
    branch: inspection.branch ?? null,
    remoteOrigin: inspection.remoteOrigin ?? null,
    lastCommitHash: inspection.lastCommitHash ?? null,
    isDirty: inspection.isDirty ? 1 : 0,
    createdAt: existing?.created_at ?? stamp,
    updatedAt: stamp
  };
  if (existing) {
    db.prepare(
      "UPDATE repositories SET branch = @branch, remote_origin = @remoteOrigin, last_commit_hash = @lastCommitHash, is_dirty = @isDirty, updated_at = @updatedAt WHERE id = @id"
    ).run(values);
  } else {
    db.prepare(
      `INSERT INTO repositories (id, path, branch, remote_origin, last_commit_hash, is_dirty, created_at, updated_at)
      VALUES (@id, @path, @branch, @remoteOrigin, @lastCommitHash, @isDirty, @createdAt, @updatedAt)`
    ).run(values);
  }
  db.prepare("UPDATE projects SET repository_id = ?, status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END, updated_at = ? WHERE id = ?").run(
    repoId,
    stamp,
    projectId
  );
  return getRepositoryById(repoId)!;
}

export function getRepositoryById(repositoryId: string): Repository | null {
  const row = getDb().prepare("SELECT * FROM repositories WHERE id = ?").get(repositoryId) as any;
  return row ? mapRepository(row) : null;
}

export async function getRepositoryStatus(repositoryId: string): Promise<GitStatus> {
  const repo = requireRepository(repositoryId);
  const status = await readGitStatus(repo.path);
  getDb()
    .prepare("UPDATE repositories SET branch = ?, remote_origin = ?, last_commit_hash = ?, is_dirty = ?, updated_at = ? WHERE id = ?")
    .run(status.branch, status.remoteOrigin ?? null, status.lastCommitHash ?? null, status.isDirty ? 1 : 0, nowIso(), repositoryId);
  return status;
}

export async function getRepositoryDiff(repositoryId: string): Promise<string> {
  const repo = requireRepository(repositoryId);
  return simpleGit(repo.path).diff();
}

export async function stageAll(repositoryId: string): Promise<void> {
  const repo = requireRepository(repositoryId);
  await simpleGit(repo.path).add(".");
}

export async function commitRepository(repositoryId: string, message: string): Promise<GitCommitResult> {
  if (!message.trim()) throw new Error("commit message 不能为空");
  const repo = requireRepository(repositoryId);
  const git = simpleGit(repo.path);
  await git.add(".");
  const result = await git.commit(message.trim());
  return { commitHash: result.commit, summary: JSON.stringify(result.summary) };
}

export async function pushRepository(repositoryId: string): Promise<GitPushResult> {
  const repo = requireRepository(repositoryId);
  const status = await readGitStatus(repo.path);
  if (!status.remoteOrigin) throw new Error("当前仓库没有 origin remote，无法 push");
  await simpleGit(repo.path).push("origin", status.branch);
  return { remote: "origin", branch: status.branch, summary: `已推送到 origin/${status.branch}` };
}

export async function repositoryHistory(repositoryId: string) {
  const repo = requireRepository(repositoryId);
  const log = await simpleGit(repo.path).log({ maxCount: 20 });
  return log.all.map((item) => ({ hash: item.hash, message: item.message, date: item.date }));
}

export async function readGitStatus(repoPath: string): Promise<GitStatus> {
  const git = simpleGit(repoPath);
  const [status, remotes, log, diffSummary] = await Promise.all([
    git.status(),
    git.getRemotes(true),
    git.log({ maxCount: 1 }).catch(() => ({ latest: null })),
    git.diffSummary().catch(() => ({ files: [], insertions: 0, deletions: 0, changed: 0 }))
  ]);
  const origin = remotes.find((remote) => remote.name === "origin");
  return {
    branch: status.current || "HEAD",
    remoteOrigin: origin?.refs.fetch,
    lastCommitHash: (log as any).latest?.hash,
    isDirty: !status.isClean(),
    staged: status.staged,
    unstaged: status.modified,
    untracked: status.not_added,
    ahead: status.ahead,
    behind: status.behind,
    diffSummary: JSON.stringify(diffSummary)
  };
}

function requireRepository(repositoryId: string) {
  const repo = getRepositoryById(repositoryId);
  if (!repo) throw new Error("仓库不存在");
  return repo;
}

function mapRepository(row: any): Repository {
  return {
    id: row.id,
    path: row.path,
    branch: row.branch,
    remoteOrigin: row.remote_origin,
    lastCommitHash: row.last_commit_hash,
    isDirty: Boolean(row.is_dirty),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
