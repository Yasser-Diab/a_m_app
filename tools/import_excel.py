from __future__ import annotations

import json
import re
import sqlite3
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


def clean(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    text = str(value).replace("_x000a_", " / ").replace("\n", " ").strip()
    return text if text != "" else None


def as_float(value):
    value = clean(value)
    if value is None:
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def as_int(value):
    number = as_float(value)
    return int(number) if number is not None else None


def as_bool(value):
    if isinstance(value, bool):
        return 1 if value else 0
    text = str(value or "").strip().lower()
    return 1 if text in {"true", "1", "yes", "y", "نعم"} else 0


def excel_date(value):
    number = as_float(value)
    if not number:
        return clean(value)
    return (datetime(1899, 12, 30) + timedelta(days=number)).date().isoformat()


def col_letters(ref: str) -> str:
    match = re.match(r"([A-Z]+)", ref or "")
    return match.group(1) if match else ""


def col_to_num(col: str) -> int:
    result = 0
    for ch in col:
        result = result * 26 + ord(ch) - 64
    return result


def col_num(ref: str) -> int:
    return col_to_num(col_letters(ref))


def row_num(ref: str):
    match = re.search(r"(\d+)$", ref or "")
    return int(match.group(1)) if match else None


def text_from_si(si) -> str:
    return "".join(t.text or "" for t in si.iter(q("t")))


def cell_value(cell, shared):
    ctype = cell.attrib.get("t")
    v = cell.find(q("v"))
    is_node = cell.find(q("is"))
    if v is not None:
        raw = v.text
        if ctype == "s":
            try:
                return shared[int(raw)]
            except Exception:
                return None
        if ctype == "b":
            return True if raw == "1" else False
        return raw
    if is_node is not None:
        return "".join(t.text or "" for t in is_node.iter(q("t")))
    return None


def read_headers(workbook: Path):
    with zipfile.ZipFile(workbook) as z:
        table = ET.fromstring(z.read("xl/tables/table1.xml"))
        headers = [
            clean(col.attrib.get("name"))
            for col in table.find(q("tableColumns")).findall(q("tableColumn"))
        ]
        return headers


FIELDS = [
    "source_row",
    "serial",
    "operation_no",
    "calculation_method",
    "customer_name",
    "customer_display_name",
    "party_type",
    "accounting_status",
    "completion_ratio",
    "collection_amount",
    "collection_note",
    "work_type",
    "project",
    "building_unit",
    "floor_apartment",
    "entry_date",
    "description",
    "glass_spec",
    "profile_spec",
    "color",
    "total_quantity",
    "unit",
    "item_count",
    "width_cm",
    "height_cm",
    "rate",
    "building_unit_price",
    "fixed_discount",
    "percent_discount",
    "supply_status",
    "supply_date",
    "driver_name",
    "vehicle_no",
    "certificate_no",
    "vat_enabled",
    "social_insurance_enabled",
    "stamp_enabled",
    "works_insurance_enabled",
    "final_insurance_enabled",
    "contractor_tax_enabled",
    "discount_label",
    "sequence_code",
]


def row_to_record(row: dict[int, object], source_row: int):
    serial = as_int(row.get(2))
    customer = clean(row.get(3))
    status = clean(row.get(5))
    collection = as_float(row.get(7))
    work_type = clean(row.get(9))
    project = clean(row.get(10))
    description = clean(row.get(14))
    if not serial or serial == 0:
        return None
    if source_row == 6 and description and "ممنوع" in description:
        return None
    if not any([customer, status, collection, work_type, project, description]):
        return None

    operation_no = clean(row.get(51)) or str(serial).zfill(6)
    return {
        "source_row": source_row,
        "serial": serial,
        "operation_no": operation_no,
        "calculation_method": clean(row.get(1)),
        "customer_name": customer,
        "customer_display_name": clean(row.get(52)) or customer,
        "party_type": clean(row.get(4)),
        "accounting_status": status,
        "completion_ratio": as_float(row.get(6)),
        "collection_amount": collection,
        "collection_note": clean(row.get(8)),
        "work_type": work_type,
        "project": project,
        "building_unit": clean(row.get(11)),
        "floor_apartment": clean(row.get(12)),
        "entry_date": excel_date(row.get(13)),
        "description": description,
        "glass_spec": clean(row.get(15)),
        "profile_spec": clean(row.get(16)),
        "color": clean(row.get(17)),
        "total_quantity": as_float(row.get(18)),
        "unit": clean(row.get(19)),
        "item_count": as_float(row.get(20)),
        "width_cm": as_float(row.get(21)),
        "height_cm": as_float(row.get(22)),
        "rate": as_float(row.get(23)),
        "building_unit_price": as_float(row.get(24)),
        "fixed_discount": as_float(row.get(25)),
        "percent_discount": as_float(row.get(26)),
        "supply_status": clean(row.get(27)),
        "supply_date": excel_date(row.get(28)),
        "driver_name": clean(row.get(29)),
        "vehicle_no": clean(row.get(30)),
        "certificate_no": clean(row.get(31)),
        "vat_enabled": as_bool(row.get(32)),
        "social_insurance_enabled": as_bool(row.get(33)),
        "stamp_enabled": as_bool(row.get(34)),
        "works_insurance_enabled": as_bool(row.get(35)),
        "final_insurance_enabled": as_bool(row.get(36)),
        "contractor_tax_enabled": as_bool(row.get(37)),
        "discount_label": clean(row.get(38)),
        "sequence_code": clean(row.get(55)),
    }


def init_db(db_path: Path, schema_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.executescript(schema_path.read_text(encoding="utf-8"))
    return con


def import_workbook(workbook: Path, db_path: Path):
    schema_path = Path(__file__).resolve().parents[1] / "server" / "schema.sql"
    con = init_db(db_path, schema_path)
    con.execute("DELETE FROM work_items")
    con.execute("DELETE FROM documents")
    con.execute("DELETE FROM parties")

    records = []
    with zipfile.ZipFile(workbook) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for event, elem in ET.iterparse(z.open("xl/sharedStrings.xml"), events=("end",)):
                if elem.tag == q("si"):
                    shared.append(text_from_si(elem))
                    elem.clear()

        current = {}
        for event, elem in ET.iterparse(z.open("xl/worksheets/sheet5.xml"), events=("end",)):
            if elem.tag == q("c"):
                ref = elem.attrib.get("r", "")
                r = row_num(ref)
                c = col_num(ref)
                if r and 6 <= r <= 13397 and 1 <= c <= 58:
                    value = cell_value(elem, shared)
                    if value not in (None, ""):
                        current[c] = value
                elem.clear()
            elif elem.tag == q("row"):
                r = int(elem.attrib.get("r", "0") or 0)
                if 6 <= r <= 13397:
                    record = row_to_record(current, r)
                    if record:
                        records.append(record)
                    current = {}
                elem.clear()

    placeholders = ",".join(["?"] * len(FIELDS))
    sql = f"INSERT INTO work_items ({','.join(FIELDS)}) VALUES ({placeholders})"
    con.executemany(sql, [[record.get(field) for field in FIELDS] for record in records])
    con.commit()

    totals = con.execute(
        """
        SELECT
          COUNT(*) AS rows,
          COUNT(DISTINCT serial) AS documents,
          COUNT(DISTINCT customer_name) AS customers
        FROM work_items
        """
    ).fetchone()
    con.close()
    return {
        "database": str(db_path),
        "imported_rows": totals[0],
        "documents": totals[1],
        "customers": totals[2],
        "calculation": "raw row data imported; totals recalculate when the server starts",
    }


def main():
    workbook = Path(sys.argv[1] if len(sys.argv) > 1 else "QID-YD.xlsm").resolve()
    db_path = Path(sys.argv[2] if len(sys.argv) > 2 else "data/price_offer.db").resolve()
    if not workbook.exists():
        raise SystemExit(f"Workbook not found: {workbook}")
    result = import_workbook(workbook, db_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
