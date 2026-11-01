# Antigravity 移植規格 — `code-modernization`

本文件是 **MiniMax Code → Antigravity** 的轉換規格。Antigravity 走 Gemini CLI 的技能目錄慣例：
技能放在 `~/.gemini/skills/code-modernization/`，由 Antigravity 裡的模型（Gemini 3.8 Flash）使用。

共用規則（不可妥協的規則、技能檔骨架、Fan-out 契約、代理規則、腳本清單、禁用 token 基線）見
根目錄 [`../PORTING-SPEC.md`](../PORTING-SPEC.md)；本文件只寫 Antigravity 專屬的部分。

- 母版：`MiniMaxCode/code-modernization/`
- 目標套件：`Antigravity/code-modernization/`
- 安裝位置：`~/.gemini/skills/code-modernization/`

---

## 1. Antigravity 實際提供什麼（mcode → 對應）

| mcode（母版） | Antigravity 對應 | 備註 |
| --- | --- | --- |
| Skill `code-modernization:<name>`，用 `skill` 工具載入 | 同樣用 `skill` 工具，但**裸名** `modernize-x` | Antigravity 沒有 plugin namespace；**不要寫 `code-modernization:` 前綴** |
| 給人執行的指令字串 `code-modernization:X <args>` | `modernize-x <args>` | 例如 `modernize-preflight billing --source /work/billing` |
| `ask_user` 問卷（1–4 題、每題 2–4 選項） | **`ask_question`** 工具（pop-up） | 散文裡「a pop-up」的說法保留（它確實是疊層問卷） |
| `task` 工具（`agent_name`） | **`invoke_subagent`**：`Role`（專責角色）、`TypeName`（`'self'` 或 `'inherit'`）、`description`、`prompt` | 散文裡舉例用 'Legacy Analyst'、'Security Auditor' 這類**角色名**；實際 `Role` 值用代理 id 的 kebab-case（`legacy-analyst`） |
| 沒有 Workflow 工具，fan-out 用多次 `task` | 同樣：多次 `invoke_subagent` | 見 §3 |
| `${PLUGIN_ROOT}` | **`${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}`** | Antigravity 不保證設定 `SKILL_ROOT`，**必須帶 fallback** |
| `${PLUGIN_DATA}` | 無對應 | 不使用 |
| `read`/`write`/`edit`/`bash`/`grep`/`glob` | **`read_file`/`write_file`/`edit_file`/`run_command`**（另有 grep/glob） | 散文裡的工具名要一併改；「Use bash ONLY…」→「Use `run_command` ONLY…」 |
| `todowrite` | 無對應 | 母版未使用 |
| `PostToolUse`(read) → x-ray、`UserPromptSubmit`/`SessionStart` → 狀態列 | **有 hooks**：`hooks/hooks.json`，與母版同樣三個，只把 `${PLUGIN_ROOT}` 換成 `${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}` | 見 §4 |
| `.minimax-plugin/plugin.json` manifest | **無 manifest**（Gemini CLI 技能目錄慣例） | 套件裡不放 manifest |
| `~/.minimax/permission.json`、`/permission status`、ask/auto 模式 | **無對應**：靠 Antigravity 的 workspace guardrails + 檔案系統 `chmod` | 見 §4 |

---

## 2. 技能檔格式

```markdown
---
name: modernize-<name>
description: <與母版同一句，不動>
---

**Invocation.** Load this skill with the `skill` tool, name `modernize-<name>`.
**Arguments.** `<system> [options]`
Bound as: `$system`, `$option`.
**Argument source.** The arguments arrive in the user's message (the text after the skill
name, or a sentence naming the system). When one is missing: ask once with `ask_question`, or
infer it from `analysis/` and state the assumption in one line. Never guess silently.

<母版的程序散文，逐行對應>
```

- **沒有 `**Package files.**` 段**：Antigravity 用 `${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}`
  的 fallback 寫法，散文裡直接寫
  `python3 "${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}/scripts/build_report.py" $system`。
