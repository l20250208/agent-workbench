import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
export function calculate(expression) {
  if(typeof expression !== 'string' || expression.length > 500) throw Error('表达式须为 1–500 个字符');
  const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%^]/gi)||[];
  if(tokens.join('')!==expression.replace(/\s/g,'') || !tokens.length || tokens.length>200) throw Error('仅支持数字、括号和 + − * / % ^');
  let i=0;
  function atom(){let t=tokens[i++]; if(t==='('){const v=expr();if(tokens[i++]!==')')throw Error('括号不匹配');return v;}if(!t||!/^\d|^\./.test(t))throw Error('表达式无效');return Number(t);}
  function power(){let v=atom();if(tokens[i]==='^'){i++;v=v**unary();}return v;}
  function unary(){if(tokens[i]==='+'){i++;return unary();}if(tokens[i]==='-'){i++;return -unary();}return power();}
  function term(){let v=unary();while(['*','/','%'].includes(tokens[i])){let op=tokens[i++],b=unary();if(b===0&&op!=='*')throw Error('不能除以零');v=op==='*'?v*b:op==='/'?v/b:v%b;}return v;}
  function expr(){let v=term();while(['+','-'].includes(tokens[i])){let op=tokens[i++],b=term();v=op==='+'?v+b:v-b;}return v;}
  const value=expr();if(i!==tokens.length||!Number.isFinite(value))throw Error('表达式无效或结果溢出');return {expression,value};
}
export function isPublicIPv4(ip){if(isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);}
export function validateURL(raw,allowed){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||isIP(u.hostname)||!allowed.includes(u.hostname))throw Error('网页访问被策略阻止：仅允许白名单域名的 HTTPS 地址');return u;}
export async function readWeb(raw,allowed,signal){
 const u=validateURL(raw,allowed);
 const addresses=await lookup(u.hostname,{all:true,family:4});
 if(!addresses.length||addresses.some(a=>!isPublicIPv4(a.address)))throw Error('目标解析到非公开地址，已阻止');
 const body=await new Promise((resolve,reject)=>{
 const req=https.get(u,{signal,agent:false,lookup:(_h,options,cb)=>options.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4),headers:{'User-Agent':'AgentWorkbench/1.0','Accept':'text/html,text/plain','Accept-Encoding':'identity'}},res=>{
 if(res.statusCode!==200){res.resume();return reject(Error(`网页 HTTP ${res.statusCode}（禁止自动重定向）`));}
 if(!/^text\/(html|plain)/i.test(res.headers['content-type']||'')){res.resume();return reject(Error('只允许 HTML 或纯文本网页'));}
 let n=0,chunks=[];res.on('data',b=>{n+=b.length;if(n>512000)res.destroy(Error('网页超过 500 KB 限制'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
 });req.setTimeout(12000,()=>req.destroy(Error('网页读取超时')));req.on('error',reject);
 });
 const text=body.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
 return {url:u.href,text:text.slice(0,16000),truncated:text.length>16000,fetchedAt:new Date().toISOString()};
}
export const schemas=[
 {type:'function',function:{name:'create_plan',description:'Create a brief user-visible task plan before using tools. Not private reasoning.',parameters:{type:'object',properties:{steps:{type:'array',items:{type:'string'},minItems:1,maxItems:8}},required:['steps'],additionalProperties:false}}},
 {type:'function',function:{name:'calculator',description:'Evaluate a numeric arithmetic expression. Operators + - * / % ^ and parentheses.',parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression'],additionalProperties:false}}},
 {type:'function',function:{name:'read_web',description:'Read a public HTTPS page on an allowed hostname. Requires human approval.',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}}}
];
