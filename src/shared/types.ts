export type ProjectStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_approval"
  | "failed"
  | "completed"
  | "archived";

export type ExecutorKind = "aris-code" | "claude-code" | "codex-cli" | "custom";
export type WorkflowType =
  | "research-pipeline"
  | "idea-discovery"
  | "experiment-bridge"
  | "auto-review-loop"
  | "paper-writing"
  | "multi-agent-paper-review"
  | "custom";
export type RunStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type RunInsightStatus = "pending" | "running" | "completed" | "blocked" | "failed";
export type ArtifactType = "markdown" | "pdf" | "word" | "json" | "jsonl" | "image" | "latex" | "text" | "log" | "other";
export type CodexChatMode = "ask" | "edit";
export type CodexChatRole = "user" | "assistant" | "system";
export type CodexEditStatus = "none" | "preview" | "applied" | "failed";
export type CodexChatStatus = "running" | "completed" | "failed";

export interface Project {
  id: string;
  name: string;
  topic: string;
  description?: string | null;
  targetVenue?: string | null;
  repositoryId?: string | null;
  defaultExecutorId?: string | null;
  defaultWorkflowId?: string | null;
  status: ProjectStatus;
  runCount: number;
  createdAt: string;
  updatedAt: string;
  repository?: Repository | null;
}

export interface CreateProjectInput {
  name: string;
  topic: string;
  description?: string;
  targetVenue?: string;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  defaultExecutorId?: string | null;
  defaultWorkflowId?: string | null;
  status?: ProjectStatus;
}

