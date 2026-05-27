import { Alert, Button, Input, List, message, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { BranchesOutlined, CloudDownloadOutlined, CloudUploadOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import type { GitBranchInfo, GitDeliveryResult, GitIgnoredSummary, GitStatus, Project } from "../../shared/types";
import { api } from "../api/electronApi";

export function GitPanel({ project }: { project: Project }) {
  const [status, setStatus] = useState<GitStatus>();
  const [ignoredSummary, setIgnoredSummary] = useState<GitIgnoredSummary>();
  const [deliveryResult, setDeliveryResult] = useState<GitDeliveryResult>();
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>();
  const [newBranchName, setNewBranchName] = useState("codex/");
  const [diff, setDiff] = useState("");
  const [messageText, setMessageText] = useState("");
  const [history, setHistory] = useState<Array<{ hash: string; message: string; date: string }>>([]);
  const [busy, setBusy] = useState(false);
  const repositoryId = project.repositoryId;

  async function refresh() {
    if (!repositoryId) return;
    setBusy(true);
    try {
      const [nextStatus, nextDiff, nextHistory, nextBranches, nextIgnored] = await Promise.all([
        api.repositories.status(repositoryId),
        api.repositories.diff(repositoryId),
        api.repositories.history(repositoryId),
        api.repositories.listBranches(repositoryId),
        api.repositories.ignoredSummary(repositoryId)
      ]);
      setStatus(nextStatus);
      setDiff(nextDiff);
      setHistory(nextHistory);
      setBranches(nextBranches);
      setIgnoredSummary(nextIgnored);
      setSelectedBranch(nextBranches.find((branch) => branch.current)?.name ?? nextStatus.branch);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [repositoryId]);

  async function runGitAction(action: () => Promise<unknown>, successText: string) {
    if (!repositoryId) return;
    setBusy(true);
    try {
      await action();
      message.success(successText);
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createAndCheckoutBranch() {
    const branchName = normalizeBranchInput(newBranchName);
    if (!branchName) {
      message.warning("请输入分支名");
      return;
    }
    await runGitAction(() => api.repositories.createBranch(repositoryId!, branchName, true), `已创建并切换到 ${branchName}`);
  }

  async function checkoutSelectedBranch() {
    if (!selectedBranch || selectedBranch === status?.branch) return;
    if (status?.isDirty) {
      message.warning("工作区还有未提交改动，请先提交或取消改动后再切换分支。");
      return;
    }
    await runGitAction(() => api.repositories.checkoutBranch(repositoryId!, selectedBranch), `已切换到 ${selectedBranch}`);
  }

  async function prepareDelivery() {
    if (!repositoryId) return;
    setBusy(true);
    try {
      const result = await api.repositories.prepareDelivery(repositoryId);
      setDeliveryResult(result);
      setMessageText(result.suggestedCommitMessage);
      message.success("Git 交付包已生成");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!repositoryId) return <Typography.Text className="muted">绑定 Git 仓库后可查看 diff、分支、commit、pull 和 push。</Typography.Text>;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Space wrap>
        <Tag color={status?.isDirty ? "orange" : "green"}>{status?.isDirty ? "有未提交改动" : "工作区干净"}</Tag>
        <Typography.Text>当前分支：{status?.branch ?? "-"}</Typography.Text>
        <Typography.Text>领先 {status?.ahead ?? 0} / 落后 {status?.behind ?? 0}</Typography.Text>
        <Typography.Text>origin：{status?.remoteOrigin ?? "未配置"}</Typography.Text>
        <Button icon={<ReloadOutlined />} loading={busy} onClick={refresh}>刷新</Button>
      </Space>

      <div className="git-summary">
        <SummaryItem label="已暂存 staged" value={status?.staged.length ?? 0} />
        <SummaryItem label="未暂存 unstaged" value={status?.unstaged.length ?? 0} />
        <SummaryItem label="未跟踪 untracked" value={status?.untracked.length ?? 0} />
        <SummaryItem label="被忽略 ignored" value={ignoredSummary?.ignoredCount ?? 0} />
      </div>

      {!status?.isDirty && Boolean(ignoredSummary?.likelyArtifactCount) && (
        <Alert
          type="warning"
          showIcon
          message="工作区看起来无可提交，但存在被忽略的产物"
          description={`检测到 ${ignoredSummary?.likelyArtifactCount ?? 0} 个可能位于 ignored 目录的产物。可以生成 Git 交付包，把研究产物复制到可追踪目录后再提交。`}
          action={<Button size="small" onClick={prepareDelivery}>生成 Git 交付包</Button>}
        />
      )}

      <div className="git-branch-panel panel-tight">
        <div className="pane-heading">
          <Typography.Text strong>分支操作</Typography.Text>
          <Tag>{branches.length} 个本地分支</Tag>
        </div>
        <Space wrap>
          <Input
            prefix={<BranchesOutlined />}
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder="codex/new-branch"
            style={{ width: 260 }}
          />
          <Button icon={<PlusOutlined />} loading={busy} onClick={createAndCheckoutBranch}>
            创建并切换
          </Button>
          <Select
            value={selectedBranch}
            onChange={setSelectedBranch}
            options={branches.map((branch) => ({ value: branch.name, label: branch.current ? `${branch.name}（当前）` : branch.name }))}
            style={{ width: 260 }}
          />
          <Button loading={busy} disabled={!selectedBranch || selectedBranch === status?.branch} onClick={checkoutSelectedBranch}>
            切换分支
          </Button>
          <Button
            icon={<CloudDownloadOutlined />}
            loading={busy}
            disabled={!status?.remoteOrigin || status?.isDirty}
            onClick={() => runGitAction(() => api.repositories.pull(repositoryId), "已从 origin pull 当前分支")}
          >
            Pull
          </Button>
          <Popconfirm
            title="确认 push 当前分支？"
            description="会执行 push 并设置 upstream；请确认当前提交内容已经检查。"
            okText="Push"
            cancelText="取消"
            onConfirm={() => runGitAction(() => api.repositories.push(repositoryId), "已 push 当前分支并设置 upstream")}
          >
            <Button icon={<CloudUploadOutlined />} loading={busy} disabled={!status?.remoteOrigin || status?.isDirty}>
              Push
            </Button>
          </Popconfirm>
        </Space>
        {status?.isDirty && <Typography.Text className="muted">工作区 dirty 时，切换分支、pull、push 会被阻止，请先提交或取消改动。</Typography.Text>}
        {!status?.remoteOrigin && <Typography.Text className="muted">当前没有 origin remote。请在终端执行 `git remote add origin &lt;你的仓库地址&gt;` 后再 push；应用不会自动配置远端。</Typography.Text>}
      </div>

      <Space wrap>
        <Button
          loading={busy}
          disabled={!status?.isDirty}
          onClick={() => runGitAction(() => api.repositories.stageAll(repositoryId), "已执行 git add .")}
        >
          全部暂存（git add .）
        </Button>
        <Button loading={busy} onClick={prepareDelivery}>
          生成 Git 交付包
        </Button>
      </Space>

      {ignoredSummary?.ignoredSamples.length ? (
        <Typography.Text className="muted">ignored 示例：{ignoredSummary.ignoredSamples.slice(0, 5).join("；")}</Typography.Text>
      ) : null}
      {deliveryResult && (
        <Alert
          type="success"
          showIcon
          message="交付包已准备"
          description={`目录：${deliveryResult.deliveryDir}；摘要：${deliveryResult.summaryPath}；建议 commit message：${deliveryResult.suggestedCommitMessage}`}
        />
      )}

      <pre className="diff-viewer">{diff || "当前没有 diff"}</pre>
      <Space.Compact style={{ width: "100%" }}>
        <Input value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="提交说明 commit message" />
        <Button
          type="primary"
          loading={busy}
          disabled={!messageText.trim() || !status?.isDirty}
          onClick={() => runGitAction(async () => {
            await api.repositories.commit(repositoryId, messageText);
            setMessageText("");
          }, "已提交到 Git")}
        >
          提交
        </Button>
      </Space.Compact>
      <List
        size="small"
        header="最近 commit"
        dataSource={history}
        renderItem={(item) => (
          <List.Item>
            <Space direction="vertical" size={0}>
              <Typography.Text>{item.message}</Typography.Text>
              <Typography.Text className="muted mono">{item.hash.slice(0, 10)} - {item.date}</Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    </Space>
  );
}

function normalizeBranchInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("codex/") ? trimmed : `codex/${trimmed}`;
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="status-tile panel-tight">
      <span className="status-label">{label}</span>
      <span className="status-value">{value}</span>
    </div>
  );
}
