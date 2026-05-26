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
  return `${message.slice(0, MAX_EVENT_CHARS)}\n...[truncated in UI; open stdout.log/stderr.log for full output]`;
}

function limitRenderedLog(text: string) {
  if (text.length <= MAX_RENDERED_LOG_CHARS) return text;
  return `${text.slice(0, MAX_RENDERED_LOG_CHARS)}\n\n...[log truncated in UI; open the run stdout.log/stderr.log files for full output]`;
}