export interface Repository {
  id: string;
  path: string;
  branch?: string | null;
  remoteOrigin?: string | null;
  lastCommitHash?: string | null;
  isDirty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryInspection {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  branch?: string;
  remoteOrigin?: string;
  lastCommitHash?: string;
  isDirty?: boolean;
  status?: GitStatus;
  error?: string;
}

export interface GitStatus {
  branch: string;
  remoteOrigin?: string;
  lastCommitHash?: string;
  isDirty: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  diffSummary: string;
}

export interface GitCommitResult {
  commitHash: string;
  summary: string;
}

export interface GitPushResult {
  remote: string;
  branch: string;
  summary: string;
}

export interface ExecutorConfig {
  id: string;
  name: string;
  kind: ExecutorKind;
  executablePath: string;
  defaultArgs: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveExecutorInput {
  id?: string;
  name: string;
  kind: ExecutorKind;
  executablePath: string;
  defaultArgs?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface ExecutorTestResult {
  ok: boolean;
  command: string;
  output: string;
  error?: string;
}

export interface ExecuteRequest {
  projectId: string;
  runId: string;
  executorId: string;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ExecuteEvent {
  runId: string;
  stepId?: string;
  type: "start" | "stdout" | "stderr" | "exit" | "error" | "insight";
  message: string;
  exitCode?: number;
  timestamp: string;
  payload?: RunInsight;
}

export interface StartRunInput {
  projectId: string;
  workflowType: WorkflowType;
  executorId?: string;
  topic?: string;
}

export interface Run {
  id: string;
  projectId: string;
  workflowTemplateId?: string | null;
  executorId?: string | null;
  status: RunStatus;
  currentNodeId?: string | null;
  roundIndex: number;
  startedAt?: string | null;
  endedAt?: string | null;
  exitCode?: number | null;
  errorMessage?: string | null;
}

export interface RunStep {
  id: string;
  runId: string;
  nodeId?: string | null;
  status: RunStatus;
  command?: string | null;
  args?: string[];
  stdoutPath?: string | null;
  stderrPath?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  exitCode?: number | null;
  errorMessage?: string | null;
}

export interface RunDetail extends Run {
  steps: RunStep[];
  events: ExecuteEvent[];
  insights: RunInsight[];
}

export interface RunInsight {
  id: string;
  runId: string;
  stageKey: string;
  title: string;
  status: RunInsightStatus;
  bullets: string[];
  blockers: string[];
  nextActions: string[];
  agentName?: string | null;
  timestamp: string;
}

export interface CodexChatMessage {
  id: string;
  projectId: string;
  role: CodexChatRole;
  mode: CodexChatMode;
  content: string;
  status: CodexChatStatus;
  editStatus: CodexEditStatus;
  patchText?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface CodexChatEvent {
  projectId: string;
  messageId: string;
  type: "started" | "stdout" | "stderr" | "completed" | "error";
  delta?: string;
  message?: string;
  timestamp: string;
  payload?: CodexChatMessage;
}

export interface CodexChatSendInput {
  projectId: string;
  message: string;
  mode: CodexChatMode;
}

export interface CodexEditPreview {
  messageId: string;
  patchText: string;
  summary: string;
  status: CodexEditStatus;
}

export interface Artifact {
  id: string;
  projectId: string;
  runId?: string | null;
  type: ArtifactType;
  name: string;
  path: string;
  previewable: boolean;
  sizeBytes?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  workflowTemplateId: string;
  nodeKey: string;
  name: string;
  command: string;
  args: string[];
  inputFiles?: string[];
  outputFiles?: string[];
  enabled: boolean;
  requiresApproval: boolean;
  failurePolicy: "stop" | "continue";
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEdge {
  id: string;
  workflowTemplateId: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface WorkflowTemplateDetail extends WorkflowTemplate {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface SaveWorkflowTemplateInput {
  id?: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  nodes: Array<Omit<WorkflowNode, "workflowTemplateId" | "createdAt" | "updatedAt">>;
  edges: Array<Omit<WorkflowEdge, "workflowTemplateId">>;
}

export interface ArisDiagnostics {
  found: boolean;
  executable?: string;
  versionOutput?: string;
  codexFound?: boolean;
  codexVersionOutput?: string;
  claudeFound?: boolean;
  claudeVersionOutput?: string;
  skillsFound?: boolean;
  skillLocations?: string[];
  latestReleaseUrl?: string;
  latestReleaseName?: string;
  installHint: string;
  error?: string;
}

export interface ArisAppApi {
  projects: {
    list(): Promise<Project[]>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: string, input: UpdateProjectInput): Promise<Project>;
    archive(id: string): Promise<void>;
  };
  repositories: {
    chooseDirectory(): Promise<string | null>;
    inspect(path: string): Promise<RepositoryInspection>;
    bind(projectId: string, path: string): Promise<Repository>;
    bindOrInit(projectId: string, path: string): Promise<Repository>;
    status(repositoryId: string): Promise<GitStatus>;
    diff(repositoryId: string): Promise<string>;
    stageAll(repositoryId: string): Promise<void>;
    commit(repositoryId: string, message: string): Promise<GitCommitResult>;
    push(repositoryId: string): Promise<GitPushResult>;
    history(repositoryId: string): Promise<Array<{ hash: string; message: string; date: string }>>;
  };
  runs: {
    start(input: StartRunInput): Promise<Run>;
    stop(runId: string): Promise<void>;
    list(projectId: string): Promise<Run[]>;
    get(runId: string): Promise<RunDetail>;
    onEvent(callback: (event: ExecuteEvent) => void): () => void;
  };
  artifacts: {
    list(projectId: string): Promise<Artifact[]>;
    readText(artifactId: string): Promise<string>;
    getFileUrl(artifactId: string): Promise<string>;
    rescan(projectId: string): Promise<Artifact[]>;
  };
  workflows: {
    listTemplates(): Promise<WorkflowTemplate[]>;
    getTemplate(id: string): Promise<WorkflowTemplateDetail>;
    saveTemplate(input: SaveWorkflowTemplateInput): Promise<WorkflowTemplateDetail>;
    resetTemplate(id: string): Promise<WorkflowTemplateDetail>;
  };
  codexChat: {
    list(projectId: string): Promise<CodexChatMessage[]>;
    send(input: CodexChatSendInput): Promise<CodexChatMessage>;
    previewEdit(messageId: string): Promise<CodexEditPreview>;
    applyEdit(messageId: string): Promise<CodexChatMessage>;
    onEvent(callback: (event: CodexChatEvent) => void): () => void;
  };
  executors: {
    list(): Promise<ExecutorConfig[]>;
    save(input: SaveExecutorInput): Promise<ExecutorConfig>;
    test(id: string): Promise<ExecutorTestResult>;
    diagnoseAris(): Promise<ArisDiagnostics>;
  };
  shell: {
    openPath(path: string): Promise<string>;
  };
}
