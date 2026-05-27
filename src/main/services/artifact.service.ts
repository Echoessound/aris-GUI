import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, id, nowIso, parseJson } from "../db/database";
import type { Artifact, ArtifactType } from "../../shared/types";
import { decodeTextBuffer, readTextFile } from "./encoding.service";
import { getProject } from "./project.service";

const ARTIFACT_INDEX_NAME = "ARTIFACT_INDEX.zh.md";
const MAX_TEXT_PREVIEW_CHARS = 240000;
const ignoredDirs = new Set([
  ".git",
  ".aris-app",
  ".cache",
  ".pnpm-store",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "release",
  "runs"
]);

interface FileMeta {
  type: ArtifactType;
  size: number;
  updatedAt: string;
  relativePath: string;
  runRelativePath?: string;
  description: string;
}

export function listArtifacts(projectId: string): Artifact[] {
  syncRunArtifactSnapshots(projectId);
  pruneMissingArtifacts(projectId);
  const rows = getDb()
    .prepare(
      `SELECT artifacts.* FROM artifacts
       LEFT JOIN runs ON runs.id = artifacts.run_id
       WHERE artifacts.project_id = ?
       ORDER BY
        COALESCE(runs.round_index, 0) DESC,
        CASE
          WHEN artifacts.name = ? THEN 0
          WHEN artifacts.name IN ('IDEA_REPORT.md', 'NARRATIVE_REPORT.md', 'FINAL_REPORT.md', 'AUTO_REVIEW.md') THEN 1
          WHEN artifacts.type = 'pdf' THEN 2
          WHEN artifacts.type = 'markdown' THEN 3
          ELSE 4
        END,
        artifacts.name ASC`
    )
    .all(projectId, ARTIFACT_INDEX_NAME) as any[];
  return rows.map(mapArtifact);
}

export function readArtifactText(artifactId: string): string {
  const artifact = getArtifact(artifactId);
  if (!existsSync(artifact.path)) throw new Error(`产物文件不存在：${artifact.path}`);
  if (!artifact.previewable) throw new Error("该产物不支持内联预览，请用系统应用打开。");
  if (artifact.type === "word") return readWordText(artifact.path);
  const text = readTextFile(artifact.path);
  if (text.length <= MAX_TEXT_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_PREVIEW_CHARS)}\n\n...[内容过大，预览已截断；请打开完整文件查看]`;
}

export function artifactFileUrl(artifactId: string): string {
  const artifact = getArtifact(artifactId);
  if (!existsSync(artifact.path)) throw new Error(`产物文件不存在：${artifact.path}`);
  return pathToFileURL(artifact.path).toString();
}

export function rescanArtifacts(projectId: string, runId?: string): Artifact[] {
  const project = getProject(projectId);
  const repoPath = project.repository?.path;
  if (!repoPath || !existsSync(repoPath)) throw new Error("项目尚未绑定有效仓库");

  const db = getDb();
  const stamp = nowIso();
  const tx = db.transaction(() => {
    if (runId) {
      const runWindow = getRunArtifactWindow(runId);
      const discovered = new Map<string, FileMeta>();
      walkRepo(repoPath, repoPath, discovered, runWindow.startedAt, runWindow.endedAt);
      const snapshotRoot = path.join(repoPath, ".aris-app", "runs", runId, "artifacts");
      rmSync(snapshotRoot, { recursive: true, force: true });
      mkdirSync(snapshotRoot, { recursive: true });
      const snapshotFiles = new Map<string, FileMeta>();
      for (const [filePath, meta] of discovered) {
        const storedPath = snapshotArtifact(repoPath, snapshotRoot, filePath);
        snapshotFiles.set(storedPath, {
          ...meta,
          runRelativePath: meta.relativePath
        });
      }
      writeArtifactIndex(snapshotRoot, snapshotFiles);
      rebuildRunArtifactRows(projectId, runId, snapshotRoot, stamp);
    } else {
      db.prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id IS NULL").run(projectId);
      const files = new Map<string, FileMeta>();
      walkRepo(repoPath, repoPath, files, null, null);
      insertArtifacts(projectId, null, files, stamp);
    }
  });
  tx();
  if (!runId) syncRunArtifactSnapshots(projectId);
  return listArtifacts(projectId);
}

function syncRunArtifactSnapshots(projectId: string) {
  const project = getProject(projectId);
  const repoPath = project.repository?.path;
  if (!repoPath || !existsSync(repoPath)) return;
  const rows = getDb().prepare("SELECT id FROM runs WHERE project_id = ? ORDER BY round_index ASC").all(projectId) as Array<{ id: string }>;
  const stamp = nowIso();
  const tx = getDb().transaction(() => {
    for (const run of rows) {
      const root = path.join(repoPath, ".aris-app", "runs", run.id, "artifacts");
      getDb().prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id = ?").run(projectId, run.id);
      if (existsSync(root)) {
        const files = collectSnapshotFiles(root);
        writeArtifactIndex(root, files);
        insertArtifacts(projectId, run.id, collectSnapshotFiles(root), stamp);
      } else {
        const files = readArtifactJsonSnapshot(repoPath, run.id);
        insertArtifacts(projectId, run.id, files, stamp);
      }
    }
  });
  tx();
}

function rebuildRunArtifactRows(projectId: string, runId: string, root: string, stamp: string) {
  getDb().prepare("DELETE FROM artifacts WHERE project_id = ? AND run_id = ?").run(projectId, runId);
  insertArtifacts(projectId, runId, collectSnapshotFiles(root), stamp);
}

function insertArtifacts(projectId: string, runId: string | null, files: Map<string, FileMeta>, stamp: string) {
  const insert = getDb().prepare(`
    INSERT INTO artifacts (
      id, project_id, run_id, type, name, path, relative_path, run_relative_path, description, previewable, size_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [filePath, meta] of files) {
    insert.run(
      id("artifact"),
      projectId,
      runId,
      meta.type,
      meta.relativePath,
      filePath,
      meta.relativePath,
      meta.runRelativePath ?? meta.relativePath,
      meta.description,
      isPreviewable(meta.type) ? 1 : 0,
      meta.size,
      stamp,
      meta.updatedAt
    );
  }
}

