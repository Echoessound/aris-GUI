import { Button, Collapse, Input, List, message, Popconfirm, Radio, Select, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { CodexChatEvent, CodexChatIntent, CodexChatMessage, CodexChatMode, CodexEditPreview, Run } from "../../shared/types";
import { api } from "../api/electronApi";

interface CodexChatPanelProps {
  projectId: string;
  runs: Run[];
  selectedRunId?: string;
}

export function CodexChatPanel({ projectId, runs, selectedRunId }: CodexChatPanelProps) {
  const [messages, setMessages] = useState<CodexChatMessage[]>([]);
  const [chainMessageIds, setChainMessageIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<CodexChatMode>("ask");
  const [scopeRunId, setScopeRunId] = useState<string | null>(selectedRunId ?? null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CodexEditPreview>();
  const hasRunningMessage = useMemo(() => messages.some((item) => item.status === "running"), [messages]);
  const runLabelById = useMemo(() => new Map(runs.map((run) => [run.id, `第 ${run.roundIndex} 轮 - ${run.status}`])), [runs]);

  async function load() {
    const next = await api.codexChat.list(projectId);
    setMessages(next);
    await refreshChains(next);
  }

  async function refreshChains(nextMessages: CodexChatMessage[]) {
    const assistants = nextMessages.filter((item) => item.role === "assistant");
    const pairs = await Promise.all(
      assistants.map(async (item) => {
        const chain = await api.autoContinue.listChain(projectId, item.id).catch(() => null);
        return [item.id, Boolean(chain)] as const;
      })
    );
    setChainMessageIds(new Set(pairs.filter(([, hasChain]) => hasChain).map(([id]) => id)));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (selectedRunId) setScopeRunId(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    const dispose = api.codexChat.onEvent((event) => {
      if (event.projectId !== projectId) return;
      setMessages((current) => {
        const next = applyChatEvent(current, event);
        if (event.type === "completed" || event.type === "error") void refreshChains(next);
        return next;
      });
      if ((event.type === "completed" || event.type === "error") && event.payload?.mode === "edit" && event.payload.patchText) {
        void api.codexChat.previewEdit(event.messageId)
          .then(setPreview)
          .catch(() => undefined);
      }
    });
    return dispose;
  }, [projectId]);

  async function send(intent?: CodexChatIntent, overrideText?: string, overrideMode?: CodexChatMode) {
    const nextMode = overrideMode ?? mode;
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed) return;
    setLoading(true);
    setPreview(undefined);
    try {
      await api.codexChat.send({
        projectId,
        runId: scopeRunId,
        message: trimmed,
        mode: nextMode,
        intent: intent ?? defaultIntent(nextMode, scopeRunId)
      });
      if (!overrideText) setText("");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function showPreview(messageId: string) {
    try {
      setPreview(await api.codexChat.previewEdit(messageId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function applyEdit(messageId: string) {
    try {
      const result = await api.codexChat.applyEdit(messageId);
      await load();
      message[result.editStatus === "applied" ? "success" : "error"](result.editStatus === "applied" ? "Patch 已应用" : result.errorMessage ?? "Patch 应用失败");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function continueMessage(messageId: string) {
    try {
      await api.codexChat.continue(messageId);
      message.success("已在新的 Codex 会话中续接。");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function stopMessageChain(messageId: string) {
    try {
      const chain = await api.autoContinue.listChain(projectId, messageId);
      if (!chain) {
        message.info("这条消息还没有续接链。");
        return;
      }
      await api.autoContinue.stopChain(chain.id);
      message.success("续接链已停止。");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <div className="chat-control-bar">
        <Space wrap>
          <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} disabled={hasRunningMessage}>
            <Radio.Button value="ask">项目问答</Radio.Button>
            <Radio.Button value="edit">编辑预览</Radio.Button>
          </Radio.Group>
          <Select
            value={scopeRunId ?? "project"}
            style={{ minWidth: 220 }}
            disabled={hasRunningMessage}
            onChange={(value) => setScopeRunId(value === "project" ? null : value)}
            options={[
              { value: "project", label: "整个项目" },
              ...runs.map((run) => ({ value: run.id, label: `第 ${run.roundIndex} 轮 - ${run.status}` }))
            ]}
          />
        </Space>
        <Typography.Text className="muted">
          {scopeRunId ? "当前对话会读取所选 run 的日志、进度和产物索引。" : "当前对话会基于项目仓库上下文回答。"}
        </Typography.Text>
      </div>
      <Space wrap>
        <Button disabled={!scopeRunId || hasRunningMessage} onClick={() => send("review_run", "请审查这个 run：完成状态、主要问题、缺失产物、风险和可执行修复建议。", "ask")}>
          审查本轮
        </Button>
        <Button disabled={!scopeRunId || hasRunningMessage} onClick={() => send("review_run", "请总结最重要的阻塞点，以及用户应该优先检查哪些文件。", "ask")}>
          总结问题
        </Button>
        <Button disabled={!scopeRunId || hasRunningMessage} onClick={() => send("edit_preview", "请为本轮产物提出必要修复，并只输出可确认的 unified diff。", "edit")}>
          修复产物
        </Button>
        <Button disabled={!scopeRunId || hasRunningMessage} onClick={() => send("next_round_direction", "请给出下一轮目标、需要修改的文件、执行步骤和验收标准。不要启动新的 run。", "ask")}>
          规划下一轮
        </Button>
      </Space>
      <Input.TextArea
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPressEnter={(event) => {
          if (event.shiftKey || loading || hasRunningMessage) return;
          event.preventDefault();
          void send();
        }}
        placeholder={mode === "ask" ? "询问项目、run 日志或论文产物..." : "描述希望 Codex 预览的编辑..."}
        disabled={loading || hasRunningMessage}
      />
      <Button type="primary" loading={loading || hasRunningMessage} onClick={() => send()} disabled={!text.trim() || hasRunningMessage}>
        {hasRunningMessage ? "Codex 正在回复" : "发送给 Codex"}
      </Button>
      {preview && (
        <div className="chat-preview">
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Typography.Text strong>{preview.summary}</Typography.Text>
            <Popconfirm title="应用这个 diff？" okText="应用" cancelText="取消" onConfirm={() => applyEdit(preview.messageId)}>
              <Button type="primary" disabled={preview.status === "applied"}>应用</Button>
            </Popconfirm>
          </Space>
          <pre className="diff-viewer">{preview.patchText}</pre>
        </div>
      )}
      <List
        className="chat-message-list"
        dataSource={messages}
        locale={{ emptyText: "还没有 Codex 对话消息。" }}
        renderItem={(item) => (
          <List.Item actions={messageActions(item, chainMessageIds.has(item.id), showPreview, applyEdit, continueMessage, stopMessageChain)}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Tag color={item.role === "user" ? "blue" : "green"}>{item.role === "user" ? "用户" : "Codex"}</Tag>
                <Tag>{intentText(item.intent)}</Tag>
                {item.runId && <Tag color="geekblue">{runLabelById.get(item.runId) ?? item.runId.slice(0, 12)}</Tag>}
                <Tag color={statusColor(item.status)}>{statusText(item.status)}</Tag>
                {item.editStatus !== "none" && <Tag color={item.editStatus === "applied" ? "green" : item.editStatus === "failed" ? "red" : "orange"}>{item.editStatus}</Tag>}
                {Boolean(item.continuationIndex) && <Tag color="purple">第 {item.continuationIndex} 段</Tag>}
                {item.continuationReason && <Tag>{item.continuationReason}</Tag>}
                {item.parentMessageId && <Tag>父消息 {shortId(item.parentMessageId)}</Tag>}
                {item.autoContinuedFromMessageId && <Tag color="volcano">自动续接自 {shortId(item.autoContinuedFromMessageId)}</Tag>}
                {item.answeredUserRequest === false && item.role === "assistant" && item.status !== "running" && <Tag color="red">未直接回答</Tag>}
                <Typography.Text className="muted">{item.createdAt}</Typography.Text>
              </Space>
              <Typography.Paragraph className="chat-message-content">{item.content}</Typography.Paragraph>
              {item.errorMessage && <Typography.Text type="danger">{item.errorMessage}</Typography.Text>}
              {item.diagnosticText && (
                <Collapse
                  size="small"
                  ghost
                  items={[{
                    key: "diagnostics",
                    label: "诊断日志",
                    children: <pre className="chat-diagnostics">{item.diagnosticText}</pre>
                  }]}
                />
              )}
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}

function defaultIntent(mode: CodexChatMode, runId: string | null): CodexChatIntent {
  if (mode === "edit") return "edit_preview";
  return runId ? "review_run" : "project_qa";
}

function applyChatEvent(messages: CodexChatMessage[], event: CodexChatEvent) {
  return messages.map((item) => {
    if (item.id !== event.messageId) return item;
    if (event.payload) return event.payload;
    if (event.type !== "stdout" && event.type !== "stderr") return item;
    return {
      ...item,
      diagnosticText: appendDelta(item.diagnosticText ?? "", event.delta ?? "")
    };
  });
}

function appendDelta(current: string, delta: string) {
  if (!delta) return current;
  return `${current}${delta}`;
}

function messageActions(
  item: CodexChatMessage,
  hasChain: boolean,
  showPreview: (messageId: string) => void,
  applyEdit: (messageId: string) => void,
  continueMessage: (messageId: string) => void,
  stopMessageChain: (messageId: string) => void
): ReactNode[] | undefined {
  if (item.role !== "assistant") return undefined;
  const actions: ReactNode[] = [];
  if (item.status !== "running") {
    actions.push(
      <Button key="continue" size="small" onClick={() => continueMessage(item.id)}>
        续接新对话
      </Button>
    );
  }
  if (hasChain) {
    actions.push(
      <Button key="stop-chain" size="small" onClick={() => stopMessageChain(item.id)}>
        停止续接
      </Button>
    );
  }
  if (item.mode === "edit") {
    const disabled = item.status === "running" || !item.patchText;
    actions.push(
      <Button key="preview" size="small" disabled={disabled} onClick={() => showPreview(item.id)}>查看 diff</Button>,
      <Popconfirm key="apply" title="应用这个 diff？" okText="应用" cancelText="取消" onConfirm={() => applyEdit(item.id)}>
        <Button size="small" type="primary" disabled={disabled || item.editStatus === "applied"}>应用</Button>
      </Popconfirm>
    );
  }
  return actions;
}

function intentText(intent: CodexChatIntent) {
  if (intent === "review_run") return "Run 审查";
  if (intent === "edit_preview") return "编辑预览";
  if (intent === "next_round_direction") return "下一轮";
  return "项目问答";
}

function statusColor(status: CodexChatMessage["status"]) {
  if (status === "running") return "blue";
  if (status === "failed") return "red";
  return "green";
}

function statusText(status: CodexChatMessage["status"]) {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "完成";
}

function shortId(value: string) {
  return value.slice(0, 12);
}
