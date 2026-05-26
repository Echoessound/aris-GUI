# ARIS 论文生成本地应用开发指导文档

## 1. 项目定位

本项目要开发一个 Windows 本地桌面应用，用于把 ARIS 的命令式科研 workflow 转换为可视化、可配置、可运行、可追踪的论文生成工作台。

应用必须是真实可运行的本地应用，而不是静态前端 Demo。它需要能够绑定用户本地的 Git/GitHub 仓库，调用本地执行器运行 ARIS workflow，实时记录日志，扫描 Markdown 报告和 PDF 成果，并允许用户在应用内执行 commit 与 push。

核心目标：

- 使用 TypeScript 和现代前端框架构建。
- 应用界面以中文为主，保留 ARIS、workflow、Git、Markdown、PDF、LaTeX、CLI 等专有名词。
- 第一版面向 Windows 本地单用户。
- 真实绑定本地 Git 仓库。
- 真实执行本地 workflow 命令。
- 真实展示运行记录、Git 记录、报告和 PDF 成果。
- 支持可视化编辑 ARIS workflow 节点。

## 2. 背景依据

ARIS 仓库说明其核心不是单一平台，而是一套可迁移的科研 workflow 方法。README 中给出了多个入口 workflow，包括：

- `/idea-discovery`：Workflow 1，立题发现与方法细化。
- `/experiment-bridge`：Workflow 1.5，将实验计划落成代码并运行。
- `/auto-review-loop`：Workflow 2，自动审稿、修复、再审稿。
- `/paper-writing`：Workflow 3，从 `NARRATIVE_REPORT.md` 生成论文与 PDF。
- `/research-pipeline`：完整流程，串联 Workflow 1、1.5、2、3。
- `/research-wiki init`：启用跨会话研究记忆。

参考资料：

- GitHub 仓库：https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
- README 原始文件：https://raw.githubusercontent.com/wanshuiyin/Auto-claude-code-research-in-sleep/main/README.md

## 3. 产品范围

### 3.1 第一版必须完成

第一版应完成从项目创建到报告产出的本地闭环：

1. 打开 Windows 桌面应用。
2. 新建论文项目。
3. 绑定一个本地 Git/GitHub 仓库。
4. 配置研究主题、目标会议、执行器和 workflow。
5. 点击按钮启动真实 ARIS workflow。
6. 实时显示运行日志。
7. 运行完成后扫描并展示 Markdown 报告和 PDF。
8. 查看本轮 Git diff。
9. 在应用中输入 commit message 并执行 commit。
10. 在应用中执行 push。
11. 在运行记录中回看每一轮日志、产物和 Git 事件。

### 3.2 第一版不做

第一版暂不实现：

- 多用户账号系统。
- 云端任务队列。
- Web 远程访问。
- 团队协作批注。
- 远程 GPU 调度的完整平台化管理。
- 在线支付或配额系统。
- 自动投稿系统。

这些能力可以在本地闭环稳定后作为第二、第三阶段扩展。

## 4. 技术选型

### 4.1 总体架构

推荐使用：

- 桌面壳层：Electron
- 前端框架：React
- 语言：TypeScript
- 构建工具：Vite
- UI 组件库：Ant Design 或 Arco Design
- 状态管理：Zustand
- 路由：React Router
- workflow 图编辑：React Flow
- Markdown 预览：react-markdown + remark-gfm
- PDF 预览：浏览器 iframe 或 PDF.js
- 图表展示：ECharts
- 代码和 LaTeX 预览：Monaco Editor
- 本地数据库：SQLite
- Git 操作：simple-git
- 命令执行：Node child_process 或 execa
- 日志流：Electron IPC + 事件订阅
- Windows 打包：electron-builder

### 4.2 为什么选择 Electron

普通浏览器前端无法稳定完成以下任务：

- 选择并持久访问本地目录。
- 读取 Git 仓库状态。
- 执行本地 CLI 命令。
- 管理长时间运行的进程。
- 扫描本地文件产物。
- 调用 commit 和 push。

