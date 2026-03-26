# timeline 仓库详细拆解文档

## 1. 文档目标

这份文档面向两类场景：

1. 你第一次进入这个仓库，想先建立整体心智模型。
2. 你准备改代码，希望知道每个模块、每个文件、每个函数分别负责什么。

它比 `README.md` 更偏“代码导览”，重点回答四个问题：

1. 这个项目整体是怎么分层的。
2. 数据从采集到展示经过哪些模块。
3. 每个目录和文件承担什么职责。
4. 每个函数的输入、输出和作用分别是什么。

## 2. 一句话理解项目

`timeline` 是一个面向 Windows 的本地个人活动时间线系统。

它在本机采集三类信息：

- 前台应用 / 窗口
- 设备状态 `active / idle / locked`
- 浏览器当前活动标签页对应的域名

然后把数据写入本地 SQLite，再通过本地 HTTP API 和本地 Web UI 做统计与可视化。

## 3. 系统总览

### 3.1 组件划分

| 组件 | 路径 | 技术栈 | 角色 |
| --- | --- | --- | --- |
| 本地 agent | `apps/timeline-agent` | Rust + Tokio + Axum + SQLite | 采集、状态合并、持久化、HTTP API、托盘、自启动 |
| Web UI | `apps/web-ui` | React + TypeScript + Vite | 统计页、时间线页、设置页 |
| 浏览器扩展 | `apps/browser-extension` | Manifest V3 | 上报浏览器活动标签页域名 |
| 共享协议 | `crates/common` | Rust crate | agent 与其他端共享类型定义 |
| 文档 | `docs/` | Markdown | 架构、接口、数据模型说明 |

### 3.2 核心运行原则

这个项目最重要的设计原则有 5 个：

1. **本地优先**：系统中心是本机 agent，不是远程服务。
2. **segment 驱动**：核心数据不是“事件点”，而是“时间段”。
3. **agent 是真相源**：浏览器扩展只是候选事件来源，是否入库由 agent 决定。
4. **UI 只做展示与建模**：统计口径和持久化边界在 agent，不在前端。
5. **运行状态和持久化状态分离**：当前开放中的 segment 在内存，历史数据在 SQLite。

### 3.3 三类核心 segment

| segment | 表名 | 含义 |
| --- | --- | --- |
| Focus | `focus_segments` | 某个应用/窗口处于前台的一段时间 |
| Browser | `browser_segments` | 某个域名/标签页在前台浏览器中活跃的一段时间 |
| Presence | `presence_segments` | 设备处于 active / idle / locked 的一段时间 |

`raw_events` 是调试辅助表，用来保留“观测到了什么”，不是 UI 的主数据源。

## 4. 端到端数据流

### 4.1 启动链路

1. `main.rs` 解析配置路径。
2. `config.rs` 加载配置并补齐默认值。
3. `main.rs` 初始化日志、时区、启动时间。
4. `main.rs` 获取单实例锁，防止重复启动。
5. `db.rs` 连接 SQLite 并执行 migration。
6. `db.rs` 调用 `restore_unclosed_segments()` 修复上次异常退出留下的开放段。
7. `state.rs` 构造 `AgentState`，装配配置、数据库连接和运行时状态。
8. `trackers.rs` 启动 focus / presence 两个轮询器。
9. `system.rs` 可选启动托盘线程。
10. `http.rs` 启动本地 HTTP 服务并托管 Web UI 静态文件。

### 4.2 Focus 采集链路

1. `trackers.rs::run_focus_tracker()` 按轮询周期调用 `windows.rs::capture_foreground_window()`。
2. `capture_foreground_window()` 读取当前前台窗口、进程、标题、路径等信息。
3. `trackers.rs::sync_focus_snapshot()` 比对新旧窗口指纹。
4. 如果指纹没变，只更新当前 segment 的 `last_seen_at`。
5. 如果指纹变了，结束旧 segment，创建新 `focus_segment`。
6. 同时把原始观测写入 `raw_events`。

### 4.3 Presence 采集链路

1. `trackers.rs::run_presence_tracker()` 周期性调用 `windows.rs::detect_presence()`。
2. `detect_presence()` 先判断桌面是否锁定，再判断是否超过 idle 阈值。
3. `trackers.rs::sync_presence_state()` 以 segment 方式维护 active / idle / locked 状态段。

### 4.4 Browser 域名链路

1. 浏览器扩展监听标签页切换、更新、窗口聚焦、心跳等事件。
2. 扩展将域名、标题、窗口 id、tab id 发送给本地 agent。
3. `http.rs::post_browser_event()` 接收请求。
4. `trackers.rs::sync_browser_event()` 决定是否接受：
   - 域名是否被忽略
   - 当前前台应用是否是浏览器
   - 是否与当前 browser segment 连续
5. 满足条件时写入或更新 `browser_segments`。

### 4.5 展示链路

1. Web UI 通过 `apps/web-ui/src/api.ts` 请求 agent。
2. `http.rs` 调用 `db.rs` 读取 timeline / stats / settings。
3. `chart-model.ts` 把原始段数据转成图表模型。
4. React 组件渲染 donut、calendar、timeline 等视图。

## 5. 仓库目录拆解

```text
timeline/
├─ apps/
│  ├─ browser-extension/    # 浏览器桥接
│  ├─ timeline-agent/       # Windows 本地 agent
│  └─ web-ui/               # 本地 dashboard
├─ assets/                  # README 截图
├─ config/                  # agent 配置示例
├─ crates/
│  └─ common/               # 共享数据结构
├─ docs/                    # 架构/接口/拆解文档
├─ scripts/                 # 打包脚本
├─ Cargo.toml               # Rust workspace 根配置
└─ README.md
```

## 6. 共享协议层：`crates/common`

### 6.1 文件职责

`crates/common/src/lib.rs` 定义 agent 对外暴露的数据结构，也定义 Web UI 和 agent 共识的数据协议。

### 6.2 核心类型

| 类型 | 作用 |
| --- | --- |
| `ApiResponse<T>` | 统一 API 返回包装 |
| `PresenceState` | presence 状态枚举 |
| `AppInfo` | 应用信息 |
| `FocusSegment` | focus 时间段 |
| `BrowserSegment` | 域名时间段 |
| `PresenceSegment` | presence 时间段 |
| `TimelineDayResponse` | 单日时间线接口返回 |
| `DurationStat` | 时长统计行 |
| `FocusStats` | 专注统计 |
| `HealthResponse` | 健康检查返回 |
| `AgentMonitorStatus` | 监视器状态 |
| `AgentSettingsResponse` | 设置页返回 |
| `BrowserEventPayload` | 浏览器扩展上报 payload |
| `BrowserEventAck` | 浏览器事件接收结果 |
| `DaySummary` | 月历单日摘要 |
| `MonthCalendarResponse` | 月历接口返回 |
| `PeriodStat` | 周期汇总值 |
| `PeriodSummaryResponse` | 今日/本周/本月汇总 |

### 6.3 函数接口拆解

#### `ApiResponse<T>::ok(data: T) -> ApiResponse<T>`

- 作用：构造成功返回体。
- 输入：业务数据 `data`。
- 输出：`ok=true`、`data=Some(data)`、`error=None`。

#### `ApiResponse<T>::err(code, message) -> ApiResponse<T>`

- 作用：构造失败返回体。
- 输入：错误码和错误信息。
- 输出：`ok=false`、`data=None`、`error=Some(...)`。

## 7. 本地 agent：`apps/timeline-agent`

