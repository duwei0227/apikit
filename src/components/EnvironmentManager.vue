<script setup>
import { ref, computed, onMounted } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useEnvironmentsStore } from '@/stores/environments';
import { useSequencesStore } from '@/stores/sequences';
import { importExportService } from '@/services/import-export';
import { useKeyValueRows } from '@/composables/useKeyValueRows';

const props = defineProps({
  currentRequest: {
    type: Object,
    default: null
  }
});

const confirm = useConfirm();
const environmentsStore = useEnvironmentsStore();
const sequencesStore = useSequencesStore();

const showEnvDialog = ref(false);
const envDialogMode = ref('list'); // 'list', 'add', 'edit'
const editingEnv = ref({
  id: '',
  name: '',
  variables: [{ key: '', value: '', enabled: true }]
});
const hoveredVariableIndex = ref(-1);

// 序列管理相关
const showSequenceDialog = ref(false);
const editingSequence = ref(null);
const showSequenceEditDialog = ref(false);

// 变量查看相关
const showVariablesViewDialog = ref(false);
const currentRequestVariables = ref({
  environment: [],
  global: [],
  sequences: []
});

// 全局变量编辑相关
const showEditGlobalVarDialog = ref(false);
const editingGlobalVar = ref({ key: '', value: '', description: '', originalKey: '' });

// 使用 store 中的数据
const currentEnvironment = computed({
  get: () => environmentsStore.activeEnvironmentId,
  set: (value) => environmentsStore.setActiveEnvironment(value)
});

const environments = computed(() =>
  [...environmentsStore.environments].sort((a, b) => a.name.localeCompare(b.name))
);

const environmentOptions = computed(() => {
  return [
    { label: 'No Environment', value: null },
    ...environments.value.map(env => ({ label: env.name, value: env.id }))
  ];
});

// 加载环境数据
onMounted(async () => {
  await environmentsStore.loadEnvironments();
  await sequencesStore.loadSequences();
});

// 环境管理函数
const openEnvDialog = () => {
  envDialogMode.value = 'list';
  showEnvDialog.value = true;
};

const openAddEnv = () => {
  envDialogMode.value = 'add';
  editingEnv.value = {
    id: '',
    name: '',
    variables: [{ key: '', value: '', enabled: true }]
  };
};

// Method to open create dialog directly (for global shortcut)
const openCreateDialog = () => {
  showEnvDialog.value = true;
  openAddEnv();
};

const openEditEnv = (env) => {
  envDialogMode.value = 'edit';
  editingEnv.value = JSON.parse(JSON.stringify(env));
  // 确保至少有一个空行
  if (editingEnv.value.variables.length === 0 || 
      editingEnv.value.variables[editingEnv.value.variables.length - 1].key) {
    editingEnv.value.variables.push({ key: '', value: '', enabled: true });
  }
};

const saveEnvironment = async () => {
  if (!editingEnv.value.name.trim()) {
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Environment name is required',
        life: 3000
      });
    }
    return;
  }

  try {
    // 过滤掉空的变量
    const filteredVariables = editingEnv.value.variables.filter(v => v.key.trim());

    if (envDialogMode.value === 'add') {
      const newEnv = await environmentsStore.createEnvironment(editingEnv.value.name.trim());
      if (filteredVariables.length > 0) {
        await environmentsStore.updateEnvironment(newEnv.id, {
          variables: filteredVariables
        });
      }
      
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Environment created successfully',
          life: 2000
        });
      }
    } else if (envDialogMode.value === 'edit') {
      await environmentsStore.updateEnvironment(editingEnv.value.id, {
        name: editingEnv.value.name.trim(),
        variables: filteredVariables
      });
      
      if (window.$toast) {
        window.$toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Environment updated successfully',
          life: 2000
        });
      }
    }

    envDialogMode.value = 'list';
  } catch (error) {
    console.error('Failed to save environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to save environment',
        life: 3000
      });
    }
  }
};

const cancelEnvEdit = () => {
  envDialogMode.value = 'list';
};

