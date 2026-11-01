# pi 移植

`code-modernization/` 是 **pi**（`@earendil-works/pi-coding-agent`）可用的移植版，以
`MiniMaxCode/code-modernization/` 為母版、**以 `Claude/code-modernization/` 為事實來源**。

與其他移植不同，pi 版**多了一個 extension**：pi 內建沒有子代理、沒有問卷工具、沒有腳本化
workflow、沒有 hook，而這套工作流都要用。`extensions/code-modernization.ts` 與 `hooks/` 補上：

| pi 缺什麼 | extension 提供 | 對應上游的什麼 |
| --- | --- | --- |
| 沒有子代理 | `task` 工具：以獨立 pi 子行程跑一個專用代理，上下文互相隔離 | `Task` 工具 |
| 沒有腳本化 workflow | `workflow` 工具：**上游的六支 `workflows/*.js` 原樣跑**，runtime（`agent()`／`parallel()`／`pipeline()`／`log()`／`budget`）換成 pi 的子代理，答案依腳本給的 schema 解析 | `Workflow` 工具與 `workflows/*.js` |
| 沒有問卷 | `ask_user` 工具：1–4 題、每題 2–4 選項、可自由輸入、可複選 | `AskUserQuestion` 工具 |
| 沒有 hook | x-ray（讀取舊程式碼後附加分析筆記）、狀態列（每次提問注入現況與下一步）、fleet（子代理的開關） | `hooks/hooks.json` 的 hook 與 `hooks/fleet/` |
| 沒有 TUI 面板 | **終端裡的真面板**：`/modernize-panel`（進度面板＋estate map）、`/modernize-review-pane`（規則審核甲板）、`/modernize-sign`（簽核對話框），另有編輯器上方的常駐狀態列 | `hooks/views/pane.tsx`、`views/deck.tsx`、`hooks/sign.ts` |

pi 自己是終端程式，所以面板**不需要退化成頁面**——它直接畫在終端裡，這是 pi 版與其他移植
最大的不同。

extension 另外匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到套件裡的 `scripts/` 與 `assets/`。

其餘部分與母版一一對應：

- 13 個技能在 `skills/<name>/SKILL.md`，pi 原生 Agent Skills 格式，執行時是 `/skill:<name>`。
- 8 個專用代理在 `agents/<name>.md`，pi 代理 frontmatter 格式（`tools` 用 pi 的原生工具名）。
- `scripts/`、`assets/`、`LICENSE`、`icon*.png` 與母版相同（`build_report.py`、`proof_pack.py` 的
  next-step 字串改為 pi 的 `/skill:` 形式）。

轉換規格見 [`PORTING-SPEC.md`](PORTING-SPEC.md)。

## 安裝到 pi

pi 版是一個 pi package：`Pi/code-modernization/` 裡有 `package.json`（含 `pi` manifest）、
`skills/`、`agents/`、`extensions/`、`hooks/`、`workflows/`、`scripts/`、`assets/`。一次安裝，
技能與工具一起生效。

### 需求

```sh
pi --version        # pi（@earendil-works/pi-coding-agent）
python3 --version   # 報告、證明包、規則渲染都是 Python
```

沒有 `python3` 時技能仍會執行，但不會產生報告與證明檔 —— agent 會用一行字說明，而不是失敗。

### 安裝（推薦：裝在專案下）

**用在哪個專案，就裝在那個專案。** 不動全域設定，也不需要記得解除安裝。

```sh
# 1. 需求：pi、python3
pi --version
python3 --version

# 2. 在「要用這套工作流的專案」裡安裝（寫入 <專案>/.pi/settings.json）
cd /path/to/your/project
pi install -l /path/to/mcode-port-work/Pi/code-modernization

# 3. 第一次在該專案啟動 pi 時，pi 會問要不要信任這個專案 —— 信任後套件才會載入
#    （非互動模式用 pi -a 單次信任）
pi -a

# 4. 確認
cat .pi/settings.json      # 會有 "packages": [".../Pi/code-modernization"]
```

裝好後在該專案啟動 pi：

- 13 個技能以 `/skill:modernize`…`/skill:modernize-verify` 的形式出現；
- extension 同時提供 `task`（子代理）、`workflow`（腳本化 fan-out）與 `ask_user`（問卷）三個工具；
- 三個面板命令可用：`/modernize-panel`（進度面板）、`/modernize-review-pane`（規則審核甲板）、
  `/modernize-sign`（簽核對話框）；
- **腳本不用另外設定**：extension 匯出 `$CODE_MODERNIZATION_ROOT`，技能用它找到 `scripts/` 與 `assets/`。

不用的時候移除（只影響那個專案）：

```sh
cd /path/to/your/project
pi remove -l --approve /path/to/mcode-port-work/Pi/code-modernization
```

### 其他安裝方式

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
pi list                              # 已安裝的套件（只列 user scope；專案範圍的看該專案的 .pi/settings.json）
pi remove -l --approve <source>      # 移除專案範圍的套件（只影響該專案；改專案設定需要信任）
pi remove <source>                   # 移除全域套件
pi update --extensions               # 對遠端來源的套件更新版本
pi config                            # 逐一啟用/停用套件裡的資源（技能、extension）
```

本倉庫是**鏡像**，pi 對本地路徑套件是「載入、不複製」：改完 `Pi/code-modernization/` 之後，
在 pi 裡 `/reload`（或重開 session）就會生效，不必重新 `pi install`。

### 驗證

```sh
cd /path/to/your/project
pi -a --no-session -p "列出你能看到的、以 modernize 開頭的技能名"
```

應該列出 13 個技能名。再問一次「列出你不能直接讀檔但可以呼叫的工具」，
應該看得到 `task`、`workflow` 與 `ask_user`。

## 同步回來源目錄

本倉庫是鏡像。pi 沒有「plugin 目錄」這種固定來源，實際生效的是：

- 專案範圍（推薦）：該專案的 `.pi/settings.json` 裡的 `packages` —— `pi install -l <path>` 寫入；
- 全域：`~/.pi/agent/settings.json` 的 `packages`，或 `~/.pi/agent/skills/` + `~/.pi/agent/extensions/`。

所以改完這裡，裝在哪裡就在哪裡 `/reload`（或重開 session）即生效，不必重新 `pi install`。
以專案範圍安裝為例：

```sh
cd /path/to/your/project
pi install -l /path/to/mcode-port-work/Pi/code-modernization   # 裝進該專案
# ... 改完 Pi/code-modernization/ 後，在該專案的 pi 裡 /reload
pi remove -l --approve /path/to/mcode-port-work/Pi/code-modernization     # 用完移除
```
