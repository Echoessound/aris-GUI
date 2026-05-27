import { Button, List, Space, Tag, Typography } from "antd";
import type { Run } from "../../shared/types";

export function RunTimeline({
  runs,
  selectedRunId,
  onOpen,
  onContinue,
  onConfigureContinue
}: {
  runs: Run[];
  selectedRunId?: string;
  onOpen(run: Run): void;
  onContinue?(run: Run): void;
  onConfigureContinue?(run: Run): void;
}) {
  return (
    <List
      size="small"
      dataSource={runs}
      locale={{ emptyText: "暂无运行记录" }}
      renderItem={(run) => (
        <List.Item
          className={run.id === selectedRunId ? "run-list-item-selected" : ""}
          actions={[
            <Button size="small" onClick={() => onOpen(run)} key="open">查看</Button>,
            <Button size="small" disabled={run.status === "running"} onClick={() => onContinue?.(run)} key="continue">续接</Button>,
            <Button size="small" disabled={run.status === "running"} onClick={() => onConfigureContinue?.(run)} key="configure-continue">配置续接</Button>
          ]}
        >
          <Space direction="vertical" size={2}>
            <Space wrap>
              <Typography.Text className="mono">{run.id}</Typography.Text>
              <Tag color={run.status === "failed" ? "red" : run.status === "running" ? "blue" : "green"}>{runStatusText(run.status)}</Tag>
              {Boolean(run.continuationIndex) && <Tag color="purple">第 {run.continuationIndex} 段续接</Tag>}
              {run.parentRunId && <Tag>父 run {run.parentRunId.slice(0, 10)}</Tag>}
              {run.continuationReason && <Tag color="blue">{run.continuationReason}</Tag>}
            </Space>
            <Typography.Text className="muted">
              第 {run.roundIndex} 轮 · {run.startedAt ?? "-"} · 退出码 {run.exitCode ?? "-"}
            </Typography.Text>
            {run.launchConfig && (
              <Typography.Text className="muted">
                {run.launchConfig.model ?? "默认模型"} / {run.launchConfig.reasoningEffort ?? "默认推理强度"} / 自动续接 {run.launchConfig.autoContinueEnabled === false ? "关" : "开"}
              </Typography.Text>
            )}
          </Space>
        </List.Item>
      )}
    />
  );
}

function runStatusText(status: Run["status"]) {
  if (status === "pending") return "等待中";
  if (status === "running") return "运行中";
  if (status === "waiting_approval") return "等待确认";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return "已取消";
}
