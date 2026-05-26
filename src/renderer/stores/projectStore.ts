import { create } from "zustand";
import type { Artifact, ExecutorConfig, Project, Run, WorkflowTemplate } from "../../shared/types";
import { api } from "../api/electronApi";

interface ProjectState {
  projects: Project[];
  selectedProjectId?: string;
  executors: ExecutorConfig[];
  workflows: WorkflowTemplate[];
  runs: Run[];
  artifacts: Artifact[];
  loading: boolean;
  selectedProject?: Project;
  load(): Promise<void>;
  selectProject(id: string): Promise<void>;
  refreshSelected(): Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  executors: [],
  workflows: [],
  runs: [],
  artifacts: [],
  loading: false,
  get selectedProject() {
    return get().projects.find((project) => project.id === get().selectedProjectId);
  },
  async load() {
    set({ loading: true });
    const [projects, executors, workflows] = await Promise.all([
      api.projects.list(),
      api.executors.list(),
      api.workflows.listTemplates()
    ]);
    set((state) => ({
      projects,
      executors,
      workflows,
      selectedProjectId: state.selectedProjectId ?? projects[0]?.id,
      loading: false
    }));
    const selected = get().selectedProjectId;
    if (selected) await get().selectProject(selected);
  },
  async selectProject(id) {
    set({ selectedProjectId: id });
    const [runs, artifacts] = await Promise.all([api.runs.list(id), api.artifacts.list(id)]);
    set({ runs, artifacts });
  },
  async refreshSelected() {
    const id = get().selectedProjectId;
    await get().load();
    if (id) await get().selectProject(id);
  }
}));
