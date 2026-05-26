import { Button, Empty, List, Space, Tabs, Tag, Typography, message } from "antd";
import { FolderOpenOutlined, ReloadOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, Run } from "../../shared/types";
import { api } from "../api/electronApi";

export function ArtifactPreview({ artifacts, runs, onRescan }: { artifacts: Artifact[]; runs: Run[]; onRescan?: () => Promise<void> }) {
  const [selected, setSelected] = useState<Artifact | undefined>(artifacts[0]);
  const [activeRunKey, setActiveRunKey] = useState<string>();
  const [activeType, setActiveType] = useState<string>("all");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const runLabelById = useMemo(() => new Map(runs.map((run) => [run.id, `第 ${run.roundIndex} 轮运行`])), [runs]);
  const groupedArtifacts = useMemo(() => {
    const groups = new Map<string, { label: string; artifacts: Artifact[] }>();
    for (const artifact of artifacts) {
      const key = artifact.runId ?? "manual";
      const label = artifact.runId ? runLabelById.get(artifact.runId) ?? "未知运行" : "手动扫描";
      const group = groups.get(key) ?? { label, artifacts: [] };
      group.artifacts.push(artifact);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }));
  }, [artifacts, runLabelById]);

  useEffect(() => {
    const firstKey = groupedArtifacts[0]?.key;
    setActiveRunKey((current) => groupedArtifacts.some((group) => group.key === current) ? current : firstKey);
  }, [groupedArtifacts]);

  useEffect(() => {
    const activeArtifacts = groupedArtifacts.find((group) => group.key === activeRunKey)?.artifacts ?? [];
    setSelected((current) => activeArtifacts.find((artifact) => artifact.id === current?.id) ?? activeArtifacts[0]);
  }, [activeRunKey, groupedArtifacts]);

  useEffect(() => {
    if (!selected) return;
    setContent("");
    setUrl("");
    if (["markdown", "word", "json", "jsonl", "latex", "text", "log"].includes(selected.type)) {
      void api.artifacts.readText(selected.id).then(setContent);
    } else {
      void api.artifacts.getFileUrl(selected.id).then(setUrl);
    }
  }, [selected]);

  const activeArtifacts = groupedArtifacts.find((group) => group.key === activeRunKey)?.artifacts ?? [];
  const activeTypes = useMemo(() => Array.from(new Set<string>(activeArtifacts.map((artifact) => artifact.type))), [activeArtifacts]);
  const visibleArtifacts = activeType === "all" ? activeArtifacts : activeArtifacts.filter((artifact) => artifact.type === activeType);

  useEffect(() => {
    setActiveType((current) => current === "all" || activeTypes.includes(current) ? current : "all");
  }, [activeTypes]);

  return (
    <Space direction="vertical" style={{ width: "100%", marginTop: 12 }}>
      <div className="toolbar">
        <Space wrap>
          <Typography.Text strong>产物浏览</Typography.Text>
          {selected && <Typography.Text className="mono muted" ellipsis style={{ maxWidth: 520 }}>{selected.path}</Typography.Text>}
        </Space>
        <div className="toolbar-actions">
          <Button icon={<ReloadOutlined />} onClick={() => onRescan?.()}>重新扫描</Button>
          <Button
            icon={<FolderOpenOutlined />}
            disabled={!selected}
            onClick={async () => {
              if (!selected) return;
              const error = await api.shell.openPath(selected.path);
              if (error) message.error(error);
            }}
          >
            打开文件
          </Button>
        </div>
      </div>
      {groupedArtifacts.length === 0 ? (
        <Empty description="暂无产物" />
      ) : (
        <Tabs
          activeKey={activeRunKey}
          onChange={setActiveRunKey}
          items={groupedArtifacts.map((group) => ({
            key: group.key,
            label: `${group.label} (${group.artifacts.length})`
          }))}
        />
      )}
      {activeTypes.length > 0 && (
        <Tabs
          activeKey={activeType}
          onChange={setActiveType}
          items={[
            { key: "all", label: `全部 (${activeArtifacts.length})` },
            ...activeTypes.map((type) => ({
              key: type,
              label: `${type} (${activeArtifacts.filter((artifact) => artifact.type === type).length})`
            }))
          ]}
        />
      )}
      <Space align="start" style={{ width: "100%" }} wrap>
        <div className="artifact-run-list">
          {visibleArtifacts.length === 0 ? <Empty description="该分类暂无产物" /> : (
            <List
              size="small"
              dataSource={visibleArtifacts}
              renderItem={(artifact) => (
                <List.Item onClick={() => setSelected(artifact)} style={{ cursor: "pointer" }}>
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Typography.Text strong={selected?.id === artifact.id} ellipsis>{artifact.name}</Typography.Text>
                    <Space wrap>
                      <Tag>{artifact.type}</Tag>
                      <Typography.Text className="muted">{Math.round((artifact.sizeBytes ?? 0) / 1024)} KB</Typography.Text>
                    </Space>
                    <Typography.Text className="mono muted" ellipsis>{artifact.path}</Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
        <div className="artifact-preview" style={{ flex: 1, minWidth: 360 }}>
          {!selected ? (
            <Empty description="请选择产物" />
          ) : selected.type === "markdown" ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : selected.type === "pdf" ? (
            <iframe src={url} title={selected.name} />
          ) : selected.type === "image" ? (
            <img src={url} alt={selected.name} />
          ) : selected.type === "word" ? (
            <pre className="word-preview">{content}</pre>
          ) : (
            <pre className="mono">{content}</pre>
          )}
        </div>
      </Space>
    </Space>
  );
}
