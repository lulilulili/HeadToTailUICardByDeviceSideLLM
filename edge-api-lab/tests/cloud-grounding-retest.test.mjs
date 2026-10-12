import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizePlan} from '../src/grounding.mjs';

const context={now:'2026-10-12T08:00:00+08:00',timezone:'Asia/Shanghai'};
const plan=(text,api,extractedArguments={},extra={})=>finalizePlan({text,domain:'cloud',api,extractedArguments,context:{...context,...extra}});
const meetingDirectory={identityDirectory:{meeting_id:{source:'fixture',complete:true,ids:['mt_registered']}}};

// Diagnosis: the model's optional ID is removed, but the directory check still
// reads its stale value and introduces an unrelated required-target question.
// These hand-written contract regressions never load corpus gold or a model.
test('unmentioned optional meeting IDs are removed with an audit repair',()=>{
 const raw={meeting_id:'mt_invented'};
 const r=plan('保存会议资料，标题为“架构验证”，正文为“完成评审。”','materials.save',raw);
 assert.equal(r.status,'ready_mock');
 assert.deepEqual(r.groundedArguments,{title:'架构验证',content:'完成评审。'});
 assert.ok(r.grounding.repairs.some(x=>x.field==='meeting_id'&&x.code==='ungrounded_identity'&&x.modelValue==='mt_invented'));
 assert.equal(r.grounding.identity.find(x=>x.field==='meeting_id').status,'rejected');
 assert.deepEqual(raw,{meeting_id:'mt_invented'});
});

test('a directory does not resurrect an already removed optional meeting target',()=>{
 const r=plan('保存会议资料，标题为“交付准备”，正文为“验收完成。”','materials.save',{meeting_id:'mt_invented'},meetingDirectory);
 assert.equal(r.status,'ready_mock');
 assert.deepEqual(r.resolved.missing,[]);
 assert.equal(r.grounding.blockers.length,0);
 assert.ok(r.grounding.repairs.some(x=>x.field==='meeting_id'));
});

test('a missing title does not gain an unrelated optional meeting question',()=>{
 const r=plan('保存会议资料，正文为“测试覆盖完成。”，标题未定','materials.save',{meeting_id:'mt_invented'},meetingDirectory);
 assert.equal(r.status,'needs_clarification');
 assert.deepEqual(r.resolved.missing,['title']);
 assert.equal(r.resolved.arguments.meeting_id,undefined);
 assert.equal(r.grounding.blockers.length,0);
});

test('a missing body does not gain an unrelated optional meeting question',()=>{
 const r=plan('保存会议资料，标题为“发布准备”，正文未提供','materials.save',{meeting_id:'mt_invented'},meetingDirectory);
 assert.equal(r.status,'needs_clarification');
 assert.deepEqual(r.resolved.missing,['content']);
 assert.equal(r.grounding.blockers.length,0);
});

test('an explicit unavailable meeting association remains a real blocker',()=>{
 const r=plan('保存会议资料，标题为“检查”，正文为“完成”，关联会议mt_absent','materials.save',{},meetingDirectory);
 assert.equal(r.status,'needs_clarification');
 assert.ok(r.grounding.blockers.some(x=>x.field==='meeting_id'&&x.code==='identity_fixture_not_found'));
 assert.equal(r.groundedArguments.meeting_id,'mt_absent');
});

test('removing an ungrounded required share target still requires clarification',()=>{
 const r=plan('把会议资料分享给联系人ct_recipient','materials.share',{material_id:'ma_invented'},
  {identityDirectory:{material_id:{source:'fixture',complete:true,ids:['ma_registered']}}});
 assert.equal(r.status,'needs_clarification');
 assert.ok(r.grounding.blockers.some(x=>x.field==='material_id'&&x.code==='ungrounded_identity'));
 assert.ok(r.resolved.missing.includes('material_id'));
});

test('multiple explicitly requested optional meeting associations do not silently disappear',()=>{
 const r=plan('保存会议资料，标题为“检查”，正文为“完成”，关联会议mt_first和会议mt_second','materials.save');
 assert.equal(r.status,'needs_clarification');
 assert.ok(r.grounding.blockers.some(x=>x.field==='meeting_id'&&x.code==='ambiguous_explicit_values'));
});

test('a negated storage instance does not compete with the requested instance',()=>{
 const r=plan('取得云文件team/review.pdf的下载地址，不要用存储实例old_archive，存储实例new_archive','cloud.storage.download_url');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.bucket,'new_archive');
 assert.equal(r.grounding.blockers.length,0);
});