Electron 可以保留 TypeScript 前端体验，同时通过主进程访问 Windows 本地文件系统、Git 和命令行。

## 5. 系统架构

```text
┌────────────────────────────────────────────┐
│ React + TypeScript 渲染进程                 │
│                                            │
│ 首页 / 项目详情 / Workflow 编辑 / 成果预览   │
│ 状态管理 / UI 交互 / 日志展示                │
└─────────────────────┬──────────────────────┘
                      │ Electron IPC
┌─────────────────────▼──────────────────────┐
│ Electron 主进程                              │
│                                            │
│ 文件系统 / SQLite / Git / 执行器 / 任务队列   │
│ 本地仓库绑定 / 产物扫描 / 日志事件分发         │
└─────────────────────┬──────────────────────┘
                      │
┌─────────────────────▼──────────────────────┐
│ 本地项目工作区                               │
│                                            │
│ Git 仓库 / ARIS 文件 / Markdown / PDF / 日志 │
└────────────────────────────────────────────┘
```

## 6. 目录结构建议

```text
aris-paper-studio/
  package.json
  vite.config.ts
  tsconfig.json
  electron-builder.yml
  src/
    main/
      index.ts
      ipc/
        project.ipc.ts
        repository.ipc.ts
        executor.ipc.ts
        workflow.ipc.ts
        artifact.ipc.ts
      services/
        project.service.ts
        repository.service.ts
        executor.service.ts
        workflow.service.ts
        artifact.service.ts
        run.service.ts
        git.service.ts
        settings.service.ts
      db/
        database.ts
        migrations/
          001_init.sql
      workers/
        run-worker.ts
      utils/
        windows-path.ts
        process-env.ts
    preload/
      index.ts
    renderer/
      main.tsx
      App.tsx
      routes/
        HomePage.tsx
        ProjectDetailPage.tsx
        WorkflowPage.tsx
        SettingsPage.tsx
      components/
        ProjectList.tsx
        ProjectWorkspace.tsx
        RunTimeline.tsx
        ArtifactPreview.tsx
        GitPanel.tsx
        WorkflowGraph.tsx
        ExecutorForm.tsx
        LogViewer.tsx
      stores/
        projectStore.ts
        runStore.ts
        workflowStore.ts
      api/
        electronApi.ts
      styles/
        app.css
  docs/
    DEVELOPMENT_GUIDE.md
```

如果项目从当前目录开始开发，本文档可以放在根目录。后续可以复制到 `docs/DEVELOPMENT_GUIDE.md`。

## 7. 应用页面设计

### 7.1 首页：项目列表

首页是应用的默认入口，不做营销页，不做无用说明。第一屏直接展示项目列表。

必须展示：

- 项目名称
- 研究主题
- 本地仓库路径
- 当前状态
- 当前 workflow
- 最近运行时间
- 已运行轮数
- Git 分支
- Git 同步状态
- 最新 Markdown 报告状态
- 最新 PDF 状态

必须提供操作：

- 新建项目
- 绑定本地仓库
- 打开项目详情
- 搜索项目
- 按状态筛选
- 归档项目

项目状态建议：

- `draft`：未启动
- `ready`：已配置，可运行
- `running`：运行中
- `waiting_approval`：等待人工确认
- `failed`：运行失败
- `completed`：运行完成
- `archived`：已归档

### 7.2 项目详情页

项目详情页分为三个核心区域：

1. 项目的工作区
2. 项目的运行记录区
3. 项目的成果区

推荐使用 Tabs 或左右分栏布局。对于第一版，Tabs 更稳定。

#### 7.2.1 工作区

工作区用于编辑项目基础信息和启动 workflow。

字段：

- 项目名称
- 研究主题
- 研究方向描述
- 目标会议或期刊
- 目标产物类型：Markdown 报告、PDF
- 绑定仓库路径
- 当前 Git 分支
- 默认执行器
- 默认 workflow
- effort 配置
- assurance 配置
- 是否启用 human checkpoint
- 是否 auto proceed
- 是否启用 research-wiki