const deleteEnvironment = (envId) => {
  const env = environments.value.find(e => e.id === envId);
  if (!env) return;

  confirm.require({
    message: `Are you sure you want to delete environment "${env.name}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await environmentsStore.deleteEnvironment(envId);

        if (window.$toast) {
          window.$toast.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Environment deleted successfully',
            life: 2000
          });
        }
      } catch (error) {
        console.error('Failed to delete environment:', error);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete environment',
            life: 3000
          });
        }
      }
    }
  });
};

const copyEnvironment = async (env) => {
  const newName = `${env.name} (Copy)`;

  try {
    // 创建新环境
    const newEnv = await environmentsStore.createEnvironment(newName);

    // 复制变量（过滤掉空行）
    const filteredVariables = env.variables.filter(v => v.key.trim());
    if (filteredVariables.length > 0) {
      await environmentsStore.updateEnvironment(newEnv.id, {
        variables: filteredVariables
      });
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: `Environment "${newName}" created`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to copy environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy environment',
        life: 3000
      });
    }
  }
};

const importEnvironments = async () => {
  try {
    const importedEnvironments = await importExportService.importEnvironments();

    if (!importedEnvironments) {
      return;
    }

    for (const environment of importedEnvironments) {
      const environmentName = environment.name?.trim() || 'Imported Environment';
      const existingEnv = environmentsStore.environments.find(env => env.name === environmentName);

      if (existingEnv) {
        await environmentsStore.updateEnvironment(existingEnv.id, {
          variables: environment.variables || []
        });
        continue;
      }

      const newEnv = await environmentsStore.createEnvironment(environmentName);
      await environmentsStore.updateEnvironment(newEnv.id, {
        variables: environment.variables || []
      });
    }

    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: importedEnvironments.length === 1
          ? 'Environment imported successfully'
          : `${importedEnvironments.length} environments imported successfully`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to import environments:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to import environments',
        life: 3000
      });
    }
  }
};

// 单环境导出格式选择（popup Menu）
const exportMenu = ref(null);
const menuTargetEnv = ref(null);
const exportMenuItems = computed(() => [
  {
    label: 'Export as ApiKit JSON',
    icon: 'pi pi-download',
    command: () => exportEnvironment(menuTargetEnv.value, 'apikit')
  },
  {
    label: 'Export as Postman',
    icon: 'pi pi-download',
    command: () => exportEnvironment(menuTargetEnv.value, 'postman')
  }
]);

// 打开导出格式选择菜单，记录目标环境
const openExportMenu = (event, env) => {
  menuTargetEnv.value = env;
  exportMenu.value?.toggle(event);
};

const exportEnvironment = async (env, format = 'apikit') => {
  if (!env) return;
  try {
    const exported = await importExportService.exportEnvironment(env, format);

    if (exported && window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Environment exported successfully',
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to export environment:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to export environment',
        life: 3000
      });
    }
  }
};

const exportAllEnvironments = async () => {
  if (environments.value.length === 0) {
    return;
  }

  try {
    const exported = await importExportService.exportEnvironments(environments.value);

    if (exported && window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: environments.value.length === 1
          ? 'Environment exported successfully'
          : `${environments.value.length} environments exported successfully`,
        life: 2000
      });
    }
  } catch (error) {
    console.error('Failed to export environments:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to export environments',
        life: 3000
      });
    }
  }
};

const { remove: deleteVariable, onChange: onVariableChange } = useKeyValueRows({
  getRows: () => editingEnv.value.variables,
  createRow: () => ({ key: '', value: '', enabled: true }),
});

const getEnvDialogTitle = () => {
  if (envDialogMode.value === 'list') return 'Manage Environments';
  if (envDialogMode.value === 'add') return 'Add Environment';
  return 'Edit Environment';
};

// 序列管理函数
const openSequenceDialog = () => {
  showSequenceDialog.value = true;
};

const openEditSequence = (sequence) => {
  editingSequence.value = {
    name: sequence.name,
    currentValue: sequence.currentValue,
    step: sequence.step,
    padding: sequence.padding
  };
  showSequenceEditDialog.value = true;
};

const saveSequence = async () => {
  if (!editingSequence.value) return;
  
  try {
    const updates = {
      currentValue: editingSequence.value.currentValue,
      step: editingSequence.value.step,
      padding: editingSequence.value.padding
    };
    
    await sequencesStore.updateSequence(editingSequence.value.name, updates);
    
    if (window.$toast) {
      window.$toast.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Sequence updated successfully',
        life: 2000
      });
    }
    
    showSequenceEditDialog.value = false;
    editingSequence.value = null;
  } catch (error) {
    console.error('[EnvironmentManager] Failed to update sequence:', error);
    if (window.$toast) {
      window.$toast.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to update sequence',
        life: 3000
      });
    }
  }
};

const deleteSequence = (sequenceName) => {
  confirm.require({
    message: `Are you sure you want to delete sequence "${sequenceName}"?`,
    header: 'Confirm Deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await sequencesStore.deleteSequence(sequenceName);
        
        if (window.$toast) {
          window.$toast.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Sequence deleted successfully',
            life: 2000
          });
        }
      } catch (error) {
        console.error('Failed to delete sequence:', error);
        if (window.$toast) {
          window.$toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete sequence',
            life: 3000
          });
        }
      }
    }
  });
};

// 变量查看函数
const openVariablesView = () => {
  // 收集当前使用的变量信息
  
  // 1. Environment 变量
  const envVars = [];
  if (currentEnvironment.value) {
    const env = environments.value.find(e => e.id === currentEnvironment.value);
    if (env) {
      env.variables.forEach(v => {
        if (v.key && v.enabled !== false) {
          envVars.push({
            key: v.key,
            value: v.value,
            enabled: v.enabled !== false
          });
        }
      });
    }
  }
  
  // 2. 全局变量（从 store 获取）
  const globalVars = [];
  environmentsStore.globalVariables.forEach(v => {
    if (v.key && v.enabled !== false) {
      globalVars.push({
        key: v.key,
        value: v.value,
        enabled: v.enabled !== false,
        description: v.description || ''
      });
    }
  });
  
  // 3. Sequence 变量 - 只显示当前请求中使用的
  const sequences = [];
  if (props.currentRequest) {
    // 收集请求中所有可能包含变量的字段
    const requestContent = [];
    
    // URL
    if (props.currentRequest.url) {
      requestContent.push(props.currentRequest.url);
    }
    
    // Params
    if (props.currentRequest.params && Array.isArray(props.currentRequest.params)) {
      props.currentRequest.params.forEach(param => {
        if (param.enabled && param.key) {
          requestContent.push(param.key);
          requestContent.push(param.value);
        }
      });
    }
    
    // Headers
    if (props.currentRequest.headers && Array.isArray(props.currentRequest.headers)) {
      props.currentRequest.headers.forEach(header => {
        if (header.enabled && header.key) {
          requestContent.push(header.key);
          requestContent.push(header.value);
        }
      });
    }
    
    // Body
    if (props.currentRequest.body) {
      if (['json', 'xml', 'text'].includes(props.currentRequest.body.type) && props.currentRequest.body.raw) {
        requestContent.push(props.currentRequest.body.raw);
      } else if (props.currentRequest.body.type === 'x-www-form-urlencoded' && props.currentRequest.body.urlencoded) {
        props.currentRequest.body.urlencoded.forEach(item => {
          if (item.enabled && item.key) {
            requestContent.push(item.key);
            requestContent.push(item.value);
          }
        });
      } else if (props.currentRequest.body.type === 'form-data' && props.currentRequest.body.formData) {
        props.currentRequest.body.formData.forEach(item => {
          if (item.enabled && item.key && item.type === 'text') {
            requestContent.push(item.key);
            requestContent.push(item.value);
          }
        });
      }
    }
    
    // 合并所有内容
    const fullContent = requestContent.join(' ');
    
    // 查找所有 $sequence 引用
    const sequenceRegex = /\{\{\s*\$sequence\s*(?:\(\s*([^)]*)\s*\))?\s*\}\}/g;
    const usedSequenceNames = new Set();
    let match;
    
    while ((match = sequenceRegex.exec(fullContent)) !== null) {
      const params = match[1]; // 括号内的参数
      
      if (!params) {
        // 没有参数，使用默认名称
        usedSequenceNames.add('default');
      } else {
        // 解析参数
        if (params.includes('=')) {
          // 命名参数格式：name=value 或 name="value"
          const nameMatch = params.match(/name\s*=\s*['"]?([^'",)]+)['"]?/);
          
          if (nameMatch) {
            const seqName = nameMatch[1].trim();
            usedSequenceNames.add(seqName);
          } else {
            // 如果没有 name 参数，使用 default
            usedSequenceNames.add('default');
          }
        } else {
          // 位置参数格式
          const parts = params.split(',').map(p => p.trim().replace(/^['"]|['"]$/g, ''));
          
          if (parts[0]) {
            // 检查第一个参数是否是纯数字
            const isNumber = /^\d+$/.test(parts[0]);
            
            if (isNumber) {
              // 纯数字，表示起始值，使用 default
              usedSequenceNames.add('default');
            } else {
              // 不是纯数字，表示序列名称
              usedSequenceNames.add(parts[0]);
            }
          } else {
            usedSequenceNames.add('default');
          }
        }
      }
    }
    
    // 只添加被使用的序列
    const allSequences = sequencesStore.getAllSequences();
    usedSequenceNames.forEach(seqName => {
      const existingSeq = allSequences.find(s => s.name === seqName);
      
      if (existingSeq) {
        // 序列已存在于 store 中
        sequences.push({
          name: existingSeq.name,
          currentValue: existingSeq.currentValue,
          padding: existingSeq.padding,
          step: existingSeq.step,
          startValue: existingSeq.startValue,
          displayValue: existingSeq.padding > 0 
            ? existingSeq.currentValue.toString().padStart(existingSeq.padding, '0') 
            : existingSeq.currentValue.toString(),
          initialized: true
        });
      } else {
        // 序列还未初始化（用户还没发送过请求）
        sequences.push({
          name: seqName,
          currentValue: 1,
          padding: 0,
          step: 1,
          startValue: 1,
          displayValue: '1',
          initialized: false
        });
      }
    });
  }
  
  // 同时展示 store 中已存在但未在当前请求中引用的 sequences
  const allStoreSequences = sequencesStore.getAllSequences();
  const displayedNames = new Set(sequences.map(s => s.name));
  allStoreSequences.forEach(seq => {
    if (!displayedNames.has(seq.name)) {
      sequences.push({
        name: seq.name,
        currentValue: seq.currentValue,
        padding: seq.padding,
        step: seq.step,
        startValue: seq.startValue,
        displayValue: seq.padding > 0
          ? seq.currentValue.toString().padStart(seq.padding, '0')
          : seq.currentValue.toString(),
        initialized: true
      });
    }
  });

  currentRequestVariables.value = {
    environment: envVars,
    global: globalVars,
    sequences: sequences
  };
  
  showVariablesViewDialog.value = true;
};

const editSequenceFromView = (sequenceName) => {
  let sequence = sequencesStore.getAllSequences().find(s => s.name === sequenceName);
  
  // 如果序列不存在（未初始化），创建一个临时的序列对象用于编辑
  if (!sequence) {
    sequence = {
      name: sequenceName,
      currentValue: 1,
      startValue: 1,
      step: 1,
      padding: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  
  showVariablesViewDialog.value = false;
  openEditSequence(sequence);
};

// 获取当前环境的变量（用于替换请求中的变量）
const getCurrentEnvironmentVariables = () => {
  if (!currentEnvironment.value) return {};
  const env = environments.value.find(e => e.id === currentEnvironment.value);
  if (!env) return {};
  
  const vars = {};
  env.variables.forEach(v => {
    if (v.key && v.enabled !== false) {
      vars[v.key] = v.value;
    }
  });
  return vars;
};

// 格式化日期时间的辅助函数
const formatDateTime = (date, format) => {
  const pad = (num) => String(num).padStart(2, '0');
  
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  
  return format
    .replace(/yyyy/g, year)
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/HH/g, hours)
    .replace(/mm/g, minutes)
    .replace(/ss/g, seconds);
};

// 通用参数解析函数：支持位置参数和命名参数
const parseParameters = (varName, funcName) => {
  const paramsMatch = varName.match(new RegExp(`^\\${funcName}\\s*\\(\\s*([^)]*)\\s*\\)$`));
  if (!paramsMatch) {
    return null;
  }
  
  const paramsStr = paramsMatch[1].trim();
  if (!paramsStr) {
    return {}; // 空参数
  }
  
  // 检查是否包含 = 号（命名参数）
  if (paramsStr.includes('=')) {
    // 命名参数格式
    const result = {};
    const paramPairs = paramsStr.split(',').map(p => p.trim()).filter(p => p);
    
    paramPairs.forEach(pair => {
      const equalIndex = pair.indexOf('=');
      if (equalIndex === -1) return;
      
      const key = pair.substring(0, equalIndex).trim();
      const value = pair.substring(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      result[key.toLowerCase()] = value;
    });
    
    return result;
  } else {
    // 位置参数格式
    const params = paramsStr.split(',').map(p => p.trim().replace(/^['"]|['"]$/g, '')).filter(p => p);
    return { _positional: params };
  }
};

// 生成随机字符串的辅助函数
const generateRandomString = (length = 10, options = { alpha: true, numeric: true, uppercase: true, lowercase: true }) => {
  let chars = '';
  
  if (options.uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (options.numeric) chars += '0123456789';
  
  // 如果没有选择任何字符类型，默认使用全部
  if (chars === '') {
    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  }
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
};

// 生成随机字母字符串（大小写混合）
const generateRandomAlpha = (length = 10) => {
  return generateRandomString(length, { uppercase: true, lowercase: true, numeric: false });
};

// 生成随机数字字符串
const generateRandomNumeric = (length = 10) => {
  return generateRandomString(length, { uppercase: false, lowercase: false, numeric: true });
};

// 生成随机大写字母字符串
const generateRandomUppercase = (length = 10) => {
  return generateRandomString(length, { uppercase: true, lowercase: false, numeric: false });
};

// 生成随机小写字母字符串
const generateRandomLowercase = (length = 10) => {
  return generateRandomString(length, { uppercase: false, lowercase: true, numeric: false });
};

// 生成随机字母数字混合字符串
const generateRandomAlphanumeric = (length = 10) => {
  return generateRandomString(length, { uppercase: true, lowercase: true, numeric: true });
};

// 生成随机中文字符串的辅助函数
const generateRandomChineseString = (length = 10) => {
  // 常见的中文词组和短语（2-4个字）- 扩充到500+个
  const chinesePhrases = [
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
  
  // 单字填充词（扩充到1000+个常用字）
  const singleChars = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞';
  
  let result = '';
  let currentLength = 0;
  
  // 优先使用词组
  while (currentLength < length) {
    const remainingLength = length - currentLength;
    
    // 如果剩余长度较大，使用词组
    if (remainingLength >= 2) {
      // 过滤出长度合适的词组
      const suitablePhrases = chinesePhrases.filter(phrase => phrase.length <= remainingLength);
      
      if (suitablePhrases.length > 0) {
        const randomPhrase = suitablePhrases[Math.floor(Math.random() * suitablePhrases.length)];
        result += randomPhrase;
        currentLength += randomPhrase.length;
      } else {
        // 如果没有合适的词组，使用单字
        const randomIndex = Math.floor(Math.random() * singleChars.length);
        result += singleChars.charAt(randomIndex);
        currentLength++;
      }
    } else {
      // 剩余长度为1，使用单字
      const randomIndex = Math.floor(Math.random() * singleChars.length);
      result += singleChars.charAt(randomIndex);
      currentLength++;
    }
  }
  
  return result;
};

// 获取所有可用变量（环境变量 + 内置变量）
const getAllAvailableVariables = (now = new Date()) => {
  const envVars = getCurrentEnvironmentVariables();
  
  // 全局变量（由 Tests 设置的）
  const globalVars = {};
  if (environmentsStore.globalVariables) {
    environmentsStore.globalVariables.forEach(v => {
      if (v.key && v.enabled !== false) {
        globalVars[v.key] = v.value;
      }
    });
  }
  
  // 内置变量
  // $randomInt: 默认范围 0-1000，也可以使用 $randomInt(start, end) 指定范围
  // $date: 默认格式 yyyy-MM-dd，也可以使用 $date(format) 自定义格式
  // $time: 默认格式 HH:mm:ss，也可以使用 $time(format) 自定义格式
  // $datetime: 默认格式 yyyy-MM-dd HH:mm:ss，也可以使用 $datetime(format) 自定义格式
  // $randomAlpha: 默认长度 10，仅字母（大小写混合），可以使用 $randomAlpha(length) 自定义
  // $randomNumeric: 默认长度 10，仅数字，可以使用 $randomNumeric(length) 自定义
  // $randomUppercase: 默认长度 10，仅大写字母，可以使用 $randomUppercase(length) 自定义
  // $randomLowercase: 默认长度 10，仅小写字母，可以使用 $randomLowercase(length) 自定义
  // $randomAlphanumeric: 默认长度 10，字母数字混合，可以使用 $randomAlphanumeric(length) 自定义
  // $randomChinese: 默认长度 10，生成随机中文字符，可以使用 $randomChinese(length) 自定义
  // $sequence: 自增序列，可以使用 $sequence(name, padding, start, step) 自定义
  const builtInVars = {
    '$timestamp': now.getTime().toString(),
    '$isoTimestamp': now.toISOString(),
    '$randomInt': Math.floor(Math.random() * 1001).toString(), // 0-1000
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
    '$sequence': '1', // 默认序列的示例值（仅用于提示，实际值由 replaceVariables 中的特殊逻辑生成）
  };
  
  return { ...globalVars, ...envVars, ...builtInVars };
};

// 替换字符串中的变量
const replaceVariables = (str, resolutionContext = null) => {
  if (!str || typeof str !== 'string') return str;
  
  const allVars = resolutionContext?.allVars || getAllAvailableVariables();
  console.log('[EnvironmentManager] ========== replaceVariables START ==========');
  console.log('[EnvironmentManager] Input string:', str);
  console.log('[EnvironmentManager] Input string length:', str.length);
  console.log('[EnvironmentManager] Input string charCodes:', Array.from(str).map(c => c.charCodeAt(0)).join(','));
  console.log('[EnvironmentManager] Available variables:', Object.keys(allVars));
  console.log('[EnvironmentManager] Sequences store loaded:', sequencesStore.getAllSequences().length, 'sequences');
  
  const result = str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmedVarName = varName.trim();
    console.log(`[EnvironmentManager] Processing variable: "${trimmedVarName}" from match: "${match}"`);

    const isSequenceVariable = trimmedVarName === '$sequence' || trimmedVarName.startsWith('$sequence(');
    if (!isSequenceVariable && resolutionContext?.resolvedValues.has(trimmedVarName)) {
      return resolutionContext.resolvedValues.get(trimmedVarName);
    }

    const resolvedValue = (() => {
    
    // 检查是否是 $sequence 函数调用
    if (trimmedVarName === '$sequence' || trimmedVarName.startsWith('$sequence(')) {
      let name = 'default';
      let padding = null; // null 表示未指定，使用序列配置中的值
      let startValue = 1;
      let step = 1;
      
      // 提取括号内的参数
      const paramsMatch = trimmedVarName.match(/^\$sequence\s*\(\s*([^)]*)\s*\)$/);
      if (paramsMatch) {
        const paramsStr = paramsMatch[1].trim();
        
        // 检查是否包含 = 号（命名参数）
        if (paramsStr.includes('=')) {
          // 命名参数格式：name=value, key=value
          const paramPairs = paramsStr.split(',').map(p => p.trim()).filter(p => p);
          
          paramPairs.forEach(pair => {
            const equalIndex = pair.indexOf('=');
            if (equalIndex === -1) return;
            
            const key = pair.substring(0, equalIndex).trim();
            const value = pair.substring(equalIndex + 1).trim();
            const cleanValue = value.replace(/^['"]|['"]$/g, '');
            
            switch (key.toLowerCase()) {
              case 'name':
                name = cleanValue;
                break;
              case 'padding':
              case 'pad':
                padding = parseInt(cleanValue, 10) || 0;
                break;
              case 'start':
              case 'startvalue':
                startValue = parseInt(cleanValue, 10) || 1;
                break;
              case 'step':
                step = parseInt(cleanValue, 10) || 1;
                break;
            }
          });
        } else {
          // 位置参数格式：按顺序解析
          const params = paramsStr.split(',').map(p => p.trim().replace(/^['"]|['"]$/g, '')).filter(p => p);
          
          if (params.length > 0 && params[0]) {
            // 检查第一个参数是否是纯数字（只指定起始值的情况）
            if (/^\d+$/.test(params[0])) {
              startValue = parseInt(params[0], 10);
            } else {
              // 第一个参数不是纯数字，视为名称
              name = params[0];
              if (params[1]) padding = parseInt(params[1], 10) || 0;
              if (params[2]) startValue = parseInt(params[2], 10) || 1;
              if (params[3]) step = parseInt(params[3], 10) || 1;
            }
          }
        }
      }
      
      // 预览只在当前解析会话内模拟步进，不创建或推进真实序列。
      if (resolutionContext?.consumeSequences === false) {
        return sequencesStore.getPreviewNextValue(
          resolutionContext.sequenceStates,
          name,
          padding,
          startValue,
          step,
        );
      }

      // 检查序列是否已存在
      const existingSeq = sequencesStore.getSequenceSnapshot(name);
      
      if (existingSeq) {
        // 序列已存在：忽略 startValue 和 step 参数
        // padding: 如果用户指定了，使用指定的值；否则使用序列配置中的值
        const sequenceValue = sequencesStore.getNextValue(name, padding, existingSeq.startValue, existingSeq.step);
        return sequenceValue;
      } else {
        // 序列不存在，使用提供的参数创建新序列
        // padding: 如果用户没有指定，使用 0（不填充）
        const sequenceValue = sequencesStore.getNextValue(name, padding ?? 0, startValue, step);
        return sequenceValue;
      }
    }
    
    // 检查是否是 $randomInt 函数调用
    // 支持格式: $randomInt, $randomInt(start, end), $randomInt(min=1, max=100)
    if (trimmedVarName === '$randomInt' || trimmedVarName.startsWith('$randomInt(')) {
      let start = 0;
      let end = 1000;
      
      const params = parseParameters(trimmedVarName, '$randomInt');
      if (params) {
        if (params._positional) {
          // 位置参数
          if (params._positional[0]) start = parseInt(params._positional[0], 10);
          if (params._positional[1]) end = parseInt(params._positional[1], 10);
        } else {
          // 命名参数
          if (params.start || params.min) start = parseInt(params.start || params.min, 10) || 0;
          if (params.end || params.max) end = parseInt(params.end || params.max, 10) || 1000;
        }
      }
      
      const randomValue = Math.floor(Math.random() * (end - start + 1)) + start;
      console.log(`[EnvironmentManager] Replacing ${match} with random int between ${start} and ${end}: ${randomValue}`);
      return randomValue.toString();
    }
    
    
    // 检查是否是 $randomAlpha 函数调用
    // 支持格式: $randomAlpha, $randomAlpha(length), $randomAlpha(length=20)
    if (trimmedVarName === '$randomAlpha' || trimmedVarName.startsWith('$randomAlpha(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomAlpha');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomAlpha = generateRandomAlpha(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random alpha (length: ${length}): ${randomAlpha}`);
      return randomAlpha;
    }
    
    // 检查是否是 $randomNumeric 函数调用
    // 支持格式: $randomNumeric, $randomNumeric(length), $randomNumeric(length=6)
    if (trimmedVarName === '$randomNumeric' || trimmedVarName.startsWith('$randomNumeric(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomNumeric');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomNumeric = generateRandomNumeric(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random numeric (length: ${length}): ${randomNumeric}`);
      return randomNumeric;
    }
    
    // 检查是否是 $randomUppercase 函数调用
    // 支持格式: $randomUppercase, $randomUppercase(length), $randomUppercase(length=15)
    if (trimmedVarName === '$randomUppercase' || trimmedVarName.startsWith('$randomUppercase(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomUppercase');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomUppercase = generateRandomUppercase(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random uppercase (length: ${length}): ${randomUppercase}`);
      return randomUppercase;
    }
    
    // 检查是否是 $randomLowercase 函数调用
    // 支持格式: $randomLowercase, $randomLowercase(length), $randomLowercase(length=12)
    if (trimmedVarName === '$randomLowercase' || trimmedVarName.startsWith('$randomLowercase(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomLowercase');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomLowercase = generateRandomLowercase(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random lowercase (length: ${length}): ${randomLowercase}`);
      return randomLowercase;
    }
    
    // 检查是否是 $randomAlphanumeric 函数调用
    // 支持格式: $randomAlphanumeric, $randomAlphanumeric(length), $randomAlphanumeric(length=16)
    if (trimmedVarName === '$randomAlphanumeric' || trimmedVarName.startsWith('$randomAlphanumeric(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomAlphanumeric');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomAlphanumeric = generateRandomAlphanumeric(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random alphanumeric (length: ${length}): ${randomAlphanumeric}`);
      return randomAlphanumeric;
    }
    
    // 检查是否是 $randomChinese 函数调用
    // 支持格式: $randomChinese, $randomChinese(length), $randomChinese(length=20)
    if (trimmedVarName === '$randomChinese' || trimmedVarName.startsWith('$randomChinese(')) {
      let length = 10;
      
      const params = parseParameters(trimmedVarName, '$randomChinese');
      if (params) {
        if (params._positional && params._positional[0]) {
          length = parseInt(params._positional[0], 10) || 10;
        } else if (params.length || params.len) {
          length = parseInt(params.length || params.len, 10) || 10;
        }
      }
      
      const randomChinese = generateRandomChineseString(length);
      console.log(`[EnvironmentManager] Replacing ${match} with random Chinese string (length: ${length}): ${randomChinese}`);
      return randomChinese;
    }
    
    // 检查是否是 $date 函数调用
    // 支持格式: $date, $date("format"), $date(format="yyyy/MM/dd")
    if (trimmedVarName === '$date' || trimmedVarName.startsWith('$date(')) {
      let format = 'yyyyMMdd';
      
      const params = parseParameters(trimmedVarName, '$date');
      if (params) {
        if (params._positional && params._positional[0]) {
          format = params._positional[0];
        } else if (params.format || params.fmt) {
          format = params.format || params.fmt;
        }
      }
      
      const formattedDate = formatDateTime(resolutionContext?.now || new Date(), format);
      console.log(`[EnvironmentManager] Replacing ${match} with formatted date: ${formattedDate}`);
      return formattedDate;
    }
    
    // 检查是否是 $time 函数调用
    // 支持格式: $time, $time("format"), $time(format="HH:mm")
    if (trimmedVarName === '$time' || trimmedVarName.startsWith('$time(')) {
      let format = 'HHmmss';
      
      const params = parseParameters(trimmedVarName, '$time');
      if (params) {
        if (params._positional && params._positional[0]) {
          format = params._positional[0];
        } else if (params.format || params.fmt) {
          format = params.format || params.fmt;
        }
      }
      
      const formattedTime = formatDateTime(resolutionContext?.now || new Date(), format);
      console.log(`[EnvironmentManager] Replacing ${match} with formatted time: ${formattedTime}`);
      return formattedTime;
    }
    
    // 检查是否是 $datetime 函数调用
    // 支持格式: $datetime, $datetime("format"), $datetime(format="yyyy-MM-dd HH:mm")
    if (trimmedVarName === '$datetime' || trimmedVarName.startsWith('$datetime(')) {
      let format = 'yyyyMMddHHmmss';
      
      const params = parseParameters(trimmedVarName, '$datetime');
      if (params) {
        if (params._positional && params._positional[0]) {
          format = params._positional[0];
        } else if (params.format || params.fmt) {
          format = params.format || params.fmt;
        }
      }
      
      const formattedDatetime = formatDateTime(resolutionContext?.now || new Date(), format);
      console.log(`[EnvironmentManager] Replacing ${match} with formatted datetime: ${formattedDatetime}`);
      return formattedDatetime;
    }
    
    // 普通变量替换
    // 注意：$sequence 已经在上面特殊处理了，不会到达这里
    const ordinaryReplacement = allVars[trimmedVarName] !== undefined ? allVars[trimmedVarName] : match;
    console.log(`[EnvironmentManager] Ordinary variable replacement: ${match} -> ${ordinaryReplacement}`);
    return ordinaryReplacement;
    })();

    if (!isSequenceVariable && resolutionContext && resolvedValue !== match) {
      resolutionContext.resolvedValues.set(trimmedVarName, resolvedValue);
    }
    return resolvedValue;
  });
  
  console.log('[EnvironmentManager] Result:', result);
  console.log('[EnvironmentManager] Result length:', result.length);
  console.log('[EnvironmentManager] ========== replaceVariables END ==========');
  return result;
};

