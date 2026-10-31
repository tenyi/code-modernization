# pi 移植

`code-modernization/` 是 **pi**（`@earendil-works/pi-coding-agent`）可用的移植版，以
`MiniMaxCode/code-modernization/` 為母版。

與其他移植不同，pi 版**多了一個 extension**：pi 內建沒有子代理、沒有問卷工具、沒有 hook，
而這套工作流三樣都要用。`extensions/code-modernization.ts` 補上：

| pi 缺什麼 | extension 提供 | 對應母版的什麼 |
| --- | --- | --- |
| 沒有子代理 | `task` 工具：以獨立 pi 子行程跑一個專用代理，上下文互相隔離 | mcode 的 `task` 工具 |
| 沒有問卷 | `ask_user` 工具：1–4 題、每題 2–4 選項、可自由輸入、可複選 | mcode 的 `ask_user` 工具 |
| 沒有 hook | x-ray（讀取舊程式碼後附加分析筆記）、狀態列（每次提問注入現況與下一步） | `hooks/hooks.json` 的兩支 hook |

extension 另外匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到套件裡的 `scripts/` 與 `assets/`。

其餘部分與母版一一對應：

- 13 個技能在 `skills/<name>/SKILL.md`，pi 原生 Agent Skills 格式，執行時是 `/skill:<name>`。
- 8 個專用代理在 `agents/<name>.md`，pi 代理 frontmatter 格式（`tools` 用 pi 的原生工具名）。
- `scripts/`、`assets/`、`LICENSE`、`icon*.png` 與母版相同（`build_report.py`、`proof_pack.py` 的
  next-step 字串改為 pi 的 `/skill:` 形式）。

轉換規格見 [`PORTING-SPEC.md`](PORTING-SPEC.md)。

## 安裝到 pi

pi 版是一個 pi package：`Pi/code-modernization/` 裡有 `package.json`（含 `pi` manifest）、
`skills/`、`agents/`、`extensions/`、`scripts/`、`assets/`。一次安裝，技能與工具一起生效。

### 需求

```sh
pi --version        # pi（@earendil-works/pi-coding-agent）
python3 --version   # 報告、證明包、規則渲染都是 Python
```

沒有 `python3` 時技能仍會執行，但不會產生報告與證明檔 —— agent 會用一行字說明，而不是失敗。

### 安裝（推薦）

```sh
cd /path/to/mcode-port-work      # 本倉庫根目錄
pi install ./Pi/code-modernization
pi list                           # 確認：應該看到 .../Pi/code-modernization
```

這會在 `~/.pi/agent/settings.json` 的 `packages` 陣列加一筆（相對於 settings 檔的路徑）：

```json
{
  "packages": [".../Pi/code-modernization"]
}
```

接著在要分析的工作目錄啟動 pi：

- 13 個技能以 `/skill:modernize`…`/skill:modernize-verify` 的形式出現；
- extension 同時提供 `task`（子代理）與 `ask_user`（問卷）兩個工具；
- **腳本不用另外設定**：extension 匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到 `scripts/` 與 `assets/`。

### 其他安裝方式

```sh
# a) 只試用一次，不寫入任何設定
pi -e ./Pi/code-modernization
pi --skill ./Pi/code-modernization/skills \
   --extension ./Pi/code-modernization/extensions/code-modernization.ts

# b) 專案範圍：寫入專案的 .pi/settings.json（載入前需先信任該專案）
pi install -l ./Pi/code-modernization

# c) 手動安裝（不經 package manager）：整包搬過去，settings 指到套件裡的 extension
mkdir -p ~/.pi/agent/packages
cp -R Pi/code-modernization ~/.pi/agent/packages/
```

```json
{
  "extensions": ["~/.pi/agent/packages/code-modernization/extensions/code-modernization.ts"],
  "skills": ["~/.pi/agent/packages/code-modernization/skills"]
}
```

> 手動安裝時要**整包搬過去**：extension 靠自己的位置往上找套件根目錄（找得到 `scripts/build_report.py`
> 的那一層），把 extension 單獨複製到 `~/.pi/agent/extensions/` 會讓它找不到 `scripts/`。
> 真要分開放，就設 `CODE_MODERNIZATION_ROOT` 指向套件根目錄。

### 常用維護指令

```sh
pi list                              # 已安裝的套件
pi remove ./Pi/code-modernization    # 移除（會從 settings.json 刪掉那一筆）
pi update --extensions               # 對遠端來源的套件更新版本
pi config                            # 逐一啟用/停用套件裡的資源（技能、extension）
```

本倉庫是**鏡像**，pi 對本地路徑套件是「載入、不複製」：改完 `Pi/code-modernization/` 之後，
在 pi 裡 `/reload`（或重開 session）就會生效，不必重新 `pi install`。

### 驗證

```sh
cd /tmp && pi --no-session -p "列出你能看到的、以 modernize 開頭的技能名"
```

應該列出 13 個技能名。再問一次「列出你不能直接讀檔但可以呼叫的工具」，
應該看得到 `task` 與 `ask_user`。

## 同步回來源目錄

本倉庫是鏡像。pi 沒有「plugin 目錄」這種固定來源，實際生效的是：

- `~/.pi/agent/skills/`（技能）、`~/.pi/agent/extensions/`（extension），或
- `~/.pi/agent/settings.json` 裡的 `packages` / `skills` / `extensions` 設定。

所以改完這裡，要 `pi install`（或把 `skills/`、`extensions/` 複製過去）才會生效。
