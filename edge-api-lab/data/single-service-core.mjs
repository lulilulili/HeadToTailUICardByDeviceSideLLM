// New development suite: each sentence requests one registered API only.
// These hand-authored expectations are loaded by evaluation, never by prompting.
const groups = {
  weather: [
    ['查杭州现在的湿度', 'weather.current.humidity', { location: '杭州', time_ref: '现在' }],
    ['广州现在的气温是多少', 'weather.current.temperature', { location: '广州', time_ref: '现在' }],
    ['查现在的风速', 'weather.current.wind.speed', { time_ref: '现在' }],
    ['查看当前气压', 'weather.current.pressure', { time_ref: '当前' }],
    ['深圳现在的体感温度', 'weather.current.apparentTemperature', { location: '深圳', time_ref: '现在' }],
    ['北京明天下午的湿度', 'weather.hourly.humidity', { location: '北京', time_ref: '明天下午' }],
    ['杭州未来30分钟的降雨强度', 'weather.minute.precipitationIntensity', { location: '杭州', time_ref: '未来30分钟' }],
    ['今天上海的天气', 'weather.query', { location: '上海', time_ref: '今天' }],
    ['查南京现在的能见度', 'weather.current.visibility', { location: '南京', time_ref: '现在' }],
    ['湿度呢', 'weather.current.humidity', {}]
  ],
  calendar: [
    ['查明天的日程', 'calendar.search', { time_ref: '明天' }],
    ['查今天日程，关键词“设计评审”', 'calendar.search', { time_ref: '今天', keyword: '设计评审' }],
    ['读取日程ID ev_42的标题', 'calendar.event.title', { event_id: 'ev_42' }],
    ['读取日程ID ev_42的开始时间', 'calendar.event.start', { event_id: 'ev_42' }],
    ['读取日程ID ev_42的结束时间', 'calendar.event.end', { event_id: 'ev_42' }],
    ['创建日程，标题“产品评审”，开始时间明天下午三点', 'calendar.create', { title: '产品评审', starts_at: '明天下午三点' }],
    ['创建日程，标题“复盘”，开始时间明天下午四点，持续30分钟', 'calendar.create', { title: '复盘', starts_at: '明天下午四点', duration_minutes: 30 }],
    ['修改日程 ev_42，标题改为“项目周会”，地点改为“会议室 A”', 'calendar.update', { event_id: 'ev_42', changes: { title: '项目周会', location: '会议室 A' } }],
    ['取消日程ID ev_42', 'calendar.cancel', { event_id: 'ev_42' }],
    ['读取日程ID ev_42的完整参会人列表', 'calendar.event.attendees', { event_id: 'ev_42' }]
  ],
  contacts: [
    ['在通讯录中查找姓名“林晓”', 'contacts.search', { query: '林晓' }],
    ['读取联系人ID ct_7的电话号码', 'contacts.phoneNumbers.phoneNumber', { contact_id: 'ct_7' }],
    ['读取联系人ID ct_7的电子邮箱地址', 'contacts.emails.email', { contact_id: 'ct_7' }],
    ['读取联系人ID ct_7的完整姓名', 'contacts.name.fullName', { contact_id: 'ct_7' }],
    ['读取联系人ID ct_7的单位名称', 'contacts.organization.name', { contact_id: 'ct_7' }],
    ['读取联系人ID ct_7的备注内容', 'contacts.note.noteContent', { contact_id: 'ct_7' }],
    ['新建联系人，姓名“陈雨”，手机号“13800138000”，邮箱“chen@example.com”', 'contacts.create', { name: '陈雨', phone: '13800138000', email: 'chen@example.com' }],
    ['更新联系人 ct_7，姓名“林晓”，邮箱“lin@example.com”，单位“星河科技”', 'contacts.update', { contact_id: 'ct_7', name: '林晓', email: 'lin@example.com', organization: '星河科技' }],
    ['读取当前选中联系人的完整详情', 'contacts.get', {}, { objects: { contact_id: { value: 'ct_7', source: 'user_selection', trusted: true } } }],
    ['读取联系人ID ct_7的主页网址', 'contacts.websites.website', { contact_id: 'ct_7' }]
  ],
  files: [
    ['搜索本地文件，关键词“年度报告”，文件类型pdf', 'files.search', { keyword: '年度报告', file_type: 'pdf' }],
    ['搜索本地文件，关键词“采购清单”，文件类型xlsx', 'files.search', { keyword: '采购清单', file_type: 'xlsx' }],
    ['读取文件ID file_9的大小', 'files.metadata.size', { file_id: 'file_9' }],
    ['读取文件ID file_9的名称', 'files.metadata.name', { file_id: 'file_9' }],
    ['读取文件ID file_9的MIME类型', 'files.metadata.mime_type', { file_id: 'file_9' }],
    ['读取文件ID file_9的修改时间', 'files.metadata.modified_at', { file_id: 'file_9' }],
    ['读取文件ID file_9的扩展名', 'files.metadata.extension', { file_id: 'file_9' }],
    ['预览文件URI“file:///tmp/report.pdf#part2”，窗口标题“待审稿”', 'files.preview', { file_id: 'file:///tmp/report.pdf#part2', title: '待审稿' }],
    ['查看当前选中文件的大小', 'files.metadata.size', {}, { objects: { file_id: { value: 'file_9', source: 'user_selection', trusted: true } } }],
    ['文件ID file_9是否可以预览', 'files.preview.can_preview', { file_id: 'file_9' }]
  ],
  services: [
    ['取得天气服务的应用跳转链接', 'services.link', { service: 'weather' }],
    ['取得日历服务的应用跳转链接', 'services.link', { service: 'calendar' }],
    ['读取天气服务的可用状态', 'services.availability', { service: 'weather' }],
    ['读取文件服务的可用状态', 'services.availability', { service: 'files' }],
    ['读取日历服务的目标页面', 'services.target', { service: 'calendar' }],
    ['读取天气服务的页面参数', 'services.parameters', { service: 'weather' }],
    ['打开天气服务页面', 'services.open', { service: 'weather' }],
    ['打开日历服务页面，parameters={"query":"周会"}', 'services.open', { service: 'calendar', parameters: { query: '周会' } }],
    ['获取当前延迟应用链接', 'services.link.deferred', {}],
    ['解析应用链接，url="https://example.com/app?item=9&tab=info"', 'services.link.parse', { url: 'https://example.com/app?item=9&tab=info' }]
  ],
  cloud: [
    ['在云端会议资料中搜索关键词“供货风险”', 'materials.search', { keyword: '供货风险' }],
    ['查会议ID mt_8的云端资料', 'materials.search', { meeting_id: 'mt_8' }],
    ['读取云端资料ID mat_2的标题', 'materials.title', { material_id: 'mat_2' }],
    ['读取云端资料ID mat_2的正文', 'materials.content', { material_id: 'mat_2' }],
    ['读取云端资料ID mat_2的更新时间', 'materials.updated_at', { material_id: 'mat_2' }],
    ['取得云文件下载地址，云路径“reports/weekly.pdf”，存储实例“team-bucket”', 'cloud.storage.download_url', { cloud_path: 'reports/weekly.pdf', bucket: 'team-bucket' }],
    ['保存云端资料，标题“会议纪要”，正文“确认 3 项行动，负责人是林晓。”', 'materials.save', { title: '会议纪要', content: '确认 3 项行动，负责人是林晓。' }],
    ['读取云数据库字段，collection="Meeting"，record_id="rec_8"，field_name="title"', 'cloud.database.field', { collection: 'Meeting', record_id: 'rec_8', field_name: 'title' }],
    ['统计云数据库，collection="Meeting"，field_name="budget"，operation="sum"', 'cloud.database.calculate', { collection: 'Meeting', field_name: 'budget', operation: 'sum' }],
    ['调用云函数，function_name="summarize"，data="{\"text\":\"今天的复盘\"}"', 'cloud.function.call', { function_name: 'summarize', data: '{"text":"今天的复盘"}' }]
  ]
};

export const coreSingleServiceCases = Object.entries(groups).flatMap(([domain, items]) => items.map(([text, api, args, context], index) => ({
  id: `single-${domain}-${String(index + 1).padStart(2, '0')}`, suite: 'single-service-v1', singleService: true,
  testDomain: domain, category: Object.keys(args).length ? 'explicit' : 'default', scenario: api,
  text, ...(context ? { context } : {}), expected: { domain, api, arguments: args, status: 'ready_mock' }
})));
