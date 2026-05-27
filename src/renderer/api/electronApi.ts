import type { ArisAppApi } from "../../shared/types";

function missingElectronApi(): never {
  throw new Error("ARIS Paper Studio 需要在 Electron 桌面端中运行。请使用 pnpm dev 启动后的桌面窗口，而不是直接打开 Vite 浏览器地址。");
}

const fallbackApi = new Proxy({}, {
  get: () => new Proxy({}, {
    get: () => missingElectronApi
  })
}) as ArisAppApi;

export const api = window.aris ?? fallbackApi;
