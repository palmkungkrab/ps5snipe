# Registers a Windows scheduled task "ps5snipe" that starts run-windows.cmd at boot, before anyone logs in,
# and keeps it running (no time limit, also on battery). Needs an Administrator PowerShell, once:
#   powershell -ExecutionPolicy Bypass -File setup-windows-task.ps1
# Stop it:   Stop-ScheduledTask -TaskName ps5snipe
# Remove it: Unregister-ScheduledTask -TaskName ps5snipe -Confirm:$false
$ErrorActionPreference = 'Stop'
$dir  = $PSScriptRoot
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$action  = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\cmd.exe" -Argument "/c `"$dir\run-windows.cmd`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT1M'   # give Wi-Fi a minute to connect after boot
# S4U: runs as you whether or not you are logged in, without storing your password
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'ps5snipe' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ps5snipe'
Get-ScheduledTask -TaskName 'ps5snipe' | Select-Object TaskName, State, @{n='RunsAs'; e={$_.Principal.UserId}}
