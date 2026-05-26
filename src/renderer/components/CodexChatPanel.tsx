import { Button, Input, List, message, Popconfirm, Radio, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { CodexChatEvent, CodexChatMessage, CodexChatMode, CodexEditPreview } from "../../shared/types";
import { api } from "../api/electronApi";

export function CodexChatPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<CodexChatMessage[]>([]);
  const [mode, setMode] = useState<CodexChatMode>("ask");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CodexEditPreview>();
  const hasRunningMessage = useMemo(() => messages.some((item) => item.status === "running"), [messages]);

  async function load() {
    setMessages(await api.codexChat.list(projectId));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    const dispose = api.codexChat.onEvent((event) => {
      if (event.projectId !== projectId) return;
      setMessages((current) => applyChatEvent(current, event));
      if ((event.type === "completed" || event.type === "error") && event.payload?.mode === "edit" && event.payload.patchText) {
        void api.codexChat.previewEdit(event.messageId)
          .then(setPreview)
          .catch(() => undefined);
      }
    });
    return dispose;
  }, [projectId]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setPreview(undefined);
    try {
      await api.codexChat.send({ projectId, message: trimmed, mode });
      setText("");
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
      message[result.editStatus === "applied" ? "success" : "error"](result.editStatus === "applied" ? "修改已应用" : result.errorMessage ?? "修改应用失败");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Space>
        <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} disabled={hasRunningMessage}>
          <Radio.Button value="ask">项目问答</Radio.Button>
          <Radio.Button value="edit">修改预览</Radio.Button>
        </Radio.Group>
        <Typography.Text className="muted">
          {mode === "ask" ? "只读仓库和产物，实时显示 Codex 输出。" : "先生成 diff，确认后才写入文件。"}
        </Typography.Text>
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
        placeholder={mode === "ask" ? "询问当前项目、运行日志或论文产物..." : "描述希望 Codex 修改的内容..."}
        disabled={loading || hasRunningMessage}
      />
      <Button type="primary" loading={loading || hasRunningMessage} onClick={send} disabled={!text.trim() || hasRunningMessage}>
        {hasRunningMessage ? "Codex 正在响应" : "发送给 Codex"}
      </Button>
      {preview && (
        <div className="chat-preview">
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Typography.Text strong>{preview.summary}</Typography.Text>
            <Popconfirm title="确认应用这份 diff？" okText="应用" cancelText="取消" onConfirm={() => applyEdit(preview.messageId)}>
              <Button type="primary" disabled={preview.status === "applied"}>确认应用</Button>
            </Popconfirm>
          </Space>
          <pre className="diff-viewer">{preview.patchText}</pre>
        </div>
      )}
      <List
        className="chat-message-list"
        dataSource={messages}
        locale={{ emptyText: "还没有对话" }}
        renderItem={(item) => (
          <List.Item actions={messageActions(item, showPreview, applyEdit)}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Space wrap>
                <Tag color={item.role === "user" ? "blue" : "green"}>{item.role === "user" ? "你" : "Codex"}</Tag>
                <Tag>{item.mode === "ask" ? "问答" : "修改"}</Tag>
                <Tag color={statusColor(item.status)}>{statusText(item.status)}</Tag>
                {item.editStatus !== "none" && <Tag color={item.editStatus === "applied" ? "green" : item.editStatus === "failed" ? "red" : "orange"}>{item.editStatus}</Tag>}
                <Typography.Text className="muted">{item.createdAt}</Typography.Text>
              </Space>
              <Typography.Paragraph className="chat-message-content">{item.content}</Typography.Paragraph>
              {item.errorMessage && <Typography.Text type="danger">{item.errorMessage}</Typography.Text>}
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}

function applyChatEvent(messages: CodexChatMessage[], event: CodexChatEvent) {
  return messages.map((item) => {
    if (item.id !== event.messageId) return item;
    if (event.payload) return event.payload;
    if (event.type !== "stdout" && event.type !== "stderr") return item;
    const delta = event.type === "stderr" ? formatStderrDelta(event.delta ?? "") : event.delta ?? "";
    return {
      ...item,
      content: appendDelta(item.content, delta)
    };
  });
}

function appendDelta(current: string, delta: string) {
  if (!delta) return current;
  const base = current === "Codex 正在处理请求..." ? "" : current;
  return `${base}${delta}`;
}

function formatStderrDelta(delta: string) {
  if (!delta.trim()) return delta;
  return `\n[diagnostic]\n${delta}`;
}

function messageActions(
  item: CodexChatMessage,
  showPreview: (messageId: string) => void,
  applyEdit: (messageId: string) => void
) {
  if (item.role !== "assistant" || item.mode !== "edit") return undefined;
  const disabled = item.status === "running" || !item.patchText;
  return [
    <Button key="preview" size="small" disabled={disabled} onClick={() => showPreview(item.id)}>查看 diff</Button>,
    <Popconfirm key="apply" title="确认应用这份 diff？" okText="应用" cancelText="取消" onConfirm={() => applyEdit(item.id)}>
      <Button size="small" type="primary" disabled={disabled || item.editStatus === "applied"}>应用</Button>
    </Popconfirm>
  ];
}

function statusColor(status: CodexChatMessage["status"]) {
  if (status === "running") return "blue";
  if (status === "failed") return "red";
  return "green";
}

function statusText(status: CodexChatMessage["status"]) {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "已完成";
}
