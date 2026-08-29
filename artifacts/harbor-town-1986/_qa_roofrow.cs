using System;
using System.Drawing;
class T {
  static void Main() {
    string p = @"C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\assets\city-bus-roof\yaw-000.png";
    using (var bmp = (Bitmap)Image.FromFile(p)) {
      Console.WriteLine("size "+bmp.Width+"x"+bmp.Height);
      for (int y=448; y<=510; y+=2) {
        int key=0, sub=0, run=0, maxrun=0, first=-1, last=-1;
        for (int x=0;x<1024;x++) {
          var c=bmp.GetPixel(x,y);
          bool k = (c.R==224 && c.G==64 && c.B==160);
          if (k) { key++; run++; if (run>maxrun) maxrun=run; }
          else { sub++; run=0; if (first<0) first=x; last=x; }
        }
        Console.WriteLine(string.Format("y={0} key={1} sub={2} maxKeyRun={3} subX={4}-{5}", y,key,sub,maxrun,first,last));
      }
      // count enclosed key in subject y-range
    }
  }
}
