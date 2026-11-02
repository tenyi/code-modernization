# Codex Windows 版 code-modernization

本版本以 `Codex/code-modernization` 為基礎，供 Windows PowerShell 使用，包含 13 個流程與所需腳本、素材。請先安裝 Python 3，並確認 `python` 或 `py -3` 可執行；流程中的範例以 `python` 表示。

將 `code-modernization` 複製至 `C:\Users\<使用者>\.codex\skills\code-modernization`，重新啟動 Codex。執行流程時，依入口說明在每次 PowerShell 呼叫中設定 `$env:CODE_MODERNIZATION_ROOT`。技能及子流程可在 Codex 的技能設定中停用或啟用。

升級工作複本前需檢查來源中的連結與接合點；有連結時先釐清安全的處理方式，避免意外修改原始程式碼。
