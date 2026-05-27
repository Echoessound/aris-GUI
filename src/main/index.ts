import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { getDb } from "./db/database";
import { ensureDefaultExecutors, diagnoseAris, listExecutors, saveExecutor, testExecutor } from "./services/executor.service";
import { archiveProject, createProject, listProjects, updateProject } from "./services/project.service";
import {
  bindRepository,
  bindOrInitRepository,
  chooseDirectory,
  checkoutBranch,
  commitRepository,
  createBranch,
  getRepositoryDiff,
  getRepositoryStatus,
  inspectRepository,
  listBranches,
  prepareDelivery,
  pullRepository,
  pushRepository,
  repositoryHistory,
  stageAll,
  summarizeIgnoredFiles
} from "./services/repository.service";
import { artifactFileUrl, listArtifacts, readArtifactText, rescanArtifacts } from "./services/artifact.service";
import { applyCodexEdit, cleanupInterruptedCodexChats, continueCodexChat, listCodexChatMessages, previewCodexEdit, sendCodexChat } from "./services/codex-chat.service";
import { cleanupInterruptedRuns, continueRun, getRun, listRuns, startRun, stopRun } from "./services/run.service";
import { ensureDefaultWorkflows, getWorkflowTemplate, listWorkflowTemplates, resetWorkflowTemplate, saveWorkflowTemplate } from "./services/workflow.service";
import {
  chooseWorkspaceDirectory,
  chooseWorkspaceFiles,
  ensureRepoWorkspaceDirs,
  getWorkspaceFileSettings,
  importWorkspaceFilesToRepo,
  saveWorkspaceFileSettings,
  scanWorkspaceFiles
} from "./services/workspace-file.service";
import { listModelUsage, summarizeModelUsage } from "./services/model-usage.service";
import { getAutoContinueSettings, listContinuationChain, saveAutoContinueSettings, stopContinuationChain } from "./services/auto-continue.service";
import { getWorkflowLaunchSettings, previewWorkflowPrompt, saveWorkflowLaunchSettings } from "./services/workflow-launch.service";
import { diagnoseEnvironment, runSetupAction } from "./services/environment.service";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-software-rasterizer");

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: "ARIS Paper Studio",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void win.loadURL(devServer);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  getDb();
  ensureDefaultExecutors();
  ensureDefaultWorkflows();
  cleanupInterruptedRuns();
  cleanupInterruptedCodexChats();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc() {
  ipcMain.handle("project:list", () => listProjects());
  ipcMain.handle("project:create", (_event, input) => createProject(input));
  ipcMain.handle("project:update", (_event, id, input) => updateProject(id, input));
  ipcMain.handle("project:archive", (_event, id) => archiveProject(id));

  ipcMain.handle("repository:choose-directory", () => chooseDirectory());
  ipcMain.handle("repository:inspect", (_event, repoPath) => inspectRepository(repoPath));
  ipcMain.handle("repository:bind", (_event, projectId, repoPath) => bindRepository(projectId, repoPath));
  ipcMain.handle("repository:bind-or-init", (_event, projectId, repoPath) => bindOrInitRepository(projectId, repoPath));
  ipcMain.handle("repository:status", (_event, repositoryId) => getRepositoryStatus(repositoryId));
  ipcMain.handle("repository:diff", (_event, repositoryId) => getRepositoryDiff(repositoryId));
  ipcMain.handle("repository:list-branches", (_event, repositoryId) => listBranches(repositoryId));
  ipcMain.handle("repository:create-branch", (_event, repositoryId, branchName, checkout) => createBranch(repositoryId, branchName, checkout));
  ipcMain.handle("repository:checkout-branch", (_event, repositoryId, branchName) => checkoutBranch(repositoryId, branchName));
  ipcMain.handle("repository:stage-all", (_event, repositoryId) => stageAll(repositoryId));
  ipcMain.handle("repository:commit", (_event, repositoryId, message) => commitRepository(repositoryId, message));
  ipcMain.handle("repository:pull", (_event, repositoryId) => pullRepository(repositoryId));
  ipcMain.handle("repository:push", (_event, repositoryId) => pushRepository(repositoryId));
  ipcMain.handle("repository:history", (_event, repositoryId) => repositoryHistory(repositoryId));
  ipcMain.handle("repository:prepare-delivery", (_event, repositoryId, runId) => prepareDelivery(repositoryId, runId));
  ipcMain.handle("repository:ignored-summary", (_event, repositoryId) => summarizeIgnoredFiles(repositoryId));

  ipcMain.handle("run:start", (_event, input) => startRun(input));
  ipcMain.handle("run:continue", (_event, runId, input) => continueRun(runId, input));
  ipcMain.handle("run:stop", (_event, runId) => stopRun(runId));
  ipcMain.handle("run:list", (_event, projectId) => listRuns(projectId));
  ipcMain.handle("run:get", (_event, runId) => getRun(runId));

  ipcMain.handle("artifact:list", (_event, projectId) => listArtifacts(projectId));
  ipcMain.handle("artifact:read-text", (_event, artifactId) => readArtifactText(artifactId));
  ipcMain.handle("artifact:file-url", (_event, artifactId) => artifactFileUrl(artifactId));
  ipcMain.handle("artifact:rescan", (_event, projectId, runId) => rescanArtifacts(projectId, runId));

  ipcMain.handle("workspace-files:get-settings", (_event, projectId) => getWorkspaceFileSettings(projectId));
  ipcMain.handle("workspace-files:save-settings", (_event, projectId, input) => saveWorkspaceFileSettings(projectId, input));
  ipcMain.handle("workspace-files:ensure-repo-dirs", (_event, projectId) => ensureRepoWorkspaceDirs(projectId));
  ipcMain.handle("workspace-files:import-to-repo", (_event, projectId, targetDir, sources) => importWorkspaceFilesToRepo(projectId, targetDir, sources));
  ipcMain.handle("workspace-files:scan", (_event, projectId) => scanWorkspaceFiles(projectId));
  ipcMain.handle("workspace-files:choose-files", () => chooseWorkspaceFiles());
  ipcMain.handle("workspace-files:choose-directory", () => chooseWorkspaceDirectory());

  ipcMain.handle("usage:list", (_event, projectId, filters) => listModelUsage(projectId, filters));
  ipcMain.handle("usage:summary", (_event, projectId, filters) => summarizeModelUsage(projectId, filters));

  ipcMain.handle("workflow:list", () => listWorkflowTemplates());
  ipcMain.handle("workflow:get", (_event, id) => getWorkflowTemplate(id));
  ipcMain.handle("workflow:save", (_event, input) => saveWorkflowTemplate(input));
  ipcMain.handle("workflow:reset", (_event, id) => resetWorkflowTemplate(id));

  ipcMain.handle("workflow-launch:get-settings", (_event, projectId) => getWorkflowLaunchSettings(projectId));
  ipcMain.handle("workflow-launch:save-settings", (_event, projectId, input) => saveWorkflowLaunchSettings(projectId, input));
  ipcMain.handle("workflow-launch:preview-prompt", (_event, input) => previewWorkflowPrompt(input));

  ipcMain.handle("codex-chat:list", (_event, projectId) => listCodexChatMessages(projectId));
  ipcMain.handle("codex-chat:send", (_event, input) => sendCodexChat(input));
  ipcMain.handle("codex-chat:continue", (_event, messageId) => continueCodexChat(messageId));
  ipcMain.handle("codex-chat:preview-edit", (_event, messageId) => previewCodexEdit(messageId));
  ipcMain.handle("codex-chat:apply-edit", (_event, messageId) => applyCodexEdit(messageId));

  ipcMain.handle("auto-continue:get-settings", (_event, projectId) => getAutoContinueSettings(projectId));
  ipcMain.handle("auto-continue:save-settings", (_event, projectId, input) => saveAutoContinueSettings(projectId, input));
  ipcMain.handle("auto-continue:list-chain", (_event, projectId, rootId) => listContinuationChain(projectId, rootId));
  ipcMain.handle("auto-continue:stop-chain", (_event, chainId) => stopContinuationChain(chainId));

  ipcMain.handle("executor:list", () => listExecutors());
  ipcMain.handle("executor:save", (_event, input) => saveExecutor(input));
  ipcMain.handle("executor:test", (_event, id) => testExecutor(id));
  ipcMain.handle("executor:diagnose-aris", () => diagnoseAris());
  ipcMain.handle("environment:diagnose", () => diagnoseEnvironment());
  ipcMain.handle("environment:run-setup-action", (_event, action) => runSetupAction(action));
  ipcMain.handle("shell:open-path", (_event, target) => shell.openPath(target));
}
