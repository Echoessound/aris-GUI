import { Layout, Menu, Typography } from "antd";
import { BranchesOutlined, ExperimentOutlined, HomeOutlined, SettingOutlined } from "@ant-design/icons";
import { HashRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HomePage } from "./routes/HomePage";
import { ProjectDetailPage } from "./routes/ProjectDetailPage";
import { WorkflowPage } from "./routes/WorkflowPage";
import { SettingsPage } from "./routes/SettingsPage";

const { Header, Sider, Content } = Layout;

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const location = useLocation();
  const selected = location.pathname.startsWith("/workflow")
    ? "workflow"
    : location.pathname.startsWith("/settings")
      ? "settings"
      : location.pathname.startsWith("/projects")
        ? "projects"
        : "home";

  return (
    <Layout className="app-shell">
      <Sider width={248} className="app-sider">
        <div className="brand">
          <div className="brand-mark">
            <ExperimentOutlined />
          </div>
          <div>
            <Typography.Text className="brand-title">ARIS Paper Studio</Typography.Text>
            <Typography.Text className="brand-subtitle">本地科研工作台</Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          className="app-menu"
          items={[
            { key: "home", icon: <HomeOutlined />, label: <Link to="/">项目操作台</Link> },
            { key: "projects", icon: <ExperimentOutlined />, label: <Link to="/projects">项目工作区</Link> },
            { key: "workflow", icon: <BranchesOutlined />, label: <Link to="/workflow">Workflow 模板</Link> },
            { key: "settings", icon: <SettingOutlined />, label: <Link to="/settings">执行器与诊断</Link> }
          ]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Typography.Title level={4}>ARIS 论文生成与评审工作台</Typography.Title>
            <Typography.Text className="muted">把本地仓库、Codex workflow、产物预览和 Git 交付放在同一个桌面流程里。</Typography.Text>
          </div>
        </Header>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/projects" element={<ProjectDetailPage />} />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
