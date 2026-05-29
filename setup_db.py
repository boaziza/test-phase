#!/usr/bin/env python3
"""
setup_db.py — Rapport Pompiste multi-tenant database provisioner.

Execution order (Appwrite constraint — do not reorder):
  1. Create all collections   (skip if already exist)
  2. Create all plain attributes + wait inline for each (skip if already exist)
  3. Create relationship attributes + wait inline
  4. Create all indexes  (skip if already exist)

Delete behaviour (enforced in Express backend, not at DB level except where noted):
  - Company delete    → RESTRICT until all stations deleted (enforced by native relationship)
  - Station delete    → backend refuses if any situation/dailyReports/payments rows exist;
                        archive the station instead of deleting
  - User delete       → set active=false, archived=true on users row;
                        never delete operational rows — employeeName is preserved as string history
  - Operational data  → never hard-delete; set archived=true instead

Usage:
    python setup_db.py            # provision database
    python setup_db.py --dry-run  # print planned operations without calling the API

Requirements:
    pip install appwrite python-dotenv
"""

import argparse
import os
import sys
import time

from dotenv import load_dotenv
from appwrite.client import Client
from appwrite.services.databases import Databases
from appwrite.id import ID
from appwrite.exception import AppwriteException


# ── CLI ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Provision Rapport Pompiste Appwrite database.")
parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Print planned operations without calling the API.",
)
args = parser.parse_args()
DRY_RUN: bool = args.dry_run

if DRY_RUN:
    print("=== DRY RUN — no API calls will be made ===\n")


# ── ENV ───────────────────────────────────────────────────────────────────────
load_dotenv()

ENDPOINT   = os.getenv("APPWRITE_ENDPOINT", "https://fra.cloud.appwrite.io/v1")
PROJECT_ID = os.getenv("APPWRITE_PROJECT_ID", "")
API_KEY    = os.getenv("APPWRITE_API_KEY", "")
DB         = os.getenv("APPWRITE_DATABASE_ID", "")

if not PROJECT_ID:
    sys.exit("ERROR: APPWRITE_PROJECT_ID missing from .env")
if not API_KEY:
    sys.exit("ERROR: APPWRITE_API_KEY missing from .env")
if not DB:
    sys.exit("ERROR: APPWRITE_DATABASE_ID missing from .env")


# ── APPWRITE CLIENT ───────────────────────────────────────────────────────────
client = (
    Client()
    .set_endpoint(ENDPOINT)
    .set_project(PROJECT_ID)
    .set_key(API_KEY)
)
databases = Databases(client)


# ── STATE ─────────────────────────────────────────────────────────────────────
COL: dict = {}  # logical key → Appwrite collection $id; populated during step 1

_created = {"collections": 0, "attributes": 0, "relationships": 0, "indexes": 0}
_skipped = {"collections": 0, "attributes": 0, "relationships": 0, "indexes": 0}
_errors:  list = []


# ── HELPERS ───────────────────────────────────────────────────────────────────

def _is_conflict(e: AppwriteException) -> bool:
    return getattr(e, "code", None) == 409


def _is_not_found(e: AppwriteException) -> bool:
    return getattr(e, "code", None) == 404


def _log_error(context: str, e: AppwriteException) -> None:
    msg = f"{context}: {e.message}"
    print(f"  ✗ {msg}")
    _errors.append(msg)


def _load_existing_collections() -> dict:
    """Return name → id map for every collection already in the database."""
    if DRY_RUN:
        return {}
    existing = {}
    try:
        listing = databases.list_collections(DB)
        for col in listing.collections:
            existing[col.name] = col.id
    except AppwriteException as e:
        print(f"  ! Warning: could not pre-load existing collections: {e.message}")
    return existing


