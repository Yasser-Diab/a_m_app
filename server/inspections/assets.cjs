const {randomUUID,createHash}=require('node:crypto');
const {str,fail,parse,encode}=require('../certificate-access.cjs');
const templates=require('./templates.cjs');
async function prepare(body){
 const mime=str(body.mime,50),base64=body.base64;if(typeof base64!=='string'||base64.length>14000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))fail(400,'Choose an image or PDF up to 10 MB');
 const content=Buffer.from(base64,'base64');if(!content.length||content.length>10*1024*1024)fail(400,'Choose an image or PDF up to 10 MB');
 const types={'image/png':()=>content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':()=>content[0]===255&&content[1]===216&&content[2]===255,'image/webp':()=>content.toString('ascii',0,4)==='RIFF'&&content.toString('ascii',8,12)==='WEBP','application/pdf':()=>content.toString('ascii',0,5)==='%PDF-'};
 if(!types[mime]?.())fail(400,'Choose a PNG, JPEG, WebP or PDF file');let metadata={sha256:createHash('sha256').update(content).digest('hex')};
 if(mime==='application/pdf'){try{const doc=await require('pdf-lib').PDFDocument.load(content);if(!doc.getPageCount()||doc.getPageCount()>100)fail(400,'Choose a PDF with 1–100 pages');metadata.pages=doc.getPages().map(page=>({width:page.getWidth()/2.8346456693,height:page.getHeight()/2.8346456693}));metadata.fields=doc.getForm().getFields().map(f=>f.getName());}catch(error){if(error.status)throw error;fail(400,'The PDF cannot be read. Choose an unencrypted PDF');}}
 return {mime,content,metadata,name:str(body.name,200).replace(/[\u0000-\u001f]/g,'')||'Attachment'};
}
function store(db,access,body,file){const type=body.project_id?'project':body.customer_id?'customer':'global',id=templates.scope(db,access,type,body.project_id||body.customer_id,true),uuid=randomUUID();db.run('INSERT INTO inspection_assets(id,project_id,customer_id,name,mime,content,metadata,created_by) VALUES(?,?,?,?,?,?,?,?)',[uuid,type==='project'?id:null,type==='customer'?id:null,file.name,file.mime,new Uint8Array(file.content),encode(file.metadata),access.user.id]);return {...file,content:undefined,id:uuid};}
function get(db,access,id,projectId){const row=db.get('SELECT * FROM inspection_assets WHERE id=?',[id]);if(!row)fail(404,'Asset not found');templates.checkAsset(db,access,row,projectId);return {...row,metadata:parse(row.metadata)};}
function dataUrl(db,access,id,projectId){if(!id)return '';const a=get(db,access,id,projectId);if(!a.mime.startsWith('image/'))fail(400,'Choose an image for a logo');return 'data:'+a.mime+';base64,'+Buffer.from(a.content).toString('base64');}
module.exports={prepare,store,get,dataUrl};