### 7.1 模块关系

| 文件 | 职责 |
| --- | --- |
| `main.rs` | 启动入口、初始化和生命周期总控 |
| `config.rs` | 配置加载、默认值、路径解析、前端目录发现 |
| `state.rs` | 运行时共享状态和心跳信息 |
| `db.rs` | SQLite 连接、迁移、写入、查询、统计聚合 |
| `http.rs` | Axum 路由、参数解析、跨域和错误处理 |
| `trackers.rs` | focus/presence/browser 三类状态同步逻辑 |
| `windows.rs` | Win32 API 采集封装 |
| `system.rs` | 托盘、自启动、打开前端等系统集成 |

### 7.2 入口：`apps/timeline-agent/src/main.rs`

#### 文件职责

负责把配置、数据库、运行时状态、后台采集和 HTTP 服务组装起来。

#### 函数清单

##### `main() -> Result<()>`

- 作用：整个 agent 启动入口。
- 输入：无显式参数，读取 CLI 和本机环境。
- 输出：`Result<()>`。
- 关键步骤：
  - 解析 `--config`
  - 加载配置
  - 初始化 tracing
  - 获取单实例锁
  - 连接数据库并修复开放段
  - 构建 `AgentState`
  - 启动 tracker / tray
  - 启动 Axum 服务

##### `init_tracing(debug: bool)`

- 作用：初始化日志输出格式和日志级别。
- 输入：`debug` 控制日志过滤和线程名输出。
- 输出：无。

##### `parse_config_path() -> Option<PathBuf>`

- 作用：从命令行参数中提取 `--config` 后的路径。
- 输入：`env::args()`。
- 输出：显式配置路径；不存在时返回 `None`。

##### `acquire_instance_lock(lockfile_path: &PathBuf) -> Result<std::fs::File>`

- 作用：通过 lock file 保证 agent 单实例运行。
- 输入：锁文件路径。
- 输出：持有排他锁的文件句柄。
- 失败场景：已有实例占用锁时返回错误。

##### `shutdown_signal(shutdown_rx: watch::Receiver<bool>)`

- 作用：等待 `Ctrl+C` 或内部 watch channel 发出的退出信号。
- 输入：关闭通知接收端。
- 输出：无。

### 7.3 配置层：`apps/timeline-agent/src/config.rs`

#### 文件职责

负责读取 TOML 配置、合并默认值、解析相对路径，以及在不同运行方式下找到 Web UI 的 `dist/` 目录。

#### 结构体接口

##### `AppConfig`

字段说明：

| 字段 | 作用 |
| --- | --- |
| `database_path` | SQLite 文件路径 |
| `lockfile_path` | 单实例锁文件路径 |
| `listen_addr` | HTTP 监听地址 |
| `web_ui_url` | 前端入口地址 |
| `idle_threshold_secs` | idle 判定阈值 |
| `poll_interval_millis` | 轮询间隔 |
| `debug` | 是否开启调试日志 |
| `tray_enabled` | 是否启用托盘 |
| `record_window_titles` | 是否记录窗口标题 |
| `record_page_titles` | 是否记录页面标题 |
| `ignored_apps` | 忽略的进程名 |
| `ignored_domains` | 忽略的域名 |

#### 方法与函数清单

##### `AppConfig::load(explicit_path: Option<PathBuf>) -> Result<(AppConfig, PathBuf)>`

- 作用：加载配置文件，或在配置文件缺失时返回带默认值的配置。
- 输入：显式配置文件路径，可为空。
- 输出：`(config, resolved_config_path)`。
- 额外行为：
  - 自动推断运行根目录
  - 兼容旧的 `web_ui_url`
  - 把相对路径转换为绝对路径

##### `AppConfig::ensure_parent_dirs(&self) -> Result<()>`

- 作用：确保数据库文件和锁文件的父目录存在。
- 输入：配置对象。
- 输出：`Result<()>`。

##### `AppConfig::effective_web_ui_url(&self) -> String`

- 作用：返回最终应展示给用户的前端 URL。
- 输入：配置对象。
- 输出：有效 URL。
- 规则：空值、旧默认值、遗留开发地址都会被替换为自托管地址。

##### `AppConfig::web_ui_dist_dir(&self) -> Option<PathBuf>`

- 作用：在常见目录中查找已构建好的前端 `dist/`。
- 输入：配置对象。
- 输出：找到则返回目录，否则 `None`。

##### `AppConfig::self_hosted_web_ui_url(&self) -> String`

- 作用：从 `listen_addr` 推导 `http://host:port/#/stats`。
- 输入：配置对象。
- 输出：自托管前端地址。

##### `AppConfig::resolve_relative_paths(&mut self, runtime_root: &Path)`

- 作用：把相对数据库路径和锁文件路径解析为绝对路径。
- 输入：运行根目录。
- 输出：无，原地修改配置。

##### `normalize_host(host: &str) -> String`

- 作用：规范化监听地址中的 host，用于 URL 拼接。
- 输入：host 字符串。
- 输出：规范化后的 host。
- 特点：会把 `0.0.0.0` / `::` 映射成 `127.0.0.1`。

##### `ensure_parent(path: &Path) -> Result<()>`

- 作用：创建文件父目录。
- 输入：目标路径。
- 输出：`Result<()>`。

##### `resolve_config_path(explicit_path, runtime_root) -> Result<PathBuf>`

- 作用：决定最终使用哪个配置文件路径。
- 输入：显式路径和运行根目录。
- 输出：绝对配置路径。

##### `discover_runtime_root() -> Result<PathBuf>`

- 作用：推断当前运行时根目录。
- 输入：当前工作目录和可执行文件路径。
- 输出：最像项目根或便携包根的目录。

##### `current_exe_parent_candidates() -> Vec<PathBuf>`

- 作用：从当前可执行文件所在路径向上生成候选目录。
- 输入：当前可执行文件路径。
- 输出：候选目录列表。

##### `parent_candidates(base: &Path) -> Vec<PathBuf>`

- 作用：生成 `base`、父目录、祖父目录三层候选。
- 输入：基础目录。
- 输出：候选目录列表。

##### `web_ui_dist_candidates(current_dir, current_exe) -> Vec<PathBuf>`

- 作用：生成可能的前端构建输出目录列表。
- 输入：当前目录和可执行文件路径。
- 输出：候选目录列表。

##### `push_unique(candidates: &mut Vec<PathBuf>, path: PathBuf)`

- 作用：带去重地向候选列表追加路径。
- 输入：候选列表和待加入路径。
- 输出：无。

##### `looks_like_runtime_root(path: &Path) -> bool`

- 作用：判断某个目录是否像项目运行根目录。
- 输入：目录路径。
- 输出：布尔值。

##### `resolve_path(base: &Path, path: &Path) -> PathBuf`

- 作用：把相对路径挂到 `base` 下，绝对路径直接返回。
- 输入：基础路径、目标路径。
- 输出：解析后的路径。

##### `absolutize_from(base: PathBuf, path: PathBuf) -> Result<PathBuf>`

- 作用：相对路径相对 `base` 转绝对路径。
- 输入：基础路径与目标路径。
- 输出：绝对路径。

#### 测试函数

##### `returns_parent_candidates_in_priority_order()`

- 作用：验证候选父目录的优先顺序。

##### `resolves_relative_runtime_paths_against_runtime_root()`

- 作用：验证运行时相对路径会挂到 runtime root 下。

##### `keeps_absolute_runtime_paths_unchanged()`

- 作用：验证绝对路径不会被错误改写。

