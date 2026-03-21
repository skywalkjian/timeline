# 数据表说明

## `app_registry`

- `process_name`：进程名，唯一键
- `display_name`：用户友好的应用名

## `focus_segments`

- `process_name`
- `display_name`
- `exe_path`
- `window_title`
- `is_browser`
- `started_at`
- `ended_at`

## `browser_segments`

- `domain`
- `page_title`
- `browser_window_id`
- `tab_id`
- `started_at`
- `ended_at`

## `presence_segments`

- `state`
- `started_at`
- `ended_at`

## `raw_events`

- `kind`
- `payload_json`
- `observed_at`
