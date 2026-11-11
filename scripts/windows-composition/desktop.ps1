param([string]$Output = 'C:\Users\baddong\qa-composition\evidence', [switch]$SelfTest, [switch]$Scenarios)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Output | Out-Null
trap { $_ | Out-String | Set-Content "$Output\error.txt"; exit 1 }
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class Desktop {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Point p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 public static void Key(byte key,bool up) { keybd_event(key,0,up?2u:0u,UIntPtr.Zero); }
 public static Bitmap Capture(int x,int y,int w,int h) {
  var task=System.Threading.Tasks.Task.Run(()=>{var b=new Bitmap(w,h);try{using(var g=Graphics.FromImage(b))g.CopyFromScreen(x,y,0,0,b.Size);return b;}catch{b.Dispose();throw;}});
  if(!task.Wait(TimeSpan.FromSeconds(90)))throw new TimeoutException("Composed screen capture did not return within 90 seconds");
  return task.Result;
 }
 static System.Threading.Timer pointerTimer; static int pointerTick;
 public static void StartPointer(int x,int y) {StopPointer();pointerTimer=new System.Threading.Timer(_=>{SetCursorPos(x+((System.Threading.Interlocked.Increment(ref pointerTick)&1)*8),y);},null,0,250);}
 public static void StopPointer() {if(pointerTimer!=null){pointerTimer.Dispose();pointerTimer=null;}}
 public static double IconFraction(Bitmap b,int x,int y,int w,int h,int red,int green,int blue) {
  int stride;var p=Pixels(b,out stride);int matched=0,total=0;
  for(int j=y;j<y+h;j++)for(int i=x;i<x+w;i++){int k=j*stride+i*4;int lo=Math.Min(p[k],Math.Min(p[k+1],p[k+2]));int hi=Math.Max(p[k],Math.Max(p[k+1],p[k+2]));bool lightNeutral=Math.Min(red,Math.Min(green,blue))>170&&Math.Max(red,Math.Max(green,blue))-Math.Min(red,Math.Min(green,blue))<30;
   if((Math.Abs(p[k]-blue)<20&&Math.Abs(p[k+1]-green)<20&&Math.Abs(p[k+2]-red)<20)||(lightNeutral&&lo>170&&hi-lo<30))matched++;total++;}
  return matched/(double)total;
 }
 public static double WhiteFraction(Bitmap b,int x,int y,int w,int h) {return IconFraction(b,x,y,w,h,255,255,255);}
 // Only strongly saturated pixels can be the synthetic color-bar fixture.
 // Ignore titlebar/controls and measure a central video ROI supplied by the caller.
 public class Frames {public Bitmap A,B;public DateTime FirstUtc,SecondUtc;}
 public static Frames Pair(int x,int y,int w,int h){var f=new Frames();f.A=Capture(x,y,w,h);f.FirstUtc=DateTime.UtcNow;System.Threading.Thread.Sleep(1100);f.B=Capture(x,y,w,h);f.SecondUtc=DateTime.UtcNow;return f;}
 static byte[] Pixels(Bitmap b,out int stride){
  var d=b.LockBits(new Rectangle(0,0,b.Width,b.Height),System.Drawing.Imaging.ImageLockMode.ReadOnly,System.Drawing.Imaging.PixelFormat.Format32bppArgb);
  try{stride=d.Stride;if(stride<=0)throw new Exception("Unexpected bitmap stride");var bytes=new byte[stride*b.Height];Marshal.Copy(d.Scan0,bytes,0,bytes.Length);return bytes;}finally{b.UnlockBits(d);}
 }
 public static Rectangle PatternBounds(Bitmap b,int maxX,int maxY,int minWidth,int maxWidth) {
  int stride;var pixels=Pixels(b,out stride);
  Func<int,int,int> bar=(px,py)=>{int k=py*stride+px*4;return Bar(Color.FromArgb(pixels[k+2],pixels[k+1],pixels[k]));};
  maxX=Math.Min(maxX,b.Width);maxY=Math.Min(maxY,b.Height);
  int left=b.Width,top=b.Height,right=0,bottom=0;
  for(int y=80;y<Math.Min(maxY,b.Height);y+=3){
   for(int x=0;x<Math.Min(maxX,b.Width)-minWidth;x+=3){
    if(bar(x,y)!=0 || (x>=3 && bar(x-3,y)==0))continue;
    int begin=x,pos=x;bool ok=true;int stripe=0;
    for(int c=0;c<6;c++){
     int gap=0;while(pos<maxX && bar(pos,y)!=c && gap++<6)pos++;
     int start=pos;while(pos<maxX && bar(pos,y)==c)pos++;
     int width=pos-start;
     if(width<minWidth/8 || width>maxWidth/5 || (stripe>0 && Math.Abs(width-stripe)>stripe*.3)){ok=false;break;}
     stripe=width;
    }
    if(ok && pos-begin>=minWidth && pos-begin<=maxWidth){left=Math.Min(left,begin);right=Math.Max(right,pos);top=Math.Min(top,y);bottom=Math.Max(bottom,y);x=pos;}
   }
  }
  if(right<=left || bottom<=top)return Rectangle.Empty;
  // Animated lines/checkerboards break complete stripe runs. Once horizontal
  // geometry is known, recover vertical bounds from the expected six-bar colors,
  // tolerating moving overlays rather than treating them as cropped video.
  top=b.Height;bottom=0;
  for(int y=0;y<maxY;y+=3){
   int matched=0,total=0;
   for(int x=left;x<right;x+=3){int expected=Math.Min(5,(x-left)*6/(right-left));if(bar(x,y)==expected)matched++;total++;}
   if(matched>total*.70){top=Math.Min(top,y);bottom=Math.Max(bottom,y);}
  }
  return bottom>top ? Rectangle.FromLTRB(left,top,right,bottom) : Rectangle.Empty;
 }
 static int Bar(Color p){
  if(p.R>150&&p.G<80&&p.B<80)return 0;
  if(p.R<80&&p.G>120&&p.B<80)return 1;
  if(p.R>150&&p.G>150&&p.B<80)return 2;
  if(p.R<80&&p.G<80&&p.B>150)return 3;
  if(p.R>150&&p.G<80&&p.B>150)return 4;
  if(p.R<80&&p.G>150&&p.B>150)return 5;
  return -1;
 }
 public static double[] Measure(Bitmap a,Bitmap b,int x,int y,int w,int h) {
  int sa,sb;var pa=Pixels(a,out sa);var pb=Pixels(b,out sb);
  long n=0,lit=0,colored=0,changed=0,litB=0,coloredB=0; double delta=0;
  for(int j=y;j<y+h;j+=3)for(int i=x;i<x+w;i+=3){
   int ia=j*sa+i*4,ib=j*sb+i*4;
   var p=Color.FromArgb(pa[ia+2],pa[ia+1],pa[ia]);var q=Color.FromArgb(pb[ib+2],pb[ib+1],pb[ib]);n++;
   int max=Math.Max(p.R,Math.Max(p.G,p.B)),min=Math.Min(p.R,Math.Min(p.G,p.B));
   if(max>35)lit++;if(max>100&&max-min>90)colored++;
   int maxB=Math.Max(q.R,Math.Max(q.G,q.B)),minB=Math.Min(q.R,Math.Min(q.G,q.B));
   if(maxB>35)litB++;if(maxB>100&&maxB-minB>90)coloredB++;
   int d=Math.Abs(p.R-q.R)+Math.Abs(p.G-q.G)+Math.Abs(p.B-q.B);delta+=d/3.0;if(d>45)changed++;
  }
  return new[]{lit/(double)n,colored/(double)n,changed/(double)n,delta/n,litB/(double)n,coloredB/(double)n};
 }
}
'@
if($SelfTest) {
 $a=New-Object Drawing.Bitmap 640,480;$b=New-Object Drawing.Bitmap 640,480
 $g=[Drawing.Graphics]::FromImage($a);$g.Clear([Drawing.Color]::Black)
 $colors=@([Drawing.Color]::Red,[Drawing.Color]::Lime,[Drawing.Color]::Yellow,[Drawing.Color]::Blue,[Drawing.Color]::Magenta,[Drawing.Color]::Cyan)
 for($i=0;$i -lt 6;$i++){$brush=New-Object Drawing.SolidBrush $colors[$i];$g.FillRectangle($brush,100+$i*40,120,40,150);$brush.Dispose()}
 for($i=1;$i -lt 6;$i++){$g.FillRectangle([Drawing.Brushes]::Gray,99+$i*40,120,2,150)}
 $g.Dispose();$g=[Drawing.Graphics]::FromImage($b);$g.DrawImageUnscaled($a,0,0);$g.Dispose()
 $bounds=[Desktop]::PatternBounds($a,640,480,150,500)
 if($bounds.Width -lt 235 -or $bounds.X -lt 95 -or $bounds.X -gt 105){throw 'Tile detector rejected known six-stripe tile'}
 $same=[Desktop]::Measure($a,$b,110,130,220,120)
 if([Desktop]::IconFraction($a,110,130,220,120,26,26,26) -ne 0){throw 'Colored video must not pass as a dark control icon'}
 if([Desktop]::WhiteFraction($a,110,130,220,120) -ne 0){throw 'Colored video must not pass as a white control icon'}
 if($same[2] -ne 0 -or $same[1] -lt .9){throw 'Frozen-video negative control failed'}
 $g=[Drawing.Graphics]::FromImage($b);$g.FillRectangle([Drawing.Brushes]::White,150,150,70,70);$g.Dispose()
 if([Desktop]::WhiteFraction($b,110,130,220,120) -lt .05){throw 'White control pixel detector failed'}
 $g=[Drawing.Graphics]::FromImage($b);$aa=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(200,200,200));$g.FillRectangle($aa,150,150,70,70);$aa.Dispose();$g.Dispose()
 if([Desktop]::IconFraction($b,110,130,220,120,255,255,255) -lt .05){throw 'Antialiased light control detector failed'}
 $moving=[Desktop]::Measure($a,$b,110,130,220,120)
 if($moving[2] -lt .05){throw 'Moving-video positive control failed'}
 $g=[Drawing.Graphics]::FromImage($b);$g.Clear([Drawing.Color]::Black);$g.Dispose()
 $black=[Desktop]::Measure($b,$b,110,130,220,120)
 if($black[0] -ne 0 -or $black[1] -ne 0 -or $black[4] -ne 0 -or $black[5] -ne 0 -or -not [Desktop]::PatternBounds($b,640,480,150,500).IsEmpty){throw 'Black-video negative control failed'}
 $toBlack=[Desktop]::Measure($a,$b,110,130,220,120)
 if($toBlack[2] -lt .9 -or $toBlack[4] -ne 0 -or $toBlack[5] -ne 0){throw 'Video-to-black transition guard failed'}
 $g=[Drawing.Graphics]::FromImage($a);$g.FillRectangle([Drawing.Brushes]::White,220,200,45,70);$g.Dispose()
 $occludedBounds=[Desktop]::PatternBounds($a,640,480,150,500)
 if([Math]::Abs($occludedBounds.Height-$bounds.Height) -gt 3){throw 'Animated overlay changed measured video bounds'}
 $g=[Drawing.Graphics]::FromImage($b);$g.DrawImageUnscaled($a,0,0);$g.Dispose()
 $a.Dispose();$b.Dispose();'PIXEL_SELFTEST_PASS';exit 0
}
[Desktop]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$app = Get-Process Prexu | Select-Object -First 1
$hwnd = $app.MainWindowHandle
if ($hwnd -eq 0) { throw 'Prexu has no top-level HWND' }
$results = [System.Collections.Generic.List[object]]::new()
$captures = [System.Collections.Generic.List[object]]::new()
$script:baselineGeometry=$null
Start-Process notepad | Out-Null
$noteDeadline=(Get-Date).AddSeconds(45)
do {
 $note=Get-Process notepad -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1
 if((Get-Date) -gt $noteDeadline){throw 'Notepad did not expose a top-level HWND'}
 if(-not $note){Start-Sleep -Milliseconds 300}
} while(-not $note)
$nh=$note.MainWindowHandle
[Desktop]::ShowWindow($nh,6) | Out-Null
 [Desktop]::ShowWindow($hwnd,9) | Out-Null
 [Desktop]::SetWindowPos($hwnd,[IntPtr]::Zero,40,40,1000,600,0x0040) | Out-Null
 [Desktop]::SetForegroundWindow($hwnd) | Out-Null
 [Desktop]::SetCursorPos(5,790) | Out-Null
