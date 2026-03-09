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
        return $RawBody | ConvertFrom-Json -Depth 20
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

function Extract-PrintableText {
    param([byte[]]$Bytes)

    $asciiText = [System.Text.Encoding]::ASCII.GetString($Bytes)
    $matches = [regex]::Matches($asciiText, '[\x20-\x7E]{5,}')
    if (-not $matches -or $matches.Count -eq 0) {
        return ""
    }

    $fragments = @()
    foreach ($match in $matches) {
        $value = $match.Value.Trim()
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        # Skip common PDF structural tokens
        if ($value -match '^(obj|endobj|stream|endstream|xref|trailer|startxref|/Type|/Length|/Filter)$') {
            continue
        }
        $fragments += $value
    }

    if ($fragments.Count -eq 0) {
        return ""
    }

    $distinct = $fragments | Select-Object -Unique
    return ($distinct | Select-Object -First 200) -join "`n"
}

function Try-DecodeText {
    param([string]$Input)

    if ([string]::IsNullOrWhiteSpace($Input)) {
        return [ordered]@{
            text = ""
            encoding = "missing"
        }
    }

    try {
        $bytes = [Convert]::FromBase64String($Input)

        # If this looks like PDF content, extract printable fragments instead of raw UTF-8 bytes.
        if ($bytes.Length -ge 4 -and $bytes[0] -eq 0x25 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x44 -and $bytes[3] -eq 0x46) {
            $pdfText = Extract-PrintableText -Bytes $bytes
            return [ordered]@{
                text = $pdfText
                encoding = "base64-pdf-printable"
            }
        }

        $decoded = [System.Text.Encoding]::UTF8.GetString($bytes)
        return [ordered]@{
            text = $decoded
            encoding = "base64-utf8"
        }
    }
    catch {
        return [ordered]@{
            text = $Input
            encoding = "plain-text"
        }
    }
}

function Get-ScriptOutputText {
    param($Output)

    if ($null -eq $Output) {
        return ""
    }

    if ($Output -is [string]) {
        return (Normalize-OutputText -Value $Output).Trim()
    }

    if ($Output -is [System.Array]) {
        $parts = @()
        foreach ($item in $Output) {
            if ($null -eq $item) {
                continue
            }

            if ($item -is [string]) {
                $text = (Normalize-OutputText -Value $item).Trim()
                if (-not [string]::IsNullOrWhiteSpace($text)) {
                    $parts += $text
                }
                continue
            }

            if ($item -is [System.Management.Automation.ErrorRecord]) {
                $errorText = ""
                if ($item.Exception -and -not [string]::IsNullOrWhiteSpace([string]$item.Exception.Message)) {
                    $errorText = [string]$item.Exception.Message
                } else {
                    $errorText = [string]$item
                }
                $errorText = (Normalize-OutputText -Value $errorText).Trim()
                if (-not [string]::IsNullOrWhiteSpace($errorText)) {
                    $parts += $errorText
                }
                continue
            }

            $genericText = (Normalize-OutputText -Value ([string]$item)).Trim()
            if (-not [string]::IsNullOrWhiteSpace($genericText)) {
                $parts += $genericText
            }
        }

        return ($parts -join "`n").Trim()
    }

    return (Normalize-OutputText -Value ([string]$Output)).Trim()
}

function Get-BalancedJsonSegment {
    param(
        [string]$Text,
        [int]$StartIndex
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return $null
    }
    if ($StartIndex -lt 0 -or $StartIndex -ge $Text.Length) {
        return $null
    }

    $startChar = $Text[$StartIndex]
    if ($startChar -ne "{" -and $startChar -ne "[") {
        return $null
    }

    $depth = 0
    $inString = $false
    $escape = $false

    for ($index = $StartIndex; $index -lt $Text.Length; $index++) {
        $ch = $Text[$index]

        if ($inString) {
            if ($escape) {
                $escape = $false
                continue
            }
            if ($ch -eq "\") {
                $escape = $true
                continue
            }
            if ($ch -eq '"') {
                $inString = $false
            }
            continue
        }

        if ($ch -eq '"') {
            $inString = $true
            continue
        }

        if ($ch -eq "{" -or $ch -eq "[") {
            $depth++
            continue
        }

        if ($ch -eq "}" -or $ch -eq "]") {
            $depth--
            if ($depth -eq 0) {
                return $Text.Substring($StartIndex, ($index - $StartIndex + 1))
            }
        }
    }

    return $null
}

