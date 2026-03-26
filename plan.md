# timeline 上手与贡献计划

## 目标

这份 `plan.md` 的目标不是泛泛地“熟悉项目”，而是帮你一步步做到下面三件事：

1. 能准确解释项目架构和关键数据流
2. 能在本地独立定位问题与改动落点
3. 能挑一类适合你的任务，较稳地提交第一批贡献

你可以把这份计划理解成一个从“能读懂”到“能开始改”的训练路线。

## 总体原则

### 原则 1：先建立心智模型，再动手改代码

这个项目的坑不在文件数量，而在“segment + 时间口径 + Windows 平台边界”。

### 原则 2：先懂后端主数据流，再看前端

前端看起来更直观，但数据真相在 agent。

### 原则 3：第一次贡献优先选低风险高反馈任务

第一次就改采集状态机或时间统计口径，成本很高，也容易误改。

## 阶段 0：准备环境

### 目标

确认仓库位置、技术边界和你当前能验证什么。

### 你现在已经有的条件

- 仓库已克隆到 `/home/chen/agentku/timeline`
- 我已经补了一份拆解文档：`docs/repo-deconstruction.md`

### 现实限制

当前环境是 Linux，而项目的核心 agent 是 Windows 定向的：

- 可以完整阅读代码
- 可以阅读前端和扩展
- 可以做文档类工作
- 不能在这里完整验证 Windows 前台窗口 / 托盘 / 注册表逻辑

### 这一阶段你要做到

1. 读完 `README.md`
2. 读完 `docs/repo-deconstruction.md`
3. 明确这不是云服务，而是“本地 agent + 本地 UI + 浏览器扩展”的架构

完成标志：

- 你能用 1 分钟讲清楚项目做什么
- 你能说出三类核心 segment

## 阶段 1：先建立全局地图

### 目标

知道每个目录负责什么，不急着钻实现细节。

### 建议阅读顺序

1. `README.md`
2. `docs/architecture.md`
3. `docs/api.md`
4. `docs/schema.md`
5. `Cargo.toml`
6. `apps/web-ui/package.json`
7. `.github/workflows/package-windows.yml`

### 你应该回答的问题

1. 这个仓库一共有几个可运行部件？
2. Rust workspace 为什么只包含 `timeline-agent` 和 `common`？
3. 前端为什么不在 Rust workspace 里？
4. 打包产物里会包含什么？

### 输出物

自己写一个极短总结，类似：

```text
agent 负责采集与 API，web-ui 负责展示，extension 负责浏览器域名上报，SQLite 是本地存储。
```

完成标志：

- 你能不看文档说出 `apps/` 下三个应用的职责

## 阶段 2：读懂后端主链路

### 目标

把“一个 observation 如何变成 segment 并写入数据库”彻底搞明白。

### 阅读顺序

1. `apps/timeline-agent/src/main.rs`
2. `apps/timeline-agent/src/state.rs`
3. `apps/timeline-agent/src/trackers.rs`
4. `apps/timeline-agent/src/windows.rs`
5. `apps/timeline-agent/src/db.rs`
6. `apps/timeline-agent/src/http.rs`
7. `apps/timeline-agent/src/system.rs`

### 你要重点画出的三条链路

#### 链路 A：focus

`Windows 前台窗口 -> capture_foreground_window -> sync_focus_snapshot -> start/touch/end focus_segment -> SQLite`

#### 链路 B：presence

`Windows 输入状态 -> detect_presence -> sync_presence_state -> start/touch/end presence_segment -> SQLite`

#### 链路 C：browser

`extension POST /api/events/browser -> sync_browser_event -> browser_segment -> SQLite`

### 这一阶段要搞懂的关键概念

1. 什么叫 open segment
2. `last_seen_at` 为什么存在
3. 为什么 browser segment 要依赖 foreground browser
4. 为什么 `restore_unclosed_segments()` 很重要
5. 为什么 `raw_events` 不是主模型

### 建议你做的练习

拿纸或白板写出：

```text
current_focus
current_presence
current_browser
```

然后分别写出它们在“无变化 / 有变化 / 被拒绝 / 异常退出”时的状态变化。

完成标志：

- 你能说清楚 `start / touch / end` 分别在什么时候发生
- 你能解释为什么关闭电脑后不应该把 active 时间桥接到下次开机

