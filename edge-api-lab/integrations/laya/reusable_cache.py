"""Explicit, batch-bound native-request reuse. No model imports or execution."""
import asyncio
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
from datetime import datetime, timezone

VERSION = 'laya-benchmark-reuse-v1'
POLICY = 'exact-native-request-v1'
SEED_VERSION = 'laya-benchmark-reuse-seed-v1'
CONFIG_VERSION = 'laya-benchmark-reuse-config-v1'

def request_sha256(raw):
    return hashlib.sha256(raw).hexdigest()

def compact(value):
    # Never sort criteria: tournament grouping and decoder tokens depend on order.
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0

def runtime_path(root, value):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError('reuse paths must be absolute runtime paths')
    path = Path(value).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('reuse path escapes project runtime')
    return path

def valid_response(request, raw):
    try:
        payload = json.loads(raw)
        questions, answers = request['questions'], payload['answers']
        if not isinstance(payload.get('model'), str) or not payload['model'] or set(answers) != set(questions):
            return False
        for key, question in questions.items():
            keys = list(question['criteria'])
            answer = answers[key]
            probabilities = answer['probabilities']
            if question['type'] != 'choice' or answer['type'] != 'choice' or answer['choice'] not in keys or set(probabilities) != set(keys):
                return False
            if not all(finite(p) and p <= 1 for p in probabilities.values()):
                return False
            if abs(sum(probabilities.values()) - 1) > max(.001, len(keys) * .00005 + 1e-8):
                return False
            if not finite(answer['confidence']) or answer['confidence'] > 1 or probabilities[answer['choice']] + 1e-9 < max(probabilities.values()):
                return False
        usage = payload.get('usage', {})
        if not isinstance(usage, dict) or usage.get('truncated') or usage.get('state_tokens_dropped', 0) > 0 or usage.get('truncated_questions'):
            return False
        if any(isinstance(v, dict) and finite(v.get('distinct')) and finite(v.get('total')) and v['distinct'] < v['total'] for v in usage.get('options', {}).values()):
            return False
        return 'x_benchmark_reuse' not in payload
    except (KeyError, TypeError, ValueError, AttributeError):
        return False

def immutable_json(path, value):
    raw = compact(value)
    try:
        with path.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        existing = read_json(path)
        if existing != value:
            raise ValueError('immutable reuse cache entry differs: ' + path.name)

