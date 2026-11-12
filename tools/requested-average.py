#!/usr/bin/env python3
"""Requested resources and measured use, per phase, for one run of tools/measure.py.

Usage (from the starter folder):
    python3 tools/requested-average.py <run-folder> [<baseline-run-folder>]

It prints:
  1. Average use per pod, per Deployment and phase, from the `kubectl top` samples.
     Ticket 8's rule compares your requests with the peak-phase numbers.
  2. Requested CPU and memory per phase: the requests per replica (read when the run started)
     times the number of ready replicas, averaged over the samples taken in that phase.
     That is how replica changes made by an autoscaler are counted.
  3. The average of the phases, which is the number ticket 8 asks you to cut.
     With a baseline run folder as the second argument, it also prints the cut in percent.

The load generator's own pod is not counted. Needs Python 3.8 or later; it reads files only.
"""
import csv, datetime as dt, json, os, re, sys
from collections import defaultdict


def phase_windows(run):
    """(start, end) epoch seconds of each phase, from the per-search rows in loadgen.log."""
    win = {}
    for line in open(os.path.join(run, 'loadgen.log')):
        f = line.rstrip('\n').split(',')
        if len(f) >= 8 and f[1] in ('idle', 'peak'):
            t = dt.datetime.fromisoformat(f[0].replace('Z', '+00:00')).timestamp()
            lo, hi = win.get(f[1], (t, t))
            win[f[1]] = (min(lo, t), max(hi, t))
    if not win:
        sys.exit(f'No search rows in {run}/loadgen.log. Did the load generator finish?')
    return win


def mem_mi(q):
    num = float(re.match(r'[0-9.]+', q).group(0))
    return num * {'Ki': 1 / 1024, 'Mi': 1, 'Gi': 1024}.get(q[len(re.match(r'[0-9.]+', q).group(0)):], 1)


def deployment_of(pod, deployments):
    # Pod names are <deployment>-<replicaset hash>-<pod hash>.
    base = pod.rsplit('-', 2)[0]
    return base if base in deployments else None


def analyse(run):
    requests = json.load(open(os.path.join(run, 'requests.json')))
    windows = phase_windows(run)

    replicas = defaultdict(dict)                     # epoch -> deployment -> ready replicas
    for r in csv.DictReader(open(os.path.join(run, 'replicas.csv'))):
        if r['deployment'] in requests:
            replicas[int(r['epoch_s'])][r['deployment']] = int(r['ready_replicas'] or 0)

    use = defaultdict(lambda: defaultdict(list))     # phase -> deployment -> [(cpu_m, mem_mi) per pod sample]
    t = None
    for line in open(os.path.join(run, 'top.txt')):
        if line.startswith('== '):
            t = int(line.split()[1])
            continue
        f = line.split()
        if t is None or len(f) < 3 or not re.match(r'^\d+m$', f[1]):
            continue
        d = deployment_of(f[0], requests)
        for ph, (lo, hi) in windows.items():
            if d and lo <= t <= hi:
                use[ph][d].append((float(f[1][:-1]), mem_mi(f[2])))

    per_phase = {}
    for ph, (lo, hi) in sorted(windows.items(), key=lambda kv: kv[1][0]):
        samples = [reps for ts, reps in replicas.items() if lo <= ts <= hi]
        if not samples:
            continue
        n = len(samples)
        cpu = sum(sum(reps.get(d, 0) * requests[d]['cpu_m'] for d in requests) for reps in samples) / n
        mem = sum(sum(reps.get(d, 0) * requests[d]['memory_mi'] for d in requests) for reps in samples) / n
        avg_reps = {d: sum(reps.get(d, 0) for reps in samples) / n for d in requests}
        per_phase[ph] = {'cpu_m': cpu, 'memory_mi': mem, 'replicas': avg_reps, 'samples': n}
    return requests, use, per_phase


def report(run):
    requests, use, per_phase = analyse(run)
    print(f'== {run}')
    print('\nAverage use per pod (kubectl top), and the request per replica:')
    print(f"  {'phase':6} {'deployment':14} {'CPU use':>9} {'request':>9} {'mem use':>9} {'request':>9}")
    for ph in per_phase:
        for d, xs in sorted(use[ph].items()):
            c = sum(x[0] for x in xs) / len(xs)
            m = sum(x[1] for x in xs) / len(xs)
            flag = '  <- request below average use' if ph == 'peak' and (
                c > requests[d]['cpu_m'] or m > requests[d]['memory_mi']) else ''
            print(f"  {ph:6} {d:14} {c:8.0f}m {requests[d]['cpu_m']:8.0f}m {m:7.0f}Mi {requests[d]['memory_mi']:7.0f}Mi{flag}")
    print('\nRequested resources per phase (replica-weighted):')
    for ph, v in per_phase.items():
        reps = ', '.join(f'{d} {r:.2f}' for d, r in sorted(v['replicas'].items()))
        print(f"  {ph:6} CPU {v['cpu_m']:6.0f}m  memory {v['memory_mi']:6.0f}Mi  ({v['samples']} samples; average replicas: {reps})")
    cpu = sum(v['cpu_m'] for v in per_phase.values()) / len(per_phase)
    mem = sum(v['memory_mi'] for v in per_phase.values()) / len(per_phase)
    print(f'  average of the phases: CPU {cpu:.0f}m, memory {mem:.0f}Mi')
    return cpu, mem


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cpu, mem = report(sys.argv[1])
    if len(sys.argv) > 2:
        print()
        bcpu, bmem = report(sys.argv[2])
        print(f'\nCut against the baseline: CPU {100 * (1 - cpu / bcpu):.1f}%, memory {100 * (1 - mem / bmem):.1f}%')


if __name__ == '__main__':
    main()
