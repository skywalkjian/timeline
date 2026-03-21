# 本地 API

统一返回格式：

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

错误格式：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "invalid_date",
    "message": "date must use YYYY-MM-DD"
  }
}
```

时间字段统一使用 RFC 3339 UTC 字符串。

## `GET /health`

返回服务状态、启动时间、数据库路径和时区信息。

## `GET /api/timeline/day?date=2026-03-21`

返回某一天的 `focus_segments`、`browser_segments` 和 `presence_segments`。

## `GET /api/stats/apps?date=2026-03-21`

按应用聚合当天总时长。

## `GET /api/stats/domains?date=2026-03-21`

按域名聚合当天总时长。

## `GET /api/stats/focus?date=2026-03-21`

返回专注总时长、真实使用时间、切换次数、最长专注块和平均专注块。

## `GET /api/debug/recent-events`

读取最近的原始事件，仅用于本地调试。

## `POST /api/events/browser`

示例：

```json
{
  "domain": "github.com",
  "page_title": "OpenAI / timeline",
  "browser_window_id": 1,
  "tab_id": 214,
  "observed_at": "2026-03-21T11:40:00Z"
}
```