##### `resolves_config_relative_paths_against_config_directory()`

- 作用：验证配置文件中的相对路径按配置文件目录解析。

##### `prefers_packaged_web_ui_before_working_directory()`

- 作用：验证便携包场景优先命中打包后的前端目录。

##### `still_discovers_repo_dist_for_dev_binaries()`

- 作用：验证开发构建的二进制仍能回退发现仓库内的 `apps/web-ui/dist`。

### 7.4 运行时状态：`apps/timeline-agent/src/state.rs`

#### 文件职责

保存当前开放中的 focus / presence / browser segment，以及监视器心跳、自启动命令和关闭信号等全局运行状态。

#### 结构体接口

##### `RuntimeState`

- 作用：持有当前开放的三个 segment。

##### `MonitorTelemetry`

- 作用：保存各监视器最后一次心跳时间。

##### `OpenFocusSegment`

- 字段：
  - `id`：数据库记录 id
  - `fingerprint`：窗口指纹
  - `is_browser`：当前 focus 是否是浏览器

##### `OpenPresenceSegment`

- 字段：
  - `id`：数据库记录 id
  - `state`：当前 presence 状态

##### `OpenBrowserSegment`

- 字段：
  - `id`
  - `domain`
  - `browser_window_id`
  - `tab_id`

##### `AgentState`

- 作用：运行时共享句柄，内部包了一层 `Arc<AgentStateInner>`。

#### 方法清单

##### `AgentState::new(...) -> AgentState`

- 作用：构造全局共享状态。
- 输入：配置、配置路径、store、启动时间、时区、shutdown sender。
- 输出：`AgentState`。

##### `AgentState::config(&self) -> &AppConfig`

- 作用：访问配置。
- 输出：配置引用。

##### `AgentState::store(&self) -> &AgentStore`

- 作用：访问数据库句柄。
- 输出：store 引用。

##### `AgentState::config_path(&self) -> Option<&PathBuf>`

- 作用：读取启动时使用的配置文件路径。

##### `AgentState::started_at(&self) -> OffsetDateTime`

- 作用：读取 agent 启动时间。

##### `AgentState::timezone(&self) -> UtcOffset`

- 作用：读取本地时区偏移。

##### `AgentState::runtime(&self) -> MutexGuard<RuntimeState>`

- 作用：获取运行时状态互斥锁。
- 用途：tracker 修改当前开放 segment 时使用。

##### `AgentState::monitor_snapshot(&self) -> MonitorTelemetry`

- 作用：读取监视器状态快照。

##### `AgentState::mark_focus_online(&self, seen_at)`

- 作用：写入 focus tracker 心跳时间。

##### `AgentState::mark_presence_online(&self, seen_at)`

- 作用：写入 presence tracker 心跳时间。

##### `AgentState::mark_browser_online(&self, seen_at)`

- 作用：写入 browser bridge 心跳时间。

##### `AgentState::mark_tray_online_sync(&self, seen_at)`

- 作用：同步更新托盘心跳。
- 备注：托盘运行在线程里，用 `blocking_lock()`。

##### `AgentState::launch_command(&self) -> String`

- 作用：生成用于注册表开机自启的启动命令。
- 输出：包含当前 exe 路径和可选 `--config` 参数的命令行字符串。

##### `AgentState::request_shutdown(&self)`

- 作用：设置关闭标记并发出 watch 通知。

##### `AgentState::shutdown_requested(&self) -> bool`

- 作用：读取是否请求关闭。

### 7.5 Windows 采集：`apps/timeline-agent/src/windows.rs`

#### 文件职责

封装前台窗口、进程、窗口标题、输入空闲时间、锁屏状态等 Win32 采集逻辑。

#### 结构体接口

##### `ForegroundWindowSnapshot`

字段说明：

| 字段 | 作用 |
| --- | --- |
| `hwnd` | 窗口句柄值 |
| `process_id` | 进程 id |
| `session_id` | Windows session id |
| `process_name` | 进程名 |
| `exe_path` | 可执行文件完整路径 |
| `window_title` | 窗口标题 |
| `is_browser` | 是否属于浏览器进程 |

##### `ForegroundWindowSnapshot::fingerprint(&self) -> String`

- 作用：生成 focus 去重指纹。
- 组成：`hwnd:process_id:window_title`。

#### 函数清单

##### `capture_foreground_window() -> Result<Option<ForegroundWindowSnapshot>>`

- 作用：读取当前前台可见窗口。
- 输出：
  - `Ok(Some(snapshot))`：成功读取窗口
  - `Ok(None)`：没有前台窗口或窗口不可用
  - `Err(...)`：Win32 调用失败

##### `detect_presence(idle_threshold: Duration) -> Result<PresenceState>`

- 作用：判断当前用户处于 active / idle / locked。
- 输入：idle 阈值。
- 输出：`PresenceState`。

##### `read_idle_duration() -> Result<Duration>`

- 作用：读取距最后一次输入已经过去多久。
- 输入：无。
- 输出：空闲时长。

##### `read_window_title(hwnd: HWND) -> Option<String>`

- 作用：读取窗口标题。
- 输入：窗口句柄。
- 输出：去除空白后的标题；空标题返回 `None`。

##### `read_process_path(process_id: u32) -> Result<String>`

- 作用：读取进程可执行文件路径。
- 输入：进程 id。
- 输出：进程完整路径。

##### `read_session_id(process_id: u32) -> Result<u32>`

- 作用：读取进程所属 session id。

##### `is_workstation_locked() -> Result<bool>`

- 作用：通过输入桌面名判断当前是否锁屏。
- 规则：输入桌面不是 `Default` 时视为锁屏。

##### `is_browser_process(process_name: &str) -> bool`

- 作用：判断进程名是否属于受支持浏览器。
- 当前识别：`chrome.exe`、`msedge.exe`、`firefox.exe`、`brave.exe`。

##### `HandleGuard::drop(&mut self)`

- 作用：在离开作用域时关闭 Win32 `HANDLE`。

##### `DesktopGuard::drop(&mut self)`

- 作用：在离开作用域时关闭 Win32 desktop handle。

### 7.6 采集同步层：`apps/timeline-agent/src/trackers.rs`

#### 文件职责

把 Windows 观测值与内存中的“当前开放段”做状态机同步，并把变化持久化到 SQLite。

#### 函数清单

##### `spawn_trackers(state: AgentState)`

- 作用：并发启动 focus tracker 和 presence tracker 两个后台任务。

##### `run_focus_tracker(state: AgentState) -> Result<()>`

- 作用：按轮询频率读取前台窗口并同步 focus segment。

##### `run_presence_tracker(state: AgentState) -> Result<()>`

- 作用：按轮询频率读取 presence 并同步 presence segment。

##### `sync_focus_snapshot(state, snapshot, observed_at) -> Result<()>`

- 作用：根据新的前台窗口快照更新 focus 状态机。
- 输入：
  - `snapshot`：新的窗口快照，可为空
  - `observed_at`：本次观测时间
- 输出：`Result<()>`
- 行为：
  - 同窗口：touch 现有 segment
  - 切换窗口：结束旧 focus 段
  - 离开浏览器：顺带结束当前 browser 段
  - 新窗口未被忽略：创建新 focus 段并写入 raw event

##### `sync_presence_state(state, presence, observed_at) -> Result<()>`

- 作用：根据新的 presence 状态更新 presence segment。
- 规则：同状态 touch，不同状态则结束旧段、开启新段。

