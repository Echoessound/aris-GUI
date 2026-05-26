import { Button, List, Space, Tag, Typography } from "antd";
import type { Run } from "../../shared/types";

export function RunTimeline({ runs, selectedRunId, onOpen }: { runs: Run[]; selectedRunId?: string; onOpen(run: Run): void }) {
  return (
    <List
      size="small"
      dataSource={runs}
      locale={{ emptyText: "暂无运行记录" }}
      renderItem={(run) => (
        <List.Item className={run.id === selectedRunId ? "run-list-item-selected" : ""} actions={[<Button size="small" onClick={() => onOpen(run)} key="open">查看</Button>]}>
          <Space direction="vertical" size={2}>
            <Space wrap>
              <Typography.Text className="mono">{run.id}</Typography.Text>
              <Tag color={run.status === "failed" ? "red" : run.status === "running" ? "blue" : "green"}>{run.status}</Tag>
            </Space>
            <Typography.Text className="muted">
              第 {run.roundIndex} 轮 · {run.startedAt ?? "-"} · 退出码 {run.exitCode ?? "-"}
            </Typography.Text>
          </Space>
        </List.Item>
      )}
    />
  );
}
