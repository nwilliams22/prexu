param([string]$Output = "C:\Users\baddong\qa-composition\probe.txt")
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Probe {
 [DllImport("d3d11.dll", CallingConvention=CallingConvention.StdCall)]
 public static extern int D3D11CreateDevice(IntPtr adapter, uint driverType, IntPtr software, uint flags, IntPtr levels, uint count, uint sdk, out IntPtr device, out uint level, out IntPtr context);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Desc {
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string Description;
  public uint VendorId,DeviceId,SubSysId,Revision;
  public UIntPtr VideoMemory,SystemMemory,SharedMemory;
  public uint LuidLow; public int LuidHigh;
 }
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetAdapter(IntPtr self,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc(IntPtr self,out Desc desc);
 public static string Run() {
  IntPtr device, context; uint level;
  int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out device, out level, out context);
  string adapterName="none";IntPtr dxgi=IntPtr.Zero,adapter=IntPtr.Zero;
  try {
   if(hr>=0){
    Guid iid=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device,ref iid,out dxgi));
    var getAdapter=(GetAdapter)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(dxgi),7*IntPtr.Size),typeof(GetAdapter));
    Marshal.ThrowExceptionForHR(getAdapter(dxgi,out adapter));
    var getDesc=(GetDesc)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(adapter),8*IntPtr.Size),typeof(GetDesc));
    Desc desc;Marshal.ThrowExceptionForHR(getDesc(adapter,out desc));adapterName=desc.Description;
   }
  } finally {if(adapter!=IntPtr.Zero)Marshal.Release(adapter);if(dxgi!=IntPtr.Zero)Marshal.Release(dxgi);}
  if(context != IntPtr.Zero) Marshal.Release(context);
  if(device != IntPtr.Zero) Marshal.Release(device);
  return "D3D11CreateDevice(HARDWARE,BGRA_SUPPORT): HRESULT=0x" + ((uint)hr).ToString("X8") + "; featureLevel=0x" + level.ToString("X") + "; adapter=" + adapterName;
 }
}
'@
$result=[Probe]::Run()
$result | Set-Content $Output
Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,Status | Format-List | Out-String | Add-Content $Output

if($result -notmatch "HRESULT=0x00000000") {exit 1}