- 根目錄另有一個 **`SKILL.md` 入口**：**繁體中文**說明 + 一張「步驟 → 程序檔」的表格，
  連結寫成 `file:///skills/modernize-<name>/SKILL.md`。這是 Antigravity 技能目錄的慣例，
  **只有這個入口用中文**；13 個流程 Skill 的正文仍是英文。
- 問卷相關散文：`ask_user` → `ask_question`；「ask once with `ask_user`」→「ask once with
  `ask_question`」。

---

## 3. Fan-out 措辭

母版有兩種 Fan-out 段落，**兩種都保留，只換工具名**：

**長版**（母版的 assess、map 用；Antigravity 對應的 assess、map）：

> **Fan-out (Subagents).** The fan-out is done using `invoke_subagent`. One subagent is
> launched with Role naming the specialist (e.g. 'Legacy Analyst', 'Security Auditor') and
> TypeName 'self' or 'inherit', a `description` naming the work item, and a `prompt` that
> carries everything the subagent needs — it sees none of this conversation. Start several
> children in one response (omit `run_in_background`) to run them in parallel; the runtime
> caps how many run at once, so start at most **8** at a time and continue with the next batch
> as results come back. If a call reports a concurrency limit, wait for the running children
> to finish and continue. A subagent returns one final message and nothing is enforced about
> its shape, so the prompt must spell out the JSON to return and say: *Return only this JSON
> object — no prose, no code fences.* Never end the turn while a subagent is still running, and
> collect every result before writing any artifact.

**短版**（母版的 extract-rules、harden、reimagine、uplift 用）：

> **Fan-out (Subagents).** The fan-out is executed with `invoke_subagent`.
> One subagent is launched with Role naming the specialist (e.g. 'Legacy Analyst', 'Security Auditor')
> and TypeName 'self' or 'inherit', with a `prompt` that carries everything the subagent
> needs. Subagents run in background; parallelize up to **8** at a time.
> A subagent returns its findings, so the prompt should explicitly specify the JSON format to return:
> *Return only this JSON object — no prose, no code fences.* Collect results before writing final artifacts.

- `invoke_subagent` 的實際呼叫寫法：`Role: "legacy-analyst", TypeName: "self"`。
- UNTRUSTED 區塊、JSON 契約、合併與記帳規則見根目錄規格 §4（**逐字保留**）。

---

## 4. Hooks 與 legacy 保護

**hooks 是有的**：`hooks/hooks.json` 與母版結構相同，三個 hook、逾時 5 秒，
差別只在路徑變數：

| 事件 | 對應上游 | 呼叫 |
| --- | --- | --- |
| `PostToolUse`（matcher `read`） | `hooks/xray/xray.ts` | `python3 "${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}/scripts/xray.py"` |
| `UserPromptSubmit` | `hooks/reader/progress.ts` | 同上，`scripts/status.py` |
| `SessionStart` | `hooks/reader/progress.ts` | 同上，`scripts/status.py` |

- **但不能假設 Antigravity 會執行 hooks**：README 必須寫明「runtime 不跑 hooks 時就不會被呼叫，
  而且沒有任何技能依賴它們」（母版同款措辭）。散文裡也**不得暗示**狀態列／x-ray 一定會出現。
- 兩支腳本保留在套件裡（失敗即略過，無害），必要時可手動執行。
- **legacy 保護**改由兩層機制承擔：
  1. Antigravity 的 workspace guardrails：寫入只留在 `analysis/` 與 `modernized/`，
     `legacy/<name>/` 視為唯讀。
  2. 檔案系統層的硬保護：`chmod -R a-w legacy/`（工作結束後 `chmod -R u+w legacy/` 還原）。
- `modernize-preflight` 的 Check 7 改寫成「檢查 `legacy/` 是否唯讀 → ✅ 或 ⚠️，**永不 ❌**、
  永不替使用者改設定」，並教使用者下 `chmod -R a-w legacy/`。

---

## 5. 代理檔格式（`agents/<name>.md`）

