namespace ThreeBrowser;

public partial class NativeBridge
{
    public int CmdSubmit(int nbytes) => _form.SubmitCmd(nbytes);

    public int CmdCapacity() => MainForm.CmdBufferBytes;

    public int EnsureCmdBuffer()
    {
        _form.PostCmdBuffer();
        return MainForm.CmdBufferBytes;
    }
}
