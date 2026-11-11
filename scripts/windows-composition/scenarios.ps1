# Dot-sourced by desktop.ps1 on the interactive desktop, after real playback starts.
# CDP drives the installed UI; CopyFromScreen is the only pixel evidence source.
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
if($session -eq 0){throw 'Composed capture requires an interactive session, not SSH session 0'}
@{
 schema='prexu.windows.scenarios.v1'; sessionId=$session; utc=[DateTime]::UtcNow.ToString('o')
 capture='Win32 CopyFromScreen'; backend='libmpv render API / ANGLE D3D11 / DirectComposition / WebView2'
 displays=@([Windows.Forms.Screen]::AllScreens | ForEach-Object {@{primary=$_.Primary;bounds=@($_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height)}})
 gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,Status)
 coverage='Virtual displays; physical display, GPU decode, audio and HDR acceptance not established'
} | ConvertTo-Json -Depth 6 | Set-Content "$Output\session.json"

function ClickControl([string]$Label) {
 $labelJson=ConvertTo-Json -InputObject $Label -Compress
 Javascript "(()=>{const label=$labelJson;const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);if(!b)throw Error('Control missing: '+label);b.click();return true})()" | Out-Null
 Start-Sleep -Seconds 3
}
function Observe([string]$Name,[string]$Control,[bool]$ExpectMoving=$true) {
 # Repeated native pointer movement keeps real controls visible during slow
 # software captures; no DOM style or screenshot pixels are changed.
 $labelJson=ConvertTo-Json -InputObject $Control -Compress
 $point=Javascript "(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===$labelJson);if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()"
 if(-not $point){throw "Expected control missing: $Control"}
 $origin=New-Object Drawing.Point;[Desktop]::ClientToScreen($hwnd,[ref]$origin) | Out-Null
 $scale=[Desktop]::GetDpiForWindow($hwnd)/96.0
 [Desktop]::StartPointer([int]($origin.X+($point.x+$point.w/2)*$scale),[int]($origin.Y+($point.y+$point.h/2)*$scale))
 Start-Sleep -Seconds 2
 $frames=CapturePair $Name
 $a=$frames.A;$b=$frames.B
 $bars=[Desktop]::PatternBounds($a,$a.Width,$a.Height,150,2000)
 $motion=$false;$m=@();$roi=@()
 if(-not $bars.IsEmpty -and $bars.Width -gt 30 -and $bars.Height -gt 30){
  $roi=@(($bars.X+10),($bars.Y+10),($bars.Width-20),($bars.Height-20))
  $m=[Desktop]::Measure($a,$b,$roi[0],$roi[1],$roi[2],$roi[3])
  $motion=$m[0] -gt .5 -and $m[1] -gt .15 -and $m[4] -gt .5 -and $m[5] -gt .15 -and $m[2] -gt .005
 }
 $chrome=$false;$chromeRoi=@();$chromeLit=0;$whiteB=0
 if($point -and $point.w -gt 0 -and $point.h -gt 0){
  $origin=New-Object Drawing.Point;[Desktop]::ClientToScreen($hwnd,[ref]$origin) | Out-Null
  $scale=[Desktop]::GetDpiForWindow($hwnd)/96.0
  $chromeRoi=@([int]($origin.X+$point.x*$scale-$screen.X),[int]($origin.Y+$point.y*$scale-$screen.Y),[int]($point.w*$scale),[int]($point.h*$scale))
  if($chromeRoi[0] -ge 0 -and $chromeRoi[1] -ge 0 -and $chromeRoi[0]+$chromeRoi[2] -le $a.Width -and $chromeRoi[1]+$chromeRoi[3] -le $a.Height){
   $chromeLit=[Desktop]::WhiteFraction($a,$chromeRoi[0],$chromeRoi[1],$chromeRoi[2],$chromeRoi[3]);$whiteB=[Desktop]::WhiteFraction($b,$chromeRoi[0],$chromeRoi[1],$chromeRoi[2],$chromeRoi[3]);$chrome=$chromeLit -gt .01 -and $whiteB -gt .01
  }
 }
 $timely=($frames.SecondUtc-$frames.FirstUtc).TotalMilliseconds -lt 3000
 $pass=$motion -and $chrome -and $timely
 $results.Add(@{name=$Name;pass=$pass;videoPresent=(-not $bars.IsEmpty);moving=$motion;chrome=$chrome;chromeWhiteFraction=$chromeLit;chromeWhiteFractionB=$whiteB;chromeRoi=$chromeRoi;roi=$roi;metrics=$m;firstUtc=$frames.FirstUtc.ToString('o');secondUtc=$frames.SecondUtc.ToString('o');expectMoving=$ExpectMoving})
 ConvertTo-Json -InputObject ($results.ToArray()) -Depth 6 | Set-Content "$Output\metrics.json"
 [Desktop]::StopPointer()
 return $results[$results.Count-1]
}
Stage 'play'
Start-Sleep -Seconds 3
$null=Observe 'play' 'Pause'
Javascript "(async()=>{await window.__TAURI_INTERNALS__.invoke('player_pause');await window.__TAURI_INTERNALS__.invoke('player_seek',{seconds:25})})()" | Out-Null
Start-Sleep -Seconds 2
$position=Javascript 'Number(document.querySelector("[role=slider][aria-label=Seek]")?.getAttribute("aria-valuenow"))'
Javascript "window.__TAURI_INTERNALS__.invoke('player_play')" | Out-Null
Start-Sleep -Seconds 3
$seek=Observe 'seek' 'Pause'
$seek.positionSeconds=$position
$seek.pass=$seek.pass -and $position -ge 24 -and $position -le 26
ClickControl 'Fullscreen'
$full=Observe 'fullscreen' 'Exit fullscreen'
$wr=New-Object Desktop+Rect
[Desktop]::GetWindowRect($hwnd,[ref]$wr) | Out-Null
$monitor=[Windows.Forms.Screen]::FromHandle($hwnd).Bounds
$full.window=@($wr.Left,$wr.Top,$wr.Right,$wr.Bottom)
$full.pass=$full.pass -and [Math]::Abs(($wr.Right-$wr.Left)-$monitor.Width) -le 2 -and [Math]::Abs(($wr.Bottom-$wr.Top)-$monitor.Height) -le 2
ClickControl 'Exit fullscreen'
$null=Observe 'windowed' 'Fullscreen'
ClickControl 'Minimize player to corner'
$mini=Observe 'mini' 'Restore to full player'
$mini.pass=$mini.pass -and $mini.roi.Count -eq 4 -and $mini.roi[2] -lt 600
ClickControl 'Restore to full player'
$null=Observe 'restore' 'Pause'
ClickControl 'Pop out floating player'
$null=Observe 'popout' 'Exit pop-out'
ClickControl 'Exit pop-out'
$null=Observe 'popout-exit' 'Pause'
# Inject a real native freeze, while retaining the same moving-video predicate.
# No screenshot is edited and a failed capture is never accepted as detection.
Javascript "window.__TAURI_INTERNALS__.invoke('player_pause')" | Out-Null
Start-Sleep -Seconds 3
$fault=Observe 'injected-freeze' 'Play' $false
$detected=$fault.videoPresent -and $fault.chrome -and -not $fault.moving -and $fault.metrics.Count -eq 6 -and $fault.metrics[2] -lt .002
$results.Remove($fault) | Out-Null
$fault.name='fault-detected';$fault.pass=$detected
$results.Add($fault)
Javascript "window.__TAURI_INTERNALS__.invoke('player_play')" | Out-Null
Start-Sleep -Seconds 3
$null=Observe 'recovered' 'Pause'
ClickControl 'Minimize player to corner'
ClickControl 'Close player'
$frame=Capture 'stop'
$bars=[Desktop]::PatternBounds($frame,$frame.Width,$frame.Height,150,2000)
$gone=Javascript '![...document.querySelectorAll("button")].some(b=>["Restore to full player","Pause"].includes(b.getAttribute("aria-label")))'
$results.Add(@{name='stop';pass=($bars.IsEmpty -and $gone);videoAbsent=$bars.IsEmpty;controlsAbsent=$gone})
