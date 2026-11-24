$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-DeskGrid($columns, $rows) {
    $g = [Windows.Forms.TableLayoutPanel]::new()
    $g.ColumnCount = $columns; $g.RowCount = $rows
    $g.Dock = 'Fill'; $g.Margin = [Windows.Forms.Padding]::new(0)
    return $g
}
function Add-DeskColumn($grid, $type, $width) {
    [void]$grid.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new([Windows.Forms.SizeType]$type,[single]$width))
}
function Add-DeskRow($grid, $type, $height) {
    [void]$grid.RowStyles.Add([Windows.Forms.RowStyle]::new([Windows.Forms.SizeType]$type,[single]$height))
}
function New-DeskControl($type, $name, $caption) {
    $c = New-Object ('Windows.Forms.' + $type)
    $c.Name = $name; $c.AccessibleName = $caption; $c.Text = $caption; $c.Dock = 'Fill'
    if ($type -eq 'Label') { $c.TextAlign = 'MiddleLeft'; $c.AutoEllipsis = $true }
    return $c
}
function Add-DeskItem($grid,$c,$col,$row) { $grid.Controls.Add($c,$col,$row) }
function Set-DeskStatus($message, $warn=$false) {
    $status.Text = $message
    $status.ForeColor = if ($warn) { [Drawing.Color]::Maroon } else { [Drawing.Color]::FromArgb(34,65,80) }
}
function Write-DeskLog($who,$message) {
    $nl=[Environment]::NewLine
    $log.AppendText($who+'：'+($message -replace '\r?\n',$nl)+$nl+$nl)
    $log.SelectionStart=$log.TextLength; $log.ScrollToCaret()
}
function Emit-DeskFrame($item) { & $script:emitFrame $item }
function Get-DeskKey($task) { return @{session=$task.session;run=$task.run} }
function Is-DeskTask($a,$b) { return ($null -ne $a -and $null -ne $b -and $a.session -eq $b.session -and $a.run -eq $b.run) }
function Get-DeskPhase($p) {
    switch ($p) { 'planning' {'派工中'} 'running' {'执行中'} 'reviewing' {'审查中'} 'continuing' {'待复审'} default {$p} }
}
function Update-DeskButtons {
    $valid=($null -ne $script:chosen -and $script:selectedReady)
    if ($valid -and $script:rev -gt 0) {
        $draftTitle.Text=if ($draft.Text.Trim() -ceq $script:appliedText) {
            '本任务规则 · 已应用第 '+$script:rev+' 版（可修改后替换）'
        } else { '规则草案 · 修改未应用（当前生效：第 '+$script:rev+' 版）' }
    }
    $entry.Enabled=$valid
    $draft.ReadOnly=(!$valid)
    $submit.Enabled=($valid -and !$script:waiting -and ![string]::IsNullOrWhiteSpace($entry.Text))
    $suggest.Enabled=($valid -and !$script:waiting -and ($script:haveHistory -or ![string]::IsNullOrWhiteSpace($entry.Text)))
    $apply.Enabled=($valid -and !$script:applying -and ![string]::IsNullOrWhiteSpace($draft.Text) -and $draft.Text.Trim() -cne $script:appliedText)
    $simulate.Enabled=($valid -and !$script:simulating)
}
function Set-DeskSelection($task) {
    $script:viewId++; $script:chosen=$task; $script:selectedReady=$false
    $script:haveHistory=$false; $script:waiting=$false; $script:applying=$false; $script:simulating=$false
    $script:appliedText=''; $script:rev=0; $script:draftAtSend=''; $script:sentText=''
    $log.Clear();$entry.Clear();$draft.Clear()
    $draftTitle.Text='规则草案   ·   尚未应用'
    if ($null -ne $task) {
        $scope.Text='本任务：'+$task.goal+'  /  '+$task.run.Substring(0,8)
        Set-DeskStatus '正在读取本任务已应用的规则…'
        Emit-DeskFrame @{type='select';view=$script:viewId;target=(Get-DeskKey $task)}
    } else {
        $scope.Text='先在上方选择一个任务，不会默认选中任何聊天。'
        Emit-DeskFrame @{type='select';view=$script:viewId;target=$null}
    }
    Update-DeskButtons
}
function Send-ReviewMessage($kind) {
    if (!$script:selectedReady -or $script:waiting) { return }
    $value=$entry.Text.Trim()
    if (!$value -and $kind -eq 'draft' -and $script:haveHistory) { $value='请把我们在这个窗口讨论的验收重点整理成可编辑的规则。' }
    if (!$value) { return }
    $script:sentText=$entry.Text; $script:draftAtSend=$draft.Text; $script:waiting=$true
    Write-DeskLog '你' $value
    Set-DeskStatus '正在等审查模型回复。Codex 继续原任务。'
    Emit-DeskFrame @{type='message';view=$script:viewId;target=(Get-DeskKey $script:chosen);text=$value;mode=$kind}
    Update-DeskButtons
}
function Apply-ReviewRule {
    if (!$apply.Enabled -or !$script:selectedReady) { return }
    $script:applying=$true
    Emit-DeskFrame @{type='apply';view=$script:viewId;target=(Get-DeskKey $script:chosen);text=$draft.Text}
    Set-DeskStatus '正在保存到所选任务…';Update-DeskButtons
}