def wait_for_attribute(col_id: str, key: str, timeout: int = 60, initial_sleep: float = 2.0) -> bool:
    """Poll until the attribute status is 'available'. Returns False on timeout/failure.

    initial_sleep: seconds to wait before the first poll — Appwrite needs a moment
    to register a newly created attribute as 'processing'.  Pass 0 when retrying
    an attribute that was already created in a previous run.
    """
    if DRY_RUN:
        return True
    if initial_sleep > 0:
        time.sleep(initial_sleep)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            attr = databases.get_attribute(DB, col_id, key)
            status = getattr(attr, "status", "")
            if status == "available":
                return True
            if status == "failed":
                msg = (
                    f"Attribute '{key}' on {col_id} status=failed: "
                    f"{getattr(attr, 'error', 'unknown')}"
                )
                print(f"  ✗ {msg}")
                _errors.append(msg)
                return False
        except AppwriteException:
            pass  # transient — retry
        time.sleep(1.0)

    msg = f"Timeout: attribute '{key}' on {col_id} never became 'available' after {timeout}s"
    print(f"  ✗ {msg}")
    _errors.append(msg)
    return False


def _attr_exists(col_id: str, key: str) -> bool:
    """Return True only when the attribute exists AND its status is 'available'.

    Returning False for 'processing' / 'failed' attributes lets the add_* helpers
    attempt a create call, hit a 409, and then poll until the attribute is done —
    so a previous run that timed out is automatically retried on the next run.
    """
    try:
        attr = databases.get_attribute(DB, col_id, key)
        return getattr(attr, "status", "") == "available"
    except AppwriteException as e:
        if _is_not_found(e):
            return False
        print(f"  ! Warning checking attribute '{key}': {e.message}")
        return False


def make_collection(name: str, col_key: str, existing: dict) -> None:
    if DRY_RUN:
        COL[col_key] = f"dry_{col_key}"
        print(f"  [dry-run] CREATE COLLECTION  '{name}'")
        _created["collections"] += 1
        return

    if name in existing:
        col_id = existing[name]
        print(f"  ~ '{name}' already exists  →  {col_id}")
        _skipped["collections"] += 1
        COL[col_key] = col_id
        return

    try:
        result = databases.create_collection(DB, ID.unique(), name, permissions=[])
        col_id = result.id
        print(f"  + {name}  →  {col_id}")
        _created["collections"] += 1
        COL[col_key] = col_id
    except AppwriteException as e:
        if _is_conflict(e):
            # Race condition between pre-check and create
            try:
                listing = databases.list_collections(DB)
                for col in listing.collections:
                    if col.name == name:
                        print(f"  ~ '{name}' already exists (race)  →  {col.id}")
                        _skipped["collections"] += 1
                        COL[col_key] = col.id
                        return
            except AppwriteException as e2:
                _log_error(f"lookup existing collection '{name}'", e2)
            print(f"  ! '{name}' conflict but not found in listing — skipping")
        else:
            _log_error(f"create collection '{name}'", e)


def add_str(col_key: str, key: str, size: int, required: bool, default=None) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        return
    if DRY_RUN:
        print(f"    [dry-run]  str    '{key}'  size={size}  req={required}  default={default!r}")
        _created["attributes"] += 1
        return
    if _attr_exists(col_id, key):
        print(f"    ~ str   '{key}' already exists")
        _skipped["attributes"] += 1
        return
    try:
        databases.create_string_attribute(DB, col_id, key, size, required, default=default)
        print(f"    + str   '{key}'")
        _created["attributes"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"    ~ str   '{key}' exists — polling for availability")
            _skipped["attributes"] += 1
            wait_for_attribute(col_id, key, initial_sleep=0)
        else:
            _log_error(f"str attr '{key}' on '{col_key}'", e)


def add_int(col_key: str, key: str, required: bool, default=None) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        return
    if DRY_RUN:
        print(f"    [dry-run]  int    '{key}'  req={required}  default={default!r}")
        _created["attributes"] += 1
        return
    if _attr_exists(col_id, key):
        print(f"    ~ int   '{key}' already exists")
        _skipped["attributes"] += 1
        return
    try:
        databases.create_integer_attribute(DB, col_id, key, required, default=default)
        print(f"    + int   '{key}'")
        _created["attributes"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"    ~ int   '{key}' exists — polling for availability")
            _skipped["attributes"] += 1
            wait_for_attribute(col_id, key, initial_sleep=0)
        else:
            _log_error(f"int attr '{key}' on '{col_key}'", e)


