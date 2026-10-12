"""Idempotent local audit ledger for the dry-run evaluator (AWJ-HORIZON-V2-1C).

Purpose: make an interrupted evaluation recoverable without producing duplicate decisions.
Local files only - this module never talks to GitHub and never acts on a decision.

Layout (under the directory given by the caller; never inside the repository by default)
  records/<record_id>.json   one finished audit record, written atomically (tmp + fsync + os.replace)
  pending/<record_id>.json   marker created before evaluation, removed after the record is committed

record_id = sha256(idempotency_key + evidence_digest)
  idempotency_key = (horizon, task, head_sha, action)   - V2-1B 5/T8
  evidence_digest = hash of the exact evidence evaluated
So the same evidence maps to the same record (replayed, never duplicated); new evidence for the same
key (e.g. CI turned green) is a legitimately new record. A torn/corrupted record is detected by its
integrity hash and re-evaluated, never trusted.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from horizon_eval import canon, evaluate, evidence_digest, idempotency_key, sha256_hex


class Ledger:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.records = self.root / "records"
        self.pending = self.root / "pending"
        self.records.mkdir(parents=True, exist_ok=True)
        self.pending.mkdir(parents=True, exist_ok=True)

    def _path(self, record_id: str) -> Path:
        if not record_id or any(c not in "0123456789abcdef" for c in record_id):
            raise ValueError("record_id must be lowercase hex")
        return self.records / f"{record_id}.json"

    def lookup(self, record_id: str) -> dict | None:
        path = self._path(record_id)
        try:
            wrapper = json.loads(path.read_text(encoding="utf-8"))
            record = wrapper["record"]
            if wrapper["integrity"] != sha256_hex(canon(record)) or record.get("record_id") != record_id:
                return None
            return record
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def begin(self, record_id: str) -> str:
        """Create the pending marker. Returns 'fresh' or 'recovered' (a previous attempt was interrupted)."""
        marker = self.pending / f"{record_id}.json"
        stale_tmp = self._path(record_id).with_suffix(".json.tmp")
        if stale_tmp.exists():
            stale_tmp.unlink()
        try:
            fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            return "recovered"
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(canon({"record_id": record_id}))
        return "fresh"

    def commit(self, record: dict):
        final = self._path(record["record_id"])
        tmp = final.with_suffix(".json.tmp")
        payload = canon({"integrity": sha256_hex(canon(record)), "record": record})
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, final)
        marker = self.pending / f"{record['record_id']}.json"
        if marker.exists():
            marker.unlink()

    def count(self) -> int:
        return sum(1 for p in self.records.glob("*.json"))

    def pending_count(self) -> int:
        return sum(1 for _ in self.pending.glob("*.json"))


def evaluate_recorded(case, ledger: Ledger, *, allow_synthetic: bool = False, wall_clock=None) -> dict:
    """Evaluate once per (key, evidence). Safe to call again after any interruption."""
    case = case if isinstance(case, dict) else {}
    record_id = sha256_hex(idempotency_key(case) + evidence_digest(case))
    existing = ledger.lookup(record_id)
    if existing is not None:
        replay = dict(existing)
        replay["replayed"] = True
        return replay
    recovery = ledger.begin(record_id)
    record = evaluate(case, allow_synthetic=allow_synthetic, wall_clock=wall_clock)
    if record.get("record_id") != record_id:  # evaluator and ledger must agree on identity
        raise RuntimeError("record identity mismatch")
    ledger.commit(record)
    out = dict(record)
    out["replayed"] = False
    out["recovered_after_interruption"] = recovery == "recovered"
    return out
