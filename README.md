# 国护积分管理（Guard of Honor · AutoScore）

<div align="center">

![Electron](https://img.shields.io/badge/Electron-33.4.11-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5.4.21-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4.19-38B2AC?logo=tailwind-css&logoColor=white)
![ExcelJS](https://img.shields.io/badge/ExcelJS-4.4.0-217346?logo=microsoft-excel&logoColor=white)
![Release](https://img.shields.io/github/v/release/wongpatriarch-sketch/ghd-autoscore?color=emerald)

**国旗护卫队单机版积分管理与统计工具（Windows 桌面软件）**

[下载最新安装包（Releases）](https://github.com/wongpatriarch-sketch/ghd-autoscore/releases) ·
[报告问题 / 建议（Issues）](https://github.com/wongpatriarch-sketch/ghd-autoscore/issues)

</div>

---

## 项目简介

国旗护卫队的积分由日常夜训周训、升降旗、部门专职工作（后勤部 / 综办部）和各类大型出旗活动（国庆、校运会、校庆等）几部分组成。直接在 Excel 里手工录入，容易出现公式错位、人名漏写、重名混淆、改错了无法回滚等问题。

本软件把 `.xlsx` 积分表作为唯一的数据存储，在它之上提供结构化的录入、预览确认、写入、撤销流程：

- 电脑上**不需要安装 Microsoft Office 或 WPS**，软件自己读写表格；
- 每次写入前**自动备份**，写入后自动重算汇总分，写错了可以在软件里**一键撤销**；
- 所有数据都保存在本机，不联网、不上传。

---

## 下载与安装

1. 到 [Releases](https://github.com/wongpatriarch-sketch/ghd-autoscore/releases) 页面下载最新版本的安装包。发布页上显示的名字是「国护积分管理 安装包 x.x.x（Windows）」，保存到电脑上的文件名是 `ghd-autoscore-Setup-x.x.x.exe`（GitHub 不保留中文文件名）。
2. 双击安装包，按提示完成安装（一键安装，不需要选择安装目录）。
3. 安装包没有数字签名，第一次运行时 Windows 可能提示「Windows 已保护你的电脑」。点「更多信息」，再点「仍要运行」即可。
4. 从旧版本升级时，建议先卸载旧版本再安装。v1.0.0 和 v1.0.1 的安装包存在启动报错的问题，v1.0.2 的任务栏图标显示不全（只显示上半部分），请不要使用，直接安装最新版本。

---

## 推荐工作流

1. **新建或打开项目**：启动软件后点「新建项目」，关联已有的总积分表（或者按模板生成一张新的空表），再选择项目配置文件（`.json`）的保存位置。下次直接在「最近项目」里点开。
2. **日常考勤录入**：在【批量数据导入】里导入日常训练、升降旗的考勤表，或者部门统计表。
3. **活动结算**：有出旗任务时，在【活动积分结算】里填写教官、各环节时长和名单，生成预览，核对后写入。
4. **查阅排名**：在【仪表盘与排名】里切换「按届数分组排名」和「按总积分全局排名」。
5. **纠错与回滚**：录入有误时，到【历史流水与撤销】里撤销对应的那一笔，或者对活动做差值修改。

---

## 功能模块

### 1. 项目中心（首页）

- 每个学期或集训周期是一个**项目**：一个 `.json` 配置文件绑定一张 `.xlsx` 积分表。配置里保存历史流水、部门锁和单次训练分值。
- **新建项目**有两种方式：关联已有的总积分表；或者按模板生成一张空白表（表头、列宽、冻结窗格、届别行都与正式积分表一致）。
- **最近项目**最多记 12 条，每次打开时重新检查配置文件和表格是否还在，失效的条目会标出来。
- 同一台电脑上软件只允许开一个窗口；一个项目打开期间，表格旁边会生成锁文件 `.~文件名.lock`，防止两个项目同时操作同一张表。

### 2. 仪表盘与排名

- 统计卡片：在册有效队员、平均汇总分、负分预警、活动列数。
- 两种排名方式：按届数分组排名、按总积分全局排名。活动列可以「活动分列」逐列显示，也可以「活动合并」成一个总分。
- 排名只在内存里计算，不会改动表格里队员行的物理顺序。
- 负分队员高亮显示；主表里有同名队员、或者有重名的活动列时，界面顶部会给出提示。
- 主表里夹着的「合计」「小计」「备注」这类不是队员的行，程序会自动跳过（不计分、不显示、不改动），并在顶部提示跳过了哪几行。

### 3. 活动积分结算

填写一次大型活动的名单，程序算出每人的得分，确认后在主表最右侧追加一列。

| 环节 | 计分方式 | 说明 |
| :--- | :--- | :--- |
| 主教官 | 每人 +2.0 | 必填，1~5 位 |
| 训练 | 时长 × 1.0 分 / 小时 | 可以加多张卡片；教官必填，参训可以留空（例如对外带训）；教官和参训队员分值相同 |
| 彩排 | 时长 × 1.0 分 / 小时 | 至少保留 1 张卡片；教官必填，参训可以留空；没有彩排的话，仅有的那张卡片整张留空即可（加了两张以上时，空着的那张要点 － 删掉） |
| 正式出旗（参加） | 时长 × 1.0 分 / 小时 | 名单不能为空 |
| 正式出旗（场务） | 每人 +0.5 | 与时长无关 |

- 时长可选 0.5~4.0 小时。
- 名单可以用中文逗号、英文逗号、顿号、分号、空格、换行分隔，自动去重。
- 名单里出现主表中没有的姓名时，会弹出修正窗口，可以「忽略该人员」或「修正为名册里的某位队员」。
- 写入前显示全员预览表；写入前自动备份，写入后重算全表汇总。
- 「生成预览」只会被表单里第一处不合格的地方拦下（例如「第 2 次彩排的教官和参训都是空的」），改好后再点一次，会接着检查下一处。

### 4. 批量数据导入

| 导入类型 | 导入表需要的表头 | 结算方式 | 写入位置 |
| :--- | :--- | :--- | :--- |
| 日常训练考勤 | 姓名、总次数 | 次数 × 单次分值（默认 1.0，可在导入时修改，随项目保存） | B 列（夜训周训） |
| 升降旗考勤 | 姓名、总次数 | 次数 × 0.5（日常）或 × 1.0（节假日） | C 列（升降旗） |
| 部门积分 | 姓名、总积分 | 直接累加总积分 | D 列（后勤部）或 E 列（综办部） |

- 都是**增量累加**：空单元格按 0 计算，原有的分数保留。
- 每个部门在一个项目里只能导入一次，导入后入口锁定；撤销该笔导入后重新开放。
- 导入流程：读取文件 → 内存结算 → 预览确认 → 写入。预览里会列出不在名册中的姓名，可以忽略或映射到名册里的队员，选错了可以再改。

### 5. 历史流水与撤销

- 每一笔写入都会在项目配置的 `history` 里留下一条记录，包含批次号、时间、类型、每个人的分值和来源文件。
- 同一个操作对象（例如某个活动）的所有记录构成一个版本栈：只有最新且未撤销的那一笔是「活跃」的，可以修改或撤销；它下面的记录是「锁定」的。栈顶被撤销后，上一笔自动变成新的栈顶。
- **撤销**：
  - 撤销「新建活动」：删除该活动整列，并恢复这一列新建前的列宽和格式；
  - 撤销「修改活动」：按相反的差值写回；
  - 撤销考勤或部门导入：在原来写入的那一列反向扣除，部门锁同时解开。
- **差值修改**：对活跃的活动记录可以直接改每人的分数，程序只写入「新分数 − 旧分数」的差值，并记为一条新的修改记录。

---

## 主表格式约定

软件只读取工作簿的**第一个工作表**，列的含义固定如下：

| 列 | 表头 | 内容 | 由谁维护 |
| :---: | :--- | :--- | :--- |
| A | 姓名 | 队员姓名；`--30届--` 这样的行是届别分隔标记 | 手工填写 |
| B | 夜训周训 | 日常训练累计积分 | 日常训练考勤导入 |
| C | 升降旗 | 升降旗累计积分 | 升降旗考勤导入 |
| D | 后勤 | 后勤部积分 | 部门积分导入 |
| E | 综办 | 综办部积分 | 部门积分导入 |
| F | 汇总 | 总分 = B + C + D + E + 全部活动列 | 软件在每次写入后重算 |
| 第 7 列 | （空白） | 分隔列，软件不占用 | — |
| 第 8 列起 | 活动名称 | 每次大型活动一列 | 活动积分结算 |

届别行可以写成 `--30届--`、`——29届——`、`--第28届--` 等形式，横线可以是 2 个以上的减号、中文破折号或短横线。某个队员属于它上方最近的届别行。

用软件的「按模板初始化新建」可以直接生成符合以上格式的空白表（含 `--30届--` 至 `--26届--` 五个届别行），队员名单再照常在 Excel 里填写。

另外三条约定：

- **不是队员的行**：A 列写着「姓名」「合计」「小计」「总计」「平均」「累计」「备注」「说明」的行（中间带不带空格都算，例如「合 计」）不会被当成队员——榜单里不显示、计分时跳过、写入时也不改动，界面顶部会提示跳过了哪几行。这几行里想写什么都可以。
- **B~E 列和活动列请填数值**。如果这次要改的某一格是公式，软件会拒绝本次写入，并指出是哪几位队员的哪一格（提示里写着「选择性粘贴 → 数值」的做法），不会去改写公式。只有 F 列（汇总）例外，见下一条。
- **F 列由软件按明细重算并写成数值**。某一行的明细里一格数字都没有、F 列却是算出了数值的公式（多半是一行合计），软件不会动它，只在完成提示里说明。

导入的考勤表、部门统计表不受以上限制，只要表里有「姓名」和「总次数」（或「总积分」）两列即可。

---

## 数据安全机制

每一次写入（活动结算、批量导入、撤销、差值修改）都走同一条流程：

1. **占用检查**：表格不存在、正被 Excel / WPS 等程序打开、或者文件属性是只读时，拒绝写入并分别说明原因。
2. **读表并做只读校验**：活动名重复、队员不在主表、要改的格子是公式等情况在这一步拦下。校验不通过时不会留下任何痕迹（没有备份，表格一个字节都没动）。
3. **备份**：把当前表格复制到同级的 `.backups` 文件夹（文件名 `年月日_时分秒_原文件名.xlsx`），最多保留最近 20 份。备份没做成就不会往下走。
4. **修改表格**。
5. **重算汇总**：重算所有队员行的 F 列（届别行、「合计」这类文字行不动）。如果发现某行原来的汇总和明细对不上、有公式单元格没有保存计算结果、或者有一行公式合计没有改动，会在完成提示里说明。
6. **原子写回**：先写临时文件，成功后再改名替换原文件，避免写到一半断电留下损坏的表格。替换的那一瞬间如果被杀毒软件、搜索索引「一闪而过」地占用，会自动稍等重试几次，实在不行才报「被占用」。
7. **保存项目配置**：把这一笔登记到历史流水。如果这一步失败，用第 3 步的备份把表格恢复成写入前的样子（同样是先写临时文件再替换），保证表格和历史始终一致。

另外：

- 同一张表格的多次写入在程序内部排队执行，不会互相覆盖。
- 写入进行中（通常一两秒），左侧的「关闭项目」按钮会变灰，避免出现「表格改了、历史里没有这一笔」。
- 项目配置文件也是「先写临时文件再替换」的方式保存；读取时会检查各项内容的类型，被手工改坏的配置会尽量补成合法的形状。
- 界面进程开启了沙箱和上下文隔离，只能通过 preload 暴露的白名单通道调用主进程；正式包的页面带有内容安全策略，不加载任何外部脚本。

---

## 使用限制与注意事项

- 只支持 `.xlsx` 格式，不支持 `.xls`、`.csv`。
- **主表 A 列的姓名中间不要带空格**。软件按姓名精确匹配，`张 三` 和 `张三` 会被当成两个人。（导入表和名单输入框里的排版空格会自动处理。）
- 名单输入框里，如果几个带排版空格的名字之间**只用空格**隔开（例如 `张 三 李 四`），程序无法判断该在哪里断开，会把它们当成四个单字的名字，需要你在弹出的窗口里逐个指定是谁。这类名单请用逗号或换行分隔。
- 主表里有同名队员时，分数只会写到排在前面的那一行，界面会提示「同名待核对」。
- 主表里有两列同名的活动列时，按活动名修改分数只会改到排在前面的那一列。建议不要让活动列重名。
- F 列由软件按明细重算并写成数值。如果某个**队员行**的 F 列原来是公式，被重算的那一格会变成数值。
- 主表里的「合计」「备注」这类文字行会被跳过。导入的考勤表如果末尾带一行「合计」，它不会自动被认出来，会出现在「不在名册中的姓名」里，把它设为忽略即可（或者不要把合计行一起选中复制）。
- 导入表在前 15 行内（任意一个工作表）必须有「姓名」和「总次数」（或「总积分」）表头；表头里的空格和换行不影响识别。有多个「总积分」列时取最后一个。公式单元格必须带有计算结果（用 Excel 或 WPS 打开并保存过一次即可）。
- 项目配置文件和表格的**路径**绑定。积分表或配置文件被移动、改名后，项目会打不开，需要重新新建项目。备份时请把两个文件放回原来的位置。
- 写入期间不要在 Excel / WPS 里打开同一张表格。如果在表格软件里开着，软件会拦下写入并提示先关闭。表格文件被设成「只读」时也会拦下，提示里会说明是只读，而不是被占用。
- 写入进行中不要点窗口右上角的 × 强行关闭程序（左侧的「关闭项目」按钮在这期间是灰的，但窗口的 × 拦不住）。如果真的这么做了，到表格旁边的 `.backups` 文件夹里找写入前的备份即可。
- 软件目前只在 Windows 上测试过。`package.json` 里保留了 macOS 的打包配置，但没有验证。

---

## 架构与维护说明

本节供开发者和 AI 助手阅读：修改代码、补充测试或扩展功能时，请先了解以下约定。

### 目录结构

```text
ghd-autoscore/
├── electron/                     # Electron 主进程
│   ├── main.js                   # 窗口创建、单实例、退出时释放表格锁
│   ├── preload.js                # 向界面暴露 window.ghd.invoke（通道白名单）
│   ├── ipc.js                    # IPC 通道：参数校验、文件对话框、项目与表格操作的入口
│   └── services/
│       ├── excelService.js       # 主表读写：模板、活动列、增量累加、重算汇总、导入表解析
│       ├── exceljsColumnWidth.js # 修正 ExcelJS 写回时丢失"列宽 = 9"的问题
│       ├── projectService.js     # 项目配置、特征签名、最近项目
│       ├── lockService.js        # 表格锁文件与占用检测（被占用 / 只读）
│       ├── backupService.js      # 写入前备份（保留最近 20 份）
│       └── replaceFile.js        # "先写临时文件再替换"里的替换一步，带短暂重试
├── src/                          # React 界面（渲染进程）
│   ├── App.jsx                   # 根组件："先写表格、再存配置、失败则回滚"的流程在这里
│   ├── main.jsx                  # 入口
│   ├── index.css                 # Tailwind 基础样式
│   ├── assets/logo.png           # 界面上显示的徽标 256×256
│   ├── components/
│   │   ├── Workspace.jsx         # 工作区框架（侧边导航、顶部提示）
│   │   ├── ui.jsx                # 通用组件：弹窗、确认框、徽标、提示条
│   │   └── icons.jsx             # 内联 SVG 图标
│   ├── lib/
│   │   ├── api.js                # 对 window.ghd.invoke 的封装（并记录"是否有写入正在进行"）
│   │   ├── eventForm.js          # 活动结算表单的校验与计分（纯函数）
│   │   ├── historyStack.js       # 历史版本栈、活动当前分数、差值
│   │   └── utils.js              # 名单解析、批次号、时间格式、数值取整、写入后的补充说明
│   └── pages/
│       ├── ProjectHub.jsx        # 首页：新建 / 打开项目、最近项目
│       ├── Dashboard.jsx         # 仪表盘与排名
│       ├── EventScoring.jsx      # 活动积分结算
│       ├── BatchImport.jsx       # 批量数据导入
│       └── History.jsx           # 历史流水、撤销、差值修改
├── scripts/
│   ├── build-electron.cjs        # 用 esbuild 把主进程和 preload 连同依赖打成单文件
│   ├── make-icons.cjs            # 由队徽原图生成程序图标（icon.ico、icon.png）和界面徽标
│   ├── verify-packaged.cjs       # 启动验证：窗口能创建、首页能渲染
│   ├── e2e-lib.cjs               # 端到端测试的公共工具
│   ├── e2e-smoke.cjs             # 端到端测试：主流程冒烟
│   └── e2e-scenarios.cjs         # 端到端测试：异常恢复、新建项目、批量导入等场景
├── tests/
│   ├── services.test.cjs         # excelService 的功能测试
│   ├── project.test.cjs          # 项目生命周期测试
│   ├── stress.test.cjs           # 压力与边界测试
│   ├── render.test.cjs           # 页面渲染测试
│   └── render-entry.jsx          # 渲染测试的打包入口
├── build/
│   ├── emblem.jpg                # 队徽原图（生成下面三个图标的素材）
│   ├── icon.ico                  # 程序图标：16~256 像素共 10 种尺寸（打包时写进 exe、安装包、卸载程序）
│   └── icon.png                  # 程序图标母版 1024×1024（icon.ico 里的各种尺寸由它缩出来）
├── dist/                         # vite 产物（不提交）
├── dist-electron/                # 主进程打包产物（不提交）
├── release/                      # 安装包输出目录（不提交）
├── index.html
├── vite.config.js                # 含正式包的内容安全策略
├── tailwind.config.js
├── postcss.config.cjs
├── .npmrc                        # Electron 下载镜像（国内加速）
└── package.json
```

### 分层与调用关系

```text
界面（src/，React）
   │  window.ghd.invoke(通道, 参数)
   ▼
preload（electron/preload.js）：只放行白名单里的通道
   │  ipcRenderer.invoke
   ▼
主进程入口（electron/ipc.js）：文件对话框、参数校验、加锁 / 释放锁
   │
   ▼
服务层（electron/services/）：真正读写磁盘的地方
```

界面不直接接触文件系统；所有返回值统一为 `{ ok, data?, error?, code? }`。

### IPC 通道

| 通道 | 参数 | 说明 |
| :--- | :--- | :--- |
| `dialog:openExcel` | — | 选择总积分表 |
| `dialog:openImportFile` | — | 选择要导入的考勤 / 积分表 |
| `dialog:saveProjectFile` | `defaultName` | 选择项目配置文件的保存位置 |
| `dialog:openProjectFile` | — | 选择要打开的项目配置文件 |
| `dialog:selectDirectory` | — | 选择新表格的保存文件夹 |
| `recent:list` | — | 最近项目列表（每次现算是否仍然有效） |
| `recent:remove` | `configPath` | 从最近项目里移除一条 |
| `project:create` | `{ projectName, mode, excelPath, templateDir, templateName, configPath }` | 新建项目。`mode` 为 `'template'` 时按模板生成新表格。任何一步失败都会清理本次新建的表格、配置和锁 |
| `project:open` | `configPath` | 打开项目：读配置、校验签名、加锁、记入最近项目 |
| `project:save` | `configPath, cfg` | 保存项目配置 |
| `project:close` | `excelPath` | 释放表格锁 |
| `excel:read` | `excelPath` | 只读解析主表 |
| `excel:commitEvent` | `excelPath, { activityName, scores }` | 追加活动列 |
| `excel:applyIncrement` | `excelPath, { targetCol, deltas }` | 对 B / C / D / E 列增量累加 |
| `excel:applyEventEdit` | `excelPath, { activityName, deltas }` | 对活动列施加差值 |
| `excel:deleteActivityColumn` | `excelPath, { activityName, prevColumn }` | 删除活动列，`prevColumn` 是这一列新建前的样子 |
| `excel:restoreBackup` | `excelPath, backupPath` | 用写入前的备份恢复主表。只接受主表旁 `.backups` 文件夹里的 `.xlsx` |
| `excel:readExternal` | `filePath, mode` | 解析导入文件，`mode` 为 `'count'` 或 `'sandwich'` |

### 数据结构

**项目配置文件（`.json`）**

```json
{
  "version": 1,
  "projectName": "2026秋季集训",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "configPath": "绝对路径",
  "excelPath": "绝对路径",
  "excelSignature": "<md5(绝对路径)>:<文件大小>",
  "settings": { "dailyTrainingScore": 1.0 },
  "locks": { "is_logistics_imported": false, "is_comprehensive_imported": false },
  "history": [
    {
      "batchId": "B20261119150000-XXXXXX",
      "timestamp": "ISO-8601",
      "type": "event_create | event_edit | daily | flag | department",
      "objectKey": "event::国庆出旗 | daily::批次号 | department::logistics",
      "label": "国庆出旗",
      "details": { "张三": 3.0 },
      "meta": { "source": "活动积分结算引擎" },
      "status": "undone"
    }
  ]
}
```

- `history` 里的记录只在被撤销时写入 `status: "undone"`；「活跃」「锁定」是由 `src/lib/historyStack.js` 的 `computeStatusMap` 按分组现算的，不存盘。
- `event_create` 记录可以带一个 `prevColumn`（该列新建前的列宽和格式），撤销时带回给主进程。
- Windows 下路径统一写成大写盘符。打开项目时签名里的路径哈希按两种盘符大小写各核对一次，兼容早期按小写盘符生成的项目文件。

**主表读取结果（`excel:read` 的 `data`）**

```javascript
{
  filePath,            // 表格路径
  headers,             // 第 1 行的表头文字，按列号排列
  members: [           // 每个队员一项（届别行、姓名为空的行、「合计」这类文字行不在其中）
    {
      row: 3,          // 在表格里的行号
      name: '张三',
      generation: 30,  // 所属届别（上方最近的届别行），没有则为 null
      b: 2.0, c: 1.0, d: null, e: null, f: 3.0,   // 固定列的数值，空为 null
      extras: { 8: 3.0 }                            // 活动列的分数，键是列号
    }
  ],
  labelRows: [{ row: 31, name: '合计' }],  // 被跳过的「合计 / 备注 / 姓名……」行
  activityColumns: [{ name: '国庆出旗', col: 8 }],
  duplicateNames: [],   // 重名的队员
  duplicateColumns: [], // 重名的活动列
  lastCol, totalRows
}
```

活动分按**列号**存而不是按活动名存，这样两列重名时不会互相覆盖。

**写入类接口返回的 `data`**（活动结算、批量导入、撤销、差值修改）除了各自的内容外，都带着重算汇总时的三项说明，界面用 `src/lib/utils.js` 的 `summaryNote` 把它们拼成完成提示里的补充文字：

| 字段 | 含义 |
| :--- | :--- | :--- |
| `backup` | 这次写入前的备份文件路径 |
| `summaryFixed` | `[{ name, row, from, to }]`：原来的汇总和明细对不上、已被按明细重算的行 |
| `uncalculatedFormulas` | 明细里有、但没有保存计算结果的公式格个数（本次按 0 计入汇总） |
| `untouchedRows` | `[{ name, row, summary }]`：明细里没有数字、汇总格里是算出了数值的公式的行（多半是合计行），程序没有改动 |

**常见的错误码**（`ok: false` 时看 `code`，`error` 里是给使用者看的一句话）：

| 错误码 | 含义 |
| :--- | :--- | :--- |
| `EBUSY` | 表格正被 Excel / WPS 等程序打开 |
| `EREADONLY` | 表格文件属性是只读，或者当前账号没有写入权限 |
| `LOCKED` / `LOCK_FAIL` | 表格已被别的项目占用 / 无法在表格旁创建锁文件 |
| `MEMBER_MISSING` | 有队员在主表里找不到（`data.missing` 是名单） |
| `FORMULA_CELL` | 要改的格子里有公式（`data.formulaCells` 是队员名单） |
| `DUP_COLUMN` | 主表里已有同名的活动列 |
| `EPERM` | 替换文件时反复被占用，重试后仍失败 |

### 构建流程

- `npm run build`：vite 把 `src/` 打包到 `dist/`，并在页面里注入内容安全策略。
- `npm run build:electron`：esbuild 把 `electron/main.js`、`electron/preload.js` 连同用到的全部 Node 依赖（exceljs 及其间接依赖）打成单文件，输出到 `dist-electron/`。`electron` 模块本身由运行时提供，不打进包。
- `npm run dist`：先执行上面两步，再由 electron-builder 生成安装包到 `release/`。

主进程打成单文件的原因：electron-builder 打包 `node_modules` 时会按自己的规则重新整理依赖树，曾经因此漏掉若干间接依赖，导致安装后的程序一启动就报 `Cannot find module`。改成单文件后，安装包里只带 `dist/` 和 `dist-electron/`，不再携带 `node_modules`。开发模式和安装包共用同一份产物。

### 修改代码时容易踩的坑

- **样式共享**：ExcelJS 读完文件后，样式相同的单元格共用同一个样式对象。要改某个单元格的样式，先调用 `copyStyle(参照格, 目标格)` 让它拿到独有的一份，否则同款式的格子会一起变。
- **最后一列**：不要用 `ws.actualColumnCount` 判断表格用到哪一列，中间有空白分隔列时它会少算。用 `lastUsedColumn(ws)`。
- **公式单元格**：`cell.value` 对公式单元格只保留非零的计算结果，结果为 0 时读出来是空的。读数值请用 `cellNum(cell)`（看 `cell.type` / `cell.result`）。
- **列宽为 9 的列**：ExcelJS 写回时会丢掉列宽恰好是 9 的列的定义，`exceljsColumnWidth.js` 对此打了补丁，`excelService.js` 在最前面加载它。
- **界面输入**：主进程的每个接口都要能应付类型不对的参数（`null`、数组、字符串等），统一返回带 `code` 的错误说明，不能抛出异常。
- **两步落盘**：新增一种写入操作时，界面这边要用 `recordAfterWrite` 登记历史，否则配置保存失败时表格不会回滚。同时要把调用主进程的那个函数用 `api.js` 里的 `writing(...)` 包一层，「关闭项目」按钮才知道写入正在进行。
- **「合计」行和公式格**：主进程认队员行的地方（`buildRowMap`、`recalcSummary`、`readWorkbook`）都要跳过 `isLabelRowName` 认出的文字行；新增这类地方时别漏。要往 B~E 列或活动列写数字之前，先用 `formulaCellsIn` 看目标格里有没有公式，有就整笔拒绝，不要在公式格上做累加。
- **活动结算的校验和计分**写在 `src/lib/eventForm.js`（纯函数，不碰界面状态），`EventScoring.jsx` 只负责把输入框连过去。改规则时改这里，并在 `tests/render.test.cjs` 里补用例。
- **下拉框**：`<select>` 的 `className` 里要带 `input`，也不要删掉 `src/index.css` 里的 `select.input` 那条样式。带系统自带外观的下拉框一旦指定了页面用的中文字体（微软雅黑），框里的字就会被画花（「1.5 小时」的「时」缺笔画），v1.0.3 及更早的版本就是这样。`select.input` 去掉了系统外观，右侧的小箭头改由页面自己画；以后新增下拉框，写 `className="input"` 即可。
- **Windows 上的 EPERM**：`rename` 替换文件、以写方式打开「只读属性」的文件，报的都是 `EPERM`，和「被杀毒软件一闪而过地占用」是同一个错误码。替换文件统一走 `replaceFile`（会重试）；判断表格是不是只读，`lockService.probeWritable` 除了看错误码还会看文件属性里的只读位。
- **图标文件**：`package.json` 里的 `build.win.icon` 指向 `build/icon.ico`，不要改回只给一张 `icon.png`。只给一张图的话，打包工具转出来的图标文件里只有一张 256×256 的压缩图，而队徽原图带着噪点，这张图有 80KB 上下（用打包工具自带的转换程序把同一张 `icon.png` 重新转一遍，量得 81251 字节）。负责把图标写进 exe 的 rcedit 把每个条目的长度按 16 位存放，超过 64KB（65536 字节）就记错了，Windows 照着错误的长度去读，任务栏上只显示出最上面一截（v1.0.2 就是这样）。所以 `make-icons.cjs` 生成 `icon.ico` 时放入 16~256 像素共 10 种尺寸：小尺寸存成不压缩的位图（任务栏、标题栏显示的是这些），128 和 256 两种存成压缩的 PNG，并把每个条目的体积控制在 60KB 以内。

---

## 开发与测试

### 环境准备

- Node.js 18 以上（端到端测试脚本用到了 Node 内置的 `WebSocket`，需要 22 以上）
- npm

```bash
git clone https://github.com/wongpatriarch-sketch/ghd-autoscore.git
cd ghd-autoscore
npm install
```

`.npmrc` 里配置了 Electron 的国内下载镜像。

### 本地开发

```bash
npm run dev
```

同时启动 Vite 开发服务器和 Electron，修改界面代码后自动刷新，修改 `electron/` 下的代码后自动重新打包主进程。

### 运行测试

所有测试都只在系统临时目录里操作副本，不会修改任何真实积分表。

```bash
npm test                     # 四组测试：服务层、项目生命周期、压力与边界、页面渲染
npm run test:services
npm run test:project
npm run test:stress
npm run test:render

npm run test:e2e             # 端到端测试（开发模式）：先构建，再跑主流程冒烟和场景测试
npm run test:e2e:packaged    # 端到端测试（安装包目录里的程序，需先 npm run dist）
```

端到端测试会真的把程序启动起来，通过 Chromium 调试端口读取页面文字、点击按钮、填写输入框，再回到磁盘上核对表格内容。它默认把上级目录里的正式积分表复制到临时目录当作样本（只读取原表，不做修改），也可以在第 3 个参数里指定别的样本表：

```bash
node scripts/e2e-smoke.cjs dev "D:/某处/样本积分表.xlsx"
```

### 打包与验证

```bash
npm run dist                 # 生成 release/国护积分管理 Setup x.x.x.exe
npm run verify:packaged      # 启动 release/win-unpacked 里的程序，确认窗口能打开、首页能渲染
```

### 更换队徽

```bash
node scripts/make-icons.cjs 新队徽.png --preview 预览.png
```

原图要求是正方形、白底的圆形队徽。命令会重新生成 `build/icon.ico`、`build/icon.png` 和 `src/assets/logo.png`，并打印每种尺寸用了哪一档压缩。`--preview` 可以省略，加上会多输出一张预览图（各种尺寸分别放在深色和浅色底上）。

---

## 许可

仓库中目前没有附带开源许可证文件。在添加许可证之前，本仓库中的代码保留所有权利；如需使用或修改，请先联系仓库所有者。
