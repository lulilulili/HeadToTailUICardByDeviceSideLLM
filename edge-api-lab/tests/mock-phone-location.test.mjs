import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildContext} from '../public/context-builder.mjs';
import {renderRun} from '../public/run-view.mjs';
import {resolveArguments} from '../src/resolver.mjs';
import {getCapability} from '../src/registry.mjs';

const now='2026-10-10T08:00:00+08:00',timezone='Asia/Shanghai';
const computerGPS={latitude:48.85,longitude:2.35,source:'browser',accuracy:15,capturedAt:'2026-10-10T00:00:00Z'};

test('the PC UI offers only simulated phone fixture coarse and absent location modes',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const modes=html.match(/<select id="location-mode">([\s\S]*?)<\/select>/)?.[1];
 assert.ok(modes);
 assert.deepEqual([...modes.matchAll(/value="([^"]+)"/g)].map(match=>match[1]),['fixture','coarse','none']);
 assert.match(html,/模拟手机当前位置（上海固定坐标）/);
 assert.match(html,/模拟手机当前位置（上海粗位置）/);
 assert.match(html,/不读取电脑位置/);
 assert.doesNotMatch(html,/id="get-location"|浏览器授权位置/);
});

test('interactive browser code has no computer location API or capture handler',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const builder=await readFile(new URL('../public/context-builder.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(app,/navigator\.geolocation|getCurrentPosition|get-location|browserLocation|locationFresh/);
 assert.doesNotMatch(builder,/navigator\.geolocation|getCurrentPosition|browserLocation|locationFresh/);
 assert.match(app,/不读取电脑位置/);
});

test('fixed simulated phone coordinates ignore any caller-provided computer GPS',()=>{
 const context=buildContext({now,timezone,locationMode:'fixture',browserLocation:computerGPS});
 assert.deepEqual(context.location,{latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海固定坐标）',source:'fixture',precision:'coordinate'});
 assert.equal(context.locationError,undefined);assert.equal(context.now,now);assert.equal(context.timezone,timezone);
 const implicit=buildContext({now,timezone,browserLocation:computerGPS});
 assert.deepEqual(implicit.location,context.location);
});

test('coarse simulated phone location remains visibly a fixture with its uncertainty',()=>{
 const context=buildContext({now,timezone,locationMode:'coarse',browserLocation:computerGPS});
 assert.equal(context.location.source,'fixture');assert.equal(context.location.latitude,31.2304);
 assert.equal(context.location.longitude,121.4737);assert.equal(context.location.precision,'city');
 assert.equal(context.location.accuracyMeters,20000);assert.match(context.location.label,/模拟手机当前位置/);
});

test('legacy browser and unknown modes explicitly clear location instead of becoming phone fixtures',()=>{
 for(const locationMode of ['browser','harmony','gps','unknown','',null]){
  const context=buildContext({now,timezone,locationMode,browserLocation:computerGPS,locationError:'browser GPS ready'});
  assert.ok(Object.hasOwn(context,'location'),String(locationMode));
  assert.equal(context.location,null,String(locationMode));
  assert.match(context.locationError,/模式不可用|仅支持/);assert.match(context.locationError,/不读取电脑位置/);
  assert.equal(context.now,now);assert.equal(context.timezone,timezone);
 }
});

test('none means no simulated phone location and does not fabricate a position',()=>{
 const context=buildContext({now,timezone,locationMode:'none',browserLocation:computerGPS});
 assert.equal(context.location,null);assert.equal(context.locationError,undefined);
 const r=resolveArguments(getCapability('weather.current.humidity'),{},context);
 assert.equal(r.status,'resolution_failed');assert.equal(r.arguments.location,undefined);
 assert.match(r.issues.join(' '),/手机当前位置|模拟手机位置/);
 assert.doesNotMatch(r.issues.join(' '),/请提供地点或授权定位|未提供浏览器授权位置/);
});

test('system_location still represents the phone position and its actual PC source stays fixture',()=>{
 const context=buildContext({now,timezone,locationMode:'fixture'});
 const r=resolveArguments(getCapability('weather.current.humidity'),{},context);
 assert.equal(r.status,'ready_mock');assert.equal(r.sources.location,'system_location');
 assert.equal(r.arguments.location.source,'fixture');assert.equal(r.resolution.location.effective.source,'fixture');
 assert.equal(r.resolution.location.effective.latitude,31.2304);
});

test('historical browser provenance still renders as saved without enabling new computer reads',()=>{
 const legacy={id:'legacy-browser',text:'历史天气',domain:'weather',api:'weather.current.humidity',status:'ready_mock',context:{location:computerGPS},resolved:{arguments:{location:computerGPS},sources:{location:'browser'},missing:[],issues:[]},traces:[]};
 const unchanged=structuredClone(legacy),html=renderRun(legacy);
 assert.match(html,/浏览器位置/);assert.match(html,/48\.85/);assert.deepEqual(legacy,unchanged);
});
