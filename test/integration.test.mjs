import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
const pause=()=>new Promise(r=>setTimeout(r,20));
async function start(dir,env={}){const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,LLM_API_KEY:'',OPENAI_API_KEY:'',DATA_DIR:dir,PORT:'0',...env},stdio:['ignore','pipe','pipe']});let url='';for await(const chunk of child.stdout){const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){url=m[0];break;}}if(!url)throw Error('Server did not start');return {child,url};}
async function stop(child){if(child.exitCode===null){child.kill();await once(child,'exit');}}
async function request(base,url,body){const res=await fetch(base+url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});return {status:res.status,data:await res.json()};}
async function wait(base,id,status){for(let i=0;i<150;i++){const {data}=await request(base,`/api/runs/${id}`);if(data.status===status)return data;await pause();}throw Error(`Timed out waiting for ${status}`);}
test('real tools: approval, denial, checkpoint retry, persistence and origin protection',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'trace-test-'));let server=await start(dir);try{
 let a=await request(server.url,'/api/runs',{prompt:'计算 12*8\n计算 1/0',mode:'local',confirmTools:true});const id=a.data.id;
 let r=await wait(server.url,id,'waiting');assert.equal(r.steps[0].attempts,0);
 assert.equal((await request(server.url,`/api/runs/${id}/approve`,{stepId:'wrong'})).status,409);
 await request(server.url,`/api/runs/${id}/approve`,{stepId:r.steps[0].id});r=await wait(server.url,id,'waiting');assert.equal(r.steps[0].result.value,96);assert.equal(r.steps[1].attempts,0);
 await request(server.url,`/api/runs/${id}/approve`,{stepId:r.steps[1].id});r=await wait(server.url,id,'failed');assert.match(r.error,/零/);
 await request(server.url,`/api/runs/${id}/retry`,{stepId:r.steps[1].id});r=await wait(server.url,id,'waiting');assert.equal(r.steps[0].attempts,1);
 await request(server.url,`/api/runs/${id}/approve`,{stepId:r.steps[1].id});r=await wait(server.url,id,'failed');assert.equal(r.steps[1].attempts,2);assert.equal(r.steps[0].attempts,1);assert.equal(r.usage,null);
 const audit=await request(server.url,`/api/runs/${id}/events`);assert.equal(audit.data.filter(e=>e.type==='tool.failed').length,2);assert.ok(audit.data.every((e,i)=>i===0||e.seq>audit.data[i-1].seq));
 a=await request(server.url,'/api/runs',{prompt:'读取 https://127.0.0.1',mode:'local'});r=await wait(server.url,a.data.id,'waiting');await stop(server.child);server=await start(dir);r=await wait(server.url,a.data.id,'waiting');assert.equal(r.steps[0].attempts,0);
 await request(server.url,`/api/runs/${r.id}/approve`,{stepId:r.steps[0].id});r=await wait(server.url,r.id,'failed');assert.match(r.error,/策略阻止/);
 a=await request(server.url,'/api/runs',{prompt:'读取 https://example.com',mode:'local'});r=await wait(server.url,a.data.id,'waiting');await request(server.url,`/api/runs/${r.id}/reject`,{stepId:r.steps[0].id});r=await wait(server.url,r.id,'rejected');assert.equal(r.steps[0].attempts,0);
 assert.equal((await request(server.url,`/api/runs/${r.id}/approve`,{stepId:r.steps[0].id})).status,409);
 assert.equal((await fetch(server.url+'/api/runs',{method:'POST',headers:{Origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
 a=await request(server.url,'/api/runs',{prompt:'计算 (1280*3)*0.85',mode:'local'});r=await wait(server.url,a.data.id,'completed');assert.equal(r.result,'(1280*3)*0.85 = 3264');
 const sse=await fetch(server.url+'/api/events');const reader=sse.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/event: update/);await reader.cancel();
 assert.equal((await request(server.url,'/api/runs',{prompt:'hello',mode:'model'})).status,409);
 }finally{await stop(server.child);await rm(dir,{recursive:true,force:true});}});
test('model protocol contract uses isolated fixture, actual tool execution and provider usage',async()=>{let calls=0;const fixture=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const payload=JSON.parse(raw);calls++;let message;if(calls===1){assert.equal(payload.tool_choice.function.name,'create_plan');message={role:'assistant',content:null,tool_calls:[{id:'plan1',type:'function',function:{name:'create_plan',arguments:'{"steps":["Calculate"]}'}}]};}else if(calls===2){assert.equal(payload.messages.at(-1).role,'tool');message={role:'assistant',content:null,tool_calls:[{id:'calc1',type:'function',function:{name:'calculator',arguments:'{"expression":"6*7"}'}}]};}else{assert.equal(JSON.parse(payload.messages.at(-1).content).value,42);message={role:'assistant',content:'42'};}res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));});fixture.listen(0,'127.0.0.1');await once(fixture,'listening');const dir=await mkdtemp(path.join(tmpdir(),'trace-contract-'));const server=await start(dir,{LLM_API_KEY:'test-only',LLM_BASE_URL:`http://127.0.0.1:${fixture.address().port}`,LLM_MODEL:'isolated-test-fixture'});try{const {data}=await request(server.url,'/api/runs',{prompt:'6*7',mode:'model'});const r=await wait(server.url,data.id,'completed');assert.equal(r.result,'42');assert.deepEqual(r.usage,{input:30,output:15,total:45});assert.equal(r.steps[1].result.value,42);assert.equal(calls,3);}finally{await stop(server.child);fixture.close();await rm(dir,{recursive:true,force:true});}});