## 阶段 3：读懂数据库与统计口径

### 目标

理解“产品显示出来的数字到底怎么算的”。

### 重点阅读

1. `apps/timeline-agent/src/db.rs`
2. `docs/schema.md`
3. `docs/api.md`

### 重点关注的方法

- `read_day_timeline`
- `read_app_stats`
- `read_domain_stats`
- `read_focus_stats`
- `read_day_summary`
- `read_month_calendar`
- `read_period_summary`

### 你要回答的问题

1. 某个跨天 segment 是如何被裁剪到当天边界内的？
2. `active_seconds` 和 `focus_seconds` 有什么区别？
3. `switch_count` 是怎么定义的？
4. 月历数据是直接查库聚合还是按日循环累加？
5. 若将来要增加“按类别统计”，最可能改哪里？

### 练习建议

假设某天有：

- 9:00-10:00 VS Code
- 10:00-10:30 Edge
- 10:30-11:00 idle

自己手算一遍：

- `focus_seconds`
- `active_seconds`
- `switch_count`
- `app_stats`

完成标志：

- 你能解释“统计值来自哪里”，而不是只会看 UI

## 阶段 4：读懂前端如何消费这些数据

### 目标

知道前端哪些地方是在“展示”，哪些地方在“二次建模”。

### 阅读顺序

1. `apps/web-ui/src/api.ts`
2. `apps/web-ui/src/lib/chart-model.ts`
3. `apps/web-ui/src/App.tsx`
4. `apps/web-ui/src/components/timeline-chart.tsx`
5. `apps/web-ui/src/components/donut-chart.tsx`
6. `apps/web-ui/src/components/calendar-grid.tsx`

### 你要重点理解的点

1. bootstrap 时为什么会并发请求 timeline/settings/summary
2. `selectedDate` 改变时为什么要同时刷新 timeline 和 period summary
3. `chart-model.ts` 为什么是前端真正的业务建模层
4. 为什么 timeline chart 本身更像渲染器，而不是业务逻辑中心
5. 为什么图表时间使用 agent 返回的 `date + timezone`

### 容易误判的地方

- 看到前端计算了很多数据，就误以为后端不重要
- 看到图表交互复杂，就误以为核心业务都在组件里

实际上：

- 业务真相主要在 agent
- 前端负责把“已经定义好的时间线”做更适合阅读的展示

完成标志：

- 你能指出一个新图表需求应该改 `api.ts`、`chart-model.ts` 还是组件层

## 阶段 5：读懂浏览器扩展

### 目标

知道浏览器域名数据为何可靠，以及它的边界在哪里。

### 阅读顺序

1. `apps/browser-extension/manifest.json`
2. `apps/browser-extension/service-worker.js`
3. `apps/browser-extension/content-script.js`
4. `apps/browser-extension/README.md`

### 你要回答的问题

1. 扩展在什么事件上会上报？
2. 为什么要 heartbeat？
3. 为什么要记住 agent base URL？
4. 为什么 content script 只在 loopback 页面注入？
5. 为什么扩展不是数据真相源？

### 练习建议

自己画出一张小图：

```text
loopback dashboard page -> content script -> service worker -> rememberDiscoveredAgentOrigin -> /health -> rememberAgentBaseUrl
```

完成标志：

- 你能解释“用户改了 agent 端口后扩展怎么恢复连接”

## 阶段 6：在 Windows 上做一次真实联调

### 目标

把源码中的理解和真实运行结果对齐。

### 建议环境

一台 Windows 开发机，安装：

- Rust toolchain
- Node.js / npm
- Edge 或 Chrome

### 推荐步骤

1. 启动 agent

```powershell
cargo run -p timeline-agent
```

2. 启动前端

```powershell
cd apps/web-ui
npm install
npm run dev
```

3. 加载扩展

- 打开 `edge://extensions` 或 `chrome://extensions`
- 开启开发者模式
- 加载 `apps/browser-extension`

4. 打开本地前端

- 观察 `stats` / `timeline` / `settings`

5. 做 3 组动作

- 切换不同应用窗口
- 在浏览器切换不同域名标签页
- 让电脑 idle，再锁屏

6. 对照查看

