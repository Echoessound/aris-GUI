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
      <Sider width={236} className="app-sider">
        <div className="brand">
          <ExperimentOutlined />
          <div>
            <Typography.Text className="brand-title">ARIS Paper Studio</Typography.Text>
            <Typography.Text className="brand-subtitle">本地论文生成工作台</Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={[
            { key: "home", icon: <HomeOutlined />, label: <Link to="/">项目列表</Link> },
            { key: "projects", icon: <ExperimentOutlined />, label: <Link to="/projects">项目详情</Link> },
            { key: "workflow", icon: <BranchesOutlined />, label: <Link to="/workflow">Workflow 结构</Link> },
            { key: "settings", icon: <SettingOutlined />, label: <Link to="/settings">执行器配置</Link> }
          ]}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Title level={4}>ARIS 论文生成本地应用</Typography.Title>
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