def add_float(col_key: str, key: str, required: bool, default=None) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        return
    if DRY_RUN:
        print(f"    [dry-run]  float  '{key}'  req={required}  default={default!r}")
        _created["attributes"] += 1
        return
    if _attr_exists(col_id, key):
        print(f"    ~ flt   '{key}' already exists")
        _skipped["attributes"] += 1
        return
    try:
        databases.create_float_attribute(DB, col_id, key, required, default=default)
        print(f"    + flt   '{key}'")
        _created["attributes"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"    ~ flt   '{key}' exists — polling for availability")
            _skipped["attributes"] += 1
            wait_for_attribute(col_id, key, initial_sleep=0)
        else:
            _log_error(f"float attr '{key}' on '{col_key}'", e)


def add_bool(col_key: str, key: str, required: bool, default=None) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        return
    if DRY_RUN:
        print(f"    [dry-run]  bool   '{key}'  req={required}  default={default!r}")
        _created["attributes"] += 1
        return
    if _attr_exists(col_id, key):
        print(f"    ~ bool  '{key}' already exists")
        _skipped["attributes"] += 1
        return
    try:
        databases.create_boolean_attribute(DB, col_id, key, required, default=default)
        print(f"    + bool  '{key}'")
        _created["attributes"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"    ~ bool  '{key}' exists — polling for availability")
            _skipped["attributes"] += 1
            wait_for_attribute(col_id, key, initial_sleep=0)
        else:
            _log_error(f"bool attr '{key}' on '{col_key}'", e)


def add_enum(col_key: str, key: str, elements: list, required: bool, default=None) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        return
    if DRY_RUN:
        print(f"    [dry-run]  enum   '{key}'  elements={elements}  req={required}  default={default!r}")
        _created["attributes"] += 1
        return
    if _attr_exists(col_id, key):
        print(f"    ~ enum  '{key}' already exists")
        _skipped["attributes"] += 1
        return
    try:
        databases.create_enum_attribute(DB, col_id, key, elements, required, default=default)
        print(f"    + enum  '{key}'  {elements}")
        _created["attributes"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"    ~ enum  '{key}' exists — polling for availability")
            _skipped["attributes"] += 1
            wait_for_attribute(col_id, key, initial_sleep=0)
        else:
            _log_error(f"enum attr '{key}' on '{col_key}'", e)


def add_relationship(
    col_key: str,
    related_col_key: str,
    rel_type: str,
    key: str,
    on_delete: str,
) -> None:
    col_id         = COL.get(col_key)
    related_col_id = COL.get(related_col_key)

    if col_id is None or related_col_id is None:
        msg = (
            f"Skipping relationship '{key}': missing collection ID(s) "
            f"(col={col_key}, related={related_col_key})"
        )
        print(f"  ! {msg}")
        _errors.append(msg)
        return

    if DRY_RUN:
        print(
            f"  [dry-run] RELATIONSHIP '{key}' on '{col_key}' → '{related_col_key}'"
            f"  ({rel_type}, onDelete={on_delete})"
        )
        _created["relationships"] += 1
        return

    if _attr_exists(col_id, key):
        print(f"  ~ relationship '{key}' already exists")
        _skipped["relationships"] += 1
        return

    try:
        databases.create_relationship_attribute(
            DB,
            col_id,
            related_col_id,
            type=rel_type,
            two_way=False,
            key=key,
            on_delete=on_delete,
        )
        print(
            f"  + relationship '{key}'  {col_key} → {related_col_key}"
            f"  ({rel_type}, onDelete={on_delete})"
        )
        _created["relationships"] += 1
        wait_for_attribute(col_id, key)
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"  ~ relationship '{key}' already exists")
            _skipped["relationships"] += 1
        else:
            _log_error(f"relationship '{key}' on '{col_key}'", e)


