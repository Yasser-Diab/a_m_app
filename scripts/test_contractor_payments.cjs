const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server/index.cjs");

const CONTRACTOR_STATUS = "مستخلص مقاول";
const PAYMENT_OUT_STATUS = "خصم";
const PAYMENT_IN_STATUS = "تحصيل";

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error || JSON.stringify(body));
  return body;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-contractor-payments-"));
  const dbPath = path.join(dataDir, "test.db");
  let server = await createServer({ dataDir, dbPath, port: 0 });
  let httpServer = await server.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

  try {
    const workBatch = await requestJson(baseUrl, "/api/entries/batch", {
      method: "POST",
      body: JSON.stringify({
        rows: [
          {
            client_row_id: "contractor-work-1",
            data: {
              document_type: "contractor_certificate",
              document_status: "approved",
              accounting_status: CONTRACTOR_STATUS,
              party_role: "contractor",
              party_category: "corporate",
              customer_name: "Contractor Payment Test",
              base_party_name: "Contractor Payment Test",
              project: "Tower A",
              entry_date: "2026-08-15",
              work_type: "Installation",
              description: "Installed works",
              unit_code: "count",
              total_quantity: 1,
              rate: 1000,
            },
          },
        ],
      }),
    });
    const workRow = workBatch.rows[0];
    assert.equal(workRow.party_role, "contractor");
    assert.equal(workRow.accounting_status, CONTRACTOR_STATUS);

    const payment = await requestJson(baseUrl, "/api/payments", {
      method: "POST",
      body: JSON.stringify({
        party_id: workRow.party_id,
        party_role: "contractor",
        party_category: "corporate",
        customer_name: "Contractor Payment Test",
        base_party_name: "Contractor Payment Test",
        project: "Tower A",
        entry_date: "2026-08-16",
        amount: 250,
        payment_type: "out",
        note: "Contractor deduction payment",
      }),
    });
    assert.equal(payment.party_role, "contractor");
    assert.equal(payment.accounting_status, PAYMENT_OUT_STATUS);

    const contractorPayments = await requestJson(
      baseUrl,
      `/api/payments?role=contractor&customer=${encodeURIComponent("Contractor Payment Test")}`,
    );
    assert.equal(contractorPayments.rows.length, 1);
    assert.equal(contractorPayments.rows[0].accounting_status, PAYMENT_OUT_STATUS);

    const customerPayments = await requestJson(
      baseUrl,
      `/api/payments?role=customer&customer=${encodeURIComponent("Contractor Payment Test")}`,
    );
    assert.equal(customerPayments.rows.length, 0);

    const report = await requestJson(
      baseUrl,
      `/api/documents/contractor?party_id=${workRow.party_id}&project=${encodeURIComponent("Tower A")}`,
    );
    assert.equal(report.paymentRows.length, 1);
    assert.equal(report.paymentRows[0].collection_note, "Contractor deduction payment");

    await requestJson(baseUrl, `/api/documents/${payment.document_id}`, {
      method: "PUT",
      body: JSON.stringify({ notes: "metadata update should preserve payment status" }),
    });
    const afterDocumentUpdate = server.database.get(
      "SELECT party_role, accounting_status FROM work_items WHERE id = ?",
      [payment.id],
    );
    assert.equal(afterDocumentUpdate.party_role, "contractor");
    assert.equal(afterDocumentUpdate.accounting_status, PAYMENT_OUT_STATUS);

    const contractorParty = server.database.get("SELECT * FROM parties WHERE id = ?", [
      workRow.party_id,
    ]);
    assert.equal(contractorParty.role, "contractor");
    const existingCustomerParty = server.database.get(
      "SELECT * FROM parties WHERE role = 'customer' AND search_name = ?",
      [contractorParty.search_name],
    );
    const customerParty =
      existingCustomerParty ||
      (() => {
        const inserted = server.database.run(
          `INSERT INTO parties (role, category, base_name, display_name, search_name)
           VALUES ('customer', 'corporate', ?, ?, ?)`,
          [
            contractorParty.base_name,
            contractorParty.display_name,
            contractorParty.search_name,
          ],
        );
        return server.database.get("SELECT * FROM parties WHERE id = ?", [
          inserted.lastInsertRowid,
        ]);
      })();

    server.database.run(
      `UPDATE documents
       SET document_type = 'ledger',
           party_id = ?,
           party_role = 'customer',
           party_category = 'corporate',
           customer_name = ?,
           search_party_name = ?
       WHERE id = ?`,
      [
        customerParty.id,
        customerParty.display_name,
        customerParty.search_name,
        payment.document_id,
      ],
    );
    server.database.run(
      `UPDATE work_items
       SET party_id = ?,
           party_role = 'customer',
           party_category = 'corporate',
           accounting_status = ?,
           search_party_name = ?,
           customer_name = ?,
           customer_display_name = ?
       WHERE id = ?`,
      [
        customerParty.id,
        PAYMENT_OUT_STATUS,
        customerParty.search_name,
        customerParty.display_name,
        customerParty.display_name,
        payment.id,
      ],
    );
    const legacyShape = server.database.get(
      `SELECT wi.party_id, wi.party_role, wi.accounting_status,
              d.document_type, d.party_id AS document_party_id, d.party_role AS document_party_role
       FROM work_items wi
       JOIN documents d ON d.id = wi.document_id
       WHERE wi.id = ?`,
      [payment.id],
    );
    assert.equal(legacyShape.party_id, customerParty.id);
    assert.equal(legacyShape.party_role, "customer");
    assert.equal(legacyShape.accounting_status, PAYMENT_OUT_STATUS);
    assert.equal(legacyShape.document_type, "ledger");
    assert.equal(legacyShape.document_party_id, customerParty.id);
    assert.equal(legacyShape.document_party_role, "customer");

    const legacyDocument = server.database.get(
      "SELECT document_no FROM documents WHERE id = ?",
      [payment.document_id],
    );
    server.database.run(
      `INSERT INTO documents
       (document_type, document_no, operation_no, status, party_id, party_role,
        party_category, customer_name, search_party_name, project, entry_date)
       VALUES ('payment', ?, ?, 'approved', ?, 'contractor', 'corporate', ?, ?, 'Tower A', ?)`,
      [
        legacyDocument.document_no,
        `CONFLICT-${legacyDocument.document_no}`,
        workRow.party_id,
        contractorParty.display_name,
        contractorParty.search_name,
        "2026-08-17",
      ],
    );

    await new Promise((resolve) => httpServer.close(resolve));
    server.close();
    httpServer = null;
    server = await createServer({ dataDir, dbPath, port: 0 });

    const repaired = server.database.get(
      `SELECT wi.party_id, wi.party_role, wi.accounting_status, wi.serial, wi.operation_no,
              d.document_type, d.document_no, d.operation_no AS document_operation_no,
              d.party_id AS document_party_id, d.party_role AS document_party_role
       FROM work_items wi
       JOIN documents d ON d.id = wi.document_id
       WHERE wi.id = ?`,
      [payment.id],
    );
    assert.equal(repaired.party_id, workRow.party_id);
    assert.equal(repaired.party_role, "contractor");
    assert.equal(repaired.accounting_status, PAYMENT_OUT_STATUS);
    assert.equal(repaired.document_type, "payment");
    assert.equal(repaired.document_party_id, workRow.party_id);
    assert.equal(repaired.document_party_role, "contractor");
    assert.notEqual(repaired.document_no, legacyDocument.document_no);
    assert.equal(repaired.serial, repaired.document_no);
    assert.equal(repaired.operation_no, repaired.document_operation_no);

    httpServer = await server.listen(0, "127.0.0.1");
    const repairedBaseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    const repairedReport = await requestJson(
      repairedBaseUrl,
      `/api/documents/contractor?party_id=${workRow.party_id}&project=${encodeURIComponent("Tower A")}`,
    );
    assert.equal(repairedReport.paymentRows.length, 1);
    assert.equal(repairedReport.paymentRows[0].collection_note, "Contractor deduction payment");
    const repairedCustomerPayments = await requestJson(
      repairedBaseUrl,
      `/api/payments?role=customer&customer=${encodeURIComponent("Contractor Payment Test")}`,
    );
    assert.equal(repairedCustomerPayments.rows.length, 0);
  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    server?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log("Contractor payment persistence regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
