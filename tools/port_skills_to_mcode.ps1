# 把 MiniMax Code 母版套件的技能檔改成這個 runtime 真正能跑的樣子。
#
# 兩件事：
#   1. Skill 內文不會做 ${PLUGIN_ROOT} 取代（只有 Agent 系統提示與 Hook 指令會），
#      所以技能檔裡的 ${PLUGIN_ROOT} 要換成 <plugin>，並在前言說明如何求出絕對路徑。
#   2. 母版沿用 bash 的寫法要補 PowerShell 等價寫法（Windows 是主要執行環境）。
#
# 用法：pwsh -File tools/port_skills_to_mcode.ps1 -PackageRoot <套件目錄>
param(
    [Parameter(Mandatory = $true)][string]$PackageRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PackageRoot).Path
$skills = Join-Path $root 'skills'

$preamble = '**Plugin directory.** `<plugin>` is the installed plugin root, the directory that holds this skill''s `skills/` folder. The `skill` tool reports this file''s absolute path in its `Location:` line, so the plugin root is that path with `skills/<name>/SKILL.md` removed. Substitute that absolute path for `<plugin>` in every command below. Never put `~` inside a quoted command: PowerShell does not expand it and the script fails to open. **Shell.** This runtime runs PowerShell on Windows: commands below are PowerShell, and a POSIX equivalent is given in parentheses where the two differ.'

$changed = @()
Get-ChildItem -Path $skills -Directory | ForEach-Object {
    $file = Join-Path $_.FullName 'SKILL.md'
    if (-not (Test-Path $file)) { return }

    $text = Get-Content -Path $file -Raw -Encoding UTF8

    # 1. ${PLUGIN_ROOT} -> <plugin>
    $text = $text.Replace('${PLUGIN_ROOT}', '<plugin>')

    # 2. 前言：插在 frontmatter 之後、**Invocation.** 之前
    if ($text -notmatch '\*\*Plugin directory\.\*\*') {
        $anchor = '**Invocation.**'
        $idx = $text.IndexOf($anchor)
        if ($idx -lt 0) {
            Write-Error "找不到 $anchor：$file"
        }
        $text = $text.Substring(0, $idx) + $preamble + "`r`n" + $text.Substring($idx)
    }

    [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
    $changed += $_.Name
}

Write-Output ("已轉換技能：{0}" -f ($changed -join ', '))
