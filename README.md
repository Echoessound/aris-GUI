# ARIS Paper Studio

ARIS Paper Studio 是一个面向 Windows 的本地桌面 GUI，用来把 ARIS、Codex CLI、Claude Code 等命令行科研 workflow 包装成可配置、可运行、可追踪、可交付的论文生成工作台。

项目由 JLU 的 echosound 开发，当前版本为 `0.1.0`。

## 这个仓库包含什么

本仓库是源代码仓库，包含 Electron 主进程、React 渲染进程、SQLite 本地数据层、Git 操作服务、安装脚本和 Windows 打包配置。

它不会提交这些本地产物：

- `node_modules/`
- `dist/`
- `release/`
- `.cache/`
- `.aris-app/`
- `.aris/`
- 本地 SQLite 数据库和日志
- `.env`、`.env.*`

因此，其他用户拉取仓库后需要在自己的机器上安装依赖、构建 `dist/`，并配置 Codex/ARIS/Git 环境。

## 主要功能

- 创建和管理论文项目，记录研究主题、目标会议和说明。
- 绑定本地 Git 仓库，必要时自动 `git init`。
- 在“设置”中检查 Node/pnpm、Git、Codex CLI、Codex API、ARIS skills、Claude Code 和 `paper-compile` skill。
- 配置 Codex CLI、ARIS-Code CLI、Claude Code 或自定义执行器。
- 启动 ARIS workflow，查看运行记录、阶段进度、日志、退出状态和模型用量。
- 支持多轮自动续接，避免 run 或 Codex 对话中途失败后完全断链。
- 扫描并预览 Markdown、PDF、JSON、日志、图片、LaTeX、Word 等产物。
- 通过 `paper-compile` skill 优先生成或修复 `paper/paper.pdf`。
- 在 Codex 对话中选择模型，并按项目或指定 run 的上下文提问。
- 在 GUI 内查看 Git 状态/diff，执行 `git add .`、commit、pull、push。
- 当产物落在 ignored 目录时，生成可提交的 Git 交付包。

## 技术栈

- Electron 34
- React 19
- TypeScript
- Vite
- SQLite / `better-sqlite3`
- Ant Design
- `simple-git`
- `execa`
- `electron-builder`

## 环境要求

推荐 Windows 10/11。

必须安装：

- Node.js 22 LTS 或更新版本
- pnpm
- Git for Windows

推荐安装：

- Codex CLI，用于默认 workflow 和 Codex 对话
- ARIS skills，用于 `idea-discovery`、`research-pipeline`、`paper-writing`、`paper-compile` 等 workflow

可选安装：

- Claude Code
- ARIS-Code CLI
- 本地 LaTeX 工具链，例如 TeX Live 或 MiKTeX，用作 `paper-compile` skill 不可用时的备用路径

## 快速开始

在 PowerShell 中执行：

```powershell
git clone https://github.com/Echoessound/aris-GUI.git
cd aris-GUI

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\install.ps1
pnpm start
```

说明：

- `install.ps1` 会安装依赖、安装/更新 ARIS skills、重建 Electron 原生模块，并执行生产构建。
- `pnpm start` 会启动已构建的 Electron 应用。
- 如果没有先执行 `pnpm build` 或 `install.ps1`，`pnpm start` 可能因为缺少 `dist/main/index.cjs` 无法启动。

## 手动安装步骤

如果不想使用一键脚本，可以手动执行：

```powershell
git clone https://github.com/Echoessound/aris-GUI.git
cd aris-GUI

pnpm install
pnpm rebuild:electron
pnpm build
pnpm start
```

如果 PowerShell 拦截 `pnpm`，可以使用：

```powershell
pnpm.cmd install
pnpm.cmd rebuild:electron
pnpm.cmd build
pnpm.cmd start
```

## 开发模式

开发时使用：

```powershell
pnpm dev
```

开发模式会同时启动 Vite 和 Electron：

- Vite 默认监听 `127.0.0.1:5173`
- Electron 会读取 `VITE_DEV_SERVER_URL=http://127.0.0.1:5173`
- 渲染进程代码变更后通常会热更新
- 主进程、preload 或 IPC 变更后建议重启 `pnpm dev`

