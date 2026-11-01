# pi 移植規格 — `code-modernization`

本文件是 **Claude Code → pi** 的轉換規格。上游來源是 Anthropic 的 `code-modernization` plugin；
母版是本倉庫的 `MiniMaxCode/code-modernization/`（已驗證可用的 mcode 移植）；目標 runtime 是 **pi**
（`@earendil-works/pi-coding-agent`）。

移植的是**程序散文**：把 mcode 的 runtime 對應換成 pi 的，不重新設計產品。

- 上游來源（唯讀）：`/Users/tenyi/Projects/claude-plugins-official/plugins/code-modernization`
- 母版：`MiniMaxCode/code-modernization/`
- 目標套件：`Pi/code-modernization/`（pi package）

## 1. pi 實際提供什麼

| mcode（母版） | pi 對應 | 備註 |
| --- | --- | --- |
| Skill `code-modernization:<name>`，用 `skill` 工具載入 | pi 原生 Agent Skills：`skills/<name>/SKILL.md`，自動被發現，執行時是 `/skill:<name>` | frontmatter 只要 `name` + `description`；`name` 必須等於目錄名 |
| 參數隨使用者訊息抵達 | 同上 | 技能檔用 `**Arguments.**` / `Bound as:` 描述 |
| `ask_user` 問卷工具（1–4 題、每題 2–4 選項、可自由輸入） | pi 內建**沒有**；由本套件的 extension 提供 `ask_user` | 見 §4 |
| `task` 工具（`agent_name`、`description`、`prompt`） | pi 內建**沒有**子代理；由本套件的 extension 提供 `task` | 見 §4 |
| 沒有 Workflow 工具，fan-out 用多次 `task` | 同樣：pi 會平行執行同一則回應中的多個工具呼叫 | 一次回應最多 8 個子代理 |
| `${PLUGIN_ROOT}` | `$CODE_MODERNIZATION_ROOT`（extension 匯出的環境變數） | 沒有硬編碼路徑 |
| `read`/`write`/`edit`/`bash`/`grep`/`glob` | `read`/`write`/`edit`/`bash`/`grep`/**`find`**/`ls` | pi 的 `find` 取代 mcode 的 `glob` |
| `PostToolUse` on `read`（x-ray） | extension 的 `tool_result` 事件：把 x-ray 註解附加到讀取結果 | 呼叫同一支 `scripts/xray.py` |
| `UserPromptSubmit` / `SessionStart`（狀態列） | extension 的 `before_agent_start` / `session_start`：把狀態當成 context 注入 | 呼叫同一支 `scripts/status.py` |
| Plugin `userConfig` | 無對應；設定來自工作區產物與 `~/.pi/agent/settings.json` | |
| Plugin 套件格式 `.minimax-plugin/plugin.json` | pi package：`package.json` + `pi` manifest | `pi.extensions`、`pi.skills` |

## 2. 不可妥協的規則

1. **流程、關卡、產物、證明都是上游的**，只換 runtime 對應。不要翻譯、不要刪步驟、不要加功能。
2. **絕不修改 legacy 原始碼**。所有保證（唯讀 `legacy/`，只寫 `analysis/<system>/` 與 `modernized/`）必須存活。
3. **每個主張都要有證據**。上游的「引用 `file:line`」「測試才是裁判」「只被跳過測試命名的規則不算數」全部保留。
4. **六個決策點仍然由人決定**：preflight 的回答、看起來不對的規則、核准 brief、接受證明找到的差異、簽署證明、套用安全修補。絕不让代理自行決定。
5. **不留 Claude Code / mcode 的詞彙**。不得出現 `CLAUDE_PLUGIN_ROOT`、`AskUserQuestion`、`Workflow` 工具、`subagent_type`、`TodoWrite`、`.claude/settings.json`、`CLAUDE.md`、`slash command`、「pop-up」等。產物裡指稱代理的字樣要寫 `the agent`，不是 `Claude`：`scripts/proof_pack.py`、`assets/report-template.html`、`assets/topology-viewer.html` 各有一處，前兩者是同一句話的兩種輸出，要一起改。
6. **不虛構工具、檔案、腳本或設定**。腳本只有 `scripts/` 底下那 10 支。
7. **不硬編碼絕對路徑**。套件檔案走 `$CODE_MODERNIZATION_ROOT`，工作區路徑相對於工作目錄。
8. **技能名一律寫成 `/skill:<name>`**；代理名一律寫成裸名（例如 `legacy-analyst`），因為 pi 沒有 plugin namespace。

