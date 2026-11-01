# code-modernization 多 runtime 移植倉庫

同一套「遺產系統現代化」工作流，在五個 runtime 各有一份移植，另外保留一份上游原版作為對照基準。這個倉庫把它們並排放著，方便對照、比較與備份。

| 目錄 | Runtime | 誰做的 | 來源（真正被 runtime 讀取的地方） |
| --- | --- | --- | --- |
| `Claude/code-modernization/` | Claude Code（上游原版，非移植） | Anthropic 官方 `claude-plugins-official` | `~/.claude/plugins/code-modernization/`（鏡像自 `~/Projects/claude-plugins-official/plugins/code-modernization`） |
| `MiniMaxCode/code-modernization/` | MiniMax Code (mcode) | MCode（minimax Code agent） | `~/.minimax/plugins/code-modernization/` |
| `Antigravity/code-modernization/` | Antigravity（Gemini CLI 技能目錄） | Antigravity 裡的 Gemini 3.8 Flash，以 MiniMax Code 版為基底衍生 | `~/.gemini/skills/code-modernization/` |
| `Codex/code-modernization/` | Codex | 以 MiniMax Code 版為基底移植 | 見 [Codex 安裝說明](Codex/README.md) |
| `Pi/code-modernization/` | pi（`@earendil-works/pi-coding-agent`） | 以 MiniMax Code 版為母版移植 | pi package：`pi install -l <path>`（裝在專案下），見 [pi 安裝說明](Pi/README.md) |
| `OpenCode/code-modernization/` | OpenCode V2（`opencode.ai/v2`） | 以 MiniMax Code 版為母版移植 | 專案 `opencode.json(c)` 的 `skills`/`plugins` 陣列 + agents 目錄，見 [OpenCode 安裝說明](OpenCode/README.md) |

`Claude/` 是**唯讀的上游鏡像**：所有移植的規則都從它推導出來（Claude Code 才有 `AskUserQuestion`、
`Task`、腳本化 `Workflow`、TypeScript hooks 與 TUI 面板），但倉庫裡這份不作為執行來源。

Antigravity 版來源目錄自帶的 git repo 只有一個 commit（`fd97c16`「初始版本：建立 Antigravity 專用代碼現代化技能版本控管」），
author 欄位是當時的 git 設定值，但內容由 Gemini 3.8 Flash 產生。

> ⚠️ MiniMax 與 Antigravity 目錄是**鏡像**，不是執行來源。改完後要同步回上表的來源目錄才會生效；
> 反過來，那邊被別的工具改動時，這裡會顯示為 diff。

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
- 2 個 hook：`PostToolUse` 上的 x-ray、`UserPromptSubmit` / `SessionStart` 上的狀態列
- 套件格式：`.minimax-plugin/plugin.json` + `skills/` + `agents/` + `hooks/` + `scripts/` + `assets/`
- 遙測已完全移除

**Antigravity 版**（`Antigravity/`）

- 由 Antigravity 裡的 Gemini 3.8 Flash 製作，基於 MiniMax Code 版衍生：
  共用的 skill／agent／script 檔案沿用 MiniMax Code 版的內容，入口與工具名改成該 runtime 的慣例
- 同一套 13 個流程 Skill，但入口是根目錄的 `SKILL.md`（繁體中文說明），符合 Gemini CLI 的技能目錄慣例
- agent 檔案同樣存在，但工具名與載入方式由 Antigravity 決定
- runtime 對應已收斂乾淨：技能用**裸名**（`modernize-preflight`，無 plugin namespace）、
  問卷是 `ask_question`、委派是 `invoke_subagent`（`Role`/`TypeName`）、
  套件路徑走 `$SKILL_ROOT`（fallback `~/.gemini/skills/code-modernization`）、
  legacy 保護靠 workspace guardrails ＋ `chmod -R a-w legacy/`（無 mcode 的 permission.json／模式）
- 有自己的 git 歷史（來源目錄內含 `.git`）

**pi 版**（`Pi/`）

- 以 MiniMax Code 版為母版，13 個技能改成 pi 原生 Agent Skills（`skills/<name>/SKILL.md`），
  入口是 `/skill:<name>`；8 個代理改成 pi 代理 frontmatter（`tools` 用 `find` 取代 `glob`）
- **比母版多一個 extension**：pi 內建沒有子代理、問卷與 hook，所以
  `extensions/code-modernization.ts` 補上 `task`（獨立 pi 子行程跑一個專用代理）、`ask_user`
  （1–4 題問卷，可複選、可自由輸入）與兩支 hook（x-ray、狀態列）
- extension 另外匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到套件裡的 `scripts/` 與 `assets/`
- 套件格式：pi package（`package.json` + `pi` manifest）+ `skills/` + `agents/` + `extensions/` +
  `scripts/` + `assets/`

**OpenCode 版**（`OpenCode/`）

- 以 MiniMax Code 版為母版，13 個技能是 OpenCode 原生 skill 格式（`skills/<name>/SKILL.md`），
  以 `skill` 工具按 **id** 載入，訊息裡 `@<name>` 提及亦可；8 個代理是 OpenCode 代理檔
  （`mode: subagent` + `permissions` 封閉清單；V2 禁止 agent 檔用 `tools` 欄位）
- **不需要 extension**：OpenCode 內建 `question`（問卷）、`subagent`（子代理）與 plugin hook API
- 母版的 `hooks/hooks.json` 換成套件內 server plugin（`plugin/index.ts`）：tool `execute.after`
  跑 x-ray、session `prompt` hook 跑狀態列（以 session instruction entry 注入）、`shell`
  `create.before` 匯出 `$CODE_MODERNIZATION_ROOT`；全部 fail open、5 秒逾時
- 套件格式：普通目錄（`skills/` + `agents/` + `plugin/` + `scripts/` + `assets/`），
  靠 `opencode.json(c)` 的 `skills`/`plugins` 陣列與 agents 目錄載入，無 manifest

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

`PORTING-SPEC.md` 是 MiniMax Code 與 Antigravity 兩次移植共用的轉換規格：Claude Code 的工具對應、
skill frontmatter 契約、fan-out 措辭、禁用 token 清單。pi 版另有一份
[`Pi/PORTING-SPEC.md`](Pi/PORTING-SPEC.md)：同一套母版，但要換成 pi 的技能發現、工具名、
以及「pi 缺什麼就由 extension 補什麼」的對應表。OpenCode 版也有一份
[`OpenCode/PORTING-SPEC.md`](OpenCode/PORTING-SPEC.md)：mcode → OpenCode V2 的工具對應、
技能/代理檔格式、plugin（hooks 對應）與權限段落改寫規則。日後上游 Anthropic plugin 更新時，
依這三份規格再轉一次即可。

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
`${PLUGIN_ROOT}`（或該 runtime 的對應變數：pi 與 OpenCode 都是 `$CODE_MODERNIZATION_ROOT`）指到的檔案真的存在、
Python 能編譯。pi 版另外確認 13 個技能都被 pi 發現、extension 能載入：

```sh
cd Pi/code-modernization
python3 -m py_compile scripts/*.py
pi --skill ./skills --no-session -p "列出你可用的技能"
```

OpenCode 版另外跑移植規格 §9 的檢查（py_compile、禁用 token 的全區 grep、
13 技能／8 代理／plugin 的發現驗證），命令見 [`OpenCode/README.md`](OpenCode/README.md) 的「檢查」節。
