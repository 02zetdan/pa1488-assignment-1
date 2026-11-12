# Tickets: Operate QuoteFinder on Local Kubernetes

You run QuoteFinder for a client. **Do the tickets in order**: each one builds on the cluster state the previous one left. For each ticket, write down what you did and save the evidence it asks for. Run everything on the cluster that `setup-minikube.sh` creates.

## What you are given

| Item | Name |
| --- | --- |
| QuoteFinder source | `QFApp/`, `QFWorker/`, `docker-compose.yml`. In ticket 1 you build your own version 1.0 images from it. |
| Version 2.0, for ticket 3 | `ghcr.io/02zetdan/pa1488-qfapp:2.0` and `ghcr.io/02zetdan/pa1488-qfworker:2.0` in the registry |
| Release for ticket 6 | `ghcr.io/02zetdan/pa1488-qfworker:3.0` in the registry |
| Load generator | `ghcr.io/02zetdan/pa1488-loadgen:1.0` in the registry; example Job in `loadgen-job.yaml` |
| Measuring tools | `tools/measure.py` and `tools/requested-average.py` (see `tools/README.md`) |

The registry images are public, so the cluster pulls them without logging in. Your own 1.0 images do not need a registry: build them with `docker build` and copy them into the cluster with `minikube image load <image>`. Use `imagePullPolicy: IfNotPresent` for images you load this way. The same works as a fallback if the cluster cannot reach the registry: run `docker pull <image>` on your computer, then `minikube image load <image>`.

**The client's standard for QFWorker** is a CPU request and limit of 250m (`requests.cpu` = `limits.cpu` = `250m`) and a memory limit of 256Mi on every worker container. Keep it in all tickets.

## About the load generator

It behaves like browser users and has two phases, set with environment variables in `loadgen-job.yaml`:
- **idle**: one search every 10 s for 5 minutes;
- **peak**: 100 users who each search, read the results for about 20 s, and search again, for 5 minutes. The users join during the first 2 minutes.

The end of the Job's log has a summary with p50 and p95 latency and the error rate per phase. The extra row `steady` is the peak without its first 2 minutes, the ramp: it shows whether the system keeps up once all users are there, without the delay before an autoscaler reacts. Between the `CSV BEGIN` and `CSV END` lines you find every single search.

The application must have at least one text in the database first (see `README.md`). During a measurement, keep your computer plugged in and awake, with the lid open.

## Tickets

### 1. Go live

The client wants QuoteFinder on Kubernetes instead of Docker Compose.

**Done when:** you have your own Kubernetes manifests translated from the Compose file (Deployments, Services, and a PersistentVolumeClaim for MongoDB and for Redis as needed). The images are built and pushed, or loaded. The app can be reached from a browser on your host (see `README.md` for how, on your operating system). Data survives deleting the MongoDB pod.

### 2. Traffic is about to grow

The client expects much more traffic at peak times and does not want to pay for idle workers.

**Done when:** QFWorker has a HorizontalPodAutoscaler, and you have run the load generator before and after adding it. Start each run from a settled state: wait until the number of workers is back at its minimum and stable before you start the Job.

**Evidence:** replica count over time and p95 latency per phase, for both runs. Explain why the autoscaler helped, or why it did not, using what `kubectl top` showed.

### 3. Ship v2

Version 2.0 is ready. Show that it can go out, and come back, without users noticing.

**Done when:** you have done a rolling update of QFApp and QFWorker from 1.0 to 2.0 while the load generator runs, with no failed searches, and then a `kubectl rollout undo`, also under load.

A few failed searches during the update (under 1%) are acceptable if you note them in your ticket log.

**Evidence:** the load generator summaries for both, and the rollout history. The version is shown in the QFApp page footer.

### 4. Database password leaked

MongoDB has no password at the moment, and the client has been told that a password may leak.

**Done when:** MongoDB requires authentication, the credentials come from a Secret, and you have rotated the password without visible downtime. Both services read the optional variables `MONGO_USER` and `MONGO_PASSWORD`.

