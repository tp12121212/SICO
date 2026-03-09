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

function Ensure-ComplianceSessionSupport {
    if (Get-Command -Name Connect-IPPSSession -ErrorAction SilentlyContinue) {
        return
    }

    $maxAttempts = 15
    $sleepSeconds = 2
    $lastError = $null

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if (Get-Command -Name Connect-IPPSSession -ErrorAction SilentlyContinue) {
            return
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

        if (Get-Command -Name Connect-IPPSSession -ErrorAction SilentlyContinue) {
            return
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
    throw ("ExchangeOnlineManagement module is not available in the Functions worker after retries. Last error: {0}" -f $lastErrorMessage)
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
        Ensure-ComplianceSessionSupport

        $bytes = [Convert]::FromBase64String($FileContent)
        [System.IO.File]::WriteAllBytes($tempFile, $bytes)

        $scriptOutput = & $scriptPath -UserPrincipalName $UserPrincipalName -MacFile $tempFile

        if ($null -eq $scriptOutput) {
            throw "Purview extraction script returned no output"
        }

        $resultObj = $null
        $resultItems = @()
        if ($scriptOutput -is [string]) {
            $trimmed = $scriptOutput.Trim()
            if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
                $resultObj = $trimmed | ConvertFrom-Json -Depth 20
            } else {
                throw "Purview extraction script output is not JSON"
            }
        } elseif ($scriptOutput -is [System.Array]) {
            $stringItems = @($scriptOutput | Where-Object { $_ -is [string] })
            if ($stringItems.Count -eq $scriptOutput.Count -and $stringItems.Count -gt 0) {
                $trimmed = (($stringItems -join "`n")).Trim()
                if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
                    $resultObj = $trimmed | ConvertFrom-Json -Depth 20
                } else {
                    throw "Purview extraction script string-array output is not JSON"
                }
            } else {
                $resultItems = @($scriptOutput)
            }
        } else {
            $resultObj = $scriptOutput
        }

        if ($resultItems.Count -eq 0 -and $null -ne $resultObj) {
            if ($resultObj -is [System.Array]) {
                $resultItems = @($resultObj)
            } else {
                $resultItems = @($resultObj)
            }
        }

        if ($resultItems.Count -eq 0) {
            throw "Purview extraction script produced no usable stream items"
        }

        $normalizedItems = @()
        foreach ($item in $resultItems) {
            $itemText = ""
            $itemId = 0
            $itemName = "Message Body"
            $itemLength = 0

            if ($item.PSObject.Properties.Name -contains "ExtractedStreamText") {
                $itemText = Normalize-OutputText -Value ([string]$item.ExtractedStreamText)
            }
            if ($null -eq $itemText) {
                $itemText = ""
            }
            if ($item.PSObject.Properties.Name -contains "StreamId") {
                try { $itemId = [int]$item.StreamId } catch { $itemId = 0 }
            }
            if ($item.PSObject.Properties.Name -contains "StreamName" -and -not [string]::IsNullOrWhiteSpace([string]$item.StreamName)) {
                $itemName = [string]$item.StreamName
            }
            if ($item.PSObject.Properties.Name -contains "StreamTextLength") {
                try { $itemLength = [int]$item.StreamTextLength } catch { $itemLength = $itemText.Length }
            } else {
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
