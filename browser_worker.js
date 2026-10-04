/* Browser-owned execution. No remotely exposed code runner or server-side secrets. */
const PYODIDE='https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let pyPromise;
async function python(){
  if(!pyPromise)pyPromise=(async()=>{importScripts(PYODIDE+'pyodide.js');return await loadPyodide({indexURL:PYODIDE})})();
  return pyPromise;
}
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function nodeRepo(files,hidden){
  const checks=[];
  function check(name,fn){try{fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:String(error).slice(0,220)})}}
  let checkout,health;
  try{
    let cart={exports:{}};
    new Function('module','exports','require',files['src/cart.js'])(cart,cart.exports,()=>{throw Error('No external packages in browser practice')});
    let route={exports:{}};
    new Function('module','exports','require',files['routes/checkout.js'])(route,route.exports,path=>{
      if(path==='../src/cart')return cart.exports;
      throw Error('Unknown local module '+path);
    });
    ({checkout,health}=route.exports);
  }catch(error){return {ok:false,passed:0,total:0,output:'Module load failed: '+String(error)}}
  const catalog={pen:{priceCents:125},paper:{priceCents:hidden?199:250}};
  const invalid={status:400,body:{error:'invalid cart'}};
  const assert=(got,want)=>{if(!eq(got,want))throw Error('Expected '+JSON.stringify(want)+'; got '+JSON.stringify(got))};
  if(!hidden){
    check('single item, integer cents',()=>assert(checkout([{sku:'pen',quantity:2}],catalog),{status:200,body:{items:[{sku:'pen',quantity:2,lineCents:250}],totalCents:250}}));
    check('duplicate SKU and first-seen order',()=>assert(checkout([{sku:'pen',quantity:2},{sku:'paper',quantity:1},{sku:'pen',quantity:3}],catalog),{status:200,body:{items:[{sku:'pen',quantity:5,lineCents:625},{sku:'paper',quantity:1,lineCents:250}],totalCents:875}}));
    check('reject string quantity',()=>assert(checkout([{sku:'pen',quantity:'2'}],catalog),invalid));
    check('health unchanged',()=>assert(health(),{status:200,body:{status:'ok'}}));
  }else{
    check('missing SKU',()=>assert(checkout([{sku:'missing',quantity:1}],catalog),invalid));
    check('invalid quantities',()=>{for(let quantity of [0,-2,'2oops',1.5,null])assert(checkout([{sku:'pen',quantity}],catalog),invalid)});
    check('empty and malformed cart',()=>{assert(checkout(null,catalog),invalid);assert(checkout([],catalog),{status:200,body:{items:[],totalCents:0}})});
    check('aggregate and cents',()=>assert(checkout([{sku:'paper',quantity:1},{sku:'pen',quantity:2},{sku:'paper',quantity:2}],catalog),{status:200,body:{items:[{sku:'paper',quantity:3,lineCents:597},{sku:'pen',quantity:2,lineCents:250}],totalCents:847}}));
  }
  let passed=checks.filter(x=>x.ok).length;
  return {ok:passed===checks.length,passed,total:checks.length,output:hidden?`Hidden regression tests: ${passed}/${checks.length} passed.`:checks.map(x=>`${x.ok?'PASS':'FAIL'} ${x.name}${x.error?' — '+x.error:''}`).join('\n')};
}
const RUN_CODE=`import json,traceback
payload=json.loads(input_json); namespace={}
try:
    exec(compile(payload['code'],'candidate.py','exec'),namespace)
    func=namespace['solve']; results=[]
    for args,want in payload['cases']:
        try:
            got=func(*args)
            results.append({'ok':got==want,'got':repr(got)[:200],'want':repr(want)[:200]})
        except Exception as error:
            results.append({'ok':False,'got':type(error).__name__+': '+str(error)[:160],'want':repr(want)[:200]})
    output=json.dumps({'results':results})
except Exception:
    output=json.dumps({'error':traceback.format_exc(limit=2)[-700:]})
output`;
const RUN_REPO=`import sys,importlib,unittest,io,json
payload=json.loads(input_json)
base='/dojo_work/'+payload['repo']
sys.dont_write_bytecode=True
for name, module in list(sys.modules.items()):
    if getattr(module,'__file__','') and str(getattr(module,'__file__','')).startswith(('/dojo_work/','/dojo_hidden/')):
        del sys.modules[name]
importlib.invalidate_caches()
if base not in sys.path: sys.path.insert(0,base)
target='/dojo_hidden/'+payload['repo'] if payload['hidden'] else base+'/tests'
suite=unittest.TestLoader().discover(target,pattern='test_*.py')
out=io.StringIO()
result=unittest.TextTestRunner(stream=out,verbosity=2).run(suite)
json.dumps({'ok':result.wasSuccessful() and result.testsRun>0,'passed':result.testsRun-len(result.failures)-len(result.errors),
            'total':result.testsRun,'output':out.getvalue()[-6000:]})`;
function writeFiles(py,repo,files,hiddenText){
  const fs=py.FS;
  for(const [name,text] of Object.entries(files)){
    const path='/dojo_work/'+repo+'/'+name;
    fs.mkdirTree(path.substring(0,path.lastIndexOf('/')));
    fs.writeFile(path,text);
  }
  fs.mkdirTree('/dojo_hidden/'+repo);
  fs.writeFile('/dojo_hidden/'+repo+'/test_hidden.py',hiddenText);
}
self.onmessage=async({data})=>{
  const {id,type,payload}=data;
  try{
    let output;
    if(type==='repo'&&payload.repo==='cart-gateway')output=nodeRepo(payload.files,payload.hidden);
    else{
      const py=await python();
      if(type==='repo')writeFiles(py,payload.repo,payload.files,payload.hiddenText);
      py.globals.set('input_json',JSON.stringify(payload));
      output=JSON.parse(await py.runPythonAsync(type==='code'?RUN_CODE:RUN_REPO));
      if(type==='code'&&payload.hidden&&output.results){
        output={passed:output.results.filter(x=>x.ok).length,total:output.results.length,
                failures:output.results.map((x,i)=>x.ok?null:`Hidden test ${i+1} failed`).filter(Boolean)};
      }
      if(type==='repo'&&payload.hidden)output.output=`Hidden regression tests: ${output.passed}/${output.total} passed.`;
    }
    self.postMessage({id,output});
  }catch(error){self.postMessage({id,output:{error:String(error).slice(0,600)}})}
};
