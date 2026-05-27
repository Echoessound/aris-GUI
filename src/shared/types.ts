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
  | "paper-compile"
  | "multi-agent-paper-review"
  | "custom";
export type RunStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type RunInsightStatus = "pending" | "running" | "completed" | "blocked" | "failed";
export type ArtifactType = "markdown" | "pdf" | "word" | "json" | "jsonl" | "image" | "latex" | "text" | "code" | "csv" | "html" | "log" | "binary" | "other";
export type CodexChatMode = "ask" | "edit";
export type CodexChatIntent = "project_qa" | "review_run" | "edit_preview" | "next_round_direction";
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

export interface GitDeliveryResult {
  repositoryId: string;
  runId?: string | null;
  deliveryDir: string;
  summaryPath: string;
  copiedFiles: Array<{ source: string; target: string; purpose: string }>;
  suggestedCommitMessage: string;
}

export interface GitIgnoredSummary {
  repositoryId: string;
  ignoredCount: number;
  ignoredSamples: string[];
  likelyArtifactCount: number;
  likelyArtifactSamples: string[];
  explanation: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
}

export interface GitPullResult {
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
  parentRunId?: string | null;
  continuationIndex?: number;
  continuationReason?: string | null;
  continuationPrompt?: string | null;
  launchConfig?: WorkflowLaunchConfig | null;
  promptOverride?: string | null;
  extraPrompt?: string | null;
}

export interface ContinueRunInput {
  launchConfig?: WorkflowLaunchConfig | null;
  promptOverride?: string | null;
  extraPrompt?: string | null;
}

