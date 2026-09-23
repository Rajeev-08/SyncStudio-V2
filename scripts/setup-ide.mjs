import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
let env='';try{env=await readFile('.env','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
if(!/^RUNNER_SECRET=.+$/m.test(env)) {
  env=env.replace(/^RUNNER_SECRET=.*\n?/gm,'');
  await writeFile('.env',env+'\nRUNNER_SECRET='+randomBytes(48).toString('hex')+'\n',{mode:0o600});
}
console.log('Configuration ready. Run:\n  docker compose -f compose.ide.yaml --profile images build\n  docker compose -f compose.ide.yaml up -d\nOpen http://localhost:3001 and create an account.');