启动按钮：

- 启动完整 research-pipeline
- 仅启动 idea-discovery
- 仅启动 experiment-bridge
- 仅启动 auto-review-loop
- 仅启动 paper-writing
- 从失败节点继续

每个启动按钮必须先进行运行前检查：

- 仓库路径存在。
- 仓库是有效 Git 仓库。
- 工作区可写。
- 执行器配置有效。
- 必要命令可找到。
- 如果要生成 PDF，则检查 LaTeX 环境或给出明确提醒。
- 当前是否已有运行中任务。

#### 7.2.2 运行记录区

运行记录区用于记录项目运行了几轮，以及每轮在 Git 上发生了什么。

必须展示：

- run id
- 第几轮
- workflow 类型
- 启动时间
- 结束时间
- 状态
- 当前节点
- 日志摘要
- 错误信息
- 产物数量
- Git diff 摘要
- commit hash
- push 状态

每个 run 展开后展示 run steps：

- 节点名称
- 节点命令
- 开始时间
- 结束时间
- stdout
- stderr
- 输入文件
- 输出文件
- 是否需要人工确认
- 失败策略

#### 7.2.3 成果区

成果区展示循环推理生成的所有报告、报表和论文产物。

第一版必须支持：

- Markdown 报告预览
- PDF 预览
- JSON 报表查看
- 图片查看
- 普通文本日志查看

成果分类建议：

- 立题报告
- 实验计划
- 运行结果
- 审稿意见
- 修改记录
- 论文草稿
- 最终 PDF
- 审计报告

典型文件名：

- `IDEA_REPORT.md`
- `FINAL_PROPOSAL.md`
- `EXPERIMENT_PLAN.md`
- `NARRATIVE_REPORT.md`
- `PAPER_PLAN.md`
- `AUTO_REVIEW.md`
- `FINAL_REPORT.md`
- `paper.pdf`

### 7.3 Workflow 结构页

Workflow 结构页根据 ARIS workflow 创建可编辑结构页面。

默认图结构：

```text
research-lit
  ↓
idea-creator
  ↓
novelty-check
  ↓
research-refine
  ↓
experiment-plan
  ↓
experiment-bridge
  ↓
auto-review-loop
  ↓
paper-plan
  ↓
paper-figure
  ↓
paper-write
  ↓
paper-compile
  ↓
auto-paper-improvement-loop
```

可选审计节点：

- citation-audit
- paper-claim-audit
- proof-checker
- experiment-audit
- kill-argument

用户必须能够：

- 添加节点
- 删除节点
- 修改节点名称
- 修改节点命令
- 修改节点参数
- 修改输入文件
- 修改输出文件
- 启用或禁用节点
- 设置失败后停止或继续
- 设置是否需要人工确认
- 修改节点依赖关系

## 8. 执行器设计

### 8.1 执行器目标

用户要求所有执行器都预留。因此应用不能把某一个工具写死。

第一版必须支持统一执行器接口：

- ARIS-Code CLI
- Claude Code
- Codex CLI
- Custom command

### 8.2 类型定义

```ts
export type ExecutorKind =
  | "aris-code"
  | "claude-code"
  | "codex-cli"
  | "custom";

export interface ExecutorConfig {
  id: string;
  name: string;
  kind: ExecutorKind;
  executablePath: string;
  defaultArgs: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface ExecuteRequest {
  projectId: string;
  runId: string;
  executorId: string;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ExecuteEvent {
  runId: string;
  stepId?: string;
  type: "start" | "stdout" | "stderr" | "exit" | "error";
  message: string;
  exitCode?: number;
  timestamp: string;
}
```

### 8.3 命令拼接原则

命令拼接必须安全：

- 不把用户输入直接拼接成完整 shell 字符串。
- 使用 `spawn` 或 `execa` 的参数数组形式。
- cwd 必须限制在用户绑定的项目仓库或明确授权目录内。
- 环境变量需要经过白名单或明确配置。
- 日志中不得默认展示 API Key。

