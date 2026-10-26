#!/usr/bin/env python3
"""Check an existing tag run before retrying publication of its tested payload."""
import argparse
import os
import subprocess

from publish_release import GitHubCLI, validate_tag


def require_verified_run(run, jobs, repository, tag, commit):
    validate_tag(tag)
    if (run["repository"]["full_name"] != repository or run["head_sha"] != commit
            or run["head_branch"] != tag or run["event"] not in ("push", "workflow_dispatch")
            or run["path"] != ".github/workflows/build-ape.yml"
            or run["status"] != "completed"):
        raise ValueError("Source CI run does not match the checked-out release tag")
    gates = [job for job in jobs if job["name"] == "CI gate"]
    if len(gates) != 1 or gates[0]["conclusion"] != "success":
        raise ValueError("Source CI run must have a successful complete CI gate")
    for job in jobs:
        if (job["name"] != "Publish tagged release"
                and (job["status"] != "completed" or job["conclusion"] != "success")):
            raise ValueError("Source CI run has an unsuccessful validation job: " + job["name"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    args = parser.parse_args()
    validate_tag(args.tag)
    if args.run_id <= 0:
        parser.error("--run-id must be positive")
    repository = os.environ["GITHUB_REPOSITORY"]
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    client = GitHubCLI()
    endpoint = f"repos/{repository}/actions/runs/{args.run_id}"
    run = client.get(endpoint)
    jobs, page = [], 1
    while True:
        batch = client.get(endpoint + f"/jobs?per_page=100&page={page}")["jobs"]
        jobs.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    require_verified_run(run, jobs, repository, args.tag, commit)
    print(f"PASS source CI gate: {args.tag} {commit} run {args.run_id}", flush=True)


if __name__ == "__main__":
    main()
