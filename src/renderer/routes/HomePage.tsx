import { Button, Form, Input, message, Modal } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProjectList } from "../components/ProjectList";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";
import type { Project } from "../../shared/types";

export function HomePage() {
  const navigate = useNavigate();
  const { projects, selectedProjectId, load, selectProject } = useProjectStore();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();

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
    <>
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
            <Input.TextArea rows={3} placeholder="输入要交给 ARIS workflow 的研究方向" />
          </Form.Item>
          <Form.Item name="targetVenue" label="目标会议或期刊">
            <Input placeholder="NeurIPS / ACL / OSDI ..." />
          </Form.Item>
          <Form.Item name="description" label="研究方向描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
        <Button hidden />
      </Modal>
    </>
  );
}
