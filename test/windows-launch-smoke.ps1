# Optional desktop smoke. Run in an interactive Windows session.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$launcherName = ('26412 22320 20307 39564 23457 26597 23545 35805'.Split(' ') | ForEach-Object { [char][int]$_ }) -join ''
$launcher = Join-Path $root ($launcherName + '.cmd')

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class ReviewLaunch {
    delegate bool EnumChildProc(IntPtr child, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr unused);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(
        IntPtr hwnd, uint msg, UIntPtr size, StringBuilder output, uint flags, uint timeout, out UIntPtr result);
    public static string[] VisibleText(IntPtr window) {
        var texts=new List<string>();
        EnumChildWindows(window,(child, unused)=>{
            if (!IsWindowVisible(child)) return true;
            var content = new StringBuilder(500);
            UIntPtr result;
            if (SendMessageTimeout(child,13,(UIntPtr)500,content,2,400,out result)!=IntPtr.Zero && content.Length>0) texts.Add(content.ToString());
            return true;
        },IntPtr.Zero);
        return texts.ToArray();
    }
}
'@

$launch = Start-Process -FilePath $launcher -WorkingDirectory $root -WindowStyle Hidden -PassThru
$window = $null
$body = ''
$deadline = [DateTime]::UtcNow.AddSeconds(8)
$tasks = [string][char]25214 + [char]21040 + ' 2 ' + [char]20010
try {
    do {
        $world = @(Get-CimInstance Win32_Process -Filter "name='cmd.exe' OR name='node.exe' OR name='powershell.exe'")
        $children = @($world | Where-Object { $_.ParentProcessId -eq $launch.Id } | Select-Object -ExpandProperty ProcessId)
        $ps = @($world | Where-Object { $_.Name -eq 'powershell.exe' -and $_.ParentProcessId -in $children })
        foreach ($entry in $ps) {
            $proc = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
            if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero -and $proc.MainWindowTitle -like 'Yo-po *' -and $proc.Responding) {
                $window = $proc
                $body = [ReviewLaunch]::VisibleText($window.MainWindowHandle) -join [Environment]::NewLine
                if ($body.Contains($tasks)) { break }
            }
        }
        if (!$body.Contains($tasks)) { Start-Sleep -Milliseconds 160 }
    } until (($window -and $body.Contains($tasks)) -or [DateTime]::UtcNow -gt $deadline -or $launch.HasExited)
    if (!$window) { throw 'Launcher waited without a visible WinForms window.' }
    # Confirm both the two fixture tasks and a visible Apply control; an HWND alone need not be painted.
    $apply = ('24212 29992 21040 26412 20219 21153'.Split(' ') | ForEach-Object { [char][int]$_ }) -join ''
    if (!$body.Contains($apply) -or !$body.Contains($tasks)) { throw ('Missing rendered startup controls: '+$body) }
    Write-Output ('WinForms launch OK: '+$window.MainWindowTitle)
    Write-Output $body
} finally {
    if ($window -and !$window.HasExited) { [void]$window.CloseMainWindow() }
    if (!$launch.HasExited -and !$launch.WaitForExit(2500)) { & taskkill.exe /PID $launch.Id /T /F | Out-Null }
}
