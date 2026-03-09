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

$rawBody = $Request.Body
$body = $null

if ($rawBody -is [string]) {
    if ([string]::IsNullOrWhiteSpace($rawBody)) {
        Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
            apiVersion = "1.0"
            status = "error"
            error = "Request body is required"
        })
        return
    }

    try {
        $body = $rawBody | ConvertFrom-Json -Depth 20
    }
    catch {
        Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
            apiVersion = "1.0"
            status = "error"
            error = "Request body must be valid JSON"
        })
        return
    }
}
else {
    $body = $rawBody
}

if (-not $body -or -not $body.name) {
    Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 400 -Body [ordered]@{
        apiVersion = "1.0"
        status = "error"
        error = "Field 'name' is required"
    })
    return
}

$policyName = [string]$body.name
$conditions = $body.conditions

Write-Output ("Simulating DLP policy creation for policy name: {0}" -f $policyName)
Write-Output ("Conditions payload: {0}" -f (($conditions | ConvertTo-Json -Depth 10 -Compress)))

$responseBody = [ordered]@{
    apiVersion = "1.0"
    status = "created"
    policyName = $policyName
    details = "Policy created successfully"
    conditions = $conditions
}

Push-OutputBinding -Name Response -Value (New-JsonResponse -StatusCode 200 -Body $responseBody)
