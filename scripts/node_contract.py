"""Validate the compatibility inventory without claiming planned APIs work."""
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {"planned", "partial", "supported", "blocked", "unsupported"}
TARGETS = {"qjs", "worker", "qjsc", "sdk"}
PLATFORMS = {"linux", "darwin", "win32"}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def checked_file(root, name):
    """Inventory paths must be repository-relative and stay inside the checkout."""
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError("Invalid contract path: " + name)
    result = (Path(root) / name).resolve()
    if not result.is_relative_to(Path(root).resolve()):
        raise ValueError("Contract path escapes checkout: " + name)
    return result


def validate(inventory, root=ROOT):
    if inventory.get("format") != 1:
        raise ValueError("Unsupported Node API inventory format")
    baseline = read_json(checked_file(root, inventory["node_baseline"]))
    if baseline.get("version") != "v24.21.0":
        raise ValueError("Node baseline must remain v24.21.0 until explicitly migrated")
    if not baseline.get("artifacts"):
        raise ValueError("Missing pinned Node artifacts")
    for record in [baseline["checksums"], *baseline["artifacts"].values()]:
        if not re.fullmatch(r"[0-9a-f]{64}", record.get("sha256", "")):
            raise ValueError("Invalid Node baseline SHA-256")
    plan = checked_file(root, inventory["plan"]).read_text(encoding="utf-8")
    tasks = set(re.findall(r"\bM[0-6]-[0-9]{2}\b", plan))
    tests = {}
    for test in inventory["tests"]:
        identifier = test["id"]
        if identifier in tests or not re.fullmatch(r"[A-Z]+-[0-9]{3}", identifier):
            raise ValueError("Invalid or duplicate test ID: " + identifier)
        if test["status"] not in {"planned", "reference", "differential", "runtime"}:
            raise ValueError("Invalid test status: " + identifier)
        if test["task"] not in tasks:
            raise ValueError("Unknown test task: " + test["task"])
        if test["status"] != "planned":
            fixture = checked_file(root, test["file"])
            if not fixture.is_file() or fixture.suffix != ".mjs":
                raise ValueError("Missing ESM fixture: " + identifier)
        elif test.get("file") is not None:
            raise ValueError("Planned test must not claim an executable fixture: " + identifier)
        if not 0 < test.get("timeout_seconds", 0) <= 120:
            raise ValueError("Invalid test timeout: " + identifier)
        if "compare_output" in test and type(test["compare_output"]) is not bool:
            raise ValueError("Invalid output comparison flag: " + identifier)
        tests[identifier] = test
    names, identifiers = set(), set()
    for module in inventory["modules"]:
        name = module["specifier"]
        if not name.startswith(("node:", "cosmo:")):
            raise ValueError("Invalid public module: " + name)
        for alias in [name, *module["aliases"]]:
            if alias in names or alias in {"os", "std"} or alias.startswith("@runtime/"):
                raise ValueError("Conflicting module name: " + alias)
            names.add(alias)
        if not module["entries"]:
            raise ValueError("Empty module inventory: " + name)
        for entry in module["entries"]:
            identifier = name + "." + entry["name"]
            if identifier in identifiers or entry["status"] not in STATUSES:
                raise ValueError("Invalid or duplicate API: " + identifier)
            identifiers.add(identifier)
            if entry["task"] not in tasks or not entry["parameters"] or not entry["differences"]:
                raise ValueError("Incomplete API contract: " + identifier)
            if not entry["tests"] or any(t not in tests for t in entry["tests"]):
                raise ValueError("API references unknown tests: " + identifier)
            support = entry.get("support", inventory["support_defaults"])
            if set(support) != PLATFORMS:
                raise ValueError("Missing platform coverage: " + identifier)
            for targets in support.values():
                if set(targets) != TARGETS or any(s not in STATUSES for s in targets.values()):
                    raise ValueError("Invalid execution target coverage: " + identifier)
            claims = [entry["status"], *(s for targets in support.values() for s in targets.values())]
            if any(s in {"partial", "supported"} for s in claims):
                accepted = {"differential", "runtime"} if name.startswith("cosmo:") else {"differential"}
                if any(tests[t]["status"] not in accepted for t in entry["tests"]):
                    raise ValueError("Supported API requires differential tests: " + identifier)
                if not entry.get("evidence"):
                    raise ValueError("Supported API requires evidence: " + identifier)
    if not identifiers or not any(t["status"] == "differential" for t in tests.values()):
        raise ValueError("Inventory needs API entries and a differential bootstrap test")
    checked_file(root, inventory["entry_contract"]).read_text(encoding="utf-8")
    native = read_json(checked_file(root, inventory["native_lock"]))
    if native["format"] != 1 or native["cosmopolitan"]["commit"] != read_json(Path(root) / "versions.json")["cosmopolitan"]["commit"]:
        raise ValueError("Native source lock must match current toolchain")
    if not re.fullmatch(r"[0-9a-f]{64}", native["cosmopolitan"]["sha256"]):
        raise ValueError("Invalid native source archive checksum")
    for library in native["libraries"]:
        if not library["files"] or library["admission"] not in {"E0", "E1", "E2", "E3", "E4", "E5"}:
            raise ValueError("Invalid native library admission record")
        for record in library["files"]:
            checked_file(root, record["path"])
            if not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
                raise ValueError("Invalid native source anchor checksum")
    return dict(modules=len(inventory["modules"]), apis=len(identifiers), tests=len(tests),
                implemented_node_apis=sum(e["status"] in {"partial", "supported"}
                                         for m in inventory["modules"] if m["specifier"].startswith("node:")
                                         for e in m["entries"]),
                implemented=sum(e["status"] in {"partial", "supported"}
                                for m in inventory["modules"] for e in m["entries"]))


def load_contract(root=ROOT):
    inventory = read_json(Path(root) / "compat/node-api.json")
    validate(inventory, root)
    return inventory
