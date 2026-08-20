using System.Runtime.InteropServices;

namespace ThreeBrowser;

public partial class NativeBridge
{
    public int CmdSubmit(int nbytes) => _form.SubmitCmd(nbytes);

    public int CmdSubmitB64(string b64)
    {
        if (string.IsNullOrEmpty(b64))
        {
            return 1;
        }
        var bytes = Convert.FromBase64String(b64);
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            return Native.tn_cmd_submit(pin.AddrOfPinnedObject(), bytes.Length);
        }
        finally
        {
            pin.Free();
        }
    }

    public int CmdCapacity() => MainForm.CmdBufferBytes;

    public int EnsureCmdBuffer()
    {
        _form.PostCmdBuffer();
        return MainForm.CmdBufferBytes;
    }
}