def add_index(col_key: str, idx_key: str, idx_type: str, attributes: list) -> None:
    col_id = COL.get(col_key)
    if col_id is None:
        print(f"  ! Skipping index '{idx_key}': collection '{col_key}' not found")
        return

    if DRY_RUN:
        print(f"  [dry-run] INDEX '{idx_key}' ({idx_type}) on {attributes}")
        _created["indexes"] += 1
        return

    try:
        databases.get_index(DB, col_id, idx_key)
        print(f"  ~ index '{idx_key}' already exists")
        _skipped["indexes"] += 1
        return
    except AppwriteException as e:
        if not _is_not_found(e):
            _log_error(f"check index '{idx_key}' on '{col_key}'", e)
            return

    orders = ["ASC"] * len(attributes)
    try:
        databases.create_index(DB, col_id, idx_key, idx_type, attributes, orders)
        print(f"  + index '{idx_key}'  ({idx_type})  {attributes}")
        _created["indexes"] += 1
    except AppwriteException as e:
        if _is_conflict(e):
            print(f"  ~ index '{idx_key}' already exists")
            _skipped["indexes"] += 1
        else:
            _log_error(f"index '{idx_key}' on '{col_key}'", e)


SHIFTS = ["Morning", "Afternoon", "Evening", "Night"]


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — CREATE ALL COLLECTIONS
# ═══════════════════════════════════════════════════════════════════════════════
print("\n══ STEP 1: Collections ══════════════════════════════════════════════\n")

_existing = _load_existing_collections()

make_collection("companies",        "companies",        _existing)
make_collection("stations",         "stations",         _existing)
make_collection("fuelPriceHistory", "fuelPriceHistory", _existing)
make_collection("users",            "users",            _existing)
make_collection("stationManagers",  "stationManagers",  _existing)
make_collection("customers",        "customers",        _existing)
make_collection("situation",        "situation",        _existing)
make_collection("dailyReports",     "dailyReports",     _existing)
make_collection("payments",         "payments",         _existing)
make_collection("fiche",            "fiche",            _existing)
make_collection("loans",            "loans",            _existing)
make_collection("stockDaily",       "stockDaily",       _existing)
make_collection("stock",            "stock",            _existing)
make_collection("gainPompiste",     "gainPompiste",     _existing)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — CREATE ALL PLAIN ATTRIBUTES  (each polled inline before moving on)
# ═══════════════════════════════════════════════════════════════════════════════
print("\n══ STEP 2: Attributes ═══════════════════════════════════════════════\n")

# ── companies ─────────────────────────────────────────────────────────────────
print("companies:")
add_str ("companies", "name",     200, True)
add_str ("companies", "ownerId",  100, True)
add_bool("companies", "archived",      False, False)   # Fix 2: required=False when default set

# ── stations ──────────────────────────────────────────────────────────────────
print("stations:")
add_str  ("stations", "name",    200, True)
add_str  ("stations", "address", 300, False)
add_float("stations", "momoFee",      False, 0.5)      # Fix 2: required=False when default set
add_bool ("stations", "archived",     False, False)    # Fix 2

# ── fuelPriceHistory ──────────────────────────────────────────────────────────
print("fuelPriceHistory:")
add_str ("fuelPriceHistory", "stationId",     100, True)
add_enum("fuelPriceHistory", "fuelType",      ["PMS", "AGO"], True)
add_int ("fuelPriceHistory", "price",              True)
add_str ("fuelPriceHistory", "effectiveFrom",   10, True)
add_str ("fuelPriceHistory", "effectiveTo",     10, False)   # null = currently active
add_str ("fuelPriceHistory", "setByUserId",    100, True)

# ── users ─────────────────────────────────────────────────────────────────────
print("users:")
add_str ("users", "userId",             100, True)
add_str ("users", "companyId",          100, True)
add_str ("users", "stationId",          100, False)          # null for owners
add_enum("users", "role",               ["owner", "manager", "pompiste"], True)
add_str ("users", "name",               200, True)
add_str ("users", "email",              200, True)
add_bool("users", "mustChangePassword",      False, False)   # Fix 2
add_bool("users", "active",                  False, True)    # Fix 2
add_str ("users", "createdBy",          100, False)

# ── stationManagers ───────────────────────────────────────────────────────────
print("stationManagers:")
add_str("stationManagers", "stationId",  100, True)
add_str("stationManagers", "userId",     100, True)
add_str("stationManagers", "companyId",  100, True)
add_str("stationManagers", "assignedAt",  30, True)
add_str("stationManagers", "assignedBy", 100, True)

