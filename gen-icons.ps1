# Regenerate toolbar icons as the Dopamine Toll "countdown gauge" primary mark:
# a warm near-black rounded tile, faint ring track, ~234deg amber arc, center dot.
# Geometry matches the logo SVG (viewBox 72: cx/cy 36, r 28, stroke 6, dot r 7).
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
  $ss  = 8
  $big = $size * $ss
  $bmp = New-Object System.Drawing.Bitmap $big, $big
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $big / 72.0

  # rounded background tile (#0a0908)
  $radius = 16 * $scale
  $d = $radius * 2
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $d, $d, 180, 90)
  $gp.AddArc($big - $d, 0, $d, $d, 270, 90)
  $gp.AddArc($big - $d, $big - $d, $d, $d, 0, 90)
  $gp.AddArc(0, $big - $d, $d, $d, 90, 90)
  $gp.CloseFigure()
  $brushBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 9, 8))
  $g.FillPath($brushBg, $gp)

  $cx = 36 * $scale
  $cy = 36 * $scale
  $r  = 28 * $scale
  $sw = 6 * $scale
  $arcX = $cx - $r
  $arcY = $cy - $r
  $arcD = $r * 2

  # ring track (#2a2419)
  $penTrack = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 42, 36, 25)), $sw
  $g.DrawEllipse($penTrack, $arcX, $arcY, $arcD, $arcD)

  # amber progress arc (#e9a24c), round caps, ~234deg from top
  $amber = [System.Drawing.Color]::FromArgb(255, 233, 162, 76)
  $penArc = New-Object System.Drawing.Pen $amber, $sw
  $penArc.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penArc.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($penArc, $arcX, $arcY, $arcD, $arcD, -90, 234)

  # center dot
  $dotR = 7 * $scale
  $brushDot = New-Object System.Drawing.SolidBrush $amber
  $g.FillEllipse($brushDot, ($cx - $dotR), ($cy - $dotR), ($dotR * 2), ($dotR * 2))

  # downscale to the target size
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g2.Clear([System.Drawing.Color]::Transparent)
  $g2.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose(); $bmp.Dispose(); $g2.Dispose(); $out.Dispose()
  $penTrack.Dispose(); $penArc.Dispose(); $brushDot.Dispose(); $brushBg.Dispose(); $gp.Dispose()
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Icon 16  (Join-Path $here "assets\icon16.png")
New-Icon 48  (Join-Path $here "assets\icon48.png")
New-Icon 128 (Join-Path $here "assets\icon128.png")
Write-Output "icons regenerated"
