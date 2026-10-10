import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates, inferWeatherDataset } from '../src/prompts.mjs';

const check = (text, domain, api, options = {}) => {
  for (const [scope, limit] of [[domain, 6], [undefined, 12]]) {
    const found = selectCandidates(text, scope, { limit, ...options });
    assert.ok(found.length <= limit, `${text}: budget ${limit}`);
    assert.ok(found.some(cap => cap.id === api), `${text}: missing ${api}; ${found.map(cap => cap.id).join(', ')}`);
  }
};

test('explicit complete compound objects remain alternatives to their scalar children', () => {
  check('无锡此刻风的完整信息，风速、风向、阵风都需要', 'weather', 'weather.current.wind');
  check('联系人ct_90的完整电话对象，含号码与标签', 'contacts', 'contacts.phone');
  check('日程ev_90完整参会人对象，含姓名、邮箱、回复状态', 'calendar', 'calendar.event.attendees');
});

test('a scalar request preserves the specific child rather than only the compound object', () => {
  check('武汉现在紫外线指数的数值', 'weather', 'weather.current.uvIndex.value');
  check('济南当前天气现象的文字描述', 'weather', 'weather.current.condition.description');
  check('联系人ct_90的电话标签名称', 'contacts', 'contacts.phoneNumbers.labelName');
});

test('gust synonyms are independent of ordinary wind and of the daytime forecast', () => {
  check('无锡此刻阵风方向', 'weather', 'weather.current.wind.gustDirection');
  check('呼和浩特明天夜间阵风速度', 'weather', 'weather.daily.overnightForecast.wind.gustSpeed');
});

test('weather special objects retain fields expressed with ordinary Chinese nouns', () => {
  check('郑州明天生活指数等级说明', 'weather', 'weather.indices.dailyItems.levelDescription');
  check('郑州天气城市对象的时区', 'weather', 'weather.city.timezone');
  check('天气城市对象各行政区的英文名称', 'weather', 'weather.city.administrativeAreas.englishName');
});

test('explicit daily overview is not replaced exclusively by one temperature leaf', () => {
  check('无锡未来4天逐日天气总览，含最高和最低气温', 'weather', 'weather.daily.overview');
});

test('minute rain density stays distinct from hourly accumulated precipitation', () => {
  check('无锡未来40分钟每分钟降雨密度', 'weather', 'weather.minute.precipitationIntensity');
  check('无锡未来40分钟每分钟是否降水', 'weather', 'weather.minute.precipitation');
  check('无锡未来2小时累计降水量', 'weather', 'weather.hourly.precipitationAmount');
  assert.equal(inferWeatherDataset('明天夜间逐日预报'), 'daily');
});

test('lunar and count expressions preserve calendar leaves', () => {
  check('日程ev_90是否按农历重复', 'calendar', 'calendar.event.lunar');
  check('日程ev_90限定重复多少次', 'calendar', 'calendar.event.recurrenceRule.count');
});

test('contains a name is a boolean field request rather than only a name object', () => {
  check('联系人ct_90是否包含姓名', 'contacts', 'contacts.name.hasName');
});

test('negated write and navigation clauses do not hide requested reads', () => {
  check('读取文件file_note的MIME类型，不要打开它', 'files', 'files.metadata.mime_type');
  check('不用打开或搜索，单独读取文件file_note的修改时间', 'files', 'files.metadata.modified_at');
  check('查询天气服务页面参数，没要求设置任何参数', 'services', 'services.parameters');
  check('只获取当前延迟链接，不解析、不打开', 'services', 'services.link.deferred');
  check('不是要删除这个文件，只查它的大小', 'files', 'files.metadata.size');
});

test('a positive instruction after a negated clause retains its own operation', () => {
  check('不需要预览而是将联系人ct_90的备注改为长期合作', 'contacts', 'contacts.set.note');
});

test('quoted data containing action words never becomes a write instruction', () => {
  check('搜索文件，关键词“上传并删除计划”', 'files', 'files.search');
  check('查找联系人，名字叫“设置提醒”', 'contacts', 'contacts.search');
  check('创建日程标题“取消会议”，开始时间明天下午3点', 'calendar', 'calendar.create');
  check('搜索会议资料，关键词和会议ID都没提供', 'cloud', 'materials.search');
});

test('positive navigation and preview state questions preserve their different operations', () => {
  check('请关掉预览窗口', 'files', 'files.preview.close');
  check('预览窗口现在是否已打开', 'files', 'files.preview.is_open');
  check('上一份文件还可以预览吗', 'files', 'files.preview.can_preview');
});

test('candidate selection clamps arbitrary requested limits to twelve', () => {
  assert.ok(selectCandidates('查询', undefined, { limit: 1000 }).length <= 12);
});

test('a missing destination named as saving location does not change a download into a save action', () => {
  check('下载云文件logs/log.zip到本地，保存目录尚未指定', 'cloud', 'cloud.storage.download');
});