# ── customers ─────────────────────────────────────────────────────────────────
print("customers:")
add_str ("customers", "companyId",     100, True)
add_str ("customers", "stationId",     100, False)
add_str ("customers", "name",          200, True)
add_str ("customers", "contactPerson", 200, False)
add_str ("customers", "phone",          30, False)
add_str ("customers", "email",         200, False)
add_str ("customers", "tin",            20, False)
add_int ("customers", "creditLimit",        False, 0)
add_str ("customers", "notes",        1000, False)
add_bool("customers", "active",             False, True)     # Fix 2
add_bool("customers", "archived",           False, False)    # Fix 2
add_str ("customers", "createdBy",     100, True)

# ── situation ─────────────────────────────────────────────────────────────────
print("situation:")
add_str  ("situation", "companyId",       100, True)
add_str  ("situation", "stationId",       100, True)
add_str  ("situation", "email",           200, True)
add_str  ("situation", "employeeName",    200, True)
add_str  ("situation", "logDate",          10, True)
add_str  ("situation", "situationKey",    120, True)
add_int  ("situation", "pmsPrice",             True)
add_int  ("situation", "agoPrice",             True)
add_int  ("situation", "totalPms",             False, 0)     # Fix 2
add_int  ("situation", "totalAgo",             False, 0)     # Fix 2
add_int  ("situation", "totalVente",           False, 0)     # Fix 2
add_float("situation", "venteLitresPms",       False, 0)     # Fix 2
add_float("situation", "venteLitresAgo",       False, 0)     # Fix 2
add_float("situation", "pms1",                 False, 0)     # Fix 2
add_float("situation", "pms2",                 False, 0)     # Fix 2
add_float("situation", "pms3",                 False, 0)     # Fix 2
add_float("situation", "pms4",                 False, 0)     # Fix 2
add_float("situation", "ago1",                 False, 0)     # Fix 2
add_float("situation", "ago2",                 False, 0)     # Fix 2
add_float("situation", "ago3",                 False, 0)     # Fix 2
add_float("situation", "ago4",                 False, 0)     # Fix 2
add_int  ("situation", "momo",                 False, 0)     # Fix 2
add_int  ("situation", "momoLoss",             False, 0)     # Fix 2
add_int  ("situation", "totalFiche",           False, 0)     # Fix 2
add_int  ("situation", "bankCard",             False, 0)     # Fix 2
add_int  ("situation", "totalCash",            False, 0)     # Fix 2
add_int  ("situation", "totalPayments",        False, 0)     # Fix 2
add_int  ("situation", "gainPayments",         False, 0)     # Fix 2
add_int  ("situation", "spFuelCard",           False, 0)     # Fix 2
add_int  ("situation", "totalLoans",           False, 0)     # Fix 2
add_int  ("situation", "bon",                  False, 0)     # Fix 2
add_bool ("situation", "done",                 False, False)  # Fix 2
add_bool ("situation", "archived",             False, False)  # Fix 2

# ── dailyReports ──────────────────────────────────────────────────────────────
print("dailyReports:")
add_str  ("dailyReports", "companyId",       100, True)
add_str  ("dailyReports", "stationId",       100, True)
add_str  ("dailyReports", "email",           200, True)
add_str  ("dailyReports", "employeeName",    200, True)
add_enum ("dailyReports", "shift",           SHIFTS, True)
add_str  ("dailyReports", "logDate",          10, True)
add_str  ("dailyReports", "shiftKey",        150, True)
add_int  ("dailyReports", "pmsPrice",             True)
add_int  ("dailyReports", "agoPrice",             True)
add_int  ("dailyReports", "totalPms",             False, 0)  # Fix 2
add_int  ("dailyReports", "totalAgo",             False, 0)  # Fix 2
add_int  ("dailyReports", "totalVente",           False, 0)  # Fix 2
add_float("dailyReports", "venteLitresPms",       False, 0)  # Fix 2
add_float("dailyReports", "venteLitresAgo",       False, 0)  # Fix 2
add_float("dailyReports", "pms1",                 False, 0)  # Fix 2
add_float("dailyReports", "pms2",                 False, 0)  # Fix 2
add_float("dailyReports", "pms3",                 False, 0)  # Fix 2
add_float("dailyReports", "pms4",                 False, 0)  # Fix 2
add_float("dailyReports", "ago1",                 False, 0)  # Fix 2
add_float("dailyReports", "ago2",                 False, 0)  # Fix 2
add_float("dailyReports", "ago3",                 False, 0)  # Fix 2
add_float("dailyReports", "ago4",                 False, 0)  # Fix 2
add_bool ("dailyReports", "archived",             False, False)  # Fix 2