export interface Run {
  id: string;
  projectId: string;
  workflowTemplateId?: string | null;
  workflowType?: WorkflowType | null;
  executorId?: string | null;
  status: RunStatus;
  currentNodeId?: string | null;
  roundIndex: number;
  startedAt?: string | null;
  endedAt?: string | null;
  exitCode?: number | null;
  errorMessage?: string | null;
  parentRunId?: string | null;
  continuationIndex?: number;
  continuationReason?: string | null;
  launchConfig?: WorkflowLaunchConfig | null;
  extraPrompt?: string | null;
  promptOverride?: string | null;
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
  runId?: string | null;
  conversationId?: string | null;
  parentMessageId?: string | null;
  continuationIndex?: number;
  continuationReason?: string | null;
  role: CodexChatRole;
  mode: CodexChatMode;
  intent: CodexChatIntent;
  content: string;
  status: CodexChatStatus;
  editStatus: CodexEditStatus;
  patchText?: string | null;
  errorMessage?: string | null;
  diagnosticText?: string | null;
  answeredUserRequest?: boolean;
  autoContinuedFromMessageId?: string | null;
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
  runId?: string | null;
  conversationId?: string | null;
  parentMessageId?: string | null;
  continuationIndex?: number;
  continuationReason?: string | null;
  autoContinuedFromMessageId?: string | null;
  message: string;
  mode: CodexChatMode;
  intent: CodexChatIntent;
  model?: string | null;
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
  relativePath?: string;
  runRelativePath?: string;
  description?: string;
  previewable: boolean;
  sizeBytes?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceExternalPath {
  id: string;
  projectId: string;
  label: string;
  path: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileSettings {
  projectId: string;
  repoDirs: string[];
  externalPaths: WorkspaceExternalPath[];
  updatedAt: string;
}

export interface SaveWorkspaceFileSettingsInput {
  repoDirs: string[];
  externalPaths: Array<Pick<WorkspaceExternalPath, "label" | "path"> & { id?: string; description?: string | null }>;
}

export interface WorkspaceFileEntry {
  key: string;
  label: string;
  path: string;
  relativePath?: string;
  kind: "repo-dir" | "external-dir";
  exists: boolean;
  fileCount: number;
  sizeBytes: number;
  updatedAt?: string | null;
  description?: string | null;
}

export interface WorkspaceImportResult {
  imported: WorkspaceFileEntry[];
  targetDir: string;
}

export interface ModelUsageEvent {
  id: string;
  projectId: string;
  runId?: string | null;
  chatMessageId?: string | null;
  source: "run" | "chat";
  model?: string | null;
  reasoningEffort?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  rawJson: string;
  createdAt: string;
}

export interface ModelUsageFilters {
  runId?: string;
  source?: "run" | "chat";
}

export interface ModelUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalTokens: number;
  eventCount: number;
  byModel: Array<{ model: string; totalTokens: number; inputTokens: number; outputTokens: number; eventCount: number }>;
  byRun: Array<{ runId: string; totalTokens: number; inputTokens: number; outputTokens: number; eventCount: number }>;
  byDay: Array<{ day: string; totalTokens: number; inputTokens: number; outputTokens: number; eventCount: number }>;
}

export type AutoContinueScope = "all" | "chat" | "workflow";
export type ContinuationItemType = "run" | "chat";

export interface WorkflowLaunchConfig {
  workflowType?: WorkflowType;
  topic?: string;
  model?: string | null;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | string | null;
  sandbox?: string | null;
  approval?: string | null;
  minRuntimeMinutes?: number | null;
  minMarkdownChars?: number | null;
  autoContinueEnabled?: boolean;
  maxContinuations?: number | null;
  rerunExistingReview?: boolean;
  pdfCompileMode?: "codex-skill-first" | "local-latex-first";
}

export interface SaveWorkflowLaunchSettingsInput {
  config: WorkflowLaunchConfig;
  extraPrompt?: string | null;
  promptOverride?: string | null;
}

export interface WorkflowLaunchSettings extends SaveWorkflowLaunchSettingsInput {
  projectId: string;
  updatedAt: string;
}

export interface WorkflowPromptPreviewInput {
  projectId: string;
  workflowType: WorkflowType;
  topic: string;
  launchConfig?: WorkflowLaunchConfig | null;
  extraPrompt?: string | null;
  promptOverride?: string | null;
  continuationPrompt?: string | null;
}

export interface WorkflowPromptPreview {
  prompt: string;
}

export interface AutoContinueSettings {
  projectId?: string | null;
  enabled: boolean;
  scope: AutoContinueScope;
  fullyAutomatic: boolean;
  maxContinuations: number;
  triggerOnFailure: boolean;
  triggerOnTimeout: boolean;
  triggerOnPartialArtifacts: boolean;
  triggerOnQualityRisk: boolean;
  inheritExecutorModel: boolean;
  updatedAt: string;
}

export type SaveAutoContinueSettingsInput = Partial<Omit<AutoContinueSettings, "projectId" | "updatedAt">>;

export interface ContinuationChain {
  id: string;
  projectId: string;
  rootType: ContinuationItemType;
  rootId: string;
  stopped: boolean;
  stopReason?: string | null;
  createdAt: string;
  updatedAt: string;
  events: ContinuationEvent[];
}

export interface ContinuationEvent {
  id: string;
  chainId: string;
  projectId: string;
  itemType: ContinuationItemType;
  itemId: string;
  parentItemId?: string | null;
  continuationIndex: number;
  reason: string;
  status: "started" | "completed" | "stopped" | "failed" | "skipped";
  summary?: string | null;
  createdAt: string;
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

export type EnvironmentCheckStatus = "ok" | "warning" | "missing" | "running";

export interface EnvironmentCheckItem {
  id: string;
  label: string;
  status: EnvironmentCheckStatus;
  detail: string;
  actionKind?: SetupActionKind;
}

export interface EnvironmentDiagnostics {
  checkedAt: string;
  checks: EnvironmentCheckItem[];
  summary: string;
  aris: ArisDiagnostics;
}

export type SetupActionKind =
  | "install-aris-skills"
  | "test-codex"
  | "test-git"
  | "open-codex-config"
  | "open-user-skills"
  | "open-project-skills"
  | "open-readme"
  | "open-aris-release";

export interface SetupActionEvent {
  action: SetupActionKind;
  type: "start" | "stdout" | "stderr" | "done" | "error";
  message: string;
  exitCode?: number;
  timestamp: string;
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
    listBranches(repositoryId: string): Promise<GitBranchInfo[]>;
    createBranch(repositoryId: string, branchName: string, checkout?: boolean): Promise<GitStatus>;
    checkoutBranch(repositoryId: string, branchName: string): Promise<GitStatus>;
    stageAll(repositoryId: string): Promise<void>;
    commit(repositoryId: string, message: string): Promise<GitCommitResult>;
    pull(repositoryId: string): Promise<GitPullResult>;
    push(repositoryId: string): Promise<GitPushResult>;
    history(repositoryId: string): Promise<Array<{ hash: string; message: string; date: string }>>;
    prepareDelivery(repositoryId: string, runId?: string): Promise<GitDeliveryResult>;
    ignoredSummary(repositoryId: string): Promise<GitIgnoredSummary>;
  };
  runs: {
    start(input: StartRunInput): Promise<Run>;
    continue(runId: string, input?: ContinueRunInput): Promise<Run>;
    stop(runId: string): Promise<void>;
    list(projectId: string): Promise<Run[]>;
    get(runId: string): Promise<RunDetail>;
    onEvent(callback: (event: ExecuteEvent) => void): () => void;
  };
  artifacts: {
    list(projectId: string): Promise<Artifact[]>;
    readText(artifactId: string): Promise<string>;
    getFileUrl(artifactId: string): Promise<string>;
    rescan(projectId: string, runId?: string): Promise<Artifact[]>;
  };
  workspaceFiles: {
    getSettings(projectId: string): Promise<WorkspaceFileSettings>;
    saveSettings(projectId: string, input: SaveWorkspaceFileSettingsInput): Promise<WorkspaceFileSettings>;
    ensureRepoDirs(projectId: string): Promise<WorkspaceFileEntry[]>;
    importToRepo(projectId: string, targetDir: string, sources: string[]): Promise<WorkspaceImportResult>;
    scan(projectId: string): Promise<WorkspaceFileEntry[]>;
    chooseFiles(): Promise<string[]>;
    chooseDirectory(): Promise<string | null>;
  };
  usage: {
    list(projectId: string, filters?: ModelUsageFilters): Promise<ModelUsageEvent[]>;
    summary(projectId: string, filters?: ModelUsageFilters): Promise<ModelUsageSummary>;
  };
  workflows: {
    listTemplates(): Promise<WorkflowTemplate[]>;
    getTemplate(id: string): Promise<WorkflowTemplateDetail>;
    saveTemplate(input: SaveWorkflowTemplateInput): Promise<WorkflowTemplateDetail>;
    resetTemplate(id: string): Promise<WorkflowTemplateDetail>;
  };
  workflowLaunch: {
    getSettings(projectId: string): Promise<WorkflowLaunchSettings>;
    saveSettings(projectId: string, input: SaveWorkflowLaunchSettingsInput): Promise<WorkflowLaunchSettings>;
    previewPrompt(input: WorkflowPromptPreviewInput): Promise<WorkflowPromptPreview>;
  };
  codexChat: {
    list(projectId: string): Promise<CodexChatMessage[]>;
    send(input: CodexChatSendInput): Promise<CodexChatMessage>;
    continue(messageId: string): Promise<CodexChatMessage>;
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
  environment: {
    diagnose(): Promise<EnvironmentDiagnostics>;
    runSetupAction(action: SetupActionKind): Promise<SetupActionEvent>;
    onSetupEvent(callback: (event: SetupActionEvent) => void): () => void;
  };
  autoContinue: {
    getSettings(projectId?: string | null): Promise<AutoContinueSettings>;
    saveSettings(projectId: string | null | undefined, input: SaveAutoContinueSettingsInput): Promise<AutoContinueSettings>;
    listChain(projectId: string, rootId: string): Promise<ContinuationChain | null>;
    stopChain(chainId: string): Promise<void>;
  };
  shell: {
    openPath(path: string): Promise<string>;
  };
}