##### `sync_browser_event(state, payload, observed_at) -> Result<BrowserEventAck>`

- 作用：处理浏览器扩展上报。
- 输入：浏览器事件 payload 和观测时间。
- 输出：是否被接受的 ack。
- 决策逻辑：
  - ignored domain：拒绝并关闭当前 browser 段
  - 当前前台不是浏览器：拒绝并关闭当前 browser 段
  - 与当前 segment 连续：touch
  - 其他情况：结束旧段并开启新 browser 段

##### `is_ignored_app(state, process_name) -> bool`

- 作用：检查进程名是否在忽略列表。

##### `is_ignored_domain(state, domain) -> bool`

- 作用：检查域名是否在忽略列表。

##### `display_name_for_process(process_name) -> String`

- 作用：把进程名映射为更友好的显示名。
- 逻辑：
  - 常见应用走固定映射
  - 未命中时去掉 `.exe` 并按 `-` / `_` 切词后 title case

##### `title_case_word(value: &str) -> String`

- 作用：把单词首字母大写，其余字符小写。

### 7.7 数据持久化层：`apps/timeline-agent/src/db.rs`

#### 文件职责

这是 agent 的数据核心层，负责：

- 连接 SQLite
- 执行 migration
- 写入 focus / browser / presence / raw_events
- 查询单日时间线
- 聚合应用、域名、专注、月历、周期统计

#### 主要公开接口

##### `AgentStore::connect(config: &AppConfig) -> Result<AgentStore>`

- 作用：连接 SQLite，并确保目录存在、数据库文件可创建、migration 已执行。

##### `AgentStore::restore_unclosed_segments(&self) -> Result<()>`

- 作用：修复上次异常退出留下的开放 segment。
- 规则：`ended_at = COALESCE(last_seen_at, started_at)`。

##### `AgentStore::upsert_app_registry(process_name, display_name, observed_at) -> Result<()>`

- 作用：维护 `app_registry` 应用注册表。
- 行为：按 `process_name` upsert。

##### `AgentStore::start_focus_segment(app, observed_at) -> Result<i64>`

- 作用：创建新的 focus 段。
- 输出：新行 id。

##### `AgentStore::end_focus_segment(id, observed_at) -> Result<()>`

- 作用：结束指定 focus 段，并更新 `last_seen_at`。

##### `AgentStore::touch_focus_segment(id, observed_at) -> Result<()>`

- 作用：在 focus 段持续未切换时，只刷新 `last_seen_at`。

##### `AgentStore::start_presence_segment(state, observed_at) -> Result<i64>`

- 作用：创建新的 presence 段。

##### `AgentStore::end_presence_segment(id, observed_at) -> Result<()>`

- 作用：结束 presence 段。

##### `AgentStore::touch_presence_segment(id, observed_at) -> Result<()>`

- 作用：刷新 presence 段 `last_seen_at`。

##### `AgentStore::start_browser_segment(payload, observed_at) -> Result<i64>`

- 作用：创建新的 browser 段。

##### `AgentStore::end_browser_segment(id, observed_at) -> Result<()>`

- 作用：结束 browser 段。

##### `AgentStore::touch_browser_segment(id, observed_at) -> Result<()>`

- 作用：刷新 browser 段 `last_seen_at`。

##### `AgentStore::append_raw_event(kind, payload, observed_at) -> Result<()>`

- 作用：把原始事件写入 `raw_events`。
- 用途：本地调试、问题排查。

##### `AgentStore::read_day_timeline(date, timezone) -> Result<TimelineDayResponse>`

- 作用：读取某一天的完整时间线。
- 输出：focus / browser / presence 三类段。
- 特点：
  - 自动把跨天段裁剪到当天边界
  - 开放段会按“当前时间”补上结束时间供前端展示

##### `AgentStore::read_app_stats(date, timezone) -> Result<Vec<DurationStat>>`

- 作用：按应用聚合当天 focus 时长。

##### `AgentStore::read_domain_stats(date, timezone) -> Result<Vec<DurationStat>>`

- 作用：按域名聚合当天 browser 时长。

##### `AgentStore::read_focus_stats(date, timezone) -> Result<FocusStats>`

- 作用：计算当天专注统计。
- 指标：
  - `total_focus_seconds`
  - `total_active_seconds`
  - `switch_count`
  - `longest_focus_block_seconds`
  - `average_focus_block_seconds`

##### `AgentStore::read_day_summary(date, timezone) -> Result<DaySummary>`

- 作用：把某天聚合成月历/概览视图需要的小摘要。

##### `AgentStore::read_month_calendar(year, month, timezone) -> Result<MonthCalendarResponse>`

- 作用：返回某月每天的摘要列表。

##### `AgentStore::read_period_summary(anchor_date, timezone) -> Result<PeriodSummaryResponse>`

- 作用：计算基于某个 anchor date 的今日 / 本周 / 本月汇总。

##### `AgentStore::aggregate_period(start, end, timezone) -> Result<PeriodStat>`

- 作用：按天遍历并累加一个时间区间的 focus / active 总量。
- 可见性：内部方法。

##### `AgentStore::read_recent_events(limit) -> Result<Vec<DebugEvent>>`

- 作用：读取最近原始事件。

##### `AgentStore::run_migrations(&self) -> Result<()>`

- 作用：创建 `schema_migrations` 并按版本执行 SQL migration。

#### 查询与时间辅助函数

##### `parse_segment_bounds(row, now_utc, day_start, day_end) -> Result<(OffsetDateTime, OffsetDateTime)>`

- 作用：把数据库中的 `started_at` / `ended_at` 解析成时间，并裁剪到查询日范围。

##### `day_bounds(date, timezone) -> Result<(OffsetDateTime, OffsetDateTime)>`

- 作用：把某个本地日期转换为对应的 UTC `[当天 00:00, 次日 00:00)`。

##### `clamp_start(value, min) -> OffsetDateTime`

- 作用：把 segment 开始时间限制在查询日开始之后。

##### `clamp_end(value, max, min) -> OffsetDateTime`

- 作用：把 segment 结束时间限制在 `[day_start, day_end]` 之间。

##### `parse_time(value: &str) -> Result<OffsetDateTime>`

- 作用：把 RFC3339 字符串解析成 `OffsetDateTime`。

##### `format_time(value: OffsetDateTime) -> Result<String>`

- 作用：把时间格式化成 RFC3339。

##### `parse_presence_state(value: &str) -> Result<PresenceState>`

- 作用：把数据库中的字符串状态还原成枚举。

##### `presence_label(value: &PresenceState) -> &'static str`

- 作用：把 presence 枚举转回数据库字符串。

##### `segment_seconds_focus(segment: &FocusSegment) -> i64`

- 作用：计算 focus 段持续秒数。

##### `segment_seconds_browser(segment: &BrowserSegment) -> i64`

- 作用：计算 browser 段持续秒数。

##### `segment_seconds_presence(segment: &PresenceSegment) -> i64`

- 作用：计算 presence 段持续秒数。

##### `to_duration_stats(buckets, total_seconds) -> Vec<DurationStat>`

- 作用：把聚合桶转成带百分比且按时长降序排列的统计列表。

##### `top_entry(segments, key_fn, label_fn, secs_fn) -> Option<KeyedDurationEntry>`

- 作用：从一组 segment 中找出总时长最长的 key。

##### `days_in_month(year, month) -> u8`

- 作用：计算某年某月天数。

#### 测试函数

##### `restore_unclosed_segments_uses_last_seen_at_instead_of_restart_time()`

