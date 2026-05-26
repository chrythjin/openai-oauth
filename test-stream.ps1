$body = '{"model":"gpt-5.2","messages":[{"role":"user","content":"hi"}],"stream":true}'
$resp = Invoke-WebRequest -Uri 'http://127.0.0.1:10531/v1/chat/completions' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 10
Write-Host "Status: $($resp.StatusCode)"
Write-Host "Content-Type: $($resp.Headers['Content-Type'])"
Write-Host "Content (first 500 chars):"
$resp.Content | Select-Object -First 5