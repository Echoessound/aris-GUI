import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";
import "./styles/app.css";
import "reactflow/dist/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 6, colorPrimary: "#2563eb" } }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
