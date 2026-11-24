# Exercise the same form and callbacks without showing a window on the user's desktop.
$ErrorActionPreference = 'Stop'
$script:sentFrames = [Collections.ArrayList]::new()
function Assert-Ui($value,$message) { if (!$value) { throw $message } }
Initialize-ReviewChatWindow { param($frame) [void]$script:sentFrames.Add($frame) }
try {
    Assert-Ui ($form.Text -match '审查对话') 'Chinese title lost'
    $target = [pscustomobject]@{session=('a'*64);run='b237b868-4f5d-4505-835c-34bd82a35ca1';goal='任务甲';phase='running';round=1;updatedAt='2026-11-24T01:00:00Z'}
    Show-ReviewFrame ([pscustomobject]@{type='tasks';tasks=@($target);model='本机模型';demo=$false})
    Assert-Ui ($picker.SelectedIndex -eq -1) 'first task must not be preselected'
    $picker.SelectedIndex = 0
    Assert-Ui ($sentFrames.Count -eq 1 -and $sentFrames[0].type -eq 'select') 'select emitted wrong side effects'
    $v = $sentFrames[0].view
    Show-ReviewFrame ([pscustomobject]@{type='selected';view=$v;phase='running';round=1;applied=[pscustomobject]@{revision=0;text=''}})
    $entry.Text = '换行与标点 🐈'
    Send-ReviewMessage 'chat'
    Assert-Ui ($sentFrames.Count -eq 2 -and $sentFrames[1].type -eq 'message' -and $sentFrames[1].text -eq '换行与标点 🐈') 'Chinese content lost'
    Show-ReviewFrame ([pscustomobject]@{type='reply';view=$v;reply='讨论并不应用。';draft='初稿'})
    Assert-Ui ($draft.Text -eq '初稿' -and $sentFrames.Count -eq 2) 'draft was mistakenly applied'
    $draft.Text = "人工编辑：检查换行。"
    Apply-ReviewRule
    Assert-Ui ($sentFrames.Count -eq 3 -and $sentFrames[2].type -eq 'apply' -and $sentFrames[2].text -eq $draft.Text) 'approval did not include edited text'
    Assert-Ui ($sentFrames[2].target.run -eq $target.run) 'approval lost exact run id'
    Show-ReviewFrame ([pscustomobject]@{type='applied';view=$v;phase='reviewing';text=$draft.Text;revision=1})
    Assert-Ui ($status.Text -match '下次|下一次' -and !$apply.Enabled) 'missing in-flight notice or duplicate apply enabled'
    $draft.Text = '手动改了，还没有生效。'
    Assert-Ui (($draftTitle.Text -match '未应用') -and $apply.Enabled -and $sentFrames.Count -eq 3) 'new edit must not be labeled as the active rule'
    Show-ReviewFrame ([pscustomobject]@{type='tasks';tasks=@();model='本机模型';demo=$false})
    Assert-Ui (!$apply.Enabled -and !$submit.Enabled) 'stale selection still actionable'
    [Console]::WriteLine('FORM-OK')
} finally { $form.Dispose() }
