param(
    [Parameter(Mandatory = $true)][string]$BridgeDirectory,
    [string]$TaskName = 'Nebrax Local Hardware Bridge'
)

$resolved = (Resolve-Path -LiteralPath $BridgeDirectory).Path
$package = Join-Path $resolved 'package.json'
if (-not (Test-Path -LiteralPath $package)) { throw "لم يُعثر على package.json في $resolved" }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $npm -Argument 'start' -WorkingDirectory $resolved
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Description 'Nebrax localhost-only POS cash-drawer bridge' -Force | Out-Null
Write-Output "تم تسجيل التشغيل التلقائي: $TaskName"