### 8.4 Workflow 命令模板

示例：

```ts
export interface WorkflowCommandTemplate {
  workflowType:
    | "research-pipeline"
    | "idea-discovery"
    | "experiment-bridge"
    | "auto-review-loop"
    | "paper-writing"
    | "custom";
  displayName: string;
  command: string;
  argsTemplate: string[];
}
```

对于 Claude Code 风格命令，实际输入可能是交互式文本，例如：

```text
/research-pipeline "研究方向" --effort: balanced --auto proceed: true
```

应用第一版可以采用两种策略：

1. 对 ARIS-Code CLI 走直接参数调用。
2. 对 Claude Code、Codex CLI、自定义执行器，提供可编辑命令模板，由用户确认后运行。

## 9. Git 绑定与操作

### 9.1 仓库绑定流程

1. 用户选择本地文件夹。
2. 应用检查是否存在 `.git`。
3. 如果是 Git 仓库，读取仓库信息。
4. 如果不是 Git 仓库，提示用户：
   - 初始化 Git 仓库。
   - 重新选择目录。
   - 取消绑定。
5. 应用保存仓库路径到项目配置。

### 9.2 必须读取的信息

- 仓库根目录
- 当前分支
- remote 列表
- origin URL
- 最近 commit
- working tree 状态
- staged 文件
- unstaged 文件
- untracked 文件
- 是否 ahead/behind

### 9.3 应用内 Git 操作

第一版必须提供：

- 查看 diff 摘要
- stage all
- commit
- push
- 查看 commit 历史

可以暂缓：

- 分支切换
- merge
- rebase
- conflict resolver
- pull request 创建

### 9.4 Git 事件记录

每次运行结束后，应用应生成 Git 快照：

- 运行前 commit hash
- 运行后 commit hash
- 变更文件列表
- 新增文件列表
- 删除文件列表
- diff 统计
- 是否已 commit
- 是否已 push

## 10. 数据库设计

第一版使用 SQLite。数据库文件建议放在：

```text
%APPDATA%/ARIS Paper Studio/app.db
```

### 10.1 projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,
  description TEXT,
  target_venue TEXT,
  repository_id TEXT,
  default_executor_id TEXT,
  default_workflow_id TEXT,
  status TEXT NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.2 repositories

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  branch TEXT,
  remote_origin TEXT,
  last_commit_hash TEXT,
  is_dirty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.3 executor_configs

```sql
CREATE TABLE executor_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  default_args_json TEXT NOT NULL,
  env_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.4 workflow_templates

```sql
CREATE TABLE workflow_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.5 workflow_nodes

```sql
CREATE TABLE workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_template_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  input_files_json TEXT,
  output_files_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  failure_policy TEXT NOT NULL DEFAULT 'stop',
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.6 workflow_edges

```sql
CREATE TABLE workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_template_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL
);
```

### 10.7 runs

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workflow_template_id TEXT,
  executor_id TEXT,
  status TEXT NOT NULL,
  current_node_id TEXT,
  round_index INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  error_message TEXT
);
```

### 10.8 run_steps

```sql
CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT,
  status TEXT NOT NULL,
  command TEXT,
  args_json TEXT,
  stdout_path TEXT,
  stderr_path TEXT,
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  error_message TEXT
);
```

### 10.9 artifacts

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  previewable INTEGER NOT NULL DEFAULT 1,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.10 git_events

```sql
CREATE TABLE git_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  event_type TEXT NOT NULL,
  branch TEXT,
  commit_hash TEXT,
  commit_message TEXT,
  remote TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL
);
```

## 11. IPC/API 设计

渲染进程不能直接访问 Node API，必须通过 preload 暴露安全接口。

### 11.1 preload API

