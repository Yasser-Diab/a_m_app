const {idOf,fail,audit,str}=require('./certificate-access.cjs');

function initialize(db){
  db.exec(`CREATE TABLE IF NOT EXISTS cert_accounts(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES cert_projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number>1),
    source_final_id INTEGER REFERENCES cert_revisions(id) ON DELETE SET NULL,
    command_key TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,number),UNIQUE(source_final_id)
  );`);
  for(const table of ['cert_revisions','cert_receipts']){
    if(!db.all(`PRAGMA table_info(${table})`).some(column=>column.name==='account_id'))
      db.run(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER REFERENCES cert_accounts(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_account ON ${table}(project_id,account_id)`);
  }
}

function checked(db,projectId,value){
  const id=idOf(value);
  if(!id)return null;
  const account=db.get('SELECT * FROM cert_accounts WHERE id=? AND project_id=?',[id,projectId]);
  if(!account)fail(404,'Project account not found');
  return account;
}
function display(project,account){return account?{...project,base_name:project.base_name||project.name,name:(project.base_name||project.name)+' #'+account.number,account_id:account.id,account_number:account.number}:project;}
function list(db,project){
  const rows=[{id:null,project_id:project.id,number:1},...db.all('SELECT * FROM cert_accounts WHERE project_id=? ORDER BY number',[project.id])];
  return rows.map(account=>({...account,name:account.number===1?project.name:project.name+' #'+account.number,
    final_id:db.get("SELECT id FROM cert_revisions WHERE project_id=? AND account_id IS ? AND type='final' AND status IN('approved','issued') ORDER BY id DESC LIMIT 1",[project.id,account.id])?.id||null}));
}
function create(db,project,body,user){
  const source=db.get("SELECT * FROM cert_revisions WHERE id=? AND project_id=? AND type='final' AND status IN('approved','issued')",[idOf(body.final_id),project.id]);
  if(!source)fail(400,'Select an approved final certificate before starting a new project account');
  const existing=db.get('SELECT * FROM cert_accounts WHERE source_final_id=?',[source.id]);
  if(existing)return {...existing,name:project.name+' #'+existing.number};
  const number=(db.get('SELECT MAX(number) n FROM cert_accounts WHERE project_id=?',[project.id]).n||1)+1;
  const id=db.run('INSERT INTO cert_accounts(project_id,number,source_final_id,command_key,created_by) VALUES(?,?,?,?,?)',[project.id,number,source.id,str(body.command_key,160)||null,user.id]).lastInsertRowid;
  audit(db,user,'project_account_created',{projectId:project.id,revisionId:source.id,details:{account_id:id,number}});
  return {...db.get('SELECT * FROM cert_accounts WHERE id=?',[id]),name:project.name+' #'+number};
}
module.exports={initialize,checked,display,list,create};