class ReuseCache:
    def __init__(self, config, runtime_root, installed_profile):
        self.project_root = runtime_root.resolve().parent.parent
        self.namespace = config.get('namespace')
        if config.get('version') != CONFIG_VERSION or not isinstance(self.namespace, str) or not re.fullmatch(r'single-service-100-[A-Za-z0-9-]+', self.namespace) or config.get('batchId') != self.namespace:
            raise ValueError('reuse namespace/batch config mismatch')
        self.profile = config.get('profile', {})
        for key in ('modelRevision', 'layaVersion', 'threads'):
            if self.profile.get(key) != installed_profile.get(key):
                raise ValueError('reuse deployment profile mismatch: ' + key)
        for key, value in installed_profile.items():
            if key in self.profile and self.profile[key] != value:
                raise ValueError('reuse fixed deployment field mismatch: ' + key)
        if self.profile.get('threads') != 8:
            raise ValueError('reuse requires fixed 8-thread profile')
        self.manifest = runtime_path(runtime_root, config.get('activeManifestPath'))
        if not self.manifest.is_relative_to(runtime_root.resolve() / 'single-service-100') or self.manifest.parent.name != self.namespace or self.manifest.name != 'manifest.json':
            raise ValueError('reuse active manifest must bind this batch')
        self.directory = runtime_path(runtime_root, config.get('cacheDirectory'))
        self.seed = runtime_path(runtime_root, config.get('seedPath'))
        data = read_json(self.seed)
        if data.get('version') != SEED_VERSION or data.get('namespace') != self.namespace or data.get('profile') != self.profile:
            raise ValueError('reuse seed namespace/profile mismatch')
        self.directory.mkdir(parents=True, exist_ok=True)
        immutable_json(self.directory / 'namespace.json', {'version': VERSION, 'namespace': self.namespace, 'profile': self.profile})
        self.entries, self.pending = {}, {}
        self.hits = self.misses = self.merged = 0
        for path in self.directory.glob('*.entry.json'):
            entry = read_json(path)
            self._validate_entry(entry)
            if path.name != entry['requestSha256'] + '.entry.json':
                raise ValueError('reuse cache filename fingerprint mismatch')
            self.entries[entry['requestSha256']] = entry
        for original in data.get('entries', []):
            entry = self._entry(original)
            self._save(entry)

    def active(self):
        try:
            value = read_json(self.manifest)
            return value.get('id') == self.namespace and value.get('status') == 'running'
        except (OSError, ValueError):
            return False

    def health(self):
        return {'enabled': True, 'configured': True, 'active': self.active(), 'version': VERSION, 'policy': POLICY, 'namespace': self.namespace, 'profile': self.profile, 'saved': len(self.entries), 'hits': self.hits, 'misses': self.misses, 'inFlightMerged': self.merged, 'pending': len(self.pending)}

    def _entry(self, value):
        entry = copy.deepcopy(value)
        raw = compact(entry['request'])
        key = request_sha256(raw)
        response_hash = request_sha256(entry['responseRaw'].encode('utf8'))
        if entry.get('requestSha256', key) != key or entry.get('responseSha256', response_hash) != response_hash:
            raise ValueError('reuse seed request/response fingerprint mismatch')
        entry.update(version=VERSION, namespace=self.namespace, profile=self.profile, requestSha256=key, responseSha256=response_hash)
        entry.setdefault('originalWallMs', None)
        entry.setdefault('originalInferenceMs', entry.get('firstDurationMs'))
        entry.setdefault('originalServiceWallMs', None)
        self._validate_entry(entry)
        return entry

    def _validate_entry(self, entry):
        if entry.get('version') != VERSION or entry.get('namespace') != self.namespace or entry.get('profile') != self.profile or not valid_response(entry.get('request', {}), entry.get('responseRaw', '')):
            raise ValueError('reuse entry is not a complete successful native response')
        if request_sha256(compact(entry['request'])) != entry.get('requestSha256') or request_sha256(entry['responseRaw'].encode('utf8')) != entry.get('responseSha256'):
            raise ValueError('reuse entry fingerprint mismatch')
        for key in ('originalWallMs', 'originalInferenceMs', 'originalServiceWallMs'):
            if entry.get(key) is not None and not finite(entry[key]):
                raise ValueError('invalid first-observation timing')
        if not isinstance(entry.get('origin'), dict):
            raise ValueError('reuse entry origin missing')

    def _save(self, entry):
        key = entry['requestSha256']
        if key in self.entries:
            if self.entries[key]['responseSha256'] != entry['responseSha256']:
                raise ValueError('conflicting first native response for same reuse key')
            return self.entries[key]
        immutable_json(self.directory / (key + '.entry.json'), entry)
        self.entries[key] = entry
        return entry

    def metadata(self, entry, hit, elapsed, merged=False):
        payload = json.loads(entry['responseRaw'])
        result = {'version': VERSION, 'policy': POLICY, 'namespace': self.namespace, 'requestSha256': entry['requestSha256'], 'responseSha256': entry['responseSha256'], 'hit': hit, 'inFlightMerged': merged, 'inferenceExecuted': not hit,
                  **{key: self.profile[key] for key in ('modelRevision', 'layaVersion', 'threads')}, 'origin': entry['origin'], **{key: entry.get(key) for key in ('originalWallMs', 'originalInferenceMs', 'originalServiceWallMs')}, 'lookupMs': elapsed if hit else 0}
        result['originalTimingScope'] = {'originalWallMs': 'client_http' if entry.get('originalWallMs') is not None else None, 'originalInferenceMs': 'native_service_inference_header' if entry.get('originalInferenceMs') is not None else None, 'originalServiceWallMs': 'server_request' if entry.get('originalServiceWallMs') is not None else None}
        if hit:
            result['originalUsage'] = copy.deepcopy(payload.get('usage'))
            result['originalTournament'] = {key: value.pop('x_tournament') for key, value in payload['answers'].items() if 'x_tournament' in value}
            payload['usage'] = {**payload.get('usage', {}), 'input_tokens': 0, 'output_tokens': 0}
            payload['forwardPasses'] = 0
        payload['x_benchmark_reuse'] = result
        return compact(payload)

def load_reuse_from_config(config_path, runtime_root, installed_profile):
    config_path = Path(config_path)
    if not config_path.exists():
        return None
    config = read_json(config_path)
    if config.get('enabled') is not True:
        return None
    return ReuseCache(config, Path(runtime_root), installed_profile)

