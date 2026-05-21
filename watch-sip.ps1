# ---------------------------------------------------------------------------
#  watch-sip.ps1  —  Live SIP call monitor (sngrep) for the SoftPhone VPS.
#
#  Opens sngrep on the server so you SEE every call in real time. Dial a call
#  (inbound or outbound) and watch, message by message, whether it succeeds
#  (100/180/200) or fails (4xx/5xx) — i.e. "is this call possible".
#
#  NOTE: the browser <-> Kamailio leg is WSS-encrypted (port 8443) and is NOT
#  shown here. This monitor shows the decodable SIP on port 5060:
#     carrier  <->  Asterisk        (the trunk leg)
#     Asterisk <->  Kamailio        (the leg toward your browser)
#  For the browser leg, use the browser DevTools console (SIP.js logs).
#
#  Usage (PowerShell, from the project folder):
#      .\watch-sip.ps1
#
#  Override defaults if needed:
#      $env:SOFTPHONE_SSH_KEY = "C:\path\to\softphone1.pem"
#      $env:SOFTPHONE_VPS     = "ubuntu@13.127.11.207"
# ---------------------------------------------------------------------------
$Key    = if ($env:SOFTPHONE_SSH_KEY) { $env:SOFTPHONE_SSH_KEY } else { "C:\Users\Public\.ssh\softphone1.pem" }
$Target = if ($env:SOFTPHONE_VPS)     { $env:SOFTPHONE_VPS }     else { "ubuntu@13.127.11.207" }

Write-Host "Opening live SIP monitor (sngrep) on $Target ..." -ForegroundColor Cyan
Write-Host "  Up/Down = pick a call   Enter = see the call flow   Esc = back   q = quit" -ForegroundColor DarkGray
Write-Host ""

# -t : allocate a terminal so sngrep's full-screen UI works over SSH.
ssh -t -i $Key -o StrictHostKeyChecking=no $Target "sudo sngrep -d any 'port 5060'"
