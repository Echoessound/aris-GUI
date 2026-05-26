import { Alert, Button, Empty, Form, Input, message, Select, Space, Tabs, Tag, Tooltip, Typography } from "antd";
import { FolderOpenOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExecuteEvent, Run, RunInsight, WorkflowType } from "../../shared/types";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";
import { ArtifactPreview } from "../components/ArtifactPreview";
import { CodexChatPanel } from "../components/CodexChatPanel";
import { GitPanel } from "../components/GitPanel";
import { LogViewer } from "../components/LogViewer";
import { RunInsightPanel } from "../components/RunInsightPanel";
import { RunTimeline } from "../components/RunTimeline";

const workflowOptions: Array<{ value: WorkflowType; label: string }> = [
  { value: "research-pipeline", label: "完整 research-pipeline" },
  { value: "idea-discovery", label: "仅 idea-discovery" },
  { value: "experiment-bridge", label: "仅 experiment-bridge" },
  { value: "auto-review-loop", label: "仅 auto-review-loop" },
  { value: "paper-writing", label: "论文写作 paper-writing" },
  { value: "multi-agent-paper-review", label: "多 Agent 论文评审" }
];

const projectStatusText: Record<string, string> = {
  draft: "待配置",
  ready: "可运行",
  running: "运行中",
  waiting_approval: "等待确认",
  failed: "失败",
  completed: "已完成",
  archived: "已归档"
};

