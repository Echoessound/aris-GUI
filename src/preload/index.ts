import { contextBridge, ipcRenderer } from "electron";
import type { ArisAppApi, CodexChatEvent, ExecuteEvent } from "../shared/types";

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
    stageAll: (repositoryId) => ipcRenderer.invoke("repository:stage-all", repositoryId),
    commit: (repositoryId, message) => ipcRenderer.invoke("repository:commit", repositoryId, message),
    push: (repositoryId) => ipcRenderer.invoke("repository:push", repositoryId),
    history: (repositoryId) => ipcRenderer.invoke("repository:history", repositoryId)
  },
  runs: {
    start: (input) => ipcRenderer.invoke("run:start", input),
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
    rescan: (projectId) => ipcRenderer.invoke("artifact:rescan", projectId)
  },
  workflows: {
    listTemplates: () => ipcRenderer.invoke("workflow:list"),
    getTemplate: (id) => ipcRenderer.invoke("workflow:get", id),
    saveTemplate: (input) => ipcRenderer.invoke("workflow:save", input),
    resetTemplate: (id) => ipcRenderer.invoke("workflow:reset", id)
  },
  codexChat: {
    list: (projectId) => ipcRenderer.invoke("codex-chat:list", projectId),
    send: (input) => ipcRenderer.invoke("codex-chat:send", input),
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
  shell: {
    openPath: (path) => ipcRenderer.invoke("shell:open-path", path)
  }
};

contextBridge.exposeInMainWorld("aris", api);
