import { Alert, Button, Descriptions, Empty, Form, Input, message, Select, Space, Tabs, Tooltip, Typography } from "antd";
import { PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import type { ExecuteEvent, Run, WorkflowType } from "../../shared/types";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";
import { ArtifactPreview } from "../components/ArtifactPreview";
import { GitPanel } from "../components/GitPanel";
import { LogViewer } from "../components/LogViewer";
import { RunTimeline } from "../components/RunTimeline";

const workflowOptions: Array<{ value: WorkflowType; label: string }> = [
  { value: "research-pipeline", label: "启动完整 research-pipeline" },
  { value: "idea-discovery", label: "仅启动 idea-discovery" },
  { value: "experiment-bridge", label: "仅启动 experiment-bridge" },
  { value: "auto-review-loop", label: "仅启动 auto-review-loop" },
  { value: "paper-writing", label: "仅启动 paper-writing" }
];

export function ProjectDetailPage() {
  const store = useProjectStore();
  const project = useMemo(() => store.projects.find((item) => item.id === store.selectedProjectId), [store.projects, store.selectedProjectId]);
  const [workflowType, setWorkflowType] = useState<WorkflowType>("research-pipeline");
  const [events, setEvents] = useState<ExecuteEvent[]>([]);
  const [runningId, setRunningId] = useState<string>();
  const [form] = Form.useForm();
  const codexExecutor = store.executors.find((executor) => executor.id === "executor-codex") ?? store.executors[0];
  const defaultWorkflow = store.workflows.find((workflow) => workflow.id === "workflow-research-pipeline") ?? store.workflows[0];

  useEffect(() => {
    void store.load();
  }, []);

  useEffect(() => {
    const dispose = api.runs.onEvent((event) => {
      setEvents((current) => [...current, event]);
      if (event.type === "exit" || event.type === "error") {
        void store.refreshSelected();
        setRunningId(undefined);
      }
    });
    return dispose;
  }, []);

  useEffect(() => {
    if (project) {
      form.setFieldsValue({
        name: project.name,
        topic: project.topic,
        targetVenue: project.targetVenue,
        description: project.description,
        defaultExecutorId: project.defaultExecutorId ?? codexExecutor?.id,
        defaultWorkflowId: project.defaultWorkflowId ?? defaultWorkflow?.id
      });
    }
  }, [project, codexExecutor?.id, defaultWorkflow?.id]);

  if (!project) {
    return <Empty description="请先在项目列表中新建或选择项目" />;
  }
  const activeProject = project;

  async function saveProject() {
    try {
      const values = await form.validateFields();
      const next = await api.projects.update(activeProject.id, {
        ...values,
        defaultExecutorId: values.defaultExecutorId ?? codexExecutor?.id,
        defaultWorkflowId: values.defaultWorkflowId ?? defaultWorkflow?.id
      });
      message.success(next.status === "ready" ? "项目配置已保存，状态已更新为可运行" : "项目配置已保存");
      await store.refreshSelected();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function bindRepo() {
    try {
      const dir = await api.repositories.chooseDirectory();
      if (!dir) return;
      await api.repositories.bindOrInit(activeProject.id, dir);
      message.success("仓库已绑定；如果原目录不是 Git 仓库，已自动初始化");
      await store.refreshSelected();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function start() {
    try {
      if (!activeProject.repositoryId) {
        message.warning("请先绑定本地仓库。可以选择普通文件夹，应用会自动初始化 Git。");
        await bindRepo();
        return;
      }
      const values = await form.validateFields();
      await api.projects.update(activeProject.id, {
        ...values,
        defaultExecutorId: values.defaultExecutorId ?? codexExecutor?.id,
        defaultWorkflowId: values.defaultWorkflowId ?? defaultWorkflow?.id
      });
      setEvents([]);
      const run = await api.runs.start({
        projectId: activeProject.id,
        workflowType,
        executorId: values.defaultExecutorId ?? codexExecutor?.id,
        topic: values.topic
      });
      setRunningId(run.id);
      message.success("Workflow 已启动");
      await store.refreshSelected();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div className="panel">
        <div className="toolbar">
          <Space direction="vertical" size={0}>
            <Typography.Title level={4}>{project.name}</Typography.Title>
            <Typography.Text className="muted">{project.topic}</Typography.Text>
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => store.refreshSelected()}>
              刷新
            </Button>
            <Button onClick={bindRepo}>{project.repositoryId ? "更换本地仓库" : "绑定本地仓库"}</Button>
            <Tooltip title={!project.repositoryId ? "启动前必须绑定本地仓库；可选择普通文件夹，应用会自动 git init。" : ""}>
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={start} disabled={Boolean(runningId)}>
                启动 Workflow
              </Button>
            </Tooltip>
            <Button danger icon={<StopOutlined />} disabled={!runningId} onClick={async () => runningId && api.runs.stop(runningId)}>
              停止
            </Button>
          </Space>
        </div>
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="状态">{project.status}</Descriptions.Item>
          <Descriptions.Item label="运行轮数">{project.runCount}</Descriptions.Item>
          <Descriptions.Item label="Git 分支">{project.repository?.branch ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="仓库">{project.repository?.path ?? "未绑定"}</Descriptions.Item>
        </Descriptions>
        {!project.repositoryId && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="尚未绑定本地仓库，Workflow 需要在一个 Git 工作区中运行。点击“绑定本地仓库”选择文件夹；如果不是 Git 仓库，应用会自动执行 git init。"
          />
        )}
      </div>

      <Tabs
        items={[
          {
            key: "workspace",
            label: "工作区",
            children: (
              <div className="panel">
                <Form form={form} layout="vertical">
                  <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="topic" label="研究主题" rules={[{ required: true }]}>
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="description" label="研究方向描述">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Space style={{ width: "100%" }} align="start">
                    <Form.Item name="targetVenue" label="目标会议或期刊" style={{ width: 240 }}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="defaultExecutorId" label="默认执行器" style={{ width: 240 }}>
                      <Select options={store.executors.map((executor) => ({ value: executor.id, label: executor.id === "executor-codex" ? `${executor.name}（默认）` : executor.name }))} />
                    </Form.Item>
                    <Form.Item name="defaultWorkflowId" label="默认 Workflow 模板" style={{ width: 260 }}>
                      <Select options={store.workflows.map((workflow) => ({ value: workflow.id, label: workflow.name }))} />
                    </Form.Item>
                    <Form.Item label="启动类型" style={{ width: 260 }}>
                      <Select value={workflowType} options={workflowOptions} onChange={setWorkflowType} />
                    </Form.Item>
                  </Space>
                  <Button type="primary" onClick={saveProject}>
                    保存配置
                  </Button>
                </Form>
              </div>
            )
          },
          {
            key: "runs",
            label: "运行记录",
            children: (
              <div className="panel">
                <RunTimeline
                  runs={store.runs}
                  onOpen={async (run: Run) => {
                    const detail = await api.runs.get(run.id);
                    setEvents(detail.events);
                  }}
                />
                <LogViewer events={events} />
              </div>
            )
          },
          {
            key: "artifacts",
            label: "成果预览",
            children: (
              <div className="panel">
                <Button onClick={async () => {
            await api.artifacts.rescan(activeProject.id);
                  await store.refreshSelected();
                }}>
                  扫描成果
                </Button>
                <ArtifactPreview artifacts={store.artifacts} />
              </div>
            )
          },
          {
            key: "git",
            label: "Git 变更",
            children: (
              <div className="panel">
                <GitPanel project={project} />
              </div>
            )
          }
        ]}
      />
    </Space>
  );
}
