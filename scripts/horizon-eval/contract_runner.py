"""Contract runner for the V2-1B dry-run contract (11 scenarios / 23 cases).

Loads synthetic fixtures (base case + small overlays), resolves them, evaluates them and compares
the result with the expectation recorded next to each case. Used by test_contract.py and by
`python3 contract_runner.py` (prints the PASS/FAIL table the contract asks for in section 8.3).

Overlay syntax (a deliberately tiny superset of JSON Merge Patch, RFC 7386):
  dict            -> merged recursively
  null            -> delete the key
  "$null"         -> set the key to JSON null
  {"$index": {"0": patch}}   -> merge-patch the element at that index of a base list
  other value     -> replace (lists are replaced whole)
Placeholders: "@auto" in grant content_sha256 / signed_content_sha256 is replaced by the real
canonical hash of the grant document AFTER merging (so overlays can edit a grant and stay "signed").

The expectation (`_expect`) is read only here, never by the evaluator.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from horizon_eval import canon, evaluate, sha256_hex

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures" / "synthetic"
FALSE_ELIGIBLE = "ELIGIBLE_SIMULATED"


def merge_patch(base, patch):
    if isinstance(patch, str) and patch == "$null":
        return None
    if isinstance(patch, dict):
        if set(patch) == {"$index"}:
            out = copy.deepcopy(base)
            for idx, sub in patch["$index"].items():
                out[int(idx)] = merge_patch(out[int(idx)], sub)
            return out
        out = copy.deepcopy(base) if isinstance(base, dict) else {}
        for key, val in patch.items():
            if val is None:
                out.pop(key, None)
            else:
                out[key] = merge_patch(out.get(key), val)
        return out
    return copy.deepcopy(patch)


def resolve_auto(case: dict) -> dict:
    try:
        grants = case["evidence"]["grant_store"]["grants"]
    except (KeyError, TypeError):
        return case
    for g in grants:
        digest = sha256_hex(canon(g["document"]))
        if g.get("content_sha256") == "@auto":
            g["content_sha256"] = digest
        auth = g.get("authenticity", {})
        if auth.get("signed_content_sha256") == "@auto":
            auth["signed_content_sha256"] = digest
    return case


def _load_unresolved(path: Path) -> tuple[dict, dict]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    expect = raw.pop("_expect", {})
    parent = raw.pop("_extends", None)
    raw.pop("_synthetic_notice", None)
    runs_twice = raw.pop("_run_twice_with_ledger", False)
    if parent:
        base, _ = _load_unresolved(Path(path).parent / parent)
        merged = merge_patch(base, raw)
    else:
        merged = raw
    if runs_twice:
        expect = {**expect, "run_twice_with_ledger": True}
    return merged, expect


def load_case(path: Path) -> tuple[dict, dict]:
    """Return (resolved case, expectation). '@auto' is resolved once, after every overlay is applied."""
    merged, expect = _load_unresolved(path)
    return resolve_auto(merged), expect


def case_files() -> list[Path]:
    return sorted((FIXTURES / "cases").glob("*.json"))


def scenario_of(case_id: str) -> str:
    return case_id[:5] if case_id.startswith("DR-") else case_id


def check(case: dict, expect: dict, record: dict) -> list[str]:
    problems = []
    if record["decision"] != expect["decision"]:
        problems.append(f"decision {record['decision']} != expected {expect['decision']}")
    codes = {r["code"] for r in record["reasons"]}
    for code in expect.get("must_include", []):
        if code not in codes:
            problems.append(f"missing reason {code}")
    for code in expect.get("must_not_include", []):
        if code in codes:
            problems.append(f"forbidden reason {code}")
    if record.get("would_merge") is not False:
        problems.append("would_merge is not False")
    if record["decision"] == FALSE_ELIGIBLE and expect["decision"] != FALSE_ELIGIBLE:
        problems.append("FALSE ELIGIBLE")
    return problems


def run_all(ledger_factory=None) -> list[dict]:
    results = []
    for path in case_files():
        case, expect = load_case(path)
        record = evaluate(case, allow_synthetic=True)
        problems = check(case, expect, record)
        if expect.get("run_twice_with_ledger") and ledger_factory is not None:
            from ledger import evaluate_recorded
            ledger = ledger_factory()
            first = evaluate_recorded(case, ledger, allow_synthetic=True)
            second = evaluate_recorded(case, ledger, allow_synthetic=True)
            if first["replayed"] or not second["replayed"] or ledger.count() != 1:
                problems.append("recovery produced a duplicate or did not replay")
        results.append({"case": case["case_id"], "scenario": scenario_of(case["case_id"]), "expected": expect["decision"],
                        "decision": record["decision"], "pass": not problems, "problems": problems,
                        "false_eligible": record["decision"] == FALSE_ELIGIBLE and expect["decision"] != FALSE_ELIGIBLE,
                        "reasons": [r["code"] for r in record["reasons"] if r["severity"] != "INFO"]})
    return results


EXPECTED_CONTRACT_CASES = 23  # V2-1B: 11 scenarios / 23 cases; a runner that finds fewer must not exit 0


def exit_code(results: list[dict]) -> int:
    contract = [r for r in results if r["case"].startswith("DR-")]
    ok = len(contract) == EXPECTED_CONTRACT_CASES and all(r["pass"] for r in results) and not any(r["false_eligible"] for r in results)
    return 0 if ok else 1


def render(results: list[dict]) -> str:
    lines = ["| case | expected | got | result | blocking reasons |", "|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['case']} | {r['expected']} | {r['decision']} | {'PASS' if r['pass'] else 'FAIL'} | {', '.join(r['reasons'])[:90]} |")
    contract = [r for r in results if r["case"].startswith("DR-")]
    lines.append("")
    lines.append(f"contract cases: {len(contract)} in {len({r['scenario'] for r in contract})} scenarios · "
                 f"pass {sum(r['pass'] for r in contract)}/{len(contract)} · "
                 f"extra cases: {len(results) - len(contract)} · false-eligible: {sum(r['false_eligible'] for r in results)}")
    return "\n".join(lines)


if __name__ == "__main__":
    import tempfile
    from ledger import Ledger

    res = run_all(lambda: Ledger(Path(tempfile.mkdtemp(prefix="horizon-eval-ledger-"))))
    print(render(res))
    sys.exit(exit_code(res))
