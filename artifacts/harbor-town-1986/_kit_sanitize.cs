using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

/// Deterministic chroma sanitation + scale-lock for harbor_town_1986 modular kit.
/// 1) conservative central subject bbox
/// 2) force exact #E040A0 outside an expanded safe box (kills watermark/panel/residue)
/// 3) inside: only replace bg pixels 4-connected to the outer key field
/// 4) one subject; 5) lock silhouette height + baseline across the four yaws
internal static class KitSanitize {
    const int KR = 224, KG = 64, KB = 160;
    const int CANVAS = 1024;
    const int KEY_DIST2 = 58 * 58;
    const int SAFE_PAD = 32;
    const int MIN_COMP_PX = 80;
    const double DUP_RATIO = 0.22;
    const int MAX_W = 980;

    struct Px { public byte B, G, R, A; }

    static bool IsKey(byte r, byte g, byte b) {
        int dr = r - KR, dg = g - KG, db = b - KB;
        return dr * dr + dg * dg + db * db < KEY_DIST2;
    }

    static bool IsWhite(byte r, byte g, byte b) {
        return r >= 232 && g >= 232 && b >= 232;
    }

    static bool IsBg(byte r, byte g, byte b) {
        if (IsKey(r, g, b) || IsWhite(r, g, b)) return true;
        // dark-magenta generation panels (desaturated / darker cousins of the key)
        int dr = r - KR, dg = g - KG, db = b - KB;
        int dist2 = dr * dr + dg * dg + db * db;
        if (dist2 < 95 * 95 && r > 140 && b > 90 && g < r && b >= g) return true;
        return false;
    }