- 作用：验证恢复开放段时用的是 `last_seen_at`，而不是进程重启时刻。

##### `temp_lock_path(database_path: &Path) -> PathBuf`

- 作用：测试中派生锁文件路径。

### 7.8 HTTP 层：`apps/timeline-agent/src/http.rs`

#### 文件职责

暴露本地 API、做日期参数解析、限制浏览器请求来源、封装统一错误格式，并托管 Web UI 静态文件。

#### 路由总表

| 路由 | 处理函数 | 作用 |
| --- | --- | --- |
| `GET /health` | `get_health` | 服务状态 |
| `GET /api/timeline/day` | `get_timeline_day` | 单日时间线 |
| `GET /api/stats/apps` | `get_app_stats` | 应用聚合 |
| `GET /api/stats/domains` | `get_domain_stats` | 域名聚合 |
| `GET /api/stats/focus` | `get_focus_stats` | 专注统计 |
| `GET /api/settings` | `get_settings` | 设置页数据 |
| `POST /api/settings/autostart` | `post_autostart` | 更新开机自启动 |
| `GET /api/debug/recent-events` | `get_recent_events` | 最近原始事件 |
| `POST /api/events/browser` | `post_browser_event` | 接收扩展上报 |
| `GET /api/calendar/month` | `get_month_calendar` | 月历摘要 |
| `GET /api/stats/summary` | `get_period_summary` | 今日/周/月汇总 |

#### 函数清单

##### `build_router(state: AgentState) -> Router`

- 作用：组装全部路由、中间件、CORS 和静态文件托管。

##### `get_health(State(state)) -> Result<Json<ApiResponse<HealthResponse>>, AppError>`

- 作用：返回服务名、版本、启动时间、数据库路径、监听地址和时区。

##### `get_timeline_day(State(state), Query(query)) -> Result<Json<ApiResponse<TimelineDayResponse>>, AppError>`

- 作用：读取单日时间线。

##### `get_app_stats(...) -> Result<Json<ApiResponse<Vec<DurationStat>>>, AppError>`

- 作用：读取按应用聚合的统计。

##### `get_domain_stats(...) -> Result<Json<ApiResponse<Vec<DurationStat>>>, AppError>`

- 作用：读取按域名聚合的统计。

##### `get_focus_stats(...) -> Result<Json<ApiResponse<FocusStats>>, AppError>`

- 作用：读取专注统计。

##### `get_recent_events(...) -> Result<Json<ApiResponse<Vec<DebugEvent>>>, AppError>`

- 作用：读取最近原始事件。

##### `get_settings(...) -> Result<Json<ApiResponse<AgentSettingsResponse>>, AppError>`

- 作用：返回设置页所需数据，包括 autostart、tray、launch command、monitor 状态。

##### `post_autostart(...) -> Result<Json<ApiResponse<UpdateAutostartResponse>>, AppError>`

- 作用：切换开机自启。

##### `post_browser_event(...) -> Result<Json<ApiResponse<BrowserEventAck>>, AppError>`

- 作用：接收浏览器扩展上报，并转交给 `sync_browser_event()`。

##### `get_month_calendar(...) -> Result<Json<ApiResponse<MonthCalendarResponse>>, AppError>`

- 作用：返回某月的日摘要。

##### `get_period_summary(...) -> Result<Json<ApiResponse<PeriodSummaryResponse>>, AppError>`

- 作用：返回今日/本周/本月摘要。

##### `parse_or_today(value, timezone) -> Result<Date, AppError>`

- 作用：解析 `YYYY-MM-DD`；为空时取 agent 当前本地日期。

##### `parse_or_current_month(value, timezone) -> Result<(i32, Month), AppError>`

- 作用：解析 `YYYY-MM`；为空时取 agent 当前本地月份。

##### `build_cors_layer() -> CorsLayer`

- 作用：只允许本地 loopback 浏览器来源跨域访问。

##### `validate_request_origin(request, next) -> Response`

- 作用：在请求进入业务处理前校验 `Origin`。
- 特别规则：支持带专用 header 的浏览器扩展请求。

##### `is_allowed_browser_origin(origin, headers) -> bool`

- 作用：判断某个浏览器请求来源是否允许。

##### `is_allowed_loopback_origin(origin: &HeaderValue) -> bool`

- 作用：判断某个来源是否属于 `127.0.0.1` / `localhost` / `::1`。

##### `extract_host(authority: &str) -> Option<&str>`

- 作用：从 authority 中提取 host，兼容 IPv6 bracket 形式。

##### `frontend_not_built() -> impl IntoResponse`

- 作用：在前端未构建时返回提示 HTML。

##### `build_monitor_statuses(state: &AgentState) -> Vec<AgentMonitorStatus>`

- 作用：把 monitor telemetry 转换为设置页可展示的监视器状态列表。

##### `monitor_status(key, label, last_seen, freshness, now, detail) -> AgentMonitorStatus`

- 作用：根据最后心跳时间计算 `online / stale / waiting`。

#### 错误包装接口

##### `AppError::bad_request(code, message) -> AppError`

- 作用：构造 400 错误。

##### `AppError::internal(error) -> AppError`

- 作用：构造 500 错误。

##### `impl From<anyhow::Error> for AppError`

- 作用：把内部错误统一转换成 HTTP 500。

##### `impl IntoResponse for AppError`

- 作用：把 `AppError` 转成统一的 JSON 错误响应。

##### `into_response(self) -> Response`

- 作用：`IntoResponse` 的实际实现函数，把 `AppError` 序列化成 HTTP 响应体。

#### 测试函数

##### `allows_loopback_http_origins()`

- 作用：验证 loopback 来源会被允许通过。

##### `rejects_non_loopback_origins()`

- 作用：验证非本地来源会被拒绝。

### 7.9 系统集成：`apps/timeline-agent/src/system.rs`

#### 文件职责

负责 Windows 注册表自启动、打开前端、系统托盘与托盘菜单交互。

#### 函数清单

##### `autostart_enabled() -> Result<bool>`

- 作用：读取注册表，判断是否启用开机自启。

##### `set_autostart_enabled(state, enabled) -> Result<bool>`

- 作用：写入或删除注册表项，并返回最终状态。

##### `open_frontend(url: &str) -> Result<()>`

- 作用：调用 `ShellExecuteW` 打开默认浏览器访问前端地址。

##### `to_wide(value: &str) -> Vec<u16>`

- 作用：把 Rust 字符串编码成 Win32 API 需要的 UTF-16 宽字符串。

##### `spawn_tray(state: AgentState)`

- 作用：启动托盘线程。

##### `run_tray_loop(state: AgentState) -> Result<()>`

- 作用：创建托盘图标、菜单、事件循环，并处理点击和退出。

##### `build_tray_menu() -> Menu`

- 作用：构建托盘菜单，目前包含“打开时间线”和“退出”。

##### `build_tray_icon() -> Result<Icon>`

- 作用：程序化生成 32x32 RGBA 托盘图标。

## 8. 浏览器扩展：`apps/browser-extension`

### 8.1 文件职责

| 文件 | 作用 |
| --- | --- |
| `service-worker.js` | 扩展后台逻辑，监听浏览器事件并上报 agent |
| `content-script.js` | 在本地 dashboard 页面上报 agent origin |
| `manifest.json` | MV3 清单 |

### 8.2 `service-worker.js`

#### 核心状态

