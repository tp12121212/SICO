using namespace System.Net

param(
    $Request,
    $TriggerMetadata
)

function New-JsonResponse {
    param(
        [int]$StatusCode,
        [hashtable]$Body
    )

    return [HttpResponseContext]@{
        StatusCode = $StatusCode
        Headers = @{
            "Content-Type" = "application/json; charset=utf-8"
        }
        Body = $Body
    }
}

function Get-RequestBody {
    param($RawBody)

    if ($RawBody -is [string]) {
        if ([string]::IsNullOrWhiteSpace($RawBody)) {
            return $null
        }
        return $RawBody | ConvertFrom-Json -Depth 30
    }

    return $RawBody
}

function Get-FieldValue {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$Path
    )

    $current = $InputObject
    foreach ($segment in $Path) {
        if ($null -eq $current) {
            return $null
        }

        if ($current -is [System.Collections.IDictionary]) {
            if ($current.Contains($segment)) {
                $current = $current[$segment]
                continue
            }
            return $null
        }

        $prop = $current.PSObject.Properties[$segment]
        if ($null -eq $prop) {
            return $null
        }
        $current = $prop.Value
    }

    return $current
}

function Normalize-OutputText {
    param([string]$Value)

    if ($null -eq $Value) {
        return ""
    }

    $normalized = [string]$Value
    $normalized = [regex]::Replace($normalized, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '')
    return $normalized
}

function Convert-ToBoolean {
    param(
        $Value,
        [bool]$Default = $false
    )

    if ($null -eq $Value) {
        return $Default
    }

    if ($Value -is [bool]) {
        return $Value
    }

    $text = ([string]$Value).Trim().ToLowerInvariant()
    if ($text -in @("1", "true", "yes", "y", "on")) {
        return $true
    }
    if ($text -in @("0", "false", "no", "n", "off")) {
        return $false
    }

    return $Default
}

function Has-ExchangeOnlineSupport {
    return (Get-Command -Name Connect-ExchangeOnline -ErrorAction SilentlyContinue) -or
        (Get-Command -Name Connect-IPPSSession -ErrorAction SilentlyContinue)
}

function Add-CommonModulePaths {
    $separator = [System.IO.Path]::PathSeparator
    $candidates = @(
        (Join-Path $HOME ".local/share/powershell/Modules"),
        (Join-Path $HOME "Documents/PowerShell/Modules"),
        "/usr/local/share/powershell/Modules",
        "/opt/homebrew/share/powershell/Modules"
    )

    $currentPaths = @()
    if (-not [string]::IsNullOrWhiteSpace($env:PSModulePath)) {
        $currentPaths = @($env:PSModulePath -split [regex]::Escape($separator))
    }

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }
        if ($currentPaths -contains $candidate) {
            continue
        }
        $currentPaths = @($candidate) + $currentPaths
    }

    $env:PSModulePath = ($currentPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join $separator
}

function Ensure-ComplianceSessionSupport {
    Add-CommonModulePaths
    if (Has-ExchangeOnlineSupport) {
        return $true
    }

    $maxAttempts = 30
    $sleepSeconds = 2
    $lastError = $null
    $installAttempted = $false

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if (Has-ExchangeOnlineSupport) {
            return $true
        }

        try {
            $moduleInfo = Get-Module -ListAvailable -Name ExchangeOnlineManagement |
                Sort-Object -Property Version -Descending |
                Select-Object -First 1

            if ($null -ne $moduleInfo -and -not [string]::IsNullOrWhiteSpace([string]$moduleInfo.Path)) {
                Import-Module $moduleInfo.Path -Force -ErrorAction Stop | Out-Null
            }
            else {
                Import-Module ExchangeOnlineManagement -Force -ErrorAction Stop | Out-Null
            }
        }
        catch {
            $lastError = $_
        }

        if (-not $installAttempted -and $attempt -ge 4 -and -not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
            $installAttempted = $true
            try {
                Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue | Out-Null
                Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop | Out-Null
                Add-CommonModulePaths
                Import-Module ExchangeOnlineManagement -Force -ErrorAction Stop | Out-Null
            }
            catch {
                $lastError = $_
            }
        }

        if (Has-ExchangeOnlineSupport) {
            return $true
        }

        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds $sleepSeconds
        }
    }

    $lastErrorMessage = if ($lastError -and $lastError.Exception -and $lastError.Exception.Message) {
        $lastError.Exception.Message
    }
    else {
        "unknown import error"
    }
    Write-Warning ("ExchangeOnlineManagement module is not available in the Functions worker after retries. Last error: {0}" -f $lastErrorMessage)
    return $false
}

