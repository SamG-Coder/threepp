using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
class S {
  static void Sample(string path, int x, int y) {
    using (var bmp = (Bitmap)Image.FromFile(path)) {
      var c = bmp.GetPixel(x,y);
      Console.WriteLine(string.Format("{0} ({1},{2}) RGBA={3},{4},{5},{6}", System.IO.Path.GetFileName(path), x,y, c.R,c.G,c.B,c.A));
    }
  }
  static void DumpGrid(string path, int x0, int y0, int step, int n) {
    using (var bmp = (Bitmap)Image.FromFile(path)) {
      Console.WriteLine("GRID "+path+" origin="+x0+","+y0+" step="+step);
      for (int j=0;j<n;j++) {
        string line="";
        for (int i=0;i<n;i++) {
          int x=x0+i*step, y=y0+j*step;
          if (x<0||y<0||x>=bmp.Width||y>=bmp.Height) { line+=" ----"; continue; }
          var c=bmp.GetPixel(x,y);
          line += string.Format(" {0:X2}{1:X2}{2:X2}", c.R,c.G,c.B);
        }
        Console.WriteLine(line);
      }
    }
  }
  static void Main() {
    string root = @"C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\assets\";
    // cab 000 windshield center ~ (512, 500)
    DumpGrid(root+@"kei-van-cab\yaw-000.png", 470, 470, 20, 6);
    // cab 090 door window ~ (350, 430)
    DumpGrid(root+@"kei-van-cab\yaw-090.png", 280, 380, 25, 6);
    // cab 180 rear window ~ (512, 470)
    DumpGrid(root+@"kei-van-cab\yaw-180.png", 450, 430, 20, 6);
    // roof 000 split band y~468, x across
    DumpGrid(root+@"city-bus-roof\yaw-000.png", 300, 450, 20, 7);
    // passenger 270 hanging door / width
    DumpGrid(root+@"city-bus-passenger-body\yaw-270.png", 820, 560, 20, 5);
  }
}
