#!/usr/bin/env python3
"""Extract the Easy Commercial certificate source sheets from the legacy XLSB."""

import argparse
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
from pathlib import Path

from pyxlsb import open_workbook


CUSTOMERS = "تكويد العملاء"
PROJECTS = "تكويد المشاريع"
CERTIFICATES = "ادخال المستخلصات"
RECEIPTS = "ادخال التحصيلات"
HEADERS = {
    CUSTOMERS: {1: "اسم العميل", 4: "كود العميل", 5: "العميل"},
    PROJECTS: {2: "اسم المشروع", 10: "كود المشروع", 11: "كود العميل"},
    CERTIFICATES: {3: "رقم المستخلص", 8: "بند الاعمال", 16: "الإجمالي", 17: "كود المشروع"},
    RECEIPTS: {6: "بيانات التحصيل", 7: "قيمة التحصيل", 11: "كود المشروع"},
}


def sheet_rows(workbook, name):
    with workbook.get_sheet(name) as sheet:
        rows = iter(sheet.rows(sparse=True))
        header = {cell.c + 1: cell.v for cell in next(rows)}
        if any(header.get(index) != label for index, label in HEADERS[name].items()):
            raise ValueError(f"Unexpected columns in {name}")
        for row in rows:
            values = {cell.c + 1: cell.v for cell in row if cell.v is not None and cell.v != ""}
            if values:
                yield row[0].r + 1, values


def source(name, row, values):
    return {"sheet": name, "row": row, "cells": values}


def numeric(value):
    if value is None:
        return None
    amount = Decimal(str(value))
    if not amount.is_finite():
        raise ValueError(f"Invalid numeric value {value!r}")
    return format(amount, "f")


def date_value(value):
    if value is None:
        return None
    if isinstance(value, (float, int)) and not isinstance(value, bool) and value > 60:
        return (datetime(1899, 12, 30) + timedelta(days=value)).date().isoformat()
    return datetime.fromisoformat(str(value)).date().isoformat()


def number_text(value):
    return format(Decimal(str(value)).normalize(), "f") if isinstance(value, (int, float)) else str(value)


def row_mode(values):
    if 9 in values and 10 in values:
        return "area"
    if values.get(13) == "مقطوعية":
        return "lump"
    if values.get(13) == "عدد" and 11 in values:
        return "count"
    return "direct"