```ts
export interface ArisAppApi {
  projects: {
    list(): Promise<Project[]>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: string, input: UpdateProjectInput): Promise<Project>;
    archive(id: string): Promise<void>;
  };
  repositories: {
    chooseDirectory(): Promise<string | null>;
    inspect(path: string): Promise<RepositoryInspection>;
    bind(projectId: string, path: string): Promise<Repository>;
    status(repositoryId: string): Promise<GitStatus>;
    commit(repositoryId: string, message: string): Promise<GitCommitResult>;
    push(repositoryId: string): Promise<GitPushResult>;
  };
  runs: {
    start(input: StartRunInput): Promise<Run>;
    stop(runId: string): Promise<void>;
    list(projectId: string): Promise<Run[]>;
    get(runId: string): Promise<RunDetail>;
    onEvent(callback: (event: ExecuteEvent) => void): () => void;
  };
  artifacts: {
    list(projectId: string): Promise<Artifact[]>;
    readText(artifactId: string): Promise<string>;
    getFileUrl(artifactId: string): Promise<string>;
    rescan(projectId: string): Promise<Artifact[]>;
  };
  workflows: {
    listTemplates(): Promise<WorkflowTemplate[]>;
    getTemplate(id: string): Promise<WorkflowTemplateDetail>;
    saveTemplate(input: SaveWorkflowTemplateInput): Promise<WorkflowTemplateDetail>;
  };
  executors: {
    list(): Promise<ExecutorConfig[]>;
    save(input: SaveExecutorInput): Promise<ExecutorConfig>;
    test(id: string): Promise<ExecutorTestResult>;
  };
}
```

### 11.2 IPC 命名规范

使用清晰的 channel 名称：

```text
project:list
project:create
repository:choose-directory
repository:inspect
repository:bind
repository:status
repository:commit
repository:push
run:start
run:stop
run:event
artifact:list
artifact:read-text
artifact:file-url
workflow:get
workflow:save
executor:list
executor:test
```

## 12. 任务运行机制

### 12.1 Run 生命周期

```text
pending → running → waiting_approval → running → completed
                    ↘ failed
                    ↘ cancelled
```

### 12.2 启动流程

1. 前端提交 StartRunInput。
2. 主进程检查项目、仓库、执行器、workflow。
3. 创建 runs 记录。
4. 创建 run_steps 记录。
5. 启动 worker。
6. worker 使用执行器运行命令。
7. stdout/stderr 写入日志文件。
8. 同时通过 IPC 推送日志事件。
9. 每个节点结束后更新 run_steps。
10. 整个 run 结束后扫描 artifacts。
11. 读取 Git diff 并创建 git_events。
12. 更新项目状态和 run_count。

### 12.3 日志文件位置

建议每个项目工作区内创建：

```text
.aris-app/
  project.json
  runs/
    run-20260526-001/
      stdout.log
      stderr.log
      events.jsonl
      git-before.json
      git-after.json
      artifacts.json
```

应用自己的数据库仍放在 `%APPDATA%`，但项目相关可迁移状态放在仓库内 `.aris-app/`。

## 13. 成果扫描规则

运行结束后扫描以下路径：

```text
.
paper/
figures/
outputs/
results/
refine-logs/
review-logs/
.aris/
.aris-app/runs/
```

按扩展名识别：

- `.md`：Markdown
- `.pdf`：PDF
- `.json`：JSON
- `.jsonl`：JSONL
- `.png`、`.jpg`、`.jpeg`、`.webp`、`.svg`：图片
- `.tex`：LaTeX
- `.txt`、`.log`：文本日志

优先级最高的成果：

- 最新 Markdown 报告
- 最新 PDF
- 最新审计报告
- 最新运行日志

## 14. 配置设计

### 14.1 全局配置

全局配置存储在：

```text
%APPDATA%/ARIS Paper Studio/settings.json
```

内容：

```json
{
  "language": "zh-CN",
  "defaultExecutorId": "executor-aris",
  "defaultArtifactGlobs": [
    "**/*.md",
    "**/*.pdf",
    "**/*.json",
    "**/*.png"
  ],
  "redactEnvKeys": ["API_KEY", "TOKEN", "SECRET"],
  "terminalEncoding": "utf8"
}
```

