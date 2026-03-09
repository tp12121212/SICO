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

# Ensure common local module locations are visible to the Functions worker.
$separator = [System.IO.Path]::PathSeparator
$modulePaths = @(
    (Join-Path $HOME ".local/share/powershell/Modules"),
    (Join-Path $HOME "Documents/PowerShell/Modules"),
    "/usr/local/share/powershell/Modules",
    "/opt/homebrew/share/powershell/Modules"
)
$currentPaths = @()
if (-not [string]::IsNullOrWhiteSpace($env:PSModulePath)) {
    $currentPaths = @($env:PSModulePath -split [regex]::Escape($separator))
}
foreach ($path in $modulePaths) {
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ($currentPaths -contains $path) { continue }
    $currentPaths = @($path) + $currentPaths
}
$env:PSModulePath = ($currentPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join $separator

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