| 变量 | 作用 |
| --- | --- |
| `activeTabsByWindow` | 记录每个浏览器窗口的活动标签页 |
| `focusedWindowId` | 当前聚焦的浏览器窗口 id |
| `followUpTimers` | 延迟补采样定时器 |

#### 顶层监听器

这些监听器不是独立命名函数，但它们构成扩展主行为：

- `chrome.runtime.onInstalled`
- `chrome.runtime.onStartup`
- `chrome.tabs.onActivated`
- `chrome.tabs.onHighlighted`
- `chrome.tabs.onUpdated`
- `chrome.tabs.onRemoved`
- `chrome.windows.onRemoved`
- `chrome.windows.onFocusChanged`
- `chrome.alarms.onAlarm`
- `chrome.runtime.onMessage`

它们统一围绕两件事工作：

1. 更新“哪个窗口、哪个 tab 是当前活动目标”。
2. 触发 `reportFocusedWindowTab()` 或 `reportTab()` 上报 agent。

#### 函数清单

##### `bootstrapState(reason)`

- 作用：扩展启动后初始化活动 tab 缓存、聚焦窗口，并立即上报一次。

##### `syncActiveTabs()`

- 作用：重建 `activeTabsByWindow` 缓存。

##### `reportFocusedWindowTab(reason)`

- 作用：读取当前聚焦浏览器窗口的活动 tab，并上报。

##### `syncFocusedWindowId()`

- 作用：把 `focusedWindowId` 同步到当前最后一个聚焦窗口。

##### `scheduleFocusedWindowRefresh(reason)`

- 作用：在事件发生后安排几次延迟重试上报。
- 目的：覆盖 URL/title 异步更新和浏览器内部状态滞后的情况。

##### `clearFollowUpRefreshes()`

- 作用：取消尚未触发的补采样定时器。

##### `reportTab(tab, reason)`

- 作用：把某个 tab 转成 payload 并尝试发送给 agent。
- 逻辑：
  - 生成 payload
  - 尝试多个 agent base URL
  - 网络失败则继续试下一个地址
  - 一旦成功或收到明确拒绝，就停止重试列表

##### `cacheActiveTab(tab)`

- 作用：把窗口当前活动 tab 写入缓存。

##### `buildPayload(tab)`

- 作用：把 Chrome tab 对象转换成 agent 所需的 `BrowserEventPayload`。
- 过滤：
  - 必须有 `url`
  - 必须有 `windowId` 和 `tab.id`
  - 只接受 `http/https`
  - 必须能提取 hostname

##### `ensureHeartbeat()`

- 作用：创建每分钟一次的心跳 alarm。

##### `getAgentBaseUrls()`

- 作用：返回候选 agent 地址列表。
- 来源：最近一次成功地址 + 默认本地地址。

##### `readStoredAgentBaseUrl()`

- 作用：从 `chrome.storage.local` 读取最近记住的 agent 地址。

##### `rememberAgentBaseUrl(agentBaseUrl)`

- 作用：把有效的 loopback agent 地址存入本地存储。

##### `rememberDiscoveredAgentOrigin(origin)`

- 作用：当内容脚本在本地 dashboard 中发现新的 origin 时，验证其 `/health` 并记住它。

##### `postBrowserEvent(agentBaseUrl, payload)`

- 作用：向 agent 的 `/api/events/browser` 发请求。
- 返回：
  - `success`
  - `rejected`
  - `network_error`

##### `uniqueValues(values)`

- 作用：数组去重。

##### `isLoopbackHttpUrl(value)`

- 作用：判断某个 URL 是否指向本地 loopback。

### 8.3 `content-script.js`

#### 文件职责

没有命名函数，只有一段很小的顶层逻辑：

- 当页面运行在 `127.0.0.1` 或 `localhost` 时
- 向后台 worker 发送 `timeline-discover-agent`
- 让扩展学会当前 dashboard 的真实 agent origin

这使扩展可以自动适配自定义本地端口。

## 9. Web UI：`apps/web-ui`

### 9.1 分层理解

Web UI 基本可以分成 4 层：

| 层 | 文件 | 职责 |
| --- | --- | --- |
| API 层 | `src/api.ts` | 调用 agent HTTP API |
| 数据建模层 | `src/lib/chart-model.ts` | 把接口数据转成图表模型 |
| 通用组件层 | `src/components/*` | calendar / donut / timeline 等组件 |
| 页面编排层 | `src/App.tsx` | stats / timeline / settings 页面与状态管理 |

### 9.2 API 层：`apps/web-ui/src/api.ts`

#### 文件职责

封装浏览器端对本地 agent 的调用，并定义前端消费的 TypeScript 响应类型。

#### 函数清单

##### `isLocalDevServer() -> boolean`

- 作用：判断当前是否运行在 Vite dev/preview 服务上。

##### `request<T>(path: string) -> Promise<T>`

- 作用：统一 GET 请求逻辑。
- 输入：相对 API 路径。
- 输出：解包后的业务数据。
- 错误行为：网络不可达或响应 envelope 非 `ok` 时抛错。

##### `getTimeline(date?: string)`

- 作用：读取指定日期的时间线。

##### `getAppStats(date: string)`

- 作用：读取应用统计。

##### `getDomainStats(date: string)`

- 作用：读取域名统计。

##### `getFocusStats(date: string)`

- 作用：读取 focus 统计。

##### `getAgentSettings()`

- 作用：读取设置页所需数据。

##### `updateAutostart(payload: UpdateAutostartRequest)`

- 作用：调用 POST 接口切换开机自启。

##### `getMonthCalendar(month: string)`

- 作用：读取某月日摘要。

##### `getPeriodSummary(date?: string)`

- 作用：读取今日/周/月摘要。

### 9.3 图表建模层：`apps/web-ui/src/lib/chart-model.ts`

#### 文件职责

把后端时间线原始段数据转换为前端图表统一使用的 `ChartSegment` / `DonutSlice` 模型。

#### 核心模型

| 类型 | 作用 |
| --- | --- |
| `TooltipDatum` | 浮层提示数据 |
| `DashboardFilter` | 当前筛选条件 |
| `ChartSegment` | 时间轴/列表统一段模型 |
| `DonutSlice` | donut 图扇区模型 |
| `DashboardModel` | stats / timeline 页面共用模型 |
| `BrowserDetailModel` | 某个浏览器 focus 段的域名细分模型 |

#### 函数清单

##### `buildDashboardModel(timeline, activeOnly) -> DashboardModel`

- 作用：把后端单日时间线转换成前端 dashboard 统一模型。
- 输出：
  - `focusSegments`
  - `browserSegments`
  - `presenceSegments`
  - `app/domain/presence` 三组 donut slices
  - summary 和 meta

##### `buildBrowserDetailModel(selectedFocusSegment, browserSegments, selectedDomainKey) -> BrowserDetailModel`

- 作用：在某个浏览器 focus 段内部，计算域名细分段和 donut。

##### `formatDuration(seconds) -> string`

- 作用：把秒数格式化为 `Xm` / `Xh` / `Xh Ym`。

##### `formatClockRange(startSec, endSec) -> string`

- 作用：格式化 `HH:MM - HH:MM`。

##### `isFilterActive(filter, kind, key) -> boolean`

- 作用：判断当前某个 donut slice 是否命中筛选条件。

##### `toFocusChartSegments(segments, activeIntervals, timeContext) -> ChartSegment[]`

- 作用：把后端 focus 段转成图表 focus 段，并按 active interval 做裁剪。

##### `toBrowserChartSegments(segments, activeIntervals, timeContext) -> ChartSegment[]`

