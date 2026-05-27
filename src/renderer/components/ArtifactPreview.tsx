import { Button, Empty, Input, List, Select, Space, Tag, Tree, Typography, message } from "antd";
import {
  CodeOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import type { Artifact, ArtifactType, Run } from "../../shared/types";
import { api } from "../api/electronApi";

interface ArtifactPreviewProps {
  artifacts: Artifact[];
  runs: Run[];
  onRescan?: () => Promise<void>;
  onCompilePdf?: () => Promise<void>;
}

interface ArtifactGroup {
  key: string;
  label: string;
  status?: string;
  updatedAt?: string | null;
  artifacts: Artifact[];
}

interface TreeNode {
  title: ReactNode;
  key: string;
  children?: TreeNode[];
  isLeaf?: boolean;
}

export function ArtifactPreview({ artifacts, runs, onRescan, onCompilePdf }: ArtifactPreviewProps) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const [activeRunKey, setActiveRunKey] = useState<string>();
  const [activeType, setActiveType] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const groupedArtifacts = useMemo(() => groupArtifacts(artifacts, runById), [artifacts, runById]);

  useEffect(() => {
    const firstKey = groupedArtifacts[0]?.key;
    setActiveRunKey((current) => current && groupedArtifacts.some((group) => group.key === current) ? current : firstKey);
  }, [groupedArtifacts]);

  const activeGroup = groupedArtifacts.find((group) => group.key === activeRunKey);
  const activeArtifacts = activeGroup?.artifacts ?? [];
  const activeTypes = useMemo(() => Array.from(new Set<string>(activeArtifacts.map((artifact) => artifact.type))).sort(), [activeArtifacts]);
  const visibleArtifacts = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return activeArtifacts.filter((artifact) => {
      if (activeType !== "all" && artifact.type !== activeType) return false;
      if (!lowered) return true;
      return [artifact.name, artifact.relativePath, artifact.runRelativePath, artifact.description, artifact.path]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(lowered));
    });
  }, [activeArtifacts, activeType, query]);
  const selected = useMemo(() => visibleArtifacts.find((artifact) => artifactStableKey(artifact) === selectedKey) ?? visibleArtifacts[0], [visibleArtifacts, selectedKey]);
  const tree = useMemo(() => buildArtifactTree(visibleArtifacts, selectedKey), [visibleArtifacts, selectedKey]);

  useEffect(() => {
    setActiveType((current) => current === "all" || activeTypes.includes(current) ? current : "all");
  }, [activeTypes]);

  useEffect(() => {
    setSelectedKey((current) => {
      if (!visibleArtifacts.length) return undefined;
      if (current && visibleArtifacts.some((artifact) => artifactStableKey(artifact) === current)) return current;
      return artifactStableKey(visibleArtifacts[0]);
    });
    setExpandedKeys((current) => Array.from(new Set([...current, ...defaultExpandedKeys(visibleArtifacts)])));
  }, [activeRunKey, activeType, query, visibleArtifacts]);

  useEffect(() => {
    if (!selected) return;
    setContent("");
    setUrl("");
    if (isTextPreview(selected.type)) {
      void api.artifacts.readText(selected.id).then(setContent).catch((error) => {
        setContent(error instanceof Error ? error.message : String(error));
      });
    } else if (selected.type === "pdf" || selected.type === "image") {
      void api.artifacts.getFileUrl(selected.id).then(setUrl).catch((error) => {
        message.error(error instanceof Error ? error.message : String(error));
      });
    }
  }, [selected]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <div className="artifact-toolbar">
        <Space wrap>
          <Typography.Text strong>产物文件夹</Typography.Text>
          {activeGroup && <Tag color="blue">{activeGroup.label}</Tag>}
          {selected && <Typography.Text className="mono muted artifact-current-path">{selected.runRelativePath ?? selected.relativePath ?? selected.name}</Typography.Text>}
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索文件名、路径或说明"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 260 }}
          />
          <Select
            value={activeType}
            onChange={setActiveType}
            style={{ width: 160 }}
            options={[
              { value: "all", label: `全部 (${activeArtifacts.length})` },
              ...activeTypes.map((type) => ({ value: type, label: `${type} (${activeArtifacts.filter((artifact) => artifact.type === type).length})` }))
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRescan?.()}>重新扫描</Button>
          <Button icon={<FilePdfOutlined />} onClick={() => onCompilePdf?.()}>
            生成/修复 PDF
          </Button>
          <Button icon={<FolderOpenOutlined />} disabled={!activeGroup?.artifacts.length} onClick={() => openRunFolder(activeGroup)}>
            打开本轮文件夹
          </Button>
        </Space>
      </div>
      {groupedArtifacts.length === 0 ? (
        <Empty description="暂无产物" />
      ) : (
        <div className="artifact-workbench">
          <div className="artifact-run-pane">
            <div className="pane-heading">
              <Typography.Text strong>轮次</Typography.Text>
              <Typography.Text className="muted">{groupedArtifacts.length} 组</Typography.Text>
            </div>
            <List
              size="small"
              dataSource={groupedArtifacts}
              renderItem={(group) => (
                <List.Item className={group.key === activeRunKey ? "artifact-run-selected" : ""} onClick={() => setActiveRunKey(group.key)}>
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Space wrap>
                      <Typography.Text strong>{group.label}</Typography.Text>
                      {group.status && <Tag>{group.status}</Tag>}
                    </Space>
                    <Typography.Text className="muted">{group.artifacts.length} 个文件</Typography.Text>
                    {group.updatedAt && <Typography.Text className="muted">{group.updatedAt}</Typography.Text>}
                  </Space>
                </List.Item>
              )}
            />
          </div>
          <div className="artifact-tree-pane">
            <div className="pane-heading">
              <Typography.Text strong>文件夹</Typography.Text>
              <Typography.Text className="muted">{visibleArtifacts.length} 个文件</Typography.Text>
            </div>
            {tree.length === 0 ? (
              <Empty description="当前筛选下没有文件" />
            ) : (
              <Tree
                treeData={tree}
                selectedKeys={selectedKey ? [selectedKey] : []}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const key = String(keys[0] ?? "");
                  const artifact = visibleArtifacts.find((item) => artifactStableKey(item) === key);
                  if (artifact) setSelectedKey(artifactStableKey(artifact));
                }}
              />
            )}
          </div>
          <div className="artifact-preview-pane">
            <div className="pane-heading">
              <Typography.Text strong>{selected?.name ?? "预览"}</Typography.Text>
              <Space>
                {selected && <Tag>{selected.type}</Tag>}
                <Button size="small" disabled={!selected} onClick={() => selected && openFile(selected)}>打开文件</Button>
                <Button size="small" disabled={!selected} onClick={() => selected && openContainingFolder(selected)}>打开所在文件夹</Button>
              </Space>
            </div>
            <ArtifactBody selected={selected} content={content} url={url} />
          </div>
        </div>
      )}
    </Space>
  );
}

