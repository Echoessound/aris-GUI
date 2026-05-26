import { Button, Empty, Input, Space, Table, Tag, Typography } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import type { Project } from "../../shared/types";

const statusText: Record<Project["status"] | "unbound", string> = {
  unbound: "未绑定仓库",
  draft: "待配置",
  ready: "可运行",
  running: "运行中",
  waiting_approval: "等待确认",
  failed: "失败",
  completed: "已完成",
  archived: "已归档"
};

const statusColor: Record<Project["status"] | "unbound", string> = {
  unbound: "orange",
  draft: "default",
  ready: "green",
  running: "blue",
  waiting_approval: "gold",
  failed: "red",
  completed: "green",
  archived: "default"
};

export function ProjectList({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onBind
}: {
  projects: Project[];
  selectedId?: string;
  onSelect(project: Project): void;
  onCreate(): void;
  onBind(project: Project): void;
}) {
  const [query, setQuery] = useState("");
  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => [
      project.name,
      project.topic,
      project.targetVenue ?? "",
      project.repository?.path ?? "",
      project.repository?.branch ?? ""
    ].some((value) => value.toLowerCase().includes(keyword)));
  }, [projects, query]);

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="toolbar-main">
          <Input.Search
            placeholder="搜索项目、主题、仓库或分支"
            allowClear
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: 320 }}
          />
          <Typography.Text className="muted">共 {filteredProjects.length}/{projects.length} 个项目</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          新建项目
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={filteredProjects}
        locale={{ emptyText: <Empty description={projects.length ? "没有匹配的项目" : "还没有论文项目，先新建一个。"} /> }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        rowClassName={(record) => (record.id === selectedId ? "selected-row" : "")}
        onRow={(record) => ({ onClick: () => onSelect(record) })}
        columns={[
          {
            title: "项目",
            dataIndex: "name",
            render: (value: string, record) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{value}</Typography.Text>
                <Typography.Text className="muted" ellipsis style={{ maxWidth: 460 }}>{record.topic}</Typography.Text>
              </Space>
            )
          },
          {
            title: "本地仓库",
            render: (_, record) => (
              <Typography.Text className="mono" ellipsis style={{ maxWidth: 360 }}>
                {record.repository?.path ?? "未绑定"}
              </Typography.Text>
            )
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (value: Project["status"], record) => {
              const effectiveStatus = record.repositoryId ? value : "unbound";
              return <Tag color={statusColor[effectiveStatus]}>{statusText[effectiveStatus]}</Tag>;
            }
          },
          {
            title: "Workflow",
            render: (_, record) => record.defaultWorkflowId ?? "默认模板"
          },
          {
            title: "分支",
            render: (_, record) => record.repository?.branch ?? "-"
          },
          {
            title: "轮次",
            dataIndex: "runCount"
          },
          {
            title: "操作",
            render: (_, record) => (
              <Space>
                <Button size="small" onClick={() => onSelect(record)}>
                  打开
                </Button>
                <Button size="small" icon={<FolderOpenOutlined />} onClick={(event) => {
                  event.stopPropagation();
                  onBind(record);
                }}>
                  {record.repositoryId ? "更换仓库" : "绑定仓库"}
                </Button>
              </Space>
            )
          }
        ]}
      />
    </div>
  );
}
