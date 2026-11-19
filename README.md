# 国护积分管理 (Guard of Honor · AutoScore)

<div align="center">

![Electron](https://img.shields.io/badge/Electron-33.2.0-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5.4.11-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4.17-38B2AC?logo=tailwind-css&logoColor=white)
![ExcelJS](https://img.shields.io/badge/ExcelJS-4.4.0-217346?logo=microsoft-excel&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-informational)
![Release](https://img.shields.io/github/v/release/wongpatriarch-sketch/ghd-autoscore?color=emerald)

**专为高校与各级国旗护卫队打造的单机版队员积分自动化管理与统计桌面工具。**

[下载最新安装包 (Releases)](https://github.com/wongpatriarch-sketch/ghd-autoscore/releases) · [报告问题 / 建议](https://github.com/wongpatriarch-sketch/ghd-autoscore/issues)

</div>

---

## 📖 项目简介

在国旗护卫队的日常运作中，队员的积分考核涵盖了**日常夜训周训、日常/节假日升降旗、部门专职工作（后勤部/综办部）**以及各类**大型出旗活动（国庆、校运会、校庆等）**。

传统的积分管理直接依赖人工在 Excel 中公式录入与多表跨文件拼凑，容易出现**公式错位、人名漏写或重名混淆、操作无法无损回滚、文件冲突损坏**等痛点。

**国护积分管理（AutoScore）** 将底层的 `.xlsx` 表格抽象为安全存储介质，在上层提供了结构化、可视化、防呆保护的现代化业务流桌面应用，**无需在运行电脑上安装 Microsoft Office 或 WPS 即可独立运行与结算**。

---

## 🎯 核心功能与模块

### 1. 🗂 项目工程中枢 (ProjectHub)
* **工程化管理**：以 `.json` 配置文件管理每个学期或集训周期的积分，绑定对应的主 Excel 表。
* **双建项模式**：支持直接关联已有总积分表，或一键按标准表头规范初始化生成新表格。
* **最近项目面板**：记录历史打开路径并自动检测底层表格有效性，快速一键进入。
* **文件独占锁机制**：自动检测 Excel 是否被第三方软件（Office/WPS）占用，并在同级生成 `.~filename.lock` 互斥锁，杜绝多进程并发写入冲突。

### 2. 📊 仪表盘与双模式排名 (Dashboard)
* **统计卡片**：在册队员总数、平均总分、负分预警数量、累计活动列数。
* **届别分组排名**：自动识别 `--31届--` 类似标记行，展示届内排名与全局名次。
* **全局总分排名**：跨届别按总分降序排列，直观掌握全队积分位次。
* **安全特性**：所有排名均在**只读内存视图**中运算与展示，绝不打乱原 Excel 表物理行的届别排版顺序。
* **负分与重名预警**：负分行醒目高亮标注，同名队员提示人工核验。

### 3. 🎖 大型活动积分结算引擎 (EventScoring)
* **复合规则计算器**：
  * **主教官加分**：支持输入 1~5 位，每人固定 +2.0 分。
  * **训练环节**：可动态增删多次训练卡片，教官与参训队员按时长（0.5h~4.0h）记分（1小时 = 1.0分）。
  * **彩排环节**：可动态增删多次彩排卡片，按时长自动计算分值。
  * **正式出旗环节**：参加队员按活动时长记分；场务人员固定每人 +0.5 分。
* **智能名单切词解析**：支持中英文逗号、顿号、空格、全角空格及换行混排输入，自动清洗去重。
* **名册库校验与映射**：输入的姓名若未在主表中登记，弹出修正窗口，支持映射到名册现有队员或选择跳过。
* **写入前全员预览**：全员分值明细表确认无误后，原子写回在 Excel 最右侧追加活动新列，并自动累加同步到汇总列。

### 4. 📥 批量数据导入引擎 (BatchImport)
* **日常训练考勤（count 模式）**：导入「姓名 / 总次数」打卡表，按全局单次分值（默认 1.0 分/次）累加至 B 列与 F 列。
* **升降旗考勤（count 模式）**：导入「姓名 / 总次数」打卡表，支持选择日常升降旗（0.5分/次）或节假日升降旗（1.0分/次），累加至 C 列与 F 列。
* **部门积分导入（sandwich 三明治模式）**：自适应抓取首列“姓名”与尾列“总积分”（中间各考核细节列自适应忽略），累加至后勤部（D列）或综办部（E列）。
* **业务单次互斥锁**：后勤部与综办部在每个项目周期内仅限导入一次，导入后入口锁定，防止数据被重复叠加。

### 5. 🕘 历史流水、版本栈与撤销中心 (History)
* **线性版本栈 (Version Stack)**：同一操作对象（如某个大型活动）的所有操作构成版本栈，仅栈顶最新操作处于「活跃」状态，历史版本自动锁定。
* **一键无损撤销 (Undo)**：
  * 撤销活动创建：扣减汇总分并在 Excel 中**物理删除该活动列**（右侧列自动左移对齐）。
  * 撤销活动修改：对 Excel 进行反向差值扣减，平滑回滚至上一状态。
  * 撤销部门积分：扣减对应分值并**自动释放部门互斥锁**，重新开放导入。
* **差值修改机制 (Delta Update)**：支持对已结算活动进行成员分数微调，系统仅以“差值 = 新分 - 旧分”追加一条修改事务，保留完整审计痕迹。

### 6. 🛡 严苛的数据安全防护
* **原子写入 (Atomic Write)**：修改 Excel 时先生成临时文件，落盘校验成功后再行原子替换，防止断电导致表格损坏。
* **静默滚动备份 (Rolling Backups)**：任何写入或撤销执行前，自动在同级 `.backups/` 目录下生成带时间戳的完整 Excel 备份，自动维护最近 20 份。

---

## 📋 数据表规范与结构约定

软件对绑定的主积分 Excel 表采用标准化列定义：

| 列号 | 列名 | 说明 | 数据来源 |
| :---: | :---: | :--- | :--- |
| **A 列** | **姓名** | 队员姓名，支持 `--31届--` 行作为届别分隔标识 | 基础花名册 |
| **B 列** | **夜训周训** | 日常例行训练累计积分 | 批量考勤导入引擎 |
| **C 列** | **升降旗** | 升降旗勤务累计积分 | 批量考勤导入引擎 |
| **D 列** | **后勤部** | 后勤专项工作积分（单次互斥） | 部门积分导入引擎 |
| **E 列** | **综办部** | 综办专项工作积分（单次互斥） | 部门积分导入引擎 |
| **F 列** | **汇总** | 队员全周期累计总积分（全自动同步维护） | 系统核心自动维护 |
| **G 列+** | **[活动名称]** | 历次大型活动动态列（如“国庆出旗”、“运动会”） | 活动积分结算引擎追加 |

> **提示**：可通过软件内的【新建项目 → 按模板初始化新建】一键生成完全符合上述规范的空模板表格。

---

## 🤖 AI Agent 开发者与架构规范指南

> **本节专供 AI Agent 与维护开发者阅读**：在对本软件进行自动化理解、单测编写、Bug 修复或功能扩展时，请严格遵守以下架构设计与数据契约。

### 1. 核心架构与进程间通信 (IPC Contract)

```
┌────────────────────────────────────────────────────────┐
│                      Renderer 渲染进程                   │
│  React 18 + TailwindCSS + Vite (深色暗黑风格 UI 界面)     │
│  Pages: ProjectHub / Dashboard / EventScoring / ...    │
└───────────────────────────┬────────────────────────────┘
                            │ (通过 window.ghd.invoke 安全调用)
┌───────────────────────────▼────────────────────────────┐
│                      Preload 桥接层                     │
│  electron/preload.js (ALLOWED 通道白名单硬校验)         │
├────────────────────────────────────────────────────────┤
│                      Main 主进程 (Electron)             │
│  electron/ipc.js (信道分发与参数校验)                    │
├────────────────────────────────────────────────────────┤
│                      Services 服务层                    │
│  ├── excelService.js    (基于 ExcelJS 的原子读写/计算/删列) │
│  ├── projectService.js  (工程配置序列化、签名与历史事务)    │
│  ├── lockService.js     (跨进程防冲突文件排他锁)          │
│  └── backupService.js   (落盘前时间戳滚动备份，上限20份)    │
└────────────────────────────────────────────────────────┘
```

#### IPC 信道调用规范（所有接口均返回统一结构 `{ ok: boolean, data?: any, error?: string, code?: string }`）:
* `project:create(args)`: 新建项目，校验名称、配置路径与目标 Excel，初始化并加锁。
* `project:open(configPath)`: 读取配置文件，校验 Excel 特征签名（`excelSignature`）并加锁。
* `project:save(configPath, cfg)`: 原子覆盖保存项目 `.json` 文件。
* `project:close(excelPath)`: 释放当前 Excel 文件锁。
* `excel:read(excelPath)`: 解析主表花名册、届别、固定列与动态活动列数据。
* `excel:createTemplate(targetPath)`: 一键生成标准格式 Excel（含冻结窗格、表头样式与固定列）。
* `excel:commitEvent(excelPath, { activityName, scores })`: 追加活动列，并增量累加到 F 列汇总。
* `excel:applyIncrement(excelPath, { targetCol, deltas })`: 对指定固定列（B/C/D/E）和 F 列同时累加。
* `excel:applyEventEdit(excelPath, { activityName, deltas })`: 差值写入活动列与 F 列。
* `excel:deleteActivityColumn(excelPath, { activityName, deltas })`: 扣除 F 列分值并物理执行 `ws.spliceColumns` 删列。
* `excel:readExternal(filePath, mode)`: 解析外部打卡/报表文件（`count` 模式或 `sandwich` 模式）。

### 2. 关键数据结构规范

#### (1) 项目配置文件 `.json` 结构
```json
{
  "version": 1,
  "projectName": "2026秋季集训",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "configPath": "绝对路径/xxx.json",
  "excelPath": "绝对路径/xxx.xlsx",
  "excelSignature": "<md5(abs_path)>:<file_size>",
  "settings": {
    "dailyTrainingScore": 1.0
  },
  "locks": {
    "is_logistics_imported": false,
    "is_comprehensive_imported": false
  },
  "history": [
    {
      "batchId": "B20261119150000-XXXXXX",
      "timestamp": "ISO-8601",
      "type": "event_create | event_edit | daily | flag | department",
      "objectKey": "event::国庆出旗 | flag::批次号 | department::logistics",
      "label": "国庆出旗",
      "details": { "张三": 3.0, "李四": 2.5 },
      "meta": { "source": "活动积分结算引擎", ... },
      "status": "active | locked | undone"
    }
  ]
}
```

#### (2) 内存花名册对象 (`members`)
由 `excelService.readWorkbook` 读取返回：
```javascript
{
  row: 3,                 // Excel 中所在的物理行号
  name: "张三",            // 队员姓名（已去除首尾空白）
  generation: 31,         // 所属届别（整数或 null）
  b: 2.0, c: 1.0, d: null, e: null, f: 3.0, // 固定列数值（空为 null）
  extras: { "国庆出旗": 3.0 } // 动态活动列映射
}
```

### 3. 核心算法与业务逻辑

1. **届别识别算法**：
   * 在 A 列逐行读取，匹配正则 `COHORT_RE`。
   * 一旦匹配成功，提取届数数字，后续队员自动归属于该届，直到遇到下一个届别标识行。
2. **线性版本栈 (History Stack)**：
   * 算法实现：`src/lib/historyStack.js` 中的 `computeStatusMap`。
   * 按照 `objectKey` 分组，同组内仅**最新且未撤销**记录为 `active`，历史记录均为 `locked`。
   * 栈顶被撤销（`undone`）后，其前一个版本自动浮上栈顶并解锁为 `active`。
3. **活动差值计算 (Delta Update)**：
   * 当前活动每人最新分值由 `currentScoresOf` 累加组内所有非 undone 记录的 details 算出。
   * 修改时计算 `delta = newScore - oldScore`，仅向 Excel 对应列与 F 列写入 `delta`，保留历史纯净。

### 4. 已知边缘缺陷清单与改进建议（供 Agent 快速修复）

在对现有代码进行边界与容错测试时，已定位以下待完善点：
* **[BUG-01] 届别标识正则过严**：[excelService.js](file:///e:/大三/国护队/26秋/AutoScore2/electron/services/excelService.js#L8) 当前为 `/^--\s*(\d+)\s*届--$/`，缺少对中文破折号（`——31届——`）和尾部空格的匹配，易将届别行误识别为人名。建议升级为 `/^[-—–]{2,}\s*(\d+)\s*届\s*[-—–]{2,}$/`。
* **[BUG-02] Windows 盘符大小写引发签名误判**：[projectService.js](file:///e:/大三/国护队/26秋/AutoScore2/electron/services/projectService.js#L6) 中 `signatureOf` 对路径直接计算 MD5，在 Windows 上若盘符大小写不一致（`C:\` vs `c:\`）会导致 `openProject` 抛出 `SIGNATURE_MISMATCH`。建议在计算哈希前对盘符大写规范化。
* **[BUG-03] 活动名称防冲突不足**：[excelService.js](file:///e:/大三/国护队/26秋/AutoScore2/electron/services/excelService.js#L200) 只校验了是否与已有活动列重名，未阻止用户输入与固定列（“汇总”、“升降旗”等）同名的活动名称。
* **[BUG-04] BatchImport 映射合并后下拉框消失**：[BatchImport.jsx](file:///e:/大三/国护队/26秋/AutoScore2/src/pages/BatchImport.jsx#L256) 中映射不在册人员到已有队员后，由于两者 key 相同直接被合并，导致界面上的映射选择框直接消失，用户无法二次修改。
* **[BUG-05] 外部导入仅读 Sheet 1**：[excelService.js](file:///e:/大三/国护队/26秋/AutoScore2/electron/services/excelService.js#L333) 写死读取 `wb.worksheets[0]`，若首个 Sheet 为封面/空表则误报找不到表头。建议遍历扫描包含目标表头的工作表。
* **[BUG-06] 人名排版内部空格切词**：[utils.js](file:///e:/大三/国护队/26秋/AutoScore2/src/lib/utils.js#L4) 中 `parseNames` 直接对 `\s` 切分，若两字姓名中间带空格对齐（如 `张 三`）会被切分为两个单字人名。

---

## 🚀 快速上手

### 下载安装
直接前往 GitHub Releases 页面下载最新安装包即可使用：
👉 **[下载最新 Windows 安装包 (Setup 1.0.0.exe)](https://github.com/wongpatriarch-sketch/ghd-autoscore/releases)**

### 推荐工作流
1. **新建/打开项目**：启动应用后，点击“新建项目”选择本地 Excel 或生成新模板，并保存工程配置文件。
2. **日常考勤录入**：在【批量数据导入】中导入日常训练或升降旗打卡表。
3. **活动结算**：遇到出旗任务时，在【活动积分结算】中录入教官、参训时长及名单，生成预览后一键落盘。
4. **查阅排名**：在【仪表盘】中切换查看“届别分组排名”或“全局总分排名”，排查负分队员。
5. **纠错与回滚**：如发生误操作或人名输错，在【历史流水与撤销】中一键撤销该批次或执行差值修改。

---

## 💻 本地开发与测试

### 1. 环境准备
* Node.js (推荐 `v18+` 或 `v20+`)
* npm 或 pnpm / yarn

### 2. 克隆项目并安装依赖
```bash
git clone https://github.com/wongpatriarch-sketch/ghd-autoscore.git
cd ghd-autoscore
npm install
```

### 3. 启动本地开发环境
```bash
npm run dev
```
该命令将同时启动 Vite 前端热更新服务与 Electron 桌面端外壳。

### 4. 运行自动化测试套件
项目包含三套完备的自动化回归测试（服务集成测试、项目生命周期测试、渲染冒烟测试）：
```bash
npm test
```
* `npm run test:services`: 校验模板生成、活动追加、列删除、增量累加及滚动备份。
* `npm run test:project`: 校验项目工程创建、打开校验、独占锁申请释放。
* `npm run test:render`: 服务端无头渲染测试各个 React 页面的 UI 挂载。

### 5. 打包生成桌面端安装包
```bash
npm run dist
```
打包产物将输出在 `dist/` 目录下（Windows 对应 `国护积分管理 Setup x.x.x.exe`）。

---

## 📁 目录结构

```text
ghd-autoscore/
├── electron/                 # Electron 主进程与服务层
│   ├── main.js               # 主进程入口、窗口创建与生命周期管理
│   ├── preload.js            # 上下文桥接脚本 (contextBridge 与白名单)
│   ├── ipc.js                # IPC 事件路由与业务信道控制
│   └── services/             # 核心服务层
│       ├── excelService.js   # ExcelJS 核心业务逻辑实现
│       ├── projectService.js # 工程配置与历史版本栈管理
│       ├── lockService.js    # 文件并发锁定与解除
│       └── backupService.js  # 滚动备份服务
├── src/                      # React 前端渲染进程源码
│   ├── assets/               # 静态资源 (图标与 SVG)
│   ├── components/           # 通用 UI 组件 (Modal/Badge/Workspace 等)
│   ├── lib/                  # 前端核心工具库 (api桥接/名单分词/版本栈算法)
│   ├── pages/                # 业务页面
│   │   ├── ProjectHub.jsx    # 项目中心首页
│   │   ├── Dashboard.jsx     # 仪表盘与双模式排名榜
│   │   ├── EventScoring.jsx  # 活动积分结算引擎
│   │   ├── BatchImport.jsx   # 批量考勤与部门导入引擎
│   │   └── History.jsx       # 历史流水、差值修改与撤销中心
│   ├── App.jsx               # 前端根组件
│   └── index.css             # TailwindCSS 深色质感样式表
├── tests/                    # 单元测试与集成测试用例
│   ├── services.test.cjs     # 核心服务层集成测试
│   ├── project.test.cjs      # 项目生命周期测试
│   └── render.test.cjs       # 页面渲染冒烟测试
├── package.json              # 依赖与脚本配置
└── tailwind.config.js        # 样式系统主题扩展配置
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 开源协议。
欢迎为国旗护卫队积分管理提供更多改进建议与代码贡献！
