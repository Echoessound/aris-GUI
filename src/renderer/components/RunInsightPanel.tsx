import { Empty, Space, Tag, Timeline, Typography } from "antd";
import type { RunInsight } from "../../shared/types";

const statusColor: Record<RunInsight["status"], string> = {
  pending: "default",
  running: "blue",
  completed: "green",
  blocked: "orange",
  failed: "red"
};

const statusText: Record<RunInsight["status"], string> = {
  pending: "等待中",
  running: "进行中",
  completed: "已完成",
  blocked: "受阻",
  failed: "失败"
};

export function RunInsightPanel({ insights }: { insights: RunInsight[] }) {
  const latestRaw = dedupeByFirstAppearance(insights);
  const hasMeaningfulInsight = latestRaw.some((insight) => !isPlaceholderInsight(insight));
  const latestByStage = latestRaw
    .filter((insight) => shouldShowInsight(insight, hasMeaningfulInsight))
    .map(normalizeLegacyInsight);
  if (latestByStage.length === 0) {
    return <Empty description="运行开始后会在这里显示阶段要点" />;
  }
  return (
    <Timeline
      className="run-insight-timeline"
      items={latestByStage.map((insight) => ({
        color: statusColor[insight.status],
        children: (
          <div className="run-insight-card">
            <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
              <Space wrap>
                <Typography.Text strong>{insight.title}</Typography.Text>
                <Tag color={statusColor[insight.status]}>{statusText[insight.status]}</Tag>
              </Space>
              <Typography.Text className="muted">{insight.agentName ?? "执行器"}</Typography.Text>
            </Space>
            {insight.bullets.length > 0 && (
              <ul>
                {insight.bullets.map((item, index) => <li key={`${insight.id}-b-${index}`}>{item}</li>)}
              </ul>
            )}
            {insight.blockers.length > 0 && (
              <Typography.Paragraph type="danger" className="run-insight-note">
                阻塞：{insight.blockers.join("；")}
              </Typography.Paragraph>
            )}
            {insight.nextActions.length > 0 && (
              <Typography.Paragraph className="muted run-insight-note">
                下一步：{insight.nextActions.join("；")}
              </Typography.Paragraph>
            )}
          </div>
        )
      }))}
    />
  );
}

function dedupeByFirstAppearance(insights: RunInsight[]) {
  const stageOrder: string[] = [];
  const latestByStage = new Map<string, RunInsight>();
  for (const insight of insights) {
    if (!latestByStage.has(insight.stageKey)) {
      stageOrder.push(insight.stageKey);
    }
    latestByStage.set(insight.stageKey, insight);
  }
  return stageOrder.flatMap((stageKey) => {
    const insight = latestByStage.get(stageKey);
    return insight ? [insight] : [];
  });
}

function shouldShowInsight(insight: RunInsight, hasMeaningfulInsight: boolean) {
  if (hasMeaningfulInsight && isPlaceholderInsight(insight)) return false;
  if (insight.status !== "pending") return true;
  const hasRealContent = [...insight.bullets, ...insight.blockers, ...insight.nextActions]
    .some((item) => item && !isPlaceholderText(item));
  return hasRealContent;
}

function isPlaceholderInsight(insight: RunInsight) {
  const text = [...insight.bullets, ...insight.nextActions].join(" ");
  return insight.agentName === "ARIS Paper Studio" && isPlaceholderText(text);
}

function isPlaceholderText(text: string) {
  return /正在启动该阶段|等待前置阶段完成|等待执行器写入阶段进展|等待执行器写入真实阶段进展/.test(text);
}

function normalizeLegacyInsight(insight: RunInsight): RunInsight {
  if (insight.stageKey !== "research-lit") return insight;
  return {
    ...insight,
    title: insight.title === "research-lit" ? "文献调研（旧结构）" : insight.title
  };
}
