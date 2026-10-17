// 内置动态变量：{{$timestamp}}、{{$randomInt(1, 100)}}、{{$date(yyyy-MM-dd)}} 等。
// 纯函数实现，不依赖界面或 store。

/** 命名参数（键为小写）；位置参数放在 _positional 中 */
export interface DynamicVariableParams {
  _positional?: string[];
  [key: string]: string | string[] | undefined;
}

/** 所有内置变量名，用于输入框的补全和未定义变量检查 */
export const BUILT_IN_VARIABLE_NAMES = [
  '$timestamp', '$isoTimestamp', '$randomInt', '$guid',
  '$date', '$time', '$datetime',
  '$randomAlpha', '$randomNumeric', '$randomUppercase',
  '$randomLowercase', '$randomAlphanumeric', '$randomChinese', '$sequence',
] as const;

/** Workflow 循环中当前（最内层）循环的序号，从 1 开始；由 Workflow 引擎替换，其它地方保持原样 */
export const LOOP_INDEX_VARIABLE = '$loopIndex';

/** 把文本中的 {{$loopIndex}} 换成序号 */
export const replaceLoopIndex = (text: string, loopIndex: number): string => (
  text.replace(/\{\{\s*\$loopIndex\s*\}\}/g, String(loopIndex))
);