function Convert-ToDeterministicJsonValue {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if (
        $Value -is [string] -or
        $Value -is [bool] -or
        $Value -is [byte] -or
        $Value -is [int16] -or
        $Value -is [int32] -or
        $Value -is [int64] -or
        $Value -is [uint16] -or
        $Value -is [uint32] -or
        $Value -is [uint64] -or
        $Value -is [single] -or
        $Value -is [double] -or
        $Value -is [decimal]
    ) {
        return $Value
    }

    if ($Value -is [DateTime]) {
        return $Value.ToString("o")
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $ordered = [ordered]@{}
        foreach ($key in ($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
            $ordered[$key] = Convert-ToDeterministicJsonValue -Value $Value[$key]
        }
        return $ordered
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(Convert-ToDeterministicJsonValue -Value $item)
        }
        return $items
    }

    if ($Value.PSObject -and $Value.PSObject.Properties.Count -gt 0) {
        $ordered = [ordered]@{}
        foreach ($name in ($Value.PSObject.Properties.Name | Sort-Object -Unique)) {
            $ordered[$name] = Convert-ToDeterministicJsonValue -Value $Value.$name
        }
        return $ordered
    }

    return [string]$Value
}

function Parse-ClassificationOutput {
    param($Output)

    if ($null -eq $Output) {
        throw "Data classification script returned no output"
    }

    $parsed = $null
    $rawText = ""

    if ($Output -is [string]) {
        $rawText = Normalize-OutputText -Value $Output
        $trimmed = $rawText.Trim()
        if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
            $parsed = $trimmed | ConvertFrom-Json -Depth 30
        }
    }
    elseif ($Output -is [System.Array]) {
        $stringItems = @($Output | Where-Object { $_ -is [string] })
        if ($stringItems.Count -eq $Output.Count -and $stringItems.Count -gt 0) {
            $joined = Normalize-OutputText -Value (($stringItems -join "`n").Trim())
            $rawText = $joined
            if ($joined.StartsWith("{") -or $joined.StartsWith("[")) {
                $parsed = $joined | ConvertFrom-Json -Depth 30
            }
        }
        else {
            $parsed = $Output
        }
    }
    else {
        $parsed = $Output
    }

    return [ordered]@{
        parsed = $parsed
        rawText = $rawText
    }
}

function Get-MatchItems {
    param($Parsed)

    if ($null -eq $Parsed) {
        return @()
    }

    if ($Parsed -is [System.Array]) {
        return @($Parsed)
    }

    $candidateFields = @(
        "matches",
        "Matches",
        "detections",
        "Detections",
        "results",
        "Results",
        "items",
        "Items",
        "DataClassification"
    )
    foreach ($field in $candidateFields) {
        $prop = $Parsed.PSObject.Properties[$field]
        if ($null -eq $prop) {
            continue
        }

        $value = $prop.Value
        if ($null -eq $value) {
            continue
        }

        if ($value -is [System.Array]) {
            return @($value)
        }

        if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
            return @($value)
        }
    }

    return @()
}