function Try-ParseJsonFromScriptOutput {
    param($Output)

    $rawText = Get-ScriptOutputText -Output $Output
    if ([string]::IsNullOrWhiteSpace($rawText)) {
        return [ordered]@{
            parsed = $null
            rawText = ""
        }
    }

    $trimmed = $rawText.Trim()
    $candidates = @()
    if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
        $candidates += $trimmed
    }

    for ($index = 0; $index -lt $trimmed.Length; $index++) {
        $ch = $trimmed[$index]
        if ($ch -ne "{" -and $ch -ne "[") {
            continue
        }

        $segment = Get-BalancedJsonSegment -Text $trimmed -StartIndex $index
        if ([string]::IsNullOrWhiteSpace($segment)) {
            continue
        }
        if ($candidates -contains $segment) {
            continue
        }
        $candidates += $segment
    }

    foreach ($candidate in $candidates) {
        try {
            $parsed = $candidate | ConvertFrom-Json -Depth 20
            return [ordered]@{
                parsed = $parsed
                rawText = $rawText
            }
        }
        catch {
            continue
        }
    }

    return [ordered]@{
        parsed = $null
        rawText = $rawText
    }
}

function New-NonJsonPurviewFallbackResult {
    param([string]$RawText)

    $text = Normalize-OutputText -Value $RawText
    $text = [regex]::Replace($text, '(?m)^\|+\s*', '')
    $text = $text.Trim()

    if ([string]::IsNullOrWhiteSpace($text)) {
        $text = "No extractable text found. File may be image-only or scanned without OCR."
    }

    $fallbackStream = [ordered]@{
        StreamId = 8200
        StreamName = "Message Body"
        StreamTextLength = $text.Length
        ExtractedStreamText = $text
    }

    return [ordered]@{
        status = "extracted"
        extractionMethod = "purview-script-raw"
        StreamTextLength = $text.Length
        StreamId = 8200
        StreamName = "Message Body"
        ExtractedStreamText = $text
        text = $text
        Streams = @($fallbackStream)
    }
}

function Resolve-PurviewScriptPath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:PURVIEW_TEXT_EXTRACTION_SCRIPT)) {
        $candidates += [string]$env:PURVIEW_TEXT_EXTRACTION_SCRIPT
    }

    $candidates += @(
        (Join-Path $PSScriptRoot "..\..\..\purview_scripts\textExctraction.ps1"),
        (Join-Path $PSScriptRoot "..\..\purview_scripts\textExctraction.ps1"),
        (Join-Path (Get-Location) "purview_scripts\textExctraction.ps1")
    )

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        $resolved = $null
        try {
            $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction Stop
        } catch {
            $resolved = $null
        }
        if ($resolved) {
            return [string]$resolved
        }
    }

    return $null
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
            # Prefer explicit module path when available to avoid autoload timing issues
            $moduleInfo = Get-Module -ListAvailable -Name ExchangeOnlineManagement |
                Sort-Object -Property Version -Descending |
                Select-Object -First 1

            if ($null -ne $moduleInfo -and -not [string]::IsNullOrWhiteSpace([string]$moduleInfo.Path)) {
                Import-Module $moduleInfo.Path -Force -ErrorAction Stop | Out-Null
            } else {
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
    } else {
        "unknown import error"
    }
    Write-Warning ("ExchangeOnlineManagement module is not available in the Functions worker after retries. Last error: {0}" -f $lastErrorMessage)
    return $false
}

