# This file enables modules to be automatically managed by the Functions service.
# See https://aka.ms/functionsmanageddependency for additional information.
#
@{
    # ExchangeOnlineManagement is required by textExctraction.ps1 (Connect-IPPSSession).
    'ExchangeOnlineManagement' = '3.*'

    # For latest supported version, go to 'https://www.powershellgallery.com/packages/Az'.
    # To use the Az module in your function app, please uncomment the line below.
    # 'Az' = '15.*'
}
