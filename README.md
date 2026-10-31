# code-modernization 多 runtime 移植倉庫

同一套「遺產系統現代化」工作流，在四個 runtime 各有一份移植。這個倉庫把它們並排放著，方便對照、比較與備份。

| 目錄 | Runtime | 誰做的 | 來源（真正被 runtime 讀取的地方） |
| --- | --- | --- | --- |
| `MiniMaxCode/code-modernization/` | MiniMax Code (mcode) | MCode（minimax Code agent） | `~/.minimax/plugins/code-modernization/` |
| `Antigravity/code-modernization/` | Antigravity（Gemini CLI 技能目錄） | Antigravity 裡的 Gemini 3.8 Flash，以 MiniMax Code 版為基底衍生 | `~/.gemini/skills/code-modernization/` |
| `Codex/code-modernization/` | Codex | 以 MiniMax Code 版為基底移植 | 見 [Codex 安裝說明](Codex/README.md) |
| `Pi/code-modernization/` | pi（`@earendil-works/pi-coding-agent`） | 以 MiniMax Code 版為母版移植 | pi package：`pi install <path>`，見 [pi 安裝說明](Pi/README.md) |

Antigravity 版來源目錄自帶的 git repo 只有一個 commit（`fd97c16`「初始版本：建立 Antigravity 專用代碼現代化技能版本控管」），
author 欄位是當時的 git 設定值，但內容由 Gemini 3.8 Flash 產生。

> ⚠️ MiniMax 與 Antigravity 目錄是**鏡像**，不是執行來源。改完後要同步回上表的來源目錄才會生效；
> 反過來，那邊被別的工具改動時，這裡會顯示為 diff。

## 兩份移植的差異

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

## 移植規則

`PORTING-SPEC.md` 是 MiniMax Code 與 Antigravity 兩次移植共用的轉換規格：Claude Code 的工具對應、
skill frontmatter 契約、fan-out 措辭、禁用 token 清單。pi 版另有一份
[`Pi/PORTING-SPEC.md`](Pi/PORTING-SPEC.md)：同一套母版，但要換成 pi 的技能發現、工具名、
以及「pi 缺什麼就由 extension 補什麼」的對應表。日後上游 Anthropic plugin 更新時，
依這兩份規格再轉一次即可。

## 同步

```sh
# 從來源目錄更新鏡像
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.minimax/plugins/code-modernization/ MiniMaxCode/code-modernization/
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.gemini/skills/code-modernization/ Antigravity/code-modernization/

# pi 版：pi package 是從路徑載入的，改完重新安裝即可
pi install ./Pi/code-modernization

# 提交
git add -A && git commit -m "sync ports"
```

## 檢查

改動後至少確認：manifest 可解析、skill frontmatter 的 `name` 與目錄同名、
`${PLUGIN_ROOT}`（或該 runtime 的對應變數：pi 是 `$CODE_MODERNIZATION_ROOT`）指到的檔案真的存在、
Python 能編譯。pi 版另外確認 13 個技能都被 pi 發現、extension 能載入：

```sh
cd Pi/code-modernization
python3 -m py_compile scripts/*.py
pi --skill ./skills --no-session -p "列出你可用的技能"
```
