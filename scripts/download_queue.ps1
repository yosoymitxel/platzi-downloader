# Descarga en cola los cursos de Platzi segun scripts/cola_descarga.json
# (generado por scripts/build_queue.py: primero los sin certificado, priorizando
# ingles / claude / laravel-php / react; los certificados quedan fuera salvo -IncludeCertified).
#
# Uso:
#   pwsh -File scripts/download_queue.ps1                    # cola sin certificados
#   pwsh -File scripts/download_queue.ps1 -IncludeCertified  # agrega los certificados al final
#   pwsh -File scripts/download_queue.ps1 -Slugs a,b,c       # solo esos slugs
param(
    [string[]]$Slugs = @(),
    [switch]$IncludeCertified
)
$ErrorActionPreference = "Continue"

$scriptsDir = $PSScriptRoot
$root = Split-Path -Parent $scriptsDir
Set-Location $root

$jsonPath = Join-Path $scriptsDir "cola_descarga.json"
$cola = Get-Content $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$list = @($cola.queue_unfinished)
if ($IncludeCertified) {
    $list = @($list) + @($cola.queue_certified)
}
if ($Slugs.Count -gt 0) {
    $list = @($list | Where-Object { $Slugs -contains $_.slug })
}

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("download_queue_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))

function Log([string]$msg) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

Log ("INICIO cola: {0} cursos | log: {1}" -f $list.Count, $log)
$ok = 0
$fail = 0
$consecutiveFails = 0
$tAll = Get-Date
$i = 0
foreach ($c in $list) {
    $i++
    $url = "https://platzi.com/cursos/{0}/" -f $c.slug
    Log ("({0}/{1}) INICIO {2} | {3}" -f $i, $list.Count, $c.title, $url)
    $t0 = Get-Date
    Add-Content -Path $log -Value ("{0}`nsalida de platzi:" -f ("-" * 60)) -Encoding UTF8
    & platzi download $url *>> $log
    $rc = $LASTEXITCODE
    $mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
    if ($rc -eq 0) {
        $ok++
        $consecutiveFails = 0
        Log ("({0}/{1}) OK en {2} min" -f $i, $list.Count, $mins)
    }
    else {
        $fail++
        $consecutiveFails++
        Log ("({0}/{1}) FALLO rc={2} tras {3} min" -f $i, $list.Count, $rc, $mins)
        if ($consecutiveFails -ge 2) {
            Log "Dos fallos consecutivos: detengo la cola. Revisar este log antes de relanzar."
            break
        }
    }
}
$totalMin = [math]::Round(((Get-Date) - $tAll).TotalMinutes, 1)
Log ("FIN cola: {0} ok, {1} fallos, {2} min en total" -f $ok, $fail, $totalMin)