function Invoke-PurviewScriptExtraction {
    param(
        [string]$FileContent,
        [string]$FileName,
        [string]$UserPrincipalName
    )

    $scriptPath = Resolve-PurviewScriptPath
    if ([string]::IsNullOrWhiteSpace($scriptPath) -or -not (Test-Path -LiteralPath $scriptPath)) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($UserPrincipalName)) {
        throw "userPrincipalName is required for Purview extraction"
    }

    $extension = ""
    if (-not [string]::IsNullOrWhiteSpace($FileName)) {
        try {
            $extension = [System.IO.Path]::GetExtension($FileName)
        } catch {
            $extension = ""
        }
    }
    if ([string]::IsNullOrWhiteSpace($extension)) {
        $extension = ".bin"
    }

    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("sico-upload-{0}{1}" -f [Guid]::NewGuid().ToString("N"), $extension)

    try {
        $bytes = [Convert]::FromBase64String($FileContent)
        [System.IO.File]::WriteAllBytes($tempFile, $bytes)

        $scriptOutput = $null
        $preflightReady = Ensure-ComplianceSessionSupport

        try {
            $scriptOutput = & $scriptPath -UserPrincipalName $UserPrincipalName -MacFile $tempFile
        }
        catch {
            $errorMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { "Purview extraction script execution failed" }
            $looksLikeComplianceInit = $errorMessage -match "Connect-IPPSSession|ExchangeOnlineManagement|Connect-ExchangeOnline"
            $looksLikeDocumentParseIssue = $errorMessage -match "Unable to parse input document file|contains text and isn't encrypted by a password"
            if ($preflightReady -eq $false -and $looksLikeComplianceInit) {
                # First invocation can race module/session initialization; retry once in-request.
                Start-Sleep -Seconds 6
                [void](Ensure-ComplianceSessionSupport)
                $scriptOutput = & $scriptPath -UserPrincipalName $UserPrincipalName -MacFile $tempFile
            }
            elseif ($looksLikeDocumentParseIssue) {
                # Treat parser-level document issues as extraction output so API callers get a deterministic result body.
                $scriptOutput = $errorMessage
            }
            else {
                throw
            }
        }

        if ($null -eq $scriptOutput) {
            throw "Purview extraction script returned no output"
        }

        $resultObj = $null
        $resultItems = @()
        $parsedOutput = Try-ParseJsonFromScriptOutput -Output $scriptOutput
        $rawOutputText = [string]$parsedOutput.rawText

        if ($scriptOutput -is [string] -or $scriptOutput -is [System.Array]) {
            $resultObj = $parsedOutput.parsed
        } else {
            $resultObj = $scriptOutput
        }

        if ($scriptOutput -is [System.Array] -and $null -eq $resultObj) {
            $objectItems = @($scriptOutput | Where-Object {
                $null -ne $_ -and $_ -isnot [string] -and $_ -isnot [System.Management.Automation.ErrorRecord]
            })
            if ($objectItems.Count -gt 0) {
                $resultItems = $objectItems
            }
        }

        if ($resultItems.Count -eq 0 -and $null -ne $resultObj) {
            if ($resultObj -is [System.Array]) {
                $resultItems = @($resultObj)
            } else {
                $resultItems = @($resultObj)
            }
        }

        if ($resultItems.Count -eq 0) {
            return (New-NonJsonPurviewFallbackResult -RawText $rawOutputText)
        }

        $normalizedItems = @()
        foreach ($item in $resultItems) {
            $itemText = ""
            $itemId = 0
            $itemName = "Message Body"
            $itemLength = 0

            if ($item -is [string]) {
                $itemText = Normalize-OutputText -Value $item
            }
            elseif ($item -is [System.Management.Automation.ErrorRecord]) {
                $errorText = if ($item.Exception -and -not [string]::IsNullOrWhiteSpace([string]$item.Exception.Message)) {
                    [string]$item.Exception.Message
                } else {
                    [string]$item
                }
                $itemText = Normalize-OutputText -Value $errorText
            }
            elseif ($item -is [System.Collections.IDictionary]) {
                if ($item.Contains("ExtractedStreamText")) {
                    $itemText = Normalize-OutputText -Value ([string]$item["ExtractedStreamText"])
                }
                if ($item.Contains("StreamId")) {
                    try { $itemId = [int]$item["StreamId"] } catch { $itemId = 0 }
                }
                if ($item.Contains("StreamName") -and -not [string]::IsNullOrWhiteSpace([string]$item["StreamName"])) {
                    $itemName = [string]$item["StreamName"]
                }
                if ($item.Contains("StreamTextLength")) {
                    try { $itemLength = [int]$item["StreamTextLength"] } catch { $itemLength = $itemText.Length }
                }
            }
            else {
                if ($item.PSObject.Properties.Name -contains "ExtractedStreamText") {
                    $itemText = Normalize-OutputText -Value ([string]$item.ExtractedStreamText)
                }
                if ($item.PSObject.Properties.Name -contains "StreamId") {
                    try { $itemId = [int]$item.StreamId } catch { $itemId = 0 }
                }
                if ($item.PSObject.Properties.Name -contains "StreamName" -and -not [string]::IsNullOrWhiteSpace([string]$item.StreamName)) {
                    $itemName = [string]$item.StreamName
                }
                if ($item.PSObject.Properties.Name -contains "StreamTextLength") {
                    try { $itemLength = [int]$item.StreamTextLength } catch { $itemLength = $itemText.Length }
                }
            }

            if ($null -eq $itemText) {
                $itemText = ""
            }
            if ($itemLength -le 0 -and -not [string]::IsNullOrWhiteSpace($itemText)) {
                $itemLength = $itemText.Length
            }

            $normalizedItems += [ordered]@{
                StreamId = $itemId
                StreamName = $itemName
                StreamTextLength = $itemLength
                ExtractedStreamText = $itemText
            }
        }

        $sortedItems = $normalizedItems | Sort-Object -Property @{ Expression = { $_.StreamId } }, @{ Expression = { $_.StreamName } }
        $textParts = @()
        foreach ($stream in $sortedItems) {
            if ([string]::IsNullOrWhiteSpace($stream.ExtractedStreamText)) {
                continue
            }
            $textParts += ("[{0}]`n{1}" -f $stream.StreamName, $stream.ExtractedStreamText)
        }
        $combinedText = ($textParts -join "`n`n").Trim()

        if ([string]::IsNullOrWhiteSpace($combinedText)) {
            $combinedText = "No extractable text found in Purview stream output."
        }

        return [ordered]@{
            status = "extracted"
            extractionMethod = "purview-script"
            StreamTextLength = $combinedText.Length
            StreamId = 8200
            StreamName = "Message Body"
            ExtractedStreamText = $combinedText
            text = $combinedText
            Streams = $sortedItems
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

$userPrincipalName = [string](Get-FieldValue -InputObject $body -Path @("params", "userPrincipalName"))
if ([string]::IsNullOrWhiteSpace($userPrincipalName)) {
    $userPrincipalName = [string](Get-FieldValue -InputObject $body -Path @("userPrincipalName"))
}
if ([string]::IsNullOrWhiteSpace($userPrincipalName) -and $env:PURVIEW_USER_PRINCIPAL_NAME) {
    $userPrincipalName = [string]$env:PURVIEW_USER_PRINCIPAL_NAME
}

if ([string]::IsNullOrWhiteSpace($fileContent)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Field 'fileContent' is required (top-level or params.fileContent)"
    })
    return
}

