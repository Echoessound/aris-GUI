import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tabs, Tag, Tooltip, Typography } from "antd";
import { FolderOpenOutlined, PlayCircleOutlined, ReloadOutlined, SettingOutlined, StopOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ContinueRunInput, ExecuteEvent, Run, RunInsight, WorkflowLaunchConfig, WorkflowLaunchSettings, WorkflowType } from "../../shared/types";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";
import { AutoContinueSettingsPanel } from "../components/AutoContinueSettingsPanel";
import { ArtifactPreview } from "../components/ArtifactPreview";
import { CodexChatPanel } from "../components/CodexChatPanel";
import { GitPanel } from "../components/GitPanel";
import { LogViewer } from "../components/LogViewer";
import { ModelUsagePanel } from "../components/ModelUsagePanel";
import { RunInsightPanel } from "../components/RunInsightPanel";
import { RunTimeline } from "../components/RunTimeline";
import { WorkspaceFilesPanel } from "../components/WorkspaceFilesPanel";

const workflowOptions: Array<{ value: WorkflowType; label: string }> = [
  { value: "research-pipeline", label: "完整 research-pipeline" },
  { value: "idea-discovery", label: "仅 idea-discovery" },
  { value: "experiment-bridge", label: "仅 experiment-bridge" },
  { value: "auto-review-loop", label: "仅 auto-review-loop" },
  { value: "paper-writing", label: "论文写作 paper-writing" },
  { value: "paper-compile", label: "只生成/修复 PDF paper-compile" },
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
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [launchSettings, setLaunchSettings] = useState<WorkflowLaunchSettings>();
  const [launchDraft, setLaunchDraft] = useState<WorkflowLaunchConfig>({});
  const [launchExtraPrompt, setLaunchExtraPrompt] = useState("");
  const [launchPromptOverride, setLaunchPromptOverride] = useState("");
  const [persistLaunchSettings, setPersistLaunchSettings] = useState(false);
  const [launchPromptPreview, setLaunchPromptPreview] = useState("");
  const [launchPreviewLoading, setLaunchPreviewLoading] = useState(false);
  const [configuredContinueRun, setConfiguredContinueRun] = useState<Run>();
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
        if (project?.id) void api.artifacts.rescan(project.id, event.runId);
        void store.refreshProjectLists(project?.id);
        void store.refreshArtifacts(project?.id);
        setRunningId(undefined);
        activeRunIdRef.current = undefined;
      }
    });
    return dispose;
  }, [runningId]);

  useEffect(() => {
    if (!runningId || selectedRunId !== runningId) return;
    const timer = window.setInterval(() => {
      void api.runs.get(runningId).then((detail) => {
        setEvents(detail.events);
        setInsights(detail.insights);
        if (detail.status !== "running" && detail.status !== "waiting_approval") {
          setRunningId(undefined);
          activeRunIdRef.current = undefined;
          void store.refreshProjectLists(project?.id);
          void store.refreshArtifacts(project?.id);
        }
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [runningId, selectedRunId]);

  useEffect(() => {
    if (!runningId || !project?.id) return;
    const timer = window.setInterval(() => {
      void api.artifacts.rescan(project.id, runningId)
        .then(() => store.refreshArtifacts(project.id))
        .catch((error) => message.error(error instanceof Error ? error.message : String(error)));
    }, 12000);
    return () => window.clearInterval(timer);
  }, [runningId, project?.id]);

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

  useEffect(() => {
    if (!project?.id) return;
    void api.workflowLaunch.getSettings(project.id).then((settings) => {
      setLaunchSettings(settings);
      setLaunchDraft(settings.config);
      setLaunchExtraPrompt(settings.extraPrompt ?? "");
      setLaunchPromptOverride(settings.promptOverride ?? "");
      if (settings.config.workflowType) setWorkflowType(settings.config.workflowType);
    }).catch((error) => message.error(error instanceof Error ? error.message : String(error)));
  }, [project?.id]);

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

  async function openLaunchConfig(run?: Run) {
    try {
      const settings = await api.workflowLaunch.getSettings(activeProject.id);
      const topic = form.getFieldValue("topic") || activeProject.topic;
      const config: WorkflowLaunchConfig = {
        ...settings.config,
        workflowType: run?.workflowType ?? settings.config.workflowType ?? workflowType,
        topic: settings.config.topic || topic
      };
      setLaunchSettings(settings);
      setLaunchDraft(config);
      setLaunchExtraPrompt(settings.extraPrompt ?? "");
      setLaunchPromptOverride(settings.promptOverride ?? "");
      setPersistLaunchSettings(false);
      setConfiguredContinueRun(run);
      setLaunchModalOpen(true);
      await refreshLaunchPreview(config, settings.extraPrompt ?? "", settings.promptOverride ?? "");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshLaunchPreview(config = launchDraft, extraPrompt = launchExtraPrompt, promptOverride = launchPromptOverride) {
    setLaunchPreviewLoading(true);
    try {
      const topic = config.topic?.trim() || form.getFieldValue("topic") || activeProject.topic;
      const preview = await api.workflowLaunch.previewPrompt({
        projectId: activeProject.id,
        workflowType: config.workflowType ?? workflowType,
        topic,
        launchConfig: { ...config, topic },
        extraPrompt,
        promptOverride
      });
      setLaunchPromptPreview(preview.prompt);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunchPreviewLoading(false);
    }
  }

  function buildCurrentLaunchInput(topic: string, settings = launchSettings, extraPrompt = launchExtraPrompt, promptOverride = launchPromptOverride) {
    const base = settings?.config ?? {};
    const config: WorkflowLaunchConfig = {
      ...base,
      ...launchDraft,
      workflowType: launchDraft.workflowType ?? workflowType,
      topic: launchDraft.topic?.trim() || topic
    };
    return {
      launchConfig: config,
      extraPrompt: extraPrompt || null,
      promptOverride: promptOverride || null
    };
  }

  async function saveLaunchConfigIfNeeded() {
    if (!persistLaunchSettings) return;
    await api.workflowLaunch.saveSettings(activeProject.id, {
      config: launchDraft,
      extraPrompt: launchExtraPrompt,
      promptOverride: launchPromptOverride
    });
    message.success("已保存为项目默认 Workflow 启动配置");
  }

  async function applyLaunchModal() {
    await saveLaunchConfigIfNeeded();
    setLaunchModalOpen(false);
    if (launchDraft.workflowType) setWorkflowType(launchDraft.workflowType);
    if (configuredContinueRun) {
      await continueWorkflow(configuredContinueRun, {
        launchConfig: launchDraft,
        extraPrompt: launchExtraPrompt || null,
        promptOverride: launchPromptOverride || null
      });
    } else {
      message.success(persistLaunchSettings ? "项目默认配置已更新" : "本轮配置已就绪");
    }
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
      const settings = launchSettings ?? await api.workflowLaunch.getSettings(activeProject.id);
      if (!launchSettings) {
        setLaunchSettings(settings);
        setLaunchDraft(settings.config);
        setLaunchExtraPrompt(settings.extraPrompt ?? "");
        setLaunchPromptOverride(settings.promptOverride ?? "");
      }
      await saveLaunchConfigIfNeeded();
      const launchInput = buildCurrentLaunchInput(
        values.topic,
        settings,
        launchSettings ? launchExtraPrompt : settings.extraPrompt ?? "",
        launchSettings ? launchPromptOverride : settings.promptOverride ?? ""
      );
      setEvents([]);
      setInsights([]);
      const run = await api.runs.start({
        projectId: activeProject.id,
        workflowType: launchInput.launchConfig.workflowType ?? workflowType,
        executorId: values.defaultExecutorId ?? codexExecutor?.id,
        topic: values.topic,
        ...launchInput
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

  async function continueWorkflow(run: Run, input?: ContinueRunInput) {
    try {
      const next = await api.runs.continue(run.id, input);
      setEvents([]);
      setInsights([]);
      setRunningId(next.id);
      setSelectedRunId(next.id);
      activeRunIdRef.current = next.id;
      const detail = await api.runs.get(next.id);
      setEvents(detail.events);
      setInsights(detail.insights);
      message.success("已续接到新的 Workflow run");
      await store.refreshSelected();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function startPdfCompile() {
    try {
      if (!activeProject.repositoryId) {
        message.warning("请先绑定本地仓库。");
        return;
      }
      const values = await form.validateFields();
      const config: WorkflowLaunchConfig = {
        ...(launchSettings?.config ?? {}),
        workflowType: "paper-compile",
        topic: values.topic || activeProject.topic,
        pdfCompileMode: "codex-skill-first",
        minRuntimeMinutes: 2,
        minMarkdownChars: 800,
        autoContinueEnabled: false
      };
      setEvents([]);
      setInsights([]);
      const run = await api.runs.start({
        projectId: activeProject.id,
        workflowType: "paper-compile",
        executorId: values.defaultExecutorId ?? codexExecutor?.id,
        topic: values.topic,
        launchConfig: config,
        extraPrompt: "只执行 paper-compile：优先使用已安装的 paper-compile skill 生成或修复 paper/paper.pdf，不要重跑完整 research pipeline。"
      });
      setRunningId(run.id);
      setSelectedRunId(run.id);
      activeRunIdRef.current = run.id;
      const detail = await api.runs.get(run.id);
      setEvents(detail.events);
      setInsights(detail.insights);
      message.success("已启动 PDF 生成/修复 run");
      await store.refreshProjectLists(activeProject.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function stopContinuationChain(rootId: string) {
    try {
      const chain = await api.autoContinue.listChain(activeProject.id, rootId);
      if (!chain) {
        message.info("当前条目还没有续接链");
        return;
      }
      await api.autoContinue.stopChain(chain.id);
      message.success("已停止该续接链");
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
            <Button icon={<SettingOutlined />} onClick={() => void openLaunchConfig()} disabled={Boolean(runningId)}>
              配置本轮
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
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <AutoContinueSettingsPanel projectId={activeProject.id} title="项目自动续接" />
                </div>
              </div>
            )
          },
          {
            key: "workspace-files",
            label: "文件/数据",
            children: (
              <div className="panel">
                <WorkspaceFilesPanel projectId={activeProject.id} repositoryPath={activeProject.repository?.path} />
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
                      <Space>
                        {selectedRunId && <Typography.Text className="muted mono">{selectedRunId.slice(0, 18)}...</Typography.Text>}
                        {selectedRunId && <Button size="small" onClick={() => void stopContinuationChain(selectedRunId)}>停止续接</Button>}
                      </Space>
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
                      onContinue={(run) => void continueWorkflow(run)}
                      onConfigureContinue={(run) => void openLaunchConfig(run)}
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
                    await store.refreshArtifacts(activeProject.id);
                  }}
                  onCompilePdf={startPdfCompile}
                />
              </div>
            )
          },
          {
            key: "usage",
            label: "模型用量",
            children: (
              <div className="panel">
                <ModelUsagePanel projectId={activeProject.id} />
              </div>
            )
          },
          {
            key: "codex-chat",
            label: "Codex 对话",
            children: (
              <div className="panel">
                <CodexChatPanel projectId={activeProject.id} runs={store.runs} selectedRunId={selectedRunId} />
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
      <WorkflowLaunchModal
        open={launchModalOpen}
        title={configuredContinueRun ? "配置续接" : "配置本轮"}
        workflowType={workflowType}
        launchDraft={launchDraft}
        extraPrompt={launchExtraPrompt}
        promptOverride={launchPromptOverride}
        persist={persistLaunchSettings}
        preview={launchPromptPreview}
        previewLoading={launchPreviewLoading}
        onChange={(next) => {
          const merged = { ...launchDraft, ...next };
          setLaunchDraft(merged);
          void refreshLaunchPreview(merged);
        }}
        onExtraPromptChange={(value) => {
          setLaunchExtraPrompt(value);
          void refreshLaunchPreview(launchDraft, value, launchPromptOverride);
        }}
        onPromptOverrideChange={(value) => {
          setLaunchPromptOverride(value);
          void refreshLaunchPreview(launchDraft, launchExtraPrompt, value);
        }}
        onPersistChange={setPersistLaunchSettings}
        onRefreshPreview={() => void refreshLaunchPreview()}
        onCancel={() => setLaunchModalOpen(false)}
        onOk={() => void applyLaunchModal()}
      />
    </div>
  );
}

function WorkflowLaunchModal({
  open,
  title,
  workflowType,
  launchDraft,
  extraPrompt,
  promptOverride,
  persist,
  preview,
  previewLoading,
  onChange,
  onExtraPromptChange,
  onPromptOverrideChange,
  onPersistChange,
  onRefreshPreview,
  onCancel,
  onOk
}: {
  open: boolean;
  title: string;
  workflowType: WorkflowType;
  launchDraft: WorkflowLaunchConfig;
  extraPrompt: string;
  promptOverride: string;
  persist: boolean;
  preview: string;
  previewLoading: boolean;
  onChange(next: WorkflowLaunchConfig): void;
  onExtraPromptChange(value: string): void;
  onPromptOverrideChange(value: string): void;
  onPersistChange(value: boolean): void;
  onRefreshPreview(): void;
  onCancel(): void;
  onOk(): void;
}) {
  const effectiveWorkflowType = launchDraft.workflowType ?? workflowType;
  return (
    <Modal
      open={open}
      title={title}
      width={920}
      onCancel={onCancel}
      onOk={onOk}
      okText={title === "配置续接" ? "使用此配置续接" : "保存配置"}
      cancelText="取消"
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>
          <label className="field-inline">
            <span>Workflow 类型</span>
            <Select
              value={effectiveWorkflowType}
              options={workflowOptions}
              onChange={(value) => onChange({ workflowType: value })}
              style={{ width: 260 }}
            />
          </label>
          <label className="field-inline">
            <span>模型</span>
            <Input
              value={launchDraft.model ?? ""}
              onChange={(event) => onChange({ model: event.target.value || null })}
              placeholder="gpt-5.4 / auto"
              style={{ width: 180 }}
            />
          </label>
          <label className="field-inline">
            <span>推理强度</span>
            <Select
              value={launchDraft.reasoningEffort ?? "high"}
              options={["low", "medium", "high", "xhigh"].map((value) => ({ value, label: value }))}
              onChange={(value) => onChange({ reasoningEffort: value })}
              style={{ width: 140 }}
            />
          </label>
        </Space>
        <Input.TextArea
          rows={2}
          value={launchDraft.topic ?? ""}
          onChange={(event) => onChange({ topic: event.target.value })}
          placeholder="研究主题"
        />
        <Space wrap>
          <label className="field-inline">
            <span>沙箱模式</span>
            <Select
              value={launchDraft.sandbox ?? "danger-full-access"}
              options={["danger-full-access", "workspace-write", "read-only"].map((value) => ({ value, label: value }))}
              onChange={(value) => onChange({ sandbox: value })}
              style={{ width: 190 }}
            />
          </label>
          <label className="field-inline">
            <span>审批模式</span>
            <Select
              value={launchDraft.approval ?? "never"}
              options={["never", "on-request", "on-failure", "untrusted"].map((value) => ({ value, label: value }))}
              onChange={(value) => onChange({ approval: value })}
              style={{ width: 160 }}
            />
          </label>
          <label className="field-inline">
            <span>PDF 编译</span>
            <Select
              value={launchDraft.pdfCompileMode ?? "codex-skill-first"}
              options={[
                { value: "codex-skill-first", label: "优先 paper-compile skill" },
                { value: "local-latex-first", label: "优先本地 LaTeX" }
              ]}
              onChange={(value) => onChange({ pdfCompileMode: value })}
              style={{ width: 210 }}
            />
          </label>
          <label className="field-inline">
            <span>最少分钟</span>
            <InputNumber min={1} max={240} value={launchDraft.minRuntimeMinutes ?? 10} onChange={(value) => onChange({ minRuntimeMinutes: value ?? 10 })} />
          </label>
          <label className="field-inline">
            <span>最少 Markdown 字符</span>
            <InputNumber min={500} max={200000} step={500} value={launchDraft.minMarkdownChars ?? 12000} onChange={(value) => onChange({ minMarkdownChars: value ?? 12000 })} />
          </label>
        </Space>
        <Space wrap>
          <Space>
            <span>允许本轮自动续接</span>
            <Switch checked={launchDraft.autoContinueEnabled !== false} onChange={(checked) => onChange({ autoContinueEnabled: checked })} />
          </Space>
          <label className="field-inline">
            <span>最大续接次数</span>
            <InputNumber min={1} max={10} value={launchDraft.maxContinuations ?? 5} onChange={(value) => onChange({ maxContinuations: value ?? 5 })} />
          </label>
          <Checkbox checked={Boolean(launchDraft.rerunExistingReview)} onChange={(event) => onChange({ rerunExistingReview: event.target.checked })}>
            允许重跑已有多 Agent 评审
          </Checkbox>
          <Checkbox checked={persist} onChange={(event) => onPersistChange(event.target.checked)}>
            保存为项目默认配置
          </Checkbox>
        </Space>
        <Input.TextArea
          rows={3}
          value={extraPrompt}
          onChange={(event) => onExtraPromptChange(event.target.value)}
          placeholder="本轮附加说明：只对这次启动/续接追加，不必覆盖完整 prompt"
        />
        <Input.TextArea
          rows={4}
          value={promptOverride}
          onChange={(event) => onPromptOverrideChange(event.target.value)}
          placeholder="高级覆盖：填写后将直接作为 codex exec - 的 stdin prompt，不再拼接默认 prompt"
        />
        <div className="pane-heading">
          <Typography.Text strong>Prompt 预览</Typography.Text>
          <Button size="small" loading={previewLoading} onClick={onRefreshPreview}>刷新预览</Button>
        </div>
        <pre className="diff-viewer prompt-preview">{preview || "暂无预览"}</pre>
      </Space>
    </Modal>
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
