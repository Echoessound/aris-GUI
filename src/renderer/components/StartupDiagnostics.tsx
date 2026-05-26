import { Alert, Button, Space, Tag, Typography } from "antd";
import { CheckCircleOutlined, LoadingOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import type { ArisDiagnostics } from "../../shared/types";
import { api } from "../api/electronApi";

type DiagnosticState = "checking" | "ready" | "warning";

export function StartupDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<ArisDiagnostics>();
  const [state, setState] = useState<DiagnosticState>("checking");

  async function runDiagnostics() {
    setState("checking");
    try {
      const result = await api.executors.diagnoseAris();
      setDiagnostics(result);
      setState(result.found && result.skillsFound ? "ready" : "warning");
    } catch (error) {
      setDiagnostics({
        found: false,
        skillsFound: false,
        installHint: "启动诊断执行失败，请进入执行器配置页手动检查 ARIS CLI 和 ARIS skills。",
        error: error instanceof Error ? error.message : String(error)
      });
      setState("warning");
    }
  }

  useEffect(() => {
    void runDiagnostics();
  }, []);

  const ready = state === "ready";
  const icon = state === "checking" ? <LoadingOutlined /> : ready ? <CheckCircleOutlined /> : <WarningOutlined />;
  const type = state === "checking" ? "info" : ready ? "success" : "warning";

  return (
    <Alert
      className="startup-diagnostics"
      type={type}
      showIcon
      icon={icon}
      message={
        <Space wrap>
          <Typography.Text strong>启动诊断</Typography.Text>
          <StatusTag label="ARIS CLI" ok={diagnostics?.found} checking={state === "checking"} />
          <StatusTag label="ARIS skills" ok={diagnostics?.skillsFound} checking={state === "checking"} />
          <StatusTag label="Codex" ok={diagnostics?.codexFound} checking={state === "checking"} />
          <StatusTag label="Claude" ok={diagnostics?.claudeFound} checking={state === "checking"} optional />
        </Space>
      }
      description={
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Typography.Text>
            {state === "checking" ? "正在检查 ARIS CLI、Codex/Claude 执行器和 ARIS skills 安装状态。" : diagnostics?.installHint}
          </Typography.Text>
          {diagnostics?.skillLocations?.length ? (
            <Typography.Text className="mono muted">skills: {diagnostics.skillLocations.join("; ")}</Typography.Text>
          ) : null}
          {diagnostics?.versionOutput && <pre className="diagnostic-output mono">{diagnostics.versionOutput}</pre>}
          {diagnostics?.latestReleaseUrl && (
            <Typography.Link href={diagnostics.latestReleaseUrl}>
              官方 latest release：{diagnostics.latestReleaseName ?? diagnostics.latestReleaseUrl}
            </Typography.Link>
          )}
          {diagnostics?.error && <Typography.Text type="danger">{diagnostics.error}</Typography.Text>}
          <Button size="small" icon={<ReloadOutlined />} loading={state === "checking"} onClick={runDiagnostics}>
            重新诊断
          </Button>
        </Space>
      }
    />
  );
}

function StatusTag({ label, ok, checking, optional }: { label: string; ok?: boolean; checking: boolean; optional?: boolean }) {
  if (checking) return <Tag color="blue">{label}: 检查中</Tag>;
  if (ok) return <Tag color="green">{label}: 已就绪</Tag>;
  return <Tag color={optional ? "default" : "orange"}>{label}: {optional ? "可选" : "待配置"}</Tag>;
}