Start-Sleep -Seconds 2
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
function Trace([string]$Message) { Add-Content "$Output\trace.txt" "$([DateTime]::UtcNow.ToString('o')) $Message" }
function Capture([string]$Name) {
 Trace "capture $Name begin"
 $b=[Desktop]::Capture([Desktop]::GetSystemMetrics(76),[Desktop]::GetSystemMetrics(77),[Desktop]::GetSystemMetrics(78),[Desktop]::GetSystemMetrics(79))
 $captures.Add(@{name=$Name;image=$b})
 Trace "capture $Name end"
 return $b
}
function CapturePair([string]$Name) {
 Trace "pair $Name begin"
 $attempt=0
 do {
  $frames=[Desktop]::Pair([Desktop]::GetSystemMetrics(76),[Desktop]::GetSystemMetrics(77),[Desktop]::GetSystemMetrics(78),[Desktop]::GetSystemMetrics(79))
  $attempt++
  $timely=($frames.SecondUtc-$frames.FirstUtc).TotalMilliseconds -lt $(if($Scenarios){10000}else{3000})
  if(-not $timely -and $attempt -lt 3){
   Trace "pair $Name timing-rejected-$attempt intervalMs=$(($frames.SecondUtc-$frames.FirstUtc).TotalMilliseconds)"
   $captures.Add(@{name="$Name-timing-rejected-$attempt-a";image=$frames.A});$captures.Add(@{name="$Name-timing-rejected-$attempt-b";image=$frames.B})
  }
 } while(-not $timely -and $attempt -lt 3)
 $captures.Add(@{name="$Name-a";image=$frames.A});$captures.Add(@{name="$Name-b";image=$frames.B})
 Trace "pair $Name end"
 return $frames
}
function Pair([string]$Name,[bool]$Frozen=$false) {
 $r=New-Object Desktop+Rect
 if(-not [Desktop]::GetWindowRect($hwnd,[ref]$r) -or $r.Right -le $r.Left -or $r.Bottom -le $r.Top){throw 'Prexu window vanished or has no measurable area'}
 # Central half excludes chrome, cursor, subtitles, and window borders.
 $x=[int]($r.Left+($r.Right-$r.Left)*0.25)-$screen.X
 $y=[int]($r.Top+($r.Bottom-$r.Top)*0.30)-$screen.Y
 $w=[int](($r.Right-$r.Left)*0.50);$h=[int](($r.Bottom-$r.Top)*0.40)
 $frames=CapturePair $Name;$a=$frames.A;$b=$frames.B;$first=$frames.FirstUtc;$second=$frames.SecondUtc
  $m=[Desktop]::Measure($a,$b,$x,$y,$w,$h)
  $pass=$m[0] -gt .50 -and $m[1] -gt .15 -and $m[4] -gt .50 -and $m[5] -gt .15 -and $(if($Frozen){$m[2] -lt .002}else{$m[2] -gt .005})
  $pass=$pass -and ($second-$first).TotalMilliseconds -ge 1000 -and ($second-$first).TotalMilliseconds -lt 3000
  if($Name -eq 'baseline' -or $Name.StartsWith('scale-') -or $Name.StartsWith('monitor-')) {
   $client=New-Object Desktop+Rect;[Desktop]::GetClientRect($hwnd,[ref]$client) | Out-Null
   $origin=New-Object Drawing.Point;[Desktop]::ClientToScreen($hwnd,[ref]$origin) | Out-Null
   $bars=[Desktop]::PatternBounds($a,$r.Right,$r.Bottom,[int]($client.Right*.8),[int]($client.Right*1.05))
   $geometry=@((($bars.X-$origin.X)/[double]$client.Right),(($bars.Y-$origin.Y)/[double]$client.Bottom),($bars.Width/[double]$client.Right),($bars.Height/[double]$client.Bottom))
   $aligned=-not $bars.IsEmpty -and $geometry[0] -lt .04 -and $geometry[0] -gt -.02 -and $geometry[2] -gt .94
   if($Name -eq 'baseline'){$script:baselineGeometry=$geometry}
   elseif($script:baselineGeometry){for($i=0;$i -lt 4;$i++){if([Math]::Abs($geometry[$i]-$script:baselineGeometry[$i]) -gt .06){$aligned=$false}}}
   $results.Add(@{name="$Name-video-bounds";pass=$aligned;normalizedBounds=$geometry})
  }
  $results.Add(@{name=$Name;pass=$pass;roi=@($x,$y,$w,$h);lit=$m[0];saturated=$m[1];litB=$m[4];saturatedB=$m[5];changed=$m[2];meanDelta=$m[3];dpi=[Desktop]::GetDpiForWindow($hwnd);window=@($r.Left,$r.Top,$r.Right,$r.Bottom);expectFrozen=$Frozen;firstUtc=$first.ToString("o");secondUtc=$second.ToString("o");intervalMs=($second-$first).TotalMilliseconds})
 ConvertTo-Json -InputObject ($results.ToArray()) -Depth 5 | Set-Content "$Output\metrics.json"
}
function Stage([string]$Name) {
 Trace "stage $Name begin"
 Set-Content "$Output\stage" $Name
 Javascript "(async()=>{await window.__TAURI_INTERNALS__.invoke('player_seek',{seconds:5});await window.__TAURI_INTERNALS__.invoke('player_play');return true})()" | Out-Null
 Start-Sleep -Milliseconds 500
}
function Controls([string]$Name) {
 $r=New-Object Desktop+Rect;if(-not [Desktop]::GetWindowRect($hwnd,[ref]$r) -or $r.Right -le $r.Left -or $r.Bottom -le $r.Top){throw 'Prexu window vanished or has no measurable area'}
 [Desktop]::SetCursorPos([int](($r.Left+$r.Right)/2),$r.Bottom-65) | Out-Null
 Start-Sleep -Milliseconds 500
 Trace "controls $Name"
 $point=Javascript "(()=>{const b=document.querySelector('button[aria-label=`"Pause`"]');if(!b)throw Error('Pause control missing');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()"
 $origin=New-Object Drawing.Point;[Desktop]::ClientToScreen($hwnd,[ref]$origin) | Out-Null
 $scale=[Desktop]::GetDpiForWindow($hwnd)/96.0
 $buttonX=[int]($origin.X+$point.x*$scale);$buttonY=[int]($origin.Y+$point.y*$scale)
 [Desktop]::SetCursorPos($buttonX,$buttonY) | Out-Null
 [Desktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[Desktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 [Desktop]::SetCursorPos(5,790) | Out-Null
 Start-Sleep -Seconds 4
 Pair "controls-$Name-paused" $true
 [Desktop]::SetCursorPos($buttonX,$buttonY) | Out-Null
 Start-Sleep -Milliseconds 500
 [Desktop]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[Desktop]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 [Desktop]::SetCursorPos(5,790) | Out-Null
 Start-Sleep -Seconds 4
 Pair "controls-$Name-resumed"
}
try {
 if($Scenarios) { . "$PSScriptRoot\scenarios.ps1"; return }
 Stage 'baseline'
 Start-Sleep -Seconds 3
 Pair 'baseline'
 Stage 'alt-tab'
 [Desktop]::ShowWindow($nh,9) | Out-Null
 [Desktop]::SetWindowPos($nh,[IntPtr]::Zero,100,100,800,500,0x0040) | Out-Null
 [Desktop]::SetForegroundWindow($hwnd) | Out-Null
 Start-Sleep -Milliseconds 500
 [Desktop]::Key(18,$false); [Desktop]::Key(9,$false); [Desktop]::Key(9,$true)
 Start-Sleep -Seconds 2
 $frames=CapturePair 'alt-tab';$a=$frames.A;$b=$frames.B;$first=$frames.FirstUtc;$second=$frames.SecondUtc
 $tile=[Desktop]::PatternBounds($a,1280,750,150,500)
 if($tile.IsEmpty){$results.Add(@{name='alt-tab';pass=$false;reason='No six-stripe video tile found'})}
 else {
  $m=[Desktop]::Measure($a,$b,$tile.X+10,$tile.Y+10,$tile.Width-20,$tile.Height-20)
  $results.Add(@{name='alt-tab';pass=($m[0] -gt .5 -and $m[1] -gt .15 -and $m[4] -gt .5 -and $m[5] -gt .15 -and $m[2] -gt .005 -and ($second-$first).TotalMilliseconds -lt 3000);roi=@(($tile.X+10),($tile.Y+10),($tile.Width-20),($tile.Height-20));lit=$m[0];saturated=$m[1];litB=$m[4];saturatedB=$m[5];changed=$m[2];intervalMs=($second-$first).TotalMilliseconds})
 }

 [Desktop]::Key(18,$true)
 Start-Sleep -Milliseconds 500
 $results.Add(@{name="away-focus";pass=([Desktop]::GetForegroundWindow() -eq $nh)})
 # A real Alt+Tab back, without clicking or forcibly restoring app focus.
 [Desktop]::Key(18,$false);[Desktop]::Key(9,$false);[Desktop]::Key(9,$true);[Desktop]::Key(18,$true)
 Start-Sleep -Seconds 2
 $results.Add(@{name='return-focus';pass=([Desktop]::GetForegroundWindow() -eq $hwnd)})
 Pair 'return'
 [Desktop]::Key(32,$false);[Desktop]::Key(32,$true)
 Start-Sleep -Seconds 2
 Pair 'space-paused' $true
 [Desktop]::Key(32,$false);[Desktop]::Key(32,$true)
 Start-Sleep -Seconds 2
 Pair 'space-resumed'
 Stage 'occlusion'
 [Desktop]::SetForegroundWindow($nh) | Out-Null
 Start-Sleep -Seconds 2
 $b=Capture 'occluded'
 $results.Add(@{name='occlusion-focus';pass=([Desktop]::GetForegroundWindow() -eq $nh)})
 [Desktop]::ShowWindow($nh,6) | Out-Null
 [Desktop]::SetForegroundWindow($hwnd) | Out-Null
 Start-Sleep -Seconds 2
 Pair 'uncovered'
 [Desktop]::ShowWindow($hwnd,6) | Out-Null
 Start-Sleep -Seconds 2
 $b=Capture 'minimized'
 $results.Add(@{name='minimize-state';pass=[Desktop]::IsIconic($hwnd)})
 [Desktop]::ShowWindow($hwnd,9) | Out-Null
 [Desktop]::SetForegroundWindow($hwnd) | Out-Null
 Start-Sleep -Seconds 2
 Pair 'restored'
 foreach($scale in @(150,100)) {
  Stage "scale-$scale"
  & C:\ProgramData\EvalBuild\display.ps1 -Monitor 1 -Width 1920 -Height 1080 -Scale $scale -OutFile "$Output\scale-$scale.txt"
  Start-Sleep -Seconds 3
  Pair "scale-$scale"
  $results.Add(@{name="scale-$scale-dpi";pass=([Desktop]::GetDpiForWindow($hwnd) -eq [int]($scale*.96))})
  Controls "scale-$scale"
 }
 & C:\ProgramData\EvalBuild\display.ps1 -Monitor 1 -Width 1280 -Height 800 -Scale 100 -OutFile "$Output\restore-display.txt"
 foreach($move in @(@{name='monitor-2';x=1380;y=80},@{name='monitor-1';x=40;y=40})) {
  Stage $move.name
  [Desktop]::SetWindowPos($hwnd,[IntPtr]::Zero,$move.x,$move.y,1000,600,0x4040) | Out-Null
  Start-Sleep -Seconds 3
  Pair $move.name
  $expectedDpi=if($move.name -eq "monitor-2"){144}else{96}
  $results.Add(@{name="$($move.name)-dpi";pass=([Desktop]::GetDpiForWindow($hwnd) -eq $expectedDpi)})
  Controls $move.name
 }
} catch {
 $_ | Out-String | Set-Content "$Output\error.txt"
 throw
} finally {
 [Desktop]::Key(18,$true)
 [Desktop]::StopPointer()
 # Sampling is complete; stop software rendering before encoding PNG evidence.
 try {Javascript "window.__TAURI_INTERNALS__.invoke('player_pause')" | Out-Null} catch {}
 $socket.Dispose()
 Set-Content "$Output\stage" "done"
 if($note){$note.CloseMainWindow() | Out-Null}
 ConvertTo-Json -InputObject ($results.ToArray()) -Depth 5 | Set-Content "$Output\metrics.json"
 foreach($capture in $captures) {$capture.image.Save("$Output\$($capture.name).png",[System.Drawing.Imaging.ImageFormat]::Png);$capture.image.Dispose()}
 Set-Content "$Output\complete" "complete"
}
