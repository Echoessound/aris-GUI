import type { ExecuteEvent } from "../../shared/types";

const MAX_RENDERED_LOG_CHARS = 120000;
const MAX_EVENT_CHARS = 8192;

export function LogViewer({ events }: { events: ExecuteEvent[] }) {
  const text = limitRenderedLog(
    events.map((event) => `[${event.timestamp}] ${event.type.toUpperCase()} ${limitEventMessage(event.message)}`).join("\n")
  );
  return <pre className="log-viewer">{text || "等待运行日志..."}</pre>;
}

function limitEventMessage(message: string) {
  if (message.length <= MAX_EVENT_CHARS) return message;
  return `${message.slice(0, MAX_EVENT_CHARS)}\n...[UI 已截断，请打开 stdout.log/stderr.log 查看完整输出]`;
}

function limitRenderedLog(text: string) {
  if (text.length <= MAX_RENDERED_LOG_CHARS) return text;
  return `${text.slice(0, MAX_RENDERED_LOG_CHARS)}\n\n...[日志在 UI 中已截断，请打开 run 的 stdout.log/stderr.log 查看完整输出]`;
}