// 创建一次变量解析会话。预览会话会固定动态值，并只在内存中模拟序列步进。
const createVariableResolver = ({ consumeSequences = true } = {}) => {
  const now = new Date();
  const resolutionContext = {
    consumeSequences,
    now,
    allVars: getAllAvailableVariables(now),
    resolvedValues: new Map(),
    sequenceStates: new Map(),
  };

  return (value) => replaceVariables(value, resolutionContext);
};

// 设置全局变量的方法
const setGlobalVariable = (key, value, enabled = true, description = undefined) => {
  console.log('[EnvironmentManager] setGlobalVariable called:', key, value);
  console.log('[EnvironmentManager] environmentsStore:', environmentsStore);
  console.log('[EnvironmentManager] Current globalVariables before:', environmentsStore.globalVariables);

  environmentsStore.setGlobalVariable(key, String(value), true, description);
  
  console.log('[EnvironmentManager] Current globalVariables after:', environmentsStore.globalVariables);
  console.log('[EnvironmentManager] Saving to storage...');
  
  // 保存到持久化存储
  environmentsStore.saveEnvironments();
  
  console.log('[EnvironmentManager] Save complete');
};

// 编辑全局变量
const editGlobalVariable = (variable) => {
  editingGlobalVar.value = {
    key: variable.key,
    value: variable.value,
    description: variable.description || '',
    originalKey: variable.key
  };
  showEditGlobalVarDialog.value = true;
};

