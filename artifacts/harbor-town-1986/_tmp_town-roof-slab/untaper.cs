using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

internal static class Untaper {
    const int KR = 224, KG = 64, KB = 160;
    const int KEY_DIST2 = 70 * 70;

    struct Px { public byte B, G, R, A; }

    static bool IsKey(byte r, byte g, byte b) {
        int dr = r - KR, dg = g - KG, db = b - KB;
        return dr * dr + dg * dg + db * db < KEY_DIST2;
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

    static Px Sample(Px[] src, int w, int h, double x, double y) {
        if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
            return new Px { R = KR, G = KG, B = KB, A = 255 };
        }
        int x0 = (int)Math.Floor(x);
        int y0 = (int)Math.Floor(y);
        int x1 = x0 + 1;
        int y1 = y0 + 1;
        double fx = x - x0, fy = y - y0;
        Px p00 = src[y0 * w + x0];
        Px p10 = src[y0 * w + x1];
        Px p01 = src[y1 * w + x0];
        Px p11 = src[y1 * w + x1];
        // if any sample is key, bias toward key to avoid magenta fringes on stretch
        double r = (1 - fx) * (1 - fy) * p00.R + fx * (1 - fy) * p10.R + (1 - fx) * fy * p01.R + fx * fy * p11.R;
        double g = (1 - fx) * (1 - fy) * p00.G + fx * (1 - fy) * p10.G + (1 - fx) * fy * p01.G + fx * fy * p11.G;
        double b = (1 - fx) * (1 - fy) * p00.B + fx * (1 - fy) * p10.B + (1 - fx) * fy * p01.B + fx * fy * p11.B;
        return new Px { R = (byte)Math.Round(r), G = (byte)Math.Round(g), B = (byte)Math.Round(b), A = 255 };
    }

    static void Process(string inp, string outp) {
        using (var loaded = (Bitmap)Image.FromFile(inp))
        using (var srcBmp = new Bitmap(loaded)) {
            int w = srcBmp.Width, h = srcBmp.Height;
            BitmapData sdata;
            var src = Lock(srcBmp, out sdata);
            srcBmp.UnlockBits(sdata);

            int[] L = new int[h];
            int[] R = new int[h];
            int[] WW = new int[h];
            int maxW = 0;
            int yLimit = Math.Min(h, 920);
            for (int y = 0; y < h; y++) {
                L[y] = -1; R[y] = -1; WW[y] = 0;
                if (y >= yLimit) continue;
                int minx = -1, maxx = -1;
                int o = y * w;
                for (int x = 0; x < w; x++) {
                    var p = src[o + x];
                    if (IsKey(p.R, p.G, p.B)) continue;
                    if (minx < 0) minx = x;
                    maxx = x;
                }
                if (minx >= 0) {
                    L[y] = minx; R[y] = maxx; WW[y] = maxx - minx + 1;
                    if (WW[y] > maxW) maxW = WW[y];
                }
            }
            if (maxW < 50) throw new Exception("no subject " + inp);

            int thresh = Math.Max(80, (int)(maxW * 0.55));
            int topY = -1, botY = -1;
            for (int y = 0; y < yLimit; y++) {
                if (WW[y] >= thresh) { if (topY < 0) topY = y; botY = y; }
            }
            if (topY < 0) throw new Exception("no body " + inp);

            // refine: use a row a few px inside the far parapet so we don't catch the pipe
            int farY = topY;
            for (int y = topY; y < Math.Min(topY + 30, botY); y++) {
                if (WW[y] >= thresh) { farY = y; break; }
            }
            int nearY = botY;

            double srcL0 = L[farY], srcR0 = R[farY];
            double srcL1 = L[nearY], srcR1 = R[nearY];
            double dstL = srcL1, dstR = srcR1;
            double dstW = dstR - dstL;
            if (dstW < 10) throw new Exception("thin dest");

            Console.WriteLine(Path.GetFileName(inp)
                + " farY=" + farY + " nearY=" + nearY
                + " srcTop=" + srcL0 + ".." + srcR0 + " w=" + (srcR0 - srcL0)
                + " srcBot=" + srcL1 + ".." + srcR1 + " w=" + (srcR1 - srcL1)
                + " ratio=" + ((srcR0 - srcL0) / (srcR1 - srcL1)).ToString("0.000"));

            var dst = new Px[w * h];
            for (int i = 0; i < dst.Length; i++) dst[i] = new Px { R = KR, G = KG, B = KB, A = 255 };

            int y0 = Math.Max(0, farY - 80); // include pipe above far parapet
            int y1 = Math.Min(h - 1, nearY + 8);
            for (int y = y0; y <= y1; y++) {
                double t;
                if (y <= farY) t = 0;
                else if (y >= nearY) t = 1;
                else t = (double)(y - farY) / (nearY - farY);
                double sL = srcL0 + t * (srcL1 - srcL0);
                double sR = srcR0 + t * (srcR1 - srcR0);
                double sW = sR - sL;
                if (sW < 2) continue;
                int x0 = Math.Max(0, (int)Math.Floor(dstL) - 2);
                int x1 = Math.Min(w - 1, (int)Math.Ceiling(dstR) + 2);
                for (int x = x0; x <= x1; x++) {
                    double u = (x - dstL) / dstW;
                    // allow slight overscan for pipe pixels that sit inside
                    if (u < -0.02 || u > 1.02) continue;
                    double sx = sL + u * sW;
                    dst[y * w + x] = Sample(src, w, h, sx, y);
                }
            }

            using (var outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
                BitmapData odata;
                var dummy = Lock(outBmp, out odata);
                Unlock(outBmp, odata, dst);
                string tmp = outp + ".tmp.png";
                outBmp.Save(tmp, ImageFormat.Png);
                if (File.Exists(outp)) File.Delete(outp);
                File.Move(tmp, outp);
            }
            Console.WriteLine("WROTE " + outp);
        }
    }

    static int Main(string[] args) {
        if (args.Length < 2 || (args.Length % 2) != 0) {
            Console.Error.WriteLine("usage: in out [in out ...]");
            return 2;
        }
        for (int i = 0; i < args.Length; i += 2) Process(args[i], args[i + 1]);
        return 0;
    }
}
