[CmdletBinding()]
param([string]$CacheDir)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
    throw 'This build targets Windows x64.'
}

$engineDir = Join-Path $PSScriptRoot '.engine'
$target = Join-Path $PSScriptRoot 'extension'
$buildLock = [System.IO.File]::Open(
    (Join-Path $PSScriptRoot '.build.lock'), 'OpenOrCreate', 'ReadWrite', 'None'
)

function Assert-Sha256([string]$Path, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) {
        throw "SHA-256 verification failed for $Path."
    }
}

function Get-Asset([string]$Name, [string]$Url, [string]$Sha256) {
    $destination = Join-Path $engineDir $Name
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        Assert-Sha256 $destination $Sha256
        return $destination
    }
    $partial = "$destination.part"
    try {
        if ($CacheDir -and (Test-Path -LiteralPath (Join-Path $CacheDir $Name) -PathType Leaf)) {
            Copy-Item -LiteralPath (Join-Path $CacheDir $Name) -Destination $partial -Force
        } else {
            Write-Host "Downloading $Name"
            & curl.exe --fail --location --retry 2 --connect-timeout 20 --output $partial $Url
            if ($LASTEXITCODE -ne 0) { throw "Download failed for $Name (curl $LASTEXITCODE)." }
        }
        Assert-Sha256 $partial $Sha256
        Move-Item -LiteralPath $partial -Destination $destination
        return $destination
    } finally {
        if (Test-Path -LiteralPath $partial -PathType Leaf) { Remove-Item -LiteralPath $partial }
    }
}

try {
    New-Item -ItemType Directory -Path $engineDir, $target -Force | Out-Null
    $archiveName = 'llama-b12246-bin-win-vulkan-x64.zip'
    $archive = Get-Asset $archiveName `
        "https://github.com/ggml-org/llama.cpp/releases/download/b12246/$archiveName" `
        'ca8cfe89b00fd447ac3b816d095871bc9b6ca9835fd96e06238a9ff5d1640639'
    $modelName = 'plamo-3-translate-0.8b-Q4_K_M.gguf'
    $null = Get-Asset $modelName `
        "https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/e10c327b7a7ce84ffc427cb4b09360b781429fda/$modelName" `
        '70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6'

    $runtime = Join-Path $engineDir 'llama-b12246-vulkan'
    if (!(Test-Path -LiteralPath (Join-Path $runtime '.ready') -PathType Leaf)) {
        Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
        if (!(Test-Path -LiteralPath (Join-Path $runtime 'llama-server.exe') -PathType Leaf)) {
            throw 'The runtime archive does not contain llama-server.exe in the expected location.'
        }
        New-Item -ItemType File -Path (Join-Path $runtime '.ready') -Force | Out-Null
    }

    $keyFile = Join-Path $engineDir 'key.txt'
    if (!(Test-Path -LiteralPath $keyFile -PathType Leaf)) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        [System.IO.File]::WriteAllText($keyFile, "$secret`n", [System.Text.Encoding]::ASCII)
    }
    $secret = [System.IO.File]::ReadAllText($keyFile).Trim()
    if ($secret -cnotmatch '^[a-f0-9]{64}$') { throw 'The local engine key file is invalid.' }

    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -File |
        Copy-Item -Destination $target -Force
    $configuration = 'export const apiKey = "' + $secret + '";'
    [System.IO.File]::WriteAllText((Join-Path $target 'config.js'), $configuration, [System.Text.Encoding]::ASCII)
    Write-Host "Build complete. Load this directory in both browsers:"
    Write-Host $target
} finally {
    $buildLock.Dispose()
}
