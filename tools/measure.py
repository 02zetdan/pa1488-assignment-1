#!/usr/bin/env python3
"""Run the load generator once and record what the cluster did while it ran.

Usage (from the starter folder):
    python3 tools/measure.py <output-folder> [NAME=VALUE ...]

Examples:
    python3 tools/measure.py runs/baseline
    python3 tools/measure.py runs/ticket6 PHASES=peak PEAK_USERS=15 PEAK_DURATION_S=600

NAME=VALUE pairs override the environment variables in loadgen-job.yaml for this run only.
The script deletes any old Job called "loadgen", starts a new one and then, every 15 seconds
until the Job finishes, samples:
  replicas.csv  ready replicas per Deployment
  top.txt       `kubectl top pods`
It also saves:
  requests.json the CPU and memory requests per replica of every Deployment, read at the start
  job.yaml      the Job that was applied
  loadgen.log   the load generator's log, with the summary at the end

Then run tools/requested-average.py on the output folder.
Needs Python 3.8 or later and kubectl pointing at your cluster. Nothing else.
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
JOB_TEMPLATE = os.path.join(HERE, '..', 'loadgen-job.yaml')
INTERVAL_S = 15


def kubectl(*args, check=True, stdin=None):
    r = subprocess.run(['kubectl', *args], input=stdin, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f'kubectl {" ".join(args)} failed:\n{r.stderr}')
    return r.stdout


def job_yaml(overrides):
    text = open(JOB_TEMPLATE).read()
    for name, value in overrides.items():
        pat = re.compile(r'(        - name: %s\n          value: )"[^"]*"' % re.escape(name))
        if pat.search(text):
            text = pat.sub(lambda m: m.group(1) + '"%s"' % value, text)
        else:
            text = text.replace('        env:\n', '        env:\n        - name: %s\n          value: "%s"\n' % (name, value), 1)
    return text


def requests_per_deployment():
    out = {}
    for d in json.loads(kubectl('get', 'deploy', '-o', 'json'))['items']:
        cpu = mem = 0.0
        for c in d['spec']['template']['spec']['containers']:
            req = c.get('resources', {}).get('requests', {})
            cpu += cpu_m(req.get('cpu', '0'))
            mem += mem_mi(req.get('memory', '0'))
        out[d['metadata']['name']] = {'cpu_m': cpu, 'memory_mi': mem}
    return out


def cpu_m(q):
    q = str(q)
    return float(q[:-1]) if q.endswith('m') else float(q) * 1000


def mem_mi(q):
    q = str(q)
    units = {'Ki': 1 / 1024, 'Mi': 1, 'Gi': 1024, 'Ti': 1024 ** 2,
             'k': 1000 / 1024 ** 2, 'M': 1000 ** 2 / 1024 ** 2, 'G': 1000 ** 3 / 1024 ** 2}
    for u in sorted(units, key=len, reverse=True):
        if q.endswith(u):
            return float(q[:-len(u)]) * units[u]
    return float(q) / 1024 ** 2


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[1]
    overrides = dict(a.split('=', 1) for a in sys.argv[2:])
    os.makedirs(out, exist_ok=True)
    yaml = job_yaml(overrides)
    open(os.path.join(out, 'job.yaml'), 'w').write(yaml)
    json.dump(requests_per_deployment(), open(os.path.join(out, 'requests.json'), 'w'), indent=2)

    kubectl('delete', 'job', 'loadgen', '--ignore-not-found', '--wait=true')
    kubectl('apply', '-f', '-', stdin=yaml)
    print(f'Load generator started. Sampling every {INTERVAL_S} s until it finishes '
          f'(the default run takes about 11 minutes).', flush=True)

    with open(os.path.join(out, 'replicas.csv'), 'w') as rep, open(os.path.join(out, 'top.txt'), 'w') as top:
        rep.write('epoch_s,deployment,ready_replicas\n')
        while True:
            now = int(time.time())
            for d in json.loads(kubectl('get', 'deploy', '-o', 'json'))['items']:
                rep.write(f"{now},{d['metadata']['name']},{d['status'].get('readyReplicas', 0)}\n")
            top.write(f'== {now}\n' + kubectl('top', 'pods', '--no-headers', check=False))
            rep.flush(); top.flush()
            status = kubectl('get', 'job', 'loadgen', '-o',
                             'jsonpath={.status.conditions[?(@.status=="True")].type}', check=False)
            if 'Complete' in status or 'Failed' in status:
                break
            time.sleep(INTERVAL_S)

    log = kubectl('logs', 'job/loadgen')
    open(os.path.join(out, 'loadgen.log'), 'w').write(log)
    m = re.search(r'--- SUMMARY BEGIN ---.*?--- SUMMARY END ---\n?(steady = [^\n]*)?', log, re.S)
    print(m.group(0) if m else 'No summary in the load generator log; see loadgen.log.')
    print(f'Saved in {out}. Next: python3 tools/requested-average.py {out}')


if __name__ == '__main__':
    main()