## 生产构建与启动

构建：

```powershell
pnpm build
```

构建内容：

- `pnpm typecheck`
- `vite build`
- `esbuild` 打包 Electron 主进程到 `dist/main/index.cjs`
- `esbuild` 打包 preload 到 `dist/preload/index.cjs`

启动生产构建：

```powershell
pnpm start
```

`pnpm start` 使用 Electron 读取当前目录的 `package.json`，入口是：

```text
dist/main/index.cjs
```

## 打包 Windows 发布包

执行：

```powershell
pnpm dist
```

打包产物输出到：

```text
release/
```

当前配置会生成 Windows portable/installer 相关产物。第一次打包可能较慢，因为 electron-builder 需要准备 Electron 缓存和压缩发布文件。

如果打包卡住，可以先确认普通构建可用：

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

## 安装 ARIS skills

一键安装脚本默认会安装 ARIS skills。如果只想单独安装或更新 skills：

```powershell
.\scripts\install-aris-skills.ps1 -Scope User
```

安装到某个论文项目目录：

```powershell
.\scripts\install-aris-skills.ps1 -Scope Project -TargetProject C:\path\to\paper-repo
```

同时安装用户级和项目级：

```powershell
.\scripts\install-aris-skills.ps1 -Scope Both -TargetProject C:\path\to\paper-repo
```

安装全部上游 skills：

```powershell
.\scripts\install-aris-skills.ps1 -Scope User -InstallAllSkills
```

脚本默认从这里克隆或更新 ARIS 仓库：

```text
%USERPROFILE%\.aris\Auto-claude-code-research-in-sleep
```

默认安装的核心 skills 包括：

- `idea-discovery`
- `research-refine`
- `experiment-plan`
- `experiment-bridge`
- `auto-review-loop`
- `paper-writing`
- `research-pipeline`
- `research-wiki`
- `result-to-claim`
- `paper-compile`

## Codex 配置

应用默认执行器是 Codex CLI。安装 Codex CLI 后，需要确保新 PowerShell 中可以执行：

```powershell
codex --version
```

Windows 上如果 `codex.ps1` 被执行策略拦截，应用默认使用：

```text
codex.cmd
```

可在应用内打开：

```text
设置 -> 执行器配置
```

常用环境变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `OPENAI_FALLBACK_MODELS`
- `CODEX_REASONING_EFFORT`
- `CODEX_APPROVAL_MODE`
- `CODEX_SANDBOX_MODE`

也可以在“设置 -> 快速配置向导 / 环境诊断”中检查 Codex CLI、Codex API 和 ARIS skills 是否可用。

## 第一次使用应用

1. 启动应用。
2. 进入“设置”，检查环境诊断。
3. 如果 ARIS skills 缺失，点击安装/更新 ARIS skills。
4. 如果 Codex CLI 缺失，先安装 Codex CLI 并确认 `codex --version` 可用。
5. 回到首页，新建论文项目。
6. 绑定一个本地 Git 仓库；如果目录不是 Git 仓库，应用可自动初始化。
7. 进入项目工作区，填写研究主题、目标会议和说明。
8. 选择 workflow 类型并启动。
9. 在“运行”查看阶段进度和日志。
10. 在“产物预览”查看 Markdown、PDF、LaTeX 和报告。
11. 需要 PDF 时点击“生成/修复 PDF”。
12. 在“Git 交付”查看 diff，必要时生成 Git 交付包，然后 commit/push。

## Git 交付说明

应用不会自动 commit 或 push。所有 Git 写操作都需要用户在界面中点击。

`.aris-app/runs` 是运行日志和快照目录，默认不会提交。多轮 workflow 之后，如果 Git 页面显示工作区 clean，但实际存在 ignored 产物，可以点击：

```text
生成 Git 交付包
```

应用会把最新 run 的核心 Markdown、论文文件、PDF、评审报告等复制到可追踪目录：

```text
git-delivery/
```

并生成：