- A short outage while you first turn authentication on is acceptable. The rotation itself must not cause one.
- **Hint: create the users before you turn authentication on.** Your MongoDB volume already contains data, so the `mongo` image will *not* create the user given in `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD`. It only does that on an empty volume. Setting the two variables still makes it start MongoDB with authentication on. Create the users first, through MongoDB's *localhost exception*: while no user exists, a client connecting from inside the MongoDB pod may create one. For example:
  ```
  kubectl exec deploy/<mongodb-deployment> -- mongosh admin --eval 'db.createUser({user: "admin", pwd: "<password>", roles: ["root"]})'
  kubectl exec deploy/<mongodb-deployment> -- mongosh -u admin -p '<password>' --authenticationDatabase admin admin --eval 'db.createUser({user: "quotefinder-1", pwd: "<password>", roles: [{role: "readWrite", db: "textStore"}]})'
  ```
  Create the users in the `admin` database, because QuoteFinder logs in with `authSource=admin`. Then give MongoDB the root Secret and give QFApp and QFWorker the application user's Secret.
- To rotate without downtime, think about what happens to running pods if you change the password of the user they are logged in as.
- Do not commit Secret files with real passwords to your repository.

**Evidence:** the load generator, or a request loop that reads from the database, running during the rotation.

### 5. Database reachable from every pod

Any pod in the cluster can currently connect to the databases.

**Done when:** a NetworkPolicy lets only QFApp and QFWorker reach MongoDB and Redis, and the database Services are of type ClusterIP.

**Evidence:** a connection attempt from a test pod, before and after. Also answer: what does your policy **not** protect against?

### 6. Pod keeps crashing

Operations deployed `ghcr.io/02zetdan/pa1488-qfworker:3.0` to one replica, with the client's standard limits. Under sustained load, the worker pod does not stay up.

Deploy the same setup, one replica, and run the load generator with `PHASES=peak`, `PEAK_USERS=15` and `PEAK_DURATION_S=600`.

**Done when:**
- you have diagnosed the problem at one replica, using only logs, `kubectl describe` and `kubectl top`, and written down the root cause and how you reached it;
- you have applied what operations can do about it. Rolling back is allowed if you explain why;
- you have said what the developers need to change.

### 7. Users lose sessions when the frontend scales

The client wants more than one QFApp replica, but users then lose their connection.

**Done when:** QFApp runs with 3 replicas and `SHOW_SERVER_ID=true`. You have first reproduced the broken behaviour and then fixed it. Find and apply a fix. If your fix changes how the browser client connects, set `TRANSPORTS` in the load generator to match.

**Evidence:** before and after. Also answer: if your fix depends on where requests come from, what does it do on your minikube cluster, where all your requests come from one address, and what would it do behind a real load balancer with many users? Did you see connection errors during ticket 3's update? Explain them now.

### 8. Cut resource requests by 40%

The client pays for what is requested and thinks it is too much. This is the configuration they run today. Keep at least 2 QFApp replicas from ticket 7.

| Service | Replicas | CPU request | Memory request | Memory limit |
| --- | --- | --- | --- | --- |
| QFApp | 2 | 200m | 256Mi | 256Mi |
| QFWorker | 3 | 250m | 256Mi | 256Mi (CPU limit 250m) |
| Redis | 1 | 250m | 128Mi | 128Mi |
| MongoDB | 1 | 200m | 512Mi | 1Gi |

**Goal:** cut the total requested CPU **and** the total requested memory by **40%**, each averaged over the idle and peak phases, while the `steady` p95 latency stays under **5000 ms**.

**Rules:**
- every pod has a memory limit;
- each Deployment's CPU and memory requests are at least the average use per pod that you measured during the peak phase. QFWorker's CPU stays at the client's standard of 250m;
- at least 2 QFApp replicas.

**How to measure:** start every run from a settled state, then use `tools/measure.py` for the load generator run, and `tools/requested-average.py` on its output (see `tools/README.md`). The second script prints the average use per pod, the requested resources per phase weighted by the replicas that were actually running, and the cut against your baseline run. Keep your computer plugged in and awake during the runs.

**Done when:** you have measured the baseline, changed the configuration and measured it again, and written down the result and what limited further cuts.

Graded with the other tickets against the criteria on the Canvas assignment page. Falling a little short of 40% on a slower computer is acceptable if you show why.

**Evidence:** the configuration before and after, the output of `tools/requested-average.py` for both runs, and the load generator summaries.

## Practical notes

- QFApp has `GET /healthz` and `GET /readyz` on port 3000, QFWorker on port 8081. Use them for your probes. `/readyz` checks that MongoDB (with the configured user) and Redis can be reached.
- A search keeps the worker's single thread busy in short bursts, so give the probes a `timeoutSeconds` of 2 or more with the 250m CPU limit.
- A search that is not finished after 20 seconds is abandoned by QFApp.
- When a pod is stopped, QFApp finishes the searches it is running (at most about 25 seconds) and QFWorker finishes its current job before exiting.