# ── payments ──────────────────────────────────────────────────────────────────
print("payments:")
add_str ("payments", "companyId",       100, True)
add_str ("payments", "stationId",       100, True)
add_str ("payments", "email",           200, True)
add_str ("payments", "employeeName",    200, True)
add_enum("payments", "shift",           SHIFTS, True)
add_str ("payments", "logDate",          10, True)
add_str ("payments", "shiftKey",        150, True)
add_int ("payments", "momo",                 False, 0)       # Fix 2
add_int ("payments", "momoLoss",             False, 0)       # Fix 2
add_int ("payments", "bankCard",             False, 0)       # Fix 2
add_int ("payments", "totalCash",            False, 0)       # Fix 2
add_int ("payments", "cash5000",             False, 0)
add_int ("payments", "cash2000",             False, 0)
add_int ("payments", "cash1000",             False, 0)
add_int ("payments", "cash500",              False, 0)
add_int ("payments", "totalFiche",           False, 0)       # Fix 2
add_int ("payments", "spFuelCard",           False, 0)       # Fix 2
add_int ("payments", "totalPayments",        False, 0)       # Fix 2
add_int ("payments", "gainPayments",         False, 0)       # Fix 2
add_int ("payments", "totalLoans",           False, 0)       # Fix 2
add_int ("payments", "bon",                  False, 0)       # Fix 2
add_int ("payments", "totalVente",           False, 0)       # Fix 2
add_bool("payments", "archived",             False, False)   # Fix 2

# ── fiche ─────────────────────────────────────────────────────────────────────
print("fiche:")
add_str ("fiche", "companyId",    100, True)
add_str ("fiche", "stationId",    100, True)
add_str ("fiche", "email",        200, True)
add_str ("fiche", "employeeName", 200, True)
add_enum("fiche", "shift",        SHIFTS, True)
add_str ("fiche", "logDate",       10, True)
add_str ("fiche", "shiftKey",     150, True)
add_str ("fiche", "plate",         50, True)
add_int ("fiche", "amount",            True)
add_str ("fiche", "customerId",   100, False)
add_str ("fiche", "customerName", 200, True)
add_bool("fiche", "archived",          False, False)         # Fix 2

# ── loans ─────────────────────────────────────────────────────────────────────
print("loans:")
add_str ("loans", "companyId",    100, True)
add_str ("loans", "stationId",    100, True)
add_str ("loans", "email",        200, True)
add_str ("loans", "employeeName", 200, True)
add_enum("loans", "shift",        SHIFTS, True)
add_str ("loans", "logDate",       10, True)
add_str ("loans", "monthYear",      7, True)
add_str ("loans", "shiftKey",     150, True)
add_str ("loans", "plate",         50, True)
add_int ("loans", "amount",            True)
add_str ("loans", "customerId",   100, False)
add_str ("loans", "customerName", 200, True)
add_bool("loans", "archived",          False, False)         # Fix 2

# ── stockDaily ────────────────────────────────────────────────────────────────
print("stockDaily:")
add_str  ("stockDaily", "companyId",     100, True)
add_str  ("stockDaily", "stationId",     100, True)
add_str  ("stockDaily", "email",         200, True)
add_str  ("stockDaily", "employeeName",  200, True)
add_enum ("stockDaily", "fuelType",      ["PMS", "AGO"], True)
add_str  ("stockDaily", "logDate",        10, True)
add_str  ("stockDaily", "situationKey",  120, True)
add_str  ("stockDaily", "stockKey",      150, True)
add_int  ("stockDaily", "initialStock",       False, 0)      # Fix 2
add_float("stockDaily", "venteLitres",        False, 0)      # Fix 2
add_int  ("stockDaily", "receivedLitres",     False, 0)      # Fix 2
add_int  ("stockDaily", "physicalStock",      False, 0)      # Fix 2
add_int  ("stockDaily", "theoryStock",        False, 0)      # Fix 2
add_int  ("stockDaily", "gainFuel",           False, 0)      # Fix 2
add_bool ("stockDaily", "archived",           False, False)  # Fix 2

