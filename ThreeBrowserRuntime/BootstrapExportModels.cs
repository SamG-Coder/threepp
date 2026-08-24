namespace ThreeBrowserRuntime;

internal enum BootstrapPackageMode
{
    SingleExecutable,
    PortableDirectory,
}

internal enum BootstrapSigningMode
{
    Unsigned,
    PfxCertificate,
    SelfSigned,
}

internal sealed record BootstrapExportOptions(
    string ApplicationName,
    string DestinationDirectory,
    BootstrapPackageMode PackageMode,
    string? IconPath,
    string? LoadingImagePath,
    BootstrapSigningMode SigningMode,
    string? CertificatePath,
    string? CertificatePassword,
    string? SelfSignedSubject,
    string? TimestampUrl,
    bool KeepGeneratedProject);

internal sealed record BootstrapExportResult(
    string ExecutablePath,
    string? CertificatePath,
    string? GeneratedProjectPath,
    int ProjectFileCount,
    int ShaderFileCount,
    long ExecutableSize);

internal sealed record BootstrapExportProgress(string Message, string Kind = "output");
