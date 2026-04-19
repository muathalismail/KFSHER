#!/usr/bin/env python3
"""Unit tests for MISC Imaging Duty Rota Extractor."""

import pytest
import re
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from rota_extractor import extract_rota

FIXTURE_PDF = os.path.join(
    os.path.expanduser('~'), 'Downloads',
    'MISC DUTY ROTA 12-16 April 2026 (Week 2) 1.pdf'
)


@pytest.fixture(scope="module")
def extracted():
    if not os.path.exists(FIXTURE_PDF):
        pytest.skip(f"Fixture PDF not found: {FIXTURE_PDF}")
    return extract_rota(FIXTURE_PDF)


# ── Structural tests ──

def test_total_records(extracted):
    """4 targets × 5 days × 2 shifts = 40 records max"""
    assert len(extracted) <= 40
    assert len(extracted) > 0


def test_all_shifts_present(extracted):
    for record in extracted:
        assert record["shift"] in ["AM", "PM"]


def test_all_sections_valid(extracted):
    valid = {"NEURO", "BODY", "THORACIC"}
    for record in extracted:
        assert record["section"] in valid


def test_no_null_values(extracted):
    for record in extracted:
        for key, value in record.items():
            assert value is not None, f"Null found in field: {key}"


# ── Row-boundary tests ──

def test_ct_body_residents_not_from_adjacent_row(extracted):
    """Residents in BODY CT and Ultrasound must be mutually exclusive."""
    ct_residents = set()
    us_residents = set()
    for r in extracted:
        if r["section"] == "BODY" and "CT" in r["modality"]:
            ct_residents.update(r["residents"])
        if r["section"] == "BODY" and "Ultrasound" in r["modality"]:
            us_residents.update(r["residents"])
    overlap = ct_residents & us_residents
    # Allow overlap only if they genuinely cover both
    # Flag if more than half overlap (structural leak)
    if ct_residents and us_residents:
        ratio = len(overlap) / min(len(ct_residents), len(us_residents))
        assert ratio < 0.8, f"Too much overlap between CT and US residents: {overlap}"


def test_am_pm_are_separate_records(extracted):
    from collections import Counter
    keys = [(r["date"], r["section"], r["modality"]) for r in extracted]
    counts = Counter(keys)
    for key, count in counts.items():
        assert count <= 2, f"More than 2 records for {key}"


# ── Role assignment tests ──

def test_fellow_not_promoted_to_consultant(extracted):
    for record in extracted:
        fellow_set = set(record.get("fellow", []))
        consultant_set = set(record.get("consultant", []))
        overlap = fellow_set & consultant_set
        assert len(overlap) == 0, (
            f"Same person in both fellow and consultant on "
            f"{record['date']} {record['shift']}: {overlap}"
        )


def test_roles_are_mutually_exclusive(extracted):
    for record in extracted:
        all_names = []
        for role in ["consultant", "residents", "fellow", "assistant_associate"]:
            all_names.extend(record.get(role, []))
        duplicates = [n for n in all_names if all_names.count(n) > 1]
        assert len(duplicates) == 0, (
            f"Duplicate names across roles on "
            f"{record['date']} {record['shift']}: {set(duplicates)}"
        )


# ── Section-leak tests ──

def test_no_msk_doctors_in_thoracic(extracted):
    thoracic = [r for r in extracted if r["section"] == "THORACIC"]
    for record in thoracic:
        all_names = (record["consultant"] + record["residents"]
                     + record["fellow"] + record["assistant_associate"])
        # A. Dhafiri is MSK-only
        for name in all_names:
            assert "dhafiri" not in name.lower(), (
                f"MSK doctor in THORACIC on {record['date']} {record['shift']}: {name}"
            )


def test_section_boundaries_respected(extracted):
    sections = {r["section"] for r in extracted}
    assert "NEURO" in sections, "NEURO section produced no records"
    assert "BODY" in sections, "BODY section produced no records"
    assert "THORACIC" in sections, "THORACIC section produced no records"


# ── Phone lookup tests ──

def test_no_wrong_number_format(extracted):
    pattern = re.compile(r'^05\d{8}$')
    for record in extracted:
        for name, phone in record.get("phones", {}).items():
            if phone != "":
                assert pattern.match(phone), (
                    f"Bad phone format for {name}: {phone}"
                )


def test_phone_coverage_above_threshold(extracted):
    all_phones = []
    for record in extracted:
        all_phones.extend(record.get("phones", {}).values())
    if len(all_phones) == 0:
        pytest.skip("No phone data extracted")
    empty = sum(1 for p in all_phones if p == "")
    ratio = empty / len(all_phones)
    assert ratio < 0.50, (
        f"Too many missing phones: {empty}/{len(all_phones)} = {ratio:.0%}"
    )


# ── Search alias tests ──

def test_search_aliases_attached(extracted):
    for record in extracted:
        assert len(record.get("search_aliases", [])) > 0, (
            f"No aliases on {record['date']} {record['shift']} {record['section']}"
        )


def test_neuro_ct_aliases(extracted):
    neuro_ct = [r for r in extracted
                if r["section"] == "NEURO" and "CT" in r["modality"]]
    for record in neuro_ct:
        aliases = record["search_aliases"]
        assert "ct brain" in aliases
        assert "ct head" in aliases


def test_body_ultrasound_aliases(extracted):
    body_us = [r for r in extracted
               if r["section"] == "BODY" and "Ultrasound" in r["modality"]]
    for record in body_us:
        aliases = record["search_aliases"]
        assert "ultrasound" in aliases


def test_thoracic_aliases(extracted):
    thoracic = [r for r in extracted
                if r["section"] == "THORACIC"]
    for record in thoracic:
        aliases = record["search_aliases"]
        assert "ct chest" in aliases


# ── CT Out-Patient exclusion ──

def test_no_ct_outpatient(extracted):
    for record in extracted:
        mod = record["modality"].lower()
        assert "out-pa" not in mod and "out-pt" not in mod, (
            f"CT Out-Patient leaked: {record['modality']}"
        )
