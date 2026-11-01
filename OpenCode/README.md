# OpenCode 移植

`code-modernization/` 是 **OpenCode V2**（`opencode.ai/v2`，本機驗證於 `opencode v2.2.5`）可用的移植版，
以 `MiniMaxCode/code-modernization/` 為母版。

OpenCode 內建這套工作流需要的三樣東西，所以**不需要 pi 式的 extension**；腳本化 fan-out 則由套件自己的 server plugin 補上：

| 母版（mcode） | OpenCode V2 對應 |
| --- | --- |
| Skill `code-modernization:<name>`，用 `skill` 工具載入 | 同樣用 `skill` 工具載入，以 **ID** 呼叫（`skills/<name>/SKILL.md` → id `<name>`）；訊息裡 `@<name>` 提及也會載入，其後文字就是參數 |
| `ask_user` 問卷工具 | 內建 `question` 工具（維持母版的程序規則：每次至多 4 題、每題至多 4 選項、可自由輸入） |
| `task` 工具（`agent_name`） | 內建 `subagent` 工具（`agent: "<name>"`）；8 個代理照 OpenCode 代理檔發現 |
| `hooks/hooks.json`（x-ray、狀態列） | 套件內 server plugin（`plugin/index.ts`）：tool `execute.after` hook 跑 x-ray、session `prompt` hook 跑狀態列並以 session instruction entry 注入 |
| 沒有腳本化 workflow（母版用多次 `task`） | 套件 plugin 註冊 **`workflow`** 工具：上游六支 `workflows/*.js` 原樣跑，`agent()` 換成 OpenCode 子 session（`parentID`＋代理），答案依腳本給的 schema 解析；工具不可用時技能仍走手動 `subagent` 批次 |
| `hooks/` 的 TUI 面板（進度面板、規則審核甲板、簽核、狀態列） | 同一條 `plugins` 路徑的 **TUI part**（`plugin/tui.tsx`）：`/modernize-panel`、`/modernize-review-pane`、`/modernize-sign` 三個真終端面板，輸入框下一行常駐狀態列 |
| `${PLUGIN_ROOT}` | 套件 plugin 以 `$CODE_MODERNIZATION_ROOT` 匯出到每支 `shell` 命令的環境變數 |
| 代理 frontmatter `tools: [read, glob, grep, bash]` | `mode: subagent` + `permissions` 封閉清單（deny `*`，再 allow read/glob/grep/shell/external_directory；可寫代理再加 edit）。V2 禁止 agent 檔用 `tools` 欄位 |
| `~/.minimax/permission.json` 權限段落 | `opencode.json(c)` 的 `permissions` 陣列（`{action, resource, effect}`，最後吻合者勝出；`deny` 永遠強制、無可繞過模式） |

流程、關卡、產物與證明與母版逐段相同；只換 runtime 名詞。轉換規格見
[`OpenCode/PORTING-SPEC.md`](PORTING-SPEC.md)。

## 安裝

OpenCode 沒有 plugin package manager：技能靠設定檔的 `skills` 陣列、plugin 靠 `plugins` 陣列、
代理靠 agents 目錄被發現。**原則同 pi：用在哪個專案，就設在那個專案**（專案的 `opencode.json(c)`），
要全域生效才寫 `~/.config/opencode/opencode.json(c)`。

```sh
# 前置：python3 要在 PATH 上（報告、證明、規則渲染是 Python；缺了技能仍會跑，只是產物不產出）
python3 --version
```

### 1. 技能與 plugin（設定檔兩行）

