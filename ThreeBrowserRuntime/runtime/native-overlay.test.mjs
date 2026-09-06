import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = fileURLToPath(new URL('../build/bin/', import.meta.url));
test('native FPS crop has pixels and survives transparent HTML composition and toggle off', {
  skip: process.platform !== 'win32' || !fs.existsSync(path.join(directory, 'three_webgpu.dll')),
}, () => {
  const dll = path.join(directory, 'three_webgpu.dll').replaceAll('\\', '/');
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OverlayTest {
[DllImport("${dll}")] public static extern void tw_set_loading(int on, string stage);
[DllImport("${dll}")] public static extern void tw_toggle_fps_overlay();
[DllImport("${dll}")] public static extern void tw_overlay_bounds(int w,int h,out int x,out int y,out int rw,out int rh);
[DllImport("${dll}")] public static extern IntPtr tw_overlay_raster(int w,int h,int fps,int us,string backend,int backlog,ulong packets,out int stride);
[DllImport("${dll}")] public static extern int tw_canvas_overlay_set(int visible,int left,int top,int w,int h,int sw,int sh,byte[] rgba,int stride);
}
'@
[OverlayTest]::tw_set_loading(0, '')
[OverlayTest]::tw_toggle_fps_overlay()
[int]$x=0; [int]$y=0; [int]$w=0; [int]$h=0; [int]$stride=0
[OverlayTest]::tw_overlay_bounds(1280,720,[ref]$x,[ref]$y,[ref]$w,[ref]$h)
$pixels=[OverlayTest]::tw_overlay_raster(1280,720,60,16667,'test',0,1,[ref]$stride)
$bytes=[byte[]]::new($stride*$h)
[Runtime.InteropServices.Marshal]::Copy($pixels,$bytes,0,$bytes.Length)
$count=0
for($i=3;$i -lt $bytes.Length;$i+=4){if($bytes[$i] -gt 0){$count++}}
if($count -lt 100){throw 'FPS crop is blank'}
$page=[byte[]]::new(1280*720*4)
$accepted=[OverlayTest]::tw_canvas_overlay_set(1,0,0,1280,720,1280,720,$page,1280*4)
if($accepted -ne 1){throw 'Canvas overlay rejected'}
$pixels=[OverlayTest]::tw_overlay_raster(1280,720,60,16667,'test',0,1,[ref]$stride)
$alpha=[Runtime.InteropServices.Marshal]::ReadByte($pixels,($y+10)*$stride+($x+10)*4+3)
if($alpha -eq 0){throw 'Transparent canvas erased FPS counter'}
$before=[byte[]]::new(4)
[Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($pixels,($y+10)*$stride+($x+10)*4),$before,0,4)
for($i=3;$i -lt $page.Length;$i+=4){$page[$i]=255}
$accepted=[OverlayTest]::tw_canvas_overlay_set(1,0,0,1280,720,1280,720,$page,1280*4)
$pixels=[OverlayTest]::tw_overlay_raster(1280,720,60,16667,'test',0,1,[ref]$stride)
$after=[byte[]]::new(4)
[Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($pixels,($y+10)*$stride+($x+10)*4),$after,0,4)
for($channel=0;$channel -lt 3;$channel++){
  $expected=[Math]::Round($before[$channel]*$before[3]/255.0)
  if([Math]::Abs($after[$channel]-$expected) -gt 1){throw 'Opaque page painted above FPS counter'}
}
if($after[3] -ne 255){throw 'Opaque page alpha was lost'}
$page=[byte[]]::new(1280*720*4)
$accepted=[OverlayTest]::tw_canvas_overlay_set(1,0,0,1280,720,1280,720,$page,1280*4)
[OverlayTest]::tw_toggle_fps_overlay()
$pixels=[OverlayTest]::tw_overlay_raster(1280,720,60,16667,'test',0,1,[ref]$stride)
$alpha=[Runtime.InteropServices.Marshal]::ReadByte($pixels,($y+10)*$stride+($x+10)*4+3)
if($alpha -ne 0){throw 'FPS counter remains after toggle off'}
Write-Output 'overlay pixels verified'
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
    env: { ...process.env, PATH: `${directory};${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /overlay pixels verified/);
});