## 3. 技能檔格式

```markdown
---
name: modernize-<name>
description: <一句話：這一步做什麼、何時使用>
---

**Invocation.** This skill is `/skill:modernize-<name>`. Pi advertises it by name and description; when
the task matches, read this file (`SKILL.md`) and follow it. The user can also run `/skill:modernize-<name> <args>`.
**Package files.** The scripts and assets of this package live at `$CODE_MODERNIZATION_ROOT` (the
`code-modernization` extension exports it; when it is empty, it is the parent directory of this skill's
folder). Run them from the workspace with `python3 "$CODE_MODERNIZATION_ROOT/scripts/<script>.py" …`.
**Arguments.** `<system> [options]`
Bound as: `$system`, `$option`.
**Argument source.** …（同母版）
```

- `name` 必須等於目錄名，且符合 `^[a-z0-9-]+$`。
- `description` 是唯一的路由依據，必須讓觸發條件一眼可見。
- `**Package files.**` 這一段每個技能都要有，否則模型不知道去哪找腳本。

## 4. Extension 補上的三塊拼圖

pi 沒有這三樣，所以 `extensions/code-modernization.ts` 提供：

### `task`

- 參數：`agent_name`（8 個專用代理之一）、`description`（工作項名稱）、`prompt`（完整提示）。
- 行為：以 `pi --mode json -p --no-session --no-skills --no-context-files --append-system-prompt <agent.md> -- <prompt>`
  啟動子行程；子行程繼承父行程的 model 與 thinking level，但只帶該代理 frontmatter 裡的 `tools`。
- 子行程以 `CODE_MODERNIZATION_SUBAGENT=1` 啟動：extension 在該模式下一個工具都不註冊，所以子代理
  不能再委派、也不能問問題。
- 回傳：子代理最後一則 assistant 訊息（純文字）。失敗時回傳錯誤與 stderr。
- 平行：pi 會平行執行同一則回應中的多個 `task` 呼叫 —— 這就是 fan-out。

### `ask_user`

- 參數：`questions[]`（1–4 題），每題 `{ question, header?, options[2..4], multi? }`。
- 互動模式：`ctx.ui.select`（附帶「Type something…」可自由輸入）；`multi: true` 時用自訂 checklist
  （上下移動、空白切換、Enter 確認、Esc 取消）。非 TUI 模式（RPC）改用文字輸入。
- 無互動介面（headless）時：回傳錯誤訊息，技能改採預設值並記錄為待辦 —— 與母版行為一致。

### Hooks

- x-ray：`tool_result` 事件，`toolName === "read"` 時以 `{tool_input:{path,offset,limit}, cwd}` 呼叫
  `scripts/xray.py`，把回傳的 `additionalContext` 附加到該次讀取結果。
- 狀態列：`before_agent_start`（使用者提示）與 `session_start` 呼叫 `scripts/status.py`，把
  `additionalContext` 當成 custom message 注入。兩支腳本都 fail open。

另外 extension 會設定 `process.env.CODE_MODERNIZATION_ROOT`，讓工作區裡的 `bash` 呼叫拿得到套件根目錄。

## 5. 代理檔格式（`agents/<name>.md`）

```markdown
---
name: legacy-analyst
description: <與上游同一句>
tools: [read, find, grep, bash]
---
```

- 只用 pi 的原生工具名：`read`、`write`、`edit`、`bash`、`grep`、`find`、`ls`。
- 代理檔放在套件內的 `agents/`，由 `task` 工具自己讀取（不依賴 `~/.pi/agent/agents/`）。
- 內文是上游的代理提示，只替換工具名與技能引用（`/skill:modernize-x`）。

## 6. 檢查清單

改完之後至少確認：

```sh
cd Pi/code-modernization
python3 -m py_compile scripts/*.py                     # 腳本可編譯
pi --skill ./skills --no-session -p "列出你可用的技能"    # 13 個技能都被發現
```

外加：

- 每個 `skills/<name>/SKILL.md` 的 frontmatter `name` 與目錄同名、`description` 非空。
- 每個 `agents/<name>.md` 的 `tools` 都是 pi 的工具名。
- `grep -rn "PLUGIN_ROOT\|MiniMax\|mcode\|CLAUDE_\|AskUserQuestion\|Workflow tool" skills agents` 無結果。
- `python3 scripts/build_report.py <system>` 能產出報告，且 next step 顯示 `/skill:...`。
