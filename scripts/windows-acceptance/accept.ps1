param(
    [ValidateSet('nsis', 'msi')][string]$Format,
    [ValidateSet('none', 'missing-dll')][string]$Fault = 'none'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'Run only on a disposable GitHub-hosted Windows runner'
}
$logs = New-Item -ItemType Directory -Force acceptance-logs
Start-Transcript -Path "$logs/transcript.txt"
$script:app = $null
# Elevated hosted runners ignore WEBVIEW2_* overrides on Runtime 150+.
# Use app-specific machine policy only on this disposable machine.
$webviewPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2'
function Set-TestProfile([string]$Name) {
    $profile = Join-Path $env:RUNNER_TEMP "prexu-$Format-$Name"
    $env:WEBVIEW2_USER_DATA_FOLDER = $profile
    New-Item -Path "$webviewPolicy/UserDataFolder" -Force | Out-Null
    New-ItemProperty -Path "$webviewPolicy/UserDataFolder" -Name 'Prexu.exe' -Value $profile -PropertyType String -Force | Out-Null
}
$logDir = Join-Path $env:LOCALAPPDATA 'com.prexu.client/logs'
$registryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
function Registrations {
    @(Get-ItemProperty $registryRoots -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'Prexu' })
}
function Run-Installer([string]$Path, [string]$Arguments, [string]$Label) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(180000)) {
        $process.Kill()
        throw "$Label timed out after 180 seconds"
    }
    if ($process.ExitCode -ne 0) { throw "$Label exited $($process.ExitCode) (reboots are not accepted)" }
    Write-Host "PASS $Label (exit 0)"
}
function Install([string]$Path, [string]$Label) {
    if ($Format -eq 'msi') {
        Run-Installer msiexec.exe "/i `"$Path`" /qn /norestart /L*v `"$logs/$Label-msi.log`"" $Label
    } else {
        Run-Installer $Path '/S' $Label
    }
    $entries = @(Registrations)
    if ($entries.Count -ne 1) { throw "Expected one installed Prexu registration, got $($entries.Count)" }
    $entries | Select-Object DisplayName, DisplayVersion, InstallLocation, PSChildName |
        ConvertTo-Json | Set-Content "$logs/$Label-registration.json"
    $paths = @(
        (Join-Path $env:LOCALAPPDATA 'Prexu/Prexu.exe'),
        (Join-Path $env:ProgramFiles 'Prexu/Prexu.exe')
    )
    $found = @($paths | Where-Object { Test-Path $_ })
    if ($found.Count -ne 1) { throw "Expected one installed executable, got $($found.Count)" }
    return $found[0]
}
function Check-Runtime([string]$Exe) {
    $directory = Split-Path $Exe
    foreach ($name in $runtimeHashes.Keys) {
        $path = Join-Path $directory $name
        if (-not (Test-Path $path)) { throw "Missing runtime DLL: $name" }
        $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
        if ($hash -ne $runtimeHashes[$name]) { throw "Incorrect runtime DLL: $name ($hash)" }
        Write-Host "PASS real runtime $name SHA256 $hash"
    }
}
function Start-And-Check([string]$Exe, [string]$Mode, [string]$Label, [bool]$RequireHandshake) {
    if (Test-Path "$logDir/Prexu.log") { Remove-Item -Force "$logDir/Prexu.log" }
    $script:app = Start-Process -FilePath $Exe -PassThru
    try {
        # Bound the entire CDP helper too, including attachment cleanup. A browser
        # transport that stalls must fail here and still upload diagnostics.
        $helper = Start-Process node -ArgumentList "scripts/windows-acceptance/ready.mjs $Mode `"$logs/$Label-ready.json`"" -PassThru -NoNewWindow -RedirectStandardOutput "$logs/$Label-cdp.out" -RedirectStandardError "$logs/$Label-cdp.err"
        if (-not $helper.WaitForExit(90000)) {
            $helper.Kill()
            throw "$Label CDP helper timed out after 90 seconds"
        }
        Get-Content "$logs/$Label-cdp.out", "$logs/$Label-cdp.err" | ForEach-Object { Write-Host $_ }
        if ($helper.ExitCode -ne 0) { throw "$Label frontend readiness failed" }
        if ($script:app.HasExited) { throw "$Label exited before readiness check" }
        if ($RequireHandshake) {
            if (-not (Test-Path "$logDir/Prexu.log") -or
                -not (Select-String -Path "$logDir/Prexu.log" -SimpleMatch 'app_ready — frontend signalled first paint' -Quiet)) {
                throw "$Label missing native first-paint handshake"
            }
        }
        Write-Host "PASS $Label readiness within 60 seconds"
        if (-not $script:app.CloseMainWindow()) { throw "$Label WM_CLOSE could not be sent" }
        if (-not $script:app.WaitForExit(30000)) { throw "$Label did not exit within 30 seconds" }
        if ($script:app.ExitCode -ne 0) { throw "$Label unclean exit: $($script:app.ExitCode)" }
        Write-Host "PASS $Label clean exit (exit 0)"
    } finally {
        Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Prexu.exe', 'msedgewebview2.exe') } |
            Select-Object Name, ProcessId, ParentProcessId, CommandLine |
            ConvertTo-Json -Depth 3 | Set-Content "$logs/$Label-processes.json"
        if (Test-Path $logDir) { Copy-Item -Recurse -Force $logDir "$logs/$Label-app" }
        if ($script:app -and -not $script:app.HasExited) { Stop-Process -Id $script:app.Id -Force }
    }
}
function Uninstall([string]$Exe, [string]$Label) {
    $entries = @(Registrations)
    if ($entries.Count -ne 1) { throw 'Missing or duplicate registration before uninstall' }
    if ($Format -eq 'msi') {
        $code = $entries[0].PSChildName
        if ($code -notmatch '^\{[0-9A-Fa-f-]+\}$') { throw 'Invalid MSI product code' }
        Run-Installer msiexec.exe "/x $code /qn /norestart /L*v `"$logs/$Label-msi.log`"" $Label
    } else {
        $uninstaller = Join-Path (Split-Path $Exe) 'uninstall.exe'
        Run-Installer $uninstaller '/S' $Label
    }
    # NSIS can delegate deletion to a temporary child process.
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $remaining = @(Registrations)
        $binaries = @()
        $installDirectory = Split-Path $Exe
        # With -Recurse, a missing literal directory can make PowerShell search
        # its parent (all of Program Files for MSI). Absence already proves cleanup.
        if (Test-Path -LiteralPath $installDirectory -PathType Container) {
            $binaries = @(Get-ChildItem -LiteralPath $installDirectory -File -Recurse |
                Where-Object { $_.Extension -in @('.exe', '.dll') })
        }
        if ($remaining.Count -eq 0 -and $binaries.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($remaining.Count -ne 0 -or $binaries.Count -ne 0) { throw "$Label left registration or installed binaries" }
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
        [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
        if ($folder -and (Get-ChildItem $folder -Filter '*Prexu*.lnk' -Recurse -ErrorAction SilentlyContinue)) {
            throw "$Label left a Prexu shortcut in $folder"
        }
    }
    Write-Host "PASS $Label cleanup: no installed executables/DLLs, registration or shortcuts"
}
try {
    if (@(Registrations).Count -ne 0 -or (Get-Process Prexu -ErrorAction SilentlyContinue)) {
        throw 'Runner must have no previous Prexu installation/process'
    }
    Copy-Item candidate/BUILD.txt "$logs/candidate-BUILD.txt"
    Copy-Item candidate/SHA256SUMS.txt "$logs/candidate-SHA256SUMS.txt"
    $checked = @{}
    foreach ($line in Get-Content candidate/SHA256SUMS.txt) {
        if ($line -notmatch '^([0-9a-fA-F]{64})  ([^/\\]+\.(exe|msi))$') { throw 'Invalid checksum manifest' }
        $expected = $Matches[1].ToLower()
        $name = $Matches[2]
        if ($checked.ContainsKey($name)) { throw 'Duplicate manifest entry' }
        $actual = (Get-FileHash "candidate/$name" -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) { throw "Installer hash mismatch: $name" }
        $checked[$name] = $true
        Write-Host "PASS installer SHA256 $name $actual"
    }
    $extension = if ($Format -eq 'nsis') { 'exe' } else { 'msi' }
    $installers = @(Get-ChildItem "candidate/*.$extension")
    if ($installers.Count -ne 1 -or -not $checked.ContainsKey($installers[0].Name) -or $checked.Count -ne 2) {
        throw 'Expected exactly one checked NSIS and one checked MSI'
    }
    $candidate = $installers[0].FullName
    # Independently obtain the real libmpv from the archive pinned by production.
    $mpvArchive = Join-Path $env:RUNNER_TEMP 'acceptance-mpv.7z'
    Invoke-WebRequest 'https://github.com/nwilliams22/prexu/releases/download/libmpv-vendor/mpv-dev-x86_64-20260629-git-3f1b23abd0.7z' -OutFile $mpvArchive
    if ((Get-FileHash $mpvArchive).Hash.ToLower() -ne 'ea0a4aa3bdb1fc225c5fa4f73f7a705e06fae84f99fc8f9946757e99eb5f5a26') { throw 'libmpv archive hash mismatch' }
    $mpvDir = Join-Path $env:RUNNER_TEMP 'acceptance-mpv'
    & 7z e -y $mpvArchive 'libmpv-2.dll' "-o$mpvDir"
    if ($LASTEXITCODE -ne 0) { throw 'libmpv extraction failed' }
    $runtimeHashes = @{
        'libmpv-2.dll' = (Get-FileHash "$mpvDir/libmpv-2.dll").Hash.ToLower()
        'libEGL.dll' = 'a86422d6d679dda4c00bb0db813884eb14857924eb391fb48283dfca5be007ef'
        'libGLESv2.dll' = 'b48565279ebfcc75675e9b88a1835bd9fd94016290641bc98108ae382962b2f3'
    }
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1'
    New-Item -Path "$webviewPolicy/AdditionalBrowserArguments" -Force | Out-Null
    New-ItemProperty -Path "$webviewPolicy/AdditionalBrowserArguments" -Name 'Prexu.exe' -Value $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -PropertyType String -Force | Out-Null
    Set-TestProfile 'fresh'
    $exe = Install $candidate 'candidate-install'
    if ($Fault -eq 'missing-dll') {
        Remove-Item -Force (Join-Path (Split-Path $exe) 'libmpv-2.dll')
        Write-Host 'Injected negative control: removed installed libmpv-2.dll'
    }
    Check-Runtime $exe
    $candidateVersion = [version](Registrations)[0].DisplayVersion
    Start-And-Check $exe 'fresh' 'candidate-fresh' $true
    Uninstall $exe 'candidate-uninstall'

    $previousName = if ($Format -eq 'nsis') { 'Prexu_0.7.1_x64-setup.exe' } else { 'Prexu_0.7.1_x64_en-US.msi' }
    $previousHash = if ($Format -eq 'nsis') { '6872d887ac3c7010617f7d743173c7d0438ceb7c85a584d0c0bd805d1c905087' } else { '9cf91a1281438e93bff17c0057b614ebc8e7528ae2c955d8781c6568a9a152b1' }
    $previous = Join-Path $env:RUNNER_TEMP $previousName
    Invoke-WebRequest "https://github.com/nwilliams22/prexu/releases/download/v0.7.1/$previousName" -OutFile $previous
    if ((Get-FileHash $previous).Hash.ToLower() -ne $previousHash) { throw 'Previous installer hash mismatch' }
    Set-TestProfile 'upgrade'
    $exe = Install $previous 'previous-install'
    $previousVersion = [version](Registrations)[0].DisplayVersion
    if ($previousVersion -ne [version]'0.7.1' -or $candidateVersion -le $previousVersion) { throw 'Not a version upgrade' }
    Start-And-Check $exe 'seed' 'previous-seed' $false
    $exe = Install $candidate 'upgrade-install'
    if ([version](Registrations)[0].DisplayVersion -ne $candidateVersion) { throw 'Upgrade registration version mismatch' }
    Check-Runtime $exe
    Start-And-Check $exe 'retain' 'upgraded' $true
    Write-Host "PASS upgrade $previousVersion -> $candidateVersion with retained preferences"
    Uninstall $exe 'upgraded-uninstall'
    Write-Host "PASS ALL $Format install, readiness, clean exit, upgrade, settings and uninstall"
} finally {
    foreach ($key in @('AdditionalBrowserArguments', 'UserDataFolder')) {
        Remove-ItemProperty -Path "$webviewPolicy/$key" -Name 'Prexu.exe' -ErrorAction SilentlyContinue
    }
    if (Test-Path $logDir) { Copy-Item -Recurse -Force $logDir "$logs/final-app" }
    Stop-Transcript
}
