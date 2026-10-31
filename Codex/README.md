# Codex 版 code-modernization

本移植以 MiniMax Code 版為母版，以單一 Codex 技能 `code-modernization` 提供 13 個流程；8 個角色檔案作為工作指引。技能不依賴 MiniMax 的 plugin manifest 或 hooks，未授權委派時循序執行。

安裝時將 `code-modernization/` 複製到專案的 `.agents/skills/code-modernization/`，或複製到 Codex 使用者技能目錄 `~/.codex/skills/code-modernization/`。重新啟動 Codex 以更新技能清單。腳本與素材必須保留在技能目錄內；入口會指示執行時設定 `CODE_MODERNIZATION_ROOT`。

本倉庫的版本是可攜的技能來源，不會自動修改已安裝的 Codex 技能或設定。
