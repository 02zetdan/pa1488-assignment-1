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

# Without working DNS in the node, no image can be pulled and the cluster never becomes ready.
docker exec minikube getent hosts registry.k8s.io | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "The minikube node cannot resolve host names, so it cannot pull images. Apply the fix under 'If images cannot be pulled' in README.md, then run this script again."
    exit 1
}
minikube addons enable metrics-server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# On some hosts minikube does not apply --cpus to the node container.
docker update --cpus=4 minikube | Out-Null

# The addon measures every 60 s, which makes the HorizontalPodAutoscaler react slowly. Use 15 s.
kubectl -n kube-system patch deploy metrics-server --type=json --patch-file "$PSScriptRoot/metrics-server-patch.json" | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
kubectl -n kube-system rollout status deploy/metrics-server --timeout=180s

Write-Host "Waiting for the system pods to become ready..."
# Wait for the controllers, not for individual pods: pods may be replaced while we wait.
kubectl -n kube-system wait --for=condition=Available deploy --all --timeout=300s
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
foreach ($ds in (kubectl -n kube-system get ds -o name)) {
    kubectl -n kube-system rollout status $ds --timeout=300s
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
kubectl get nodes -o wide
