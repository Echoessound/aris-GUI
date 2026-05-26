import { Button, Form, Input, message, Modal, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProjectList } from "../components/ProjectList";
import { StartupDiagnostics } from "../components/StartupDiagnostics";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";
import type { Project } from "../../shared/types";

export function HomePage() {
  const navigate = useNavigate();
  const { projects, selectedProjectId, load, selectProject } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const recentProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) ?? projects[0], [projects, selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject() {
    const values = await form.validateFields();
    const project = await api.projects.create(values);
    message.success("项目已创建");
    setCreating(false);
    form.resetFields();
    await load();
    await selectProject(project.id);
    navigate("/projects");
  }

  async function bind(project: Project) {
    try {
      const dir = await api.repositories.chooseDirectory();
      if (!dir) return;
      await api.repositories.bindOrInit(project.id, dir);
      message.success("仓库已绑定；如果原目录不是 Git 仓库，已自动初始化");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="page-stack">
      <div className="panel">
        <div className="toolbar">
          <Space direction="vertical" size={2}>
            <Typography.Title level={4} style={{ margin: 0 }}>项目操作台</Typography.Title>
            <Typography.Text className="muted">从一个本地仓库开始，运行科研 workflow，检查产物，再把结果提交回 Git。</Typography.Text>
          </Space>
          <Space>
            {recentProject && (
              <Button onClick={async () => {
                await selectProject(recentProject.id);
                navigate("/projects");
              }}>
                继续最近项目
              </Button>
            )}
            <Button type="primary" onClick={() => setCreating(true)}>
              新建论文项目
            </Button>
          </Space>
        </div>
      </div>
      <StartupDiagnostics />
      <ProjectList
        projects={projects}
        selectedId={selectedProjectId}
        onCreate={() => setCreating(true)}
        onBind={bind}
        onSelect={async (project) => {
          await selectProject(project.id);
          navigate("/projects");
        }}
      />
      <Modal title="新建论文项目" open={creating} onOk={createProject} onCancel={() => setCreating(false)} okText="创建" cancelText="取消">
        <Form layout="vertical" form={form}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="例如：多智能体论文生成实验" />
          </Form.Item>
          <Form.Item name="topic" label="研究主题" rules={[{ required: true, message: "请输入研究主题" }]}>
            <Input.TextArea rows={3} placeholder="输入要交给 ARIS workflow 推进的研究方向" />
          </Form.Item>
          <Form.Item name="targetVenue" label="目标会议或期刊">
            <Input placeholder="NeurIPS / ACL / OSDI ..." />
          </Form.Item>
          <Form.Item name="description" label="研究方向描述">
            <Input.TextArea rows={3} placeholder="补充背景、约束、已有结果或希望生成的论文类型" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
