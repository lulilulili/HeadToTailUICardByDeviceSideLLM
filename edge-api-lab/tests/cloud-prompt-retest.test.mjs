import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUnifiedPrompt,buildArgumentsPrompt} from '../src/prompts.mjs';
import {getCapability} from '../src/registry.mjs';
import {validateValue} from '../src/providers.mjs';

test('preload extraction explains each Chinese mode without inventing a missing mode',()=>{
 const prompt=buildArgumentsPrompt('读取安装预加载的时间戳',getCapability('cloud.prefetch.timestamp'));
 assert.match(prompt.messages[0].content,/安装(?:=|→)install/);
 assert.match(prompt.messages[0].content,/周期(?:=|→)periodic/);
 assert.match(prompt.messages[0].content,/跳链(?:=|→)link/);
 assert.equal(validateValue(prompt.schema,{}).valid,true);
 assert.equal(validateValue(prompt.schema,{mode:'install'}).valid,true);
 assert.equal(validateValue(prompt.schema,{mode:'安装'}).valid,false);
});
test('database prompt separates statistics from single-record reads and keeps field identity',()=>{
 const text='对云数据库Measurements表sampleValue字段求最大值，区域labWest';
 const prompt=buildUnifiedPrompt(text),system=prompt.messages[0].content;
 assert.ok(prompt.promptMeta.candidates.ids.includes('cloud.database.calculate'));
 assert.match(system,/cloud\.database\.field.*单记录/);
 assert.match(system,/cloud\.database\.calculate.*统计/);
 assert.match(system,/field_name.*(?:不写表达式|不改成函数表达式)/);
 assert.match(system,/zone=.*数据库区域/);
 assert.equal(prompt.messages[1].content,text);
});
test('cloud storage prompt distinguishes returning a link from file transfer and copying paths',()=>{
 const prompt=buildArgumentsPrompt('下载云文件archive/r.csv到本地E:/results/r.csv，存储实例coldStore',getCapability('cloud.storage.download'));
 assert.match(prompt.messages[0].content,/download_url.*(?:只取|返回).*地址/);
 assert.match(prompt.messages[0].content,/download.*(?:本地|下载文件)/);
 assert.match(prompt.messages[0].content,/路径原样.*(?:补|添加).*\//);
});
