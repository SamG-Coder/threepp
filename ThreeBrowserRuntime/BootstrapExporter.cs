using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO.Compression;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace ThreeBrowserRuntime;

internal sealed class BootstrapExporter
{
    private static readonly string[] RequiredRuntimeFiles =
    [
        "glslangValidator.exe",
        "libgcc_s_seh-1.dll",
        "libstdc++-6.dll",
        "libwinpthread-1.dll",
        "three_browser_runtime.node",
        "three_native.dll",
        "three_webgpu.dll",
        "wgpu_native.dll",
    ];

    private static readonly HashSet<string> ShaderExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".comp", ".frag", ".fs", ".glsl", ".hlsl", ".spv", ".vert", ".vs", ".wgsl",
    };

    private readonly string _runtimeDirectory;
    private readonly string _nodeExecutable;

    internal BootstrapExporter(string runtimeDirectory, string nodeExecutable)
    {
        _runtimeDirectory = Path.GetFullPath(runtimeDirectory);
        _nodeExecutable = nodeExecutable;
    }

    internal async Task<BootstrapExportResult> ExportAsync(
        string projectEntry,
        BootstrapExportOptions options,
        IProgress<BootstrapExportProgress>? progress,
        Action<Process?>? processChanged,
        CancellationToken cancellationToken)
    {
        var normalized = Validate(projectEntry, options);
        var work = Path.Combine(Path.GetTempPath(), "ThreeBrowser", "BootstrapBuilds", Guid.NewGuid().ToString("N"));
        var source = Path.Combine(work, "source");
        var publish = Path.Combine(work, "publish");
        SigningMaterial? signing = null;
        Directory.CreateDirectory(source);
        try
        {
            Report(progress, "Inspecting project and runtime dependencies…", "command");
            cancellationToken.ThrowIfCancellationRequested();
            var node = ResolveExecutable(_nodeExecutable, "the Node.js executable used by ThreeBrowserRuntime");
            var dotnet = ResolveExecutable("dotnet", "the .NET SDK host");
            await EnsureDotNet10SdkAsync(dotnet, progress, processChanged, cancellationToken);
            var nodeModules = FindNodeModules(_runtimeDirectory)
                ?? throw new DirectoryNotFoundException("The ThreeBrowser node_modules directory is missing. Run npm install in ThreeBrowserRuntime first.");
            if (options.SigningMode == BootstrapSigningMode.PfxCertificate &&
                IsWithin(nodeModules, Path.GetFullPath(options.CertificatePath!)))
                throw new InvalidOperationException(
                    "The signing certificate is inside packaged JavaScript dependencies. Move it outside the project and runtime folders before exporting.");

            var iconPath = Path.Combine(source, "app.ico");
            var loadingImagePath = Path.Combine(source, "loading.png");
            await Task.Run(() =>
            {
                CreateApplicationIcon(options.IconPath, iconPath);
                CreateLoadingImage(options.LoadingImagePath, options.IconPath, loadingImagePath, normalized.ApplicationName);
            }, cancellationToken);

            var payloadPath = Path.Combine(source, "payload.zip");
            Report(progress, "Embedding the project, Node.js, native runtime, shader compiler, and dependencies…");
            var payload = await Task.Run(() => CreatePayload(
                normalized.ProjectDirectory,
                node,
                nodeModules,
                iconPath,
                payloadPath,
                progress,
                cancellationToken), cancellationToken);
            var payloadHash = await ComputeSha256Async(payloadPath, cancellationToken);
            Report(progress, $"Payload ready · {payload.FileCount:N0} files · {FormatBytes(new FileInfo(payloadPath).Length)}", "success");
            if (payload.ShaderFileCount > 0)
                Report(progress, $"Found {payload.ShaderFileCount:N0} packaged shader source/binary files. Startup variants compile before the loading image closes.", "muted");
            else
                Report(progress, "No standalone shader files found; generated runtime shaders will compile during scene startup.", "muted");

            var program = BootstrapRuntimeTemplate.Create(
                normalized.ApplicationName,
                normalized.FileName,
                payloadHash,
                payload.ManifestHash,
                options.PackageMode == BootstrapPackageMode.SingleExecutable);
            await File.WriteAllTextAsync(Path.Combine(source, "Program.cs"), program, new UTF8Encoding(false), cancellationToken);
            await File.WriteAllTextAsync(Path.Combine(source, normalized.FileName + ".csproj"),
                CreateProjectFile(normalized.FileName, options.PackageMode), new UTF8Encoding(false), cancellationToken);
            await File.WriteAllTextAsync(Path.Combine(source, "README.txt"),
                CreateGeneratedReadme(normalized.ApplicationName, options.PackageMode), new UTF8Encoding(false), cancellationToken);

            if (options.SigningMode != BootstrapSigningMode.Unsigned)
            {
                Report(progress, options.SigningMode == BootstrapSigningMode.SelfSigned
                    ? "Creating a self-signed code-signing certificate…"
                    : "Validating the selected code-signing certificate…");
                signing = await Task.Run(() => PrepareSigningMaterial(options, work), cancellationToken);
            }

            var projectFile = Path.Combine(source, normalized.FileName + ".csproj");
            Report(progress, "Resolving the locally installed Windows runtime packs…", "command");
            var restoreExit = await RunProcessAsync(dotnet, source,
                ["restore", projectFile, "-r", "win-x64", "--ignore-failed-sources", "-p:NuGetAudit=false", "--nologo"],
                null, progress, processChanged, cancellationToken);
            if (restoreExit != 0) throw new InvalidOperationException($"Bootstrap restore failed with exit code {restoreExit}.");

            Report(progress, $"Publishing {normalized.ApplicationName} as a self-contained Windows x64 executable…", "command");
            var publishExit = await RunProcessAsync(dotnet, source,
                ["publish", projectFile, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "--no-restore", "--nologo", "-o", publish],
                null, progress, processChanged, cancellationToken);
            if (publishExit != 0) throw new InvalidOperationException($"Bootstrap publish failed with exit code {publishExit}.");

            var publishedExe = Path.Combine(publish, normalized.FileName + ".exe");
            if (!File.Exists(publishedExe)) throw new FileNotFoundException("dotnet publish did not produce the bootstrap executable.", publishedExe);
            var unexpectedPublishFiles = Directory.EnumerateFiles(publish, "*", SearchOption.TopDirectoryOnly)
                .Where(path => !path.Equals(publishedExe, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (unexpectedPublishFiles.Length > 0)
                throw new InvalidDataException("The generated launcher was not published as one executable: " +
                    string.Join(", ", unexpectedPublishFiles.Select(Path.GetFileName)));

            Report(progress, "Verifying the embedded payload and every packaged file hash…", "command");
            var verificationLog = Path.Combine(work, "verification-error.txt");
            var verificationExit = await RunProcessAsync(publishedExe, publish, ["--verify-package"],
                new Dictionary<string, string?>
                {
                    ["THREEBROWSER_BOOTSTRAP_CACHE"] = Path.Combine(work, "verification-cache"),
                    ["THREEBROWSER_VERIFY_LOG"] = verificationLog,
                }, progress, processChanged, cancellationToken);
            if (verificationExit != 0)
            {
                var detail = File.Exists(verificationLog) ? await File.ReadAllTextAsync(verificationLog, cancellationToken) : "No diagnostic was produced.";
                throw new InvalidDataException($"The generated executable failed package verification.\n{detail}");
            }
            Report(progress, "Generated executable and embedded resources verified.", "success");

            if (signing is not null)
            {
                Report(progress, options.SigningMode == BootstrapSigningMode.SelfSigned
                    ? "Applying the self-signed Authenticode signature…"
                    : "Applying the selected Authenticode signature…", "command");
                await SignAsync(publishedExe, signing, options.TimestampUrl, work, progress, processChanged, cancellationToken);
                Report(progress, "Authenticode signature applied and verified.", "success");
            }

            var portableDestination = Path.Combine(normalized.DestinationDirectory, normalized.FileName);
            var executablePath = options.PackageMode == BootstrapPackageMode.SingleExecutable
                ? Path.Combine(normalized.DestinationDirectory, normalized.FileName + ".exe")
                : Path.Combine(portableDestination, normalized.FileName + ".exe");
            var certificatePath = signing?.PublicCertificatePath is null
                ? null
                : options.PackageMode == BootstrapPackageMode.SingleExecutable
                    ? Path.Combine(normalized.DestinationDirectory, normalized.FileName + ".self-signed.cer")
                    : Path.Combine(portableDestination, normalized.FileName + ".self-signed.cer");
            var generatedProjectPath = options.KeepGeneratedProject
                ? Path.Combine(normalized.DestinationDirectory, normalized.FileName + "-bootstrap-project")
                : null;

            var publicationId = Guid.NewGuid().ToString("N");
            var stagedMain = Path.Combine(normalized.DestinationDirectory, $".threebrowser-{publicationId}-app");
            var stagedCertificate = certificatePath is null || options.PackageMode != BootstrapPackageMode.SingleExecutable
                ? null
                : Path.Combine(normalized.DestinationDirectory, $".threebrowser-{publicationId}-certificate");
            var stagedProject = generatedProjectPath is null
                ? null
                : Path.Combine(normalized.DestinationDirectory, $".threebrowser-{publicationId}-project");
            var finalizedTargets = new List<(string Path, bool IsDirectory)>();
            try
            {
                if (options.PackageMode == BootstrapPackageMode.SingleExecutable)
                {
                    CopyFileAtomically(publishedExe, stagedMain);
                    if (stagedCertificate is not null)
                        CopyFileAtomically(signing!.PublicCertificatePath!, stagedCertificate);
                }
                else
                {
                    var publishedPayload = Path.Combine(publish, "payload");
                    if (!Directory.Exists(publishedPayload))
                    {
                        Directory.CreateDirectory(publishedPayload);
                        ExtractArchive(payloadPath, publishedPayload, cancellationToken);
                    }
                    CopyNewTree(publish, stagedMain, cancellationToken);
                    if (certificatePath is not null)
                        File.Copy(signing!.PublicCertificatePath!,
                            Path.Combine(stagedMain, Path.GetFileName(certificatePath)), overwrite: false);
                }

                if (stagedProject is not null)
                    CopyNewTree(source, stagedProject, cancellationToken,
                        relative => !relative.StartsWith("bin" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
                                    !relative.StartsWith("obj" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));

                cancellationToken.ThrowIfCancellationRequested();
                if (stagedProject is not null)
                {
                    MoveDirectoryWithRetry(stagedProject, generatedProjectPath!);
                    finalizedTargets.Add((generatedProjectPath!, true));
                }
                if (options.PackageMode == BootstrapPackageMode.SingleExecutable)
                {
                    if (stagedCertificate is not null)
                    {
                        File.Move(stagedCertificate, certificatePath!);
                        finalizedTargets.Add((certificatePath!, false));
                    }
                    File.Move(stagedMain, executablePath);
                    finalizedTargets.Add((executablePath, false));
                }
                else
                {
                    MoveDirectoryWithRetry(stagedMain, portableDestination);
                    finalizedTargets.Add((portableDestination, true));
                }
            }
            catch
            {
                foreach (var target in finalizedTargets.AsEnumerable().Reverse())
                {
                    if (target.IsDirectory) DeleteOwnedTree(target.Path);
                    else TryDeleteFile(target.Path);
                }
                throw;
            }
            finally
            {
                if (options.PackageMode == BootstrapPackageMode.SingleExecutable) TryDeleteFile(stagedMain);
                else DeleteOwnedTree(stagedMain);
                if (stagedCertificate is not null) TryDeleteFile(stagedCertificate);
                if (stagedProject is not null) DeleteOwnedTree(stagedProject);
            }

            var executableSize = new FileInfo(executablePath).Length;
            Report(progress, $"Export complete · {FormatBytes(executableSize)}", "success");
            return new BootstrapExportResult(executablePath, certificatePath, generatedProjectPath,
                payload.ProjectFileCount, payload.ShaderFileCount, executableSize);
        }
        finally
        {
            processChanged?.Invoke(null);
            if (signing is not null) CryptographicOperations.ZeroMemory(signing.PfxBytes);
            DeleteOwnedTree(work);
        }
    }

    private NormalizedExport Validate(string projectEntry, BootstrapExportOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.ApplicationName) || options.ApplicationName.Trim().Length > 80 ||
            options.ApplicationName.Any(char.IsControl))
            throw new ArgumentException("Application names must contain 1–80 visible characters.");
        var entry = Path.GetFullPath(projectEntry);
        if (!File.Exists(entry) || !Path.GetFileName(entry).Equals("site-entry.mjs", StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException("The selected project does not contain site-entry.mjs.", entry);
        var projectDirectory = Path.GetDirectoryName(entry)!;
        EnsureTreeContainsNoReparsePoints(projectDirectory);
        if (!Directory.Exists(_runtimeDirectory))
            throw new DirectoryNotFoundException("The staged ThreeBrowser native runtime is missing. Build ThreeBrowserRuntime first.");
        foreach (var required in RequiredRuntimeFiles)
            if (!File.Exists(Path.Combine(_runtimeDirectory, required)))
                throw new FileNotFoundException($"Required runtime dependency is missing: {required}", Path.Combine(_runtimeDirectory, required));
        if (!File.Exists(Path.Combine(_runtimeDirectory, "runtime", "launch.mjs")))
            throw new FileNotFoundException("The staged runtime launcher is missing.", Path.Combine(_runtimeDirectory, "runtime", "launch.mjs"));

        var destination = Path.GetFullPath(options.DestinationDirectory.Trim());
        Directory.CreateDirectory(destination);
        var fileName = SanitizeFileName(options.ApplicationName);
        var output = options.PackageMode == BootstrapPackageMode.SingleExecutable
            ? Path.Combine(destination, fileName + ".exe")
            : Path.Combine(destination, fileName);
        if (IsWithin(projectDirectory, output))
            throw new InvalidOperationException("Choose an export destination outside the project folder.");
        if (File.Exists(output) || Directory.Exists(output))
            throw new IOException($"The export target already exists: {output}");
        var publicCertificate = Path.Combine(destination, fileName + ".self-signed.cer");
        if (options.SigningMode == BootstrapSigningMode.SelfSigned &&
            options.PackageMode == BootstrapPackageMode.SingleExecutable &&
            (File.Exists(publicCertificate) || Directory.Exists(publicCertificate)))
            throw new IOException($"The self-signed certificate target already exists: {publicCertificate}");
        var generated = Path.Combine(destination, fileName + "-bootstrap-project");
        if (options.KeepGeneratedProject && (File.Exists(generated) || Directory.Exists(generated)))
            throw new IOException($"The generated project target already exists: {generated}");

        ValidateOptionalFile(options.IconPath, "icon");
        ValidateOptionalFile(options.LoadingImagePath, "loading image");
        if (!string.IsNullOrWhiteSpace(options.TimestampUrl) &&
            (!Uri.TryCreate(options.TimestampUrl, UriKind.Absolute, out var timestamp) ||
             (timestamp.Scheme != Uri.UriSchemeHttp && timestamp.Scheme != Uri.UriSchemeHttps) ||
             !string.IsNullOrEmpty(timestamp.UserInfo)))
            throw new ArgumentException("The timestamp URL must be a complete HTTP or HTTPS URL without embedded credentials.");
        if (options.SigningMode == BootstrapSigningMode.PfxCertificate)
        {
            ValidateOptionalFile(options.CertificatePath, "PFX certificate", required: true);
            var certificatePath = Path.GetFullPath(options.CertificatePath!);
            var extension = Path.GetExtension(certificatePath);
            if (!extension.Equals(".pfx", StringComparison.OrdinalIgnoreCase) &&
                !extension.Equals(".p12", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Choose a .pfx or .p12 code-signing certificate.");
            if (IsWithin(projectDirectory, certificatePath) || IsWithin(_runtimeDirectory, certificatePath))
                throw new InvalidOperationException(
                    "The signing certificate is inside files that will be packaged. Move it outside the project and runtime folders before exporting.");
        }

        return new NormalizedExport(options.ApplicationName.Trim(), fileName, projectDirectory, destination);
    }

    private PayloadSummary CreatePayload(
        string projectDirectory,
        string nodeExecutable,
        string nodeModules,
        string iconPath,
        string payloadPath,
        IProgress<BootstrapExportProgress>? progress,
        CancellationToken cancellationToken)
    {
        var files = new List<PayloadFile>();
        var archivePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var projectFiles = 0;
        var shaderFiles = 0;
        using var target = new FileStream(payloadPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024);
        using var archive = new ZipArchive(target, ZipArchiveMode.Create, leaveOpen: false, Encoding.UTF8);

        void AddFile(string source, string relative)
        {
            cancellationToken.ThrowIfCancellationRequested();
            relative = relative.Replace('\\', '/').TrimStart('/');
            if (!archivePaths.Add(relative)) throw new InvalidDataException($"Duplicate payload path: {relative}");
            var info = new FileInfo(source);
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException($"Linked files cannot be embedded: {source}");
            var entry = archive.CreateEntry(relative, CompressionLevel.SmallestSize);
            entry.LastWriteTime = ClampZipTimestamp(info.LastWriteTimeUtc);
            using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.SequentialScan);
            using var output = entry.Open();
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[1024 * 1024];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                output.Write(buffer, 0, read);
                hash.AppendData(buffer, 0, read);
            }
            files.Add(new PayloadFile(relative, info.Length, Convert.ToHexString(hash.GetHashAndReset())));
            if (files.Count % 100 == 0) Report(progress, $"Embedding resources… {files.Count:N0} files", "muted");
        }

        void AddTree(string sourceRoot, string archiveRoot, bool project)
        {
            EnsureTreeContainsNoReparsePoints(sourceRoot);
            foreach (var file in Directory.EnumerateFiles(sourceRoot, "*", SearchOption.AllDirectories).Order(StringComparer.OrdinalIgnoreCase))
            {
                var relative = Path.GetRelativePath(sourceRoot, file);
                AddFile(file, archiveRoot + "/" + relative.Replace('\\', '/'));
                if (project)
                {
                    projectFiles++;
                    if (ShaderExtensions.Contains(Path.GetExtension(file))) shaderFiles++;
                }
            }
        }

        AddFile(nodeExecutable, "node.exe");
        AddTree(Path.Combine(_runtimeDirectory, "runtime"), "runtime", project: false);
        foreach (var file in Directory.EnumerateFiles(_runtimeDirectory, "*", SearchOption.TopDirectoryOnly)
                     .Where(file => Path.GetExtension(file).Equals(".dll", StringComparison.OrdinalIgnoreCase) ||
                                    Path.GetExtension(file).Equals(".node", StringComparison.OrdinalIgnoreCase) ||
                                    Path.GetFileName(file).Equals("glslangValidator.exe", StringComparison.OrdinalIgnoreCase))
                     .Order(StringComparer.OrdinalIgnoreCase))
            AddFile(file, Path.GetFileName(file));

        foreach (var vcRuntime in new[] { "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll" })
        {
            if (archivePaths.Contains(vcRuntime)) continue;
            var local = Path.Combine(_runtimeDirectory, vcRuntime);
            var system = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), vcRuntime);
            var source = File.Exists(local) ? local : system;
            if (!File.Exists(source)) throw new FileNotFoundException($"Microsoft VC++ runtime dependency is missing: {vcRuntime}", source);
            AddFile(source, vcRuntime);
        }

        AddTree(nodeModules, "node_modules", project: false);
        AddTree(projectDirectory, "project", project: true);
        AddFile(iconPath, "bootstrap/app.ico");

        var manifest = JsonSerializer.SerializeToUtf8Bytes(new
        {
            format = 1,
            files = files.Select(file => new { path = file.Path, size = file.Size, sha256 = file.Sha256 }),
        }, new JsonSerializerOptions { WriteIndented = true });
        var manifestHash = Convert.ToHexString(SHA256.HashData(manifest)).ToLowerInvariant();
        var manifestEntry = archive.CreateEntry("bootstrap.manifest.json", CompressionLevel.SmallestSize);
        using (var output = manifestEntry.Open()) output.Write(manifest);
        return new PayloadSummary(projectFiles, shaderFiles, files.Count + 1, manifestHash);
    }

    private static string CreateProjectFile(string assemblyName, BootstrapPackageMode mode)
    {
        var escapedName = SecurityElement.Escape(assemblyName);
        var payloadResource = mode == BootstrapPackageMode.SingleExecutable
            ? "    <EmbeddedResource Include=\"payload.zip\" LogicalName=\"ThreeBrowser.Payload\" />\n"
            : "";
        var portableTarget = mode == BootstrapPackageMode.PortableDirectory
            ? """
  <Target Name="StagePortablePayload" AfterTargets="Publish">
    <Unzip SourceFiles="$(MSBuildProjectDirectory)\payload.zip" DestinationFolder="$(PublishDir)payload" />
  </Target>
"""
            : "";
        return $"""
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net10.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PlatformTarget>x64</PlatformTarget>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>false</EnableCompressionInSingleFile>
    <PublishTrimmed>false</PublishTrimmed>
    <PublishReadyToRun>false</PublishReadyToRun>
    <DebugType>none</DebugType>
    <DebugSymbols>false</DebugSymbols>
    <NuGetAudit>false</NuGetAudit>
    <RestoreIgnoreFailedSources>true</RestoreIgnoreFailedSources>
    <UseAppHost>true</UseAppHost>
    <AssemblyName>{escapedName}</AssemblyName>
    <ApplicationIcon>app.ico</ApplicationIcon>
  </PropertyGroup>
  <ItemGroup>
    <EmbeddedResource Include="loading.png" LogicalName="ThreeBrowser.LoadingImage" />
{payloadResource}  </ItemGroup>
{portableTarget}</Project>
""";
    }

    private static string CreateGeneratedReadme(string applicationName, BootstrapPackageMode mode) => $"""
{applicationName} — generated ThreeBrowser bootstrap project

Build:
  dotnet publish -c Release -r win-x64 --self-contained true

Package mode:
  {(mode == BootstrapPackageMode.SingleExecutable ? "Single embedded executable" : "Portable executable folder")}

payload.zip contains the project, Node.js, the ThreeBrowser native runtime,
the shader compiler, runtime libraries, and JavaScript dependencies. The
loading image and application icon are embedded in the launcher. Rebuilding
this project does not apply the signature selected in ThreeBrowserRuntime;
sign the final executable after publishing.
""";

    private static SigningMaterial PrepareSigningMaterial(BootstrapExportOptions options, string work)
    {
        if (options.SigningMode == BootstrapSigningMode.PfxCertificate)
        {
            var pfx = Path.GetFullPath(options.CertificatePath!);
            var certificates = X509CertificateLoader.LoadPkcs12CollectionFromFile(
                pfx, options.CertificatePassword,
                X509KeyStorageFlags.EphemeralKeySet | X509KeyStorageFlags.Exportable);
            try
            {
                var pfxCertificate = certificates.Cast<X509Certificate2>().FirstOrDefault(item => item.HasPrivateKey)
                    ?? throw new InvalidOperationException("The selected certificate file does not contain a private key.");
                ValidateCodeSigningCertificate(pfxCertificate);
                var signingPassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
                var signingPfx = Path.Combine(work, "signing-certificate.pfx");
                var signingBytes = certificates.ExportPkcs12(Pkcs12ExportPbeParameters.Pkcs12TripleDesSha1, signingPassword);
                return new SigningMaterial(signingPfx, signingBytes, signingPassword, pfxCertificate.Thumbprint, null);
            }
            finally
            {
                foreach (var item in certificates) item.Dispose();
            }
        }

        var publisher = string.IsNullOrWhiteSpace(options.SelfSignedSubject)
            ? options.ApplicationName.Trim()
            : options.SelfSignedSubject.Trim();
        X500DistinguishedName distinguishedName;
        if (LooksLikeDistinguishedName(publisher))
        {
            distinguishedName = new X500DistinguishedName(publisher);
        }
        else
        {
            var nameBuilder = new X500DistinguishedNameBuilder();
            nameBuilder.AddCommonName(publisher);
            distinguishedName = nameBuilder.Build();
        }
        var password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var pfxPath = Path.Combine(work, "self-signed.pfx");
        var publicPath = Path.Combine(work, "self-signed.cer");
        using var key = RSA.Create(3072);
        var request = new CertificateRequest(distinguishedName, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            new OidCollection { new("1.3.6.1.5.5.7.3.3", "Code Signing") }, true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(3));
        var pfxBytes = certificate.ExportPkcs12(Pkcs12ExportPbeParameters.Pkcs12TripleDesSha1, password);
        File.WriteAllBytes(publicPath, certificate.Export(X509ContentType.Cert));
        return new SigningMaterial(pfxPath, pfxBytes, password, certificate.Thumbprint, publicPath);
    }

    private static bool LooksLikeDistinguishedName(string value)
    {
        var equals = value.IndexOf('=');
        if (equals <= 0) return false;
        var attribute = value[..equals].Trim();
        if (attribute.Length > 2 && attribute.All(character => char.IsDigit(character) || character == '.')) return true;
        return attribute.ToUpperInvariant() is
            "C" or "CN" or "DC" or "E" or "EMAILADDRESS" or "G" or "GN" or "I" or "INITIALS" or
            "L" or "O" or "OU" or "S" or "SERIALNUMBER" or "SN" or "ST" or "STREET" or
            "SURNAME" or "T" or "UID";
    }

    private static void ValidateCodeSigningCertificate(X509Certificate2 certificate)
    {
        if (!certificate.HasPrivateKey) throw new InvalidOperationException("The selected certificate does not contain a private key.");
        if (DateTime.UtcNow < certificate.NotBefore.ToUniversalTime() || DateTime.UtcNow > certificate.NotAfter.ToUniversalTime())
            throw new InvalidOperationException("The selected certificate is not currently valid.");
        var usages = certificate.Extensions.OfType<X509EnhancedKeyUsageExtension>().ToArray();
        if (usages.Length > 0 && !usages.SelectMany(extension => extension.EnhancedKeyUsages.Cast<Oid>())
                .Any(oid => oid.Value == "1.3.6.1.5.5.7.3.3"))
            throw new InvalidOperationException("The selected certificate is not valid for code signing.");
        var keyUsages = certificate.Extensions.OfType<X509KeyUsageExtension>().ToArray();
        if (keyUsages.Length > 0 && !keyUsages.Any(extension =>
                (extension.KeyUsages & X509KeyUsageFlags.DigitalSignature) != 0))
            throw new InvalidOperationException("The selected certificate does not permit digital signatures.");
    }

    private static async Task SignAsync(
        string executable,
        SigningMaterial signing,
        string? timestampUrl,
        string work,
        IProgress<BootstrapExportProgress>? progress,
        Action<Process?>? processChanged,
        CancellationToken cancellationToken)
    {
        // Load the PFX with an ephemeral key in Windows PowerShell. This avoids
        // persisting private-key material in the user's certificate store and keeps
        // the PFX password out of process arguments and logs.
        var script = Path.Combine(work, "sign-bootstrap.ps1");
        try
        {
            File.WriteAllBytes(signing.PfxPath, signing.PfxBytes);
            await File.WriteAllTextAsync(script, """
$ErrorActionPreference = 'Stop'
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
if (-not (Test-Path -LiteralPath $securityModule -PathType Leaf)) {
    throw 'The built-in Windows PowerShell security module is unavailable.'
}
try {
    Import-Module -Name $securityModule -ErrorAction Stop
}
catch {
    # Some isolated Windows hosts preload this built-in type data without
    # registering the module. Reset that process-local metadata and import once.
    Remove-Module Microsoft.PowerShell.Security -Force -ErrorAction SilentlyContinue
    Remove-TypeData -TypeName System.Security.AccessControl.ObjectSecurity -ErrorAction SilentlyContinue
    Import-Module -Name $securityModule -ErrorAction Stop
}
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
$certificates = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
try {
    $certificates.Import($env:THREEBROWSER_SIGN_CERTIFICATE, $env:THREEBROWSER_SIGN_PASSWORD, $flags)
    $expected = ($env:THREEBROWSER_SIGN_THUMBPRINT -replace '\s','').ToUpperInvariant()
    $cert = $certificates | Where-Object {
        $_.HasPrivateKey -and (($_.Thumbprint -replace '\s','').ToUpperInvariant() -eq $expected)
    } | Select-Object -First 1
    if ($null -eq $cert) {
        throw 'The selected signing certificate and private key were not found in the temporary PFX.'
    }
    $parameters = @{
        LiteralPath = $env:THREEBROWSER_SIGN_EXECUTABLE
        Certificate = $cert
        HashAlgorithm = 'SHA256'
        IncludeChain = 'All'
        ErrorAction = 'Stop'
    }
    if (-not [string]::IsNullOrWhiteSpace($env:THREEBROWSER_SIGN_TIMESTAMP)) {
        $parameters.TimestampServer = $env:THREEBROWSER_SIGN_TIMESTAMP
    }
    $signature = Set-AuthenticodeSignature @parameters
    if ($null -eq $signature.SignerCertificate -or
        $signature.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned -or
        $signature.Status -eq [System.Management.Automation.SignatureStatus]::HashMismatch) {
        throw "Authenticode signing failed: $($signature.Status) $($signature.StatusMessage)"
    }
    if ((($signature.SignerCertificate.Thumbprint -replace '\s','').ToUpperInvariant()) -ne $expected) {
        throw 'Authenticode signer does not match the selected certificate.'
    }
    Write-Output "Signature status: $($signature.Status)"
    Write-Output "Signer: $($signature.SignerCertificate.Subject)"
}
finally {
    foreach ($item in $certificates) { $item.Dispose() }
}
""", new UTF8Encoding(false), cancellationToken);
            var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
            {
                ["THREEBROWSER_SIGN_CERTIFICATE"] = signing.PfxPath,
                ["THREEBROWSER_SIGN_PASSWORD"] = signing.Password,
                ["THREEBROWSER_SIGN_THUMBPRINT"] = signing.Thumbprint,
                ["THREEBROWSER_SIGN_EXECUTABLE"] = executable,
                ["THREEBROWSER_SIGN_TIMESTAMP"] = string.IsNullOrWhiteSpace(timestampUrl) ? "" : timestampUrl.Trim(),
            };
            var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(powershell)) powershell = "powershell.exe";
            var exit = await RunProcessAsync(powershell, work,
                ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
                environment, progress, processChanged, cancellationToken);
            if (exit != 0) throw new InvalidOperationException($"Authenticode signing failed with exit code {exit}.");
            VerifySignedCertificate(executable, signing.Thumbprint);
        }
        finally
        {
            try { if (File.Exists(signing.PfxPath)) File.Delete(signing.PfxPath); } catch { }
            CryptographicOperations.ZeroMemory(signing.PfxBytes);
        }
    }

    private static void VerifySignedCertificate(string executable, string expectedThumbprint)
    {
#pragma warning disable SYSLIB0057 // CreateFromSignedFile is the platform API that reads an Authenticode signer from a PE file.
        using var signed = new X509Certificate2(X509Certificate.CreateFromSignedFile(executable));
#pragma warning restore SYSLIB0057
        if (!signed.Thumbprint.Equals(expectedThumbprint, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The final executable signature does not match the selected certificate.");
    }

    private static async Task<int> RunProcessAsync(
        string fileName,
        string workingDirectory,
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string?>? environment,
        IProgress<BootstrapExportProgress>? progress,
        Action<Process?>? processChanged,
        CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(fileName)
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        if (environment is not null)
            foreach (var (key, value) in environment) start.Environment[key] = value;
        using var process = Process.Start(start) ?? throw new InvalidOperationException($"Could not start {fileName}.");
        processChanged?.Invoke(process);
        using var registration = cancellationToken.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
        });
        async Task PumpAsync(StreamReader reader, string kind)
        {
            while (await reader.ReadLineAsync(cancellationToken) is { } line)
                if (!string.IsNullOrWhiteSpace(line)) Report(progress, line, kind);
        }
        var output = PumpAsync(process.StandardOutput, "output");
        var errors = PumpAsync(process.StandardError, "error");
        try
        {
            await process.WaitForExitAsync(cancellationToken);
            await Task.WhenAll(output, errors);
            return process.ExitCode;
        }
        finally
        {
            processChanged?.Invoke(null);
        }
    }

    private static void CreateApplicationIcon(string? sourcePath, string destination)
    {
        using var source = LoadIconSource(sourcePath);
        int[] sizes = [16, 24, 32, 48, 64, 128, 256];
        var images = new List<byte[]>(sizes.Length);
        foreach (var size in sizes)
        {
            using var bitmap = RenderSquareImage(source, size, transparent: true);
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            images.Add(stream.ToArray());
        }
        using var file = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        using var writer = new BinaryWriter(file, Encoding.UTF8, leaveOpen: false);
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write((ushort)images.Count);
        var offset = 6 + images.Count * 16;
        for (var index = 0; index < images.Count; index++)
        {
            var size = sizes[index];
            writer.Write((byte)(size == 256 ? 0 : size));
            writer.Write((byte)(size == 256 ? 0 : size));
            writer.Write((byte)0);
            writer.Write((byte)0);
            writer.Write((ushort)1);
            writer.Write((ushort)32);
            writer.Write(images[index].Length);
            writer.Write(offset);
            offset += images[index].Length;
        }
        foreach (var image in images) writer.Write(image);
    }

    private static void CreateLoadingImage(string? loadingPath, string? iconPath, string destination, string applicationName)
    {
        using var selected = !string.IsNullOrWhiteSpace(loadingPath) ? Image.FromFile(loadingPath) : null;
        using var icon = selected is null ? LoadIconSource(iconPath) : null;
        using var bitmap = new Bitmap(1280, 720, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        using var background = new LinearGradientBrush(new Rectangle(0, 0, bitmap.Width, bitmap.Height),
            Color.FromArgb(8, 13, 23), Color.FromArgb(17, 42, 72), 35f);
        graphics.FillRectangle(background, 0, 0, bitmap.Width, bitmap.Height);
        if (selected is not null)
        {
            DrawContained(graphics, selected, new Rectangle(0, 0, bitmap.Width, bitmap.Height));
        }
        else
        {
            var square = new Rectangle(520, 205, 240, 240);
            using var glow = new SolidBrush(Color.FromArgb(28, 75, 151, 235));
            graphics.FillEllipse(glow, square.X - 55, square.Y - 55, square.Width + 110, square.Height + 110);
            DrawContained(graphics, icon!, square);
            using var font = new Font("Segoe UI", 28f, FontStyle.Bold, GraphicsUnit.Pixel);
            using var brush = new SolidBrush(Color.White);
            var measured = graphics.MeasureString(applicationName, font);
            graphics.DrawString(applicationName, font, brush, (bitmap.Width - measured.Width) / 2, 495);
        }
        bitmap.Save(destination, ImageFormat.Png);
    }

    private static Image LoadIconSource(string? sourcePath)
    {
        if (!string.IsNullOrWhiteSpace(sourcePath))
        {
            if (Path.GetExtension(sourcePath).Equals(".ico", StringComparison.OrdinalIgnoreCase))
            {
                using var icon = new Icon(sourcePath, 256, 256);
                return new Bitmap(icon.ToBitmap());
            }
            using var image = Image.FromFile(sourcePath);
            return new Bitmap(image);
        }
        var bitmap = new Bitmap(512, 512, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var background = new LinearGradientBrush(new Rectangle(0, 0, 512, 512),
            Color.FromArgb(27, 112, 226), Color.FromArgb(59, 71, 180), 45f);
        graphics.FillRoundedRectangle(background, new Rectangle(18, 18, 476, 476), 104);
        PointF[] triangle = [new(178, 132), new(388, 256), new(178, 380)];
        using var fill = new SolidBrush(Color.FromArgb(238, 248, 255));
        graphics.FillPolygon(fill, triangle);
        return bitmap;
    }

    private static Bitmap RenderSquareImage(Image source, int size, bool transparent)
    {
        var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.Clear(transparent ? Color.Transparent : Color.Black);
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        DrawContained(graphics, source, new Rectangle(0, 0, size, size));
        return bitmap;
    }

    private static void DrawContained(Graphics graphics, Image source, Rectangle bounds)
    {
        var scale = Math.Min((double)bounds.Width / source.Width, (double)bounds.Height / source.Height);
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        var target = new Rectangle(bounds.X + (bounds.Width - width) / 2, bounds.Y + (bounds.Height - height) / 2, width, height);
        graphics.DrawImage(source, target);
    }

    private static void ExtractArchive(string archivePath, string destination, CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(archivePath);
        var boundary = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(boundary, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Unsafe payload path.");
            if (string.IsNullOrEmpty(entry.Name)) Directory.CreateDirectory(target);
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                entry.ExtractToFile(target, overwrite: false);
            }
        }
    }

    private static void CopyFileAtomically(string source, string destination)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        if (File.Exists(destination) || Directory.Exists(destination)) throw new IOException($"Export target already exists: {destination}");
        var temporary = destination + ".writing-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temporary, overwrite: false);
            File.Move(temporary, destination);
        }
        finally
        {
            try { File.Delete(temporary); } catch { }
        }
    }

    private static void CopyNewTree(string source, string destination, CancellationToken cancellationToken,
        Func<string, bool>? include = null)
    {
        if (File.Exists(destination) || Directory.Exists(destination)) throw new IOException($"Export target already exists: {destination}");
        var parent = Path.GetDirectoryName(Path.GetFullPath(destination))
            ?? throw new IOException($"The export target has no parent directory: {destination}");
        Directory.CreateDirectory(parent);
        var claim = Path.Combine(parent, ".threebrowser-tree-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(claim);
        var ownsDestination = false;
        try
        {
            Directory.Move(claim, destination);
            ownsDestination = true;
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(source, file);
                if (include is not null && !include(relative)) continue;
                var target = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target, overwrite: false);
            }
        }
        catch
        {
            DeleteOwnedTree(claim);
            if (ownsDestination) DeleteOwnedTree(destination);
            throw;
        }
    }

    private static void MoveDirectoryWithRetry(string source, string destination)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                Directory.Move(source, destination);
                return;
            }
            catch (Exception error) when (attempt < 5 &&
                                          (error is IOException or UnauthorizedAccessException) &&
                                          !File.Exists(destination) && !Directory.Exists(destination))
            {
                Thread.Sleep(100 * (attempt + 1));
            }
        }
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string? FindNodeModules(string start)
    {
        var current = new DirectoryInfo(start);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "node_modules");
            if (File.Exists(Path.Combine(candidate, "three", "package.json"))) return candidate;
            current = current.Parent;
        }
        return null;
    }

    private static string ResolveExecutable(string executable, string label)
    {
        if (Path.IsPathRooted(executable) && File.Exists(executable)) return Path.GetFullPath(executable);
        if (File.Exists(executable)) return Path.GetFullPath(executable);
        var names = Path.HasExtension(executable) ? new[] { executable } : new[] { executable, executable + ".exe" };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator,
                     StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            foreach (var name in names)
            {
                var candidate = Path.Combine(directory, name);
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
        throw new FileNotFoundException($"Could not locate {label}.", executable);
    }

    private static async Task EnsureDotNet10SdkAsync(
        string dotnet,
        IProgress<BootstrapExportProgress>? progress,
        Action<Process?>? processChanged,
        CancellationToken cancellationToken)
    {
        Report(progress, "Checking the .NET 10 export toolchain…", "command");
        var start = new ProcessStartInfo(dotnet)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        start.ArgumentList.Add("--list-sdks");
        using var process = Process.Start(start)
            ?? throw new InvalidOperationException("Could not inspect the installed .NET SDKs.");
        processChanged?.Invoke(process);
        using var registration = cancellationToken.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
        });
        try
        {
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var output = await outputTask;
            var error = await errorTask;
            if (process.ExitCode != 0)
                throw new InvalidOperationException("Could not inspect the installed .NET SDKs. " + error.Trim());
            var version = output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(line => line.Split(' ', 2)[0].Split('-', 2)[0])
                .Select(value => Version.TryParse(value, out var parsed) ? parsed : null)
                .Where(value => value is { Major: >= 10 })
                .OrderByDescending(value => value)
                .FirstOrDefault();
            if (version is null)
                throw new InvalidOperationException(
                    "Exporting a Windows executable requires the .NET 10 SDK (the runtime alone is not enough). Install the x64 .NET 10 SDK and try again.");
            Report(progress, $"Using .NET SDK {version}.", "muted");
        }
        finally
        {
            processChanged?.Invoke(null);
        }
    }

    private static void ValidateOptionalFile(string? path, string label, bool required = false)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            if (required) throw new ArgumentException($"Choose a {label}.");
            return;
        }
        if (!File.Exists(Path.GetFullPath(path))) throw new FileNotFoundException($"The selected {label} does not exist.", path);
    }

    internal static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        invalid.UnionWith(['$', '@', '%']);
        var builder = new StringBuilder();
        var lastWasSpace = false;
        foreach (var character in value.Trim())
        {
            var replacement = invalid.Contains(character) || char.IsControl(character) ? ' ' : character;
            if (char.IsWhiteSpace(replacement))
            {
                if (!lastWasSpace) builder.Append(' ');
                lastWasSpace = true;
            }
            else
            {
                builder.Append(replacement);
                lastWasSpace = false;
            }
        }
        var result = builder.ToString().Trim().TrimEnd(' ', '.');
        if (result.Length == 0) result = "ThreeBrowser App";
        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };
        if (reserved.Contains(result.Split('.', 2)[0])) result = "App " + result;
        return result.Length > 80 ? result[..80].TrimEnd(' ', '.') : result;
    }

    private static void EnsureTreeContainsNoReparsePoints(string root)
    {
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
            throw new IOException($"Linked directories cannot be embedded: {root}");
        foreach (var path in Directory.EnumerateFileSystemEntries(root, "*", SearchOption.AllDirectories))
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new IOException($"Linked files or directories cannot be embedded: {path}");
    }

    private static bool IsWithin(string root, string path) =>
        Path.GetFullPath(path).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);

    private static DateTimeOffset ClampZipTimestamp(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();
        if (utc.Year < 1980) return new DateTimeOffset(new DateTime(1980, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        if (utc.Year > 2107) return new DateTimeOffset(new DateTime(2107, 12, 31, 23, 59, 58, DateTimeKind.Utc));
        return new DateTimeOffset(utc);
    }

    private static void DeleteOwnedTree(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;
        try { Directory.Delete(path, recursive: true); } catch { }
    }

    private static void TryDeleteFile(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        var value = (double)bytes;
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1) { value /= 1024; unit++; }
        return $"{value:0.#} {units[unit]}";
    }

    private static void Report(IProgress<BootstrapExportProgress>? progress, string message, string kind = "output") =>
        progress?.Report(new BootstrapExportProgress(message, kind));

    private sealed record NormalizedExport(string ApplicationName, string FileName, string ProjectDirectory, string DestinationDirectory);
    private sealed record PayloadFile(string Path, long Size, string Sha256);
    private sealed record PayloadSummary(int ProjectFileCount, int ShaderFileCount, int FileCount, string ManifestHash);
    private sealed record SigningMaterial(string PfxPath, byte[] PfxBytes, string Password, string Thumbprint, string? PublicCertificatePath);
}

internal static class GraphicsExtensions
{
    internal static void FillRoundedRectangle(this Graphics graphics, Brush brush, Rectangle bounds, int radius)
    {
        var diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
        using var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        graphics.FillPath(brush, path);
    }
}
