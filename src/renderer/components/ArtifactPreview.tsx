import { Empty, List, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import type { Artifact } from "../../shared/types";
import { api } from "../api/electronApi";

export function ArtifactPreview({ artifacts }: { artifacts: Artifact[] }) {
  const [selected, setSelected] = useState<Artifact | undefined>(artifacts[0]);
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    setSelected((current) => current ?? artifacts[0]);
  }, [artifacts]);

  useEffect(() => {
    if (!selected) return;
    setContent("");
    setUrl("");
    if (["markdown", "json", "jsonl", "latex", "text", "log"].includes(selected.type)) {
      void api.artifacts.readText(selected.id).then(setContent);
    } else {
      void api.artifacts.getFileUrl(selected.id).then(setUrl);
    }
  }, [selected]);

  return (
    <Space align="start" style={{ width: "100%" }}>
      <List
        bordered
        style={{ width: 300, maxHeight: 520, overflow: "auto" }}
        dataSource={artifacts}
        locale={{ emptyText: "暂无产物" }}
        renderItem={(artifact) => (
          <List.Item onClick={() => setSelected(artifact)} style={{ cursor: "pointer" }}>
            <Space direction="vertical" size={2}>
              <Typography.Text strong={selected?.id === artifact.id}>{artifact.name}</Typography.Text>
              <Space>
                <Tag>{artifact.type}</Tag>
                <Typography.Text className="muted">{Math.round((artifact.sizeBytes ?? 0) / 1024)} KB</Typography.Text>
              </Space>
            </Space>
          </List.Item>
        )}
      />
      <div className="artifact-preview" style={{ flex: 1 }}>
        {!selected ? (
          <Empty description="请选择产物" />
        ) : selected.type === "markdown" ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        ) : selected.type === "pdf" ? (
          <iframe src={url} title={selected.name} />
        ) : selected.type === "image" ? (
          <img src={url} alt={selected.name} />
        ) : (
          <pre className="mono">{content}</pre>
        )}
      </div>
    </Space>
  );
}
