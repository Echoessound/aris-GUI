import { Empty, Space, Statistic, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import type { ModelUsageEvent, ModelUsageSummary } from "../../shared/types";
import { api } from "../api/electronApi";

interface ModelUsagePanelProps {
  projectId: string;
}

export function ModelUsagePanel({ projectId }: ModelUsagePanelProps) {
  const [events, setEvents] = useState<ModelUsageEvent[]>([]);
  const [summary, setSummary] = useState<ModelUsageSummary>();

  useEffect(() => {
    void Promise.all([api.usage.list(projectId), api.usage.summary(projectId)]).then(([nextEvents, nextSummary]) => {
      setEvents(nextEvents);
      setSummary(nextSummary);
    });
  }, [projectId]);

  if (!summary || events.length === 0) {
    return <Empty description="该项目还没有真实上报的 token 用量。运行 Codex JSON 日志里出现 usage 字段后会自动记录。" />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <div className="usage-summary-grid">
        <Statistic title="总 Tokens" value={summary.totalTokens} />
        <Statistic title="输入 Tokens" value={summary.totalInputTokens} />
        <Statistic title="输出 Tokens" value={summary.totalOutputTokens} />
        <Statistic title="缓存输入" value={summary.totalCachedInputTokens} />
      </div>
      <div className="usage-columns">
        <div className="panel-tight usage-card">
          <Typography.Text strong>按模型</Typography.Text>
          <Table
            size="small"
            rowKey="model"
            pagination={false}
            dataSource={summary.byModel}
            columns={[
              { title: "模型", dataIndex: "model" },
              { title: "总量", dataIndex: "totalTokens" },
              { title: "事件", dataIndex: "eventCount" }
            ]}
          />
        </div>
        <div className="panel-tight usage-card">
          <Typography.Text strong>按日期</Typography.Text>
          <Table
            size="small"
            rowKey="day"
            pagination={false}
            dataSource={summary.byDay}
            columns={[
              { title: "日期", dataIndex: "day" },
              { title: "总量", dataIndex: "totalTokens" },
              { title: "事件", dataIndex: "eventCount" }
            ]}
          />
        </div>
      </div>
      <Table
        size="small"
        rowKey="id"
        dataSource={events}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "时间", dataIndex: "createdAt", width: 190 },
          { title: "来源", dataIndex: "source", width: 90, render: (source: string) => <Tag>{source}</Tag> },
          { title: "模型", dataIndex: "model", width: 150 },
          { title: "思考水平", dataIndex: "reasoningEffort", width: 110 },
          { title: "输入", dataIndex: "inputTokens", width: 90 },
          { title: "输出", dataIndex: "outputTokens", width: 90 },
          { title: "缓存", dataIndex: "cachedInputTokens", width: 90 },
          { title: "总量", dataIndex: "totalTokens", width: 90 },
          {
            title: "Run / Chat",
            render: (_value, item) => <Typography.Text className="mono" ellipsis>{item.runId ?? item.chatMessageId ?? "-"}</Typography.Text>
          }
        ]}
      />
    </Space>
  );
}