const saveEditGlobalVariable = () => {
  const { key, value, description, originalKey } = editingGlobalVar.value;
  if (!key.trim()) return;

  // 如果 key 改了，先删旧的再加新的
  if (originalKey !== key.trim()) {
    environmentsStore.deleteGlobalVariable(originalKey);
  }
  environmentsStore.setGlobalVariable(key.trim(), value, true, description);

  showEditGlobalVarDialog.value = false;
  // 刷新变量视图
  openVariablesView();
};

const deleteGlobalVariable = (key) => {
  environmentsStore.deleteGlobalVariable(key);
  // 刷新变量视图
  openVariablesView();

  if (window.$toast) {
    window.$toast.add({
      severity: 'success',
      summary: 'Deleted',
      detail: `Global variable "${key}" deleted`,
      life: 2000
    });
  }
};

defineExpose({
  getCurrentEnvironmentVariables,
  getAllAvailableVariables,
  replaceVariables,
  createVariableResolver,
  currentEnvironment,
  openCreateDialog,
  setGlobalVariable
});
</script>

<template>
  <div class="environment-manager flex items-center gap-2">
    <Dropdown 
      v-model="currentEnvironment"
      :options="environmentOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="No Environment"
      class="w-48"
      size="small"
    />
    <Button 
      icon="pi pi-cog"
      text
      rounded
      size="small"
      severity="secondary"
      title="Manage Environments"
      @click="openEnvDialog"
    />
    <Button 
      icon="pi pi-eye"
      text
      rounded
      size="small"
      severity="secondary"
      title="View Variables"
      @click="openVariablesView"
    />
    <Button 
      icon="pi pi-sort-numeric-up"
      text
      rounded
      size="small"
      severity="secondary"
      title="Manage Sequences"
      @click="openSequenceDialog"
    />
    
    <!-- Environment Management Dialog -->
    <Dialog 
      v-model:visible="showEnvDialog"
      :header="getEnvDialogTitle()"
      :modal="true"
      :style="{ width: '72vw', maxWidth: '72vw' }"
      :closable="envDialogMode === 'list'"
    >
      <!-- List View -->
      <div v-if="envDialogMode === 'list'" class="flex flex-col gap-4">
        <div class="flex justify-between items-center">
          <span class="text-sm font-medium text-surface-700 dark:text-surface-300">
            Environments
          </span>
          <div class="flex gap-2">
            <Button
              label="Import"
              icon="pi pi-upload"
              size="small"
              severity="secondary"
              @click="importEnvironments"
            />
            <Button
              label="Export All"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              :disabled="environments.length === 0"
              @click="exportAllEnvironments"
            />
            <Button 
              label="Add"
              icon="pi pi-plus"
              size="small"
              @click="openAddEnv"
            />
          </div>
        </div>
        
        <div v-if="environments.length === 0" class="text-center py-8 text-surface-500 dark:text-surface-400 text-sm">
          No environments configured
        </div>
        
        <div v-else class="space-y-2">
          <div 
            v-for="env in environments"
            :key="env.id"
            class="p-3 border border-surface-200 dark:border-surface-700 rounded hover:bg-surface-50 dark:hover:bg-surface-900 cursor-pointer transition flex justify-between items-center"
            @click="openEditEnv(env)"
          >
            <div>
              <div class="text-sm font-medium text-surface-900 dark:text-surface-50">
                {{ env.name }}
              </div>
              <div class="text-xs text-surface-500 dark:text-surface-400 mt-1">
                {{ env.variables.length }} variable(s)
              </div>
            </div>
            <div class="flex gap-1">
              <Button
                icon="pi pi-download"
                text
                rounded
                size="small"
                severity="secondary"
                title="Export"
                @click.stop="openExportMenu($event, env)"
              />
              <Button
                icon="pi pi-copy"
                text
                rounded
                size="small"
                severity="secondary"
                title="Copy"
                @click.stop="copyEnvironment(env)"
              />
              <Button
                icon="pi pi-trash"
                text
                rounded
                size="small"
                severity="danger"
                @click.stop="deleteEnvironment(env.id)"
              />
            </div>
          </div>
        </div>
      </div>
      
      <!-- Add/Edit View -->
      <div v-else class="flex flex-col gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Environment Name</label>
          <InputText 
            v-model="editingEnv.name"
            placeholder="Enter environment name"
            class="w-full"
          />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-3">Variables</label>
          
          <!-- Table Header -->
          <div class="flex gap-2 mb-2 text-sm font-bold text-surface-700 dark:text-surface-300 px-2 pr-3">
            <div class="flex-1">VARIABLE</div>
            <div class="flex-1">VALUE</div>
            <div style="width: 40px;"></div>
          </div>
          
          <!-- Table Rows -->
          <div class="space-y-2 max-h-[60vh] overflow-y-auto pr-3">
            <div 
              v-for="(variable, index) in editingEnv.variables"
              :key="index"
              class="flex gap-2 items-center"
              @mouseenter="hoveredVariableIndex = index"
              @mouseleave="hoveredVariableIndex = -1"
            >
              <div class="flex-1">
                <InputText
                  v-model="variable.key"
                  placeholder="Variable"
                  class="w-full py-3"
                  @input="onVariableChange"
                />
              </div>
              <div class="flex-1">
                <InputText
                  v-model="variable.value"
                  placeholder="Value"
                  class="w-full py-3"
                  @input="onVariableChange"
                />
              </div>
              <div class="flex justify-center" style="width: 40px;">
                <Button 
                  v-if="(hoveredVariableIndex === index || variable.key || variable.value) && editingEnv.variables.length > 1"
                  icon="pi pi-times"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  @click="deleteVariable(index)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <div v-if="envDialogMode === 'list'">
          <Button label="Close" @click="showEnvDialog = false" />
        </div>
        <div v-else class="flex gap-2">
          <Button label="Cancel" severity="secondary" @click="cancelEnvEdit" />
          <Button 
            label="Save"
            @click="saveEnvironment"
            :disabled="!editingEnv.name.trim()"
          />
        </div>
      </template>
    </Dialog>

    <!-- Export format selection menu (single environment) -->
    <Menu ref="exportMenu" :model="exportMenuItems" :popup="true" />

    <!-- Sequence Management Dialog -->
    <Dialog 
      v-model:visible="showSequenceDialog"
      header="Manage Sequences"
      :modal="true"
      :style="{ width: '700px' }"
    >
      <div class="flex flex-col gap-4">
        <div v-if="sequencesStore.getAllSequences().length === 0" class="text-center py-8 text-surface-500 dark:text-surface-400 text-sm">
          No sequences created yet. Sequences will be created automatically when you use {{$sequence}} in your requests.
        </div>
        
        <div v-else class="space-y-2">
          <div 
            v-for="sequence in sequencesStore.getAllSequences()"
            :key="sequence.name"
            class="p-4 border border-surface-200 dark:border-surface-700 rounded hover:bg-surface-50 dark:hover:bg-surface-900 transition"
          >
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-sm font-semibold text-surface-900 dark:text-surface-50">
                    {{ sequence.name }}
                  </span>
                  <span class="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                    Current: {{ sequence.padding > 0 ? sequence.currentValue.toString().padStart(sequence.padding, '0') : sequence.currentValue }}
                  </span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs text-surface-600 dark:text-surface-400">
                  <div>Start: {{ sequence.startValue }}</div>
                  <div>Step: {{ sequence.step }}</div>
                  <div>Padding: {{ sequence.padding || 'None' }}</div>
                </div>
              </div>
              <div class="flex gap-1">
                <Button 
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  @click="openEditSequence(sequence)"
                />
                <Button 
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  @click="deleteSequence(sequence.name)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <Button label="Close" @click="showSequenceDialog = false" />
      </template>
    </Dialog>
    
    <!-- Sequence Edit Dialog -->
    <Dialog 
      v-model:visible="showSequenceEditDialog"
      header="Edit Sequence"
      :modal="true"
      :style="{ width: '400px' }"
    >
      <div v-if="editingSequence" class="flex flex-col gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Sequence Name</label>
          <InputText 
            :modelValue="editingSequence.name"
            disabled
            class="w-full"
          />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-2">Current Value</label>
          <InputNumber 
            v-model="editingSequence.currentValue"
            class="w-full"
            :min="0"
          />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-2">Step (Increment)</label>
          <InputNumber 
            v-model="editingSequence.step"
            class="w-full"
            :min="1"
          />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-2">Padding (Zero Fill)</label>
          <InputNumber 
            v-model="editingSequence.padding"
            class="w-full"
            :min="0"
            :max="10"
          />
          <small class="text-surface-500 dark:text-surface-400">
            Number of digits (0 = no padding)
          </small>
        </div>
      </div>
      
      <template #footer>
        <div class="flex gap-2">
          <Button label="Cancel" severity="secondary" @click="showSequenceEditDialog = false" />
          <Button label="Save" @click="saveSequence" />
        </div>
      </template>
    </Dialog>
    
    <!-- Variables View Dialog -->
    <Dialog 
      v-model:visible="showVariablesViewDialog"
      header="Current Request Variables"
      :modal="true"
      :style="{ width: '800px' }"
    >
      <div class="flex flex-col gap-6">
        <!-- Environment Variables -->
        <div>
          <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
            <i class="pi pi-database text-primary"></i>
            <span class="font-semibold text-surface-900 dark:text-surface-50">
              Environment Variables
            </span>
            <span v-if="currentEnvironment" class="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
              {{ environments.find(e => e.id === currentEnvironment)?.name }}
            </span>
          </div>
          
          <div v-if="currentRequestVariables.environment.length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
            No environment selected or no variables defined
          </div>
          
          <div v-else class="space-y-2">
            <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
              <div class="flex-1">Variable Name</div>
              <div class="flex-1">Value</div>
            </div>
            <div
              v-for="(variable, index) in currentRequestVariables.environment"
              :key="index"
              class="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-800 rounded"
            >
              <div class="flex-1">
                <div class="text-sm font-mono text-primary">{{ variable.key }}</div>
              </div>
              <div class="flex-1">
                <div class="text-sm text-surface-700 dark:text-surface-300 break-all">{{ variable.value }}</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Global Variables -->
        <div>
          <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
            <i class="pi pi-code text-green-600"></i>
            <span class="font-semibold text-surface-900 dark:text-surface-50">
              Global Variables
            </span>
          </div>
          
          <div v-if="environmentsStore.globalVariables.filter(v => v.enabled !== false).length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
            No global variables set
          </div>

          <div v-else class="space-y-2">
            <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
              <div class="flex-1">Variable Name</div>
              <div class="flex-1">Value</div>
              <div class="flex-1">Description</div>
              <div class="w-16"></div>
            </div>
            <div
              v-for="(variable, index) in environmentsStore.globalVariables.filter(v => v.enabled !== false)"
              :key="index"
              class="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded group"
            >
              <div class="flex-1">
                <div class="text-sm font-mono text-green-700 dark:text-green-400">{{ variable.key }}</div>
              </div>
              <div class="flex-1">
                <div class="text-sm text-surface-700 dark:text-surface-300 break-all">{{ variable.value }}</div>
              </div>
              <div class="flex-1">
                <div class="text-sm text-surface-500 dark:text-surface-400 break-all">{{ variable.description || '' }}</div>
              </div>
              <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  title="Edit"
                  @click="editGlobalVariable(variable)"
                />
                <Button 
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  title="Delete"
                  @click="deleteGlobalVariable(variable.key)"
                />
              </div>
            </div>
          </div>
        </div>
        
        <!-- Sequence Variables -->
        <div>
          <div class="flex items-center gap-2 mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
            <i class="pi pi-sort-numeric-up text-orange-600"></i>
            <span class="font-semibold text-surface-900 dark:text-surface-50">
              Sequence Variables
            </span>
          </div>
          
          <div v-if="currentRequestVariables.sequences.length === 0" class="text-sm text-surface-500 dark:text-surface-400 italic py-4">
            No sequences used in current request
          </div>
          
          <div v-else class="space-y-2">
            <div class="flex items-center gap-3 px-3 text-xs font-semibold text-surface-500 dark:text-surface-400">
              <div class="flex-1">Variable Name</div>
              <div class="flex-1">Current Value</div>
              <div class="w-8"></div>
            </div>
            <div
              v-for="(sequence, index) in currentRequestVariables.sequences"
              :key="index"
              class="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded group"
            >
              <div class="flex-1">
                <div class="text-sm font-mono text-orange-700 dark:text-orange-400">
                  $sequence(name={{ sequence.name }})
                </div>
              </div>
              <div class="flex-1">
                <div v-if="sequence.initialized" class="text-sm text-surface-700 dark:text-surface-300">
                  Current: <span class="font-semibold">{{ sequence.displayValue }}</span>
                  <span class="text-xs text-surface-500 dark:text-surface-400 ml-2">
                    (step: {{ sequence.step }})
                  </span>
                </div>
                <div v-else class="text-sm text-surface-500 dark:text-surface-400 italic">
                  Not initialized yet
                  <span class="text-xs ml-2">(will start at {{ sequence.startValue }})</span>
                </div>
              </div>
              <div>
                <Button 
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  class="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit Sequence"
                  @click="editSequenceFromView(sequence.name)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <template #footer>
        <Button label="Close" @click="showVariablesViewDialog = false" />
      </template>
    </Dialog>
    
    <!-- Edit Global Variable Dialog -->
    <Dialog 
      v-model:visible="showEditGlobalVarDialog"
      header="Edit Global Variable"
      :modal="true"
      :style="{ width: '400px' }"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="block text-sm font-medium mb-2">Variable Name</label>
          <InputText 
            v-model="editingGlobalVar.key"
            placeholder="Variable name"
            class="w-full"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Value</label>
          <InputText
            v-model="editingGlobalVar.value"
            placeholder="Value"
            class="w-full"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-2">Description</label>
          <InputText
            v-model="editingGlobalVar.description"
            placeholder="Description (optional)"
            class="w-full"
          />
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showEditGlobalVarDialog = false" />
        <Button
          label="Save"
          @click="saveEditGlobalVariable"
          :disabled="!editingGlobalVar.key.trim()"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.environment-manager {
  display: flex;
  align-items: center;
}
</style>