- 作用：把后端 browser 段转成图表 browser 段。

##### `toPresenceChartSegments(segments, timeContext) -> ChartSegment[]`

- 作用：把后端 presence 段转成图表 presence 段。

##### `mergeAdjacentFocusSegments(segments) -> ChartSegment[]`

- 作用：把相邻且同 key 的 focus 段合并，减少视觉碎片。
- 合并条件：同 app、同浏览器属性、间隔不超过 60 秒。

##### `buildActiveIntervals(segments, timeContext) -> Interval[]`

- 作用：从 presence 段中提取 active 区间。

##### `buildDonutSlices(segments, topN) -> DonutSlice[]`

- 作用：把图表段按 key 聚合成 donut 扇区。
- 特点：超出 `topN` 的尾部会合并成“其他”。

##### `clipSegment(range, activeIntervals) -> Interval[]`

- 作用：把一个区间裁剪到 active interval 列表上。

##### `toRange(startedAt, endedAt, timeContext) -> Interval | null`

- 作用：把 ISO 时间字符串转换成相对当天零点的秒数区间。

##### `toSecondsSinceMidnight(value, timeContext) -> number`

- 作用：把 UTC 时间戳映射为“目标日期本地时间的秒数”。
- 额外行为：跨天时会裁剪到 `0` 或 `DAY_SECONDS`。

##### `parseUtcOffsetMillis(value) -> number`

- 作用：解析 `+08:00` 这类时区偏移字符串。

##### `formatClock(seconds) -> string`

- 作用：秒数转 `HH:MM`。

##### `sumDurations(segments) -> number`

- 作用：累加一组 segment 的持续秒数。

##### `assignDistinctColors(segments, namespace) -> ChartSegment[]`

- 作用：按总时长给 app/domain key 分配稳定颜色。

##### `buildDistinctPalette(count, namespace) -> string[]`

- 作用：构建颜色序列，优先使用预置色，不够时再生成。

##### `generatedDistinctColor(index, namespace) -> string`

- 作用：用 HSL 规则生成补充颜色。

##### `presenceLabel(state) -> string`

- 作用：presence 状态转中文标签。

##### `presenceColor(state) -> string`

- 作用：presence 状态转颜色。

##### `todayString() -> string`

- 作用：生成今天的 `YYYY-MM-DD` 字符串。

### 9.4 通用组件层

#### `apps/web-ui/src/components/chart-tooltip.tsx`

##### `ChartTooltip(props) -> JSX.Element | null`

- 作用：渲染统一的浮层提示。
- 输入：`tooltip: TooltipDatum | null`。
- 输出：无 tooltip 时返回 `null`。

#### `apps/web-ui/src/components/donut-chart.tsx`

##### `DonutChart(props) -> JSX.Element`

- 作用：渲染带图例列表和筛选交互的大 donut 图。
- 输入：
  - `title`
  - `totalLabel`
  - `slices`
  - `filter`
  - `filterKind`
  - `onSelect`

##### `CompactDonutChart(props) -> JSX.Element`

- 作用：渲染更紧凑的 donut，用于状态分布卡片。

##### `getSliceDatum(params) -> DonutSlice | null`

- 作用：从 ECharts 事件参数中提取 `DonutSlice`。

##### `escapeHtml(value) -> string`

- 作用：对 tooltip 中的文本做 HTML 转义。

##### `collapseSlices(slices, keepTopN) -> DonutSlice[]`

- 作用：把长尾 slice 折叠成“其他”。

#### `apps/web-ui/src/components/calendar-grid.tsx`

##### `CalendarGrid(props) -> JSX.Element`

- 作用：渲染月历热力格子，并支持切月和选日。

##### `buildCalendarCells(month, days) -> CalendarCell[]`

- 作用：生成包含前置空格、后置空格、热度等级和 tooltip 的月历格子列表。

##### `heatTier(value, max) -> 0 | 1 | 2 | 3 | 4`

- 作用：把活跃时长映射成热力等级。

##### `shiftMonth(month, delta) -> string`

- 作用：月份前后移动。

##### `buildMonthSummary(days) -> { totalActiveSeconds; activeDays }`

- 作用：计算月历顶部摘要。

#### `apps/web-ui/src/components/timeline-chart.tsx`

##### `TimelineChart(props) -> JSX.Element`

- 作用：渲染交互式时间线视图，支持：
  - 多行 lane 展示
  - 鼠标悬浮时刻检查
  - 全日 overview 缩放
  - 视窗拖拽/缩放
  - 当前可见区段表格

##### `buildRows(rows) -> RowLayout[]`

- 作用：把外部传入的时间线行按 key 拆分或直接布局成渲染行。

##### `buildLanes(segments) -> ChartSegment[][]`

- 作用：用贪心算法把重叠 segment 打包到最少的不重叠 lane 中。

##### `buildTicks(viewStartSec, viewEndSec, trackWidth)`

- 作用：根据当前视窗范围和容器宽度生成时间刻度。

##### `buildOverviewSegments(rows) -> OverviewSegment[]`

- 作用：为 overview 总览条生成小块布局。

##### `buildVisibleItems(rows, viewStartSec, viewEndSec) -> ChartSegment[]`

- 作用：提取当前视窗内应出现在表格里的 segment。

##### `buildInspectionItems(rows, seconds) -> InspectionItem[]`

- 作用：生成某一时刻悬浮检查面板中的项目列表。

##### `findSegmentAtTime(row, seconds) -> ChartSegment | null`

- 作用：在某行某时刻找到命中的 segment。

##### `clipSegment(segment, viewStartSec, viewEndSec) -> { startSec; endSec } | null`

- 作用：把 segment 裁剪到当前视窗。

##### `beginOverviewDrag(event, mode, props, dragStateRef)`

- 作用：初始化 overview 拖拽状态。

##### `updateHoveredTime(clientX, trackRef, laneTrackRef, viewStartSec, visibleDuration, ...)`

- 作用：把鼠标横坐标换算成当前悬浮时刻，并更新轴线和时间线位置。

##### `clampWindow(startSec, endSec, duration)`

- 作用：把视窗限制在全天 `0..DAY_SECONDS` 范围内。

##### `chooseTickStep(duration, trackWidth)`

- 作用：根据视图跨度和宽度自动选择合适的刻度步长。

##### `formatTickLabel(seconds, step) -> string`

- 作用：格式化时间轴刻度文本。

##### `formatClock(seconds) -> string`

- 作用：秒数转 `HH:MM`。

##### `pad(value) -> string`

- 作用：数字左侧补零。

##### `snapToStep(seconds) -> number`

- 作用：把时间吸附到 5 分钟刻度。

##### `clampNumber(value, min, max) -> number`

- 作用：数值裁剪工具。

##### `buildTooltipText(segment) -> string`

- 作用：构造时间线条目的 title 文本。

##### `segmentTypeLabel(segment) -> string`

- 作用：把 `focus/browser/presence` 和浏览器 app 特性转成显示标签。

### 9.5 页面编排层：`apps/web-ui/src/App.tsx`

#### 文件职责

这是前端的主页面容器，负责：

- 首次加载
- 页面路由（hash）
- 当前日期和月份状态
- 统计页、时间线页、设置页的装配
- 时间窗口缩放与切换

#### 页面级组件

##### `App()`

- 作用：整个前端应用根组件。
- 管理的核心状态：
  - 当前 page
  - 当前选中日期
  - timeline / settings / period / calendar 数据
  - 刷新状态
  - 错误状态
  - donut 筛选
  - 时间窗口和缩放
