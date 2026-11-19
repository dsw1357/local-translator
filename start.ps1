[CmdletBinding()]
param(
    [ValidatePattern('^Vulkan\d+$')][string]$Device,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$engineDir = Join-Path $PSScriptRoot '.engine'
$server = Join-Path $engineDir 'llama-b12246-vulkan\llama-server.exe'
$model = Join-Path $engineDir 'plamo-3-translate-0.8b-Q4_K_M.gguf'
$keyFile = Join-Path $engineDir 'key.txt'
$running = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $server })
if ($Stop) {
    if ($running) {
        $running | Stop-Process
        Write-Host 'Stopped this package GPU translator.'
    } else {
        Write-Host 'This package GPU translator is already stopped.'
    }
    return
}
if ($running) {
    Write-Host 'This package GPU translator is already running.'
    return
}
foreach ($asset in $server, $model, $keyFile) {
    if (!(Test-Path -LiteralPath $asset -PathType Leaf)) { throw 'Run BUILD.cmd to prepare the Vulkan GPU engine.' }
}

$devices = @(& $server --list-devices)
if ($LASTEXITCODE -ne 0) { throw 'The Vulkan runtime could not enumerate GPUs. Check the GPU driver.' }
$gpuList = @(foreach ($line in $devices) {
    if ($line -match '^\s*(Vulkan\d+)\s*:\s*(.*\((\d+) MiB, (\d+) MiB free\))\s*$') {
        [pscustomobject]@{ Id = $Matches[1]; Description = $Matches[2]; Free = [int]$Matches[4] }
    }
})
$gpu = if ($Device) {
    $gpuList | Where-Object Id -EQ $Device | Select-Object -First 1
} else {
    $gpuList | Sort-Object Free -Descending | Select-Object -First 1
}
if (!$gpu) { throw 'No matching Vulkan GPU was found. Install a Vulkan-capable GPU driver.' }

$threads = [Math]::Max(1, [Math]::Min(8, [Environment]::ProcessorCount))
Write-Host "Starting the GPU translator at 127.0.0.1:39781 on $($gpu.Id): $($gpu.Description)"
Write-Host 'Give the model a few seconds to load. Leave this window open while translating.'
Write-Host 'Press Ctrl+C to stop.'
& $server --model $model --alias plamo-3-translate-0.8b --host 127.0.0.1 --port 39781 `
    --api-key-file $keyFile --offline --no-webui --log-disable `
    --ctx-size 8192 --parallel 2 --threads $threads --device $gpu.Id --n-gpu-layers all --fit off
if ($LASTEXITCODE -ne 0) {
    throw "The GPU engine stopped (exit $LASTEXITCODE). Check the Vulkan driver, available GPU memory and port 39781."
}
