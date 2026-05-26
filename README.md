# ARIS Paper Studio

ARIS Paper Studio 是一个 Windows 本地桌面 GUI，用来把 ARIS、Codex CLI、Claude Code 等命令行科研 workflow 包装成可配置、可运行、可追踪的论文生成工作台。

它基于 Electron、React、TypeScript、Vite、SQLite 和 simple-git。目标是把本地仓库绑定、workflow 执行、日志追踪、Markdown/PDF 产物预览、Git diff/commit/push 放进同一个桌面应用里。

## 功能

- 创建和管理论文项目，记录研究主题、目标会议和描述。
- 绑定本地 Git 仓库，必要时自动初始化。
- 配置 Codex CLI、ARIS-Code CLI、Claude Code 或自定义执行器。
- 启动 ARIS workflow，并查看运行记录、日志和退出状态。
- 扫描并预览 Markdown、PDF、JSON、日志、图片和 LaTeX 产物。
- 在 GUI 内查看 Git 状态/diff，执行 stage、commit 和 push。
- GUI 启动时自动诊断 ARIS CLI、Codex/Claude 执行器和 ARIS skills 是否可用。

## 环境要求

- Windows 10/11
- Node.js 20 LTS 或更新版本
- pnpm
- Git for Windows
- 可选：Codex CLI、Claude Code、ARIS-Code CLI

## 一键安装

在 PowerShell 中进入项目目录：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\install.ps1
```

安装脚本会：

- 检查 Node.js 和 pnpm。
- 执行 `pnpm install`。
- 克隆或更新 ARIS 官方 skill 仓库。
- 默认把 ARIS skills 安装到当前用户的 `.codex/skills`，并同步到 `.claude/skills`。
- 重建 Electron 原生模块 `better-sqlite3`。
- 执行 `pnpm build` 验证生产构建。

常用参数：

```powershell
.\scripts\install.ps1 -SkipBuild
.\scripts\install.ps1 -SkipElectronRebuild
.\scripts\install.ps1 -SkipArisSkills
.\scripts\install.ps1 -ArisSkillScope Both
```

## 单独安装 ARIS Skills

如果其他人已经安装过项目依赖，但 Codex/Claude 没有 ARIS skills，可以单独运行：

```powershell
.\scripts\install-aris-skills.ps1 -Scope User
```

把 skills 安装到某个论文项目的本地目录：

```powershell
.\scripts\install-aris-skills.ps1 -Scope Project -TargetProject C:\path\to\paper-repo
```

同时安装用户级和项目级：

```powershell
.\scripts\install-aris-skills.ps1 -Scope Both -TargetProject C:\path\to\paper-repo
```

脚本会优先使用 ARIS 仓库中的 `skills/skills-codex` 作为 Codex skill 源；如果上游目录不存在，则回退到 `skills`。默认只安装 ARIS workflow 常用核心 skills；如需全量同步上游 skills，可加 `-InstallAllSkills`。

安装方式采用合并复制，避免 Windows 上创建符号链接需要额外权限，也不会删除用户已有的其他 skills。

## 开发运行

```powershell
pnpm dev
```

开发模式会同时启动 Vite 和 Electron。窗口打开后，首页顶部会自动显示启动诊断结果。

## 打包

```powershell
pnpm dist
```

打包产物输出到 `release/`。

## 常用脚本

```powershell
pnpm dev                # 开发模式
pnpm typecheck          # TypeScript 类型检查
pnpm lint               # ESLint
pnpm build              # 渲染进程和主进程构建
pnpm rebuild:electron   # 重建 Electron 原生模块
pnpm dist               # 生成 Windows 发布包
pnpm install:windows    # 运行 scripts/install.ps1
pnpm install:aris-skills # 运行 scripts/install-aris-skills.ps1
```

## 目录结构

```text
src/
  main/       Electron 主进程、SQLite、Git、执行器和运行服务
  preload/    安全暴露给渲染进程的 IPC API
  renderer/   React 页面、组件、样式和状态管理
  shared/     主进程与渲染进程共享类型
scripts/
  install.ps1             Windows 安装和本地验证脚本
  install-aris-skills.ps1 ARIS skills 安装/更新脚本
```

## 故障排查

- `pnpm` 在 PowerShell 中被执行策略拦截：使用 `pnpm.cmd`，或先运行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`。
- `better-sqlite3` 报原生模块错误：运行 `pnpm rebuild:electron`。
- GUI 显示 ARIS skills 未安装：运行 `.\scripts\install-aris-skills.ps1 -Scope User` 后重启 GUI。
- ARIS CLI 未找到：确认 `aris.exe` 所在目录已经加入 `PATH`。
- Codex/Claude 执行器未找到：确认对应 CLI 已安装并在新 PowerShell 中可执行。

## 上游 ARIS

ARIS 官方仓库是 [wanshuiyin/Auto-claude-code-research-in-sleep](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep)。官方 README 说明 ARIS 是一组 Markdown-only skills，并提供 `install_aris_codex.sh`、`smart_update_codex.sh` 等 Codex 安装/更新路径。本项目的 PowerShell 脚本是为了 Windows GUI 安装体验做的本地化包装。
