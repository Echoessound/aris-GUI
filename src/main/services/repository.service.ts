import { dialog } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import simpleGit from "simple-git";
import { getDb, id, nowIso } from "../db/database";
import type { GitBranchInfo, GitCommitResult, GitDeliveryResult, GitIgnoredSummary, GitPullResult, GitPushResult, GitStatus, Repository, RepositoryInspection } from "../../shared/types";

const DEFAULT_RESEARCH_DIRS = [
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
  ensureDefaultResearchDirs(normalized);
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
  const git = simpleGit(repo.path);
  const [unstaged, staged, status] = await Promise.all([
    git.diff(),
    git.diff(["--cached"]),
    git.status()
  ]);
  const untracked = status.not_added.length
    ? ["Untracked files:", ...status.not_added.map((file) => `  ${file}`)].join("\n")
    : "";
  return [
    staged ? `## Staged diff\n\n${staged}` : "",
    unstaged ? `## Unstaged diff\n\n${unstaged}` : "",
    untracked
  ].filter(Boolean).join("\n\n");
}

export async function listBranches(repositoryId: string): Promise<GitBranchInfo[]> {
  const repo = requireRepository(repositoryId);
  const branches = await simpleGit(repo.path).branchLocal();
  return branches.all.map((name) => ({ name, current: name === branches.current }));
}

export async function createBranch(repositoryId: string, branchName: string, checkout = true): Promise<GitStatus> {
  const repo = requireRepository(repositoryId);
  const safeName = normalizeBranchName(branchName);
  const git = simpleGit(repo.path);
  const branches = await git.branchLocal();
  if (branches.all.includes(safeName)) throw new Error(`分支已存在：${safeName}`);
  if (checkout) {
    await git.checkoutLocalBranch(safeName);
  } else {
    await git.branch([safeName]);
  }
  return getRepositoryStatus(repositoryId);
}

export async function checkoutBranch(repositoryId: string, branchName: string): Promise<GitStatus> {
  const repo = requireRepository(repositoryId);
  const safeName = normalizeBranchName(branchName);
  const status = await readGitStatus(repo.path);
  if (status.isDirty) throw new Error("工作区还有未提交改动。请先提交或取消改动后再切换分支。");
  await simpleGit(repo.path).checkout(safeName);
  return getRepositoryStatus(repositoryId);
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
  const status = await git.status();
  if (status.isClean()) throw new Error("没有可提交的 Git 改动");
  const result = await git.commit(message.trim());
  await getRepositoryStatus(repositoryId);
  return { commitHash: result.commit, summary: JSON.stringify(result.summary) };
}

export async function pullRepository(repositoryId: string): Promise<GitPullResult> {
  const repo = requireRepository(repositoryId);
  const status = await readGitStatus(repo.path);
  if (!status.remoteOrigin) throw new Error("当前仓库没有 origin remote，无法 pull");
  if (status.isDirty) throw new Error("工作区还有未提交改动，请先提交后再 pull");
  const result = await simpleGit(repo.path).pull("origin", status.branch);
  await getRepositoryStatus(repositoryId);
  return { summary: JSON.stringify(result.summary) };
}

export async function pushRepository(repositoryId: string): Promise<GitPushResult> {
  const repo = requireRepository(repositoryId);
  const status = await readGitStatus(repo.path);
  if (!status.remoteOrigin) throw new Error("当前仓库没有 origin remote，无法 push");
  if (status.isDirty) throw new Error("工作区还有未提交改动，请先提交后再 push");
  await simpleGit(repo.path).push("origin", status.branch, ["--set-upstream"]);
  await getRepositoryStatus(repositoryId);
  return { remote: "origin", branch: status.branch, summary: `已推送到 origin/${status.branch}` };
}

export async function repositoryHistory(repositoryId: string) {
  const repo = requireRepository(repositoryId);
  const log = await simpleGit(repo.path).log({ maxCount: 20 });
  return log.all.map((item) => ({ hash: item.hash, message: item.message, date: item.date }));
}