function ArtifactBody({ selected, content, url }: { selected?: Artifact; content: string; url: string }) {
  if (!selected) return <Empty description="请选择文件" />;
  if (selected.type === "markdown") return <div className="artifact-render"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
  if (selected.type === "pdf") return url ? <iframe className="artifact-media" src={url} title={selected.name} /> : <Empty description="正在加载 PDF" />;
  if (selected.type === "image") return url ? <img className="artifact-media" src={url} alt={selected.name} /> : <Empty description="正在加载图片" />;
  if (selected.type === "code") return <pre className="artifact-code">{content}</pre>;
  if (isTextPreview(selected.type)) return <pre className="artifact-text">{content}</pre>;
  return (
    <div className="artifact-metadata">
      <Typography.Title level={5}>无法内联预览</Typography.Title>
      <Typography.Paragraph>{selected.description ?? "该文件需要用外部应用打开。"}</Typography.Paragraph>
      <dl>
        <dt>文件位置</dt>
        <dd className="mono">{selected.path}</dd>
        <dt>相对路径</dt>
        <dd className="mono">{selected.runRelativePath ?? selected.relativePath ?? selected.name}</dd>
        <dt>大小</dt>
        <dd>{formatBytes(selected.sizeBytes ?? 0)}</dd>
      </dl>
    </div>
  );
}

