#!/usr/bin/env bash
# Starts the local Kubernetes cluster used in the assignment.
# Calico enforces the NetworkPolicy in ticket 5.
set -euo pipefail

# Check the tools the assignment needs before starting anything.
missing=""
for tool in docker minikube kubectl; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
PY=""
for p in python3 python; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then PY=$p; break; fi
done
[ -n "$PY" ] || missing="$missing python3(3.8+)"
if [ -n "$missing" ]; then
  echo "Missing:$missing. Install them and run this script again (see README.md)." >&2
  exit 1
fi
echo "Found docker, minikube, kubectl and $($PY --version 2>&1)."

minikube start --cpus=4 --memory=6g --cni=calico
minikube addons enable metrics-server

# On some Linux hosts minikube does not apply --cpus to the node container.
docker update --cpus=4 minikube >/dev/null

# The addon measures every 60 s, which makes the HorizontalPodAutoscaler react slowly. Use 15 s.
cd "$(dirname "$0")"
kubectl -n kube-system patch deploy metrics-server --type=json --patch-file metrics-server-patch.json >/dev/null
kubectl -n kube-system rollout status deploy/metrics-server --timeout=180s

echo "Waiting for the system pods to become ready..."
kubectl wait --for=condition=Ready pods --all -n kube-system --timeout=300s
kubectl get nodes -o wide
