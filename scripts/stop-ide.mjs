import { execFileSync } from 'node:child_process';
const ids=execFileSync('docker',['ps','-q','--filter','label=syncstudio.workspace=true'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
if(ids.length)execFileSync('docker',['stop','--time','10',...ids],{stdio:'inherit'});
execFileSync('docker',['compose','-f','compose.ide.yaml','down'],{stdio:'inherit'});
console.log('SyncStudio stopped. Workspace volumes are preserved.');
