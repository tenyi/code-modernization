# MiniMax Code 移植規格 — `code-modernization`（母版）

本文件是 **Claude Code → MiniMax Code (mcode)** 的轉換規格。它同時是**所有其他 runtime 移植的
母版**：Antigravity、Codex、pi、OpenCode 都是從 `MiniMaxCode/code-modernization/` 衍生出來的。

共用規則（不可妥協的規則、技能檔骨架、Fan-out 契約、代理規則、腳本清單、禁用 token 基線）見
根目錄 [`../PORTING-SPEC.md`](../PORTING-SPEC.md)；本文件只寫 mcode 專屬的部分。

- 上游來源（唯讀）：`Claude/code-modernization/`
- 目標套件：`MiniMaxCode/code-modernization/`（鏡像 `~/.minimax/plugins/code-modernization/`）

---

## 1. mcode 實際提供什麼

| 上游 Claude Code | mcode 對應 |
| --- | --- |
| slash command `commands/foo.md` | Skill `skills/foo/SKILL.md`，用 `skill` 工具載入，名字 `code-modernization:foo` |
| `argument-hint` / `$ARGUMENTS` / `$system` frontmatter | 無參數綁定：參數隨使用者訊息抵達 |
| `AskUserQuestion`（彈出式） | `ask_user` 問卷工具（1–4 題、每題 2–4 選項） |
| `Task` / `Agent`（`subagent_type`） | `task` 工具，`agent_name: "code-modernization:<agent>"` |
| `Workflow({name, args})`（腳本化 fan-out） | **無對應**：fan-out 用多次 `task` 呼叫 |
| `${CLAUDE_PLUGIN_ROOT}` | `${PLUGIN_ROOT}` |
| `${CLAUDE_PLUGIN_DATA}` | `${PLUGIN_DATA}` |
| `Read`/`Glob`/`Grep`/`Bash`/`Write`/`Edit` | `read`/`glob`/`grep`/`bash`/`write`/`edit`（小寫原生名） |
| `TodoWrite` | `todowrite` |
| `WebSearch`/`WebFetch` | `web_search`/`web_fetch` |
| 互動式 TUI 面板（`hooks/views/pane.tsx`、review deck、sign-off） | **不可移植成 TUI** → 同一份語義的三個頁面：`scripts/render_panel.py` 產生 `PANEL.html`／`REVIEW_DECK.html`／`SIGNOFF.html` |
| `hooks/hooks.json` + TS modules + `asyncRewake` | `hooks/hooks.json`，**只有同步的 `command` handler** |
| plugin `userConfig` 設定 | 無對應：設定來自工作區產物與環境變數 |
| 遙測 hooks | **完全移除**（使用者決定） |
| 權限 | `~/.minimax/permission.json`、`/permission status`、ask/auto 模式 |

---

## 2. 技能檔格式

```markdown
---
name: modernize-<name>
description: <與母版同一句，不動>
---

**Invocation.** Load this skill with the `skill` tool, name `code-modernization:modernize-<name>`.
**Arguments.** `<system> [options]`
Bound as: `$system`, `$option`.
**Argument source.** The arguments arrive in the user's message (the text after the skill
name, or a sentence naming the system). When one is missing: ask once with `ask_user`, or
infer it from `analysis/` and state the assumption in one line. Never guess silently.

<母版的程序散文，逐行對應>
```

- **mcode 沒有 `**Package files.**` 段**：這是 mcode 與 pi／OpenCode 的差別。mcode 在啟動時
  替換 `${PLUGIN_ROOT}`，技能正文直接寫 `python3 "${PLUGIN_ROOT}/scripts/<script>.py" …`。
- `**Argument source.**` 逐字保留母版版本，只把問卷工具名換成 `ask_user`。
- 母版的標題結構、章節編號、數字（批次上限 8、shard 門檻、估計值）全部保留。

---

## 3. Fan-out 措辭（逐字）

> **Fan-out.** MiniMax Code has no Workflow tool: the fan-out is done with the `task` tool.
> One subagent is one `task` call with `agent_name: "code-modernization:<agent>"`, a
> `description` naming the work item, and a `prompt` that carries everything the subagent
> needs — it sees none of this conversation. Start several children in one response (omit
> `run_in_background`) to run them in parallel; the runtime caps how many run at once, so
> start at most **8** at a time and continue with the next batch as results come back. If a
> call reports a concurrency limit, wait for the running children to finish and continue.
> A subagent returns one final message and nothing is enforced about its shape, so the
> prompt must spell out the JSON to return and say: *Return only this JSON object — no
> prose, no code fences.* Never end the turn while a subagent is still running, and collect
> every result before writing any artifact.

