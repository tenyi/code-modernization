# code-modernization 多 runtime 移植倉庫

同一套「遺產系統現代化」工作流，在五個 runtime 各有一份移植，另外保留一份上游原版作為對照基準。這個倉庫把它們並排放著，方便對照、比較與備份。

| 目錄 | Runtime | 誰做的 | 來源（真正被 runtime 讀取的地方） |
| --- | --- | --- | --- |
| `Claude/code-modernization/` | Claude Code（上游原版，非移植） | Anthropic 官方 `claude-plugins-official` | `~/.claude/plugins/code-modernization/` |
| `MiniMaxCode/code-modernization/` | MiniMax Code (mcode) | MCode（minimax Code agent）；2.2.0，**單一版本支援 Windows、macOS、Linux** | `~/.minimax/plugins/code-modernization/` |
| `Antigravity/code-modernization/` | Antigravity（Gemini CLI 技能目錄） | Antigravity 裡的 Gemini 3.8 Flash，以 MiniMax Code 版為基底衍生 | `~/.gemini/skills/code-modernization/` |
| `Codex/code-modernization/` | Codex | 以 MiniMax Code 版為基底移植；單一版本支援 Windows、macOS、Linux | 見 [Codex 安裝說明](Codex/README.md) |
| `Pi/code-modernization/` | pi（`@earendil-works/pi-coding-agent`） | 以 MiniMax Code 版為母版、**以 `Claude/` 為事實來源**移植 | pi package：`pi install -l <path>`（裝在專案下），見 [pi 安裝說明](Pi/README.md) |
| `OpenCode/code-modernization/` | OpenCode V2（`opencode.ai/v2`） | 以 MiniMax Code 版為母版移植 | 專案 `opencode.json(c)` 的 `skills`/`plugins` 陣列 + agents 目錄，見 [OpenCode 安裝說明](OpenCode/README.md) |

Codex 版已在 Windows 與 WSL Ubuntu 驗證拓樸產生測試；macOS 尚未實測。
MiniMax Code 版已在 Windows 驗證（外掛載入、6 個 hook handler、三個面板頁、報告產生）；
macOS／Linux 的程式與指令形式都已就位，但**尚未實測**——目前手上的 mcode 只有 Windows 版。

