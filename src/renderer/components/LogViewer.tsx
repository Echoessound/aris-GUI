import type { ExecuteEvent } from "../../shared/types";

const MAX_RENDERED_LOG_CHARS = 600000;

export function LogViewer({ events }: { events: ExecuteEvent[] }) {
  const text = limitRenderedLog(
    events.map((event) => `[${event.timestamp}] ${event.type.toUpperCase()} ${event.message}`).join("\n")
  );
  return <pre className="log-viewer">{text || "等待运行日志..."}</pre>;
}

function limitRenderedLog(text: string) {
  if (text.length <= MAX_RENDERED_LOG_CHARS) return text;
  return `${text.slice(0, MAX_RENDERED_LOG_CHARS)}\n\n...[日志过大，UI 只显示前 ${MAX_RENDERED_LOG_CHARS} 字符；完整内容请打开该 run 的 stdout.log/stderr.log]`;
}
