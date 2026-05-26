import { BrowserWindow } from "electron";
import { execa } from "execa";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAppDataDir, getDb, id, nowIso } from "../db/database";
import type { CodexChatEvent, CodexChatMessage, CodexChatSendInput, CodexEditPreview } from "../../shared/types";
import { appendUtf8Guidance, decodeTextBuffer, UTF8_PROCESS_ENV } from "./encoding.service";
import { getExecutor } from "./executor.service";
import { getProject } from "./project.service";

const CHAT_TIMEOUT_MS = 300000;

export function listCodexChatMessages(projectId: string): CodexChatMessage[] {
  const rows = getDb()
    .prepare("SELECT * FROM codex_chat_messages WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as any[];
  return rows.map(mapMessage);
}

export async function sendCodexChat(input: CodexChatSendInput): Promise<CodexChatMessage> {
  const project = getProject(input.projectId);
  if (!project.repository?.path) throw new Error("项目尚未绑定 Git 仓库，无法启动 Codex 对话");
  const stamp = nowIso();
  const userId = id("chat");
  const assistantId = id("chat");
  getDb().prepare(
    `INSERT INTO codex_chat_messages (id, project_id, role, mode, content, status, edit_status, created_at)
     VALUES (?, ?, 'user', ?, ?, 'completed', 'none', ?)`
  ).run(userId, project.id, input.mode, input.message, stamp);

  const prompt = input.mode === "edit"
    ? buildEditPrompt(input.message)
    : buildAskPrompt(input.message);
  getDb().prepare(
    `INSERT INTO codex_chat_messages (id, project_id, role, mode, content, status, edit_status, created_at)
     VALUES (?, ?, 'assistant', ?, ?, 'running', ?, ?)`
  ).run(assistantId, project.id, input.mode, "Codex 正在处理请求...", "none", nowIso());

  runCodexChat(project.id, project.repository.path, assistantId, input.mode, prompt).catch((error) => {
    finalizeCodexChat(project.id, assistantId, input.mode, false, "", error instanceof Error ? error.message : String(error));
  });
  return getMessage(assistantId);
}

export function previewCodexEdit(messageId: string): CodexEditPreview {
  const message = getMessage(messageId);
  if (message.mode !== "edit") throw new Error("该消息不是修改预览");
  if (message.status === "running") throw new Error("Codex 仍在生成 diff，请稍等");
  if (!message.patchText?.trim()) throw new Error("Codex 没有返回可应用的 unified diff");
  return {
    messageId,
    patchText: message.patchText,
    summary: summarizePatch(message.patchText),
    status: message.editStatus
  };
}

export async function applyCodexEdit(messageId: string): Promise<CodexChatMessage> {
  const message = getMessage(messageId);
  if (message.mode !== "edit") throw new Error("该消息不是修改预览");
  if (message.status === "running") throw new Error("Codex 仍在生成 diff，请稍等");
  if (message.editStatus === "applied") return message;
  if (!message.patchText?.trim()) throw new Error("Codex 没有返回可应用的 unified diff");
  const project = getProject(message.projectId);
  if (!project.repository?.path) throw new Error("项目尚未绑定 Git 仓库");

  const patchDir = path.join(getAppDataDir(), "codex-chat-patches");
  mkdirSync(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, `${messageId}.patch`);
  writeFileSync(patchPath, message.patchText, "utf8");
  const result = await execa("git", ["apply", "--whitespace=nowarn", patchPath], {
    cwd: project.repository.path,
    reject: false
  });
  const status = result.exitCode === 0 ? "applied" : "failed";
  const error = result.exitCode === 0 ? null : result.stderr || result.stdout || `git apply exited ${result.exitCode}`;
  getDb().prepare("UPDATE codex_chat_messages SET edit_status = ?, error_message = ? WHERE id = ?").run(status, error, messageId);
  getDb().prepare(
    `INSERT INTO git_events (id, project_id, event_type, summary_json, created_at)
     VALUES (?, ?, 'codex_chat_apply', ?, ?)`
  ).run(id("git-event"), project.id, JSON.stringify({ messageId, status, error }), nowIso());
  return getMessage(messageId);
}

async function runCodexChat(projectId: string, repoPath: string, messageId: string, mode: CodexChatSendInput["mode"], prompt: string) {
  const executor = getExecutor("executor-codex");
  let stdout = "";
  let stderr = "";
  emitCodexChatEvent({ projectId, messageId, type: "started", message: "Codex 已启动", timestamp: nowIso() });
  try {
    const child = execa(executor.executablePath, ["exec", "-C", repoPath, "--skip-git-repo-check", "--sandbox", "read-only", prompt], {
      cwd: repoPath,
      env: { ...UTF8_PROCESS_ENV, ...(executor.env ?? {}) },
      stdin: "ignore",
      reject: false,
      timeout: CHAT_TIMEOUT_MS
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      const delta = decodeTextBuffer(chunk);
      stdout += delta;
      emitCodexChatEvent({ projectId, messageId, type: "stdout", delta, timestamp: nowIso() });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const delta = decodeTextBuffer(chunk);
      stderr += delta;
      emitCodexChatEvent({ projectId, messageId, type: "stderr", delta, timestamp: nowIso() });
    });
    const result = await child;
    if (!stdout && result.stdout) stdout = result.stdout;
    if (!stderr && result.stderr) stderr = result.stderr;
    finalizeCodexChat(projectId, messageId, mode, result.exitCode === 0, stdout, stderr || (result.exitCode === 0 ? "" : `codex exited ${result.exitCode}`));
  } catch (error) {
    finalizeCodexChat(projectId, messageId, mode, false, stdout, stderr || (error instanceof Error ? error.message : String(error)));
  }
}

function finalizeCodexChat(projectId: string, messageId: string, mode: CodexChatSendInput["mode"], ok: boolean, stdout: string, stderr: string) {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n").trim();
  const content = ok
    ? combined || "Codex 没有返回内容。"
    : `Codex 对话执行失败：${combined || "没有捕获到错误输出。"}`;
  const patchText = mode === "edit" && ok ? extractPatch(content) : null;
  const editStatus = mode === "edit" ? (patchText ? "preview" : "failed") : "none";
  const status = ok ? "completed" : "failed";
  const errorMessage = ok ? (mode === "edit" && !patchText ? "Codex 没有返回可应用的 unified diff" : null) : content;
  getDb().prepare(
    "UPDATE codex_chat_messages SET content = ?, status = ?, patch_text = ?, edit_status = ?, error_message = ? WHERE id = ?"
  ).run(content, status, patchText, editStatus, errorMessage, messageId);
  const payload = getMessage(messageId);
  emitCodexChatEvent({
    projectId,
    messageId,
    type: ok ? "completed" : "error",
    message: ok ? "Codex 对话完成" : "Codex 对话失败",
    timestamp: nowIso(),
    payload
  });
}

function emitCodexChatEvent(event: CodexChatEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("codex-chat:event", event);
  }
}