# ── stock ─────────────────────────────────────────────────────────────────────
print("stock:")
add_str ("stock", "companyId",              100, True)
add_str ("stock", "stationId",              100, True)
add_str ("stock", "monthYear",                7, True)
add_str ("stock", "stockKey",               110, True)
add_int ("stock", "totalGainFuelPms",            False, 0)   # Fix 2
add_int ("stock", "totalGainFuelAgo",            False, 0)   # Fix 2
add_int ("stock", "totalVenteLitresPms",         False, 0)   # Fix 2
add_int ("stock", "totalVenteLitresAgo",         False, 0)   # Fix 2
add_int ("stock", "totalReceivedPms",            False, 0)
add_int ("stock", "totalReceivedAgo",            False, 0)
add_bool("stock", "archived",                    False, False)  # Fix 2

# ── gainPompiste ──────────────────────────────────────────────────────────────
print("gainPompiste:")
add_str ("gainPompiste", "companyId",     100, True)
add_str ("gainPompiste", "stationId",     100, True)
add_str ("gainPompiste", "userId",        100, True)
add_str ("gainPompiste", "email",         200, True)
add_str ("gainPompiste", "employeeName",  200, True)
add_str ("gainPompiste", "monthYear",       7, True)
add_str ("gainPompiste", "logDate",        10, True)
add_str ("gainPompiste", "gainKey",       150, True)
add_int ("gainPompiste", "gainPayments",       False, 0)     # Fix 2
add_bool("gainPompiste", "archived",           False, False) # Fix 2


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — RELATIONSHIPS
# (attributes were polled inline in Step 2 — no batch wait needed here)
# ═══════════════════════════════════════════════════════════════════════════════
print("\n══ STEP 3: Relationships ════════════════════════════════════════════\n")

# stations.company → companies  (many stations belong to one company)
# on-parent-delete: restrict — you must delete all stations before deleting a company.
add_relationship("stations", "companies", "manyToOne", "company", "restrict")


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — INDEXES
# ═══════════════════════════════════════════════════════════════════════════════
print("\n══ STEP 4: Indexes ══════════════════════════════════════════════════\n")

print("companies:")
add_index("companies", "idx_ownerId", "key", ["ownerId"])

print("stations:")
add_index("stations", "idx_archived", "key", ["archived"])

print("fuelPriceHistory:")
add_index("fuelPriceHistory", "idx_station_fuel_active", "key", ["stationId", "fuelType", "effectiveTo"])
add_index("fuelPriceHistory", "idx_station_date",        "key", ["stationId", "effectiveFrom"])

print("users:")
add_index("users", "idx_userId",         "unique", ["userId"])
add_index("users", "idx_email",          "key",    ["email"])
add_index("users", "idx_company_role",   "key",    ["companyId", "role"])
add_index("users", "idx_station_active", "key",    ["stationId", "active"])

print("stationManagers:")
add_index("stationManagers", "idx_station_user", "unique", ["stationId", "userId"])
add_index("stationManagers", "idx_userId",       "key",    ["userId"])
add_index("stationManagers", "idx_stationId",    "key",    ["stationId"])

print("customers:")
add_index("customers", "idx_company_name",   "key",      ["companyId", "name"])
add_index("customers", "idx_company_active", "key",      ["companyId", "active"])
add_index("customers", "idx_name",           "fulltext",  ["name"])

print("situation:")
add_index("situation", "idx_situationKey", "unique", ["situationKey"])
add_index("situation", "idx_station_date", "key",    ["stationId", "logDate"])
add_index("situation", "idx_company_date", "key",    ["companyId", "logDate"])
add_index("situation", "idx_archived",     "key",    ["archived"])

