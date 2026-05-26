import { Button, Form, Input, message, Popconfirm, Select, Space, Switch, Typography } from "antd";
import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MiniMap, type Node, addEdge, useEdgesState, useNodesState, type Connection } from "reactflow";
import type { WorkflowTemplateDetail } from "../../shared/types";
import { api } from "../api/electronApi";
import { useProjectStore } from "../stores/projectStore";

export function WorkflowPage() {
  const { workflows, load } = useProjectStore();
  const [templateId, setTemplateId] = useState<string>();
  const [detail, setDetail] = useState<WorkflowTemplateDetail>();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node>();
  const [form] = Form.useForm();

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const id = templateId ?? workflows[0]?.id;
    if (!id) return;
    setTemplateId(id);
    void loadTemplate(id);
  }, [templateId, workflows]);

  const nodeById = useMemo(() => new Map(detail?.nodes.map((node) => [node.id, node]) ?? []), [detail]);

  function applyTemplateDetail(next: WorkflowTemplateDetail) {
    setDetail(next);
    setNodes(
      next.nodes.map((node) => ({
        id: node.id,
        position: { x: node.positionX, y: node.positionY },
        data: { label: `${node.enabled ? "" : "[停用] "}${node.name}` },
        style: {
          border: node.enabled ? "1px solid #8fb2ff" : "1px dashed #c9d3e3",
          background: node.enabled ? "#ffffff" : "#f8fafc",
          color: node.enabled ? "#182235" : "#667085",
          borderRadius: 8,
          padding: 10,
          minWidth: 160
        }
      }))
    );
    setEdges(next.edges.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId })));
    setSelectedNode(undefined);
    form.resetFields();
  }

  async function loadTemplate(id: string) {
    applyTemplateDetail(await api.workflows.getTemplate(id));
  }

  useEffect(() => {
    const source = selectedNode ? nodeById.get(selectedNode.id) : undefined;
    if (source) {
      form.setFieldsValue({
        nodeKey: source.nodeKey,
        name: source.name,
        command: source.command,
        argsText: source.args.join(" "),
        inputFilesText: source.inputFiles?.join("\n"),
        outputFilesText: source.outputFiles?.join("\n"),
        enabled: source.enabled,
        requiresApproval: source.requiresApproval,
        failurePolicy: source.failurePolicy
      });
    }
  }, [selectedNode, nodeById]);

  function onConnect(connection: Connection) {
    setEdges((current) => addEdge({ ...connection, id: `edge-${Date.now()}` }, current));
  }

  async function save() {
    if (!detail) return;
    const updatedNodes = nodes.map((node) => {
      const existing = nodeById.get(node.id);
      const values = selectedNode?.id === node.id ? form.getFieldsValue() : {};
      return {
        id: node.id,
        nodeKey: values.nodeKey ?? existing?.nodeKey ?? node.id,
        name: values.name ?? existing?.name ?? String(node.data.label),
        command: values.command ?? existing?.command ?? "",
        args: values.argsText ? String(values.argsText).split(/\s+/).filter(Boolean) : existing?.args ?? [],
        inputFiles: values.inputFilesText ? String(values.inputFilesText).split(/\r?\n/).filter(Boolean) : existing?.inputFiles ?? [],
        outputFiles: values.outputFilesText ? String(values.outputFilesText).split(/\r?\n/).filter(Boolean) : existing?.outputFiles ?? [],
        enabled: values.enabled ?? existing?.enabled ?? true,
        requiresApproval: values.requiresApproval ?? existing?.requiresApproval ?? false,
        failurePolicy: values.failurePolicy ?? existing?.failurePolicy ?? "stop",
        positionX: node.position.x,
        positionY: node.position.y
      };
    });
    await api.workflows.saveTemplate({
      id: detail.id,
      name: detail.name,
      description: detail.description ?? undefined,
      isDefault: detail.isDefault,
      nodes: updatedNodes,
      edges: edges.map((edge) => ({ id: edge.id, sourceNodeId: edge.source, targetNodeId: edge.target }))
    });
    message.success("Workflow 模板已保存");
  }

  function addNode() {
    const node: Node = {
      id: `node-${Date.now()}`,
      position: { x: 100, y: 100 },
      data: { label: "new-node" }
    };
    setNodes((current) => [...current, node]);
    setSelectedNode(node);
  }

  function deleteSelectedNode() {
    if (!selectedNode) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    setSelectedNode(undefined);
    form.resetFields();
    message.success("节点已删除，保存模板后生效");
  }

  async function restoreDefaultStructure() {
    if (!templateId) return;
    const next = await api.workflows.resetTemplate(templateId);
    applyTemplateDetail(next);
    await load();
    message.success("已恢复默认 Workflow 结构");
  }

  return (
    <Space align="start" style={{ width: "100%" }} className="workflow-layout">
      <div className="panel" style={{ flex: 1 }}>
        <div className="toolbar">
          <Space wrap>
            <Select style={{ width: 280 }} value={templateId} options={workflows.map((item) => ({ value: item.id, label: item.name }))} onChange={setTemplateId} />
            <Button onClick={addNode}>添加节点</Button>
            <Button danger icon={<DeleteOutlined />} disabled={!selectedNode} onClick={deleteSelectedNode}>删除节点</Button>
            <Popconfirm
              title="恢复默认 Workflow 结构？"
              description="当前模板的节点和连线会被默认结构覆盖。"
              okText="恢复"
              cancelText="取消"
              onConfirm={restoreDefaultStructure}
            >
              <Button icon={<UndoOutlined />}>恢复默认结构</Button>
            </Popconfirm>
            <Button type="primary" onClick={save}>保存模板</Button>
          </Space>
          <Typography.Text className="muted">拖拽节点并连接依赖关系，保存后用于后续运行。</Typography.Text>
        </div>
        <div className="workflow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            fitView
          >
            <MiniMap pannable zoomable />
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>
      <div className="panel" style={{ width: 360 }}>
        <Typography.Title level={5}>节点配置</Typography.Title>
        {selectedNode ? (
          <Form layout="vertical" form={form}>
            <Form.Item name="nodeKey" label="节点 key"><Input /></Form.Item>
            <Form.Item name="name" label="节点名称"><Input /></Form.Item>
            <Form.Item name="command" label="节点命令"><Input /></Form.Item>
            <Form.Item name="argsText" label="参数"><Input /></Form.Item>
            <Form.Item name="inputFilesText" label="输入文件"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="outputFilesText" label="输出文件"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="requiresApproval" label="需要人工确认" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="failurePolicy" label="失败策略"><Select options={[{ value: "stop", label: "停止" }, { value: "continue", label: "继续" }]} /></Form.Item>
          </Form>
        ) : (
          <Typography.Text className="muted">选择一个节点后编辑参数。</Typography.Text>
        )}
      </div>
    </Space>
  );
}
