import { Alert, Button, Form, Input, List, message, Select, Space, Switch, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { EnvironmentDiagnostics, ExecutorConfig, ExecutorKind, SetupActionEvent, SetupActionKind } from "../../shared/types";
import { api } from "../api/electronApi";
import { AutoContinueSettingsPanel } from "../components/AutoContinueSettingsPanel";
import { useProjectStore } from "../stores/projectStore";

const executorKinds: ExecutorKind[] = ["codex-cli", "aris-code", "claude-code", "custom"];
const modelOptions = [
  { value: "auto", label: "auto（使用 Codex CLI 默认模型）" },
  { value: "gpt-5.5", label: "gpt-5.5（高阶模型）" },
  { value: "gpt-5.4", label: "gpt-5.4（默认）" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { value: "gpt-5.3-codex", label: "gpt-5.3-codex" },
  { value: "gpt-5.2", label: "gpt-5.2" }
];
const fallbackModelOptions = modelOptions.filter((option) => option.value !== "auto");
const reasoningOptions = ["low", "medium", "high", "xhigh"].map((value) => ({ value, label: value }));

export function SettingsPage() {
  const { executors, load } = useProjectStore();
  const [editing, setEditing] = useState<ExecutorConfig>();
  const [diagnostics, setDiagnostics] = useState<EnvironmentDiagnostics>();
  const [setupEvents, setSetupEvents] = useState<SetupActionEvent[]>([]);
  const [busyAction, setBusyAction] = useState<SetupActionKind>();
  const [form] = Form.useForm();
  const codexExecutor = useMemo(() => executors.find((executor) => executor.id === "executor-codex"), [executors]);

  useEffect(() => {
    void load();
    void runDiagnostics();
    const dispose = api.environment.onSetupEvent((event) => {
      setSetupEvents((current) => [...current.slice(-80), event]);
      if (event.type === "done" || event.type === "error") setBusyAction(undefined);
    });
    return dispose;
  }, []);

  useEffect(() => {
    const source = editing ?? codexExecutor;
    if (!source) return;
    setEditing(source);
    applyExecutorToForm(source);
  }, [editing?.id, codexExecutor?.id, executors.length]);

  function applyExecutorToForm(source: ExecutorConfig) {
    const env = source.env ?? {};
    form.setFieldsValue({
      ...source,
      defaultArgsText: source.defaultArgs.join(" "),
      apiKey: env.OPENAI_API_KEY ?? "",
      baseUrl: env.OPENAI_BASE_URL ?? "",
      model: env.OPENAI_MODEL ?? "gpt-5.4",
      fallbackModels: parseModelCsv(env.OPENAI_FALLBACK_MODELS ?? "gpt-5.5,gpt-5.4-mini,gpt-5.3-codex,gpt-5.2"),
      reasoningEffort: env.CODEX_REASONING_EFFORT ?? "high",
      approvalMode: env.CODEX_APPROVAL_MODE ?? "",
      sandboxMode: env.CODEX_SANDBOX_MODE ?? "",
      envText: JSON.stringify(env, null, 2)
    });
  }

  async function runDiagnostics() {
    try {
      setDiagnostics(await api.environment.diagnose());
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function runSetupAction(action: SetupActionKind) {
    setBusyAction(action);
    const result = await api.environment.runSetupAction(action);
    message[result.type === "done" ? "success" : "error"](result.message);
    await runDiagnostics();
    await load();
  }

  async function save() {
    const values = await form.validateFields();
    const advancedEnv = parseEnvJson(values.envText);
    const env = {
      ...advancedEnv,
      ...compactEnv({
        OPENAI_API_KEY: values.apiKey,
        OPENAI_BASE_URL: values.baseUrl,
        OPENAI_MODEL: values.model === "auto" ? undefined : values.model,
        OPENAI_FALLBACK_MODELS: Array.isArray(values.fallbackModels) ? values.fallbackModels.join(",") : values.fallbackModels,
        CODEX_REASONING_EFFORT: values.reasoningEffort,
        CODEX_APPROVAL_MODE: values.approvalMode,
        CODEX_SANDBOX_MODE: values.sandboxMode
      })
    };
    const saved = await api.executors.save({
      id: editing?.id,
      name: values.name,
      kind: values.kind,
      executablePath: values.executablePath,
      defaultArgs: values.defaultArgsText?.split(/\s+/).filter(Boolean) ?? [],
      workingDirectory: values.workingDirectory,
      env,
      enabled: values.enabled
    });
    setEditing(saved);
    message.success("执行器已保存");
    await load();
  }

  function restoreCodexDefaults() {
    form.setFieldsValue({
      name: "Codex CLI",
      kind: "codex-cli",
      executablePath: "codex.cmd",
      defaultArgsText: "",
      model: "gpt-5.4",
      fallbackModels: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
      reasoningEffort: "high",
      approvalMode: "never",
      sandboxMode: "danger-full-access",
      enabled: true
    });
    message.success("已恢复 Codex 默认配置，保存后生效");
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div className="panel">
        <div className="toolbar">
          <Space direction="vertical" size={2}>
            <Typography.Title level={4} style={{ margin: 0 }}>设置</Typography.Title>
            <Typography.Text className="muted">准备本机环境、配置执行器、检查 Git 与 PDF 编译能力，并设置自动续接。</Typography.Text>
          </Space>
          <Button onClick={runDiagnostics}>重新诊断</Button>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "wizard",
            label: "快速配置向导",
            children: <SetupWizard diagnostics={diagnostics} busyAction={busyAction} onAction={runSetupAction} />
          },
          {
            key: "executor",
            label: "执行器配置",
            children: (
              <ExecutorConfigPanel
                executors={executors}
                editing={editing}
                form={form}
                busyAction={busyAction}
                onEdit={(executor) => {
                  setEditing(executor);
                  applyExecutorToForm(executor);
                }}
                onNew={() => {
                  setEditing(undefined);
                  form.resetFields();
                  form.setFieldsValue({ kind: "custom", enabled: true, envText: "{}" });
                }}
                onSave={save}
                onRestoreCodexDefaults={restoreCodexDefaults}
                onAction={runSetupAction}
              />
            )
          },
          {
            key: "diagnostics",
            label: "环境诊断",
            children: <DiagnosticsPanel diagnostics={diagnostics} setupEvents={setupEvents} busyAction={busyAction} onAction={runSetupAction} />
          },
          {
            key: "tools",
            label: "工具与环境",
            children: <ToolsPanel busyAction={busyAction} onAction={runSetupAction} />
          },
          {
            key: "auto-continue",
            label: "自动续接",
            children: (
              <div className="panel">
                <AutoContinueSettingsPanel title="全局自动续接" />
              </div>
            )
          }
        ]}
      />
    </Space>
  );
}

function SetupWizard({ diagnostics, busyAction, onAction }: { diagnostics?: EnvironmentDiagnostics; busyAction?: SetupActionKind; onAction(action: SetupActionKind): void }) {
  return (
    <div className="panel">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert type="info" showIcon message="快速配置向导" description={diagnostics?.summary ?? "正在等待环境诊断结果。"} />
        <List
          dataSource={diagnostics?.checks ?? []}
          renderItem={(item) => (
            <List.Item
              actions={item.actionKind ? [<Button key="action" size="small" loading={busyAction === item.actionKind} onClick={() => onAction(item.actionKind!)}>处理</Button>] : []}
            >
              <Space direction="vertical" size={2}>
                <Space wrap>
                  <Typography.Text strong>{item.label}</Typography.Text>
                  <Tag color={checkColor(item.status)}>{checkText(item.status)}</Tag>
                </Space>
                <Typography.Text className="muted">{item.detail}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
        <Space wrap>
          <Button loading={busyAction === "install-aris-skills"} onClick={() => onAction("install-aris-skills")}>安装/更新 ARIS skills</Button>
          <Button loading={busyAction === "test-codex"} onClick={() => onAction("test-codex")}>测试 Codex</Button>
          <Button loading={busyAction === "test-git"} onClick={() => onAction("test-git")}>测试 Git</Button>
          <Button onClick={() => onAction("open-readme")}>打开 README</Button>
        </Space>
      </Space>
    </div>
  );
}

function ExecutorConfigPanel({
  executors,
  editing,
  form,
  busyAction,
  onEdit,
  onNew,
  onSave,
  onRestoreCodexDefaults,
  onAction
}: {
  executors: ExecutorConfig[];
  editing?: ExecutorConfig;
  form: ReturnType<typeof Form.useForm>[0];
  busyAction?: SetupActionKind;
  onEdit(executor: ExecutorConfig): void;
  onNew(): void;
  onSave(): void;
  onRestoreCodexDefaults(): void;
  onAction(action: SetupActionKind): void;
}) {
  return (
    <Space align="start" style={{ width: "100%" }} className="settings-layout">
      <div className="panel" style={{ width: 430 }}>
        <div className="toolbar">
          <Typography.Title level={5} style={{ margin: 0 }}>执行器</Typography.Title>
          <Button onClick={onNew}>新建</Button>
        </div>
        <List
          dataSource={executors}
          renderItem={(executor) => (
            <List.Item actions={[<Button size="small" onClick={() => onEdit(executor)} key="edit">编辑</Button>]}>
              <Space direction="vertical" size={2}>
                <Space wrap>
                  <Typography.Text strong>{executor.name}</Typography.Text>
                  <Tag color={executor.id === "executor-codex" ? "blue" : undefined}>{executor.kind}</Tag>
                  {executor.id === "executor-codex" && <Tag color="geekblue">默认</Tag>}
                  {executor.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
                </Space>
                <Typography.Text className="mono muted" ellipsis style={{ maxWidth: 320 }}>{executor.executablePath} {executor.defaultArgs.join(" ")}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </div>
      <div className="panel" style={{ flex: 1 }}>
        <Typography.Title level={5}>{editing ? "编辑执行器" : "新建执行器"}</Typography.Title>
        <Form layout="vertical" form={form} initialValues={{ kind: "codex-cli", executablePath: "codex.cmd", enabled: true, envText: "{}", model: "gpt-5.4", reasoningEffort: "high" }}>
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="name" label="名称" rules={[{ required: true }]} style={{ flex: 1, minWidth: 260 }}>
              <Input placeholder="Codex CLI" />
            </Form.Item>
            <Form.Item name="kind" label="类型" rules={[{ required: true }]} style={{ width: 180 }}>
              <Select options={executorKinds.map((kind) => ({ value: kind, label: kind }))} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="executablePath" label="可执行文件路径" rules={[{ required: true }]}>
            <Input placeholder="codex.cmd / aris / claude / cmd.exe" />
          </Form.Item>
          <Form.Item name="defaultArgsText" label="默认参数">
            <Input placeholder="例如 --version；运行 Workflow 时通常留空" />
          </Form.Item>
          <Typography.Title level={5}>Codex API 设置</Typography.Title>
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="apiKey" label="OPENAI_API_KEY" style={{ flex: 1, minWidth: 260 }}>
              <Input.Password placeholder="sk-..." />
            </Form.Item>
            <Form.Item name="baseUrl" label="OPENAI_BASE_URL" style={{ flex: 1, minWidth: 260 }}>
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item name="model" label="OPENAI_MODEL" style={{ width: 260 }}>
              <Select showSearch options={modelOptions} placeholder="gpt-5.4" />
            </Form.Item>
            <Form.Item name="reasoningEffort" label="推理强度" style={{ width: 180 }}>
              <Select options={reasoningOptions} placeholder="high" />
            </Form.Item>
          </Space>
          <Form.Item name="fallbackModels" label="OPENAI_FALLBACK_MODELS">
            <Select mode="tags" tokenSeparators={[","]} options={fallbackModelOptions} placeholder="gpt-5.5,gpt-5.4-mini,gpt-5.3-codex,gpt-5.2" />
          </Form.Item>
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="approvalMode" label="CODEX_APPROVAL_MODE" style={{ width: 240 }}>
              <Select allowClear options={[{ value: "never", label: "never" }, { value: "default", label: "default" }]} />
            </Form.Item>
            <Form.Item name="sandboxMode" label="CODEX_SANDBOX_MODE" style={{ width: 260 }}>
              <Select allowClear options={["danger-full-access", "workspace-write", "read-only"].map((value) => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="workingDirectory" label="默认工作目录" style={{ flex: 1, minWidth: 260 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="envText" label="高级环境变量 JSON">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" onClick={onSave}>保存</Button>
            <Button disabled={!editing} onClick={async () => {
              if (!editing) return;
              const result = await api.executors.test(editing.id);
              message[result.ok ? "success" : "error"](result.ok ? "执行器测试通过" : result.error ?? "执行器测试失败");
            }}>
              测试执行器
            </Button>
            <Button onClick={onRestoreCodexDefaults}>恢复 Codex 默认配置</Button>
            <Button onClick={() => onAction("open-codex-config")}>打开 Codex 配置目录</Button>
            <Button onClick={() => onAction("open-user-skills")}>打开用户 skills 目录</Button>
            <Button onClick={() => onAction("open-project-skills")}>打开项目 skills 目录</Button>
            {busyAction && <Tag color="blue">正在执行：{setupActionText(busyAction)}</Tag>}
          </Space>
        </Form>
      </div>
    </Space>
  );
}

function DiagnosticsPanel({ diagnostics, setupEvents, busyAction, onAction }: { diagnostics?: EnvironmentDiagnostics; setupEvents: SetupActionEvent[]; busyAction?: SetupActionKind; onAction(action: SetupActionKind): void }) {
  return (
    <div className="panel">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>
          <Typography.Text strong>环境诊断</Typography.Text>
          {diagnostics && <Tag>{diagnostics.checkedAt}</Tag>}
          <Button loading={busyAction === "install-aris-skills"} onClick={() => onAction("install-aris-skills")}>安装/更新 ARIS skills</Button>
        </Space>
        <List
          size="small"
          dataSource={diagnostics?.checks ?? []}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" size={2}>
                <Space wrap>
                  <Tag color={checkColor(item.status)}>{checkText(item.status)}</Tag>
                  <Typography.Text strong>{item.label}</Typography.Text>
                </Space>
                <Typography.Text className="muted">{item.detail}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
        <Typography.Text strong>实时日志</Typography.Text>
        <pre className="diagnostic-output mono">
          {setupEvents.length ? setupEvents.map((event) => `[${event.timestamp}] ${event.action} ${event.type}: ${event.message}`).join("\n") : "暂无设置动作日志"}
        </pre>
      </Space>
    </div>
  );
}

function ToolsPanel({ busyAction, onAction }: { busyAction?: SetupActionKind; onAction(action: SetupActionKind): void }) {
  const actions: Array<{ action: SetupActionKind; label: string }> = [
    { action: "open-codex-config", label: "打开 Codex 配置目录" },
    { action: "open-user-skills", label: "打开用户 skills 目录" },
    { action: "open-project-skills", label: "打开项目 skills 目录" },
    { action: "open-readme", label: "打开 README" },
    { action: "open-aris-release", label: "打开 ARIS 官网/发布页" },
    { action: "test-codex", label: "测试 Codex CLI" },
    { action: "test-git", label: "测试 Git" }
  ];
  return (
    <div className="panel">
      <Space wrap>
        {actions.map((item) => (
          <Button key={item.action} loading={busyAction === item.action} onClick={() => onAction(item.action)}>
            {item.label}
          </Button>
        ))}
      </Space>
    </div>
  );
}

function parseEnvJson(value?: string): Record<string, string> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === "string")) as Record<string, string>;
}

function compactEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value && value.trim())) as Record<string, string>;
}

function parseModelCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function checkColor(status: EnvironmentDiagnostics["checks"][number]["status"]) {
  if (status === "ok") return "green";
  if (status === "running") return "blue";
  if (status === "warning") return "orange";
  return "red";
}

function checkText(status: EnvironmentDiagnostics["checks"][number]["status"]) {
  if (status === "ok") return "已就绪";
  if (status === "running") return "检查中";
  if (status === "warning") return "需确认";
  return "缺失";
}

function setupActionText(action: SetupActionKind) {
  const labels: Record<SetupActionKind, string> = {
    "install-aris-skills": "安装/更新 ARIS skills",
    "test-codex": "测试 Codex",
    "test-git": "测试 Git",
    "open-codex-config": "打开 Codex 配置目录",
    "open-user-skills": "打开用户 skills 目录",
    "open-project-skills": "打开项目 skills 目录",
    "open-readme": "打开 README",
    "open-aris-release": "打开 ARIS 发布页"
  };
  return labels[action];
}
