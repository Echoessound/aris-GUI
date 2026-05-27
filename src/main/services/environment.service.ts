import { BrowserWindow, shell } from "electron";
import { execa } from "execa";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentCheckItem, EnvironmentDiagnostics, SetupActionEvent, SetupActionKind } from "../../shared/types";
import { UTF8_PROCESS_ENV } from "./encoding.service";
import { diagnoseAris } from "./executor.service";

const COMMAND_TIMEOUT_MS = 15000;

export async function diagnoseEnvironment(): Promise<EnvironmentDiagnostics> {
  const [node, pnpm, git, codex, claude, aris] = await Promise.all([
    detectCommand("Node.js", ["node"], ["--version"]),
    detectCommand("pnpm", ["pnpm.cmd", "pnpm"], ["--version"]),
    detectCommand("Git", ["git"], ["--version"]),
    detectCommand("Codex CLI", ["codex.cmd", "codex.exe", "codex"], ["--version"]),
    detectCommand("Claude Code", ["claude.cmd", "claude.exe", "claude"], ["--version"]),
    diagnoseAris()
  ]);
  const skillRoots = userSkillRoots();
  const arisSkills = detectSkills(["idea-discovery", "research-pipeline", "paper-writing"], skillRoots);
  const paperCompileSkill = detectSkills(["paper-compile"], skillRoots);
  const codexApi = Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
  const checks: EnvironmentCheckItem[] = [
    node,
    pnpm,
    git,
    codex,
    {
      id: "codex-api",
      label: "Codex API",
      status: codexApi ? "ok" : "warning",
      detail: codexApi ? "已在当前环境中检测到 API key 环境变量。" : "未在当前进程环境中检测到 API key；也可以在执行器配置里填写 OPENAI_API_KEY。"
    },
    {
      id: "aris-skills",
      label: "ARIS skills",
      status: arisSkills.found ? "ok" : "missing",
      detail: arisSkills.found ? `已检测到：${arisSkills.locations.join("；")}` : "未检测到核心 ARIS skills，可运行安装/更新动作。",
      actionKind: arisSkills.found ? undefined : "install-aris-skills"
    },
    {
      id: "paper-compile",
      label: "论文 PDF 编译能力",
      status: paperCompileSkill.found ? "ok" : "missing",
      detail: paperCompileSkill.found ? `paper-compile skill 可用：${paperCompileSkill.locations.join("；")}` : "未检测到 paper-compile skill；PDF 阶段会退回本地 LaTeX，并在报告中说明原因。",
      actionKind: paperCompileSkill.found ? undefined : "install-aris-skills"
    },
    claude,
    {
      id: "aris-cli",
      label: "ARIS CLI",
      status: aris.found ? "ok" : "warning",
      detail: aris.found ? aris.versionOutput ?? "已在 PATH 中找到 ARIS CLI。" : aris.installHint,
      actionKind: aris.found ? undefined : "open-aris-release"
    }
  ];
  const missing = checks.filter((item) => item.status === "missing").length;
  const warnings = checks.filter((item) => item.status === "warning").length;
  return {
    checkedAt: new Date().toISOString(),
    checks,
    summary: missing === 0 && warnings === 0 ? "环境已就绪。" : `发现 ${missing} 个缺失项、${warnings} 个提醒项。`,
    aris
  };
}

export async function runSetupAction(action: SetupActionKind): Promise<SetupActionEvent> {
  emitSetup({ action, type: "start", message: actionStartedText(action), timestamp: new Date().toISOString() });
  try {
    if (action === "install-aris-skills") return await runInstallArisSkills(action);
    if (action === "test-codex") return await runVersionCommand(action, "codex.cmd", ["--version"]);
    if (action === "test-git") return await runVersionCommand(action, "git", ["--version"]);
    const target = setupOpenTarget(action);
    if (target.kind === "directory") mkdirSync(target.path, { recursive: true });
    const error = target.kind === "url" ? await shell.openExternal(target.path).then(() => "") : await shell.openPath(target.path);
    if (error) throw new Error(error);
    const event: SetupActionEvent = { action, type: "done", message: `已打开：${target.path}`, exitCode: 0, timestamp: new Date().toISOString() };
    emitSetup(event);
    return event;
  } catch (error) {
    const event: SetupActionEvent = {
      action,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      timestamp: new Date().toISOString()
    };
    emitSetup(event);
    return event;
  }
}

export function hasSkill(skillName: string) {
  return detectSkills([skillName], userSkillRoots()).found;
}