在專案根的 `opencode.json(c)`（或全域設定）加入——路徑換成你放本倉庫的位置，絕對路徑最省事
（`skills` 的相對路徑從 OpenCode 的工作目錄解析，`plugins` 的從設定檔本身解析）：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["/path/to/mcode-port-work/OpenCode/code-modernization/skills"],
  "plugins": ["/path/to/mcode-port-work/OpenCode/code-modernization/plugin"]
}
```

改完設定重開 session（或重啟 OpenCode）生效。本倉庫是鏡像、OpenCode 是「載入不複製」，
所以改完檔案內容重開 session 即生效；增減技能目錄才需要動設定。

### 2. 代理（複製或連結 8 個檔）

代理以**檔案位置**被發現，沒有設定鍵。連結（或複製）到全域 `~/.config/opencode/agents/`，
或專案的 `.opencode/agents/`：

```sh
# 專案範圍
mkdir -p /path/to/your/project/.opencode/agents
ln -s /path/to/mcode-port-work/OpenCode/code-modernization/agents/*.md \
      /path/to/your/project/.opencode/agents/
```

8 個代理（`legacy-analyst`、`business-rules-extractor`、`architecture-critic`、`security-auditor`、
`version-delta-analyst`、`scaffolder`、`test-engineer`、`uplift-migrator`）即可以裸名被 `subagent`
工具呼叫；技能內文已照此改寫。

### 3. 面板（TUI part，同一個 plugin 目錄）

`plugins` 指到 `.../plugin` 目錄時，OpenCode 會同時載入 server part（`index.ts`）與 TUI part
（`tui.tsx`）：本地 plugin 目錄沒有 `package.json` 時，根目錄的 `index` 當 server、`tui` 當 TUI。
不用第二行設定，也不用自己安裝 `@opencode/plugin/tui`（runtime 解析）。開一個 session 後可用：

| 指令 | 做什麼 |
| --- | --- |
| `/modernize-panel` | 進度面板：階段、estate map、子代理 fleet、下一個步驟 |
| `/modernize-review-pane [flagged\|p0\|all] [filter]` | 規則審核甲板；預設 `flagged`，可帶規則文字過濾 |
| `/modernize-sign [name]` | 簽核；帶名字直接簽，否則開對話框 |

面板鍵：`1`–`4` 選畫面當下的按鈕（顯示下一步／簽署 brief／審核規則／停止本輪）、`r` 重讀、`esc` 關閉。
甲板：`1` confirmed、`2` wrong、`3` discuss、`4` 上一條、`5` 下一條、`6` 顯示來源、`7` 復原、
`0` 或 `esc` 寫入並關閉。簽核：`enter` 簽、`ctrl+t` 切換核准範圍、`esc` 取消。三個指令也進
command palette（搜尋 “modernization”）。

面板的 Session 區塊跟著工作走：這一輪從哪個技能開始（`/modernize-map` 這樣的名稱）、正在跑的
工具呼叫、跑完的呼叫、還在動的子代理。讀寫 `legacy/` 底下的檔案會點亮 estate map 上對應的磚
（4 秒褪色，褪色期間地圖每 250 ms 重畫一次）。幾個代理同時撞到同一個成因時，面板會跳出一次
toast 說明——同一個成因橫跨多個代理，通常該修的是流程（playbook），不是每個代理。

這些事實是從事件來的（`session.tool.*`、`session.inbox.enqueued`、`session.skill.activated`），
不是從 hook：OpenCode 的 TUI part 沒有 hook 可掛，只能訂閱事件。事件的形狀與面板的對應見
`PORTING-SPEC.md` §6.7。

選項放工作區的 `.code-modernization/panel.json`（沒有就用預設；這是工作區狀態，不隨套件出貨）：

```json
{
  "system": "",
  "track": "auto",
  "panel": "auto",
  "xray": true,
  "commandPrefix": "@modernize-",
  "legacyDir": "legacy"
}
```

`track` 可為 `auto`／`transform`／`uplift`／`reimagine`。`panel` 與 `xray` 只為與母版設定對齊而讀入：
OpenCode 沒有「回合開始自動開面板」的 hook，面板一律由指令開；x-ray 由 server plugin 無條件跑。

### 4. 確認

在專案目錄跑（以下都實際驗證過）：

```sh
cd /path/to/your/project

# 代理：8 個都出現在清單裡（其餘是內建代理）
opencode debug agents --standalone | grep -c '"id": "modernize\|architecture-critic\|business-rules-extractor\|legacy-analyst\|scaffolder\|security-auditor\|test-engineer\|uplift-migrator\|version-delta-analyst'

# 技能與 plugin：需要一個有 session 的 server（location 服務在第一個 session 建立時才啟動，
# 所以純靜態查會得到空清單）。起一個 server、建 session，再查：
OPENCODE_PASSWORD=x opencode serve --port 8478 &        # 另一個終端機，或背景執行
export OPENCODE_PASSWORD=x
opencode api --server http://127.0.0.1:8478 post /api/session -d '{"directory":"'$PWD'"}'
opencode api --server http://127.0.0.1:8478 get /api/skill   --param 'location[directory]='$PWD   # 應有 13 個 modernize*
opencode api --server http://127.0.0.1:8478 get /api/plugin  --param 'location[directory]='$PWD   # 應有 code-modernization | active
```

在互動式 TUI 裡（同一專案另開 `opencode`）：輸入 `/` 應看到 `modernize-panel`、`modernize-review-pane`、
`modernize-sign`；`/modernize-panel` 應開出進度面板（沒有 `analysis/` 的專案要顯示 “nothing to suggest”
而不是報錯），`esc` 可關；輸入框下一行在沒有現代化產物時應為空。TUI part 的載入錯誤也寫在
`~/.local/share/opencode/log/` 的 opencode.log，可搜 `code-modernization.tui`。

最終端到端檢查（花一次最小的 model 呼叫）：在該 session 送一則訊息「Use the shell tool to run
exactly: `echo ROOT=$CODE_MODERNIZATION_ROOT`」，回覆應是套件根目錄——這同時驗證了 plugin 的
shell 環境變數 hook。再送一則「Call the `workflow` tool with `name: "does-not-exist"`」，回覆應列出
六個 workflow 名稱（`modernize-extract-rules-mine` …），這驗證了工具註冊；真正跑一支 workflow 會
建立子 session，花費等同一次多代理 fan-out，先確認 `~/.local/share/opencode/log/` 沒有 plugin
載入錯誤再跑。plugin 載入失敗不會弄壞 session（hook 全部 fail open），但可在
`~/.local/share/opencode/log/` 的 opencode.log 裡看到 plugin 錯誤；技能與代理的發現問題則以
「技能/代理不存在」的形式出現。

面板的活事實也要看一次真的回合才有意義：讓代理讀一個 `legacy/` 底下的檔案（例如「讀
`legacy/<system>/<某個檔案>`，然後說出它的第一行」），面板的 Session 區塊應該出現那筆讀取呼叫，
estate map 上對應的磚會亮起來（4 秒後褪掉），x-ray 計數會 +1（該檔案在 `analysis/<system>/`
有分析時）。要看原始事件，用 `GET /api/event` 的 SSE：會看到 `session.tool.input.started`、
`session.tool.called`、`session.tool.success`、`session.tool.failed`、`session.skill.activated`。

不用時移除：刪掉設定檔那兩行、移除 agents 目錄裡的連結即可。面板沒有額外設定；工作區的
`.code-modernization/`（面板選項、workflow journal）是執行期狀態，可自行刪除。

## 與母版的檔案差異

- `skills/`、`agents/`：整檔改寫（格式、工具名、引用形式），見 `PORTING-SPEC.md` §3–§5。
- `plugin/index.ts`：新檔，取代母版的 `hooks/hooks.json`（套件不含 `hooks/`、`.minimax-plugin/`、
  `CHANGELOG.md`）；同一個 plugin 另外註冊 `workflow` 工具。
- `plugin/workflow/`：新檔，`loader.ts`／`runtime.ts` 與 pi 版同源，`host.ts` 把 `agent()` 綁到
  OpenCode 子 session，`tool.ts` 註冊工具。
- `plugin/tui.tsx`：新檔，TUI part；`plugin/tui/` 是新檔，面板控制器、選項與 pi 版沿用的
  reader／map／review／fleet 純模組，`views/` 把上游的 ANSI 行轉成 OpenTUI span。
- `workflows/`：六支上游腳本，從 `Pi/` 版（已換成裸代理名與小寫工具名）再換 `@` 技能引用；
  母版沒有這個目錄，所以同步時要排除、不要被 `--delete` 刪掉。
- `scripts/`：與母版逐位元相同，**只有兩處字串**：`build_report.py` 的 Next step 從
  `code-modernization:X …` 改成 `@X …`（`status.py` 的狀態列複用同一函式，等於同步改了）；
  `proof_pack.py` 的 trace_problem 改成 `@modernize-extract-rules`。
- `assets/`、`LICENSE`、`icon*.png`：與母版相同。
- 套件 `README.md`：安裝、hook、權限段落改成 OpenCode 形式。

## 同步（母版 → 本移植）

只單向同步非改寫檔；改寫過的 `skills/`、`agents/`、`README.md`、`plugin/` 不動。同步後要把
兩處腳本字串再改回來（rsync 會覆蓋）：

```sh
cd /path/to/mcode-port-work
rsync -a --delete \
  --exclude '__pycache__' --exclude '.DS_Store' \
  --exclude '.minimax-plugin/' --exclude 'hooks/' --exclude 'CHANGELOG.md' \
  --exclude 'skills/' --exclude 'agents/' --exclude 'README.md' --exclude 'plugin/' \
  --exclude 'workflows/' \
  MiniMaxCode/code-modernization/ OpenCode/code-modernization/

# 重新套用兩處字串（與 PORTING-SPEC.md §8 一致）
python3 - <<'EOF'
import pathlib
p = pathlib.Path("OpenCode/code-modernization/scripts/build_report.py")
s = p.read_text()
s = s.replace('"code-modernization:%s %s" % (command, system)', '"@%s %s" % (command, system)')
p.write_text(s)
p = pathlib.Path("OpenCode/code-modernization/scripts/proof_pack.py")
s = p.read_text()
s = s.replace("run the skill code-modernization:modernize-extract-rules %s", "run the skill @modernize-extract-rules %s")
p.write_text(s)
EOF
```

母版本身是鏡像，先從 `~/.minimax/plugins/code-modernization/` 同步母版再跑上面這段（見根 README）。

`workflows/` 不在母版裡：它是由 `Claude/code-modernization/workflows/*.js`（經 pi 版換成裸代理名與
小寫工具名）再套 `@X` 技能引用而來。上游 workflows 更新時，重跑：

```sh
cp Pi/code-modernization/workflows/*.js OpenCode/code-modernization/workflows/
python3 - <<'EOF'
import pathlib
for p in pathlib.Path("OpenCode/code-modernization/workflows").glob("*.js"):
    s = p.read_text()
    s = s.replace("/skill:", "@").replace("Workflow tool", "workflow tool").replace("Use Bash ONLY", "Use shell ONLY")
    p.write_text(s)
EOF
```

## 檢查（移植規格 §9）

```sh
cd OpenCode/code-modernization
python3 -m py_compile scripts/*.py
ls workflows/*.js | wc -l                                                                    # 應為 6
grep -rn "PLUGIN_ROOT\|CLAUDE_\|AskUserQuestion\|TodoWrite\|subagent_type\|MiniMax Code\|mcode\|code-modernization:\|ask_user\|agent_name\|permission.json\|MINIMAX_DATA\|/permission status\|slash command\|Workflow tool" skills agents plugin README.md workflows   # 必須零結果
grep -rn '\bbash\b' skills agents plugin README.md workflows | grep -v '\.sh' | grep -v "bash: 'Shell'"   # 工具語境必須已改 shell（`bash: 'Shell'` 是副檔名標籤）
bun build plugin/index.ts plugin/workflow/tool.ts --target=node --external '@opencode/plugin' --outdir /tmp/cm-check   # 語法與相對匯入
bun build plugin/tui.tsx --target=node --external '@opencode/plugin/tui' --external 'solid-js' --external '@opentui/solid' --outdir /tmp/cm-check-tui   # TUI part 同上
```
