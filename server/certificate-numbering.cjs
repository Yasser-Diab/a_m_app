function nextSeriesNumber(database, row) {
  const result=database.get(`SELECT MAX(CASE
    WHEN official_number>0 THEN official_number
    WHEN reserved_number>0 THEN reserved_number
    WHEN legacy_number<>'' AND legacy_number NOT GLOB '*[^0-9]*' THEN CAST(legacy_number AS INTEGER)
    ELSE 0 END) AS number FROM cert_revisions WHERE project_id=? AND series_key=?`,
  [row.project_id,row.series_key]);
  return (result.number||0)+1;
}

function certificateNumber(database, row) {
  if (row.official_number||row.legacy_number) return row.official_number||row.legacy_number;
  if (row.reserved_number) return row.reserved_number;
  if (row.revises_id) {
    const previous=database.get("SELECT * FROM cert_revisions WHERE id=?",[row.revises_id]);
    if (previous) return certificateNumber(database,previous);
  }
  return nextSeriesNumber(database,row);
}

function initializeCertificateNumbers(database) {
  if (!database.all("PRAGMA table_info(cert_revisions)").some(({name})=>name==="reserved_number"))
    database.run("ALTER TABLE cert_revisions ADD COLUMN reserved_number INTEGER CHECK(reserved_number>0)");
  const pending=database.all(`SELECT * FROM cert_revisions WHERE revises_id IS NULL AND official_number IS NULL
    AND TRIM(COALESCE(legacy_number,''))='' AND reserved_number IS NULL
    ORDER BY CASE WHEN status='approved' THEN 0 ELSE 1 END,work_to,created_at,id`);
  for (const row of pending)
    database.run("UPDATE cert_revisions SET reserved_number=? WHERE id=?",[nextSeriesNumber(database,row),row.id]);
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_reserved_number
    ON cert_revisions(project_id,series_key,reserved_number) WHERE reserved_number IS NOT NULL AND revises_id IS NULL`);
}

module.exports={nextSeriesNumber,certificateNumber,initializeCertificateNumbers};
