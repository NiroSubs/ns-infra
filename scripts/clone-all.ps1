# Clone all NiroSubs repositories

$org = "nirosubs-v2"
$repos = @(
    "ns-auth",
    "ns-dashboard",
    "ns-payments",
    "ns-user",
    "ns-shell"
)

Write-Host "Cloning NiroSubs repositories from $org..." -ForegroundColor Cyan

foreach ($repo in $repos) {
    if (!(Test-Path $repo)) {
        Write-Host "  Cloning $repo..." -ForegroundColor Yellow
        git clone "https://github.com/$org/$repo.git"
    } else {
        Write-Host "  $repo exists, pulling latest..." -ForegroundColor Yellow
        Push-Location $repo
        git pull
        Pop-Location
    }
}

Write-Host "All repositories cloned!" -ForegroundColor Green
