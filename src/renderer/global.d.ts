import type { ArisAppApi } from "../shared/types";

declare global {
  interface Window {
    aris: ArisAppApi;
  }
}