function Resolve-DataClassificationScriptPath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:PURVIEW_DATA_CLASSIFICATION_SCRIPT)) {
        $candidates += [string]$env:PURVIEW_DATA_CLASSIFICATION_SCRIPT
    }

    $candidates += @(
        (Join-Path $PSScriptRoot "../../../purview_scripts/testDataclassification.ps1"),
        (Join-Path $PSScriptRoot "../../../purview_scripts/testDataclassication.ps1"),
        (Join-Path $PSScriptRoot "../../../purview_scripts/test-dataclassification.ps1"),
        (Join-Path $PSScriptRoot "../../../purview_scripts/test-dataclassication.ps1"),
        (Join-Path $PSScriptRoot "../../purview_scripts/testDataclassification.ps1"),
        (Join-Path $PSScriptRoot "../../purview_scripts/testDataclassication.ps1"),
        (Join-Path $PSScriptRoot "../../purview_scripts/test-dataclassification.ps1"),
        (Join-Path $PSScriptRoot "../../purview_scripts/test-dataclassication.ps1"),
        (Join-Path (Get-Location) "purview_scripts/testDataclassification.ps1"),
        (Join-Path (Get-Location) "purview_scripts/testDataclassication.ps1"),
        (Join-Path (Get-Location) "purview_scripts/test-dataclassification.ps1"),
        (Join-Path (Get-Location) "purview_scripts/test-dataclassication.ps1")
    )

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $resolved = $null
        try {
            $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction Stop
        }
        catch {
            $resolved = $null
        }

        if ($resolved) {
            return [string]$resolved
        }
    }

    return $null
}

function Resolve-DataClassificationInvoker {
    $scriptPath = Resolve-DataClassificationScriptPath
    if (-not [string]::IsNullOrWhiteSpace($scriptPath)) {
        return [ordered]@{
            mode = "script"
            command = $scriptPath
        }
    }

    $commandNames = @(
        "testDataclassification",
        "testDataclassication",
        "test-dataclassification",
        "test-dataclassication"
    )
    foreach ($name in $commandNames) {
        if (Get-Command -Name $name -ErrorAction SilentlyContinue) {
            return [ordered]@{
                mode = "command"
                command = $name
            }
        }
    }

    return $null
}

function Invoke-DataClassification {
    param(
        [string]$FileContent,
        [string]$FileName,
        [string]$InputText,
        [string]$UserPrincipalName,
        [bool]$RunAllSits = $true
    )

    if ([string]::IsNullOrWhiteSpace($UserPrincipalName)) {
        throw "userPrincipalName is required for data classification"
    }

    $hasFile = -not [string]::IsNullOrWhiteSpace($FileContent)
    $hasText = -not [string]::IsNullOrWhiteSpace($InputText)
    if (-not $hasFile -and -not $hasText) {
        throw "Either fileContent or inputText is required"
    }

    $invoker = Resolve-DataClassificationInvoker
    if ($null -eq $invoker) {
        throw "Unable to resolve data classification script or command (expected names: testDataclassification/test-dataclassification)"
    }

    $effectiveFileName = if ([string]::IsNullOrWhiteSpace($FileName)) { "input.txt" } else { $FileName }
    $extension = ""
    try {
        $extension = [System.IO.Path]::GetExtension($effectiveFileName)
    }
    catch {
        $extension = ""
    }
    if ([string]::IsNullOrWhiteSpace($extension)) {
        $extension = ".txt"
    }

    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("sico-dataclassification-{0}{1}" -f [Guid]::NewGuid().ToString("N"), $extension)

    try {
        if ($hasFile) {
            $bytes = [Convert]::FromBase64String($FileContent)
            [System.IO.File]::WriteAllBytes($tempFile, $bytes)
        }
        else {
            $utf8 = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($tempFile, $InputText, $utf8)
        }

        $output = $null
        $invokeParams = @{
            UserPrincipalName = $UserPrincipalName
            MacFile = $tempFile
        }

        $commandInfo = Get-Command -Name $invoker.command -ErrorAction SilentlyContinue
        if ($commandInfo) {
            if ($commandInfo.Parameters.ContainsKey("DataClassification")) {
                $invokeParams.DataClassification = $true
            }

            if ($RunAllSits) {
                if ($commandInfo.Parameters.ContainsKey("RunAllSits")) {
                    $invokeParams.RunAllSits = $true
                }
                elseif ($commandInfo.Parameters.ContainsKey("AllSits")) {
                    $invokeParams.AllSits = $true
                }
                elseif ($commandInfo.Parameters.ContainsKey("AllSensitiveInformationTypes")) {
                    $invokeParams.AllSensitiveInformationTypes = $true
                }
            }
        }

        $output = & $invoker.command @invokeParams

        $parsedOutput = Parse-ClassificationOutput -Output $output
        $parsed = $parsedOutput.parsed
        $rawText = [string]$parsedOutput.rawText

        $matchItems = Get-MatchItems -Parsed $parsed
        $normalizedMatches = @()
        foreach ($item in $matchItems) {
            $normalizedMatches += ,(Convert-ToDeterministicJsonValue -Value $item)
        }

        $normalizedResult = Convert-ToDeterministicJsonValue -Value $parsed
        if ($null -eq $normalizedResult -and -not [string]::IsNullOrWhiteSpace($rawText)) {
            $normalizedResult = $rawText
        }

        $inputMode = if ($hasFile) { "file" } else { "text" }
        return [ordered]@{
            status = "classified"
            classificationMethod = "purview-script"
            inputMode = $inputMode
            fileName = $effectiveFileName
            totalMatches = $normalizedMatches.Count
            hasMatches = ($normalizedMatches.Count -gt 0)
            matches = $normalizedMatches
            result = $normalizedResult
            invoker = $invoker.mode
        }
    }
    finally {
        if (Test-Path -LiteralPath $tempFile) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    $body = Get-RequestBody -RawBody $Request.Body
}
catch {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Request body must be valid JSON"
    })
    return
}