print("dailyReports:")
add_index("dailyReports", "idx_shiftKey",     "unique", ["shiftKey"])
add_index("dailyReports", "idx_station_date", "key",    ["stationId", "logDate"])
add_index("dailyReports", "idx_email_date",   "key",    ["email", "logDate"])
add_index("dailyReports", "idx_archived",     "key",    ["archived"])

print("payments:")
add_index("payments", "idx_shiftKey",     "unique", ["shiftKey"])
add_index("payments", "idx_station_date", "key",    ["stationId", "logDate"])
add_index("payments", "idx_email_date",   "key",    ["email", "logDate"])
add_index("payments", "idx_archived",     "key",    ["archived"])

print("fiche:")
add_index("fiche", "idx_shiftKey",      "key", ["shiftKey"])
add_index("fiche", "idx_station_date",  "key", ["stationId", "logDate"])
add_index("fiche", "idx_plate",         "key", ["plate"])
add_index("fiche", "idx_customer_date", "key", ["customerId", "logDate"])

print("loans:")
add_index("loans", "idx_shiftKey",       "key", ["shiftKey"])
add_index("loans", "idx_station_date",   "key", ["stationId", "logDate"])
add_index("loans", "idx_station_month",  "key", ["stationId", "monthYear"])
add_index("loans", "idx_plate",          "key", ["plate"])
add_index("loans", "idx_customer_month", "key", ["customerId", "monthYear"])

print("stockDaily:")
add_index("stockDaily", "idx_stockKey",          "unique", ["stockKey"])
add_index("stockDaily", "idx_situationKey",      "key",    ["situationKey"])
add_index("stockDaily", "idx_station_date_fuel", "key",    ["stationId", "logDate", "fuelType"])

print("stock:")
add_index("stock", "idx_stockKey",      "unique", ["stockKey"])
add_index("stock", "idx_station_month", "key",    ["stationId", "monthYear"])

print("gainPompiste:")
add_index("gainPompiste", "idx_gainKey",       "unique", ["gainKey"])
add_index("gainPompiste", "idx_user_month",    "key",    ["userId", "monthYear"])
add_index("gainPompiste", "idx_station_month", "key",    ["stationId", "monthYear"])


# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "═" * 70)
print("SUMMARY")
print("═" * 70)
print(f"  Collections   : {_created['collections']} created,  {_skipped['collections']} skipped")
print(f"  Attributes    : {_created['attributes']} created,  {_skipped['attributes']} skipped")
print(f"  Relationships : {_created['relationships']} created,  {_skipped['relationships']} skipped")
print(f"  Indexes       : {_created['indexes']} created,  {_skipped['indexes']} skipped")

if _errors:
    print(f"\n  ✗ {len(_errors)} ERROR(s) — fix these before re-running:")
    for err in _errors:
        print(f"    - {err}")
    sys.exit(1)
else:
    print("\n  ✓ No errors.")

# ── Print .env block ──────────────────────────────────────────────────────────
if not DRY_RUN and COL:
    env_keys = {
        "companies":        "APPWRITE_COMPANIES_ID",
        "stations":         "APPWRITE_STATIONS_ID",
        "fuelPriceHistory": "APPWRITE_FUEL_PRICE_HISTORY_ID",
        "users":            "APPWRITE_USERS_ID",
        "stationManagers":  "APPWRITE_STATION_MANAGERS_ID",
        "customers":        "APPWRITE_CUSTOMERS_ID",
        "situation":        "APPWRITE_SITUATION_ID",
        "dailyReports":     "APPWRITE_DAILY_REPORTS_ID",
        "payments":         "APPWRITE_PAYMENTS_ID",
        "fiche":            "APPWRITE_FICHE_ID",
        "loans":            "APPWRITE_LOANS_ID",
        "stockDaily":       "APPWRITE_STOCK_DAILY_ID",
        "stock":            "APPWRITE_STOCK_ID",
        "gainPompiste":     "APPWRITE_GAIN_POMPISTE_ID",
    }
    print("\n" + "═" * 70)
    print("Paste these into your .env:")
    print("═" * 70)
    for col_key, env_key in env_keys.items():
        print(f"{env_key}={COL.get(col_key, '')}")
    print("═" * 70)
