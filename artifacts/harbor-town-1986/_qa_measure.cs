using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

class M {
  const int KR=224, KG=64, KB=160, KEY2=58*58;
  static bool IsKey(byte r, byte g, byte b) {
    int dr=r-KR, dg=g-KG, db=b-KB;
    return dr*dr+dg*dg+db*db < KEY2;
  }
  static void Main(string[] args) {
    string dir = args[0];
    string[] tags = {"000","090","180","270"};
    Console.WriteLine("FOLDER " + Path.GetFileName(dir));
    int[] Ws = new int[4], Hs = new int[4], Y0s=new int[4], Y1s=new int[4];
    for (int t=0;t<4;t++) {
      string p = Path.Combine(dir, "yaw-"+tags[t]+".png");
      using (var loaded = (Bitmap)Image.FromFile(p))
      using (var bmp = new Bitmap(loaded)) {
        int w=bmp.Width, h=bmp.Height;
        var data = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int span = Math.Abs(data.Stride);
        byte[] tmp = new byte[span*h];
        Marshal.Copy(data.Scan0, tmp, 0, tmp.Length);
        bmp.UnlockBits(data);
        int minx=w, miny=h, maxx=-1, maxy=-1, subj=0, exact=0, near=0, nonExactBg=0;
        bool[] key = new bool[w*h];
        for (int y=0;y<h;y++) {
          int row=y*span;
          for (int x=0;x<w;x++) {
            int i=row+x*4;
            byte B=tmp[i], G=tmp[i+1], R=tmp[i+2];
            bool k = IsKey(R,G,B);
            key[y*w+x]=k;
            if (R==KR && G==KG && B==KB) exact++;
            else if (k) { near++; nonExactBg++; }
            else {
              subj++;
              if (x<minx) minx=x; if (y<miny) miny=y;
              if (x>maxx) maxx=x; if (y>maxy) maxy=y;
            }
          }
        }
        // flood key from border
        bool[] vis = new bool[w*h];
        int[] qx = new int[w*h]; int[] qy = new int[w*h]; int head=0, tail=0;
        Action<int,int> enq = (x,y) => {
          int i=y*w+x; if (vis[i] || !key[i]) return;
          vis[i]=true; qx[tail]=x; qy[tail]=y; tail++;
        };
        for (int x=0;x<w;x++) { enq(x,0); enq(x,h-1); }
        for (int y=0;y<h;y++) { enq(0,y); enq(w-1,y); }
        int[] dx={1,-1,0,0}, dy={0,0,1,-1};
        while (head<tail) {
          int x=qx[head], y=qy[head]; head++;
          for (int k=0;k<4;k++) {
            int nx=x+dx[k], ny=y+dy[k];
            if ((uint)nx<(uint)w && (uint)ny<(uint)h) enq(nx,ny);
          }
        }
        int holes=0, holeMinx=w, holeMaxx=-1, holeMiny=h, holeMaxy=-1;
        // vertical magenta-run through middle (roof split)
        int midSplits=0;
        for (int y=0;y<h;y++) {
          for (int x=0;x<w;x++) {
            int i=y*w+x;
            if (key[i] && !vis[i]) {
              holes++;
              if (x<holeMinx) holeMinx=x; if (x>holeMaxx) holeMaxx=x;
              if (y<holeMiny) holeMiny=y; if (y>holeMaxy) holeMaxy=y;
            }
          }
        }
        int bw = maxx>=0 ? maxx-minx+1 : 0;
        int bh = maxy>=0 ? maxy-miny+1 : 0;
        // check vertical split: for each y in subject bbox, is there a key gap spanning a large fraction of width
        int splitRows=0;
        if (bh>0) {
          int cx = (minx+maxx)/2;
          for (int y=miny; y<=maxy; y++) {
            if (key[y*w+cx]) splitRows++;
          }
        }
        int br=0;
        for (int y=h-80;y<h;y++) for (int x=w-80;x<w;x++) if (!key[y*w+x]) br++;
        // dark glass-ish pixels (low sat dark, not key)
        int dark=0;
        for (int y=0;y<h;y++) {
          int row=y*span;
          for (int x=0;x<w;x++) {
            int i=row+x*4;
            byte B=tmp[i], G=tmp[i+1], R=tmp[i+2];
            if (IsKey(R,G,B)) continue;
            int mx = Math.Max(R, Math.Max(G,B));
            int mn = Math.Min(R, Math.Min(G,B));
            if (mx < 90 && (mx-mn)<40) dark++;
          }
        }
        Ws[t]=bw; Hs[t]=bh; Y0s[t]=miny; Y1s[t]=maxy;
        Console.WriteLine(string.Format("yaw-{0} {1}x{2} bbox={3},{4} {5}x{6} baseY={7} subj={8} exact={9} near={10} holes={11} holeBox={12},{13} {14}x{15} midKeyRows={16}/{17} br={18} dark={19}",
          tags[t], w,h, minx,miny,bw,bh, maxy, subj, exact, near, holes,
          holeMinx, holeMiny, holeMaxx>=0?holeMaxx-holeMinx+1:0, holeMaxy>=0?holeMaxy-holeMiny+1:0,
          splitRows, bh, br, dark));
      }
    }
    double r090 = Ws[0]==0?0:(double)Ws[1]/Ws[0];
    double r270 = Ws[0]==0?0:(double)Ws[3]/Ws[0];
    Console.WriteLine(string.Format("W000={0} W090={1} W180={2} W270={3} ratio090/000={4:0.000} ratio270/000={5:0.000}", Ws[0],Ws[1],Ws[2],Ws[3], r090, r270));
    Console.WriteLine(string.Format("H000={0} H090={1} H180={2} H270={3} Y0={4}/{5}/{6}/{7} Y1={8}/{9}/{10}/{11}", Hs[0],Hs[1],Hs[2],Hs[3], Y0s[0],Y0s[1],Y0s[2],Y0s[3], Y1s[0],Y1s[1],Y1s[2],Y1s[3]));
  }
}
