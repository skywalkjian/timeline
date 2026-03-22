# web-ui

本地 Web 界面，负责展示每日时间线、统计分布和专注分析。

## 运行

```powershell
npm install
npm run dev
```

可选环境变量：

- `VITE_API_BASE_URL`：本地 agent API 地址，默认 `http://127.0.0.1:46215`

图表时间轴默认按 agent 返回的 `date + timezone` 解释时间，不依赖当前浏览器所在时区。
