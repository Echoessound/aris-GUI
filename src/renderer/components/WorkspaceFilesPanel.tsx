import { Button, Empty, Input, List, message, Space, Table, Tag, Typography } from "antd";
import { FolderAddOutlined, FolderOpenOutlined, ImportOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import type { WorkspaceExternalPath, WorkspaceFileEntry, WorkspaceFileSettings } from "../../shared/types";
import { api } from "../api/electronApi";

interface WorkspaceFilesPanelProps {
  projectId: string;
  repositoryPath?: string | null;
}

export function WorkspaceFilesPanel({ projectId, repositoryPath }: WorkspaceFilesPanelProps) {
  const [settings, setSettings] = useState<WorkspaceFileSettings>();
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [externalLabel, setExternalLabel] = useState("");
  const [externalDescription, setExternalDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refresh();
  }, [projectId]);

  async function refresh() {
    setLoading(true);
    try {
      const [nextSettings, nextEntries] = await Promise.all([
        api.workspaceFiles.getSettings(projectId),
        api.workspaceFiles.scan(projectId)
      ]);
      setSettings(nextSettings);
      setEntries(nextEntries);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function ensureDirs() {
    if (!repositoryPath) {
      message.warning("请先绑定本地仓库");
      return;
    }
    const nextEntries = await api.workspaceFiles.ensureRepoDirs(projectId);
    setEntries(await api.workspaceFiles.scan(projectId));
    message.success(`已确认 ${nextEntries.length} 个默认研究目录`);
  }

  async function importFiles(targetDir: string) {
    if (!repositoryPath) {
      message.warning("请先绑定本地仓库");
      return;
    }
    const sources = await api.workspaceFiles.chooseFiles();
    if (!sources.length) return;
    await api.workspaceFiles.importToRepo(projectId, targetDir, sources);
    setEntries(await api.workspaceFiles.scan(projectId));
    message.success(`已导入到 ${targetDir}，后续可在 Git 交付页提交`);
  }

  async function openPath(filePath: string) {
    const error = await api.shell.openPath(filePath);
    if (error) message.error(error);
  }

  async function saveExternalPaths(nextExternalPaths: WorkspaceExternalPath[]) {
    const next = await api.workspaceFiles.saveSettings(projectId, {
      repoDirs: settings?.repoDirs ?? [],
      externalPaths: nextExternalPaths.map((item) => ({
        id: item.id,
        label: item.label,
        path: item.path,
        description: item.description
      }))
    });
    setSettings(next);
    setEntries(await api.workspaceFiles.scan(projectId));
  }

  async function addExternalPath() {
    const dir = await api.workspaceFiles.chooseDirectory();
    if (!dir) return;
    const item: WorkspaceExternalPath = {
      id: `external-${Date.now()}`,
      projectId,
      label: externalLabel.trim() || baseName(dir),
      path: dir,
      description: externalDescription.trim() || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveExternalPaths([...(settings?.externalPaths ?? []), item]);
    setExternalLabel("");
    setExternalDescription("");
    message.success("外部数据源已登记");
  }

  async function removeExternalPath(id: string) {
    await saveExternalPaths((settings?.externalPaths ?? []).filter((item) => item.id !== id));
  }

  const repoEntries = entries.filter((entry) => entry.kind === "repo-dir");
  const externalEntries = settings?.externalPaths ?? [];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div className="pane-heading">
        <Space wrap>
          <Typography.Text strong>仓库研究目录</Typography.Text>
          <Tag>{repoEntries.length} 个默认目录</Tag>
        </Space>
        <Space wrap>
          <Button icon={<FolderAddOutlined />} onClick={ensureDirs} disabled={!repositoryPath}>
            确认/创建全部默认目录
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <Table
        size="small"
        rowKey="key"
        dataSource={repoEntries}
        pagination={false}
        columns={[
          {
            title: "目录",
            dataIndex: "label",
            width: 180,
            render: (_value: string, entry: WorkspaceFileEntry) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{entry.relativePath}</Typography.Text>
                {entry.description && <Typography.Text className="muted">{entry.description}</Typography.Text>}
              </Space>
            )
          },
          {
            title: "路径",
            dataIndex: "path",
            render: (value: string) => <Typography.Text className="mono" ellipsis style={{ maxWidth: 520 }}>{value}</Typography.Text>
          },
          {
            title: "状态",
            dataIndex: "exists",
            width: 100,
            render: (exists: boolean) => <Tag color={exists ? "green" : "orange"}>{exists ? "存在" : "未创建"}</Tag>
          },
          { title: "文件数", dataIndex: "fileCount", width: 90 },
          { title: "大小", dataIndex: "sizeBytes", width: 100, render: (value: number) => formatBytes(value) },
          { title: "最近修改", dataIndex: "updatedAt", width: 170, render: (value?: string | null) => value ? new Date(value).toLocaleString() : "-" },
          {
            title: "操作",
            width: 210,
            render: (_value: unknown, entry: WorkspaceFileEntry) => (
              <Space>
                <Button size="small" icon={<FolderOpenOutlined />} disabled={!entry.exists} onClick={() => openPath(entry.path)}>
                  打开目录
                </Button>
                <Button size="small" icon={<ImportOutlined />} disabled={!repositoryPath} onClick={() => importFiles(entry.relativePath ?? entry.label)}>
                  导入到此目录
                </Button>
              </Space>
            )
          }
        ]}
      />

      <div className="panel-tight workspace-file-card">
        <div className="pane-heading">
          <Typography.Text strong>附加外部数据源</Typography.Text>
          <Typography.Text className="muted">只做登记和快速打开，不作为仓库导入主入口。</Typography.Text>
        </div>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Input value={externalLabel} onChange={(event) => setExternalLabel(event.target.value)} placeholder="外部目录名称" style={{ width: 180 }} />
            <Input value={externalDescription} onChange={(event) => setExternalDescription(event.target.value)} placeholder="说明（可选）" style={{ width: 260 }} />
            <Button icon={<FolderOpenOutlined />} onClick={addExternalPath}>登记外部目录</Button>
          </Space>
          <List
            size="small"
            locale={{ emptyText: <Empty description="暂无外部目录" /> }}
            dataSource={externalEntries}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button size="small" onClick={() => openPath(item.path)} key="open">打开</Button>,
                  <Button size="small" danger onClick={() => removeExternalPath(item.id)} key="remove">移除</Button>
                ]}
              >
                <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                  <Typography.Text strong>{item.label}</Typography.Text>
                  <Typography.Text className="mono muted" ellipsis style={{ maxWidth: 620 }}>{item.path}</Typography.Text>
                  {item.description && <Typography.Text className="muted">{item.description}</Typography.Text>}
                </Space>
              </List.Item>
            )}
          />
        </Space>
      </div>
    </Space>
  );
}

function baseName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