- UI 是否变化
- `/api/debug/recent-events` 是否有数据
- SQLite 是否有对应 segment

### 这一阶段最重要

不是“跑起来了”，而是把下面三件事对上：

1. 你看到的 UI
2. 你查到的 API
3. 你理解的状态机

完成标志：

- 你能独立判断一个异常到底更像：
  - 采集问题
  - segment 合并问题
  - API 问题
  - 前端展示问题

## 阶段 7：选择你的第一类贡献

### 推荐优先级

#### 优先级 A：文档 / 诊断 / 设置增强

适合第一批 PR。

候选任务：

- 增强设置页诊断信息
- 增加开发排障说明
- 补浏览器扩展工作原理文档
- 给 API / schema 加更细的字段说明

#### 优先级 B：前端展示增强

候选任务：

- 增加统计卡片
- 改善时间线过滤体验
- 强化空状态 / 错误提示

#### 优先级 C：后端统计增强

候选任务：

- 新增 summary 指标
- 新增按周 / 按月某类统计
- 优化现有统计查询结构

#### 暂缓：核心采集状态机重构

除非你已经在 Windows 上完整跑过并验证过一轮，否则不建议一开始就改：

- `windows.rs`
- `trackers.rs`
- 时间边界裁剪逻辑

## 第一批贡献的推荐路线

如果你想最快进入“可提交 PR”状态，我建议走下面这条线。

### 路线 1：诊断与调试增强

#### 第一步

给设置页补充更完整的运行时信息，例如：

- 数据库路径
- 配置文件路径
- 版本号
- 前端是否为 self-hosted 模式

#### 第二步

给浏览器桥接状态加更具体的说明，例如：

- 最近一次 browser event 时间
- 当前状态是 `waiting / online / stale`
- 可能原因提示

#### 第三步

补一页调试文档，教人怎么：

- 看 `/health`
- 看 `/api/debug/recent-events`
- 判断扩展是否接通

为什么推荐这条线：

- 前后端都能碰到
- 风险相对低
- 很容易看出成果

## 更长期的进阶路线

### 路线 A：成为后端主数据流贡献者

你需要重点深挖：

- `trackers.rs`
- `db.rs`
- `windows.rs`

你需要能独立回答：

- 任何一条 segment 为什么在那个时间开始和结束
- 为什么统计结果是那个数
- 怎样改口径不会把现有 UI 全弄乱

### 路线 B：成为前端体验贡献者

你需要重点深挖：

- `App.tsx`
- `chart-model.ts`
- `timeline-chart.tsx`
- `donut-chart.tsx`

你需要能独立回答：

- 这个需求是改模型还是改交互
- 哪些状态应该下沉到 hook / page component
- 怎样做增强而不破坏现在的信息密度

### 路线 C：成为浏览器桥接 / 产品可用性贡献者

你需要重点深挖：

- `service-worker.js`
- `http.rs` 的 origin 校验
- settings monitor 状态

你需要能独立回答：

- 扩展为什么偶发丢事件
- 自定义端口时如何自恢复
- 哪些错误该在前端暴露，哪些应在扩展日志处理

## 每完成一个阶段时，给自己做这 6 个检查

1. 我能说清这个阶段的输入和输出吗？
2. 我知道状态存在哪里吗？
3. 我知道这个模块的边界吗？
4. 我知道它依赖哪些上下游吗？
5. 我知道改这个模块最容易误伤什么吗？
6. 我知道如果出 bug 该去哪一层排查吗？

如果 6 个问题里有 2 个以上答不上来，就不要急着进入下一阶段。

## 你真正“上手了”的判定标准

当你满足下面这些条件时，基本就算真正上手了：

1. 你能画出系统的三条主数据流
2. 你能解释三类 segment 的生命周期
3. 你能指出某个统计值是在后端还是前端计算的
4. 你能判断某个问题更像出在 agent、extension 还是 web-ui
5. 你能提出一个小而清晰、风险可控的 PR 方案

## 最后给你的建议

不要把目标设成“把所有代码全部背下来”，而是设成：

> 我已经知道系统为什么这样拆，知道关键数据怎么流，知道第一批改动应该从哪里下刀。

做到这一点，你就已经比“只是把仓库扫了一遍”更接近真正的贡献者了。
