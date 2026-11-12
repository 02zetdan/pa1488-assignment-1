# QuoteFinder

## Start here

### What this is

This repository is QuoteFinder, a small web application that finds sentences in stored books. You use it in the PA1488 project assignment, where you run it on a local Kubernetes cluster and work through operations tickets. The tickets are in `TICKETS.md`. The hand-in, the oral demo and the grading are described on the Canvas assignment page.

### Prerequisites

- Docker
- minikube
- kubectl
- Python 3.8 or later (for the measuring tools in `tools/`)
- A computer with at least 4 CPUs and 8 GB of RAM

### Your own copy

1. Click **Use this template** on GitHub and create your own repository.
2. Make your copy **private**.
3. Add the teachers as collaborators: [TEACHER GITHUB ACCOUNTS].

Never commit Secret files with real passwords (see `k8s/README.md`).

### First steps

1. Run the application with Docker Compose and add War and Peace:
   ```
   docker compose up --build
   ```
   Open <http://localhost:8080/add>, leave both fields empty and press **Add**. Then search for `prince` on <http://localhost:8080/>. Stop it with `Ctrl+C` and `docker compose down`.
2. Start the Kubernetes cluster:
   ```
   ./setup-minikube.sh            # Linux and macOS
   .\setup-minikube.ps1           # Windows, in PowerShell
   ```
   The script first checks that the prerequisites are installed.
3. Check that the metrics server works. This can take a minute or two after the cluster has started:
   ```
   kubectl top pods -A
   ```
   You should see CPU and memory numbers, not an error.
4. Check that the cluster can pull the assignment's images:
   ```
   minikube image pull ghcr.io/02zetdan/pa1488-loadgen:1.0
   minikube image ls | grep pa1488
   ```
   If the pull fails, see "If images cannot be pulled" below.
5. Go to ticket 1 in `TICKETS.md`.

### Where things are

| Path | What it is |
| --- | --- |
| `TICKETS.md` | The tickets. Do them in order. |
| `TICKET_LOG.md` | Template for your ticket log |
| `MEMO.md` | Template for your memo |
| `QFApp/`, `QFWorker/` | Source code of the two QuoteFinder services |
| `docker-compose.yml` | Runs QuoteFinder with Docker Compose |
| `setup-minikube.sh`, `setup-minikube.ps1` | Start the cluster used in the assignment |
| `loadgen-job.yaml` | Load generator Job |
| `tools/` | Measuring tools (see `tools/README.md`) |
| `k8s/` | Put your Kubernetes manifests here |
| `evidence/` | Put your evidence here, one folder per ticket |

## Architecture

| Service | What it does | Port |
| --- | --- | --- |
| QFApp (`QFApp/`) | Express web front end. Talks to the browser over socket.io and hands searches to the job queue. | 3000 |
| QFWorker (`QFWorker/`) | Takes search jobs from the queue, searches one text per job and sends the results back. | 8081 (health only) |
| Redis | Message queues between QFApp and QFWorker (RSMQ). | 6379 |
| MongoDB | Stores the texts, split into chunks of 1000 lines. | 27017 |

## Run it with Docker Compose

`docker compose up --build` starts all four services, with QFApp on <http://localhost:8080>. The spinner stops when every text has been searched; a search that is not finished after 20 seconds is abandoned.

## Configuration

| Variable | Service | Purpose |
| --- | --- | --- |
| `REDIS_HOST` | both | Host name of Redis (required) |
| `TEXTSTORE_HOST` | both | Host name of MongoDB (required) |
| `MONGO_USER`, `MONGO_PASSWORD` | both | MongoDB credentials, used only if both are set. Authenticated against the `admin` database. |
| `SHOW_SERVER_ID` | QFApp | `true` shows `Server id: <hostname>` on the pages |
| `APP_VERSION` | both | Overrides the version. Printed at start-up, and shown in the QFApp footer. |
| `TIMEOUT` | QFApp | Seconds before a search is cleaned up. Default 20. |
| `MAXTHREADS` | QFWorker | Number of batches a text is split into. Default 10. |

## Health endpoints

| Endpoint | Meaning |
| --- | --- |
| `GET /healthz` | The process is alive. |
| `GET /readyz` | MongoDB and Redis can be reached. Returns 503 otherwise, within about 2 seconds. |

QFApp serves these on port 3000, QFWorker on port 8081.

## Local Kubernetes

`./setup-minikube.sh` (or `setup-minikube.ps1` on Windows) starts the cluster used in the assignment. It checks the prerequisites first and stops if one is missing. On Windows, `python`, `python3` or the `py` launcher all work. During load tests, turn off sleep, keep a laptop's lid open (closing it usually suspends the machine even when sleep is turned off), and keep the laptop plugged in: on battery the CPU runs slower and the application handles only about half as many searches.

### Reaching the application from your browser

A Service of type `NodePort` is reachable on the node's IP address. How you get there depends on your computer:

| Host | How to open the app |
| --- | --- |
| Linux, docker driver | `http://$(minikube ip):<nodePort>` works directly. |
| macOS or Windows, docker driver | The node IP is not reachable from the host. Run `minikube service <service-name> --url` and keep that terminal open while you use the URL it prints, or use `kubectl port-forward service/<service-name> 8080:3000` and open `http://localhost:8080`. |

`kubectl port-forward` goes to a single pod, so do not use it to test anything about several replicas (ticket 7). Use `minikube service` or the node IP for that.

### If images cannot be pulled

If pods stay in `ImagePullBackOff` and the events say that a host name cannot be resolved, the minikube node has no working DNS. Check with:

```
docker exec minikube getent hosts ghcr.io registry-1.docker.io
```

This depends on your network and on your Docker configuration. It happens, for example, when the Docker daemon is configured with `"dns": ["172.17.0.1"]`, and it may work on one network and fail on another. The fix is to give the node public name servers, then wait a few minutes:

```
docker exec minikube sh -c 'printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions ndots:0\n" > /etc/resolv.conf'
```

You have to repeat it after each `minikube stop` and `minikube start`.

If the cluster still cannot pull an image, pull it on your own computer and copy it into the cluster:

```
docker pull <image>
minikube image load <image>
```

Then use `imagePullPolicy: IfNotPresent` for that image.

## Load generator

`loadgen-job.yaml` runs the load generator as a Kubernetes Job. Set `TARGET_URL` in the file to your QFApp Service. See the comments in the file.

`tools/measure.py` runs the Job and records the replicas and `kubectl top` while it runs. `tools/requested-average.py` turns such a run into average use and requested resources per phase. You need both for ticket 8; see `tools/README.md`. Both need Python 3.8 or later.

## Licence

MIT, see `LICENSE`. Copyright (c) 2022 Mikael Svahnberg.