export const formatDateTime = (date: Date, format: string): string => {
  const pad = (num: number) => String(num).padStart(2, '0');
  return format
    .replace(/yyyy/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/dd/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
};

/**
 * 解析 `$func(a, b)` 或 `$func(key=value, ...)` 的参数。
 * 不是该函数的调用时返回 null；位置参数放在 `_positional` 中，命名参数的键转为小写。
 */
export const parseParameters = (varName: string, funcName: string): DynamicVariableParams | null => {
  const paramsMatch = varName.match(new RegExp(`^\\${funcName}\\s*\\(\\s*([^)]*)\\s*\\)$`));
  if (!paramsMatch) return null;

  const paramsStr = paramsMatch[1].trim();
  if (!paramsStr) return {};

  if (paramsStr.includes('=')) {
    const result: DynamicVariableParams = {};
    paramsStr.split(',').map(p => p.trim()).filter(p => p).forEach(pair => {
      const equalIndex = pair.indexOf('=');
      if (equalIndex === -1) return;
      const key = pair.substring(0, equalIndex).trim();
      result[key.toLowerCase()] = pair.substring(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    });
    return result;
  }

  return { _positional: paramsStr.split(',').map(p => p.trim().replace(/^['"]|['"]$/g, '')).filter(p => p) };
};

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const randomFrom = (chars: string, length: number): string => {
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

export const generateRandomAlpha = (length = 10) => randomFrom(UPPERCASE + LOWERCASE, length);
export const generateRandomNumeric = (length = 10) => randomFrom(DIGITS, length);
export const generateRandomUppercase = (length = 10) => randomFrom(UPPERCASE, length);
export const generateRandomLowercase = (length = 10) => randomFrom(LOWERCASE, length);
export const generateRandomAlphanumeric = (length = 10) => randomFrom(UPPERCASE + LOWERCASE + DIGITS, length);

// 常见的中文词组和短语（2-4 个字）
const CHINESE_PHRASES = [
  // 技术类
  '测试', '数据', '用户', '系统', '管理', '信息', '服务', '平台', '网络', '技术',
  '开发', '应用', '功能', '操作', '设置', '配置', '文件', '内容', '项目', '任务',
  '程序', '代码', '接口', '模块', '组件', '框架', '架构', '算法', '数据库', '服务器',
  '客户端', '前端', '后端', '全栈', '云计算', '大数据', '人工智能', '机器学习', '深度学习',
  '区块链', '物联网', '移动端', '网页', '软件', '硬件', '固件', '驱动', '协议', '标准',
  '版本', '更新', '升级', '维护', '优化', '性能', '安全', '加密', '解密', '认证',
  '授权', '权限', '角色', '日志', '监控', '告警', '备份', '恢复', '迁移', '部署',

  // 业务类
  '客户', '订单', '产品', '价格', '数量', '金额', '支付', '交易', '账户', '余额',
  '充值', '提现', '转账', '退款', '发票', '收据', '合同', '协议', '条款', '政策',
  '营销', '推广', '广告', '促销', '优惠', '折扣', '积分', '会员', '等级', '权益',
  '商品', '库存', '采购', '销售', '供应', '需求', '物流', '配送', '仓储', '运输',
  '品牌', '类目', '分类', '标签', '属性', '规格', '型号', '批次', '序列号', '条码',
  '评价', '评分', '评论', '反馈', '投诉', '建议', '咨询', '客服', '售后', '保修',

  // 组织类
  '公司', '企业', '组织', '团队', '部门', '岗位', '职位', '员工', '人员', '成员',
  '领导', '经理', '主管', '专员', '助理', '总监', '总裁', '董事', '股东', '合伙人',
  '分公司', '子公司', '总部', '分部', '办事处', '门店', '网点', '机构', '单位', '集团',

  // 操作类
  '添加', '创建', '新建', '保存', '提交', '发布', '上传', '下载', '导入', '导出',
  '删除', '移除', '清空', '修改', '编辑', '更新', '刷新', '同步', '复制', '粘贴',
  '查询', '搜索', '筛选', '排序', '分页', '统计', '汇总', '分析', '计算', '处理',
  '显示', '隐藏', '展开', '折叠', '切换', '选择', '取消', '确认', '返回', '继续',
  '开始', '结束', '暂停', '停止', '启动', '关闭', '打开', '执行', '运行', '调用',
  '发送', '接收', '推送', '拉取', '订阅', '取消订阅', '通知', '提醒', '预览', '打印',

  // 状态类
  '成功', '失败', '错误', '异常', '警告', '提示', '完成', '进行中', '待处理', '已处理',
  '启用', '禁用', '激活', '冻结', '锁定', '解锁', '在线', '离线', '忙碌', '空闲',
  '正常', '异常', '超时', '过期', '有效', '无效', '可用', '不可用', '已读', '未读',

  // 时间类
  '今天', '昨天', '明天', '本周', '上周', '下周', '本月', '上月', '下月', '今年',
  '去年', '明年', '最近', '最新', '历史', '当前', '实时', '定时', '延时', '即时',
  '早上', '上午', '中午', '下午', '晚上', '凌晨', '白天', '夜间', '工作日', '周末',

  // 地点类
  '北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '西安', '南京',
  '天津', '苏州', '郑州', '长沙', '沈阳', '青岛', '大连', '厦门', '宁波', '无锡',
  '东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山', '通州区', '顺义区',
  '办公室', '会议室', '接待室', '展厅', '仓库', '车间', '实验室', '机房', '大厅', '前台',

  // 文档类
  '文档', '报告', '记录', '日志', '说明', '手册', '指南', '教程', '案例', '模板',
  '表格', '图表', '图片', '视频', '音频', '附件', '压缩包', '文本', '代码', '脚本',

  // 通用类
  '名称', '标题', '描述', '备注', '说明', '详情', '摘要', '简介', '概述', '总结',
  '编号', '序号', '代号', '标识', '标记', '标签', '分类', '类型', '种类', '格式',
  '方式', '方法', '模式', '规则', '条件', '参数', '配置', '选项', '属性', '字段',
  '链接', '地址', '路径', '目录', '文件夹', '位置', '坐标', '区域', '范围', '边界',
  '数值', '数字', '字符', '文字', '内容', '信息', '消息', '通知', '提醒', '警告',
  '问题', '答案', '解决方案', '建议', '意见', '想法', '计划', '方案', '策略', '目标',
  '结果', '效果', '影响', '作用', '价值', '意义', '重要性', '优先级', '紧急度', '难度',

  // 形容词类
  '重要', '紧急', '普通', '一般', '特殊', '常规', '临时', '永久', '公开', '私密',
  '简单', '复杂', '困难', '容易', '快速', '缓慢', '高级', '初级', '中级', '专业',
  '标准', '自定义', '默认', '推荐', '热门', '最新', '精选', '优质', '免费', '付费',

  // 动作类
  '学习', '工作', '生活', '娱乐', '休息', '运动', '旅游', '购物', '阅读', '写作',
  '思考', '讨论', '交流', '沟通', '协作', '合作', '竞争', '比较', '选择', '决定',
  '计划', '安排', '组织', '管理', '控制', '监督', '检查', '审核', '批准', '拒绝'
];

// 单字填充词
const SINGLE_CHINESE_CHARS = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞';

/** 生成指定字数的随机中文：优先拼接常用词组，剩余位置用单字补齐 */
export const generateRandomChineseString = (length = 10): string => {
  let result = '';
  let currentLength = 0;
  while (currentLength < length) {
    const remainingLength = length - currentLength;
    const suitablePhrases = remainingLength >= 2
      ? CHINESE_PHRASES.filter(phrase => phrase.length <= remainingLength)
      : [];
    if (suitablePhrases.length > 0) {
      const phrase = suitablePhrases[Math.floor(Math.random() * suitablePhrases.length)];
      result += phrase;
      currentLength += phrase.length;
    } else {
      result += SINGLE_CHINESE_CHARS.charAt(Math.floor(Math.random() * SINGLE_CHINESE_CHARS.length));
      currentLength++;
    }
  }
  return result;
};

/** 不带参数时各内置变量的值；同一次解析会话内保持一致 */
export const createBuiltInValues = (now: Date): Record<string, string> => ({
  '$timestamp': now.getTime().toString(),
  '$isoTimestamp': now.toISOString(),
  '$randomInt': Math.floor(Math.random() * 1001).toString(),
  '$guid': crypto.randomUUID(),
  '$date': formatDateTime(now, 'yyyyMMdd'),
  '$time': formatDateTime(now, 'HHmmss'),
  '$datetime': formatDateTime(now, 'yyyyMMddHHmmss'),
  '$randomAlpha': generateRandomAlpha(10),
  '$randomNumeric': generateRandomNumeric(10),
  '$randomUppercase': generateRandomUppercase(10),
  '$randomLowercase': generateRandomLowercase(10),
  '$randomAlphanumeric': generateRandomAlphanumeric(10),
  '$randomChinese': generateRandomChineseString(10),
  // 仅用于提示，实际值由解析器按序列生成
  '$sequence': '1',
});

const isCall = (name: string, funcName: string) => name === funcName || name.startsWith(`${funcName}(`);

/** 第一个有值的命名参数（同一参数可以有别名，例如 length / len） */
const namedParam = (params: DynamicVariableParams, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
};

const lengthParam = (params: DynamicVariableParams | null): number => {
  if (!params) return 10;
  if (params._positional && params._positional[0]) return parseInt(params._positional[0], 10) || 10;
  const length = namedParam(params, 'length', 'len');
  if (length) return parseInt(length, 10) || 10;
  return 10;
};

const formatParam = (params: DynamicVariableParams | null, fallback: string): string => {
  if (!params) return fallback;
  if (params._positional && params._positional[0]) return params._positional[0];
  return namedParam(params, 'format', 'fmt') || fallback;
};

const RANDOM_GENERATORS: Array<[string, (length: number) => string]> = [
  ['$randomAlpha', generateRandomAlpha],
  ['$randomNumeric', generateRandomNumeric],
  ['$randomUppercase', generateRandomUppercase],
  ['$randomLowercase', generateRandomLowercase],
  ['$randomAlphanumeric', generateRandomAlphanumeric],
  ['$randomChinese', generateRandomChineseString],
];

const DATE_FORMATS: Array<[string, string]> = [
  ['$date', 'yyyyMMdd'],
  ['$time', 'HHmmss'],
  ['$datetime', 'yyyyMMddHHmmss'],
];

/**
 * 解析带参数的动态变量（$sequence 除外）。不是这些函数时返回 undefined。
 * 不带参数的 $timestamp、$guid 等由 createBuiltInValues 提供。
 */
export const resolveDynamicFunction = (name: string, now: Date): string | undefined => {
  if (isCall(name, '$randomInt')) {
    let start = 0;
    let end = 1000;
    const params = parseParameters(name, '$randomInt');
    if (params) {
      if (params._positional) {
        if (params._positional[0]) start = parseInt(params._positional[0], 10);
        if (params._positional[1]) end = parseInt(params._positional[1], 10);
      } else {
        const startValue = namedParam(params, 'start', 'min');
        const endValue = namedParam(params, 'end', 'max');
        if (startValue) start = parseInt(startValue, 10) || 0;
        if (endValue) end = parseInt(endValue, 10) || 1000;
      }
    }
    return (Math.floor(Math.random() * (end - start + 1)) + start).toString();
  }

  for (const [funcName, generate] of RANDOM_GENERATORS) {
    if (isCall(name, funcName)) return generate(lengthParam(parseParameters(name, funcName)));
  }

  for (const [funcName, defaultFormat] of DATE_FORMATS) {
    if (isCall(name, funcName)) return formatDateTime(now, formatParam(parseParameters(name, funcName), defaultFormat));
  }

  return undefined;
};

export interface SequenceCall {
  name: string;
  /** null 表示未指定，沿用序列配置中的值 */
  padding: number | null;
  startValue: number;
  step: number;
}

/** 解析 `$sequence`、`$sequence(name, padding, start, step)` 或命名参数形式；不是序列变量时返回 null */
export const parseSequenceCall = (name: string): SequenceCall | null => {
  if (!isCall(name, '$sequence')) return null;
  const call: SequenceCall = { name: 'default', padding: null, startValue: 1, step: 1 };

  const paramsMatch = name.match(/^\$sequence\s*\(\s*([^)]*)\s*\)$/);
  if (!paramsMatch) return call;
  const paramsStr = paramsMatch[1].trim();

  if (paramsStr.includes('=')) {
    paramsStr.split(',').map(p => p.trim()).filter(p => p).forEach(pair => {
      const equalIndex = pair.indexOf('=');
      if (equalIndex === -1) return;
      const key = pair.substring(0, equalIndex).trim().toLowerCase();
      const value = pair.substring(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key === 'name') call.name = value;
      else if (key === 'padding' || key === 'pad') call.padding = parseInt(value, 10) || 0;
      else if (key === 'start' || key === 'startvalue') call.startValue = parseInt(value, 10) || 1;
      else if (key === 'step') call.step = parseInt(value, 10) || 1;
    });
    return call;
  }

  const params = paramsStr.split(',').map(p => p.trim().replace(/^['"]|['"]$/g, '')).filter(p => p);
  if (params.length > 0 && params[0]) {
    if (/^\d+$/.test(params[0])) {
      // 只指定起始值
      call.startValue = parseInt(params[0], 10);
    } else {
      call.name = params[0];
      if (params[1]) call.padding = parseInt(params[1], 10) || 0;
      if (params[2]) call.startValue = parseInt(params[2], 10) || 1;
      if (params[3]) call.step = parseInt(params[3], 10) || 1;
    }
  }
  return call;
};

/** 文本中用到的序列（{{$sequence...}}），按首次出现的顺序，同名只取第一次 */
export const findSequenceCalls = (text: string): SequenceCall[] => {
  const calls = new Map<string, SequenceCall>();
  for (const match of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const call = parseSequenceCall(match[1].trim());
    if (call && !calls.has(call.name)) calls.set(call.name, call);
  }
  return [...calls.values()];
};