function walkRepo(
  root: string,
  repoPath: string,
  files: Map<string, FileMeta>,
  changedSince: Date | null,
  changedUntil: Date | null
) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walkRepo(full, repoPath, files, changedSince, changedUntil);
      continue;
    }
    const stat = statSync(full);
    if (changedSince && stat.mtime < changedSince) continue;
    if (changedUntil && stat.mtime > changedUntil) continue;
    const relativePath = normalizeRel(path.relative(repoPath, full));
    files.set(full, buildFileMeta(full, relativePath, relativePath, stat));
  }
}

function collectSnapshotFiles(root: string) {
  const files = new Map<string, FileMeta>();
  walkSnapshot(root, root, files);
  return files;
}

function walkSnapshot(root: string, base: string, files: Map<string, FileMeta>) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkSnapshot(full, base, files);
      continue;
    }
    const stat = statSync(full);
    const runRelativePath = normalizeRel(path.relative(base, full));
    files.set(full, buildFileMeta(full, runRelativePath, runRelativePath, stat));
  }
}

function snapshotArtifact(repoPath: string, snapshotRoot: string, filePath: string) {
  const rel = normalizeRel(path.relative(repoPath, filePath));
  const snapshotPath = path.join(snapshotRoot, rel);
  mkdirSync(path.dirname(snapshotPath), { recursive: true });
  copyFileSync(filePath, snapshotPath);
  return snapshotPath;
}

