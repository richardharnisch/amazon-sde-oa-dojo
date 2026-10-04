/* GitHub Pages adapter: all mutable data and code execution stay in this browser. */
const nativeFetch=window.fetch.bind(window);
const STORE='amazon-dojo-hosted-v1';
let dataPromise=nativeFetch('./data.json').then(async r=>{if(!r.ok)throw Error('Practice data did not load');return await r.json()});
let worker,serial=0,pending=new Map();
function bootWorker(){
  if(worker)return worker;
  worker=new Worker('./browser_worker.js');
  worker.onmessage=({data})=>{let job=pending.get(data.id);if(job){pending.delete(data.id);clearTimeout(job.timer);job.resolve(data.output)}};
  worker.onerror=e=>{for(let job of pending.values()){clearTimeout(job.timer);job.reject(Error('Browser worker failed: '+e.message))}pending.clear();worker.terminate();worker=null};
  return worker;
}
function execute(type,payload){return new Promise((resolve,reject)=>{
  let w=bootWorker(),id=++serial;
  // First Python run downloads Pyodide; subsequent runs have a shorter budget.
  const timer=setTimeout(()=>{pending.delete(id);w.terminate();worker=null;reject(Error('Code took too long; worker restarted.'))},45000);
  pending.set(id,{resolve,reject,timer});w.postMessage({id,type,payload});
})}
const initial=()=>({attempts:[],sessions:{},answers:{},style:{},diagnostic:false,mock:null,notes:{},workspaces:{},backups:[]});
function load(){try{return Object.assign(initial(),JSON.parse(localStorage.getItem(STORE)||'{}'))}catch{return initial()}}
function persist(s){localStorage.setItem(STORE,JSON.stringify(s))}
const now=()=>Date.now()/1000;
function secs(m){if(!m)return null;return Math.max(0,({coding:6000,simulation:2700,style:360,done:0}[m.phase]||0)-Math.floor(now()-m.phase_start))}
function allowed(s,kind,id,d){let m=s.mock;if(!m||m.phase==='done')return true;
  let c=d.catalog.mocks.find(x=>x.id===m.id);
  return secs(m)>0&&((m.phase==='coding'&&((kind==='coding'&&id===c.coding)||(kind==='repo'&&id===c.repo)))||
    (m.phase==='simulation'&&kind==='simulation'&&c.sim.includes(id))||
    (m.phase==='style'&&kind==='style'&&c.style.includes(id)));
}
function stats(s,d){
  let a=s.attempts,areas={};
  for(let kind of ['coding','repo','simulation']){
    let rows=a.filter(x=>x.kind===kind);
    areas[kind]={attempted:rows.length,accuracy:rows.length?Math.round(100*rows.reduce((n,x)=>n+x.score,0)/rows.length):null,minutes:Math.round(rows.reduce((n,x)=>n+x.seconds,0)/6)/10};
  }
  areas.style={attempted:Object.keys(s.style).length,accuracy:null,minutes:null};
  let tagScores={};for(let x of a.filter(x=>x.kind==='coding')){
    for(let tag of d.private.coding[x.id].tags)(tagScores[tag]??=[]).push(x.score);
  }
  let weak_tags=Object.entries(tagScores).map(([k,v])=>[k,Math.round(100*v.reduce((n,x)=>n+x,0)/v.length)/100]).sort((a,b)=>a[1]-b[1]).slice(0,6);
  let latest=Object.fromEntries(a.map(x=>[x.id,x])),missing=d.catalog.coding.filter(x=>!latest[x.id]),missed=d.catalog.coding.filter(x=>latest[x.id]&&latest[x.id].score<1);
  let repo=d.catalog.repos.find(x=>latest[x.id]&&latest[x.id].score<1),sim=d.catalog.simulation.find(x=>latest[x.id]&&latest[x.id].score<1);
  let next;
  if(!s.diagnostic)next={kind:'diagnostic',id:'start',reason:'First measure coding, repository navigation and judgment. Begin the guided diagnostic.'};
  else if(!a.some(x=>x.kind==='coding'&&x.id==='undo-batches'))next={kind:'coding',id:'undo-batches',reason:'Complete the diagnostic coding drill and classify the failure.'};
  else if(!a.some(x=>x.kind==='repo'))next={kind:'repo',id:'quota-service',reason:'The repository/AI half is new and unmeasured.'};
  else if(!a.some(x=>x.kind==='simulation'))next={kind:'simulation',id:'prod',reason:'Get a judgment baseline.'};
  else if(!s.style.ws1||!s.style.ws2)next={kind:'style',id:!s.style.ws1?'ws1':'ws2',reason:'Finish the ungraded Work Style diagnostic.'};
  else if(repo)next={kind:'repo',id:repo.id,reason:'Repair your weak repository task: reproduce, trace files, check AI assumptions, rerun tests.'};
  else if(missed.length){let x=missed.sort((a,b)=>b.priority-a.priority)[0];next={kind:'coding',id:x.id,reason:`Revisit ${latest[x.id].error||'implementation and edge cases'} with a strict timer.`}}
  else if(sim)next={kind:'simulation',id:sim.id,reason:'Review customer impact, evidence and reversibility in a missed scenario.'};
  else if(missing.length){let x=missing.sort((a,b)=>b.priority-a.priority)[0];next={kind:'coding',id:x.id,reason:'Try an unattempted high-yield pattern.'}}
  else next={kind:'mock',id:'mock-b',reason:'Integrate your skills under a shared timer.'};
  return {areas,weak_tags,next,weaknesses:Object.values(latest).filter(x=>x.score<1).map(x=>({id:x.id,kind:x.kind,cause:x.error}))};
}
function fileName(d,repo,name){if(!d.templates[repo]||!Object.hasOwn(d.templates[repo],name)||!/[.]((py)|(js)|(md))$/.test(name))throw Error('Invalid workspace file');return name}
function workspace(s,d,repo){if(!d.templates[repo])throw Error('Unknown repo');return s.workspaces[repo]??={}}
function fullFiles(s,d,repo){return {...d.templates[repo],...workspace(s,d,repo)}}
const inspect=(d,kind,id)=>({coding:d.private.coding,repo:d.private.repos,simulation:d.private.simulation})[kind]?.[id];
async function api(method,url,v){
  let d=await dataPromise,s=load(),path=url.pathname,q=url.searchParams,id=v?.id,kind=v?.kind,result,changed=false,time=now();
  if(method==='GET'){
    if(path==='/api/catalog')return d.catalog;
    if(path==='/api/state')return {state:s,mastery:stats(s,d),remaining:secs(s.mock)};
    if(path==='/api/files'){let repo=q.get('id');return {files:Object.keys(fullFiles(s,d,repo)).filter(x=>/[.](py|js|md)$/.test(x)).sort()}}
    if(path==='/api/file'){let repo=q.get('id'),name=fileName(d,repo,q.get('file'));return {text:fullFiles(s,d,repo)[name]}}
    if(path==='/api/debrief'){
      let type=q.get('kind'),name=q.get('id'),m=s.mock,x=inspect(d,type,name);
      if(!x)throw Error('Unknown exercise');
      if(m&&m.phase!=='done')throw Error('Finish the full mock before viewing debrief.');
      if(type==='simulation'&&!Object.hasOwn(s.answers,name))throw Error('Answer before viewing rationale.');
      if(type!=='simulation'&&!s.attempts.some(a=>a.kind===type&&a.id===name))throw Error('Submit before viewing reference.');
      return x;
    }
    throw Error('Not found');
  }
  if(path==='/api/diagnostic'){
    s.diagnostic=true;changed=true;result={path:['undo-batches','quota-service','prod','ws1','ws2'],instructions:'Try the coding drill, a repository repair, a judgment scenario and two honest Work Style choices.'};
  }else if(path==='/api/mock/start'){
    let config=d.catalog.mocks.find(x=>x.id===id);if(!config)throw Error('Unknown mock');
    if(s.mock&&s.mock.phase!=='done')throw Error('Finish active mock first');
    if(s.workspaces[config.repo])s.backups.push({repo:config.repo,at:time,files:s.workspaces[config.repo]});
    s.workspaces[config.repo]={};s.mock={id,phase:'coding',phase_start:time,started:time,events:[]};changed=true;result={mock:s.mock};
  }else if(path==='/api/mock/advance'){
    let m=s.mock;if(!m||m.phase==='done')throw Error('No active mock phase');
    let c=d.catalog.mocks.find(x=>x.id===m.id);
    if(m.phase==='coding'){
      for(let [type,name] of [['coding',c.coding],['repo',c.repo]]){
        if(!m.events.some(x=>x.kind===type&&x.id===name))m.events.push({kind:type,id:name,score:0,seconds:Math.floor(time-m.phase_start),error:'Not submitted'});
      }m.phase='simulation';
    }else if(m.phase==='simulation'){
      for(let name of c.sim)if(!m.events.some(x=>x.kind==='simulation'&&x.id===name))m.events.push({kind:'simulation',id:name,score:0,seconds:0,error:'Skipped'});
      m.phase='style';
    }else{m.phase='done';m.finished=time}
    m.phase_start=time;changed=true;result={mock:m,remaining:secs(m)};
  }else if(path==='/api/start'){
    if(!['coding','repo'].includes(kind)||!inspect(d,kind,id)||!allowed(s,kind,id,d))throw Error('Task unavailable in active mock');
    s.sessions[kind+':'+id]=time;if(kind==='repo')workspace(s,d,id);changed=true;result={started:time};
  }else if(path==='/api/code'){
    let x=inspect(d,'coding',id);if(!x||!allowed(s,'coding',id,d))throw Error('Coding task unavailable');
    if(typeof v.code!=='string'||v.code.length>50000)throw Error('Code must be under 50 KB');
    let visible=await execute('code',{code:v.code,cases:x.cases,hidden:false});
    if(v.submit){
      let hidden=await execute('code',{code:v.code,cases:x.hidden,hidden:true});
      let total=x.cases.length+x.hidden.length,passed=(visible.results||[]).filter(r=>r.ok).length+(hidden.passed||0);
      let attempt={kind:'coding',id,score:passed/total,seconds:Math.floor(time-(s.sessions['coding:'+id]||time)),error:v.error||((passed<total)?'Implementation / edge cases / complexity':''),hint_used:v.hint_used||0,at:time};
      s.attempts.push(attempt);if(s.mock?.phase==='coding')s.mock.events.push(attempt);
      changed=true;result={visible,hidden,attempt};
    }else result={visible};
  }else if(path==='/api/file'){
    let name=fileName(d,id,v.file);if(!allowed(s,'repo',id,d))throw Error('Repo task unavailable');
    if(name==='README.md'||name.startsWith('tests/')||name.startsWith('docs/'))throw Error('Supplied tests and specifications are read-only in the browser.');
    if(typeof v.text!=='string'||v.text.length>50000)throw Error('File too long');
    workspace(s,d,id)[name]=v.text;changed=true;result={saved:name};
  }else if(path==='/api/repo'){
    let x=inspect(d,'repo',id);if(!x||!allowed(s,'repo',id,d))throw Error('Repo task unavailable');
    let files=fullFiles(s,d,id),visible=await execute('repo',{repo:id,files,hidden:false,hiddenText:d.hiddenTests[id]});
    if(v.submit){
      let hidden=await execute('repo',{repo:id,files,hidden:true,hiddenText:d.hiddenTests[id]});
      let total=visible.total+hidden.total,passed=visible.passed+hidden.passed;
      let attempt={kind:'repo',id,score:total?passed/total:0,seconds:Math.floor(time-(s.sessions['repo:'+id]||time)),error:v.error||((passed<total)?'Repository navigation / debugging / verification':''),ai_note:v.ai_note||'',at:time};
      s.attempts.push(attempt);if(s.mock?.phase==='coding')s.mock.events.push(attempt);
      changed=true;result={visible,hidden,attempt};
    }else result={visible};
  }else if(path==='/api/sim'){
    let x=inspect(d,'simulation',id);if(!x||!allowed(s,'simulation',id,d))throw Error('Simulation unavailable');
    let choice=v.choice,good;
    if(x.format==='rate'){
      if(!Array.isArray(choice)||choice.length!==4||choice.some(n=>!Number.isInteger(n)||n<1||n>5))throw Error('Rate each action 1–5');
      good=choice[x.best]===Math.max(...choice)&&choice.filter(n=>n===choice[x.best]).length===1;
    }else{
      if(!Number.isInteger(choice)||choice<0||choice>=x.options.length)throw Error('Invalid choice');
      good=choice===x.best;
    }
    s.answers[id]=choice;let attempt={kind:'simulation',id,score:Number(good),seconds:v.seconds||0,error:good?'':'Judgment / prioritization',at:time};
    s.attempts.push(attempt);if(s.mock?.phase==='simulation')s.mock.events.push(attempt);
    changed=true;result={choice,best:s.mock?.phase==='done'||!s.mock?x.best:null};
  }else if(path==='/api/style'){
    if(!d.catalog.style.some(x=>x.id===id)||!allowed(s,'style',id,d))throw Error('Survey unavailable');
    if(!['left strong','left slight','right slight','right strong'].includes(v.choice))throw Error('Invalid choice');
    s.style[id]=v.choice;changed=true;result={saved:true};
  }else if(path==='/api/notes'){
    s.notes[id]=(v.text||'').slice(0,1000);changed=true;result={saved:true};
  }else throw Error('Not found');
  if(changed)persist(s);
  return result;
}
window.fetch=async function(input,options={}){
  let path=typeof input==='string'?input:input.url;
  if(!path.startsWith('/api/'))return nativeFetch(input,options);
  let url=new URL(path,location.href),method=options.method||'GET';
  try{
    let output=await api(method,url,options.body?JSON.parse(options.body):{});
    return new Response(JSON.stringify(output),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(error){return new Response(JSON.stringify({error:String(error.message||error)}),{status:400,headers:{'Content-Type':'application/json'}})}
};
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#export-progress').onclick=()=>{
    let values={};for(let i=0;i<localStorage.length;i++){
      let key=localStorage.key(i);if(key===STORE||key.startsWith('code:')||key.startsWith('ai:'))values[key]=localStorage.getItem(key);
    }
    let url=URL.createObjectURL(new Blob([JSON.stringify(values,null,2)],{type:'application/json'}));
    let a=document.createElement('a');a.href=url;a.download='amazon-dojo-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  document.querySelector('#import-progress').onclick=()=>document.querySelector('#progress-file').click();
  document.querySelector('#progress-file').onchange=async event=>{
    try{
      let values=JSON.parse(await event.target.files[0].text());
      if(!values||typeof values[STORE]!=='string')throw Error('Not a dojo progress file');
      if(!confirm('Import will replace this browser’s dojo progress and code drafts. Continue?'))return;
      for(let [key,value] of Object.entries(values))if((key===STORE||key.startsWith('code:')||key.startsWith('ai:'))&&typeof value==='string')localStorage.setItem(key,value);
      location.reload();
    }catch(error){alert('Import failed: '+error.message)}
  };
});
