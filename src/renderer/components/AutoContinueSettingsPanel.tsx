import { Button, Form, InputNumber, message, Select, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import type { AutoContinueSettings } from "../../shared/types";
import { api } from "../api/electronApi";

interface AutoContinueSettingsPanelProps {
  projectId?: string | null;
  title?: string;
}

export function AutoContinueSettingsPanel({ projectId = null, title = "自动续接" }: AutoContinueSettingsPanelProps) {
  const [settings, setSettings] = useState<AutoContinueSettings>();
  const [form] = Form.useForm();

  async function load() {
    const next = await api.autoContinue.getSettings(projectId);
    setSettings(next);
    form.setFieldsValue(next);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function save() {
    const values = await form.validateFields();
    const next = await api.autoContinue.saveSettings(projectId, values);
    setSettings(next);
    form.setFieldsValue(next);
    message.success("自动续接设置已保存");
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space direction="vertical" size={2}>
        <Typography.Title level={5} style={{ margin: 0 }}>{title}</Typography.Title>
        <Typography.Text className="muted">
          当 run 或对话没有真正完成时，使用交接摘要启动新的 Codex 会话继续推进；达到链路上限后自动停止。
        </Typography.Text>
        {projectId && (
          <Typography.Text className="muted">
            来源：{settings?.projectId ? "项目覆盖设置" : "继承全局设置"}。生效范围：{scopeText(settings?.scope ?? "all")}，最大续接次数：{settings?.maxContinuations ?? 5}。
          </Typography.Text>
        )}
        {settings?.updatedAt && <Typography.Text className="muted mono">更新时间：{settings.updatedAt}</Typography.Text>}
      </Space>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          enabled: true,
          scope: "all",
          fullyAutomatic: true,
          maxContinuations: 5,
          triggerOnFailure: true,
          triggerOnTimeout: true,
          triggerOnPartialArtifacts: true,
          triggerOnQualityRisk: true,
          inheritExecutorModel: true
        }}
      >
        <Space align="start" wrap>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="fullyAutomatic" label="全自动" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="scope" label="范围" style={{ width: 190 }}>
            <Select
              options={[
                { value: "all", label: "对话 + Workflow" },
                { value: "chat", label: "仅 Codex 对话" },
                { value: "workflow", label: "仅 Workflow" }
              ]}
            />
          </Form.Item>
          <Form.Item name="maxContinuations" label="最大次数" style={{ width: 130 }}>
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="inheritExecutorModel" label="继承执行器模型" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Space align="start" wrap>
          <Form.Item name="triggerOnFailure" label="失败时续接" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="triggerOnTimeout" label="超时时续接" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="triggerOnPartialArtifacts" label="产物不完整时续接" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="triggerOnQualityRisk" label="质量风险时续接" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Button type="primary" onClick={save}>保存自动续接</Button>
      </Form>
    </Space>
  );
}

function scopeText(scope: AutoContinueSettings["scope"]) {
  if (scope === "chat") return "仅 Codex 对话";
  if (scope === "workflow") return "仅 Workflow";
  return "对话 + Workflow";
}