`Claude/` 是**唯讀的上游鏡像**：所有移植的規則都從它推導出來（Claude Code 才有 `AskUserQuestion`、
`Task`、腳本化 `Workflow`、TypeScript hooks 與 TUI 面板），但倉庫裡這份不作為執行來源。
這些能力在別的 runtime 要靠移植補回來；其中 **pi 與 OpenCode 版是終端原生**：pi 自己是終端程式，所以
面板直接畫在終端裡；OpenCode 的 TUI plugin 也一樣。pi 沒有腳本化 workflow runner，所以 extension 補了
一個，**上游的六支 `workflows/*.js` 原樣跑**（OpenCode 則由 server plugin 補同一件事）。
補回策略見 [Claude 獨有的能力，各 runtime 怎麼補](#claude-獨有的能力各-runtime-怎麼補)。

Antigravity 版來源目錄自帶的 git repo 只有一個 commit（`fd97c16`「初始版本：建立 Antigravity 專用代碼現代化技能版本控管」），
author 欄位是當時的 git 設定值，但內容由 Gemini 3.8 Flash 產生。

> ⚠️ MiniMax 與 Antigravity 目錄是**鏡像**，不是執行來源。改完後要同步回上表的來源目錄才會生效；
> 反過來，那邊被別的工具改動時，這裡會顯示為 diff。

## Claude 獨有的能力，各 runtime 怎麼補

`Claude/` 那份上游原版有幾樣東西是別家 runtime 沒有的：`AskUserQuestion`（彈出式問卷）、
`Task`／`Agent`（子代理）、腳本化 `Workflow`（一次開一整批代理的 fan-out）、TypeScript hooks
（`hooks/*.ts` 模組、`asyncRewake`）與 **TUI 面板**（transcript 旁邊的進度面板、規則審核甲板、
簽核對話框、fleet 視圖）。移植時走兩條路線：

- **有對應機制的 → 直接對映**：問卷用該 runtime 的問卷工具、委派用該 runtime 的子代理工具、
  腳本化 fan-out 改成技能內的程序與批次（上限 8）、TS hooks 改成同步的 `command` handler。
- **沒有對應機制的 → 補語義，不補外殼**：面板在別的 runtime 畫不出來，就把它承載的事實做成
  頁面或注入的 context；TS hook 做不到，就用同語義的 Python／命令 hook 重寫。
  **不假裝做到**：做不到的就寫清楚做不到，做得到的就說清楚是快照還是即時的。
- **runtime 本身能做，就直接做**：pi 自己是終端程式，所以面板不需要退化成頁面——它直接畫在
  終端裡（見下表的 pi 欄）。這條是 pi 版與其他移植最大的不同。

| 能力 | MiniMax Code（母版） | Antigravity | Codex | pi | OpenCode |
| --- | --- | --- | --- | --- | --- |
| `AskUserQuestion` | `ask_user` 問卷 | `ask_question` | 逐條問、寫進產物 | extension 補 `ask_user` | 內建 `question` |
| `Task`／`Agent` | `task`（`code-modernization:<agent>`） | `invoke_subagent` | 角色指引式代理、循序執行 | extension 補 `task` | 內建 `subagent` |
| 腳本化 `Workflow` | 技能內的程序＋批次 | 同左 | 循序執行 | **extension 補 `workflow` 執行器**：上游的六支 `workflows/*.js` 原樣跑，runtime 換成 pi 的子代理 | **plugin 補 `workflow` 工具**：同一批上游腳本原樣跑，`agent()` 換成 OpenCode 子 session（工具不可用時退回手動 `subagent` 批次） |
| TypeScript hooks | 同步 `command` handler（Python） | `hooks/hooks.json`（runtime 不保證執行） | 無 | **extension 本身就是 TS**：x-ray、狀態列、fleet（子代理開關）都在裡面 | server plugin（`execute.after` 等） |
| TUI 面板 | **三個頁面**：`PANEL.html`／`REVIEW_DECK.html`／`SIGNOFF.html`；fleet 由 `SubagentStart`／`SubagentStop` hook 累積後畫進面板 | **Generative UI**：`<agent-embed>` 內嵌的進度看板、審核甲板、簽核卡 | 無 | **真·終端面板**：`/modernize-panel`（進度面板＋estate map）、`/modernize-review-pane`（規則審核甲板）、`/modernize-sign`（簽核對話框），另有編輯器上方的常駐狀態列 | **真·終端面板**：同一條 plugin 路徑的 TUI part——`/modernize-panel`（進度面板＋estate map）、`/modernize-review-pane`（規則審核甲板）、`/modernize-sign`（簽核對話框），另有輸入框下方的常駐狀態列 |
| 遙測 | **無** | **無** | **無** | **無** | **無** |

**遙測：任何移植都沒有。** 上游的 `scripts/telemetry.py`／`telemetry.sh` 整支不帶進來，
任何移植都不會送出任何東西——Claude 那份鏡像裡有上游的遙測，但它只是唯讀對照，沒有被複製到
任何一份移植。

**母版規則**：`Claude/` 是唯讀的事實來源，`MiniMaxCode/` 是所有其他移植的母版。上游更新時
**先重做 MiniMax 母版**（把上游新增的語義先補進母版，含上面那列的落差），再依各專屬規格轉出去。

## 各份移植的差異

**Claude Code 上游原版**（`Claude/`）

- 唯讀鏡像，內容等同 `~/Projects/claude-plugins-official/plugins/code-modernization`（上游 repo commit `a7ba5b93`）
- 13 個 **slash command**（`commands/*.md`，`argument-hint` + `$ARGUMENTS`）、8 個 `agents/*.md`、
  `hooks/`（TypeScript：x-ray、狀態列、TUI 面板、review deck、簽核）、`workflows/*.js`（腳本化 fan-out）、
  `scripts/`、`tests/`（vitest + pytest）
- 帶遙測（`scripts/telemetry.py`，整數計數）、`.claude-plugin/plugin.json` manifest、`userConfig` 設定面板
- 是所有移植的**轉換來源**：Claude Code 的工具對應、skill frontmatter 契約、fan-out 契約、
  禁用 token 清單都以此為準

**MiniMax Code 版**（`MiniMaxCode/`）

- 13 個 Skill，入口名 `code-modernization:<name>`，用 `skill` 工具載入
- 8 個 Plugin subagent，委派名 `code-modernization:<agent>`，用 `task` 工具呼叫
- 人的決策點走 `ask_user` 問卷工具
- 6 個 hook handler：`PostToolUse`(read) 的 x-ray、`UserPromptSubmit`／`SessionStart` 的狀態列、
  `SubagentStart`／`SubagentStop`／`PostToolUse`(task) 的 fleet（記住本 session 開過哪些子代理）
- **TUI 面板的 mcode 化**：Claude 的三個 TUI 介面（進度面板、規則審核甲板、簽核對話框）改成三個
  頁面 `analysis/<system>/PANEL.html`／`REVIEW_DECK.html`／`SIGNOFF.html`，由
  `scripts/render_panel.py` 產生；面板裡的 fleet 區塊讀 `analysis/.fleet.json`（由 hook 累積）
- 套件格式：`.minimax-plugin/plugin.json` + `skills/` + `agents/` + `hooks/` + `scripts/` + `assets/`
- 遙測已完全移除
- **2.2.0：`<plugin>` 慣例**。Skill 內文**不做 placeholder 替換**（只有 subagent 系統提示與
  Hook 指令會替換 `${PLUGIN_ROOT}`），所以技能正文一律寫 `<plugin>`，並在前言說明如何從
  `skill` 工具回報的絕對路徑求出套件根目錄
- **2.2.0：一套套件、三個作業系統**。runtime 的 shell 跟著平台走（macOS／Linux 是 bash、
  Windows 是 PowerShell），所以每個 shell 相關指令都給 **POSIX** 與 **PowerShell** 兩種形式並
  標在**同一行**，技能前言要求先偵測一次 shell 再選形式；能用 runtime 工具（`read` 的
  `offset`/`limit`）的地方就不碰 shell
- 13 支 Python 腳本（母版的 10 支 + `xray.py`／`status.py`／`fleet.py`／`render_panel.py`／
  `render_rules.py`／`make_shards.py`／`render_topology.py`）＋ `tests/test_portability.py`；
  `render_topology.py` 取代上游用 bash heredoc 渲染拓樸圖那段

**Antigravity 版**（`Antigravity/`）

- 由 Antigravity 裡的 Gemini 3.8 Flash 製作，基於 MiniMax Code 版衍生：
  共用的 skill／agent／script 檔案沿用 MiniMax Code 版的內容，入口與工具名改成該 runtime 的慣例
- 同一套 13 個流程 Skill，但入口是根目錄的 `SKILL.md`（繁體中文說明），符合 Gemini CLI 的技能目錄慣例
- agent 檔案同樣存在，但工具名與載入方式由 Antigravity 決定
- runtime 對應已收斂乾淨：技能用**裸名**（`modernize-preflight`，無 plugin namespace）、
  問卷是 `ask_question`、委派是 `invoke_subagent`（`Role`/`TypeName`）、
  套件路徑走 `$SKILL_ROOT`（fallback `~/.gemini/skills/code-modernization`）、
  legacy 保護靠 workspace guardrails ＋ `chmod -R a-w legacy/`（無 mcode 的 permission.json／模式）
- 套件仍附 `hooks/hooks.json`（三個 hook，路徑改用 `$SKILL_ROOT` fallback），
  但 Antigravity **不保證會執行 hooks**：runtime 不跑時就不會被呼叫，且沒有任何技能依賴它們
- **TUI 面板的 Antigravity 化**：Claude 的 TUI 介面改成 Antigravity 的 **Generative UI**——
  `assets/widgets/` 的進度看板、規則審核甲板與簽核卡，由 `scripts/render_widgets.py` 組裝，
  以 `<agent-embed>` 在對話中內嵌
- 有自己的 git 歷史（來源目錄內含 `.git`）

**pi 版**（`Pi/`）

- 以 MiniMax Code 版為母版、**以 `Claude/` 為事實來源**：13 個技能改成 pi 原生 Agent Skills
  （`skills/<name>/SKILL.md`），入口是 `/skill:<name>`；8 個代理改成 pi 代理 frontmatter
  （`tools` 用 `find` 取代 `glob`）
- **比母版多一個 extension**（`extensions/code-modernization.ts` + `hooks/`）：pi 內建沒有子代理、
  問卷、腳本化 workflow 與 hook，所以 extension 補上：
  - `task`（獨立 pi 子行程跑一個專用代理）
  - `workflow`（**上游的六支 `workflows/*.js` 原樣跑**：腳本要的 `agent()`／`parallel()`／
    `pipeline()`／`log()`／`budget` 由 pi 綁定，agent 答案依腳本給的 schema 解析回結構化資料）
  - `ask_user`（1–4 題問卷，可複選、可自由輸入）
  - **TUI 面板**（pi 自己是終端程式，所以面板直接畫在終端裡，不是頁面）：
    `/modernize-panel`（進度面板＋estate map）、`/modernize-review-pane`（規則審核甲板）、
    `/modernize-sign`（簽核對話框），加上編輯器上方的常駐狀態列
  - hook（x-ray、狀態列）與 fleet（子代理的開關，餵給面板的 Session 區）
- extension 另外匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到套件裡的 `scripts/` 與 `assets/`
- 套件格式：pi package（`package.json` + `pi` manifest）+ `skills/` + `agents/` + `extensions/` +
  `hooks/` + `workflows/` + `scripts/` + `assets/`

**OpenCode 版**（`OpenCode/`）

- 以 MiniMax Code 版為母版，13 個技能是 OpenCode 原生 skill 格式（`skills/<name>/SKILL.md`），
  以 `skill` 工具按 **id** 載入，訊息裡 `@<name>` 提及亦可；8 個代理是 OpenCode 代理檔
  （`mode: subagent` + `permissions` 封閉清單；V2 禁止 agent 檔用 `tools` 欄位）
- **不需要 extension**：OpenCode 內建 `question`（問卷）、`subagent`（子代理）與 plugin hook API
- 母版的 `hooks/hooks.json` 換成套件內 server plugin（`plugin/index.ts`）：tool `execute.after`
  跑 x-ray、session `prompt` hook 跑狀態列（以 session instruction entry 注入）、`shell`
  `create.before` 匯出 `$CODE_MODERNIZATION_ROOT`；全部 fail open、5 秒逾時
- **腳本化 fan-out 補回來了**：同一份 server plugin 註冊 `workflow` 工具，載入 `workflows/`
  底下六支上游腳本（原樣執行），`agent()` 換成 OpenCode 子 session；子代理的答案依腳本給的
  schema 解析，journal 寫在 `.code-modernization/workflow-journal.jsonl` 供 resume
- **TUI 面板也是同一條 plugin 路徑**：`plugin/tui.tsx`（TUI part）掛三個 `session.panel`
  （`/modernize-panel`、`/modernize-review-pane`、`/modernize-sign`）與 `prompt.footer.status`
  狀態列；繪製沿用 pi 版的 reader／map／review／fleet，只把 ANSI 行轉成 OpenTUI span。
  面板選項讀工作區的 `.code-modernization/panel.json`（OpenCode 沒有 per-plugin 設定畫面）
- **面板的活事實靠事件**（上游 `tool.call` hook 的對應）：TUI part 訂閱
  `session.tool.input.started`／`session.tool.called`／`session.tool.success`／`session.tool.failed`
  與 `session.inbox.enqueued`／`session.skill.activated`——自己的呼叫進 activity 區塊，
  子 session 的呼叫進 fleet，讀寫 `legacy/` 下的檔案會點亮 estate map 上對應的磚
  （4 秒褪色，其間每 250 ms 重畫），結果裡有 `[end x-ray]` 就多算一次 x-ray，
  這一輪用哪個技能則來自提示文字的 `@modernize-…` 提及或技能附件。
- 套件格式：普通目錄（`skills/` + `agents/` + `plugin/`（含 `tui.tsx`、`tui/`） + `workflows/` +
  `scripts/` + `assets/`），靠 `opencode.json(c)` 的 `skills`/`plugins` 陣列與 agents 目錄載入，無 manifest

## 安裝到 pi

pi 版是一個 pi package（`Pi/code-modernization/`），安裝後 13 個技能與 extension 會一起生效。

**原則：用在哪個專案，就裝在那個專案。** 所以預設是專案範圍安裝（寫入該專案的 `.pi/settings.json`），
不動全域設定。

```sh
# 1. 先備份份：pi、python3 都要有
pi --version
python3 --version

# 2. 在「要用這套工作流的專案」裡安裝（專案範圍，寫入 <專案>/.pi/settings.json）
cd /path/to/your/project
pi install -l /path/to/mcode-port-work/Pi/code-modernization

# 3. 第一次在該專案啟動 pi 時，pi 會問要不要信任這個專案 —— 信任後套件才會載入
#    （非互動模式用 pi -a 單次信任）
pi -a

# 4. 確認
cat .pi/settings.json      # 會有 "packages": [".../Pi/code-modernization"]
```

裝好後在該專案啟動 pi，13 個技能就以 `/skill:modernize …` 的形式出現，extension 同時提供
`task`（子代理）與 `ask_user`（問卷）兩個工具。**技能與腳本都不需要另外設定**：extension 會匯出
`$CODE_MODERNIZATION_ROOT`，技能用它找到套件裡的 `scripts/` 與 `assets/`。

不用的時候移除（只影響那個專案）：

```sh
cd /path/to/your/project
pi remove -l --approve /path/to/mcode-port-work/Pi/code-modernization
```

其他三種安裝方式：

```sh
# a) 只試用一次，不寫入任何設定
cd /path/to/mcode-port-work
pi -e ./Pi/code-modernization
pi --skill ./Pi/code-modernization/skills \
   --extension ./Pi/code-modernization/extensions/code-modernization.ts

# b) 全域安裝（選擇性）：寫入 ~/.pi/agent/settings.json，所有專案都會載入
pi install /path/to/mcode-port-work/Pi/code-modernization
pi remove /path/to/mcode-port-work/Pi/code-modernization      # 移除

# c) 手動安裝（不經 package manager）：整包搬過去，settings 指到套件裡的 extension
mkdir -p ~/.pi/agent/packages
cp -R Pi/code-modernization ~/.pi/agent/packages/
# ~/.pi/agent/settings.json
{
  "extensions": ["~/.pi/agent/packages/code-modernization/extensions/code-modernization.ts"],
  "skills": ["~/.pi/agent/packages/code-modernization/skills"]
}
```

其他常見動作：

```sh
pi list                              # 看已安裝的套件（只列 user scope；專案範圍的看該專案的 .pi/settings.json）
pi update --extensions               # 對遠端來源的套件更新版本
pi config                            # 逐一啟用/停用套件裡的資源（技能、extension）
```

本倉庫是**鏡像**：pi 對本地路徑的套件是「載入、不複製」，所以改完 `Pi/code-modernization/` 之後，
在 pi 裡 `/reload`（或重開 session）就會生效，不必重新 `pi install`。

驗證安裝（在該專案裡）：

```sh
cd /path/to/your/project
pi -a --no-session -p "列出你能看到的、以 modernize 開頭的技能名"
```

完整說明見 [Pi/README.md](Pi/README.md) 與套件自己的 [README](Pi/code-modernization/README.md)。

## 移植規則

規格檔分成兩層：**根目錄 [`PORTING-SPEC.md`](PORTING-SPEC.md) 是全 runtime 共用**的規則
（上游事實來源、不可妥協的規則、技能檔骨架、Fan-out 契約、代理規則、腳本清單、禁用 token 基線、
檢查清單），**每個 runtime 另有自己的專屬規格**，寫該 runtime 的差異細節：

| 規格檔 | 對應 runtime | 內容摘要 |
| --- | --- | --- |
| [`PORTING-SPEC.md`](PORTING-SPEC.md) | 全部（共用） | 上游 Claude Code 事實來源、共用規則與檢查清單 |
| [`MiniMaxCode/PORTING-SPEC.md`](MiniMaxCode/PORTING-SPEC.md) | MiniMax Code（母版） | mcode 工具對應、`skill` 工具與 `code-modernization:` 前綴、`ask_user`、`task`、`hooks/hooks.json`、`.minimax-plugin` manifest、**`<plugin>` 慣例**、**shell 中立（POSIX／PowerShell 雙形式）** |
| [`Antigravity/PORTING-SPEC.md`](Antigravity/PORTING-SPEC.md) | Antigravity | Gemini CLI 技能目錄慣例、裸名技能、`ask_question`、`invoke_subagent`（`Role`/`TypeName`）、`$SKILL_ROOT` fallback、無 hooks（chmod guardrail） |
| [`Codex/PORTING-SPEC.md`](Codex/PORTING-SPEC.md) | Codex | 單一技能 + 13 個程序檔、角色指引式代理、`CODE_MODERNIZATION_ROOT` 自行設定、循序執行、無 hooks |
| [`Pi/PORTING-SPEC.md`](Pi/PORTING-SPEC.md) | pi | 技能發現、extension 補三塊拼圖（`task`／`ask_user`／hooks）、`find` 取代 `glob` |
| [`OpenCode/PORTING-SPEC.md`](OpenCode/PORTING-SPEC.md) | OpenCode | 技能 ID 與 `@` 字串規則、`question`／`subagent`、permissions 封閉清單、server plugin 與 `workflow` 工具、TUI part（`session.panel`／狀態列）、`shell` 取代 `bash` |

衝突時以專屬規格優先。日後上游 Anthropic plugin 更新時，**先重做 MiniMax 母版**，再依各專屬規格
轉到下游 runtime。

## 同步

```sh
# 從來源目錄更新鏡像
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/Projects/claude-plugins-official/plugins/code-modernization/ Claude/code-modernization/
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.minimax/plugins/code-modernization/ MiniMaxCode/code-modernization/
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.gemini/skills/code-modernization/ Antigravity/code-modernization/

# pi 版：本地路徑套件是「載入不複製」，改完在 pi 裡 /reload 即生效；重裝用：
#   用在哪個專案就裝在哪個專案（寫入該專案的 .pi/settings.json）
cd /path/to/your/project && pi install -l /path/to/mcode-port-work/Pi/code-modernization

# OpenCode 版：單向同步母版 → 移植的非改寫檔，之後要重新套用兩處腳本字串；
#   完整命令（含 exclude 與字串回補）見 OpenCode/README.md 的「同步」節

# 提交
git add -A && git commit -m "sync ports"
```

## 檢查

改動後至少確認：manifest 可解析、skill frontmatter 的 `name` 與目錄同名、
套件根目錄的寫法指到的檔案真的存在、Python 能編譯。
根目錄怎麼寫，各 runtime 不同：Skill 內文在 MiniMax Code 版用 `<plugin>`（Skill 內文不做
placeholder 替換），pi 與 OpenCode 用 `$CODE_MODERNIZATION_ROOT`；
`${PLUGIN_ROOT}` 只在 subagent 系統提示與 Hook 指令裡會被替換。
pi 版另外確認 13 個技能都被 pi 發現、extension 能載入：

```sh
cd Pi/code-modernization
python3 -m py_compile scripts/*.py
pi --skill ./skills --no-session -p "列出你可用的技能"
```

MiniMax Code 版另外確認面板三頁可產生並開得起來（母版新增的東西），
並跑可攜性檢查（它會擋下 placeholder、bash 專屬語法、只給單一 shell 形式的指令）：

```sh
cd MiniMaxCode/code-modernization
python3 -m py_compile scripts/*.py
python3 tests/test_portability.py
python3 scripts/render_panel.py all --system <某個已存在的系統> --workspace <該專案根>
# 產生 analysis/<system>/{PANEL,REVIEW_DECK,SIGNOFF}.html，用瀏覽器開啟，console 無錯誤
```

倉庫根目錄的 `tools/` 放改寫與檢查各移植的腳本（目前指向 MiniMaxCode 版；其他移植沿用同一套規則）：

```sh
# 把母版的 shell 形式改成 POSIX／PowerShell 雙形式（冪等；--check 只檢查不改）
python3 tools/port_skills_crossplatform.py            # 套用
python3 tools/port_skills_crossplatform.py --check     # 只報哪裡還是單一 shell 形式
```

OpenCode 版另外跑移植規格 §9 的檢查（py_compile、禁用 token 的全區 grep、
13 技能／8 代理／plugin 與 TUI part 的發現與建置驗證），命令見
[`OpenCode/README.md`](OpenCode/README.md) 的「檢查」節。