### 14.2 项目配置

项目配置存储在仓库内：

```text
.aris-app/project.json
```

内容：

```json
{
  "projectId": "project-id",
  "name": "项目名称",
  "topic": "研究主题",
  "targetVenue": "NeurIPS",
  "defaultWorkflow": "research-pipeline",
  "defaultExecutor": "aris-code",
  "outputs": {
    "primaryMarkdown": "NARRATIVE_REPORT.md",
    "primaryPdf": "paper/paper.pdf"
  }
}
```

## 15. Windows 开发注意事项

第一版按 Windows 实现，必须考虑：

- 路径可能包含中文。
- 路径可能包含空格。
- 不要手动拼接路径字符串，使用 Node `path` API。
- 命令执行时使用参数数组。
- PowerShell 执行策略可能阻止 `.ps1`，优先调用 `.cmd` 或 `.exe`。
- 需要处理 CRLF。
- PDF/LaTeX 工具可能不在 PATH。
- Git 可能安装在不同目录。
- 执行器路径允许用户手动指定。

## 16. 安全要求

### 16.1 文件系统安全

- 应用只读写用户绑定的项目仓库、`.aris-app` 目录和应用配置目录。
- 删除文件必须二次确认。
- 不提供任意路径批量删除。
- 产物扫描必须限制在项目仓库内。

### 16.2 命令执行安全

- 执行命令前展示将要执行的 workflow 和工作目录。
- 自定义命令必须由用户显式保存。
- 日志中隐藏敏感环境变量。
- 运行中允许停止任务。
- 禁止默认自动执行 destructive Git 命令，例如 reset、clean、force push。

### 16.3 Git 安全

- commit 和 push 必须由用户点击触发。
- push 前展示 remote 和 branch。
- 不做 force push。
- 如果 working tree 有冲突，禁止继续自动 commit。

## 17. 默认 Workflow 模板

第一版预置 5 个模板。

### 17.1 完整论文生成

```text
research-pipeline
```

用途：从研究方向到 Markdown 报告和 PDF 的端到端流程。

### 17.2 立题发现

```text
idea-discovery
```

用途：生成选题、调研、创新点和实验计划。

### 17.3 实验桥接

```text
experiment-bridge
```

用途：根据实验计划生成代码、运行初步实验、收集结果。

### 17.4 自动审稿循环

```text
auto-review-loop
```

用途：对已有结果或论文草稿进行多轮审稿与修复。

### 17.5 论文写作

```text
paper-writing
```

用途：从 `NARRATIVE_REPORT.md` 生成论文结构、LaTeX 和 PDF。

## 18. UI 文案规范

应用以中文为主。

推荐文案：

- 新建项目
- 绑定本地仓库
- 启动完整流程
- 从失败处继续
- 查看运行日志
- 扫描成果
- 预览报告
- 预览 PDF
- 查看 Git 变更
- 提交到 Git
- 推送到远程仓库
- 等待人工确认
- 执行器配置
- Workflow 结构

状态文案：

- 未配置
- 可运行
- 运行中
- 等待确认
- 已失败
- 已完成
- 已提交
- 已推送

## 19. 视觉与交互要求

这是工作台型产品，不做营销落地页。

设计原则：

- 信息密度适中，适合长时间工作。
- 首页直接展示项目列表。
- 项目详情页优先保证可扫描性。
- 运行日志使用等宽字体。
- Git diff 使用增删颜色区分。
- workflow 图节点尺寸稳定，不因文案变化跳动。
- 按钮文字不能溢出。
- 图标按钮应有 tooltip。
- 错误状态必须明确，不只用颜色表达。

## 20. 开发里程碑

### 阶段 1：项目骨架

目标：

- 搭建 Electron + React + TypeScript + Vite。
- 完成主进程、preload、渲染进程通信。
- 完成基础路由和 UI 框架。

