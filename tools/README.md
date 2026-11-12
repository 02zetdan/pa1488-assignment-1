# Measuring tools

Two small scripts for ticket 8, also useful for ticket 2. They need **Python 3.8 or later** and `kubectl` pointing at your minikube cluster, and nothing else. On Windows, run them with `python` or `py` instead of `python3`.

Run both from the starter folder.

## 1. One measured run: `measure.py`

```
python3 tools/measure.py runs/baseline
```

The script does four things:
- starts the load generator Job from `loadgen-job.yaml`, replacing an old `loadgen` Job if there is one;
- records each Deployment's requests;
- samples the ready replicas and `kubectl top pods` every 15 seconds until the Job finishes (about 11 minutes with the defaults);
- saves the load generator's log and prints its summary.

The output folder will contain `requests.json`, `replicas.csv`, `top.txt`, `job.yaml` and `loadgen.log`.

To change a load generator setting for one run only, add `NAME=VALUE` arguments, for example:
```
python3 tools/measure.py runs/short PHASES=peak PEAK_DURATION_S=180
```

Before each run:
- the application has at least one text;
- the number of workers is back at its minimum and stable;
- the metrics server is running (`kubectl top pods` shows numbers).

## 2. What was requested and used: `requested-average.py`

```
python3 tools/requested-average.py runs/reduced runs/baseline
```

The script prints three things:
- **Average use per pod** per Deployment and phase, next to the request per replica. In the peak phase, a request below the average use is marked, because that breaks ticket 8's rule.
- **Requested CPU and memory per phase**: the requests per replica times the number of replicas that were ready, averaged over the samples in that phase. When an autoscaler changes the number of workers, this follows it.
- **The average of the phases**, and, when you also give a baseline folder, **the cut in percent**.

The requests are read when the run starts. Do not change the configuration during a run.
