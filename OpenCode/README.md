# OpenCode 移植

`code-modernization/` 是 **OpenCode V2**（`opencode.ai/v2`，本機驗證於 `opencode v2.2.5`）可用的移植版，
以 `MiniMaxCode/code-modernization/` 為母版。

OpenCode 內建這套工作流需要的三樣東西，所以**不需要 pi 式的 extension**：

| 母版（mcode） | OpenCode V2 對應 |
| --- | --- |
| Skill `code-modernization:<name>`，用 `skill` 工具載入 | 同樣用 `skill` 工具載入，以 **ID** 呼叫（`skills/<name>/SKILL.md` → id `<name>`）；訊息裡 `@<name>` 提及也會載入，其後文字就是參數 |
| `ask_user` 問卷工具 | 內建 `question` 工具（維持母版的程序規則：每次至多 4 題、每題至多 4 選項、可自由輸入） |
| `task` 工具（`agent_name`） | 內建 `subagent` 工具（`agent: "<name>"`）；8 個代理照 OpenCode 代理檔發現 |
| `hooks/hooks.json`（x-ray、狀態列） | 套件內 server plugin（`plugin/index.ts`）：tool `execute.after` hook 跑 x-ray、session `prompt` hook 跑狀態列並以 session instruction entry 注入 |
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

### 3. 確認

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

最終端到端檢查（花一次最小的 model 呼叫）：在該 session 送一則訊息「Use the shell tool to run
exactly: `echo ROOT=$CODE_MODERNIZATION_ROOT`」，回覆應是套件根目錄——這同時驗證了 plugin 的
shell 環境變數 hook。plugin 載入失敗不會弄壞 session（hook 全部 fail open），但可在
`~/.local/share/opencode/log/` 的 opencode.log 裡看到 plugin 錯誤；技能與代理的發現問題則以
「技能/代理不存在」的形式出現。

不用時移除：刪掉設定檔那兩行、移除 agents 目錄裡的連結即可。

## 與母版的檔案差異

- `skills/`、`agents/`：整檔改寫（格式、工具名、引用形式），見 `PORTING-SPEC.md` §3–§5。
- `plugin/index.ts`：新檔，取代母版的 `hooks/hooks.json`（套件不含 `hooks/`、`.minimax-plugin/`、
  `CHANGELOG.md`）。
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

## 檢查（移植規格 §9）

```sh
cd OpenCode/code-modernization
python3 -m py_compile scripts/*.py
grep -rn "PLUGIN_ROOT\|CLAUDE_\|AskUserQuestion\|TodoWrite\|subagent_type\|MiniMax Code\|mcode\|code-modernization:\|ask_user\|agent_name\|permission.json\|MINIMAX_DATA\|/permission status\|slash command" skills agents plugin README.md   # 必須零結果
grep -rn '\bbash\b' skills agents plugin README.md | grep -v '\.sh'                                        # 工具語境必須已改 shell
```