function writeArtifactIndex(root: string, files: Map<string, FileMeta>) {
  mkdirSync(root, { recursive: true });
  const entries = Array.from(files.entries())
    .filter(([, meta]) => meta.runRelativePath !== ARTIFACT_INDEX_NAME)
    .sort((a, b) => a[1].runRelativePath!.localeCompare(b[1].runRelativePath!));
  const directoryRows = summarizeArtifactDirectories(entries.map(([, meta]) => meta));
  const lines = [
    "# 本轮产物索引",
    "",
    "这个文件由 ARIS Paper Studio 自动生成，用于帮助用户和下一轮 Codex 快速理解本轮产物、目录结构和可续接位置。",
    "",
    "## 使用指南",
    "",
    "- 优先阅读 `idea-stage/IDEA_REPORT.md`、`NARRATIVE_REPORT.md`、`paper/paper.tex`、`review-stage/AUTO_REVIEW.md`、`review-stage/MULTI_AGENT_REVIEW.md` 等核心产物。",
    "- 续接 Workflow 时，应先根据下方目录用途判断每个文件属于选题、实现、实验、评审、论文、数据还是交付输出，不要把 `.aris-app/runs` 运行日志当作主要研究内容。",
    "- 如果某个目录存在但文件很少，通常表示该阶段尚未充分展开；下一轮应优先补齐对应目录中的计划、报告、代码、实验结果或论文材料。",
    "",
    "## 目录用途",
    "",
    "| 目录 | 实际用途 | 文件数 | 总大小 | 续接建议 |",
    "| --- | --- | ---: | ---: | --- |",
    ...directoryRows.map((row) => `| \`${row.dir}\` | ${escapeTableCell(row.purpose)} | ${row.count} | ${formatBytes(row.size)} | ${escapeTableCell(row.nextAction)} |`),
    "",
    "## 文件用途",
    "",
    "| 相对位置 | 类型 | 大小 | 更新时间 | 实际用途 | 何时使用 |",
    "| --- | --- | ---: | --- | --- |",
    ...entries.map(([, meta]) => `| \`${meta.runRelativePath}\` | ${meta.type} | ${formatBytes(meta.size)} | ${meta.updatedAt} | ${escapeTableCell(meta.description)} | ${escapeTableCell(usageHintForArtifact(meta.runRelativePath ?? meta.relativePath, meta.type))} |`),
    ""
  ];
  writeFileSync(path.join(root, ARTIFACT_INDEX_NAME), lines.join("\n"), "utf8");
}

function summarizeArtifactDirectories(files: FileMeta[]) {
  const rows = new Map<string, { dir: string; purpose: string; nextAction: string; count: number; size: number }>();
  for (const meta of files) {
    const dir = topArtifactDirectory(meta.runRelativePath ?? meta.relativePath);
    const existing = rows.get(dir) ?? {
      dir,
      purpose: describeArtifactDirectory(dir),
      nextAction: directoryNextAction(dir),
      count: 0,
      size: 0
    };
    existing.count += 1;
    existing.size += meta.size;
    rows.set(dir, existing);
  }
  return Array.from(rows.values()).sort((a, b) => directorySortKey(a.dir).localeCompare(directorySortKey(b.dir)));
}

function topArtifactDirectory(relativePath: string) {
  const normalized = normalizeRel(relativePath);
  const parts = normalized.split("/");
  if (parts.length <= 1) return ".";
  if (parts[0] === "data" && parts[1]) return `data/${parts[1]}`;
  return parts[0];
}

function describeArtifactDirectory(dir: string) {
  const descriptions: Record<string, string> = {
    ".": "仓库根目录，通常放置跨阶段总报告、叙事报告、最终报告、README 或全局配置；用于快速了解本轮总体结果。",
    "idea-stage": "选题与立题目录，保存问题定义、候选 idea、创新假设、相关工作线索和下一步研究计划。",
    "implementation-stage": "实现目录，保存方法原型、工程代码、脚本、算法说明和实现过程记录。",
    "experiment-stage": "实验目录，保存实验计划、运行脚本、指标表、消融记录、日志摘要和可复现实验说明。",
    "review-stage": "评审目录，保存自动评审、多 Agent 评审、拒稿风险、修改建议和质量审计结果。",
    paper: "论文目录，保存 LaTeX 源码、参考文献、图表引用、编译日志、PDF 和投稿稿件相关文件。",
    "data/raw": "原始数据目录，保存下载或导入的未处理数据；下一轮不应直接覆盖，应保留来源可追溯性。",
    "data/processed": "处理后数据目录，保存清洗、筛选、特征化或转换后的数据，可作为实验和绘图输入。",
    references: "参考资料目录，保存论文 PDF、BibTeX、阅读笔记、引用清单和外部资料索引。",
    outputs: "输出目录，保存可交付报告、图表、导出文件、汇总表、演示材料和最终结果副本。",
    assets: "素材目录，保存图片、示意图、截图、图标、论文插图源文件和展示资源。",
    figures: "图表目录，保存论文图、实验曲线、流程图、架构图和可视化导出文件。",
    results: "结果目录，保存实验输出、评测结果、统计表和模型运行结果。",
    logs: "日志目录，保存运行日志、错误摘要和诊断记录。"
  };
  return descriptions[dir] ?? "自定义研究目录，保存本轮 Workflow 生成或导入的阶段性材料；请结合文件名判断用途。";
}

