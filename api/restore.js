import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const databaseUrl=String(process.env.DATABASE_URL||'').trim();
const file=String(process.argv[2]||'').trim();
if(!databaseUrl||!file) throw new Error('Usage: npm run restore -- path/to/backup.dump');
if(!fs.existsSync(file)) throw new Error(`Backup file not found: ${file}`);
console.warn('Restoring a database is destructive to the target state. Confirm the target DATABASE_URL before continuing.');
const result=spawnSync('pg_restore',['--clean','--if-exists','--no-owner','--no-privileges','--dbname',databaseUrl,file],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log('Database restore completed.');
