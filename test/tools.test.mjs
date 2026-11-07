import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,isPublicIPv4,validateURL} from '../tools.mjs';
test('arithmetic precedence, unary, powers and decimals',()=>{for(const [s,v] of [['(1280 * 3) * 0.85',3264],['-2^2',-4],['2^-3',.125],['2^3^2',512],['1e2 + .5',100.5],['7%4',3]])assert.equal(calculate(s).value,v);});
test('reject code execution, malformed input and nonfinite values',()=>{for(const s of ['process.exit()','1;2','1/0','2**3','(2+3','1 2','1e999','9^999',''])assert.throws(()=>calculate(s));});
test('SSRF: exact hostname, HTTPS only, no credentials or alternate ports',()=>{for(const u of ['http://example.com','https://example.com.evil.test','https://127.0.0.1','https://u:p@example.com','https://example.com:8443','file:///etc/passwd','https://[::1]'])assert.throws(()=>validateURL(u,['example.com']));assert.equal(validateURL('https://example.com/path',['example.com']).pathname,'/path');});
test('SSRF: reject nonpublic IPv4 and all IPv6 addresses',()=>{for(const ip of ['127.0.0.1','10.0.0.2','169.254.169.254','172.16.0.1','192.168.0.1','100.64.1.2','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isPublicIPv4(ip),false,ip);assert.equal(isPublicIPv4('93.184.215.14'),true);});
