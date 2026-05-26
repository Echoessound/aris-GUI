import { Button, Empty, Input, Space, Table, Tag, Typography } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import type { Project } from "../../shared/types";

const statusText: Record<Project["status"] | "unbound", string> = {
  unbound: "未绑定仓库",
  draft: "未配置",
  ready: "可运行",
  running: "运行中",
  waiting_approval: "等待确认",
  failed: "已失败",
  completed: "已完成",
  archived: "已归档"
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
  return (
    <div className="panel">
      <div className="toolbar">
        <Space>
          <Input.Search placeholder="搜索项目" allowClear style={{ width: 280 }} />
          <Typography.Text className="muted">共 {projects.length} 个项目</Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          新建项目
        </Button>
      </div>
      <Table
        rowKey="id"
        dataSource={projects}
        locale={{ emptyText: <Empty description="还没有论文项目" /> }}
        pagination={{ pageSize: 8 }}
        rowClassName={(record) => (record.id === selectedId ? "selected-row" : "")}
        onRow={(record) => ({ onClick: () => onSelect(record) })}
        columns={[
          {
            title: "项目名称",
            dataIndex: "name",
            render: (value: string, record) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{value}</Typography.Text>
                <Typography.Text className="muted">{record.topic}</Typography.Text>
              </Space>
            )
          },
          {
            title: "本地仓库",
            render: (_, record) => (
              <Typography.Text className="mono" ellipsis style={{ maxWidth: 320 }}>
                {record.repository?.path ?? "未绑定"}
              </Typography.Text>
            )
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (value: Project["status"], record) => {
              const effectiveStatus = record.repositoryId ? value : "unbound";
              const color = effectiveStatus === "unbound" ? "orange" : value === "failed" ? "red" : value === "running" ? "blue" : "green";
              return <Tag color={color}>{statusText[effectiveStatus]}</Tag>;
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
            title: "运行轮数",
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
                  绑定仓库
                </Button>
              </Space>
            )
          }
        ]}
      />
    </div>
  );
}