export async function summarizeIgnoredFiles(repositoryId: string): Promise<GitIgnoredSummary> {
  const repo = requireRepository(repositoryId);
  const git = simpleGit(repo.path);
  const output = await git.raw(["status", "--ignored", "--porcelain=v1"]).catch(() => "");
  const ignored = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("!! "))
    .map((line) => line.slice(3));
  const likelyArtifacts = ignored.filter((item) => item.startsWith(".aris-app/") || item.includes("/artifacts/") || /\.(md|pdf|tex|docx|json|jsonl|csv|png|jpg|jpeg|webp|svg)$/i.test(item));
  return {
    repositoryId,
    ignoredCount: ignored.length,
    ignoredSamples: ignored.slice(0, 20),
    likelyArtifactCount: likelyArtifacts.length,
    likelyArtifactSamples: likelyArtifacts.slice(0, 20),
    explanation: ignored.length
      ? "Git 忽略规则中存在本地运行目录或生成文件；原始 .aris-app/runs 不会直接提交，建议生成 Git 交付包后再提交研究产物。"
      : "没有检测到被 Git 忽略的文件。"
  };
}

export async function prepareDelivery(repositoryId: string, runId?: string): Promise<GitDeliveryResult> {
  const repo = requireRepository(repositoryId);
  const selectedRunId = runId || latestRunIdForRepository(repositoryId);
  const deliveryRoot = path.join(repo.path, "git-delivery", deliveryFolderName(selectedRunId));
  mkdirSync(deliveryRoot, { recursive: true });
  const copiedFiles: GitDeliveryResult["copiedFiles"] = [];
  const artifactRows = selectedRunId ? artifactRowsForRun(selectedRunId) : [];
  const candidates = artifactRows.length ? artifactRows : discoverRepoDeliveryCandidates(repo.path);

  for (const artifact of candidates) {
    if (!existsSync(artifact.path) || !isDeliveryFile(artifact.path)) continue;
    const relative = normalizeDeliveryRelativePath(artifact.runRelativePath ?? artifact.relativePath ?? artifact.name ?? path.basename(artifact.path));
    const target = uniqueTargetPath(path.join(deliveryRoot, relative));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(artifact.path, target);
    copiedFiles.push({
      source: artifact.path,
      target,
      purpose: deliveryPurpose(relative)
    });
  }

  const suggestedCommitMessage = selectedRunId ? `交付 ${selectedRunId.slice(0, 12)} 的研究产物` : "交付最新研究产物";
  const summaryPath = path.join(deliveryRoot, "DELIVERY_SUMMARY.zh.md");
  writeFileSync(summaryPath, buildDeliverySummary(repositoryId, selectedRunId, copiedFiles, suggestedCommitMessage), "utf8");
  copiedFiles.unshift({ source: "ARIS Paper Studio", target: summaryPath, purpose: "交付摘要和建议提交说明" });
  await getRepositoryStatus(repositoryId);
  return {
    repositoryId,
    runId: selectedRunId ?? null,
    deliveryDir: deliveryRoot,
    summaryPath,
    copiedFiles,
    suggestedCommitMessage
  };
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

function latestRunIdForRepository(repositoryId: string) {
  const row = getDb()
    .prepare(
      `SELECT runs.id
       FROM runs
       INNER JOIN projects ON projects.id = runs.project_id
       WHERE projects.repository_id = ?
       ORDER BY runs.round_index DESC, runs.started_at DESC
       LIMIT 1`
    )
    .get(repositoryId) as { id: string } | undefined;
  return row?.id;
}

function artifactRowsForRun(runId: string) {
  return getDb()
    .prepare("SELECT path, name, relative_path AS relativePath, run_relative_path AS runRelativePath, type FROM artifacts WHERE run_id = ? ORDER BY name ASC")
    .all(runId) as Array<{ path: string; name: string; relativePath?: string | null; runRelativePath?: string | null; type?: string | null }>;
}

function discoverRepoDeliveryCandidates(repoPath: string) {
  const roots = ["idea-stage", "implementation-stage", "experiment-stage", "review-stage", "paper", "figures", "outputs", "results", "references"];
  const files: Array<{ path: string; name: string; relativePath: string; runRelativePath: string }> = [];
  for (const root of roots) {
    const full = path.join(repoPath, root);
    if (existsSync(full)) walkDeliveryCandidates(full, repoPath, files);
  }
  for (const file of ["NARRATIVE_REPORT.md", "FINAL_REPORT.md", "PIPELINE_REPORT.md", "README.md"]) {
    const full = path.join(repoPath, file);
    if (existsSync(full)) files.push({ path: full, name: file, relativePath: file, runRelativePath: file });
  }
  return files;
}

function walkDeliveryCandidates(root: string, repoPath: string, files: Array<{ path: string; name: string; relativePath: string; runRelativePath: string }>) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (![".git", ".aris-app", "node_modules", ".venv", "venv", "__pycache__"].includes(entry.name)) walkDeliveryCandidates(full, repoPath, files);
      continue;
    }
    const rel = path.relative(repoPath, full).replace(/\\/g, "/");
    files.push({ path: full, name: rel, relativePath: rel, runRelativePath: rel });
  }
}

function isDeliveryFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (![".md", ".pdf", ".tex", ".bib", ".docx", ".json", ".jsonl", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".txt", ".html", ".htm"].includes(ext)) return false;
  try {
    return statSync(filePath).size <= 50 * 1024 * 1024;
  } catch {
    return false;
  }
}

function normalizeDeliveryRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.startsWith(".aris-app/")) return path.basename(normalized || "artifact");
  return normalized;
}

function uniqueTargetPath(target: string) {
  if (!existsSync(target)) return target;
  const ext = path.extname(target);
  const base = target.slice(0, target.length - ext.length);
  let index = 2;
  while (existsSync(`${base}-${index}${ext}`)) index += 1;
  return `${base}-${index}${ext}`;
}

function deliveryFolderName(runId?: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return runId ? `${stamp}-${runId.slice(0, 12)}` : `${stamp}-manual`;
}

function deliveryPurpose(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.endsWith("ARTIFACT_INDEX.zh.md")) return "产物索引";
  if (normalized.startsWith("idea-stage/")) return "选题与研究方向材料";
  if (normalized.startsWith("implementation-stage/")) return "方法实现或工程材料";
  if (normalized.startsWith("experiment-stage/") || normalized.startsWith("results/")) return "实验与结果材料";
  if (normalized.startsWith("review-stage/")) return "评审与质量审计材料";
  if (normalized.startsWith("paper/") || normalized.endsWith(".tex") || normalized.endsWith(".pdf")) return "论文源文件或 PDF";
  if (normalized.startsWith("figures/") || normalized.startsWith("assets/")) return "图表与展示素材";
  return "研究交付产物";
}

function buildDeliverySummary(repositoryId: string, runId: string | undefined, copiedFiles: GitDeliveryResult["copiedFiles"], suggestedCommitMessage: string) {
  const rows = copiedFiles.map((file) => `| \`${path.relative(path.dirname(path.dirname(file.target)), file.target).replace(/\\/g, "/")}\` | ${file.purpose} | \`${file.source}\` |`);
  return [
    "# Git 交付摘要",
    "",
    `- 仓库 ID：${repositoryId}`,
    `- 来源 run：${runId ?? "未指定，使用仓库可交付文件"}`,
    `- 建议 commit message：${suggestedCommitMessage}`,
    "",
    "## 本次准备提交的文件",
    "",
    "| 文件 | 用途 | 来源 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## 说明",
    "",
    "- 本交付包只复制研究产物和必要摘要，不提交 `.aris-app/runs` 原始运行日志。",
    "- 提交前请在 Git 页面查看 diff，确认论文、评审和实验文件符合预期。",
    ""
  ].join("\n");
}

function normalizeBranchName(value: string) {
  const branchName = value.trim().replace(/^refs\/heads\//, "");
  if (!branchName) throw new Error("分支名不能为空");
  if (branchName.includes("..") || /[\s~^:?*[\\]/.test(branchName) || branchName.startsWith("/") || branchName.endsWith("/") || branchName.endsWith(".")) {
    throw new Error("分支名包含 Git 不支持的字符");
  }
  return branchName;
}

function ensureDefaultResearchDirs(repoPath: string) {
  for (const dir of DEFAULT_RESEARCH_DIRS) {
    mkdirSync(path.join(repoPath, dir), { recursive: true });
  }
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
