import { Button, Form, Input, List, message, Select, Space, Switch, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import type { ArisDiagnostics, ExecutorConfig, ExecutorKind } from "../../shared/types";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";

const executorKinds: ExecutorKind[] = ["codex-cli", "aris-code", "claude-code", "custom"];
const modelOptions = [
  { value: "auto", label: "auto（使用 Codex CLI 默认模型）" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { value: "gpt-5.3-codex", label: "gpt-5.3-codex" },
  { value: "gpt-5.2", label: "gpt-5.2" },
  { value: "gpt-5.4", label: "gpt-5.4（可能容量紧张）" }
];
const fallbackModelOptions = modelOptions.filter((option) => option.value !== "auto");

export function SettingsPage() {
  const { executors, load } = useProjectStore();
  const [editing, setEditing] = useState<ExecutorConfig>();
  const [diagnostics, setDiagnostics] = useState<ArisDiagnostics>();
  const [form] = Form.useForm();

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const source = editing ?? executors.find((executor) => executor.id === "executor-codex");
    if (!source) return;
    const env = source.env ?? {};
    setEditing(source);
    form.setFieldsValue({
      ...source,
      defaultArgsText: source.defaultArgs.join(" "),
      apiKey: env.OPENAI_API_KEY ?? "",
      baseUrl: env.OPENAI_BASE_URL ?? "",
      model: env.OPENAI_MODEL ?? "auto",
      fallbackModels: parseModelCsv(env.OPENAI_FALLBACK_MODELS ?? "gpt-5.4-mini,gpt-5.3-codex,gpt-5.2"),
      approvalMode: env.CODEX_APPROVAL_MODE ?? "",
      sandboxMode: env.CODEX_SANDBOX_MODE ?? "",
      envText: JSON.stringify(env, null, 2)
    });
  }, [editing?.id, executors.length]);

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

  return (
    <Space align="start" style={{ width: "100%" }} className="settings-layout">
      <div className="panel" style={{ width: 430 }}>
        <div className="toolbar">
          <Typography.Title level={5} style={{ margin: 0 }}>执行器</Typography.Title>
          <Button
            onClick={() => {
              setEditing(undefined);
              form.resetFields();
              form.setFieldsValue({ kind: "custom", enabled: true, envText: "{}" });
            }}
          >
            新建
          </Button>
        </div>
        <List
          dataSource={executors}
          renderItem={(executor) => (
            <List.Item actions={[<Button size="small" onClick={() => setEditing(executor)} key="edit">编辑</Button>]}>
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
        <Button
          style={{ marginTop: 12 }}
          onClick={async () => {
            const result = await api.executors.diagnoseAris();
            setDiagnostics(result);
          }}
        >
          诊断 ARIS / Codex 环境
        </Button>
        {diagnostics && (
          <div style={{ marginTop: 12 }}>
            <Tag color={diagnostics.found ? "green" : "orange"}>{diagnostics.found ? "已找到 ARIS" : "未找到 ARIS"}</Tag>
            {diagnostics.codexFound !== undefined && <Tag color={diagnostics.codexFound ? "green" : "orange"}>{diagnostics.codexFound ? "Codex 可用" : "Codex 未找到"}</Tag>}
            {diagnostics.claudeFound !== undefined && <Tag color={diagnostics.claudeFound ? "green" : "default"}>{diagnostics.claudeFound ? "Claude 可用" : "Claude 未找到"}</Tag>}
            <Typography.Paragraph className="muted">{diagnostics.installHint}</Typography.Paragraph>
            {diagnostics.latestReleaseUrl && (
              <Typography.Link href={diagnostics.latestReleaseUrl}>官方 latest release：{diagnostics.latestReleaseName ?? diagnostics.latestReleaseUrl}</Typography.Link>
            )}
            {diagnostics.versionOutput && <pre className="diagnostic-output mono">{diagnostics.versionOutput}</pre>}
            {diagnostics.error && <Typography.Text type="danger">{diagnostics.error}</Typography.Text>}
          </div>
        )}
      </div>
      <div className="panel" style={{ flex: 1 }}>
        <Typography.Title level={5}>{editing ? "编辑执行器" : "新建执行器"}</Typography.Title>
        <Form layout="vertical" form={form} initialValues={{ kind: "codex-cli", executablePath: "codex", enabled: true, envText: "{}" }}>
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
            <Input placeholder="codex / aris / claude / cmd.exe" />
          </Form.Item>
          <Form.Item name="defaultArgsText" label="默认参数">
            <Input placeholder="例如 --version，或留空让 Workflow 启动时自动拼接" />
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
              <Select showSearch options={modelOptions} placeholder="auto" />
            </Form.Item>
          </Space>
          <Form.Item name="fallbackModels" label="OPENAI_FALLBACK_MODELS">
            <Select mode="tags" tokenSeparators={[","]} options={fallbackModelOptions} placeholder="gpt-5.4-mini,gpt-5.3-codex,gpt-5.2" />
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
          <Space>
            <Button type="primary" onClick={save}>保存</Button>
            <Button
              disabled={!editing}
              onClick={async () => {
                if (!editing) return;
                const result = await api.executors.test(editing.id);
                message[result.ok ? "success" : "error"](result.ok ? "执行器测试通过" : result.error ?? "执行器测试失败");
              }}
            >
              测试
            </Button>
          </Space>
        </Form>
      </div>
    </Space>
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
