# code-modernization 多 runtime 移植倉庫

同一套「遺產系統現代化」工作流，在兩個 runtime 各有一份移植。這個倉庫把兩份並排放著，方便對照、比較與備份。

| 目錄 | Runtime | 來源（真正被 runtime 讀取的地方） |
| --- | --- | --- |
| `MiniMaxCode/code-modernization/` | MiniMax Code (mcode) | `~/.minimax/plugins/code-modernization/` |
| `Antigravity/code-modernization/` | Antigravity / Gemini CLI | `~/.gemini/skills/code-modernization/` |

> ⚠️ 這個倉庫是**鏡像**，不是執行來源。改完這裡，要同步回上表右欄的目錄才會生效；
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

- 同一套 13 個流程 Skill，但入口是根目錄的 `SKILL.md`（繁體中文說明），符合 Gemini CLI 的技能目錄慣例
- agent 檔案同樣存在，但工具名與載入方式由 Antigravity 決定
- 有自己的 git 歷史（來源目錄內含 `.git`）

## 移植規則

`PORTING-SPEC.md` 是兩次移植共用的轉換規格：Claude Code 的工具對應、skill frontmatter 契約、
fan-out 措辭、禁用 token 清單。日後上游 Anthropic plugin 更新時，依這份規格再轉一次即可。

## 同步

```sh
# 從來源目錄更新鏡像
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.minimax/plugins/code-modernization/ MiniMaxCode/code-modernization/
rsync -a --delete --exclude '.git' --exclude '__pycache__' \
  ~/.gemini/skills/code-modernization/ Antigravity/code-modernization/

# 提交
git add -A && git commit -m "sync ports"
```

## 檢查

改動後至少確認：manifest 可解析、skill frontmatter 的 `name` 與目錄同名、
`${PLUGIN_ROOT}`（或該 runtime 的對應變數）指到的檔案真的存在、Python 能編譯。