def extract(workbook):
    customers = {}
    for row, values in sheet_rows(workbook, CUSTOMERS):
        if 4 not in values:
            continue
        code = values[4]
        if code in customers:
            raise ValueError(f"Duplicate customer code at {CUSTOMERS}:{row}")
        customers[code] = {
            "source_id": code, "code": code, "name": values[5], "short_name": values[1],
            "kind": {"شركات": "company", "افراد": "person"}.get(values.get(2)),
            "raw": source(CUSTOMERS, row, values),
        }

    projects = {}
    project_displays = defaultdict(list)
    locations = []
    for row, values in sheet_rows(workbook, PROJECTS):
        if 10 in values:
            code, customer = values[10], values[11]
            if code in projects or customer not in customers:
                raise ValueError(f"Conflicting customer or project code at {PROJECTS}:{row}")
            projects[code] = {
                "source_id": code, "customer_source_id": customer, "code": code,
                "name": values[2], "address": values.get(3), "currency": "EGP",
                "raw": source(PROJECTS, row, values), "locations": [],
            }
            project_displays[values[15]].append(code)
        if 18 in values and 19 in values:
            locations.append((row, values))

    for row, values in locations:
        matches = project_displays[values[18]]
        if len(matches) != 1:
            raise ValueError(f"Ambiguous location project at {PROJECTS}:{row}")
        projects[matches[0]]["locations"].append({
            "name": values[19], "source_row": row, "raw": source(PROJECTS, row, {18: values[18], 19: values[19]}),
        })

    certificates = {}
    skipped_blank = []
    for row, values in sheet_rows(workbook, CERTIFICATES):
        if 8 not in values:
            if set(values) <= {15, 16} and all(v == 0 for v in values.values()):
                skipped_blank.append(row)
                continue
            raise ValueError(f"Unidentified certificate line at {CERTIFICATES}:{row}")
        customer = values[18]
        project = values.get(17)
        if project is None:
            project = f"UNASSIGNED-{customer}"
            projects.setdefault(project, {
                "source_id": project, "customer_source_id": customer, "code": project,
                "name": "بدون مشروع (أرشيف المستخلصات)", "alternate_name": "No project (workbook archive)",
                "currency": "EGP", "historical_only": True,
                "raw": {"workbook_project_missing": True},
            })
        if projects[project]["customer_source_id"] != customer:
            raise ValueError(f"Customer/project mismatch at {CERTIFICATES}:{row}")
        number = number_text(values[3])
        key = f"{project}:{number}"
        work_date = date_value(values[2])
        certificate = certificates.setdefault(key, {
            "project_source_id": project, "source_number": number, "source_type": values[5],
            "source_key": key, "work_from": work_date, "work_to": work_date, "lines": [],
        })
        if certificate["source_type"] != values[5]:
            raise ValueError(f"Inconsistent certificate type at {CERTIFICATES}:{row}")
        certificate["work_from"] = min(certificate["work_from"], work_date)
        certificate["work_to"] = max(certificate["work_to"], work_date)
        certificate["lines"].append({
            "source_sheet": CERTIFICATES, "source_row": row, "date": work_date,
            "description": values[8], "location": values.get(7), "mode": row_mode(values),
            "width": numeric(values.get(9)), "height": numeric(values.get(10)),
            "count": numeric(values.get(11)), "quantity": numeric(values[12]),
            "unit": values.get(13), "rate": numeric(values[14]),
            "progress": numeric(values[4]), "recognized_quantity": numeric(values.get(15)),
            "amount": numeric(values[16]), "raw": source(CERTIFICATES, row, values),
        })

    receipts = []
    for row, values in sheet_rows(workbook, RECEIPTS):
        project = values[11]
        if project not in projects or projects[project]["customer_source_id"] != values[12]:
            raise ValueError(f"Customer/project mismatch at {RECEIPTS}:{row}")
        receipts.append({
            "project_source_id": project, "source_sheet": RECEIPTS, "source_row": row,
            "source_number": number_text(values[3]) if 3 in values else None,
            "date": date_value(values[2]), "due_date": date_value(values.get(8)),
            "location": values.get(5), "reference": values[6], "amount": numeric(values[7]),
            "kind": {"عادي": "receipt", "دفعة تعاقد": "advance"}.get(values.get(9), "unclassified"),
            "progress": numeric(values.get(10)), "raw": source(RECEIPTS, row, values),
        })

    lines = [line for certificate in certificates.values() for line in certificate["lines"]]
    batch = {
        "customers": list(customers.values()), "projects": list(projects.values()),
        "certificates": list(certificates.values()), "receipts": receipts,
        "reconciliation": {
            "certificate_lines": len(lines), "receipt_lines": len(receipts),
            "certificate_total_exact": exact_total(lines), "receipt_total_exact": exact_total(receipts),
            "certificate_total_rounded_per_line": settled_total(lines),
            "receipt_total_rounded_per_line": settled_total(receipts),
            "formula_only_rows": skipped_blank,
        },
    }
    return batch


def exact_total(rows):
    return format(sum((Decimal(row["amount"]) for row in rows), Decimal(0)), "f")


def settled_total(rows):
    cents = Decimal(".01")
    amounts = (Decimal(row["amount"]).quantize(cents, rounding=ROUND_HALF_UP) for row in rows)
    return format(sum(amounts, Decimal(0)), ".2f")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.workbook.open("rb") as stream:
        fingerprint = sha256(stream.read()).hexdigest()
        stream.seek(0)
        with open_workbook(stream) as workbook:
            batch = extract(workbook)
    batch.update({"fingerprint": fingerprint, "source_name": args.workbook.name})
    with args.output.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(batch, output, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        output.write("\n")
    print(json.dumps(batch["reconciliation"], ensure_ascii=False))


if __name__ == "__main__":
    main()