function directoryNextAction(dir: string) {
  const actions: Record<string, string> = {
    ".": "先读根目录总报告，再决定进入哪个阶段目录补充。",
    "idea-stage": "续接时优先确认选题是否已定型，缺失则补问题定义、novelty 和下一步计划。",
    "implementation-stage": "检查代码是否可运行，缺失则补最小原型、README 和运行命令。",
    "experiment-stage": "检查是否有真实结果和指标解释，缺失则补实验计划、运行脚本或结果表。",
    "review-stage": "检查评审是否覆盖创新性、实验可信度和写作风险，缺失则补评审或修改清单。",
    paper: "检查论文结构、图表和编译状态，缺失则补章节、BibTeX、图表或 PDF 编译。",
    "data/raw": "确认数据来源和权限，不要直接覆盖原始文件。",
    "data/processed": "确认处理流程可复现，必要时补处理脚本和字段说明。",
    references: "核对引用真实性和用途，必要时补 BibTeX 和阅读摘要。",
    outputs: "用于交付或预览，必要时重新导出最新报告、图表或 PDF。",
    assets: "用于论文和展示，必要时补源文件说明和图注。",
    figures: "检查图是否可用于论文，必要时补数据来源、脚本和图注。",
    results: "检查指标是否可支持论文 claim，必要时补统计检验或多 seed 结果。",
    logs: "用于诊断失败，不应替代正式研究产物。"
  };
  return actions[dir] ?? "续接时先确认该目录和当前阶段的关系，再决定是否补说明、脚本或结果。";
}

function directorySortKey(dir: string) {
  const order = [
    ".",
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
  const index = order.indexOf(dir);
  return `${index < 0 ? 999 : index}`.padStart(3, "0") + dir;
}

function readArtifactJsonSnapshot(repoPath: string, runId: string) {
  const files = new Map<string, FileMeta>();
  const manifestPath = path.join(repoPath, ".aris-app", "runs", runId, "artifacts.json");
  if (!existsSync(manifestPath)) return files;
  const entries = parseJson<Array<{ path?: string; name?: string }>>(readTextFile(manifestPath), []);
  if (!Array.isArray(entries)) return files;
  for (const entry of entries) {
    if (!entry.path || !existsSync(entry.path)) continue;
    const stat = statSync(entry.path);
    const relativePath = normalizeRel(entry.name ?? path.basename(entry.path));
    files.set(entry.path, buildFileMeta(entry.path, relativePath, relativePath, stat));
  }
  return files;
}

function buildFileMeta(filePath: string, relativePath: string, runRelativePath: string, stat: Stats): FileMeta {
  const type = detectArtifactType(filePath);
  return {
    type,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    relativePath,
    runRelativePath,
    description: describeArtifact(relativePath, type)
  };
}

function getRunArtifactWindow(runId: string) {
  const row = getDb()
    .prepare("SELECT started_at, ended_at FROM runs WHERE id = ?")
    .get(runId) as { started_at?: string; ended_at?: string } | undefined;
  if (!row?.started_at) return { startedAt: null, endedAt: null };
  const startedAt = new Date(row.started_at);
  startedAt.setSeconds(startedAt.getSeconds() - 2);
  const endedAt = row.ended_at ? new Date(row.ended_at) : null;
  if (endedAt) endedAt.setSeconds(endedAt.getSeconds() + 2);
  return { startedAt, endedAt };
}

function pruneMissingArtifacts(projectId: string) {
  const rows = getDb().prepare("SELECT id, path FROM artifacts WHERE project_id = ?").all(projectId) as Array<{ id: string; path: string }>;
  const remove = getDb().prepare("DELETE FROM artifacts WHERE id = ?");
  const tx = getDb().transaction(() => {
    for (const row of rows) {
      if (!existsSync(row.path)) remove.run(row.id);
    }
  });
  tx();
}

function detectArtifactType(filePath: string): ArtifactType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".pdf") return "pdf";
  if ([".docx", ".doc"].includes(ext)) return "word";
  if (ext === ".json") return "json";
  if (ext === ".jsonl") return "jsonl";
  if ([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".bmp"].includes(ext)) return "image";
  if (ext === ".tex") return "latex";
  if (ext === ".csv") return "csv";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".sh", ".ps1", ".bat", ".cmd", ".toml", ".yaml", ".yml", ".ini", ".cfg"].includes(ext)) {
    return "code";
  }
  if (ext === ".log") return "log";
  if (ext === ".txt") return "text";
  if ([".zip", ".7z", ".rar", ".gz", ".pkl", ".bin", ".exe", ".dll"].includes(ext)) return "binary";
  return "other";
}

