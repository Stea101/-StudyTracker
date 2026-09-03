# 📚 极简学习打卡器 (Study Tracker)

完全本地运行的 Windows 桌面学习打卡工具：记录「今日完成」与「明日计划」，可回看历史，**过往日期只读、严禁修改**。

## 技术栈

- Electron 28 + Vue 3（`<script setup>` + Composition API）
- electron-vite（Vite 构建）
- Tailwind CSS（燕麦色 / 浅蓝 / 莫兰迪柔和配色）
- ECharts（按需引入，用于统计趋势图与日历热力图）
- 本地存储：Node.js 原生 `fs/promises`，数据落在 `~/Documents/StudyTracker/data.json`

## 目录结构

```
study-tracker/
├── package.json
├── electron.vite.config.mjs
├── electron-builder.yml
├── tailwind.config.js
├── postcss.config.js
├── .npmrc
├── src/
│   ├── main/
│   │   └── index.js          # 主进程：窗口 + fs 读写 + IPC
│   ├── preload/
│   │   └── index.js          # contextBridge 安全暴露 API
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.js
│           ├── App.vue                 # 界面与业务逻辑
│           ├── assets/main.css
│           ├── lib/echarts.js         # ECharts 按需注册
│           └── components/
│               ├── ToolsView.vue      # 工具菜单
│               ├── PomodoroView.vue   # 番茄钟
│               ├── HeatmapView.vue    # 日历热力图
│               ├── NewsView.vue       # 今日新闻
│               └── StatsView.vue      # 学习统计仪表盘
```

## 运行

```bash
# 1. 安装依赖（需 Node.js 18+）
npm install

# 2. 开发模式（热更新）
npm run dev
```

> `.npmrc` 已默认启用国内镜像下载 Electron 二进制；若你在境外网络，可注释掉 `.npmrc` 中两行镜像后重新 `npm install`。

## 打包为 Windows 可执行文件

```bash
# 仅构建（预览编译产物）
npm run build

# 构建 + 打包为单个安装程序（.exe）
npm run dist
```

打包完成后，安装程序位于 `dist/StudyTracker-Setup-1.0.0.exe`。安装时会自动创建桌面快捷方式，双击即可使用；所有数据自动持久化到系统文档目录。

> ⚠️ **Windows 打包常见问题**：若 `npm run dist` 报错 `Cannot create symbolic link`（无法创建符号链接），是因为 Windows 默认禁止普通用户创建符号链接。二选一即可解决：
> 1. **推荐**：开启「开发人员模式」——设置 → 隐私和安全性 → 开发者选项 → 打开「开发人员模式」，然后重新执行 `npm run dist`。
> 2. 以**管理员身份**打开 PowerShell / 终端，再执行 `npm run dist`。

## 数据存储

- 路径：`~/Documents/StudyTracker/data.json`（Windows 下即 `C:\Users\<你的用户名>\Documents\StudyTracker\data.json`）
- 格式：

```json
{
  "motto": "学如逆水行舟，不进则退。",
  "records": {
    "2026-08-19": {
      "completed": "今天完成了高等数学第三章的习题，并背诵了50个英语单词。",
      "plan": "明天准备开始学习线性代数，并复习昨天的单词。"
    }
  },
  "pomodoro": {
    "2026-08-19": { "sessions": 3, "seconds": 5100 }
  },
  "pomodoroSettings": { "focusMinutes": 25, "restMinutes": 5 },
  "newsApiKeyEnc": "<AES-256-GCM 密文，形如 iv.authTag.data 的 base64 串>"
}
```

## 业务规则（防修改）

1. 启动默认选中「今天」。
2. 仅「今天」的两个文本框可输入；切到昨天或任意过往日期后，文本框只读、保存按钮置灰不可点。
3. 「明天 →」按钮到「今天」为止，无法进入未来日期。
4. 保存时仅将「今天」的内容写入文件，覆盖当日原内容，历史日期不受影响。
5. 「今天」界面顶部会只读展示**前一天写下的「明日计划」**作为今日工作参考（即昨日的 `plan` 字段），不可编辑；若昨天未写计划则显示空提示。
6. **设置中心**：点击右上角「⚙️ 设置」弹出设置菜单（模块化设计，后续可方便新增选项），当前含「座右铭」「新闻 API 密钥」两个子页。
   - **座右铭**：点击进入后可输入 / 修改一段话并保存；保存后常驻显示在窗口顶部（只读）。座右铭存放在 `data.json` 顶层 `motto` 字段。
   - **新闻 API 密钥**：点击进入后仅显示密钥首尾各 4 个字符（中间以 `****` 遮掩）；点击「✏️ 修改」输入完整密钥，输入时完整显示，保存后以 AES-256-GCM 密文写入 `data.json` 的 `newsApiKeyEnc` 字段并自动覆盖（删除）旧密钥，后续新闻请求使用新密钥。
7. **查看新闻**：已合并到「🧰 工具」菜单栏，全屏展示；同样保留**保存过今日打卡后才可查看**的限制。拉取万维易源（ShowAPI）`/109-37` 热搜新闻，加载失败可「🔄 重试」，点击标题在系统默认浏览器打开原文。
8. **窗口缩放**：主窗口可自由拖拽调整大小（设置了最小宽高 `640×520`），界面随窗口宽度自适应为单列 / 双列布局。
9. **工具模块**：首页右上角「🧰 工具」进入全屏工具页，内含「🍅 番茄钟」「📅 日历热力图」「📰 查看新闻」三个工具。
   - **番茄钟**：可自定义专注 / 休息时长；点「开始」后计时不会自动暂停，时间到只提示（专注到→「该休息了」，休息到→「该学习了」），需手动暂停；专注暂停后自动开始休息，休息暂停后自动开始下一轮专注；休息阶段可「退出番茄钟」。每次专注结束累计到 `pomodoro[日期]`，首页显示「今日进行了 n 次专注学习，一共 m 分钟」。
   - **日历热力图**：类 GitHub 贡献图，按日期用颜色深浅展示打卡与番茄钟活跃度（近 365 天）。
10. **学习统计仪表盘**：首页「📜 历史记录」弹窗内新增「📊 统计」按钮，进入全屏统计页，展示**累计打卡天数、连续打卡天数、本周 / 本月完成率、番茄钟总时长趋势图**，数据由本地 `data.json` 的 `records` 与 `pomodoro` 聚合而来。

## 新闻接口

- 数据源：万维易源 ShowAPI，接口 `POST https://route.showapi.com/109-37?appKey=…`（热搜新闻）。
- 默认密钥作为兜底保存在 `src/main/index.js` 的 `DEFAULT_SHOWAPI_KEY` 常量中；用户在「设置 → 新闻 API 密钥」保存的自定义密钥以密文形式存储于 `data.json`，并优先使用。
- 请求在**主进程**完成（渲染进程不直接访问网络），设置了 10 秒超时与完整的错误兜底；密钥完整值只在主进程内使用，渲染进程仅拿到脱敏后的首尾字符。