try {
    $purviewResult = Invoke-PurviewScriptExtraction -FileContent $fileContent -FileName $fileName -UserPrincipalName $userPrincipalName
    if ($null -ne $purviewResult) {
        Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body ([ordered]@{
            apiVersion = "1.0"
            status = "extracted"
            StreamTextLength = $purviewResult.StreamTextLength
            StreamId = $purviewResult.StreamId
            StreamName = $purviewResult.StreamName
            ExtractedStreamText = $purviewResult.ExtractedStreamText
            extractionMethod = $purviewResult.extractionMethod
            text = $purviewResult.text
            Streams = $purviewResult.Streams
        }))
        return
    }

    $decodeResult = Try-DecodeText -Input $fileContent
    $textValue = Normalize-OutputText -Value $decodeResult.text
    if ($null -eq $textValue) {
        $textValue = ""
    }

    if ([string]::IsNullOrWhiteSpace($textValue)) {
        $textValue = "No extractable text found. File may be image-only or scanned without OCR."
    }

    Write-Output ("Text extraction completed using {0}" -f $decodeResult.encoding)

    $responseBody = [ordered]@{
        apiVersion = "1.0"
        status = "extracted"
        StreamTextLength = $textValue.Length
        StreamId = 8200
        StreamName = "Message Body"
        ExtractedStreamText = $textValue
        extractionMethod = $decodeResult.encoding
        # Backward compatibility for existing UI callers
        text = $textValue
    }

    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body $responseBody)
}
catch {
    $errorMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { "Text extraction worker failure" }
    Write-Error ("TextExtraction failure: {0}" -f $errorMessage)
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 500 -Body ([ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = $errorMessage
    }))
}