function Show-ReviewFrame($f) {
    if ($f.type -eq 'tasks') {
        $script:isDemo=[bool]$f.demo; $simulate.Visible=$script:isDemo
        $model.Text=if ($script:isDemo) { '离线体验 · 本机模拟审查模型，不用密钥或额度' } else { '审查接口：'+$f.model }
        $items=@($f.tasks | Where-Object { $null -ne $_ })
        $old=$script:chosen; $keep=-1; $script:filling=$true
        try {
            $picker.Items.Clear();$script:taskItems=$items
            for ($i=0;$i -lt $items.Count;$i++) {
                $it=$items[$i];$stamp=[DateTimeOffset]::Parse([string]$it.updatedAt).LocalDateTime.ToString('MM-dd HH:mm:ss')
                [void]$picker.Items.Add(($it.goal+'  ·  '+(Get-DeskPhase $it.phase)+'  ·  '+$stamp+'  ·  '+$it.run.Substring(0,8)))
                if (Is-DeskTask $it $old) { $keep=$i }
            }
            $picker.SelectedIndex=$keep
        } finally { $script:filling=$false }
        if ($old -and $keep -lt 0) {
            Set-DeskSelection $null
            Set-DeskStatus '原任务已不在可用列表，已取消选择。' $true
        } elseif ($keep -ge 0 -and !$script:selectedReady) { Set-DeskSelection $items[$keep] }
        elseif ($keep -lt 0) {
            if ($items.Count -eq 0) { Set-DeskStatus '没有可用任务。需使用新版 Hooks，且任务尚未结束、暂停或进入闭卷模式。' $true }
            else { Set-DeskStatus ('找到 '+$items.Count+' 个可选任务。请先选择一个。') }
        }
        Update-DeskButtons;return
    }
    if ($null -ne $f.view -and [int]$f.view -ne $script:viewId) { return }
    switch ($f.type) {
        'selected' {
            if (!$script:chosen) { return }
            $script:selectedReady=$true; $script:rev=[int]$f.applied.revision; $script:appliedText=[string]$f.applied.text
            $draft.Text=$script:appliedText
            if ($script:rev) { $draftTitle.Text='本任务规则 · 已应用第 '+$script:rev+' 版（可修改后替换）' }
            else { $draftTitle.Text='规则草案 · 仅按右下角按钮才生效' }
            Set-DeskStatus ('第 '+$f.round+' 轮 · '+(Get-DeskPhase $f.phase)+'。可以先聊，也可以直接写规则。')
        }
        'reply' {
            $script:waiting=$false; $script:haveHistory=$true
            if ($entry.Text -ceq $script:sentText) { $entry.Clear() }
            Write-DeskLog '审查模型' $f.reply
            if ($f.draft) {
                if ($draft.Text -ceq $script:draftAtSend) { $draft.Text=$f.draft; Set-DeskStatus '模型给了草案。请先检查或编辑，再决定是否应用。' }
                else { Write-DeskLog '新草案（保留了你下方的编辑）' $f.draft; Set-DeskStatus '新草案在对话里，没有覆盖你正在编辑的文字。' }
            } else { Set-DeskStatus '已回复，审查规则没有变化。' }
        }
        'applied' {
            $script:applying=$false;$script:rev=[int]$f.revision;$script:appliedText=[string]$f.text
            $draftTitle.Text='本任务规则 · 已应用第 '+$script:rev+' 版（可修改后替换）'
            if ($f.phase -eq 'reviewing') { Set-DeskStatus '已应用到本任务。正在进行的审查不变，从下一次审查开始使用。' }
            else { Set-DeskStatus '已应用到本任务，从下一次审查开始使用。没有向 Codex 发消息。' }
        }
        'demoResult' {
            $script:simulating=$false;Write-DeskLog '模拟审查实际收到' $f.text
            Set-DeskStatus '结果已显示在对话区，这条模拟记录不会加入旁聊请求。'
        }
        'error' {
            if ($f.operation -eq 'message') { $script:waiting=$false }
            if ($f.operation -eq 'apply') { $script:applying=$false }
            if ($f.operation -eq 'demoStop') { $script:simulating=$false }
            if ($f.code -in @('STALE_TASK','RULE_CONFLICT')) { $script:selectedReady=$false }
            Set-DeskStatus ([string]$f.text) $true
        }
    }
    Update-DeskButtons
}

