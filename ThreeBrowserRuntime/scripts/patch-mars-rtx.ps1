param(
    [Parameter(Mandatory = $true)]
    [string] $ProjectRoot
)

$ErrorActionPreference = 'Stop'

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$mainPath = Join-Path $resolvedRoot 'assets\main-B3EsgaLH.mjs'
$moduleSource = Join-Path $PSScriptRoot '..\runtime\mars-rtx-lighting.mjs'
$moduleDestination = Join-Path $resolvedRoot 'mars-rtx-lighting.mjs'

if (-not (Test-Path -LiteralPath $mainPath -PathType Leaf)) {
    throw "Mars main module was not found: $mainPath"
}
if (-not (Test-Path -LiteralPath $moduleSource -PathType Leaf)) {
    throw "Mars RTX runtime module was not found: $moduleSource"
}

$backupPath = "$mainPath.before-rtx-override"
if (-not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $mainPath -Destination $backupPath
}
Copy-Item -LiteralPath $moduleSource -Destination $moduleDestination -Force

$source = [IO.File]::ReadAllText($mainPath)
$newline = if ($source.Contains("`r`n")) { "`r`n" } else { "`n" }

function Normalize-Newlines([string] $value) {
    return ($value -replace "`r?`n", $newline).TrimEnd("`r", "`n")
}

function Replace-ExactlyOnce([string] $oldText, [string] $newText) {
    $oldText = Normalize-Newlines $oldText
    $newText = Normalize-Newlines $newText
    $count = ([regex]::Matches($script:source, [regex]::Escape($oldText))).Count
    if ($count -ne 1) {
        $previewLength = [Math]::Min(100, $oldText.Length)
        throw "Expected one patch match, found $count for: $($oldText.Substring(0, $previewLength))"
    }
    $script:source = $script:source.Replace($oldText, $newText)
}

Replace-ExactlyOnce `
    '$F = {exposureEV: SO(2.25), lutIntensity: SO(0), vignette: SO(.05), dither: SO(1)}' `
    '$F = {exposureEV: SO(.85), lutIntensity: SO(1), vignette: SO(.08), dither: SO(1)}'

Replace-ExactlyOnce `
    't.environment = d.fromScene(u, .03, 1, 90).texture, t.environmentIntensity = 1.2, d.dispose(), this.fixtures = wfe(e)' `
    't.environment = d.fromScene(u, .03, 1, 90).texture, t.environmentIntensity = LO, d.dispose(), this.fixtures = wfe(e)'

Replace-ExactlyOnce @'
  let c = new Rn;
  c.add(new ho(0xffd8c2, 2));
  c.add(new ste(0xffc08a, 0x3b2118, 1.5));
'@ @'
  let c = new Rn;
'@

Replace-ExactlyOnce @'
  pipeline = null;
  appliedScale = 1;
'@ @'
  pipeline = null;
  nativeRtxRequested = !1;
  nativeRtxState = null;
  appliedScale = 1;
'@

Replace-ExactlyOnce @'
    t.toneMapping = 0;
    let a = gle(n, r, {samples: 4});
    a.transparent = !1, a.renderTarget.depthTexture && (a.renderTarget.depthTexture.type = b);
    let o = RD({output: qD, normal: DO(UD, 1)});
'@ @'
    t.toneMapping = 0;
    this.nativeRtxRequested = Boolean(navigator.gpu?.threeBrowserRTX?.capabilities?.nativeRayTracing);
    let a = gle(n, r, {samples: this.nativeRtxRequested ? 0 : 4});
    a.transparent = !1, a.renderTarget.depthTexture && (a.renderTarget.depthTexture.type = b);
    if (this.nativeRtxRequested) {
      a.renderTarget.texture.isStorageTexture = !0;
      a.renderTarget.texture.generateMipmaps = !1
    }
    let o = RD({output: this.nativeRtxRequested ? W.diffuseColor : qD, normal: DO(UD, 1)});
'@

Replace-ExactlyOnce @'
  render() {
    this.pipeline?.render()
  }
'@ @'
  _restoreRasterLighting() {
    if (!this.scenePass) return;
    let e = RD({output: qD, normal: DO(UD, 1)});
    e.setBlendMode(`normal`, new $y(1)), this.scenePass.setMRT(e), this.nativeRtxRequested = !1
  }
  async enableNativeRtx(e, t) {
    if (!this.nativeRtxRequested || !this.scenePass) return !1;
    try {
      let {attachMarsRtxLighting: n} = await import(`../mars-rtx-lighting.mjs`);
      this.nativeRtxState = await n({
        renderer: this.context.renderer,
        scene: e,
        camera: t,
        passNode: this.scenePass,
        sunDirection: [MO.x, MO.y, MO.z]
      });
      if (!this.nativeRtxState?.active)
        throw Error(this.nativeRtxState?.reason ?? `RTX lighting unavailable`);
      return !0
    } catch (e) {
      console.error(`[Mars RTX] setup failed`, e), this.nativeRtxState = null, this._restoreRasterLighting();
      return !1
    }
  }
  render() {
    this.pipeline?.render()
  }
'@

Replace-ExactlyOnce @'
  p.lateUpdate(u, 0, 0);
  let b = async () => {
'@ @'
  p.lateUpdate(u, 0, 0);
  K9 = `native-rtx-lighting`, await m.enableNativeRtx(c, l), o();
  let b = async () => {
'@

[IO.File]::WriteAllText($mainPath, $source, [Text.UTF8Encoding]::new($false))
Write-Output 'Installed Mars native RTX lighting override and restored the authored exposure/grade.'
