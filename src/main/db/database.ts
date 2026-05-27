import Database from "better-sqlite3";
import { app } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

export function getAppDataDir() {
  const dir = path.join(app.getPath("appData"), "ARIS Paper Studio");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb() {
  if (db) return db;
  const dbPath = path.join(getAppDataDir(), "app.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      description TEXT,
      target_venue TEXT,
      repository_id TEXT,
      default_executor_id TEXT,
      default_workflow_id TEXT,
      status TEXT NOT NULL,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      branch TEXT,
      remote_origin TEXT,
      last_commit_hash TEXT,
      is_dirty INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS executor_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      executable_path TEXT NOT NULL,
      default_args_json TEXT NOT NULL,
      working_directory TEXT,
      env_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_nodes (
      id TEXT PRIMARY KEY,
      workflow_template_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      input_files_json TEXT,
      output_files_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_approval INTEGER NOT NULL DEFAULT 0,
      failure_policy TEXT NOT NULL DEFAULT 'stop',
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_edges (
      id TEXT PRIMARY KEY,
      workflow_template_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_template_id TEXT,
      executor_id TEXT,
      status TEXT NOT NULL,
      current_node_id TEXT,
      round_index INTEGER NOT NULL DEFAULT 1,
      started_at TEXT,
      ended_at TEXT,
      exit_code INTEGER,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT,
      status TEXT NOT NULL,
      command TEXT,
      args_json TEXT,
      stdout_path TEXT,
      stderr_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      exit_code INTEGER,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS run_insights (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage_key TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      bullets_json TEXT NOT NULL,
      blockers_json TEXT NOT NULL,
      next_actions_json TEXT NOT NULL,
      agent_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      relative_path TEXT,
      run_relative_path TEXT,
      description TEXT,
      previewable INTEGER NOT NULL DEFAULT 1,
      size_bytes INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS git_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      event_type TEXT NOT NULL,
      branch TEXT,
      commit_hash TEXT,
      commit_message TEXT,
      remote TEXT,
      summary_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_chat_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      mode TEXT NOT NULL,
      run_id TEXT,
      intent TEXT NOT NULL DEFAULT 'project_qa',
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      patch_text TEXT,
      edit_status TEXT NOT NULL DEFAULT 'none',
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_file_settings (
      project_id TEXT PRIMARY KEY,
      repo_dirs_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_external_paths (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_usage_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT,
      chat_message_id TEXT,
      source TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_continue_settings (
      scope_id TEXT PRIMARY KEY,
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      scope TEXT NOT NULL DEFAULT 'all',
      fully_automatic INTEGER NOT NULL DEFAULT 1,
      max_continuations INTEGER NOT NULL DEFAULT 5,
      trigger_on_failure INTEGER NOT NULL DEFAULT 1,
      trigger_on_timeout INTEGER NOT NULL DEFAULT 1,
      trigger_on_partial_artifacts INTEGER NOT NULL DEFAULT 1,
      trigger_on_quality_risk INTEGER NOT NULL DEFAULT 1,
      inherit_executor_model INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_launch_settings (
      project_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      extra_prompt TEXT,
      prompt_override TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuation_chains (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      root_type TEXT NOT NULL,
      root_id TEXT NOT NULL,
      stopped INTEGER NOT NULL DEFAULT 0,
      stop_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuation_events (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      parent_item_id TEXT,
      continuation_index INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(database, "codex_chat_messages", "status", "TEXT NOT NULL DEFAULT 'completed'");
  ensureColumn(database, "codex_chat_messages", "run_id", "TEXT");
  ensureColumn(database, "codex_chat_messages", "intent", "TEXT NOT NULL DEFAULT 'project_qa'");
  ensureColumn(database, "artifacts", "relative_path", "TEXT");
  ensureColumn(database, "artifacts", "run_relative_path", "TEXT");
  ensureColumn(database, "artifacts", "description", "TEXT");
  ensureColumn(database, "model_usage_events", "cached_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "runs", "parent_run_id", "TEXT");
  ensureColumn(database, "runs", "continuation_index", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "runs", "continuation_reason", "TEXT");
  ensureColumn(database, "runs", "workflow_type", "TEXT");
  ensureColumn(database, "runs", "launch_config_json", "TEXT");
  ensureColumn(database, "runs", "extra_prompt", "TEXT");
  ensureColumn(database, "runs", "prompt_override", "TEXT");
  ensureColumn(database, "codex_chat_messages", "conversation_id", "TEXT");
  ensureColumn(database, "codex_chat_messages", "parent_message_id", "TEXT");
  ensureColumn(database, "codex_chat_messages", "continuation_index", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "codex_chat_messages", "continuation_reason", "TEXT");
  ensureColumn(database, "codex_chat_messages", "diagnostic_text", "TEXT");
  ensureColumn(database, "codex_chat_messages", "answered_user_request", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "codex_chat_messages", "auto_continued_from_message_id", "TEXT");
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
