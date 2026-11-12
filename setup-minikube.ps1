# Starts the local Kubernetes cluster used in the assignment.
# Calico enforces the NetworkPolicy in ticket 5.
$ErrorActionPreference = "Stop"

# Check the tools the assignment needs before starting anything.
$missing = @()
foreach ($tool in "docker", "minikube", "kubectl") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
# The Microsoft Store "python" stub exists but is not Python, so run each candidate and check its version.
$py = $null
foreach ($candidate in @(@("py", "-3"), @("python3"), @("python"))) {
    if (Get-Command $candidate[0] -ErrorAction SilentlyContinue) {
        $exe = $candidate[0]; $rest = @($candidate | Select-Object -Skip 1)
        & $exe @rest -c "import sys; sys.exit(sys.version_info < (3, 8))" 2>$null
        if ($LASTEXITCODE -eq 0) { $py = $candidate; break }
    }
}
if (-not $py) { $missing += "python (3.8 or later)" }
if ($missing.Count -gt 0) {
    Write-Error ("Missing: " + ($missing -join ", ") + ". Install them and run this script again (see README.md).")
    exit 1
}
Write-Host "Found docker, minikube, kubectl and Python: $($py -join ' ')"

minikube start --cpus=4 --memory=6g --cni=calico
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
minikube addons enable metrics-server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# On some hosts minikube does not apply --cpus to the node container.
docker update --cpus=4 minikube | Out-Null

# The addon measures every 60 s, which makes the HorizontalPodAutoscaler react slowly. Use 15 s.
kubectl -n kube-system patch deploy metrics-server --type=json --patch-file "$PSScriptRoot/metrics-server-patch.json" | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
kubectl -n kube-system rollout status deploy/metrics-server --timeout=180s

Write-Host "Waiting for the system pods to become ready..."
kubectl wait --for=condition=Ready pods --all -n kube-system --timeout=300s
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
kubectl get nodes -o wide