class ReuseMiddleware:
    def __init__(self, app, cache):
        self.app, self.cache = app, cache

    async def __call__(self, scope, receive, send):
        health = scope.get('type') == 'http' and scope.get('method') == 'GET' and scope.get('path') == '/health'
        eligible = scope.get('type') == 'http' and scope.get('method') == 'POST' and scope.get('path') == '/v1/systemone' and self.cache.active()
        if not eligible and not health:
            return await self.app(scope, receive, send)
        if health:
            messages = []
            await self.app(scope, receive, self._collector(messages))
            if messages and messages[0].get('status') == 200:
                try:
                    payload = json.loads(b''.join(m.get('body', b'') for m in messages))
                    payload['benchmarkReuse'] = self.cache.health()
                    if isinstance(payload.get('deployment'), dict): payload['deployment']['benchmarkReuse'] = self.cache.health()
                    return await self._send(send, 200, messages[0]['headers'], compact(payload))
                except (ValueError, TypeError): pass
            for message in messages: await send(message)
            return
        start = time.perf_counter()
        observed_at = datetime.now(timezone.utc).isoformat()
        parts = []
        while True:
            message = await receive()
            if message.get('type') != 'http.request':
                return
            parts.append(message.get('body', b''))
            if not message.get('more_body'): break
        raw = b''.join(parts)
        try: request = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return await self.app(scope, self._replay(raw, receive), send)
        # Only byte-identical request bodies match; noncompact formatting is a safe miss.
        key = request_sha256(raw)
        if key != request_sha256(compact(request)):
            return await self.app(scope, self._replay(raw, receive), send)
        if key in self.cache.entries:
            self.cache.hits += 1
            return await self._send(send, 200, [], self.cache.metadata(self.cache.entries[key], True, (time.perf_counter()-start)*1000), hit=True)
        if key in self.cache.pending:
            self.cache.merged += 1
            messages, entry = await asyncio.shield(self.cache.pending[key])
            if entry:
                self.cache.hits += 1
                return await self._send(send, 200, [], self.cache.metadata(entry, True, (time.perf_counter()-start)*1000, True), hit=True)
            for message in messages: await send(message)
            return
        future = asyncio.get_running_loop().create_future()
        self.cache.pending[key] = future
        self.cache.misses += 1
        messages = []
        try:
            await self.app(scope, self._replay(raw, receive), self._collector(messages))
            response_raw = b''.join(m.get('body', b'') for m in messages)
            entry = None
            if messages and 200 <= messages[0].get('status', 0) < 300 and valid_response(request, response_raw):
                headers = dict(messages[0].get('headers', []))
                try: infer = float(headers.get(b'x-inference-time-ms', b''))
                except ValueError: infer = None
                service_ms = (time.perf_counter()-start)*1000
                service_record = {'version': VERSION, 'namespace': self.cache.namespace, 'profile': self.cache.profile, 'request': request, 'requestSha256': key, 'responseRaw': response_raw.decode('utf8'), 'serviceWallMs': service_ms, 'inferenceMs': infer if finite(infer) else None, 'observedAt': observed_at}
                service_path = self.cache.directory / (key + '.service.json')
                immutable_json(service_path, service_record)
                value = {'request': request, 'responseRaw': response_raw.decode('utf8'), 'originalWallMs': None, 'originalInferenceMs': service_record['inferenceMs'], 'originalServiceWallMs': service_ms,
                         'origin': {'type':'service_inference', 'namespace':self.cache.namespace, 'serviceRecordPath':service_path.relative_to(self.cache.project_root).as_posix(), 'serviceRecordSha256':request_sha256(compact(service_record)), 'observedAt':observed_at}}
                entry = self.cache._save(self.cache._entry(value))
            future.set_result((messages, entry))
            if entry:
                return await self._send(send, messages[0]['status'], messages[0].get('headers', []), self.cache.metadata(entry, False, 0))
            for message in messages: await send(message)
        except BaseException as error:
            if not future.done():
                future.set_exception(error)
                future.exception()  # Mark observed even when no duplicate awaited this owner.
            raise
        finally:
            self.cache.pending.pop(key, None)

    @staticmethod
    def _collector(messages):
        async def collect(message): messages.append(message)
        return collect

    @staticmethod
    def _replay(raw, original_receive):
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type':'http.request', 'body':raw, 'more_body':False}
            return await original_receive()
        return replay

    @staticmethod
    async def _send(send, status, headers, body, hit=False):
        headers = [(key, value) for key, value in headers if key.lower() not in (b'content-length', b'content-type') and (not hit or key.lower() not in (b'x-inference-time-ms', b'server-timing'))]
        headers.extend([(b'content-type', b'application/json'), (b'content-length', str(len(body)).encode())])
        if hit: headers.extend([(b'x-inference-time-ms', b'0'), (b'server-timing', b'inference;dur=0')])
        await send({'type':'http.response.start', 'status':status, 'headers':headers})
        await send({'type':'http.response.body', 'body':body})
