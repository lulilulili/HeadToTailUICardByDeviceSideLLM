import asyncio
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('reusable_cache', ROOT / 'integrations/laya/reusable_cache.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

PROFILE = {'modelRevision': '7b928d828b7b0e022f929d9bd2e44165aa270148', 'layaVersion': '0.4.6', 'threads': 8}
NAMESPACE = 'single-service-100-20261013-cache-unit'

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')

def request():
    return {'state': {'text': '现在有没有可用网络'}, 'model': 'multilingual', 'questions': {'domain': {'type': 'choice', 'instructions': '选择领域', 'criteria': {'connectivity': '网络状态', 'cloud': '云业务'}}}, 'max_len': 4096, 'head_max_len': 768, 'lang': 'zh'}

def response():
    return {'model': 'laya-rl-agent', 'answers': {'domain': {'type': 'choice', 'choice': 'connectivity', 'probabilities': {'connectivity': 0.9, 'cloud': 0.1}, 'confidence': 0.8}}, 'usage': {'input_tokens': 50, 'output_tokens': 0, 'state_tokens_dropped': 0, 'truncated': False}}

class CacheTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name)
        self.seed = self.runtime / 'seed.json'
        self.config = self.runtime / 'laya-reuse-config.json'
        self.manifest = self.runtime / 'single-service-100' / NAMESPACE / 'manifest.json'
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_bytes(encoded({'id':NAMESPACE,'status':'running'}))
        self.seed.write_bytes(encoded({'version': 'laya-benchmark-reuse-seed-v1', 'namespace': NAMESPACE, 'profile': PROFILE, 'entries': []}))
        self.settings = {'version': 'laya-benchmark-reuse-config-v1', 'enabled': True, 'namespace': NAMESPACE, 'batchId':NAMESPACE, 'activeManifestPath':str(self.manifest), 'profile': PROFILE, 'seedPath': str(self.seed), 'cacheDirectory': str(self.runtime / 'cache')}
        self.config.write_bytes(encoded(self.settings))
    def tearDown(self):
        self.temp.cleanup()
    def cache(self):
        return MODULE.load_reuse_from_config(self.config, self.runtime, PROFILE)
    async def send(self, app, value, method='POST', path='/v1/systemone'):
        body=encoded(value);messages=[];sent=False
        async def receive():
            nonlocal sent
            if not sent:
                sent=True
                return {'type':'http.request','body':body,'more_body':False}
            await asyncio.Future()  # Connected client stays connected while its response streams.
        async def send(message):
            messages.append(message)
        await app({'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'path':path,'raw_path':path.encode(),'query_string':b'','scheme':'http','server':('127.0.0.1',8765),'client':('127.0.0.1',12345),'headers':[(b'content-type',b'application/json'),(b'content-length',str(len(body)).encode())]},receive,send)
        headers=dict(messages[0]['headers'])
        return messages[0]['status'],json.loads(b''.join(m.get('body',b'') for m in messages)),headers
    def upstream(self, counter, payload=None, wait=None, status=200):
        async def app(scope,receive,send):
            await receive();counter.append(1)
            if wait: await wait.wait()
            await send({'type':'http.response.start','status':status,'headers':[(b'content-type',b'application/json'),(b'x-inference-time-ms',b'123.5')]})
            await send({'type':'http.response.body','body':encoded(payload if payload is not None else response())})
        return app
    async def test_default_off_and_explicit_profile_namespace_guards(self):
        self.config.unlink()
        self.assertIsNone(self.cache())
        self.config.write_bytes(encoded(self.settings))
        for patch in [{'namespace':'other'},{'profile':{**PROFILE,'threads':4}},{'seedPath':str(self.runtime.parent/'outside.json')}]:
            self.config.write_bytes(encoded({**self.settings,**patch}))
            with self.assertRaises(ValueError): self.cache()
        self.config.write_bytes(encoded(self.settings))
    async def test_full_body_key_keeps_criteria_order_and_input_parameters(self):
        original=request();key=MODULE.request_sha256(encoded(original))
        for field,value in [('model','english'),('max_len',2048),('head_max_len',512),('lang','en')]:
            changed=copy.deepcopy(original);changed[field]=value
            self.assertNotEqual(MODULE.request_sha256(encoded(changed)),key)
        changed=copy.deepcopy(original);changed['questions']['domain']['criteria']={'cloud':'云业务','connectivity':'网络状态'}
        self.assertNotEqual(MODULE.request_sha256(encoded(changed)),key)
        changed=copy.deepcopy(original);changed['state']['domain']='cloud'
        self.assertNotEqual(MODULE.request_sha256(encoded(changed)),key)
    async def test_all_supplied_fixed_profile_fields_match_the_deployment(self):
        wrong={**PROFILE,'model':'english','device':'cpu'}
        self.settings['profile']=wrong;self.config.write_bytes(encoded(self.settings))
        self.seed.write_bytes(encoded({'version':'laya-benchmark-reuse-seed-v1','namespace':NAMESPACE,'profile':wrong,'entries':[]}))
        with self.assertRaises(ValueError):
            MODULE.load_reuse_from_config(self.config,self.runtime,{**PROFILE,'model':'multilingual','device':'cpu'})
    async def test_hit_keeps_first_origin_duration_and_no_new_inference(self):
        count=[];cache=self.cache();app=MODULE.ReuseMiddleware(self.upstream(count),cache)
        first=await self.send(app,request());second=await self.send(app,request())
        self.assertEqual(len(count),1)
        self.assertFalse(first[1]['x_benchmark_reuse']['hit']);self.assertTrue(second[1]['x_benchmark_reuse']['hit'])
        self.assertEqual(second[2][b'x-inference-time-ms'],b'0')
        self.assertFalse(second[1]['x_benchmark_reuse']['inferenceExecuted'])
        self.assertEqual(second[1]['x_benchmark_reuse']['originalInferenceMs'],123.5)
        self.assertEqual(first[1]['answers'],second[1]['answers'])
        self.assertEqual(second[1]['forwardPasses'],0)
        self.assertEqual(second[1]['usage']['input_tokens'],0)
        self.assertEqual(second[1]['x_benchmark_reuse']['originalUsage']['input_tokens'],50)
        self.assertEqual(first[1]['x_benchmark_reuse']['responseSha256'],second[1]['x_benchmark_reuse']['responseSha256'])
        origin=second[1]['x_benchmark_reuse']['origin'];source=(cache.project_root/origin['serviceRecordPath']).read_bytes()
        self.assertEqual(origin['serviceRecordSha256'],hashlib.sha256(source).hexdigest())
        self.assertIsNone(second[1]['x_benchmark_reuse']['originalWallMs'])
        self.assertEqual(second[1]['x_benchmark_reuse']['originalTimingScope']['originalServiceWallMs'],'server_request')
        self.assertEqual(len(list((self.runtime/'cache').glob('*.entry.json'))),1)
    async def test_inflight_identical_requests_merge(self):
        count=[];gate=asyncio.Event();cache=self.cache();app=MODULE.ReuseMiddleware(self.upstream(count,wait=gate),cache)
        first=asyncio.create_task(self.send(app,request()));await asyncio.sleep(0)
        second=asyncio.create_task(self.send(app,request()));await asyncio.sleep(0);gate.set()
        results=await asyncio.gather(first,second)
        self.assertEqual(len(count),1)
        self.assertTrue(results[1][1]['x_benchmark_reuse']['inFlightMerged'])
    async def test_replay_forwards_real_disconnect_after_cached_body(self):
        calls=[]
        async def original_receive():
            calls.append(1)
            return {'type':'http.disconnect'}
        replay=MODULE.ReuseMiddleware._replay(encoded(request()),original_receive)
        self.assertEqual((await replay())['type'],'http.request')
        self.assertEqual((await replay())['type'],'http.disconnect')
        self.assertEqual(calls,[1])
    async def test_error_truncation_foreign_choice_and_probability_never_cache(self):
        bad=[]
        for usage in [{'truncated':True},{'state_tokens_dropped':1},{'truncated_questions':['domain']},{'options':{'domain':{'distinct':1,'total':2}}}]:
            value=response();value['usage']=usage;bad.append(value)
        value=response();value['answers']['domain']['choice']='unsupported';bad.append(value)
        value=response();value['answers']['domain']['probabilities']={'connectivity':1};bad.append(value)
        for payload in bad:
            count=[];app=MODULE.ReuseMiddleware(self.upstream(count,payload),self.cache())
            await self.send(app,request());await self.send(app,request());self.assertEqual(len(count),2)
        count=[];app=MODULE.ReuseMiddleware(self.upstream(count,status=500),self.cache())
        await self.send(app,request());await self.send(app,request());self.assertEqual(len(count),2)
    async def test_seed_provenance_and_persistence_are_immutable(self):
        raw=encoded(response()).decode('utf8');req=request();origin={'recordPath':'evidence/x.json','recordSha256':'a'*64,'manifestId':NAMESPACE,'model':'qwen2.5:0.5b','caseId':'one','stage':'domain','traceIndex':0}
        entry={'request':req,'requestSha256':MODULE.request_sha256(encoded(req)),'responseRaw':raw,'responseSha256':hashlib.sha256(raw.encode()).hexdigest(),'originalWallMs':150,'originalInferenceMs':123.5,'origin':origin}
        self.seed.write_bytes(encoded({'version':'laya-benchmark-reuse-seed-v1','namespace':NAMESPACE,'profile':PROFILE,'entries':[entry]}))
        count=[];app=MODULE.ReuseMiddleware(self.upstream(count),self.cache());result=await self.send(app,req)
        self.assertEqual(count,[]);self.assertEqual(result[1]['x_benchmark_reuse']['origin'],origin);self.assertEqual(result[1]['x_benchmark_reuse']['originalWallMs'],150)
        path=next((self.runtime/'cache').glob('*.entry.json'));before=path.read_bytes()
        self.cache();self.assertEqual(path.read_bytes(),before)
        entry['responseRaw']=raw.replace('0.9','0.8').replace('0.1','0.2');self.seed.write_bytes(encoded({'version':'laya-benchmark-reuse-seed-v1','namespace':NAMESPACE,'profile':PROFILE,'entries':[entry]}))
        with self.assertRaises(ValueError): self.cache()
    async def test_cache_does_not_count_tournament_replay_as_new_predicts(self):
        payload=response();payload['answers']['domain']['x_tournament']={'rounds':1}
        count=[];app=MODULE.ReuseMiddleware(self.upstream(count,payload),self.cache())
        await self.send(app,request());result=await self.send(app,request())
        self.assertNotIn('x_tournament',result[1]['answers']['domain'])
        self.assertEqual(result[1]['x_benchmark_reuse']['originalTournament'],{'domain':{'rounds':1}})
    async def test_health_addition_leaves_status_model_profile_unchanged(self):
        payload={'status':'ok','loaded':['multilingual'],'deployment':{'version':'0.4.6','modelRevision':PROFILE['modelRevision']}}
        app=MODULE.ReuseMiddleware(self.upstream([],payload),self.cache())
        result=await self.send(app,{},'GET','/health')
        self.assertEqual(result[1]['status'],'ok');self.assertEqual(result[1]['deployment']['version'],'0.4.6')
        self.assertTrue(result[1]['benchmarkReuse']['enabled'])
    async def test_finished_or_foreign_batch_bypasses_reuse(self):
        count=[];cache=self.cache();app=MODULE.ReuseMiddleware(self.upstream(count),cache)
        await self.send(app,request())
        for status in ['completed','interrupted','failed']:
            self.manifest.write_bytes(encoded({'id':NAMESPACE,'status':status}))
            result=await self.send(app,request())
            self.assertNotIn('x_benchmark_reuse',result[1])
            self.assertFalse(cache.health()['active'])
        self.assertEqual(len(count),4)

@unittest.skipUnless(importlib.util.find_spec('fastapi'), 'framework unavailable in stdlib-only test interpreter')
class RealFrameworkTest(CacheTest):
    async def test_real_starlette_body_replay_and_deployment_health(self):
        from fastapi import FastAPI, Request
        from starlette.responses import JSONResponse, StreamingResponse
        app=FastAPI();count=[]
        @app.post('/v1/systemone')
        async def decide(request:Request):
            self.assertEqual(await request.json(),globals()['request']())
            count.append(1)
            async def chunks():
                await asyncio.sleep(.005)
                yield encoded(response())
            return StreamingResponse(chunks(),media_type='application/json',headers={'X-Inference-Time-Ms':'123.5'})
        @app.get('/health')
        async def health():
            return {'status':'ok','loaded':['multilingual']}
        @app.middleware('http')
        async def deployment_health(request,call_next):
            value=await call_next(request)
            if request.method!='GET' or request.url.path!='/health':return value
            body=b''.join([chunk async for chunk in value.body_iterator]);payload=json.loads(body)
            payload['deployment']={'version':'0.4.6','modelRevision':PROFILE['modelRevision']}
            return JSONResponse(payload)
        wrapped=MODULE.ReuseMiddleware(app,self.cache())
        first=await asyncio.wait_for(self.send(wrapped,request()),2)
        second=await asyncio.wait_for(self.send(wrapped,request()),2)
        probe=await asyncio.wait_for(self.send(wrapped,{},'GET','/health'),2)
        self.assertEqual(first[1]['answers'],response()['answers'])
        self.assertEqual(count,[1]);self.assertTrue(second[1]['x_benchmark_reuse']['hit'])
        self.assertEqual(probe[1]['status'],'ok');self.assertTrue(probe[1]['benchmarkReuse']['active'])
        self.assertEqual(probe[1]['deployment']['version'],'0.4.6')

if __name__ == '__main__': unittest.main(verbosity=2)