验收：

- Windows 上能启动桌面窗口。
- 首页能显示 mock 项目列表。
- preload API 能成功调用主进程。

### 阶段 2：项目与仓库绑定

目标：

- 实现 SQLite。
- 实现项目 CRUD。
- 实现选择本地目录。
- 实现 Git 仓库检测。

验收：

- 能新建项目。
- 能绑定本地 Git 仓库。
- 能显示 branch、remote、dirty 状态。

### 阶段 3：项目详情页

目标：

- 实现工作区。
- 实现运行记录区。
- 实现成果区。

验收：

- 能编辑项目基础信息。
- 能展示运行记录列表。
- 能扫描并展示 Markdown 和 PDF。

### 阶段 4：执行器与真实运行

目标：

- 实现执行器配置。
- 实现命令运行。
- 实现日志流。
- 实现 run/run_step 状态机。

验收：

- 能配置至少一个执行器。
- 能在绑定仓库目录下运行命令。
- 能实时看到 stdout/stderr。
- 运行结束后能看到产物刷新。

### 阶段 5：Git commit/push

目标：

- 实现 diff 查看。
- 实现 stage all。
- 实现 commit。
- 实现 push。
- 记录 git_events。

验收：

- 能查看变更文件。
- 能输入 commit message。
- 能在应用内 commit。
- 能在应用内 push。
- 运行记录能关联 commit hash。

### 阶段 6：Workflow 编辑器

目标：

- 实现 React Flow 图编辑。
- 实现节点增删改。
- 实现节点参数编辑。
- 实现模板保存。

验收：

- 能看到默认 ARIS workflow。
- 能添加、删除、修改节点。
- 能保存 workflow 模板。
- 能选择模板启动运行。

### 阶段 7：打包与稳定化

目标：

- Windows 打包。
- 错误处理。
- 日志导出。
- 基础测试。

验收：

- 能生成 Windows 安装包或便携包。
- 常见错误有中文提示。
- 用户可以导出运行日志。

## 21. 测试计划

### 21.1 单元测试

覆盖：

- 路径处理
- workflow 模板解析
- artifact 类型识别
- executor 参数生成
- Git 状态解析

### 21.2 集成测试

覆盖：

- 创建项目
- 绑定 Git 仓库
- 启动 mock 执行器
- 写入日志
- 扫描成果
- commit

### 21.3 手动验收测试

Windows 上执行：

1. 安装应用。
2. 创建项目。
3. 绑定本地 GitHub 仓库。
4. 配置 custom 执行器。
5. 执行一个能生成 Markdown 和 PDF 的测试命令。
6. 查看成果预览。
7. commit。
8. push。

## 22. 后续扩展方向

第二阶段：

- 接入更完整的 ARIS-Code CLI 参数。
- 支持 research-wiki 可视化。
- 支持运行中人工确认点。
- 支持 LaTeX 编译诊断。
- 支持 PDF 页面级预览和下载。

第三阶段：

- 支持 macOS/Linux。
- 支持远程服务器执行。
- 支持 GPU 任务队列。
- 支持 Feishu/Lark 通知。
- 支持团队协作和批注。
- 支持投稿前审计闸门。

## 23. 第一版完成定义

当以下事项全部满足时，第一版可以认为完成：

- 应用是 Windows 可运行桌面应用。
- 首页显示真实项目列表。
- 项目可绑定本地 Git 仓库。
- 应用可读取 Git 状态。
- 应用可配置执行器。
- 应用可启动真实本地命令。
- 应用可实时显示日志。
- 应用可扫描 Markdown 和 PDF 成果。
- 应用可预览 Markdown 和 PDF。
- 应用可查看 diff。
- 应用可 commit。
- 应用可 push。
- 应用可展示 ARIS workflow 结构。
- 应用可编辑 workflow 节点。

第一版的核心不是做很多功能，而是跑通一个可信闭环：本地项目、真实执行、真实产物、真实 Git。
