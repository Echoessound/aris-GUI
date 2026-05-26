import { getDb, id, nowIso, parseJson } from "../db/database";
import type { SaveWorkflowTemplateInput, WorkflowTemplate, WorkflowTemplateDetail } from "../../shared/types";

const defaultNodeKeys = [
  "research-lit",
  "idea-creator",
  "novelty-check",
  "research-refine",
  "experiment-plan",
  "experiment-bridge",
  "auto-review-loop",
  "paper-plan",
  "paper-figure",
  "paper-write",
  "paper-compile",
  "auto-paper-improvement-loop"
];

const templates = [
  ["workflow-research-pipeline", "完整论文生成", "从研究方向到 Markdown 报告和 PDF 的端到端流程", "research-pipeline"],
  ["workflow-idea-discovery", "立题发现", "生成选题、调研、创新点和实验计划", "idea-discovery"],
  ["workflow-experiment-bridge", "实验桥接", "根据实验计划生成代码、运行初步实验、收集结果", "experiment-bridge"],
  ["workflow-auto-review-loop", "自动审稿循环", "对结果或论文草稿进行多轮审稿与修复", "auto-review-loop"],
  ["workflow-paper-writing", "论文写作", "从 NARRATIVE_REPORT.md 生成论文结构、LaTeX 和 PDF", "paper-writing"]
] as const;

export function ensureDefaultWorkflows() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as count FROM workflow_templates").get() as { count: number };
  if (count.count > 0) return;
  const stamp = nowIso();
  const insertTemplate = db.prepare(`
    INSERT INTO workflow_templates (id, name, description, is_default, created_at, updated_at)
    VALUES (@id, @name, @description, @isDefault, @createdAt, @updatedAt)
  `);
  const insertNode = db.prepare(`
    INSERT INTO workflow_nodes (
      id, workflow_template_id, node_key, name, command, args_json, input_files_json,
      output_files_json, enabled, requires_approval, failure_policy, position_x, position_y, created_at, updated_at
    ) VALUES (
      @id, @workflowTemplateId, @nodeKey, @name, @command, @argsJson, @inputFilesJson,
      @outputFilesJson, @enabled, @requiresApproval, @failurePolicy, @positionX, @positionY, @createdAt, @updatedAt
    )
  `);
  const insertEdge = db.prepare(`
    INSERT INTO workflow_edges (id, workflow_template_id, source_node_id, target_node_id)
    VALUES (@id, @workflowTemplateId, @sourceNodeId, @targetNodeId)
  `);

  const tx = db.transaction(() => {
    templates.forEach(([templateId, name, description, workflowType], templateIndex) => {
      insertTemplate.run({
        id: templateId,
        name,
        description,
        isDefault: templateIndex === 0 ? 1 : 0,
        createdAt: stamp,
        updatedAt: stamp
      });
      const keys = workflowType === "research-pipeline" ? defaultNodeKeys : [workflowType];
      const nodeIds: string[] = [];
      keys.forEach((key, index) => {
        const nodeId = `${templateId}-node-${key}`;
        nodeIds.push(nodeId);
        insertNode.run({
          id: nodeId,
          workflowTemplateId: templateId,
          nodeKey: key,
          name: key,
          command: `/${key}`,
          argsJson: JSON.stringify([]),
          inputFilesJson: JSON.stringify([]),
          outputFilesJson: JSON.stringify(defaultOutputsFor(key)),
          enabled: 1,
          requiresApproval: key.includes("audit") ? 1 : 0,
          failurePolicy: "stop",
          positionX: 80 + index * 220,
          positionY: 120 + (index % 2) * 120,
          createdAt: stamp,
          updatedAt: stamp
        });
      });
      for (let i = 0; i < nodeIds.length - 1; i += 1) {
        insertEdge.run({
          id: `${templateId}-edge-${i}`,
          workflowTemplateId: templateId,
          sourceNodeId: nodeIds[i],
          targetNodeId: nodeIds[i + 1]
        });
      }
    });
  });
  tx();
}