function groupArtifacts(artifacts: Artifact[], runById: Map<string, Run>): ArtifactGroup[] {
  const groups = new Map<string, ArtifactGroup>();
  for (const artifact of artifacts) {
    const key = artifact.runId ?? "manual";
    const run = artifact.runId ? runById.get(artifact.runId) : undefined;
    const group = groups.get(key) ?? {
      key,
      label: run ? `第 ${run.roundIndex} 轮` : "手动扫描",
      status: run?.status,
      updatedAt: run?.endedAt ?? run?.startedAt,
      artifacts: []
    };
    group.artifacts.push(artifact);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    artifacts: group.artifacts.sort((a, b) => (a.runRelativePath ?? a.name).localeCompare(b.runRelativePath ?? b.name))
  }));
}

function buildArtifactTree(artifacts: Artifact[], selectedId?: string): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode & { children: TreeNode[] }>();
  for (const artifact of artifacts) {
    const stableKey = artifactStableKey(artifact);
    const parts = (artifact.runRelativePath ?? artifact.relativePath ?? artifact.name).split("/").filter(Boolean);
    let prefix = "";
    let siblings: TreeNode[] = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = index === parts.length - 1;
      if (isFile) {
        siblings.push({
          key: stableKey,
          isLeaf: true,
          title: fileTitle(artifact, selectedId === stableKey)
        });
        continue;
      }
      prefix = prefix ? `${prefix}/${part}` : part;
      let folder = folderMap.get(prefix);
      if (!folder) {
        folder = { key: `folder:${prefix}`, title: <span><FolderOpenOutlined /> {part}</span>, children: [] };
        folderMap.set(prefix, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
  }
  return root;
}

function artifactStableKey(artifact: Artifact) {
  return [artifact.runId ?? "manual", artifact.runRelativePath ?? artifact.relativePath ?? artifact.path].join(":");
}

function fileTitle(artifact: Artifact, selected: boolean) {
  return (
    <span className={`artifact-tree-file${selected ? " artifact-tree-file-selected" : ""}`}>
      {iconForType(artifact.type)}
      <span>{baseName(artifact.runRelativePath ?? artifact.relativePath ?? artifact.name)}</span>
      <Tag>{artifact.type}</Tag>
      <span className="muted">{formatBytes(artifact.sizeBytes ?? 0)}</span>
    </span>
  );
}

function defaultExpandedKeys(artifacts: Artifact[]) {
  const keys = new Set<string>();
  for (const artifact of artifacts) {
    const parts = (artifact.runRelativePath ?? artifact.relativePath ?? artifact.name).split("/").filter(Boolean);
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      keys.add(`folder:${prefix}`);
    }
  }
  return Array.from(keys);
}

function isTextPreview(type: ArtifactType) {
  return ["markdown", "word", "json", "jsonl", "latex", "text", "code", "csv", "html", "log"].includes(type);
}

function iconForType(type: ArtifactType) {
  if (type === "pdf") return <FilePdfOutlined />;
  if (type === "image") return <FileImageOutlined />;
  if (type === "code") return <CodeOutlined />;
  return <FileTextOutlined />;
}

async function openRunFolder(group?: ArtifactGroup) {
  const first = group?.artifacts[0];
  if (!first) return;
  const root = inferRunRoot(first);
  const error = await api.shell.openPath(root);
  if (error) message.error(error);
}

async function openFile(artifact: Artifact) {
  const error = await api.shell.openPath(artifact.path);
  if (error) message.error(error);
}

async function openContainingFolder(artifact: Artifact) {
  const error = await api.shell.openPath(parentDir(artifact.path));
  if (error) message.error(error);
}

function inferRunRoot(artifact: Artifact) {
  const rel = (artifact.runRelativePath ?? artifact.relativePath ?? artifact.name).replace(/\//g, "\\");
  if (artifact.path.endsWith(rel)) return artifact.path.slice(0, artifact.path.length - rel.length).replace(/[\\/]$/, "");
  return parentDir(artifact.path);
}

function parentDir(filePath: string) {
  return filePath.replace(/[\\/][^\\/]*$/, "");
}

function baseName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