- 关键内部流程：
  - 首次 `bootstrap()`：并发拉取 timeline、settings、period summary
  - 日期变化 `loadSelectedDate()`：刷新 timeline 和 period summary
  - 月份变化：刷新 month calendar

##### `App` 内部关键闭包

###### `bootstrap()`

- 作用：首次进入页面时加载基础数据并决定初始时间窗口。

###### `loadSelectedDate()`

- 作用：在日期切换后刷新时间线和周期摘要。

###### `applySelectedDate(nextDate)`

- 作用：统一处理日切换，并重置域名筛选与时间窗口。

###### `handleCalendarMonthChange(nextMonth)`

- 作用：切月时同步更新所选日期和时间窗口。

##### `StatsPage(props)`

- 作用：渲染统计概览页。
- 主要包含：
  - `WeeklyRhythmCard`
  - `FocusBalanceCard`
  - 应用 donut
  - 域名 donut
  - 月历热力图

##### `WeeklyRhythmCard(props)`

- 作用：展示本周/本月活跃或应用时长，并支持切换指标类型。

##### `FocusBalanceCard(props)`

- 作用：展示 active / idle / locked 状态分布，以及最长连续时长和活跃占比。

##### `WeeklyBarChart(props)`

- 作用：渲染一周柱状图，并支持点击某日切换页面日期。

##### `TimelinePage(props)`

- 作用：渲染时间线页，包括：
  - 时间窗口缩放控制
  - `TimelineChart`
  - 当前窗口内事件列表

##### `SettingsPage(props)`

- 作用：渲染设置页，包括：
  - 服务信息
  - 启动与当前视图
  - 监视器状态

##### `FocusSegmentList(props)`

- 作用：渲染当前时间窗口内的 focus 事件列表。
- 特点：对浏览器段补充显示其主域名。

##### `LoadingState()`

- 作用：渲染初始加载状态。

##### `ErrorState(props)`

- 作用：渲染全页错误状态。

##### `InlineErrorState(props)`

- 作用：渲染轻量级顶部错误提示。

##### `RefreshBadge(props)`

- 作用：当前实现为空组件占位，保留了刷新状态接口。

##### `useHashPage() -> [AppPage, (page: AppPage) => void]`

- 作用：把 hash 路由和 React 状态同步。

##### `pageFromHash(hash) -> AppPage`

- 作用：把 URL hash 映射成 `stats / timeline / settings`。

##### `pageMeta(page)`

- 作用：返回页面标题、副标题和说明文案。

#### 页面辅助函数

##### `sumSlices(slices) -> number`

- 作用：累加 donut 切片总值。

##### `defaultTimelineViewport(date, agentToday, timezone)`

- 作用：为某一天决定默认时间窗口。
- 规则：
  - 如果是今天，默认滚到当前时区当前时刻附近
  - 如果不是今天，从 00:00 开始

##### `formatHourLabel(hours) -> string`

- 作用：把小数小时格式化成 `HH:MM`。

##### `clampViewStart(startHour, zoomHours) -> number`

- 作用：确保时间窗口起点不会超出全天范围。

##### `normalizeZoomHours(hours) -> number`

- 作用：把小时值标准化到分钟粒度。

##### `clampZoomHours(hours) -> number`

- 作用：把缩放范围限制在最小/最大缩放值之间。

##### `monthFromDate(date) -> string`

- 作用：从 `YYYY-MM-DD` 截出 `YYYY-MM`。

##### `coerceDateIntoMonth(month, baseDate) -> string`

- 作用：把某个日期投影到另一个月份中，必要时夹紧到月末。

##### `daysInMonth(year, month) -> number`

- 作用：返回某月天数。

##### `buildWeekSeries(days, selectedDate) -> WeekBarDatum[]`

- 作用：围绕选中日期构造一周柱状图数据。

##### `formatPercent(value) -> string`

- 作用：小数转百分比文本。

##### `niceWeeklyAxisMax(seconds) -> number`

- 作用：为周柱状图挑一个“好看”的 y 轴上限。

##### `formatWeeklyAxisTick(seconds) -> string`

- 作用：格式化周柱状图刻度。

##### `formatZoomPreset(hours) -> string`

- 作用：把缩放预设值显示成“15 分钟 / 1 小时”这类文案。

##### `buildVisibleFocusItems(segments, viewStartSec, viewEndSec) -> ChartSegment[]`

- 作用：提取当前时间窗口内可见的 focus 事件。

##### `buildPrimaryBrowserDomainMap(focusSegments, browserSegments) -> Map<string, string>`

- 作用：对每个浏览器 focus 段找出重叠时间最长的主域名。

##### `currentHourInTimezone(timezone) -> number`

- 作用：根据 agent 时区计算“当前本地小时数”。

##### `parseUtcOffsetMinutes(value) -> number | null`

- 作用：把 `+08:00` 解析成分钟偏移。

##### `parseDateString(value) -> Date`

- 作用：把 `YYYY-MM-DD` 转成 UTC Date。

##### `addDays(date, offset) -> Date`

- 作用：日期加减天数。

##### `formatDateKey(date) -> string`

- 作用：Date 转 `YYYY-MM-DD`。

##### `formatWeekday(date) -> string`

- 作用：Date 转周几中文简写。

### 9.6 `apps/web-ui/src/main.tsx`

这个文件没有命名函数，只做一件事：

- 把 `<App />` 挂载到 `#root`

## 10. 你应该如何读这个仓库

如果你要快速建立全局理解，推荐阅读顺序：

1. `README.md`
2. `apps/timeline-agent/src/main.rs`
3. `apps/timeline-agent/src/trackers.rs`
4. `apps/timeline-agent/src/windows.rs`
5. `apps/timeline-agent/src/db.rs`
6. `apps/timeline-agent/src/http.rs`
7. `crates/common/src/lib.rs`
8. `apps/browser-extension/service-worker.js`
9. `apps/web-ui/src/api.ts`
10. `apps/web-ui/src/lib/chart-model.ts`
11. `apps/web-ui/src/App.tsx`

如果你要改数据口径，优先看：

- `trackers.rs`
- `db.rs`
- `common/src/lib.rs`

如果你要改页面展示，优先看：

- `api.ts`
- `chart-model.ts`
- `components/*`
- `App.tsx`

如果你要改浏览器域名采集，优先看：

- `browser-extension/service-worker.js`
- `http.rs::post_browser_event`
- `trackers.rs::sync_browser_event`

## 11. 修改代码时最容易踩的边界

1. `browser_segments` 不能脱离“前台浏览器”语义单独扩张，否则统计会失真。
2. 查询接口拿到的是“裁剪到当天边界后的段”，不要把它误当成数据库原始值。
3. `last_seen_at` 是恢复异常退出的重要依据，不要随意删。
4. Web UI 里的图表模型会再次做裁剪、聚合和颜色分配，前端显示不等于数据库原始存储。
5. `settings` 页依赖监视器心跳，所以 tracker 中的 `mark_*_online()` 不是可有可无的埋点。

## 12. 总结

这个仓库的代码组织是比较清晰的：

- `timeline-agent` 决定采集、状态机和数据真相。
- `browser-extension` 提供浏览器域名信号。
- `web-ui` 负责展示和交互。
- `common` 负责协议统一。

如果把它压缩成一句实现描述，可以理解为：

> 一个运行在 Windows 本机上的“时间段构建器”，持续把前台焦点、浏览器域名和设备状态折叠成 segment，然后再把 segment 解释给本地前端。
