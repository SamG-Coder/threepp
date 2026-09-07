import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = fileURLToPath(new URL('../build/bin/', import.meta.url));

test('Adaptive Geometry preserves hierarchy boundaries and refines GPU detail with distance', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1' || process.platform !== 'win32',
}, () => {
  const executable = path.join(directory, 'three_adaptive_geometry_smoke.exe');
  assert.ok(fs.existsSync(executable), 'Build the three_adaptive_geometry_smoke target');
  const result = spawnSync(executable, [], {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, PATH: `${directory};${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Adaptive Geometry smoke passed/);
});

test('Virtual Geometry native pixel parity, instancing, MSAA and invalidation', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1' || process.platform !== 'win32',
}, () => {
  const executable = path.join(directory, 'three_virtual_geometry_smoke.exe');
  assert.ok(fs.existsSync(executable), 'Build the three_virtual_geometry_smoke target');
  const result = spawnSync(executable, [], {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, PATH: `${directory};${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Virtual Geometry smoke passed/);
});

test('Virtual Geometry menu toggle handles capability, clicking, resize and raster invalidation', {
  skip: process.platform !== 'win32' || !fs.existsSync(path.join(directory, 'three_webgpu.dll')),
}, () => {
  const dll = path.join(directory, 'three_webgpu.dll').replaceAll('\\', '/');
  const script = `
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GeometryMenu {
[DllImport("${dll}")] public static extern void tw_set_loading(int on,string stage);
[DllImport("${dll}")] public static extern void tw_set_overlay(int on);
[DllImport("${dll}")] public static extern void tw_set_virtual_geometry_supported(int on);
[DllImport("${dll}")] public static extern void tw_set_virtual_geometry(int on);
[DllImport("${dll}")] public static extern int tw_virtual_geometry_enabled();
[DllImport("${dll}")] public static extern void tw_overlay_click(int x,int y);
[DllImport("${dll}")] public static extern ulong tw_overlay_revision();
[DllImport("${dll}")] public static extern void tw_overlay_bounds(int w,int h,out int x,out int y,out int rw,out int rh);
[DllImport("${dll}")] public static extern IntPtr tw_overlay_raster(int w,int h,int fps,int us,string backend,int backlog,ulong packets,out int stride);
}
'@
[GeometryMenu]::tw_set_loading(0,'')
[GeometryMenu]::tw_set_overlay(1)
[GeometryMenu]::tw_set_virtual_geometry_supported(0)
[GeometryMenu]::tw_set_virtual_geometry(1)
if([GeometryMenu]::tw_virtual_geometry_enabled() -ne 0){throw 'Unsupported mode enabled'}
[GeometryMenu]::tw_set_virtual_geometry_supported(1)
foreach($size in @(@(1280,720),@(640,480),@(1600,900))) {
  $width=$size[0]; $height=$size[1]; [int]$stride=0
  $pixels=[GeometryMenu]::tw_overlay_raster($width,$height,60,16667,'GL 4.3',0,0,[ref]$stride)
  if($pixels -eq [IntPtr]::Zero){throw 'Menu raster missing'}
  $revision=[GeometryMenu]::tw_overlay_revision()
  $panelHeight=[Math]::Min(680,[Math]::Max(360,$height-40))
  $top=[Math]::Max(20,($height-$panelHeight)/2)
  $buttonY=$top+96+18+255
  [GeometryMenu]::tw_overlay_click($width/2,$buttonY)
  if([GeometryMenu]::tw_virtual_geometry_enabled() -ne 1){throw 'Menu click missed toggle'}
  $pixels=[GeometryMenu]::tw_overlay_raster($width,$height,60,16667,'GL 4.3',0,0,[ref]$stride)
  if([GeometryMenu]::tw_overlay_revision() -le $revision){throw 'Toggle did not invalidate raster'}
  [int]$rx=0; [int]$ry=0; [int]$rw=0; [int]$rh=0
  [GeometryMenu]::tw_overlay_bounds($width,$height,[ref]$rx,[ref]$ry,[ref]$rw,[ref]$rh)
  $panelWidth=[Math]::Min(680,[Math]::Max(340,$width-40))
  $panelLeft=[Math]::Max(20,($width-$panelWidth)/2)
  $knobX=$panelLeft+$panelWidth-24-14-14+5
  foreach($offsetY in @(-3,3)) {
    $offset=($buttonY+$offsetY-$ry)*$stride+($knobX-$rx)*4
    foreach($channel in 0..2) {
      if([Runtime.InteropServices.Marshal]::ReadByte($pixels,$offset+$channel) -lt 240){throw 'Toggle knob is vertically squashed'}
    }
  }
  [GeometryMenu]::tw_overlay_click($width/2,$buttonY)
  if([GeometryMenu]::tw_virtual_geometry_enabled() -ne 0){throw 'Menu click did not turn off'}
}
[GeometryMenu]::tw_set_virtual_geometry(1)
[GeometryMenu]::tw_set_virtual_geometry_supported(0)
if([GeometryMenu]::tw_virtual_geometry_enabled() -ne 0){throw 'Backend capability change retained unsupported mode'}
Write-Output 'menu toggle verified'
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
    env: { ...process.env, PATH: `${directory};${process.env.PATH}` },
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /menu toggle verified/);
});