test('a negated cloud source is excluded before selecting the download source',()=>{
 const r=plan('不要下载云文件old/review.pdf，下载云文件team/review.pdf到本地D:/sandbox/review.pdf','cloud.storage.download');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.cloud_path,'team/review.pdf');
 assert.equal(r.groundedArguments.local_path,'D:/sandbox/review.pdf');
});

test('a negated database area does not compete with the requested area',()=>{
 const r=plan('读取云数据库Ledger表记录rec_verified的amount字段，不要使用数据库区域spare，数据库区域finance','cloud.database.field');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.zone,'finance');
 assert.equal(r.grounding.blockers.length,0);
});

test('a negated prefetch mode does not replace the explicitly requested mode',()=>{
 const r=plan('读取安装预加载的时间戳，不要周期预加载','cloud.prefetch.timestamp');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.mode,'install');
});

test('quoted upload paths preserve spaces and remain distinct source and destination roles',()=>{
 const r=plan('上传本地“D:/sandbox/My Plans/review.txt”到云端“team/My Plans/review.txt”，存储实例“docs_team”','cloud.storage.upload');
 assert.equal(r.status,'ready_mock');
 assert.deepEqual(r.groundedArguments,{bucket:'docs_team',cloud_path:'team/My Plans/review.txt',local_path:'D:/sandbox/My Plans/review.txt'});
 assert.equal(r.grounding.checks.find(x=>x.field==='cloud_path').span.text,'team/My Plans/review.txt');
});

test('quoted download paths preserve spaces and reverse the source destination relationship',()=>{
 const r=plan('下载云文件“team/My Plans/review.txt”到本地“D:/sandbox/My Plans/review-copy.txt”，实例“docs_team”','cloud.storage.download');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.cloud_path,'team/My Plans/review.txt');
 assert.equal(r.groundedArguments.local_path,'D:/sandbox/My Plans/review-copy.txt');
});

test('a local help page name does not become a missing upload source path',()=>{
 const r=plan('上传到云端team/result.json，操作说明在本地“帮助”页','cloud.storage.upload');
 assert.equal(r.status,'needs_clarification');
 assert.equal(r.groundedArguments.local_path,undefined);
 assert.equal(r.groundedArguments.cloud_path,'team/result.json');
});

test('path text inside a quoted note is not evidence for an upload target',()=>{
 const r=plan('上传云文件，备注“本地路径D:/sandbox/note.txt，云文件notes/comment.txt”，目标路径和本地文件未提供','cloud.storage.upload',
  {local_path:'D:/sandbox/note.txt',cloud_path:'notes/comment.txt'});
 assert.equal(r.status,'needs_clarification');
 assert.equal(r.groundedArguments.local_path,undefined);
 assert.equal(r.groundedArguments.cloud_path,undefined);
 assert.ok(r.grounding.repairs.some(x=>x.field==='cloud_path'));
});

test('quoted notes alone cannot supply either upload path even without an absence label',()=>{
 const r=plan('上传文件，备注“本地路径D:/sandbox/note.txt，云文件notes/comment.txt”','cloud.storage.upload',
  {local_path:'D:/sandbox/note.txt',cloud_path:'notes/comment.txt'});
 assert.equal(r.status,'needs_clarification');
 assert.equal(r.groundedArguments.local_path,undefined);
 assert.equal(r.groundedArguments.cloud_path,undefined);
});

test('two positive storage instances remain an explicit ambiguity',()=>{
 const r=plan('取得云文件team/review.pdf的下载地址，存储实例first_archive，存储实例second_archive','cloud.storage.download_url');
 assert.equal(r.status,'needs_clarification');
 assert.ok(r.grounding.blockers.some(x=>x.field==='bucket'&&x.code==='ambiguous_explicit_values'));
});

test('mode words inside a quoted note do not override the explicit prefetch mode',()=>{
 const r=plan('读取安装预加载的时间戳，备注“周期预加载只是背景说明”','cloud.prefetch.timestamp');
 assert.equal(r.status,'ready_mock');
 assert.equal(r.groundedArguments.mode,'install');
});

test('an unmentioned model mode is removed before applying the contract default',()=>{
 const r=plan('读取云端预加载结果','cloud.prefetch.result',{mode:'install'});
 assert.equal(r.groundedArguments.mode,undefined);
 assert.equal(r.resolved.arguments.mode,'periodic');
 assert.equal(r.resolved.sources.mode,'default');
});

test('explicitly excluding the default mode requires clarification instead of defaulting to it',()=>{
 const r=plan('读取云端预加载结果，不要周期预加载','cloud.prefetch.result',{mode:'install'});
 assert.equal(r.status,'needs_clarification');
 assert.equal(r.mock.simulated,false);
 assert.ok(r.grounding.blockers.some(x=>x.field==='mode'));
});
