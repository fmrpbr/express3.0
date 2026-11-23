import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative, sep, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root=resolve('.');
for(const name of Object.keys(process.env)) if(/proxy/i.test(name)) delete process.env[name];
process.env.FUNCTIONS_EMULATOR = "true";
process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "127.0.0.1:9000";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
const env={...process.env};
// O navegador usa o emulador HTTP local e o mesmo command handler transacional da função.
const express = require('../functions/node_modules/express');
const callable = express();
callable.use((req,res,next)=>{
  const origin=req.get('origin');
  if(origin==='http://127.0.0.1:8080')res.set('Access-Control-Allow-Origin',origin);
  res.set('Vary','Origin');
  res.set('Access-Control-Allow-Methods','POST');
  res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-Firebase-AppCheck, X-Firebase-GMPID');
  next();
});
callable.use(express.json());
const admin = require('../functions/node_modules/firebase-admin');
const browserApp = admin.initializeApp({projectId:'demo-express-entregas-browser',databaseURL:'https://demo-express-entregas-browser-default-rtdb.firebaseio.com'},'browser-harness');
const execute = require('../functions/commands').createCommandHandler(browserApp.database());
const notificationTools = require('../functions/notification-tools').createNotificationTools(browserApp.database(),()=>({vapidPublicKey:''}));
const callableHandler = async (req,res,handler) => {
  try {
    const authorization=req.get('authorization')||'';
    const token=authorization.startsWith('Bearer ')?await browserApp.auth().verifyIdToken(authorization.slice(7)):null;
    const result=await handler(token?{uid:token.uid,token}:null,req.body?.data||{});
    res.json({data:result});
  } catch(error) {
    const status=String(error.code||'internal').replaceAll('-','_').toUpperCase();
    res.json({error:{status,message:error.message||'Falha no backend de homologação.'}});
  }
};
const commandPath='/demo-express-entregas-browser/southamerica-east1/orderCommand';
const notificationPath='/demo-express-entregas-browser/southamerica-east1/notificationTools';
for(const path of [commandPath,notificationPath])callable.options(path,(req,res)=>res.status(204).end());
callable.post(commandPath,(req,res)=>callableHandler(req,res,execute));
callable.post(notificationPath,(req,res)=>callableHandler(req,res,notificationTools));
const callableServer = callable.listen(5001, '127.0.0.1');
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/www/firebase-config.js') {
    const source=(await readFile('www/firebase-config.example.js','utf8')).replaceAll('express-entregas-2-testes', 'demo-express-entregas-browser').replace('vapidPublicKey: ""','useEmulators: true, vapidPublicKey: ""');
    res.setHeader('Content-Type','application/javascript');res.end(source);return;
  }
  if(pathname.startsWith('/rastreio/')) {
    const policy=JSON.parse(await readFile('firebase.json','utf8')).hosting.headers[0].headers;
    for(const header of policy) res.setHeader(header.key,header.value.replace("connect-src ","connect-src http://127.0.0.1:9000 ws://127.0.0.1:9000 "));
    const name=pathname.endsWith('/')?'index.html':pathname.split('/').pop();
    if(!['index.html','app.js','style.css'].includes(name)){res.writeHead(404).end();return;}
    let source=await readFile('public-tracking/rastreio/'+name,'utf8');
    if(name==='app.js') source=source.replaceAll('express-entregas-2-testes','demo-express-entregas-browser');
    res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(source);return;
  }
  const file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  const relativeFile=relative(root,file);
  if(relativeFile==='..'||relativeFile.startsWith(`..${sep}`)||isAbsolute(relativeFile)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
server.listen(8080,'127.0.0.1',()=>{
  const args=['node_modules/@playwright/test/cli.js','test'];
  if(process.env.EXPRESS_BROWSER_TEST_GREP) args.push('--grep',process.env.EXPRESS_BROWSER_TEST_GREP);
  const child=spawn(process.execPath,args,{stdio:'inherit',env});
  child.on('exit',code=>{server.close();callableServer.close();process.exit(code||0);});
});