function Initialize-ReviewChatWindow([scriptblock]$emit) {
    $script:emitFrame=$emit
    [Windows.Forms.Application]::EnableVisualStyles()
    $script:form=[Windows.Forms.Form]::new()
    $form.Text='Yo-po · 审查对话'; $form.StartPosition='CenterScreen'; $form.AutoScaleMode='Dpi'
    $form.ClientSize=[Drawing.Size]::new(824,706);$form.MinimumSize=[Drawing.Size]::new(690,645)
    $form.Font=[Drawing.Font]::new('Microsoft YaHei UI',10)
    $root=New-DeskGrid 1 9; $root.Padding=[Windows.Forms.Padding]::new(15,10,15,10);$form.Controls.Add($root)
    Add-DeskColumn $root 'Percent' 100
    foreach ($h in @(36,41,43,32)) { Add-DeskRow $root 'Absolute' $h }
    Add-DeskRow $root 'Percent' 61; Add-DeskRow $root 'Absolute' 65; Add-DeskRow $root 'Absolute' 34
    Add-DeskRow $root 'Percent' 39; Add-DeskRow $root 'Absolute' 52
    $top=New-DeskGrid 2 1;Add-DeskColumn $top 'Absolute' 160;Add-DeskColumn $top 'Percent' 100
    $head=New-DeskControl Label Heading '审查对话';$head.Font=[Drawing.Font]::new($form.Font.FontFamily,15,[Drawing.FontStyle]::Bold)
    $script:model=New-DeskControl Label Provider '读取本地接口…';$model.TextAlign='MiddleRight'
    Add-DeskItem $top $head 0 0;Add-DeskItem $top $model 1 0;Add-DeskItem $root $top 0 0
    $privacy=New-DeskControl Label Privacy '只把本窗口发送的文字和最近几轮讨论交给审查模型。不会自动附上任务、Codex 记录或文件；请勿粘贴密钥。'
    $privacy.ForeColor=[Drawing.Color]::DimGray;Add-DeskItem $root $privacy 0 1
    $bar=New-DeskGrid 3 1;Add-DeskColumn $bar 'Absolute' 78;Add-DeskColumn $bar 'Percent' 100;Add-DeskColumn $bar 'Absolute' 78
    Add-DeskItem $bar (New-DeskControl Label Choose '当前任务') 0 0
    $script:picker=New-DeskControl ComboBox TaskPicker ''; $picker.AccessibleName='选择正在进行的 Codex 任务';$picker.DropDownStyle='DropDownList'
    $refresh=New-DeskControl Button Refresh '刷新'
    Add-DeskItem $bar $picker 1 0;Add-DeskItem $bar $refresh 2 0;Add-DeskItem $root $bar 0 2
    $script:scope=New-DeskControl Label Scope '先选择一个任务，不会默认选中任何聊天。';Add-DeskItem $root $scope 0 3
    $script:log=New-DeskControl RichTextBox Conversation ''; $log.AccessibleName='本窗口的临时讨论';$log.ReadOnly=$true
    $log.DetectUrls=$false;$log.HideSelection=$false;$log.BackColor=[Drawing.SystemColors]::Window;Add-DeskItem $root $log 0 4
    $composer=New-DeskGrid 3 1;Add-DeskColumn $composer 'Percent' 100;Add-DeskColumn $composer 'Absolute' 76;Add-DeskColumn $composer 'Absolute' 116
    $script:entry=New-DeskControl TextBox Message ''; $entry.AccessibleName='给审查模型的消息';$entry.Multiline=$true;$entry.ScrollBars='Vertical';$entry.MaxLength=2000
    $script:submit=New-DeskControl Button Send '发送';$script:suggest=New-DeskControl Button Suggest '整理为草案'
    Add-DeskItem $composer $entry 0 0;Add-DeskItem $composer $submit 1 0;Add-DeskItem $composer $suggest 2 0;Add-DeskItem $root $composer 0 5
    $ruleBar=New-DeskGrid 2 1;Add-DeskColumn $ruleBar 'Percent' 100;Add-DeskColumn $ruleBar 'Absolute' 170
    $script:draftTitle=New-DeskControl Label DraftTitle '规则草案 · 尚未应用'
    $script:simulate=New-DeskControl Button Simulate '模拟下一次审查';$simulate.Visible=$false
    Add-DeskItem $ruleBar $draftTitle 0 0;Add-DeskItem $ruleBar $simulate 1 0;Add-DeskItem $root $ruleBar 0 6
    $script:draft=New-DeskControl TextBox Rule ''; $draft.AccessibleName='仅对本任务生效的可编辑规则草案';$draft.Multiline=$true;$draft.ScrollBars='Vertical';$draft.MaxLength=2000
    Add-DeskItem $root $draft 0 7
    $foot=New-DeskGrid 2 1; Add-DeskColumn $foot 'Percent' 100;Add-DeskColumn $foot 'Absolute' 168
    $script:status=New-DeskControl Label Status '正在读取本地任务…';$script:apply=New-DeskControl Button Apply '应用到本任务'
    $apply.BackColor=[Drawing.Color]::FromArgb(25,83,99);$apply.ForeColor=[Drawing.Color]::White;$apply.FlatStyle='Flat'
    Add-DeskItem $foot $status 0 0;Add-DeskItem $foot $apply 1 0;Add-DeskItem $root $foot 0 8
    $script:filling=$false;$script:viewId=0;$script:chosen=$null;$script:selectedReady=$false
    $script:taskItems=@();$script:rev=0;$script:appliedText='';$script:haveHistory=$false
    $script:waiting=$false;$script:applying=$false;$script:simulating=$false
    $refresh.Add_Click({Emit-DeskFrame @{type='list'}})
    $picker.Add_SelectedIndexChanged({
        if ($script:filling -or $picker.SelectedIndex -lt 0) { return }
        $new=$script:taskItems[$picker.SelectedIndex]
        if (Is-DeskTask $new $script:chosen) { return }
        if ($script:chosen -and ($entry.Text.Trim() -or ($draft.Text.Trim() -and $draft.Text.Trim() -cne $script:appliedText))) {
            $yes=[Windows.Forms.MessageBox]::Show($form,'切换会清空本窗口当前的讨论和未应用草案。继续吗？','切换任务','YesNo','Question')
            if ($yes -ne 'Yes') {
                $script:filling=$true
                try { for ($i=0;$i -lt $script:taskItems.Count;$i++) { if (Is-DeskTask $script:taskItems[$i] $script:chosen) { $picker.SelectedIndex=$i;break } } }
                finally { $script:filling=$false }
                return
            }
        }
        Set-DeskSelection $new
    })
    $entry.Add_TextChanged({Update-DeskButtons}); $draft.Add_TextChanged({Update-DeskButtons})
    $submit.Add_Click({Send-ReviewMessage 'chat'}); $suggest.Add_Click({Send-ReviewMessage 'draft'});$apply.Add_Click({Apply-ReviewRule})
    $entry.Add_KeyDown({param($sender,$ev) if ($ev.Control -and $ev.KeyCode -eq 'Enter') { $ev.SuppressKeyPress=$true;Send-ReviewMessage 'chat' }})
    $simulate.Add_Click({
        if (!$script:isDemo -or !$script:selectedReady) { return }
        $script:simulating=$true;Update-DeskButtons
        Emit-DeskFrame @{type='demoStop';view=$script:viewId;target=(Get-DeskKey $script:chosen)}
    })
    Update-DeskButtons
}
function Start-ReviewChatWindow {
    $utf8=[Text.UTF8Encoding]::new($false)
    $script:reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),$utf8)
    $script:writer=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),$utf8);$writer.AutoFlush=$true
    Initialize-ReviewChatWindow {param($frame) $writer.WriteLine((ConvertTo-Json -Depth 5 -Compress -InputObject $frame))}
    $timer=[Windows.Forms.Timer]::new();$timer.Interval=60
    $timer.Add_Tick({
        try {
            while ($script:line.IsCompleted) {
                $value=$script:line.GetAwaiter().GetResult()
                if ($null -eq $value) { $form.Close();return }
                Show-ReviewFrame (ConvertFrom-Json -InputObject $value)
                $script:line=$reader.ReadLineAsync()
            }
        } catch { $form.Close() }
    })
    $form.Add_Shown({
        Emit-DeskFrame @{type='list'}
        $script:line=$reader.ReadLineAsync();$timer.Start();$form.Activate()
    })
    try { [Windows.Forms.Application]::Run($form) }
    finally { $timer.Stop();$timer.Dispose();$form.Dispose();$reader.Dispose();$writer.Dispose() }
}
