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

        try {
            return $RawBody | ConvertFrom-Json -Depth 50
        }
        catch {
            return $null
        }
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

function Get-TextValue {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    return ([string]$Value).Trim()
}

function Get-EntityCount {
    param($RulePackage)

    $entities = Get-FieldValue -InputObject $RulePackage -Path @("entities")
    if ($entities -is [System.Array]) {
        return $entities.Count
    }
    if ($null -ne $entities) {
        return 1
    }
    return 0
}

$body = Get-RequestBody -RawBody $Request.Body
if ($null -eq $body) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Request body is required"
    })
    return
}

$rulePackage = Get-FieldValue -InputObject $body -Path @("rulePackage")
if ($null -eq $rulePackage) {
    $rulePackage = $body
}

$packageId = Get-TextValue (Get-FieldValue -InputObject $rulePackage -Path @("id"))
$packageName = Get-TextValue (Get-FieldValue -InputObject $rulePackage -Path @("details", "name"))
$xml = Get-TextValue (Get-FieldValue -InputObject $body -Path @("xml"))
$entityCount = Get-EntityCount -RulePackage $rulePackage

if ([string]::IsNullOrWhiteSpace($packageId)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Rule package id is required"
    })
    return
}

if ([string]::IsNullOrWhiteSpace($packageName)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Rule package name is required"
    })
    return
}

Write-Output ("Simulating SIT rule package publish for package: {0}" -f $packageName)
Write-Output ("Package id: {0}" -f $packageId)
Write-Output ("Entity count: {0}" -f $entityCount)
Write-Output ("XML length: {0}" -f $xml.Length)

$responseBody = [ordered]@{
    apiVersion = "1.0"
    status = "published"
    mode = "simulated"
    packageId = $packageId
    packageName = $packageName
    entityCount = $entityCount
    xmlLength = $xml.Length
    details = "SIT rule package publish completed via simulated worker flow."
}

Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body $responseBody)
