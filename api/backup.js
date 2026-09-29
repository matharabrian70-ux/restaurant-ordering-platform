import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const databaseUrl=String(process.env.DATABASE_URL||'').trim();
if(!databaseUrl) throw new Error('DATABASE_URL is required');
const dir=process.env.BACKUP_DIR||'./backups';
fs.mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const file=path.resolve(dir,`restaurant-ordering-${stamp}.dump`);
const result=spawnSync('pg_dump',['--format=custom','--no-owner','--no-privileges','--file',file,databaseUrl],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(`Backup written to ${file}`);