母版有兩種排版：帶引號的段落（assess、map 之外的多數）與無引號段落（assess、map）。
**維持母版的排版**，只替換第一句的工具名。

UNTRUSTED 區塊、JSON 契約、合併與記帳規則見根目錄規格 §4。

---

## 4. 代理檔格式（`agents/<name>.md`）

```markdown
---
name: legacy-analyst
description: <與上游同一句，不動>
tools: [read, glob, grep, bash]
mcpServers: []
skills: []
---
```

- `tools` **只能用小寫原生名**：`read`、`write`、`edit`、`bash`、`grep`、`glob`、`web_fetch`、
  `web_search`、`todowrite`。
  上游 `tools: Read, Glob, Grep, Bash` → `tools: [read, glob, grep, bash]`；
  可寫代理（`scaffolder`、`test-engineer`、`uplift-migrator`）→ `tools: [read, write, edit, bash, grep, glob]`。
- **`task` 不在 tools 裡**：mcode 的 plugin subagent 不能再委派。
- `mcpServers: []` 與 `skills: []` 保留為空陣列（上游沒有 MCP 與 skills，不要繼承）。
- 不加 `model`、`effort`、`x-mavis.*`、`hooks`、`permissionMode`。
- 內文是上游代理提示，只替換工具名、把 `/code-modernization:modernize-x` 改成
  `code-modernization:modernize-x`、把 `Task` 呼叫改成 `task` 呼叫；行為規則逐字保留。
- 內文可用 `${PLUGIN_ROOT}` 與 `${PLUGIN_DATA}`（啟動時替換）。

---

## 5. 套件結構

```
MiniMaxCode/code-modernization/
  .minimax-plugin/plugin.json      manifest：skills[]、agents[]、hooks[]、icon、exampleQueries
  icon.png, icon-dark.png
  README.md, CHANGELOG.md, LICENSE
  agents/<name>.md                  8 個 subagent
  skills/<name>/SKILL.md            13 個技能
  hooks/hooks.json                  6 個 hook handler（見下）
  scripts/*.py                      12 支
  assets/report-template.html
  assets/panel-template.html
  assets/topology-viewer.html
  assets/vendor/mermaid.min.js
```

`hooks/hooks.json`（**只有同步 `command` handler**，逾時 5 秒）：

| 事件 | 對應上游 | 呼叫 |
| --- | --- | --- |
| `PostToolUse`（matcher `read`） | `hooks/xray/xray.ts` | `python3 "${PLUGIN_ROOT}/scripts/xray.py"` |
| `PostToolUse`（matcher `task`） | `hooks/fleet/fleet.ts` | `python3 "${PLUGIN_ROOT}/scripts/fleet.py"` |
| `SubagentStart` | `hooks/fleet/fleet.ts` | `python3 "${PLUGIN_ROOT}/scripts/fleet.py"` |
| `SubagentStop` | `hooks/fleet/fleet.ts` | `python3 "${PLUGIN_ROOT}/scripts/fleet.py"` |
| `UserPromptSubmit` | `hooks/reader/progress.ts` | `python3 "${PLUGIN_ROOT}/scripts/status.py"` |
| `SessionStart` | `hooks/reader/progress.ts` | `python3 "${PLUGIN_ROOT}/scripts/status.py"` |

### 5.1 TUI 面板的補法（母版新規則）

上游的 TUI 面板（`hooks/views/pane.tsx`、`hooks/review/deck.ts`、`hooks/sign.ts`）在 mcode **畫不出來**，
但它承載的事實都要有對應物。母版的做法：

| 上游面板 | mcode 的對應物 | 資料來源 |
| --- | --- | --- |
| 進度面板（階段、模組、證明裁決、下一步） | `PANEL.html` | `scripts/render_panel.py`，資料層沿用 `build_report.py` |
| 審核甲板（規則卡、裁決） | `REVIEW_DECK.html` ＋ `ask_user` 問卷 | `BUSINESS_RULES.md`、`RULE_REVIEWS.json` |
| 簽核對話框（裁決、要人簽的事） | `SIGNOFF.html` ＋ `VERIFICATION.md` 的簽核區塊 | `VERIFICATION.json` |
| fleet（哪些代理在跑、共用失敗） | `PANEL.html` 的 fleet 區塊 | `scripts/fleet.py` 從 runtime 事件累積的 `analysis/.fleet.json` |

