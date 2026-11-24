const {audit, certificateIdWatermark, fail, setSetting} = require("./certificate-access.cjs");
const {requireVersion,certificateNumber} = require("./certificate-revisions.cjs");

function deleteArchivedFiles(database,row,user,version) {
  requireVersion(row,version);
  database.run("DELETE FROM certificate_edit_artifacts WHERE certificate_id=?",[row.id]);
  const deleted = database.run("DELETE FROM cert_pdf_artifacts WHERE certificate_id=?",[row.id]).modified;
  if (deleted) {
    database.run("UPDATE cert_revisions SET pdf_status=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",[row.id]);
    audit(database,user,"certificate_files_deleted",{projectId:row.project_id,revisionId:row.id,details:{files:deleted}});
  }
  return {files:deleted};
}

function deleteCertificate(database,row,user,version) {
  requireVersion(row,version);
  const root = row.root_id || row.id;
  const family = "(SELECT id FROM cert_revisions WHERE id=? OR root_id=?)";
  const ids = [root,root];
  const blocking = database.get(`SELECT id,official_number,legacy_number FROM cert_revisions
    WHERE baseline_id IN ${family} AND id NOT IN ${family} AND status IN ('approved','issued') LIMIT 1`,[...ids,...ids]);
  const historical = database.get(`SELECT r.id,r.legacy_number FROM cert_revisions r JOIN cert_legacy_workflow lw ON lw.revision_id=r.id
    WHERE r.project_id=? AND r.series_key=? AND lw.approved_at IS NOT NULL AND r.id NOT IN ${family}
    AND EXISTS (SELECT 1 FROM cert_revisions prior WHERE (prior.id=? OR prior.root_id=?) AND prior.status='historical'
      AND (json_extract(lw.approved_json,'$.baseline.id')=prior.id OR
        (prior.legacy_number<>'' AND prior.legacy_number NOT GLOB '*[^0-9]*' AND
         r.legacy_number<>'' AND r.legacy_number NOT GLOB '*[^0-9]*' AND CAST(r.legacy_number AS INTEGER)>CAST(prior.legacy_number AS INTEGER))))
    LIMIT 1`,[row.project_id,row.series_key,...ids,...ids]);
  const dependent = blocking || historical;
  if (dependent) fail(409,`Certificate ${certificateNumber(database,database.get("SELECT * FROM cert_revisions WHERE id=?",[dependent.id]))} has an approved balance that uses this certificate`);

  const members = database.all("SELECT id,official_number,legacy_number FROM cert_revisions WHERE id=? OR root_id=? ORDER BY id DESC",ids);
  const links = members.map(({id}) => id);
  const placeholders = links.map(() => "?").join(",");
  setSetting(database,"certificates_last_revision_id",String(certificateIdWatermark(database)));
  const number = Math.max(0,...members.map((member) => member.official_number ||
    (/^\d+$/.test(member.legacy_number || "") ? Number(member.legacy_number) : 0)));
  if (Number.isSafeInteger(number) && number > 0) database.run(`INSERT INTO cert_series (project_id,reference,next_number) VALUES (?,?,?)
    ON CONFLICT(project_id,reference) DO UPDATE SET next_number=MAX(next_number,excluded.next_number)`,
  [row.project_id,row.series_key,number+1]);
  database.run(`UPDATE cert_revisions SET baseline_id=NULL,status='draft',approved_json=NULL,
    version=version+1,updated_at=CURRENT_TIMESTAMP WHERE baseline_id IN (${placeholders}) AND id NOT IN (${placeholders})`,[...links,...links]);
  const files = database.run(`DELETE FROM cert_pdf_artifacts WHERE certificate_id IN (${placeholders})`,links).modified;
  database.run(`DELETE FROM cert_receipt_allocations WHERE certificate_id IN (${placeholders})`,links);
  database.run(`DELETE FROM cert_advance_recoveries WHERE certificate_id IN (${placeholders})`,links);
  database.run(`DELETE FROM cert_legacy_records WHERE revision_id IN (${placeholders})`,links);
  database.run(`UPDATE cert_revisions SET baseline_id=NULL,root_id=NULL,revises_id=NULL WHERE id IN (${placeholders})`,links);
  database.run(`DELETE FROM document_edit_history WHERE kind='certificate' AND document_id IN (${placeholders})`,links);
  database.run(`DELETE FROM document_edit_locks WHERE kind='certificate' AND document_id IN (${placeholders})`,links);
  database.run(`DELETE FROM cert_revisions WHERE id IN (${placeholders})`,links);
  const lastDecision = database.get(`SELECT id,type FROM cert_revisions WHERE project_id=? AND series_key=?
    AND status='issued' AND type IN ('final','reopen') ORDER BY issued_at DESC,id DESC LIMIT 1`,[row.project_id,row.series_key]);
  database.run("UPDATE cert_series SET final_revision_id=? WHERE project_id=? AND reference=?",
    [lastDecision?.type === "final" ? lastDecision.id : null,row.project_id,row.series_key]);
  audit(database,user,"certificate_permanently_deleted",{projectId:row.project_id,details:{certificate_root:root,revision_ids:links,files}});
  return {revisions:members.length,files};
}

module.exports = {deleteArchivedFiles,deleteCertificate};
