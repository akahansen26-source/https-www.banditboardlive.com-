$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'BanditBoard Live: aabner netvaerket for telefoner, tablets og TV...'
# Fjern blokeringer af Node.js, som Windows laver hvis man har trykket "Annuller" i firewall-boksen
Get-NetFirewallRule -DisplayName 'Node.js*' | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule
Remove-NetFirewallRule -DisplayName 'BanditBoard Live'
New-NetFirewallRule -DisplayName 'BanditBoard Live' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Any | Out-Null
$node = (Get-Command node).Source
if ($node) { New-NetFirewallRule -DisplayName 'BanditBoard Live' -Direction Inbound -Action Allow -Program $node -Profile Any | Out-Null }
Write-Host 'Faerdig - andre enheder paa netvaerket kan nu forbinde.'
Start-Sleep -Seconds 2
