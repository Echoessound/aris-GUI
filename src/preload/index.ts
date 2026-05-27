import { contextBridge, ipcRenderer } from "electron";
import type { ArisAppApi, CodexChatEvent, ExecuteEvent, SetupActionEvent } from "../shared/types";

const api: ArisAppApi = {
  projects: {
    list: () => ipcRenderer.invoke("project:list"),
    create: (input) => ipcRenderer.invoke("project:create", input),
    update: (id, input) => ipcRenderer.invoke("project:update", id, input),
    archive: (id) => ipcRenderer.invoke("project:archive", id)
  },
  repositories: {
    chooseDirectory: () => ipcRenderer.invoke("repository:choose-directory"),
    inspect: (path) => ipcRenderer.invoke("repository:inspect", path),
    bind: (projectId, path) => ipcRenderer.invoke("repository:bind", projectId, path),
    bindOrInit: (projectId, path) => ipcRenderer.invoke("repository:bind-or-init", projectId, path),
    status: (repositoryId) => ipcRenderer.invoke("repository:status", repositoryId),
    diff: (repositoryId) => ipcRenderer.invoke("repository:diff", repositoryId),
    listBranches: (repositoryId) => ipcRenderer.invoke("repository:list-branches", repositoryId),
    createBranch: (repositoryId, branchName, checkout) => ipcRenderer.invoke("repository:create-branch", repositoryId, branchName, checkout),
    checkoutBranch: (repositoryId, branchName) => ipcRenderer.invoke("repository:checkout-branch", repositoryId, branchName),
    stageAll: (repositoryId) => ipcRenderer.invoke("repository:stage-all", repositoryId),
    commit: (repositoryId, message) => ipcRenderer.invoke("repository:commit", repositoryId, message),
    pull: (repositoryId) => ipcRenderer.invoke("repository:pull", repositoryId),
    push: (repositoryId) => ipcRenderer.invoke("repository:push", repositoryId),
    history: (repositoryId) => ipcRenderer.invoke("repository:history", repositoryId),
    prepareDelivery: (repositoryId, runId) => ipcRenderer.invoke("repository:prepare-delivery", repositoryId, runId),
    ignoredSummary: (repositoryId) => ipcRenderer.invoke("repository:ignored-summary", repositoryId)
  },
  runs: {
    start: (input) => ipcRenderer.invoke("run:start", input),
    continue: (runId, input) => ipcRenderer.invoke("run:continue", runId, input),
    stop: (runId) => ipcRenderer.invoke("run:stop", runId),
    list: (projectId) => ipcRenderer.invoke("run:list", projectId),
    get: (runId) => ipcRenderer.invoke("run:get", runId),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ExecuteEvent) => callback(payload);
      ipcRenderer.on("run:event", handler);
      return () => ipcRenderer.off("run:event", handler);
    }
  },
  artifacts: {
    list: (projectId) => ipcRenderer.invoke("artifact:list", projectId),
    readText: (artifactId) => ipcRenderer.invoke("artifact:read-text", artifactId),
    getFileUrl: (artifactId) => ipcRenderer.invoke("artifact:file-url", artifactId),
    rescan: (projectId, runId) => ipcRenderer.invoke("artifact:rescan", projectId, runId)
  },
  workspaceFiles: {
    getSettings: (projectId) => ipcRenderer.invoke("workspace-files:get-settings", projectId),
    saveSettings: (projectId, input) => ipcRenderer.invoke("workspace-files:save-settings", projectId, input),
    ensureRepoDirs: (projectId) => ipcRenderer.invoke("workspace-files:ensure-repo-dirs", projectId),
    importToRepo: (projectId, targetDir, sources) => ipcRenderer.invoke("workspace-files:import-to-repo", projectId, targetDir, sources),
    scan: (projectId) => ipcRenderer.invoke("workspace-files:scan", projectId),
    chooseFiles: () => ipcRenderer.invoke("workspace-files:choose-files"),
    chooseDirectory: () => ipcRenderer.invoke("workspace-files:choose-directory")
  },
  usage: {
    list: (projectId, filters) => ipcRenderer.invoke("usage:list", projectId, filters),
    summary: (projectId, filters) => ipcRenderer.invoke("usage:summary", projectId, filters)
  },
  workflows: {
    listTemplates: () => ipcRenderer.invoke("workflow:list"),
    getTemplate: (id) => ipcRenderer.invoke("workflow:get", id),
    saveTemplate: (input) => ipcRenderer.invoke("workflow:save", input),
    resetTemplate: (id) => ipcRenderer.invoke("workflow:reset", id)
  },
  workflowLaunch: {
    getSettings: (projectId) => ipcRenderer.invoke("workflow-launch:get-settings", projectId),
    saveSettings: (projectId, input) => ipcRenderer.invoke("workflow-launch:save-settings", projectId, input),
    previewPrompt: (input) => ipcRenderer.invoke("workflow-launch:preview-prompt", input)
  },
  codexChat: {
    list: (projectId) => ipcRenderer.invoke("codex-chat:list", projectId),
    send: (input) => ipcRenderer.invoke("codex-chat:send", input),
    continue: (messageId) => ipcRenderer.invoke("codex-chat:continue", messageId),
    previewEdit: (messageId) => ipcRenderer.invoke("codex-chat:preview-edit", messageId),
    applyEdit: (messageId) => ipcRenderer.invoke("codex-chat:apply-edit", messageId),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: CodexChatEvent) => callback(payload);
      ipcRenderer.on("codex-chat:event", handler);
      return () => ipcRenderer.off("codex-chat:event", handler);
    }
  },
  executors: {
    list: () => ipcRenderer.invoke("executor:list"),
    save: (input) => ipcRenderer.invoke("executor:save", input),
    test: (id) => ipcRenderer.invoke("executor:test", id),
    diagnoseAris: () => ipcRenderer.invoke("executor:diagnose-aris")
  },
  environment: {
    diagnose: () => ipcRenderer.invoke("environment:diagnose"),
    runSetupAction: (action) => ipcRenderer.invoke("environment:run-setup-action", action),
    onSetupEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SetupActionEvent) => callback(payload);
      ipcRenderer.on("environment:setup-event", handler);
      return () => ipcRenderer.off("environment:setup-event", handler);
    }
  },
  autoContinue: {
    getSettings: (projectId) => ipcRenderer.invoke("auto-continue:get-settings", projectId),
    saveSettings: (projectId, input) => ipcRenderer.invoke("auto-continue:save-settings", projectId, input),
    listChain: (projectId, rootId) => ipcRenderer.invoke("auto-continue:list-chain", projectId, rootId),
    stopChain: (chainId) => ipcRenderer.invoke("auto-continue:stop-chain", chainId)
  },
  shell: {
    openPath: (path) => ipcRenderer.invoke("shell:open-path", path)
  }
};

contextBridge.exposeInMainWorld("aris", api);
