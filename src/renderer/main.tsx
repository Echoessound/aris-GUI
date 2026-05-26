import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";
import "./styles/app.css";
import "reactflow/dist/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 6,
          colorPrimary: "#1f5eff",
          colorInfo: "#1f5eff",
          colorSuccess: "#168a4a",
          colorWarning: "#b7791f",
          colorError: "#c2413b",
          colorText: "#182235",
          colorTextSecondary: "#667085",
          fontFamily: "\"Segoe UI\", \"Microsoft YaHei\", system-ui, sans-serif"
        },
        components: {
          Button: { controlHeight: 34 },
          Input: { controlHeight: 34 },
          Select: { controlHeight: 34 },
          Tabs: { titleFontSize: 14 }
        }
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
