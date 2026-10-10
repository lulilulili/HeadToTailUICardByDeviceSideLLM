import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArgumentsPrompt,buildUnifiedPrompt} from '../src/prompts.mjs';
import {getCapability} from '../src/registry.mjs';
import {validateValue} from '../src/providers.mjs';
const humidity=getCapability('weather.current.humidity');
test('unknown user inputs can be absent instead of mandatory null slots',()=>{
 const prompt=buildArgumentsPrompt('湿度呢？',humidity);
 assert.deepEqual(prompt.schema.required,[]);
 assert.equal(validateValue(prompt.schema,{}).valid,true);
 assert.match(prompt.messages[0].content,/没说.*不输出|未.*省略/);
});
test('a text place never asks the model for coordinates, while explicit coordinates remain extractable',()=>{
 const city=buildArgumentsPrompt('杭州现在湿度多少',humidity);
 assert.equal(Object.hasOwn(city.schema.properties,'coordinates'),false);
 assert.equal(validateValue(city.schema,{location:'杭州',time_ref:'现在'}).valid,true);
 const coordinates=buildArgumentsPrompt('纬度31.2经度121.4现在湿度多少',humidity);
 assert.ok(coordinates.schema.properties.coordinates);
 assert.equal(Object.hasOwn(coordinates.schema.properties,'location'),false);
 assert.equal(validateValue(coordinates.schema,{coordinates:{latitude:31.2,longitude:121.4},time_ref:'现在'}).valid,true);
});
test('field queries without a time expression do not ask for model time placeholders',()=>{
 const prompt=buildArgumentsPrompt('读取日程ev_42的标题',getCapability('calendar.event.title'));
 assert.equal(Object.hasOwn(prompt.schema.properties,'time_ref'),false);
 const timed=buildArgumentsPrompt('明天下午的日程标题',getCapability('calendar.event.title'));
 assert.ok(timed.schema.properties.time_ref);
});
test('a month and day without an explicit year remains an extractable date',()=>{
 const prompt=buildArgumentsPrompt('南京10月12日的日出时间',getCapability('weather.daily.sun.sunrise'));
 assert.ok(prompt.schema.properties.time_ref);
 assert.equal(validateValue(prompt.schema,{location:'南京',time_ref:'10月12日'}).valid,true);
});
test('unmentioned strict precision policy is completed by code rather than forced model output',()=>{
 const regular=buildArgumentsPrompt('明天湿度多少',humidity);
 assert.equal(Object.hasOwn(regular.schema.properties,'strict_time'),false);
 const strict=buildArgumentsPrompt('明天三点十五湿度，禁止降低精度',humidity);
 assert.ok(strict.schema.properties.strict_time);
});
test('unified candidates use sparse extraction without weakening domain and API selection',()=>{
 const prompt=buildUnifiedPrompt('查当前日程标题');
 for(const branch of prompt.schema.oneOf) {
  assert.deepEqual(branch.required,['domain','api','arguments']);
  assert.deepEqual(branch.properties.arguments.required??[],[]);
 }
});
test('compact unified prompts retain coordinate axis meanings',()=>{
 const prompt=buildUnifiedPrompt('纬度31.2经度121.5当前湿度');
 assert.match(prompt.messages[0].content,/latitude=纬度.*longitude=经度/);
});
test('compact cloud prompts distinguish an object path from a named bucket',()=>{
 const prompt=buildUnifiedPrompt('下载云文件backups/full.zip到本地');
 assert.match(prompt.messages[0].content,/cloud_path=.*路径/);
 assert.match(prompt.messages[0].content,/bucket=.*桶/);
});