function detectCommand(label: string, commands: string[], args: string[]): Promise<EnvironmentCheckItem> {
  return (async () => {
    for (const command of commands) {
      try {
        const result = await execa(command, args, { env: UTF8_PROCESS_ENV, timeout: COMMAND_TIMEOUT_MS, reject: false });
        if (result.exitCode === 0 || result.stdout || result.stderr) {
          return {
            id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            label,
            status: result.exitCode === 0 ? "ok" : "warning",
            detail: [command, result.stdout, result.stderr].filter(Boolean).join("\n")
          };
        }
      } catch {
        // Try the next executable name.
      }
    }
    return {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label,
      status: "missing",
      detail: `未在 PATH 中找到 ${label}。`,
      actionKind: label === "Git" ? "test-git" : label === "Codex CLI" ? "test-codex" : undefined
    };
  })();
}

function detectSkills(skillNames: string[], roots: string[]) {
  const locations: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const entries = new Set(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
      if (skillNames.some((name) => entries.has(name))) locations.push(root);
    } catch {
      // Ignore unreadable skill roots.
    }
  }
  return { found: locations.length > 0, locations };
}

function userSkillRoots() {
  const home = os.homedir();
  return [
    path.join(home, ".codex", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(process.cwd(), ".codex", "skills"),
    path.join(process.cwd(), ".agents", "skills"),
    path.join(process.cwd(), ".claude", "skills")
  ];
}

async function runInstallArisSkills(action: SetupActionKind) {
  const scriptPath = path.join(process.cwd(), "scripts", "install-aris-skills.ps1");
  if (!existsSync(scriptPath)) throw new Error(`未找到安装脚本：${scriptPath}`);
  const child = execa("powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
    cwd: process.cwd(),
    env: UTF8_PROCESS_ENV,
    reject: false
  });
  child.stdout?.on("data", (chunk: Buffer) => emitSetup({ action, type: "stdout", message: chunk.toString("utf8"), timestamp: new Date().toISOString() }));
  child.stderr?.on("data", (chunk: Buffer) => emitSetup({ action, type: "stderr", message: chunk.toString("utf8"), timestamp: new Date().toISOString() }));
  const result = await child;
  const event: SetupActionEvent = {
    action,
    type: result.exitCode === 0 ? "done" : "error",
    message: result.exitCode === 0 ? "ARIS skills 安装/更新完成。" : [result.stdout, result.stderr].filter(Boolean).join("\n") || "ARIS skills 安装失败。",
    exitCode: result.exitCode ?? 1,
    timestamp: new Date().toISOString()
  };
  emitSetup(event);
  return event;
}

async function runVersionCommand(action: SetupActionKind, command: string, args: string[]) {
  const result = await execa(command, args, { env: UTF8_PROCESS_ENV, timeout: COMMAND_TIMEOUT_MS, reject: false });
  const event: SetupActionEvent = {
    action,
    type: result.exitCode === 0 ? "done" : "error",
    message: [result.stdout, result.stderr].filter(Boolean).join("\n") || `${command} 退出码 ${result.exitCode}`,
    exitCode: result.exitCode ?? 1,
    timestamp: new Date().toISOString()
  };
  emitSetup(event);
  return event;
}

function setupOpenTarget(action: SetupActionKind): { path: string; kind: "file" | "directory" | "url" } {
  const home = os.homedir();
  if (action === "open-codex-config") return { path: path.join(home, ".codex"), kind: "directory" };
  if (action === "open-user-skills") return { path: path.join(home, ".codex", "skills"), kind: "directory" };
  if (action === "open-project-skills") return { path: path.join(process.cwd(), ".codex", "skills"), kind: "directory" };
  if (action === "open-readme") return { path: path.join(process.cwd(), "README.md"), kind: "file" };
  if (action === "open-aris-release") return { path: "https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep/releases", kind: "url" };
  return { path: process.cwd(), kind: "directory" };
}

function actionStartedText(action: SetupActionKind) {
  const labels: Record<SetupActionKind, string> = {
    "install-aris-skills": "开始安装/更新 ARIS skills。",
    "test-codex": "开始测试 Codex CLI。",
    "test-git": "开始测试 Git。",
    "open-codex-config": "打开 Codex 配置目录。",
    "open-user-skills": "打开用户 skills 目录。",
    "open-project-skills": "打开项目 skills 目录。",
    "open-readme": "打开 README。",
    "open-aris-release": "打开 ARIS 发布页面。"
  };
  return labels[action];
}

function emitSetup(event: SetupActionEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("environment:setup-event", event);
  }
}
