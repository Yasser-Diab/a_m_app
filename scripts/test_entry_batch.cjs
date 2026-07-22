const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server/index.cjs");

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-entry-batch-"));
  const dbPath = path.join(dataDir, "test.db");
  const server = await createServer({ dataDir, dbPath, port: 0 });
  const httpServer = await server.listen(0, "127.0.0.1");
  try {
    const response = await fetch(
      `http://127.0.0.1:${httpServer.address().port}/api/entries/batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: [
            {
              client_row_id: "draft:test:1",
              data: {
                document_type: "price_offer",
                document_status: "draft",
                party_role: "customer",
                party_category: "unselected",
                customer_name: "Batch Test",
                base_party_name: "Batch Test",
                entry_date: "2026-07-16",
                description: "Row A",
                unit_code: "count",
                total_quantity: 1,
                rate: 10,
              },
            },
            {
              client_row_id: "draft:test:2",
              data: {
                document_type: "price_offer",
                document_status: "draft",
                party_role: "customer",
                party_category: "unselected",
                customer_name: "Batch Test",
                base_party_name: "Batch Test",
                entry_date: "2026-07-16",
                description: "Row B",
                unit_code: "count",
                total_quantity: 2,
                rate: 20,
              },
            },
          ],
        }),
      },
    );
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.equal(body.ok, true);
    assert.equal(body.rows.length, 2);
    assert.deepEqual(
      body.rows.map((row) => row.client_row_id),
      ["draft:test:1", "draft:test:2"],
    );
    assert.equal(body.rows[0].document_id, body.rows[1].document_id);

    const deleteResponse = await fetch(
      `http://127.0.0.1:${httpServer.address().port}/api/entries/batch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete_ids: [body.rows[0].id] }),
      },
    );
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200, deleteBody.error);
    assert.equal(deleteBody.deleted_count, 1);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log("Entry batch persistence regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
