$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$utf8 = [Text.UTF8Encoding]::new($false)
$reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$writer = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true

$form = [Windows.Forms.Form]::new()
$form.Text = 'Yo-po · 审查接口设置'
$form.StartPosition = 'CenterScreen'
$form.AutoScaleMode = 'Dpi'
$form.ClientSize = [Drawing.Size]::new(760, 560)
$form.MinimumSize = [Drawing.Size]::new(540, 420)
$form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)

function New-Control($type, $name, $caption, $x, $y, $width, $height, $anchors) {
    $control = New-Object ('Windows.Forms.' + $type)
    $control.Name = $name
    $control.Text = $caption
    $control.SetBounds($x, $y, $width, $height)
    $control.Anchor = $anchors
    $form.Controls.Add($control)
    return $control
}
$heading = New-Control Label Heading '审查接口设置' 16 15 230 30 'Top, Left'
$heading.Font = [Drawing.Font]::new($form.Font.FontFamily, 13, [Drawing.FontStyle]::Bold)
$copy = New-Control Button CopyPage '复制页面文字' 608 9 136 34 'Top, Right'
$log = New-Control RichTextBox PageText '' 16 53 728 363 'Top, Bottom, Left, Right'
$log.ReadOnly = $true
$log.BackColor = [Drawing.SystemColors]::Window
$log.DetectUrls = $false
$log.HideSelection = $false
$log.ShortcutsEnabled = $true
$log.AccessibleName = '可选择和复制的设置说明'
$prompt = New-Control Label Prompt '' 16 426 728 42 'Bottom, Left, Right'
$prompt.AutoEllipsis = $true
$entry = New-Control TextBox Answer '' 16 474 628 32 'Bottom, Left, Right'
$entry.Enabled = $false
$entry.ShortcutsEnabled = $true
$paste = New-Control Button Paste '粘贴' 654 470 90 34 'Bottom, Right'
$paste.Enabled = $false
$notice = New-Control Label Status '' 16 518 416 30 'Bottom, Left, Right'
$submit = New-Control Button Submit '下一步' 484 511 138 34 'Bottom, Right'
$submit.Enabled = $false
$close = New-Control Button Close '关闭' 632 511 112 34 'Bottom, Right'
$form.AcceptButton = $submit
$form.CancelButton = $close
$script:finished = $false

function Send-Frame($frame) {
    $writer.WriteLine((ConvertTo-Json -Compress -InputObject $frame))
}
function Show-Frame($frame) {
    switch ($frame.type) {
        'print' {
            $log.AppendText(($frame.text -replace '\r?\n', [Environment]::NewLine) + [Environment]::NewLine)
        }
        'ask' {
            $prompt.Text = $frame.text
            $entry.Clear()
            $entry.UseSystemPasswordChar = [bool]$frame.secret
            $entry.AccessibleName = if ($frame.secret) { 'API Key（隐藏输入）' } else { '设置输入' }
            $entry.Enabled = $true
            $paste.Enabled = $true
            $submit.Enabled = $true
            $notice.Text = ''
            [void]$entry.Focus()
        }
        'finish' {
            $script:finished = $true
            $prompt.Text = ''
            $notice.Text = ''
            $submit.Text = '更换接口'
            $submit.Enabled = $true
        }
        'reset' {
            $script:finished = $false
            $submit.Text = '下一步'
            $notice.Text = ''
            $log.Clear()
        }
    }
}
$copy.Add_Click({
    $page = ($log.Text + [Environment]::NewLine + $prompt.Text).Trim()
    if (!$page) { return }
    try {
        [Windows.Forms.Clipboard]::SetText($page)
        $notice.Text = '页面文字已复制'
    } catch {
        $notice.Text = '剪贴板暂时不可用，请再点一次。'
    }
})
$paste.Add_Click({
    if (!$entry.Enabled) { return }
    try { $entry.Paste(); [void]$entry.Focus() }
    catch { $notice.Text = '粘贴失败，请在输入框按 Ctrl+V。' }
})
$submit.Add_Click({
    if (!$submit.Enabled) { return }
    $submit.Enabled = $false
    if ($script:finished) {
        Send-Frame @{type='again'}
        return
    }
    $value = $entry.Text
    $entry.Clear()
    $entry.Enabled = $false
    $paste.Enabled = $false
    # Copyable page text contains installer output only. Never append field values.
    $prompt.Text = ''
    $notice.Text = '正在处理…'
    Send-Frame @{type='answer'; value=$value}
})
$close.Add_Click({ $form.Close() })

$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 45
$timer.Add_Tick({
    try {
        while ($script:line.IsCompleted) {
            $json = $script:line.GetAwaiter().GetResult()
            if ($null -eq $json) { $form.Close(); return }
            Show-Frame (ConvertFrom-Json -InputObject $json)
            $script:line = $reader.ReadLineAsync()
        }
    } catch { $form.Close() }
})
$form.Add_Shown({
    Send-Frame @{type='ready'}
    $script:line = $reader.ReadLineAsync()
    $timer.Start()
    $form.Activate()
})
try { [Windows.Forms.Application]::Run($form) }
finally { $timer.Stop(); $timer.Dispose(); $form.Dispose(); $writer.Dispose() }