```markdown
---
name: legacy-analyst
description: <與上游同一句，不動>
tools: [read_file, run_command]
mcpServers: []
skills: []
---
```

- 工具名用 Antigravity/Gemini 的慣例名：`read_file`、`run_command`；
  可寫代理（`scaffolder`、`test-engineer`、`uplift-migrator`）→
  `tools: [read_file, write_file, edit_file, run_command]`。
- `mcpServers: []`、`skills: []` 保留為空陣列。
- 不加 `model`、`effort`、`x-mavis.*`、`hooks`、`permissionMode`。
- 內文只替換工具名、技能引用（`code-modernization:modernize-x` → `modernize-x`）、
  委派引用（`task`/`agent_name` → `invoke_subagent`/`Role`）；行為規則逐字保留。

---

## 6. 套件結構

```
Antigravity/code-modernization/
  SKILL.md                          入口（繁中說明 + 步驟表格）
  agents/<name>.md                  8 個專責角色
  skills/<name>/SKILL.md            13 個流程技能
  hooks/hooks.json                  3 個 hook（路徑用 $SKILL_ROOT fallback）
  scripts/*.py                      10 支，與母版逐位元相同
  assets/report-template.html
  assets/topology-viewer.html
  assets/vendor/mermaid.min.js
```

- **不放** `.minimax-plugin/`（無 manifest）。
- **產物裡的 runtime 名詞要改寫**（母版沿用了 mcode 的 namespace）：
  `assets/topology-viewer.html` 三處 `code-modernization:modernize-map` → **`modernize-map`**
  （Antigravity 用裸名；第 98、120 行是使用者可見的「重跑」指示，第 115 行是註解）。
  `scripts/status.py` 的 `code-modernization: %d systems…` 是**產品標籤，保留**。
- 圖示（`icon.png`/`icon-dark.png`）不在此目錄（Gemini 技能目錄不要求）。
- 來源目錄自帶 git repo（歷史屬於 Antigravity 來源）。

---

## 7. Antigravity 專屬禁用 token

根目錄規格 §7 的基線之外，Antigravity 版另加：

```
code-modernization:（技能／代理的前綴引用）   $PLUGIN_ROOT   ${PLUGIN_DATA}
ask_user   agent_name   permission.json   /permission status   MINIMAX   mcode
```

- 允許保留：`code-modernization` 作為**產品標籤**（例如使用者輸入句「使用 code-modernization 協助…」）、
  README 裡指稱上游的 `Claude Code` 連結與對照表欄名。
- 產物裡指稱代理的 `Claude` → `the agent`（`scripts/proof_pack.py`、`assets/report-template.html`、
  `assets/topology-viewer.html`）。

---

## 8. 檢查清單

```sh
cd Antigravity/code-modernization
python3 -m py_compile scripts/*.py
grep -rn "code-modernization:\|PLUGIN_ROOT\|PLUGIN_DATA\|ask_user\|agent_name\|MiniMax Code\|mcode\|permission.json\|/permission status" skills agents scripts assets SKILL.md README.md
grep -rn "\bClaude\b" scripts assets
```

外加：

- 13 個 `skills/<name>/SKILL.md` 的 frontmatter `name` 與目錄同名、`description` 非空。
- 8 個 `agents/<name>.md` 的 `tools` 是 Antigravity 的工具名。
- 所有腳本呼叫都帶 `${SKILL_ROOT:-$HOME/.gemini/skills/code-modernization}` fallback
  （含 `hooks/hooks.json` 的三支命令）。
- `hooks/hooks.json` 可解析、三個 hook 齊全、命令裡沒有 `${PLUGIN_ROOT}`。
- `assets/topology-viewer.html` 不得殘留 `code-modernization:` 前綴。
- 根 `SKILL.md` 的步驟表格連結指向 13 個存在的程序檔。
- 在 Antigravity 內確認：13 個技能以**裸名**被發現；若 runtime 不支援 hooks，README 有說明。