規則：

- **頁面不是行為。** 面板只是把同一份事實攤開來看；裁決仍然由人給（`ask_user`）、簽核仍然寫在
  `VERIFICATION.md`、計畫仍然要人在 brief 上簽。面板永遠不代替人做決定。
- **不虛構事件。** mcode 給的 hook 事件只有 `SubagentStart`／`SubagentStop`／`PostToolUse`，
  沒有上游的 `tool.call`／`turn.complete`。fleet 因此用「代理的開始與結束、最後一句話、
  失敗的 `task` 呼叫」重建，不假裝知道上游面板知道的每件事。
- **狀態放工作區。** fleet 狀態寫在 `<workspace>/analysis/.fleet.json`（與其他產物同一處），
  不寫進唯讀的套件目錄。
- **快照語意。** 面板是算圖當下的一份快照；mcode 的頁面不會自己輪詢，重跑一次 render 就更新。

- manifest 的 `skills[]` 與 `agents[]` **必須列出全部 13 + 8 個檔案**；漏一個功能就少一個。
- `author` 欄寫「ported to MiniMax Code」；`description` 與 `exampleQueries` 用
  `code-modernization:` 前綴（mcode 有 plugin namespace）。
- 遙測已移除：套件裡**不得**出現 `scripts/telemetry.py`／`telemetry.sh`。

---

## 6. mcode 專屬禁用 token

根目錄規格 §7 的基線之外，mcode 版另加：

```
MiniMax Code   mcode   MINIMAX
```

**但有四處必要的例外**（母版散文只說「the agent」是一般原則，這裡是它的例外清單）：

1. `skills/modernize-preflight/SKILL.md` 的權限檢查段可以出現 `permission.json`、
   `/permission status`、`MINIMAX_DATA_DIR`：那一段要教使用者改哪一個檔案，寫不出實際檔名
   等於沒寫。
2. Fan-out 段落可以出現 `MiniMax Code has no Workflow tool`：根規格 §2 規則 9 明講 runtime
   差異寫在 Fan-out 區塊。
3. `scripts/` 可以讀 `MINIMAX_PROJECT_DIR`：那是 runtime 注入的環境變數名，腳本要靠它找
   工作目錄。（`MINIMAX_DATA_DIR` 不需要。）
4. 套件的 `README.md` 可以指名 MiniMax Code：那份文件是給這個 runtime 的使用者看的。

以上之外的任何地方，出現這些 token 都算違規。

---

## 7. 檢查清單

```sh
cd MiniMaxCode/code-modernization
python3 -m py_compile scripts/*.py
python3 -c "import json;json.load(open('.minimax-plugin/plugin.json'))"
grep -rn "CLAUDE_\|AskUserQuestion\|TodoWrite\|subagent_type\|slash command" skills agents hooks scripts assets
grep -rn "MiniMax Code\|\bmcode\b\|MINIMAX" skills agents hooks scripts assets
```

第二條 grep 只應命中 §6 列出的四處例外；逐條確認是例外而不是漏網。

外加：

- 13 個 `skills/<name>/SKILL.md` 的 frontmatter `name` 與目錄同名、`description` 非空。
- 8 個 `agents/<name>.md` 的 `tools` 全是小寫原生名、不含 `task`。
- manifest 的 `skills[]`（13）、`agents[]`（8）、`hooks[]`（1）齊全。
- `hooks/hooks.json` 可解析，且只有 `type: "command"` 的 handler（6 個）。
- 面板可跑：在有 `analysis/<system>/` 的工作區執行
  `python3 scripts/render_panel.py all --system <name> --workspace .`，
  產生 `PANEL.html`／`REVIEW_DECK.html`／`SIGNOFF.html`，且頁面能開、console 無錯誤。
- fleet 事件能累積：餵 `scripts/fleet.py` 一組 `SubagentStart`／`SubagentStop`／`PostToolUse`
  的 JSON，`analysis/.fleet.json` 應出現對應的代理列。
- 在 mcode 內確認：13 個技能可被 `skill` 工具載入、x-ray、狀態列與 fleet 三個 hook 生效。
