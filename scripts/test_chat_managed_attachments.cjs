const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server/index.cjs");

function base64(value) {
  return Buffer.from(value).toString("base64");
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error);
  return body;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "am-chat-managed-"));
  const dbPath = path.join(dataDir, "test.db");
  const server = await createServer({ dataDir, dbPath, port: 0 });
  const httpServer = await server.listen(0, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  try {
    const content = "hello managed attachment";
    const session = await jsonFetch(`${baseUrl}/api/chat/attachments/sessions`, {
      method: "POST",
      body: JSON.stringify({
        created_by: "tester",
        attachment_type: "file",
        display_name: "test.txt",
        entries: [
          {
            relative_path: "test.txt",
            display_name: "test.txt",
            size_bytes: Buffer.byteLength(content),
            mime_type: "text/plain",
          },
        ],
      }),
    });
    const attachmentId = session.attachment.id;
    const entryId = session.entries[0].id;
    await jsonFetch(
      `${baseUrl}/api/chat/attachments/${attachmentId}/entries/${entryId}/chunk`,
      {
        method: "POST",
        body: JSON.stringify({ offset: 0, data: base64(content.slice(0, 5)) }),
      },
    );
    await jsonFetch(
      `${baseUrl}/api/chat/attachments/${attachmentId}/entries/${entryId}/chunk`,
      {
        method: "POST",
        body: JSON.stringify({
          offset: 5,
          data: base64(content.slice(5)),
        }),
      },
    );
    const completed = await jsonFetch(
      `${baseUrl}/api/chat/attachments/${attachmentId}/complete`,
      { method: "POST", body: JSON.stringify({}) },
    );
    assert.equal(completed.attachment.status, "available");

    const message = await jsonFetch(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      body: JSON.stringify({
        sender: "Tester",
        message: "Managed file",
        attachment_ids: [attachmentId],
      }),
    });
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].id, attachmentId);

    const reacted = await jsonFetch(
      `${baseUrl}/api/chat/messages/${message.id}/reactions`,
      {
        method: "POST",
        body: JSON.stringify({ user_id: "tester", user_name: "Tester", emoji: "👍" }),
      },
    );
    assert.equal(reacted.reactions.length, 1);
    assert.equal(reacted.reactions[0].count, 1);

    const messages = await jsonFetch(`${baseUrl}/api/chat/messages?user_id=tester`);
    const loaded = messages.rows.find((row) => row.id === message.id);
    assert.equal(loaded.attachments[0].id, attachmentId);
    assert.equal(loaded.reactions[0].reacted_by_current, true);

    const download = await fetch(`${baseUrl}/api/attachments/${attachmentId}/download`, {
      headers: { range: "bytes=0-4" },
    });
    assert.equal(download.status, 206);
    assert.equal(await download.text(), "hello");

    const removed = await jsonFetch(
      `${baseUrl}/api/chat/messages/${message.id}/reactions`,
      {
        method: "POST",
        body: JSON.stringify({ user_id: "tester", user_name: "Tester", emoji: "👍" }),
      },
    );
    assert.equal(removed.reactions.length, 0);

    const nestedPath =
      "Noor Medical Center/Aluminum/23-Louvers/01-DRAWINGS/04-SECTIONS/DWG/87650-Sheet - A-S-AKDC-RT-B01--02 - AKDC-NOUR MEDICAL CENTRE - BUILDING WALL SECTIONS.dwg";
    const nestedContent = "dwg placeholder";
    const folderSession = await jsonFetch(`${baseUrl}/api/chat/attachments/sessions`, {
      method: "POST",
      body: JSON.stringify({
        created_by: "tester",
        attachment_type: "folder",
        display_name: "Noor Medical Center",
        entries: [
          {
            client_id: "nested-dwg-entry",
            relative_path: nestedPath,
            display_name: path.basename(nestedPath),
            size_bytes: Buffer.byteLength(nestedContent),
            mime_type: "application/acad",
          },
        ],
      }),
    });
    const nestedEntry = folderSession.entries.find(
      (entry) => entry.client_id === "nested-dwg-entry",
    );
    assert.ok(nestedEntry?.id, "nested folder file entry should be returned by client_id");
    assert.equal(nestedEntry.relative_path, nestedPath);
    await jsonFetch(
      `${baseUrl}/api/chat/attachments/${folderSession.attachment.id}/entries/${nestedEntry.id}/chunk`,
      {
        method: "POST",
        body: JSON.stringify({ offset: 0, data: base64(nestedContent) }),
      },
    );
    const completedFolder = await jsonFetch(
      `${baseUrl}/api/chat/attachments/${folderSession.attachment.id}/complete`,
      { method: "POST", body: JSON.stringify({}) },
    );
    assert.equal(completedFolder.attachment.status, "available");
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => console.log("Chat reactions and managed attachment regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
