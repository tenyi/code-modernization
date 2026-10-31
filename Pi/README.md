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

## 安裝與試用

```sh
pi install /path/to/Pi/code-modernization     # 安裝成 pi package
pi --skill ./skills --extension ./extensions/code-modernization.ts   # 直接試用
```

## 同步回來源目錄

本倉庫是鏡像。pi 沒有「plugin 目錄」這種固定來源，實際生效的是：

- `~/.pi/agent/skills/`（技能）、`~/.pi/agent/extensions/`（extension），或
- `~/.pi/agent/settings.json` 裡的 `packages` / `skills` / `extensions` 設定。

所以改完這裡，要 `pi install`（或把 `skills/`、`extensions/` 複製過去）才會生效。