    static Bitmap ToCanvas(Bitmap src) {
        var dst = new Bitmap(CANVAS, CANVAS, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst)) {
            g.Clear(Color.FromArgb(255, KR, KG, KB));
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            if (src.Width == CANVAS && src.Height == CANVAS) {
                g.DrawImage(src, 0, 0, CANVAS, CANVAS);
            } else {
                // contain-fit, centered
                float s = Math.Min((float)CANVAS / src.Width, (float)CANVAS / src.Height);
                int w = Math.Max(1, (int)Math.Round(src.Width * s));
                int h = Math.Max(1, (int)Math.Round(src.Height * s));
                int x = (CANVAS - w) / 2;
                int y = (CANVAS - h) / 2;
                g.DrawImage(src, x, y, w, h);
            }
        }
        return dst;
    }

    static Px[] Lock(Bitmap bmp, out BitmapData data) {
        data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
            ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        var buf = new Px[data.Width * data.Height];
        int span = Math.Abs(data.Stride);
        var tmp = new byte[span * data.Height];
        Marshal.Copy(data.Scan0, tmp, 0, tmp.Length);
        int w = data.Width;
        for (int y = 0; y < data.Height; y++) {
            int row = y * span;
            for (int x = 0; x < w; x++) {
                int i = row + x * 4;
                buf[y * w + x] = new Px { B = tmp[i], G = tmp[i + 1], R = tmp[i + 2], A = tmp[i + 3] };
            }
        }
        return buf;
    }

    static void Unlock(Bitmap bmp, BitmapData data, Px[] buf) {
        int span = Math.Abs(data.Stride);
        var tmp = new byte[span * data.Height];
        int w = data.Width;
        for (int y = 0; y < data.Height; y++) {
            int row = y * span;
            for (int x = 0; x < w; x++) {
                int i = row + x * 4;
                var p = buf[y * w + x];
                tmp[i] = p.B; tmp[i + 1] = p.G; tmp[i + 2] = p.R; tmp[i + 3] = 255;
            }
        }
        Marshal.Copy(tmp, 0, data.Scan0, tmp.Length);
        bmp.UnlockBits(data);
    }

    struct Comp {
        public int Id, Count, X0, Y0, X1, Y1, Cx, Cy;
    }

    static List<Comp> Components(Px[] buf, int w, int h, int[] lab) {
        var comps = new List<Comp>();
        int next = 1;
        var qx = new int[w * h];
        var qy = new int[w * h];
        int[] dx = { 1, -1, 0, 0 };
        int[] dy = { 0, 0, 1, -1 };
        for (int i = 0; i < lab.Length; i++) lab[i] = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                if (lab[i] != 0) continue;
                var p = buf[i];
                if (IsBg(p.R, p.G, p.B)) { lab[i] = -1; continue; }
                int head = 0, tail = 0;
                qx[tail] = x; qy[tail] = y; tail++;
                lab[i] = next;
                int cnt = 0, x0 = x, y0 = y, x1 = x, y1 = y, sx = 0, sy = 0;
                while (head < tail) {
                    int cx = qx[head], cy = qy[head]; head++;
                    cnt++; sx += cx; sy += cy;
                    if (cx < x0) x0 = cx; if (cy < y0) y0 = cy;
                    if (cx > x1) x1 = cx; if (cy > y1) y1 = cy;
                    for (int k = 0; k < 4; k++) {
                        int nx = cx + dx[k], ny = cy + dy[k];
                        if ((uint)nx >= (uint)w || (uint)ny >= (uint)h) continue;
                        int ni = ny * w + nx;
                        if (lab[ni] != 0) continue;
                        var np = buf[ni];
                        if (IsBg(np.R, np.G, np.B)) { lab[ni] = -1; continue; }
                        lab[ni] = next;
                        qx[tail] = nx; qy[tail] = ny; tail++;
                    }
                }
                if (cnt >= MIN_COMP_PX) {
                    comps.Add(new Comp {
                        Id = next, Count = cnt,
                        X0 = x0, Y0 = y0, X1 = x1, Y1 = y1,
                        Cx = sx / cnt, Cy = sy / cnt
                    });
                }
                next++;
            }
        }
        comps.Sort((a, b) => b.Count.CompareTo(a.Count));
        return comps;
    }

    static void ForceKey(Px[] buf, int i) {
        buf[i].R = KR; buf[i].G = KG; buf[i].B = KB; buf[i].A = 255;
    }

    struct San {
        public Bitmap Bmp;
        public int X0, Y0, X1, Y1, W, H, SubPx, NComp;
        public string Warn;
    }

    static San SanitizeOne(string path) {
        using (var loaded = (Bitmap)Image.FromFile(path))
        using (var src = new Bitmap(loaded)) {
            var bmp = ToCanvas(src);
            BitmapData data;
            var buf = Lock(bmp, out data);
            int w = CANVAS, h = CANVAS;
            var lab = new int[w * h];
            var comps = Components(buf, w, h, lab);
            var san = new San { Bmp = bmp, Warn = "" };

            if (comps.Count == 0) {
                san.Warn = "NO_SUBJECT";
                Unlock(bmp, data, buf);
                return san;
            }

            // pick the largest reasonably central component (avoid BR watermark glyphs)
            Comp primary = comps[0];
            for (int i = 0; i < comps.Count; i++) {
                var c = comps[i];
                bool watermarkZone = c.Y0 > 900 && c.X0 > 750;
                if (watermarkZone) continue;
                // prefer the component closest to canvas center among the large ones
                primary = c;
                break;
            }
            int large = 0;
            foreach (var c in comps) {
                bool watermarkZone = c.Y0 > 900 && c.X0 > 750;
                if (watermarkZone) continue;
                if (c.Count >= MIN_COMP_PX) large++;
                if (c.Id != primary.Id && c.Count > primary.Count * DUP_RATIO && c.Count > 400)
                    san.Warn += "DUP ";
            }
            san.NComp = large;

            int x0 = primary.X0, y0 = primary.Y0, x1 = primary.X1, y1 = primary.Y1;
            int sx0 = Math.Max(0, x0 - SAFE_PAD);
            int sy0 = Math.Max(0, y0 - SAFE_PAD);
            int sx1 = Math.Min(w - 1, x1 + SAFE_PAD);
            int sy1 = Math.Min(h - 1, y1 + SAFE_PAD);

            // 2) outside expanded box: force exact key
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    if (x < sx0 || x > sx1 || y < sy0 || y > sy1)
                        ForceKey(buf, y * w + x);
                }
            }

            // 3) inside: flood bg pixels connected to the outer key field
            var qx = new int[w * h];
            var qy = new int[w * h];
            var seen = new bool[w * h];
            int head = 0, tail = 0;
            // seed from the inner rim of the safe box (already keyed outside, so rim bg is outer-connected)
            for (int x = sx0; x <= sx1; x++) {
                int i0 = sy0 * w + x; if (!seen[i0]) { seen[i0] = true; qx[tail] = x; qy[tail] = sy0; tail++; }
                int i1 = sy1 * w + x; if (!seen[i1]) { seen[i1] = true; qx[tail] = x; qy[tail] = sy1; tail++; }
            }
            for (int y = sy0; y <= sy1; y++) {
                int i0 = y * w + sx0; if (!seen[i0]) { seen[i0] = true; qx[tail] = sx0; qy[tail] = y; tail++; }
                int i1 = y * w + sx1; if (!seen[i1]) { seen[i1] = true; qx[tail] = sx1; qy[tail] = y; tail++; }
            }
            for (int x = 0; x < w; x++) {
                int i0 = x; if (!seen[i0]) { seen[i0] = true; qx[tail] = x; qy[tail] = 0; tail++; }
                int i1 = (h - 1) * w + x; if (!seen[i1]) { seen[i1] = true; qx[tail] = x; qy[tail] = h - 1; tail++; }
            }
            for (int y = 0; y < h; y++) {
                int i0 = y * w; if (!seen[i0]) { seen[i0] = true; qx[tail] = 0; qy[tail] = y; tail++; }
                int i1 = y * w + (w - 1); if (!seen[i1]) { seen[i1] = true; qx[tail] = w - 1; qy[tail] = y; tail++; }
            }

            int[] dx = { 1, -1, 0, 0 };
            int[] dy = { 0, 0, 1, -1 };
            while (head < tail) {
                int cx = qx[head], cy = qy[head]; head++;
                int ci = cy * w + cx;
                var p = buf[ci];
                if (!IsBg(p.R, p.G, p.B)) continue;
                ForceKey(buf, ci);
                for (int k = 0; k < 4; k++) {
                    int nx = cx + dx[k], ny = cy + dy[k];
                    if ((uint)nx >= (uint)w || (uint)ny >= (uint)h) continue;
                    int ni = ny * w + nx;
                    if (seen[ni]) continue;
                    var np = buf[ni];
                    if (!IsBg(np.R, np.G, np.B)) continue;
                    seen[ni] = true;
                    qx[tail] = nx; qy[tail] = ny; tail++;
                }
            }

            // BR watermark belt: key every non-subject pixel in the logo pocket
            for (int y = 880; y < h; y++) {
                for (int x = 700; x < w; x++) {
                    if (lab[y * w + x] != primary.Id) ForceKey(buf, y * w + x);
                }
            }
            // drop leftover non-subject islands that still touch the outer key field
            head = 0; tail = 0;
            for (int i = 0; i < seen.Length; i++) seen[i] = false;
            for (int x = 0; x < w; x++) {
                seen[x] = true; qx[tail] = x; qy[tail] = 0; tail++;
                int i1 = (h - 1) * w + x; seen[i1] = true; qx[tail] = x; qy[tail] = h - 1; tail++;
            }
            for (int y = 0; y < h; y++) {
                int i0 = y * w; seen[i0] = true; qx[tail] = 0; qy[tail] = y; tail++;
                int i1 = y * w + (w - 1); seen[i1] = true; qx[tail] = w - 1; qy[tail] = y; tail++;
            }
            while (head < tail) {
                int cx = qx[head], cy = qy[head]; head++;
                int ci = cy * w + cx;
                if (lab[ci] == primary.Id) continue;
                ForceKey(buf, ci);
                for (int k = 0; k < 4; k++) {
                    int nx = cx + dx[k], ny = cy + dy[k];
                    if ((uint)nx >= (uint)w || (uint)ny >= (uint)h) continue;
                    int ni = ny * w + nx;
                    if (seen[ni]) continue;
                    if (lab[ni] == primary.Id) continue;
                    seen[ni] = true;
                    qx[tail] = nx; qy[tail] = ny; tail++;
                }
            }

            // remeasure ONLY the primary central subject (ignore residue/watermark)
            int rx0 = w, ry0 = h, rx1 = 0, ry1 = 0, sub = 0;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int i = y * w + x;
                    if (lab[i] != primary.Id) {
                        ForceKey(buf, i);
                        continue;
                    }
                    sub++;
                    if (x < rx0) rx0 = x; if (y < ry0) ry0 = y;
                    if (x > rx1) rx1 = x; if (y > ry1) ry1 = y;
                }
            }
            san.SubPx = sub;
            san.X0 = rx0; san.Y0 = ry0; san.X1 = rx1; san.Y1 = ry1;
            san.W = Math.Max(0, rx1 - rx0 + 1);
            san.H = Math.Max(0, ry1 - ry0 + 1);
            Unlock(bmp, data, buf);
            return san;
        }
    }

    static Bitmap Place(San s, int targetH, int baseY) {
        var dst = new Bitmap(CANVAS, CANVAS, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst)) {
            g.Clear(Color.FromArgb(255, KR, KG, KB));
            if (s.H < 2 || s.W < 2 || s.SubPx < 50) return dst;
            float sc = (float)targetH / s.H;
            int nw = Math.Max(1, (int)Math.Round(s.W * sc));
            int nh = targetH;
            int dx = (CANVAS - nw) / 2;
            int dy = baseY - nh;
            if (dy < 16) dy = 16;
            if (dy + nh > CANVAS - 16) dy = CANVAS - 16 - nh;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            var srcR = new Rectangle(s.X0, s.Y0, s.W, s.H);
            var dstR = new Rectangle(dx, dy, nw, nh);
            g.DrawImage(s.Bmp, dstR, srcR, GraphicsUnit.Pixel);
        }
        // snap any interpolated magenta back to exact key; keep subject
        BitmapData data;
        var buf = Lock(dst, out data);
        int n = CANVAS * CANVAS;
        for (int i = 0; i < n; i++) {
            var p = buf[i];
            if (IsBg(p.R, p.G, p.B)) {
                buf[i].R = KR; buf[i].G = KG; buf[i].B = KB; buf[i].A = 255;
            } else {
                buf[i].A = 255;
            }
        }
        Unlock(dst, data, buf);
        return dst;
    }

    static void SavePng(Bitmap bmp, string path) {
        var tmp = path + ".tmp.png";
        bmp.Save(tmp, ImageFormat.Png);
        if (File.Exists(path)) File.Delete(path);
        File.Move(tmp, path);
    }

    static int Main(string[] args) {
        // args: destDir src000 src090 src180 src270
        if (args.Length < 5) {
            Console.Error.WriteLine("usage: destDir src000 src090 src180 src270");
            return 2;
        }
        string dest = args[0];
        string[] tags = { "000", "090", "180", "270" };
        var sans = new San[4];
        for (int i = 0; i < 4; i++) {
            Console.WriteLine("SANITIZE " + tags[i] + " <- " + args[i + 1]);
            sans[i] = SanitizeOne(args[i + 1]);
            Console.WriteLine("  bbox=" + sans[i].X0 + "," + sans[i].Y0 + " " + sans[i].W + "x" + sans[i].H
                + " sub=" + sans[i].SubPx + " ncomp=" + sans[i].NComp + " warn=" + sans[i].Warn);
        }

        int minH = int.MaxValue, maxH = 0;
        for (int i = 0; i < 4; i++) {
            if (sans[i].H < minH) minH = sans[i].H;
            if (sans[i].H > maxH) maxH = sans[i].H;
        }
        if (minH < 8) {
            Console.Error.WriteLine("FAIL empty subject");
            return 3;
        }
        double drift = (double)maxH / minH;
        Console.WriteLine("HEIGHT min=" + minH + " max=" + maxH + " drift=" + drift.ToString("0.000"));
        if (drift > 1.40) {
            Console.Error.WriteLine("FAIL height drift " + drift.ToString("0.000") + " > 1.40 (camera/scale mismatch)");
            return 4;
        }
        int targetH = minH;
        // if any view would exceed MAX_W after height lock, drop COMMON ppm so every view scales together
        int maxWAfter = 0;
        for (int i = 0; i < 4; i++) {
            int nw = (int)Math.Round((double)sans[i].W * targetH / sans[i].H);
            if (nw > maxWAfter) maxWAfter = nw;
        }
        if (maxWAfter > MAX_W) {
            targetH = Math.Max(8, (int)Math.Round((double)targetH * MAX_W / maxWAfter));
            Console.WriteLine("PPM downscale all views: maxW " + maxWAfter + " -> " + MAX_W + " targetH=" + targetH);
        }
        int baseY = (CANVAS + targetH) / 2;
        if (baseY > CANVAS - 40) baseY = CANVAS - 40;

        string stage = dest.TrimEnd('\\', '/') + "_stage";
        if (Directory.Exists(stage)) Directory.Delete(stage, true);
        Directory.CreateDirectory(stage);

        bool anyDup = false;
        for (int i = 0; i < 4; i++) {
            if (sans[i].Warn.Contains("DUP")) anyDup = true;
            using (var outBmp = Place(sans[i], targetH, baseY)) {
                string p = Path.Combine(stage, "yaw-" + tags[i] + ".png");
                SavePng(outBmp, p);
                Console.WriteLine("WRITE " + p);
            }
            sans[i].Bmp.Dispose();
        }
        if (anyDup) {
            Console.Error.WriteLine("FAIL duplicate subject in set — not committing");
            return 5;
        }

        Directory.CreateDirectory(dest);
        foreach (var t in tags) {
            string src = Path.Combine(stage, "yaw-" + t + ".png");
            string dst = Path.Combine(dest, "yaw-" + t + ".png");
            string bak = dst + ".bak";
            if (File.Exists(dst)) {
                if (File.Exists(bak)) File.Delete(bak);
                File.Move(dst, bak);
            }
            File.Copy(src, dst, true);
            if (File.Exists(bak)) File.Delete(bak);
        }
        Directory.Delete(stage, true);
        Console.WriteLine("COMMIT " + dest);
        return 0;
    }
}