export function ProjectDetailPage() {
  const store = useProjectStore();
  const project = useMemo(() => store.projects.find((item) => item.id === store.selectedProjectId), [store.projects, store.selectedProjectId]);
  const [workflowType, setWorkflowType] = useState<WorkflowType>("research-pipeline");
  const [events, setEvents] = useState<ExecuteEvent[]>([]);
  const [insights, setInsights] = useState<RunInsight[]>([]);
  const [runningId, setRunningId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const activeRunIdRef = useRef<string | undefined>(undefined);
  const [form] = Form.useForm();
  const codexExecutor = store.executors.find((executor) => executor.id === "executor-codex") ?? store.executors[0];
  const defaultWorkflow = store.workflows.find((workflow) => workflow.id === "workflow-research-pipeline") ?? store.workflows[0];
  const latestRun = store.runs[0];

  useEffect(() => {
    void store.load();
  }, []);

  useEffect(() => {
    const dispose = api.runs.onEvent((event) => {
      if (activeRunIdRef.current && event.runId !== activeRunIdRef.current) return;
      if (!activeRunIdRef.current && !runningId) return;
      setEvents((current) => [...current, event]);
      if (event.type === "insight" && event.payload) {
        setInsights((current) => [...current, event.payload!]);
      }
      if (event.type === "exit" || event.type === "error") {
        void store.refreshSelected();
        setRunningId(undefined);
        activeRunIdRef.current = undefined;
      }
    });
    return dispose;
  }, [runningId]);

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
    return <Empty description="请先在项目操作台中新建或选择项目" />;
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
      message.success(next.status === "ready" ? "项目配置已保存，当前可运行" : "项目配置已保存");
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

  async function openRepositoryFolder() {
    if (!activeProject.repository?.path) {
      message.warning("请先绑定本地仓库");
      return;
    }
    const error = await api.shell.openPath(activeProject.repository.path);
    if (error) message.error(error);
  }

  async function start() {
    try {
      if (!activeProject.repositoryId) {
        message.warning("请先绑定本地仓库。可以选择普通文件夹，应用会自动 git init。");
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
      setInsights([]);
      const run = await api.runs.start({
        projectId: activeProject.id,
        workflowType,
        executorId: values.defaultExecutorId ?? codexExecutor?.id,
        topic: values.topic
      });
      setRunningId(run.id);
      setSelectedRunId(run.id);
      activeRunIdRef.current = run.id;
      const detail = await api.runs.get(run.id);
      setEvents(detail.events);
      setInsights(detail.insights);
      message.success("Workflow 已启动");
      await store.refreshSelected();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page-stack">
      <div className="panel">
        <div className="toolbar">
          <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
            <Space wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>{project.name}</Typography.Title>
              <Tag color={project.status === "running" ? "blue" : project.status === "failed" ? "red" : project.repositoryId ? "green" : "orange"}>
                {project.repositoryId ? projectStatusText[project.status] ?? project.status : "未绑定仓库"}
              </Tag>
            </Space>
            <Typography.Text className="muted" ellipsis>{project.topic}</Typography.Text>
          </Space>
          <div className="toolbar-actions">
            <Button icon={<ReloadOutlined />} onClick={() => store.refreshSelected()}>
              刷新
            </Button>
            <Button onClick={bindRepo}>{project.repositoryId ? "更换仓库" : "绑定仓库"}</Button>
            <Button icon={<FolderOpenOutlined />} disabled={!project.repository?.path} onClick={openRepositoryFolder}>
              打开仓库
            </Button>
            <Tooltip title={!project.repositoryId ? "启动前必须绑定本地仓库" : ""}>
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={start} disabled={Boolean(runningId)}>
                启动 Workflow
              </Button>
            </Tooltip>
            <Button danger icon={<StopOutlined />} disabled={!runningId} onClick={async () => runningId && api.runs.stop(runningId)}>
              停止
            </Button>
          </div>
        </div>
        <div className="status-grid">
          <StatusTile label="仓库" value={project.repository?.path ?? "未绑定"} mono />
          <StatusTile label="分支" value={project.repository?.branch ?? "-"} />
          <StatusTile label="运行轮次" value={`${project.runCount}`} />
          <StatusTile label="最近 Run" value={latestRun ? `#${latestRun.roundIndex} · ${latestRun.status}` : "暂无"} />
        </div>
        {!project.repositoryId && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message="尚未绑定本地仓库"
            description="Workflow 需要在 Git 工作区中运行。请选择一个研究仓库或空文件夹，应用会在需要时自动初始化 Git。"
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
                  <Space style={{ width: "100%" }} align="start" wrap>
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
            label: "运行",
            children: (
              <div className="panel">
                <ReadinessChecklist
                  repositoryReady={Boolean(activeProject.repositoryId)}
                  executorReady={Boolean(codexExecutor)}
                  workflowReady={Boolean(defaultWorkflow)}
                  topicReady={Boolean(activeProject.topic?.trim())}
                />
                <div className="run-workbench">
                  <div className="run-list-pane">
                    <div className="pane-heading">
                      <Typography.Text strong>运行历史</Typography.Text>
                      {selectedRunId && <Typography.Text className="muted mono">{selectedRunId.slice(0, 18)}...</Typography.Text>}
                    </div>
                    <RunTimeline
                      runs={store.runs}
                      selectedRunId={selectedRunId}
                      onOpen={async (run: Run) => {
                        setSelectedRunId(run.id);
                        activeRunIdRef.current = run.status === "running" ? run.id : undefined;
                        setRunningId(run.status === "running" ? run.id : undefined);
                        const detail = await api.runs.get(run.id);
                        setEvents(detail.events);
                        setInsights(detail.insights);
                      }}
                    />
                  </div>
                  <div className="run-detail-pane">
                    <div className="pane-heading">
                      <Typography.Text strong>运行要点</Typography.Text>
                      <Typography.Text className="muted">按真实进展实时追加</Typography.Text>
                    </div>
                    <RunInsightPanel insights={insights} />
                    <div className="pane-heading">
                      <Typography.Text strong>原始日志</Typography.Text>
                      <Typography.Text className="muted">{events.length} 条事件</Typography.Text>
                    </div>
                    <LogViewer events={events} />
                  </div>
                </div>
              </div>
            )
          },
          {
            key: "artifacts",
            label: "产物预览",
            children: (
              <div className="panel">
                <ArtifactPreview
                  artifacts={store.artifacts}
                  runs={store.runs}
                  onRescan={async () => {
                    await api.artifacts.rescan(activeProject.id);
                    await store.refreshSelected();
                  }}
                />
              </div>
            )
          },
          {
            key: "codex-chat",
            label: "Codex 对话",
            children: (
              <div className="panel">
                <CodexChatPanel projectId={activeProject.id} />
              </div>
            )
          },
          {
            key: "git",
            label: "Git 交付",
            children: (
              <div className="panel">
                <GitPanel project={project} />
              </div>
            )
          }
        ]}
      />
    </div>
  );
}

function StatusTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="status-tile">
      <span className="status-label">{label}</span>
      <span className={`status-value${mono ? " mono" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function ReadinessChecklist({
  repositoryReady,
  executorReady,
  workflowReady,
  topicReady
}: {
  repositoryReady: boolean;
  executorReady: boolean;
  workflowReady: boolean;
  topicReady: boolean;
}) {
  const items = [
    { label: "仓库", ready: repositoryReady },
    { label: "执行器", ready: executorReady },
    { label: "Workflow", ready: workflowReady },
    { label: "研究主题", ready: topicReady }
  ];
  return (
    <div className="readiness-bar">
      <Typography.Text strong>启动准备</Typography.Text>
      <Space wrap>
        {items.map((item) => (
          <Tag key={item.label} color={item.ready ? "green" : "orange"}>
            {item.label}: {item.ready ? "就绪" : "待配置"}
          </Tag>
        ))}
      </Space>
    </div>
  );
}
