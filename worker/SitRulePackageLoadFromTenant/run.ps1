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

function Get-PropertyValue {
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

        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) {
            return $null
        }
        $current = $property.Value
    }

    return $current
}

function Get-StringValue {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    return ([string]$Value).Trim()
}

function Normalize-XmlText {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    return ($Text -replace "`r`n?", "`n").Trim()
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

$packageName = Get-StringValue (Get-PropertyValue -InputObject $body -Path @("packageName"))
$delegatedAuth = Get-PropertyValue -InputObject $body -Path @("delegatedAuth")
$accessToken = Get-StringValue (Get-PropertyValue -InputObject $delegatedAuth -Path @("accessToken"))
$userPrincipalName = Get-StringValue (Get-PropertyValue -InputObject $delegatedAuth -Path @("userPrincipalName"))

if ([string]::IsNullOrWhiteSpace($packageName)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "packageName is required"
    })
    return
}

if ([string]::IsNullOrWhiteSpace($accessToken)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Delegated access token is required"
    })
    return
}

try {
    $connectCommand = Get-Command -Name Connect-IPPSSession -ErrorAction Stop
}
catch {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 501 -Body [ordered]@{
        apiVersion = "1.0"
        status = "capability_error"
        error = "Connect-IPPSSession is unavailable in the current worker environment"
        capability = [ordered]@{
            command = "Connect-IPPSSession"
            accessTokenSupported = $false
        }
    })
    return
}

$supportsAccessToken = $connectCommand.Parameters.ContainsKey("AccessToken")
if (-not $supportsAccessToken) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 501 -Body [ordered]@{
        apiVersion = "1.0"
        status = "capability_error"
        error = "Installed ExchangeOnlineManagement does not support Connect-IPPSSession -AccessToken"
        capability = [ordered]@{
            command = "Connect-IPPSSession"
            accessTokenSupported = $false
        }
    })
    return
}

if ([string]::IsNullOrWhiteSpace($userPrincipalName)) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Delegated user principal name is required for Connect-IPPSSession -AccessToken"
    })
    return
}

try {
    Connect-IPPSSession -AccessToken $accessToken -UserPrincipalName $userPrincipalName -ErrorAction Stop | Out-Null
    $package = Get-DlpSensitiveInformationTypeRulePackage -Identity $packageName -ErrorAction Stop
    $xml = Normalize-XmlText -Text ($package | Out-String)

    if ([string]::IsNullOrWhiteSpace($xml)) {
        throw "Tenant returned an empty rule package response."
    }

    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body [ordered]@{
        apiVersion = "1.0"
        status = "loaded"
        packageName = $packageName
        source = "tenant"
        xml = $xml
    })
}
catch {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 500 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = $_.Exception.Message
        packageName = $packageName
    })
}
finally {
    try {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
    catch {
    }
}
