# Azure Functions profile.ps1
#
# This profile.ps1 will get executed every "cold start" of your Function App.
# "cold start" occurs when:
#
# * A Function App starts up for the very first time
# * A Function App starts up after being de-allocated due to inactivity
#
# You can define helper functions, run commands, or specify environment variables
# NOTE: any variables defined that are not environment variables will get reset after the first execution

# Authenticate with Azure PowerShell using MSI.
# Remove this if you are not planning on using MSI or Azure PowerShell.
if ($env:MSI_SECRET) {
    Disable-AzContextAutosave -Scope Process | Out-Null
    Connect-AzAccount -Identity
}

# Uncomment the next line to enable legacy AzureRm alias in Azure PowerShell.
# Enable-AzureRmAlias

# You can also define functions or aliases that can be referenced in any of your PowerShell functions.

# Ensure local user PowerShell modules are visible to the Functions worker (macOS/Linux dev machines).
$userModulePath = Join-Path $HOME ".local/share/powershell/Modules"
if (Test-Path -LiteralPath $userModulePath) {
    $separator = [System.IO.Path]::PathSeparator
    if (-not $env:PSModulePath.Split($separator) -contains $userModulePath) {
        $env:PSModulePath = "$userModulePath$separator$env:PSModulePath"
    }
}

# Preload ExchangeOnlineManagement when available so Connect-IPPSSession resolves in function scripts.
try {
    if (Get-Module -ListAvailable -Name ExchangeOnlineManagement) {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop | Out-Null
        Write-Host "Loaded ExchangeOnlineManagement from PSModulePath"
    }
}
catch {
    Write-Warning "ExchangeOnlineManagement preload failed in profile.ps1"
}