function buildAskPrompt(message: string) {
  return appendUtf8Guidance([
    "你是 ARIS Paper Studio 内置的项目问答助手。",
    "请只读取当前仓库和已有运行产物，使用中文回答。",
    "不要修改任何文件，不要执行 destructive Git 命令，不要自动 commit 或 push。",
    "如果需要建议修改，请只描述建议，不要写入文件。",
    "",
    "用户问题：",
    message
  ]).join("\n");
}

function buildEditPrompt(message: string) {
  return appendUtf8Guidance([
    "你是 ARIS Paper Studio 内置的修改预览助手。",
    "请读取当前仓库并用中文说明修改计划，但绝对不要直接写入文件。",
    "如果需要修改文件，请只输出一个可用 git apply 应用的 unified diff。",
    "输出格式必须包含：中文修改摘要，然后是 ```diff fenced code block。",
    "不要执行 destructive Git 命令，不要自动 commit 或 push。",
    "",
    "用户修改请求：",
    message
  ]).join("\n");
}

function extractPatch(content: string) {
  const fenced = content.match(/```(?:diff|patch)\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const start = content.search(/^diff --git /m);
  return start >= 0 ? content.slice(start).trim() : "";
}

function summarizePatch(patchText: string) {
  const files = Array.from(patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)).map((match) => match[2]);
  return files.length ? `将修改 ${files.length} 个文件：${files.slice(0, 6).join("、")}` : "已生成修改预览";
}

function getMessage(messageId: string): CodexChatMessage {
  const row = getDb().prepare("SELECT * FROM codex_chat_messages WHERE id = ?").get(messageId) as any;
  if (!row) throw new Error("对话消息不存在");
  return mapMessage(row);
}

function mapMessage(row: any): CodexChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    mode: row.mode,
    content: row.content,
    status: row.status ?? "completed",
    patchText: row.patch_text,
    editStatus: row.edit_status,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
