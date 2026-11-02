# Codex 版 code-modernization

此版本適用 Windows、macOS 與 Linux，以單一 Codex 技能 `code-modernization` 提供 13 個流程；8 個角色檔案作為工作指引。技能不依賴 plugin manifest 或 hooks，未授權委派時循序執行。

安裝 Python 3，並確認 `python3`、Windows 的 `python` 或 `py -3` 可用。將 `code-modernization/` 複製至專案的 `.agents/skills/code-modernization/`，或 Codex 使用者技能目錄 `~/.codex/skills/code-modernization/`，然後重新啟動 Codex。保留腳本與素材；入口說明各平台如何設定 `CODE_MODERNIZATION_ROOT` 和執行流程。Windows 使用 PowerShell；POSIX 範例適用 macOS 與 Linux。

升級時必須先檢查原始碼中的符號連結與接合點，避免透過工作複本修改原始碼。本倉庫不會自動修改已安裝的技能或設定。

執行測試：在本目錄使用 `python -m unittest discover -s tests`（或以系統可用的 Python 3 命令取代 `python`）。