```text
DELIVERY_SUMMARY.zh.md
```

然后再执行：

```text
全部暂存（git add .）
提交
Push
```

如果仓库没有 `origin`，Push 会被禁用或失败。请先手动配置：

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

应用不会自动添加远端仓库。

## 常用脚本

```powershell
pnpm dev                  # 开发模式：Vite + Electron
pnpm start                # 启动已构建的 Electron 应用
pnpm typecheck            # TypeScript 类型检查
pnpm lint                 # ESLint
pnpm check:i18n           # 检查常见残留英文 UI 文案
pnpm build                # 构建渲染进程、主进程和 preload
pnpm rebuild:electron     # 重建 Electron 原生模块 better-sqlite3
pnpm dist                 # 生成 Windows 发布包
pnpm install:windows      # 运行 scripts/install.ps1
pnpm install:aris-skills  # 运行 scripts/install-aris-skills.ps1
```

## 目录结构

```text
src/
  main/
    db/                   SQLite 初始化和迁移
    services/             项目、运行、产物、Git、执行器、Codex 对话等主进程服务
    index.ts              Electron 主进程入口和 IPC 注册
  preload/
    index.ts              安全暴露给渲染进程的 IPC API
  renderer/
    api/                  渲染进程 API 封装
    components/           React 组件
    routes/               页面
    stores/               Zustand 状态管理
    styles/               全局样式
  shared/
    types.ts              主进程和渲染进程共享类型
scripts/
  install.ps1             Windows 安装和本地验证脚本
  install-aris-skills.ps1 ARIS skills 安装/更新脚本
  check-ui-copy.mjs       UI 中文化检查脚本
```

## 本地数据位置

应用本地数据库位于：

```text
%APPDATA%\ARIS Paper Studio\app.db
```

Codex 对话和 patch 临时文件位于：

```text
%APPDATA%\ARIS Paper Studio\codex-chat-runs
%APPDATA%\ARIS Paper Studio\codex-chat-patches
```

这些是本机运行状态，不属于仓库源码。

## 故障排查

### `pnpm` 被 PowerShell 执行策略拦截

使用：

```powershell
pnpm.cmd build
```

或先执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### `pnpm start` 启动失败，提示找不到 `dist/main/index.cjs`

先构建：

```powershell
pnpm build
pnpm start
```

### `better-sqlite3` 原生模块报错

重建 Electron ABI：

```powershell
pnpm rebuild:electron
pnpm build
```

### GUI 显示 ARIS skills 未安装

运行：

```powershell
.\scripts\install-aris-skills.ps1 -Scope User
```

然后重启应用。

### Codex CLI 找不到

确认新 PowerShell 中可执行：

```powershell
codex --version
```

如果 Windows 执行策略阻止 `codex.ps1`，在应用“设置 -> 执行器配置”中把可执行文件设为：

```text
codex.cmd
```

### Git 无法 push

确认仓库有远端：

```powershell
git remote -v
```

没有远端时手动添加：

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
```

### 工作区 clean，但没有东西可提交

这通常表示产物在 `.aris-app/runs` 或其他 ignored 目录中。进入“Git 交付”，点击“生成 Git 交付包”。

### PDF 没有生成

先在“设置 -> 环境诊断”确认 `paper-compile` skill 可用。缺失时运行：

```powershell
.\scripts\install-aris-skills.ps1 -Scope User
```

如果仍失败，请检查本地 LaTeX 工具链，或查看 `paper/PDF_COMPILE_REPORT.zh.md`。

## 开发者检查清单

提交前建议执行：

```powershell
pnpm typecheck
pnpm lint
pnpm check:i18n
pnpm build
```

如果改动了 Electron 原生模块或依赖：

```powershell
pnpm rebuild:electron
pnpm build
```

如果需要发布包：

```powershell
pnpm dist
```

## 上游 ARIS

ARIS 官方仓库是：

```text
https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
```

ARIS skills 是本项目 workflow 能力的核心来源。本项目的 PowerShell 脚本是为了 Windows GUI 安装体验做的本地化包装。
