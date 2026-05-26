import { Button, Input, List, message, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import type { GitStatus, Project } from "../../shared/types";
import { api } from "../api/electronApi";

export function GitPanel({ project }: { project: Project }) {
  const [status, setStatus] = useState<GitStatus>();
  const [diff, setDiff] = useState("");
  const [messageText, setMessageText] = useState("");
  const [history, setHistory] = useState<Array<{ hash: string; message: string; date: string }>>([]);
  const repositoryId = project.repositoryId;

  async function refresh() {
    if (!repositoryId) return;
    const [nextStatus, nextDiff, nextHistory] = await Promise.all([
      api.repositories.status(repositoryId),
      api.repositories.diff(repositoryId),
      api.repositories.history(repositoryId)
    ]);
    setStatus(nextStatus);
    setDiff(nextDiff);
    setHistory(nextHistory);
  }

  useEffect(() => {
    void refresh();
  }, [repositoryId]);

  if (!repositoryId) return <Typography.Text className="muted">绑定 Git 仓库后可查看 diff、commit 和 push。</Typography.Text>;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Space wrap>
        <Tag color={status?.isDirty ? "orange" : "green"}>{status?.isDirty ? "有未提交改动" : "工作区干净"}</Tag>
        <Typography.Text>分支：{status?.branch ?? "-"}</Typography.Text>
        <Typography.Text>ahead {status?.ahead ?? 0} / behind {status?.behind ?? 0}</Typography.Text>
        <Typography.Text>origin：{status?.remoteOrigin ?? "未配置"}</Typography.Text>
        <Button onClick={refresh}>刷新</Button>
        <Button onClick={async () => {
          await api.repositories.stageAll(repositoryId);
          message.success("已 stage all");
          await refresh();
        }}>
          stage all
        </Button>
      </Space>
      <pre className="diff-viewer">{diff || "当前没有 diff"}</pre>
      <Space.Compact style={{ width: "100%" }}>
        <Input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="commit message" />
        <Button
          type="primary"
          disabled={!messageText.trim()}
          onClick={async () => {
            await api.repositories.commit(repositoryId, messageText);
            message.success("已提交到 Git");
            setMessageText("");
            await refresh();
          }}
        >
          提交
        </Button>
        <Button
          onClick={async () => {
            await api.repositories.push(repositoryId);
            message.success("已推送到远程仓库");
            await refresh();
          }}
        >
          推送
        </Button>
      </Space.Compact>
      <List
        size="small"
        header="最近 commit"
        dataSource={history}
        renderItem={(item) => (
          <List.Item>
            <Space direction="vertical" size={0}>
              <Typography.Text>{item.message}</Typography.Text>
              <Typography.Text className="muted mono">{item.hash.slice(0, 10)} · {item.date}</Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}