function defaultOutputsFor(key: string) {
  const map: Record<string, string[]> = {
    "idea-discovery": ["IDEA_REPORT.md", "FINAL_PROPOSAL.md"],
    "experiment-plan": ["EXPERIMENT_PLAN.md"],
    "auto-review-loop": ["AUTO_REVIEW.md"],
    "paper-plan": ["PAPER_PLAN.md"],
    "paper-write": ["paper/paper.tex"],
    "paper-compile": ["paper/paper.pdf"],
    "auto-paper-improvement-loop": ["FINAL_REPORT.md", "paper/paper.pdf"]
  };
  return map[key] ?? [];
}

export function listWorkflowTemplates(): WorkflowTemplate[] {
  ensureDefaultWorkflows();
  const rows = getDb().prepare("SELECT * FROM workflow_templates ORDER BY is_default DESC, created_at ASC").all() as any[];
  return rows.map(mapTemplate);
}

export function getWorkflowTemplate(templateId: string): WorkflowTemplateDetail {
  ensureDefaultWorkflows();
  const db = getDb();
  const template = db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get(templateId) as any;
  if (!template) throw new Error("Workflow 模板不存在");
  const nodes = db.prepare("SELECT * FROM workflow_nodes WHERE workflow_template_id = ? ORDER BY position_x ASC").all(templateId) as any[];
  const edges = db.prepare("SELECT * FROM workflow_edges WHERE workflow_template_id = ?").all(templateId) as any[];
  return {
    ...mapTemplate(template),
    nodes: nodes.map((row) => ({
      id: row.id,
      workflowTemplateId: row.workflow_template_id,
      nodeKey: row.node_key,
      name: row.name,
      command: row.command,
      args: parseJson<string[]>(row.args_json, []),
      inputFiles: parseJson<string[]>(row.input_files_json, []),
      outputFiles: parseJson<string[]>(row.output_files_json, []),
      enabled: Boolean(row.enabled),
      requiresApproval: Boolean(row.requires_approval),
      failurePolicy: row.failure_policy,
      positionX: row.position_x,
      positionY: row.position_y,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    edges: edges.map((row) => ({
      id: row.id,
      workflowTemplateId: row.workflow_template_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id
    }))
  };
}

export function saveWorkflowTemplate(input: SaveWorkflowTemplateInput): WorkflowTemplateDetail {
  const db = getDb();
  const templateId = input.id ?? id("workflow");
  const stamp = nowIso();
  const existing = db.prepare("SELECT id FROM workflow_templates WHERE id = ?").get(templateId);
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare("UPDATE workflow_templates SET name = ?, description = ?, is_default = ?, updated_at = ? WHERE id = ?").run(
        input.name,
        input.description ?? null,
        input.isDefault ? 1 : 0,
        stamp,
        templateId
      );
      db.prepare("DELETE FROM workflow_nodes WHERE workflow_template_id = ?").run(templateId);
      db.prepare("DELETE FROM workflow_edges WHERE workflow_template_id = ?").run(templateId);
    } else {
      db.prepare("INSERT INTO workflow_templates (id, name, description, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        templateId,
        input.name,
        input.description ?? null,
        input.isDefault ? 1 : 0,
        stamp,
        stamp
      );
    }
    const insertNode = db.prepare(`
      INSERT INTO workflow_nodes (
        id, workflow_template_id, node_key, name, command, args_json, input_files_json,
        output_files_json, enabled, requires_approval, failure_policy, position_x, position_y, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    input.nodes.forEach((node) => {
      insertNode.run(
        node.id,
        templateId,
        node.nodeKey,
        node.name,
        node.command,
        JSON.stringify(node.args ?? []),
        JSON.stringify(node.inputFiles ?? []),
        JSON.stringify(node.outputFiles ?? []),
        node.enabled ? 1 : 0,
        node.requiresApproval ? 1 : 0,
        node.failurePolicy,
        node.positionX,
        node.positionY,
        stamp,
        stamp
      );
    });
    const insertEdge = db.prepare("INSERT INTO workflow_edges (id, workflow_template_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)");
    input.edges.forEach((edge) => insertEdge.run(edge.id, templateId, edge.sourceNodeId, edge.targetNodeId));
  });
  tx();
  return getWorkflowTemplate(templateId);
}

function mapTemplate(row: any): WorkflowTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
