param([string]$Output = 'C:\Users\baddong\qa-composition\evidence')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Output | Out-Null
trap { $_ | Out-String | Set-Content "$Output\error.txt"; exit 1 }
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class Desktop {
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 public static double MonoMs(){return System.Diagnostics.Stopwatch.GetTimestamp()*1000.0/System.Diagnostics.Stopwatch.Frequency;}
}
// Separate binding from the legacy PowerShell call sites. No warm-up invocation.
public class TimedInput {
 [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 static double Now(){return System.Diagnostics.Stopwatch.GetTimestamp()*1000.0/System.Diagnostics.Stopwatch.Frequency;}
 public static double[] Click() {
  double entry=Now();
  double downBefore=Now(); mouse_event(2,0,0,0,UIntPtr.Zero); double downAfter=Now();
  double upBefore=Now(); mouse_event(4,0,0,0,UIntPtr.Zero); double upAfter=Now();
  return new[]{entry,downBefore,downAfter,upBefore,upAfter};
 }
}
'@
[Desktop]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$app=Get-Process Prexu | Select-Object -First 1
$hwnd=$app.MainWindowHandle
if($hwnd -eq 0){throw 'Prexu has no top-level HWND'}
[Desktop]::ShowWindow($hwnd,9) | Out-Null
[Desktop]::SetWindowPos($hwnd,[IntPtr]::Zero,40,40,1000,600,0x0040) | Out-Null
[Desktop]::SetForegroundWindow($hwnd) | Out-Null
$targets=Invoke-RestMethod http://127.0.0.1:9222/json/list
$target=$targets | Where-Object {$_.url -like '*tauri.localhost*'} | Select-Object -First 1
if(-not $target){throw 'Real WebView2 debugging target missing'}
$socket=New-Object System.Net.WebSockets.ClientWebSocket
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,[Threading.CancellationToken]::None).GetAwaiter().GetResult()
$script:requestId=0
function Javascript([string]$Expression) {
 $script:requestId++
 $message=@{id=$script:requestId;method='Runtime.evaluate';params=@{expression=$Expression;awaitPromise=$true;returnByValue=$true}} | ConvertTo-Json -Depth 6 -Compress
 $bytes=[Text.Encoding]::UTF8.GetBytes($message)
 $timeout=New-Object Threading.CancellationTokenSource 30000
 try {
  $socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$timeout.Token).GetAwaiter().GetResult() | Out-Null
  do {
   $stream=New-Object IO.MemoryStream
   try {
    do {
     $buffer=New-Object byte[] 8192
     $received=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$timeout.Token).GetAwaiter().GetResult()
     if($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){throw 'CDP connection closed'}
     $stream.Write($buffer,0,$received.Count)
    } while(-not $received.EndOfMessage)
    $reply=[Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
   } finally {$stream.Dispose()}
  } while($reply.id -ne $script:requestId)
  if($reply.error -or $reply.result.exceptionDetails){throw ('Desktop JavaScript command failed: ' + ($reply | ConvertTo-Json -Depth 8 -Compress))}
  return $reply.result.result.value
 } finally {$timeout.Dispose()}
}
Set-Content "$Output\ready" 'ready'
$deadline=(Get-Date).AddMinutes(3)
while(-not (Test-Path "$Output\go")) { if((Get-Date) -gt $deadline){throw 'Playback start signal timed out'}; Start-Sleep -Milliseconds 200 }
function LegacyClick {
 $entry=[Desktop]::MonoMs()
 $downBefore=[Desktop]::MonoMs()
 [Desktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 $downAfter=[Desktop]::MonoMs()
 $upBefore=[Desktop]::MonoMs()
 [Desktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 $upAfter=[Desktop]::MonoMs()
 return ,@($entry,$downBefore,$downAfter,$upBefore,$upAfter)
}
function LegacyClockBridge {
 $rows=@()
 foreach($n in 1..5){
  $a=[Desktop]::MonoMs()
  $b=Javascript '({mono:performance.now(),utc:Date.now(),origin:performance.timeOrigin})'
  $c=[Desktop]::MonoMs()
  $rows+=@{before=$a;after=$c;browser=$b;offsetLow=($a-$b.mono);offsetHigh=($c-$b.mono)}
 }
 return ,$rows
}
function LegacySamples {
 Javascript @'
(async()=>{
 const api=window.__TAURI_INTERNALS__;
 window.legacyClicks=[];window.legacyPauses=[];
 document.addEventListener('click',e=>window.legacyClicks.push({mono:performance.now(),utc:Date.now(),trusted:e.isTrusted,target:e.target.tagName,className:String(e.target.className)}),true);
 await api.invoke('plugin:event|listen',{event:'player://paused',target:{kind:'Any'},handler:api.transformCallback(e=>window.legacyPauses.push({mono:performance.now(),utc:Date.now(),paused:e.payload}))});
 return true;
})()
'@ | Out-Null
 foreach($mode in @('legacy','compiled')) {
 foreach($n in 1..3){
  $calBefore=$null;$calAfter=$null;$sample=$null;$beforeTimestamp=$null;$afterTimestamp=$null;$dispatch=$null;$trace=$null;$afterFunction=$null;$sampleError=$null
  try {
  Javascript "(async()=>{await window.__TAURI_INTERNALS__.invoke('player_seek',{seconds:5});await window.__TAURI_INTERNALS__.invoke('player_play');return true})()" | Out-Null
  Start-Sleep -Seconds 2
  $calBefore=LegacyClockBridge
  $point=Javascript '({x:innerWidth*.5,y:innerHeight*.45})'
  $origin=New-Object Drawing.Point;[Desktop]::ClientToScreen($hwnd,[ref]$origin) | Out-Null
  $scale=[Desktop]::GetDpiForWindow($hwnd)/96.0
  [Desktop]::SetCursorPos([int]($origin.X+$point.x*$scale),[int]($origin.Y+$point.y*$scale)) | Out-Null
  Start-Sleep -Milliseconds 300
  Javascript 'window.legacyClicks=[];window.legacyPauses=[];true' | Out-Null
  $beforeTimestamp=[Desktop]::MonoMs()
  $dispatch=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $afterTimestamp=[Desktop]::MonoMs()
  if($mode -eq 'legacy'){$trace=LegacyClick}else{$trace=[TimedInput]::Click()}
  $afterFunction=[Desktop]::MonoMs()
  Start-Sleep -Seconds 2
  $calAfter=LegacyClockBridge
  $sample=Javascript '({clicks:window.legacyClicks,pauses:window.legacyPauses})'
  } catch {$sampleError=$_.Exception.Message} finally {
  @{sampleError=$sampleError;schemaVersion=1;mode=$mode;iteration=$n;cold=($n -eq 1);sample=$sample;beforeTimestamp=$beforeTimestamp;afterTimestamp=$afterTimestamp;dispatchEpochMs=$dispatch;trace=$trace;afterFunction=$afterFunction;calibrationBefore=$calBefore;calibrationAfter=$calAfter} | ConvertTo-Json -Depth 12 | Set-Content "$Output\$mode-$n.json"
  }
  if($sampleError){throw $sampleError}
 }
}
}

try { LegacySamples } finally {
 try {Javascript "window.__TAURI_INTERNALS__.invoke('player_pause')" | Out-Null} catch {}
 $socket.Dispose()
}
Set-Content "$Output\complete" complete