if (-not $body) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Request body is required"
    })
    return
}

$fileContent = [string](Get-FieldValue -InputObject $body -Path @("params", "fileContent"))
if ([string]::IsNullOrWhiteSpace($fileContent)) {
    $fileContent = [string](Get-FieldValue -InputObject $body -Path @("fileContent"))
}

$fileName = [string](Get-FieldValue -InputObject $body -Path @("params", "fileName"))
if ([string]::IsNullOrWhiteSpace($fileName)) {
    $fileName = [string](Get-FieldValue -InputObject $body -Path @("fileName"))
}

$inputText = [string](Get-FieldValue -InputObject $body -Path @("params", "inputText"))
if ([string]::IsNullOrWhiteSpace($inputText)) {
    $inputText = [string](Get-FieldValue -InputObject $body -Path @("inputText"))
}
if ([string]::IsNullOrWhiteSpace($inputText)) {
    $inputText = [string](Get-FieldValue -InputObject $body -Path @("text"))
}

$runAllSits = Get-FieldValue -InputObject $body -Path @("params", "runAllSits")
if ($null -eq $runAllSits) {
    $runAllSits = Get-FieldValue -InputObject $body -Path @("runAllSits")
}
$runAllSits = Convert-ToBoolean -Value $runAllSits -Default $true

$userPrincipalName = [string](Get-FieldValue -InputObject $body -Path @("params", "userPrincipalName"))
if ([string]::IsNullOrWhiteSpace($userPrincipalName)) {
    $userPrincipalName = [string](Get-FieldValue -InputObject $body -Path @("userPrincipalName"))
}
if ([string]::IsNullOrWhiteSpace($userPrincipalName) -and $env:PURVIEW_USER_PRINCIPAL_NAME) {
    $userPrincipalName = [string]$env:PURVIEW_USER_PRINCIPAL_NAME
}

try {
    $result = Invoke-DataClassification -FileContent $fileContent -FileName $fileName -InputText $inputText -UserPrincipalName $userPrincipalName -RunAllSits $runAllSits

    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body ([ordered]@{
        apiVersion = "1.0"
        status = "classified"
        classificationMethod = $result.classificationMethod
        inputMode = $result.inputMode
        fileName = $result.fileName
        totalMatches = $result.totalMatches
        hasMatches = $result.hasMatches
        matches = $result.matches
        result = $result.result
        invoker = $result.invoker
    }))
}
catch {
    $errorMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { "Data classification worker failure" }
    Write-Error ("DataClassification failure: {0}" -f $errorMessage)
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 500 -Body ([ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = $errorMessage
    }))
}