function isPreviewable(type: ArtifactType) {
  return ["markdown", "word", "json", "jsonl", "latex", "text", "code", "csv", "html", "log"].includes(type);
}

function describeArtifact(relativePath: string, type: ArtifactType) {
  const normalized = normalizeRel(relativePath);
  const base = path.basename(relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  if (base === ARTIFACT_INDEX_NAME) return "本轮产物中文索引，解释目录用途、文件实际用途和下一轮续接入口。";
  if (base === "IDEA_REPORT.md") return "立题核心报告，用于记录问题定义、研究空白、候选 idea、创新假设、可行性判断和下一步行动。";
  if (base === "NARRATIVE_REPORT.md") return "本轮叙事总报告，用于串联从选题、实现、实验、评审到论文写作的过程和阶段性结论。";
  if (base === "FINAL_REPORT.md" || base === "PIPELINE_REPORT.md") return "阶段最终总结，用于汇总本轮完成内容、关键证据、剩余阻塞和后续建议。";
  if (base === "AUTO_REVIEW.md") return "自动评审报告，用于记录主要问题、拒稿风险、证据边界、修改建议和下一轮修复优先级。";
  if (base === "MULTI_AGENT_REVIEW.md") return "多 Agent 评审报告，用于汇总创新性、实验可信度、写作与投稿适配等多视角评分和修改清单。";
  if (normalized.endsWith("paper.tex")) return "论文 LaTeX 主文件，用于继续撰写、编译 PDF、检查章节结构和插入图表/引用。";
  if (normalized.endsWith("references.bib") || ext === ".bib") return "BibTeX 参考文献库，用于论文引用、查重引用真实性和补充相关工作。";
  if (normalized.includes("experiment") && (type === "csv" || type === "json" || type === "jsonl")) return "实验结果或指标记录，用于支撑论文 claim、绘图、统计分析和结果审计。";
  if (normalized.startsWith("data/raw/")) return "原始数据文件，用于保留数据来源和复现入口；不应在续接中直接覆盖。";
  if (normalized.startsWith("data/processed/")) return "处理后数据文件，用于实验、绘图或模型输入；应配合处理脚本说明来源。";
  if (normalized.startsWith("references/")) return "参考资料文件，用于相关工作、引用核查、阅读摘要或论文素材追踪。";
  if (normalized.startsWith("outputs/")) return "导出或交付文件，用于用户预览、阶段汇报、论文附件或最终交付。";
  if (normalized.startsWith("assets/") || normalized.startsWith("figures/")) return "图像/素材文件，用于论文插图、展示、截图证明或可视化结果。";
  if (ext === ".py") return "Python 脚本或实验代码，用于复现实验、处理数据、生成图表或验证方法。";
  if (type === "pdf") return "PDF 文档，用于查看论文编译结果、报告导出、参考文献原文或可提交材料。";
  if (type === "markdown") return "Markdown 文档，用于记录阶段报告、计划、说明、评审意见或交接摘要。";
  if (type === "code") return "代码或配置文件，用于复现 Workflow、运行实验、编译论文或保存工具参数。";
  if (type === "json" || type === "jsonl") return "结构化数据、运行日志或中间结果，用于续接判断、进度复盘、指标分析或工具消费。";
  if (type === "csv") return "表格数据或实验结果，用于指标比较、绘图、统计分析或人工核查。";
  if (type === "image") return "图片、截图或图表产物，用于论文图、实验可视化、界面证明或汇报材料。";
  if (type === "latex") return "LaTeX 源文件，用于论文正文、表格、图注、宏包配置或编译流程。";
  if (type === "word") return "Word 文档产物，用于可编辑稿件、评审材料或外部交付版本。";
  if (type === "binary" || type === "other") return "二进制或外部工具文件，用于保存模型、压缩包、第三方导出物或需系统应用打开的材料。";
  return "文本或日志产物，用于诊断、说明、交接或记录阶段性输出。";
}

function usageHintForArtifact(relativePath: string, type: ArtifactType) {
  const normalized = normalizeRel(relativePath);
  const base = path.basename(normalized);
  if (base === "IDEA_REPORT.md") return "续接前首先阅读，判断研究方向是否明确、是否需要继续查新或收敛 idea。";
  if (base === "NARRATIVE_REPORT.md" || base === "FINAL_REPORT.md" || base === "PIPELINE_REPORT.md") return "用于快速了解本轮总进展，再决定进入哪个阶段目录补工作。";
  if (base === "AUTO_REVIEW.md" || base === "MULTI_AGENT_REVIEW.md") return "用于确定下一轮修改优先级，不要重复评审，除非用户明确要求重跑。";
  if (normalized.endsWith("paper.tex")) return "用于继续写论文、编译 PDF、检查章节和引用。";
  if (normalized.startsWith("idea-stage/")) return "用于继续选题、完善 novelty、明确贡献和后续计划。";
  if (normalized.startsWith("implementation-stage/")) return "用于继续实现、调试、补 README 或补运行命令。";
  if (normalized.startsWith("experiment-stage/")) return "用于继续跑实验、分析指标、补消融或生成图表。";
  if (normalized.startsWith("review-stage/")) return "用于修复评审指出的问题、记录审计结论和拒稿风险。";
  if (normalized.startsWith("paper/")) return "用于论文写作、排版、引用、图表和编译检查。";
  if (normalized.startsWith("data/raw/")) return "作为只读数据来源使用，续接时优先补来源说明。";
  if (normalized.startsWith("data/processed/")) return "作为实验输入或绘图输入使用，续接时核查处理流程。";
  if (normalized.startsWith("references/")) return "用于相关工作和引用核查。";
  if (normalized.startsWith("outputs/")) return "用于用户验收、汇报或最终交付。";
  if (normalized.startsWith("assets/") || normalized.startsWith("figures/")) return "用于论文插图、展示或结果可视化。";
  if (type === "jsonl" || type === "log") return "用于诊断和续接判断，不要替代正式报告。";
  return "按文件描述决定是否作为下一轮输入、证据或交付物。";
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function readWordText(filePath: string) {
  if (path.extname(filePath).toLowerCase() === ".doc") {
    return "这是旧版 .doc Word 文件。当前内置预览支持 .docx 文本预览；请在系统 Word/WPS 中打开。";
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
    relativePath: row.relative_path ?? row.name,
    runRelativePath: row.run_relative_path ?? row.relative_path ?? row.name,
    description: row.description,
    previewable: Boolean(row.previewable),
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRel(value: string) {
  return value.replace(/\\/g, "/");
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
