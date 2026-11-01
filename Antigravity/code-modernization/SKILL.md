---
name: code-modernization
description: >-
  針對舊有系統 (Legacy Codebase) 提供現代化分析、架構拓撲映射、商業邏輯規則提取 (Given/When/Then)、
  版本升級 (Uplift)、逐步改寫 (Transform) 或架構重構 (Reimagine)，並透過自動化等價測試與證明包 (Proof Pack) 驗證行為一致性。
---

# 程式碼現代化 (Code Modernization)

將代理人對準遺留程式碼庫，即可獲得四大核心產出：
1. **全面理解**：掌握系統架構、相依性與業務規則。
2. **審查計畫**：產出經審核批准的階段性遷移計畫 (Brief)。
3. **現代化程式碼**：按計畫進行同語言升級、分模組改寫或架構重構。
4. **行為等價證明 (Proof)**：嚴謹證明新程式碼與舊系統行為完全一致。

本技能適用於任何程式語言與架構模式，且**嚴格遵守唯讀原則，絕不修改 legacy/ 目錄下的舊系統原始碼**。

---

## 快速開始 (Start Here)

在專案目錄下啟動現代化流程：

```markdown
使用 code-modernization 協助分析並現代化此遺留系統。
```

### 現代化路徑一覽 (The Path)

| 步驟 | 階段 | 功能說明 | 參考子模組 |
| :--- | :--- | :--- | :--- |
| **0** | **Intent (意圖)** | 釐清現代化目標（升級、改寫、重構或僅作理解），寫入 `INTENT.md` | [modernize](file:///skills/modernize/SKILL.md) |
| **1** | **Preflight (預檢)** | 檢查環境就緒度、驗證舊代碼建置能力、排除路徑問題 | [modernize-preflight](file:///skills/modernize-preflight/SKILL.md) |
| **2** | **Assess (評估)** | 清點程式資產、複雜度、技術債與風險，建議適合的遷移模式 | [modernize-assess](file:///skills/modernize-assess/SKILL.md) |
| **3** | **Map (架構映射)** | 解析相依關係、資料流向與進入點，生成互動式 `TOPOLOGY.html` | [modernize-map](file:///skills/modernize-map/SKILL.md) |
| **4** | **Extract Rules (規則萃取)** | 萃取商業邏輯為具備檔案行號證明的 Given/When/Then 規則卡片 | [modernize-extract-rules](file:///skills/modernize-extract-rules/SKILL.md) |
| **4b**| **Review (人工審查)** | 由專家確認或修正爭議規則，確保改寫以正確業務規則為準 | [modernize-review](file:///skills/modernize-review/SKILL.md) |
| **5** | **Brief (遷移提案)** | 產出階段性實施計畫書，經人工核可後才啟動程式撰寫 | [modernize-brief](file:///skills/modernize-brief/SKILL.md) |
| **6** | **Build (實施構建)** | 選擇三種模式之一執行構建（Uplift / Transform / Reimagine） | [uplift](file:///skills/modernize-uplift/SKILL.md) / [transform](file:///skills/modernize-transform/SKILL.md) / [reimagine](file:///skills/modernize-reimagine/SKILL.md) |
| **7** | **Verify (等價證明)** | 獨立重新執行測試、同輸入位元組對比，生成驗證結論 (VERIFICATION.md) | [modernize-verify](file:///skills/modernize-verify/SKILL.md) |
| **8** | **Harden (安全加固)** | 針對舊系統或遷移後系統進行安全掃描並修補漏洞 | [modernize-harden](file:///skills/modernize-harden/SKILL.md) |

隨時可查詢目前進度：`modernize-status <name>`。

---

## 建置模式選擇

根據步驟 2 評估與步驟 5 提案，選擇合適的構建策略：

1. **同語言/框架版本升級 (Uplift)**：
   - 適用場景：如 .NET Framework 4.8 → .NET 8、Java 8 → 17/21、Spring Boot 2 → 3。
   - 特色：保留原始代碼，僅修復破壞性變更 (Breaking Changes)。先進行 Pilot 試點，總結 Playbook 後批量遷移。
2. **跨語言/技術棧分模組改寫 (Transform)**：
   - 適用場景：舊系統持續運行的情況下，一次遷移一個模組（Strangler Fig 模式）。
   - 特色：以舊代碼作為 Oracle，撰寫特徵測試 (Characterization Tests)，驗證同輸入輸出位元組一致性。
3. **全新架構重構 (Reimagine)**：
   - 適用場景：單體拆分為現代微服務或事件驅動架構。
   - 特色：從代碼中挖掘規格 (AI_NATIVE_SPEC)，設計並核准架構後，以驗收測試驅動服務骨架生成。

---

## 執行規範與工具調用 (Antigravity Integration)

1. **Generative UI 互動面板 (<agent-embed>)**：
   - 本套件支援 Antigravity 原生 Generative UI 規範，於對話中動態嵌入即時互動面板：
     - **即時進度看板**：`<agent-embed src="analysis/<system>/widgets/progress.html"></agent-embed>`（里程碑 0-8 階段軌、模組證明與 Fleet 代理人監控）。
     - **卡片式規則審核甲板**：`<agent-embed src="analysis/<system>/widgets/review_deck.html"></agent-embed>`（Given/When/Then 規則卡輪播、缺陷高亮、快捷鍵裁決與 JSON 匯出）。
     - **終審驗證簽核卡**：`<agent-embed src="analysis/<system>/widgets/sign_off.html"></agent-embed>`（PROVEN 裁決徽章、5 大黃金證據檢驗清單與數位簽核表單）。
   - 透過 `python3 scripts/render_widgets.py <progress|review|signoff|all> --system <name>` 進行一鍵組裝與渲染。
2. **使用者問答互動**：
   - 當需要使用者抉擇或確認時，使用 `ask_question` 工具進行彈出式選擇或確認，並搭配 Generative UI 面板呈現完整脈絡。
3. **子代理人協同**：
   - 執行耗時的代碼深度分析、規則萃取與審查時，使用 `invoke_subagent` 啟動背景 Specialist 代理人（包含 8 個專業角色，批次上限 8，嚴格契約與 Reactive Wakeup）。
4. **安全沙箱防護**：
   - 所有分析產出寫入 `analysis/<system>/`，現代化程式碼寫入 `modernized/`。
   - 嚴格維持 `legacy/<system>/` 原始碼樹為唯讀狀態。
5. **輔助腳本調用**：
   - 專案附帶之報告、渲染與驗證工具（位於 `scripts/`）均以 Python 3 標準庫實現，遵循 `uv` 規範，不依賴龐雜外部套件。
