import { isUtf8 } from "node:buffer";
import { readFileSync } from "node:fs";

const UTF8_DECODER = new TextDecoder("utf-8");
const GB18030_DECODER = new TextDecoder("gb18030");

export const UTF8_PROCESS_ENV: Record<string, string> = {
  LANG: "zh_CN.UTF-8",
  LC_ALL: "zh_CN.UTF-8",
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
  DOTNET_CLI_UI_LANGUAGE: "zh-CN",
  JAVA_TOOL_OPTIONS: "-Dfile.encoding=UTF-8"
};

export function decodeTextBuffer(buffer: Buffer) {
  if (buffer.length === 0) return "";
  return isUtf8(buffer) ? UTF8_DECODER.decode(buffer) : GB18030_DECODER.decode(buffer);
}

export function readTextFile(filePath: string) {
  return decodeTextBuffer(readFileSync(filePath));
}

export function appendUtf8Guidance(lines: string[]) {
  return [
    ...lines,
    "",
    "## 编码要求",
    "",
    "所有中文文件必须用 UTF-8 编码写入。运行 PowerShell 时请先设置 `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()`；运行 Python 时使用 UTF-8 stdout/stderr；不要生成 GBK/ANSI 编码文件。",
    "如果读取到历史 GBK/ANSI 文件，请转换或重写为 UTF-8 后再继续。"
  ];
}
