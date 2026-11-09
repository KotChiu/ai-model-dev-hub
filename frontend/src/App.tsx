import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, Beaker, BookOpen, Check, CheckCircle2,
  ChevronDown, CircleAlert, ClipboardList, Code2, Copy, Database, Download,
  FileCheck2, FileText, FlaskConical, GitBranch, Layers3, Link2, Play,
  Plus, RefreshCw, ShieldCheck, Sparkles, Terminal, WandSparkles
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type LabelKey = 'fpd7' | 'fpd30' | 'tpd30' | 'c_m1' | 'c_d30'
type FeatureRow = { sample_id:string; features: Record<string,string|number> }
type LabelRow = { sample_id:string; labels: Record<LabelKey,number> }
type Dialogue = { sample_id:string; messages:{role:string;content:string}[] }
type TrainHistory = { epoch:number; simulated_loss:number; simulated_reward:number }
type Training = {
  mode:string; checkpoint:string; candidate_id:string; val_fpd30_auc:number|null; real_model_trained:boolean;
  config:{epochs:number;learning_rate:number;reward_weight:number;reward_version:string}
  history:TrainHistory[];note:string
}
type Report = {
  title:string;status:string;model_trained:boolean;generated_at:string;run_id:string;
  dataset:{total:number;train:number;val:number;test:number;split_seed:number;test_set_locked:boolean};
  metrics:{label:string;positives:number;positive_rate:number;auc:number|null}[];
  checks:{name:string;passed:boolean;reason?:string}[];
  badcases:{sample_id:string;issue:string;label:string;actual:number;risk_score:number}[];
  summary:string;
}
type Run = {
  id:string;name:string;stage:string;created_at:string;updated_at:string;
  source:{project:string;table:string;partition:string;sql:string;sample_size:number;seed:number};
  row_count:number;raw_preview:FeatureRow[];label_preview:LabelRow[];label_fields:LabelKey[];
  query_preview:Dialogue[];query_count:number;
  split:{train?:number;val?:number;test?:number};split_seed?:number;
  training?:Training;candidates?:Training[];report?:Report;adapter:string;sql_executed:boolean
}
type Source = {
  project:string;mode:string;label_api:string;label_fields:LabelKey[];
  tables:{name:string;description:string;partitions:string[];fields:string[]}[]
}
type RunListItem = {id:string;name:string;stage:string;updated_at:string}
const STAGES = [
  {title:'ODPS 数据采样',subtitle:'选表 · 选分区 · 编写 SQL', icon:Database},
  {title:'获取特征与 Y 标',subtitle:'Mock 标签接口 · 关联样本',icon:Link2},
  {title:'生成对话数据',subtitle:'仅包含 user/query，不含 answer',icon:Code2},
  {title:'划分数据集',subtitle:'Train / Val / Test',icon:GitBranch},
  {title:'训练与调优',subtitle:'调整超参与 Reward',icon:FlaskConical},
  {title:'测试报告',subtitle:'指标 · Badcase · 可追溯性',icon:FileCheck2}
]
const LABELS:LabelKey[]=['fpd7','fpd30','tpd30','c_m1','c_d30']
const stageIndex:Record<string,number>={sampled:1,labeled:2,dialogues:3,split:4,trained:5,reported:5}
function fmt(n:number|undefined|null,precision=2):string{return n===undefined||n===null?'—':n.toFixed(precision)}
function sqlFor(table:string,partition:string,size:number):string{return [
  'SELECT',
  '    user_id, risk_grade, business_months,',
  '    monthly_sales, debt_ratio, overdue_cnt_12m,',
  '    total_credit_amt',
  'FROM demo_credit_research.'+table,
  "WHERE ds = '"+partition+"'",
  'ORDER BY RAND()',
  'LIMIT '+size
].join('\n')}
async function api<T>(path:string, init?:RequestInit):Promise<T>{
 const response=await fetch('/api/workflow'+path,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})}})
 if(!response.ok){let msg='API 请求失败';try{const data=await response.json();msg=typeof data.detail==='string'?data.detail:JSON.stringify(data.detail)}catch{/* plain text */}throw new Error(msg)}
 return response.json() as Promise<T>
}
function IconBox({children,tone='blue'}:{children:ReactNode;tone?:'blue'|'green'|'purple'|'amber'}){return <div className={'icon-box '+tone}>{children}</div>}
function Section({kicker,title,description,aside}:{kicker:string;title:string;description:string;aside?:ReactNode}){
 return <div className="section-title"><div><div className="section-kicker">{kicker}</div><h2>{title}</h2><p>{description}</p></div>{aside}</div>
}
function TableWrap({children}:{children:ReactNode}){return <div className="table-wrap"><table>{children}</table></div>}
function Status({done,text}:{done:boolean;text:string}){return <span className={'status '+(done?'status-ok':'status-pending')}>{done?<CheckCircle2 size={13}/>:<CircleAlert size={13}/>} {text}</span>}
function Kpi({label,value,small}:{label:string;value:string;small?:string}){return <div className="kpi"><span>{label}</span><strong>{value}</strong>{small&&<small>{small}</small>}</div>}
function Tag({children}:{children:ReactNode}){return <span className="tag">{children}</span>}

export default function App(){
 const [sources,setSources]=useState<Source|null>(null)
 const [history,setHistory]=useState<RunListItem[]>([])
 const [run,setRun]=useState<Run|null>(null)
 const [step,setStep]=useState(0)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [name,setName]=useState('授信 RL — 2026Q4 研发实验')
 const [table,setTable]=useState('demo_credit_feature_di')
 const [partition,setPartition]=useState('20261031')
 const [sampleSize,setSampleSize]=useState(240)
 const [seed,setSeed]=useState(42)
 const [sql,setSql]=useState(sqlFor('demo_credit_feature_di','20261031',240))
 const [valRatio,setValRatio]=useState(.1)
 const [testRatio,setTestRatio]=useState(.2)
 const [splitSeed,setSplitSeed]=useState(42)
 const [epochs,setEpochs]=useState(4)
 const [rewardWeight,setRewardWeight]=useState(.6)
 const [rewardVersion,setRewardVersion]=useState('risk-aware-v1')
 const [lr,setLr]=useState(.000001)
 const [showHistory,setShowHistory]=useState(false)
 const [queryMode,setQueryMode]=useState<'natural'|'json'>('natural')
 useEffect(()=>{
  Promise.all([api<Source>('/sources'),api<RunListItem[]>('/runs')])
   .then(([s,r])=>{setSources(s);setHistory(r)})
   .catch(err=>setError(String(err)))
   .finally(()=>setLoading(false))
 },[])
 async function syncRun(updated:Run,nextStep?:number){
   setRun(updated)
   setStep(nextStep===undefined?(stageIndex[updated.stage]??0):nextStep)
   setHistory(await api<RunListItem[]>('/runs'))
 }
 async function perform(action:()=>Promise<Run>, nextStep:number){
  setBusy(true);setError('')
  try{await syncRun(await action(),nextStep)}
  catch(err){setError(err instanceof Error?err.message:String(err))}
  finally{setBusy(false)}
 }
 const maxStep=run?(stageIndex[run.stage]??0):0
 function changeTable(t:string){
   const p=sources?.tables.find(x=>x.name===t)?.partitions[0]||partition
   setTable(t);setPartition(p);setSql(sqlFor(t,p,sampleSize))
 }
 function changePartition(p:string){setPartition(p);setSql(sqlFor(table,p,sampleSize))}
 function changeSize(n:number){setSampleSize(n);setSql(sqlFor(table,partition,n))}
 function newRun(){
   setRun(null);setStep(0);setShowHistory(false);setError('')
 }
 async function openRun(id:string){
  setBusy(true);setError('')
  try{const result=await api<Run>('/runs/'+encodeURIComponent(id));setRun(result);setStep(stageIndex[result.stage]??0);setShowHistory(false)}
  catch(err){setError(String(err))}finally{setBusy(false)}
 }
 function submitSample(e:FormEvent<HTMLFormElement>){
  e.preventDefault();void perform(()=>api<Run>('/runs',{method:'POST',body:JSON.stringify({name,table,partition,sql,sample_size:sampleSize,seed})}),1)
 }
 function postStage(path:string,nextStep:number,body?:unknown){
  if(!run)return
  void perform(()=>api<Run>('/runs/'+encodeURIComponent(run.id)+path,{
   method:'POST',...(body===undefined?{}:{body:JSON.stringify(body)})
  }),nextStep)
 }
 function downloadReport(){
  if(!run?.report)return
  const blob=new Blob([JSON.stringify(run.report,null,2)],{type:'application/json;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a');anchor.href=url;anchor.download=run.id+'-test-report.json';anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 const labelAttached=run&&maxStep>=2
 const queryReady=run&&maxStep>=3
 const splitReady=run&&maxStep>=4
 return <div className="layout">
  <aside className="sidebar">
   <div className="brand"><div className="brand-icon"><Layers3 size={23}/></div><div><strong>MODEL LAB</strong><small>AI Coding Workspace</small></div></div>
   <div className="project-row"><div className="project-icon"><Beaker size={17}/></div><div><strong>Credit RL Research</strong><small>授信模型研发</small></div><ChevronDown size={15}/></div>
   <div className="sidebar-label">DEVELOPMENT WORKFLOW</div>
   <nav className="step-nav">
    {STAGES.map((s,i)=>{const Icon=s.icon;const complete=run?i<maxStep:false;const available=i<=maxStep
      return <button key={s.title} className={'step-nav-item '+(step===i?'active ':'')+(complete?'complete ':'')} disabled={!available} onClick={()=>setStep(i)}>
        <span className="step-index">{complete?<Check size={14}/>:String(i+1).padStart(2,'0')}</span>
        <span><strong>{s.title}</strong><small>{s.subtitle}</small></span><Icon className="step-nav-icon" size={15}/>
       </button>})}
   </nav>
   <div className="sidebar-bottom">
    <button className="history-toggle" onClick={()=>setShowHistory(!showHistory)}><ClipboardList size={16}/> 历史研发记录 <ChevronDown size={15}/></button>
    {showHistory&&<div className="history-list">{history.length===0?<small>暂无历史实验</small>:history.map(h=><button key={h.id} onClick={()=>void openRun(h.id)}><strong>{h.name}</strong><small>{h.id} · {h.stage}</small></button>)}</div>}
    <div className="sidebar-tip"><Sparkles size={18}/><strong>Agent-ready workflow</strong><p>每一步都可沉淀 Contract、Skill、Recipe 和运行产物。</p></div>
    <div className="side-foot"><span className="green-dot"/> Mock workspace <span>v0.2</span></div>
   </div>
  </aside>
  <main className="workspace-main">
   <header className="topbar"><div className="crumb">AI WORKSPACE <span>/</span> CREDIT RL <span>/</span> <strong>研发流水线</strong></div><div className="top-right"><span className="mock-pill"><span className="green-dot"/> SYNTHETIC DEMO</span><button className="text-button" onClick={newRun}><Plus size={15}/> 新实验</button><div className="avatar">ML</div></div></header>
   <div className="page">
    <div className="page-intro"><div><div className="eyebrow"><span/> END-TO-END MODEL DEVELOPMENT</div><h1>从数据采样到测试报告</h1><p>跟随你的真实研发顺序，把一次模型实验变成可复现的完整流程。</p></div><div className="run-meta"><span>当前流程</span><strong>{run?run.id:'尚未创建'}</strong><small>{run?run.name:'完成第一步创建实验'}</small></div></div>
    <div className="progress-wrap"><div className="progress-header"><span>研发进度</span><strong>{run?Math.round(maxStep/5*100):0}%</strong></div><div className="progress-bar"><div style={{width:(run?maxStep/5*100:0)+'%'}}/></div><div className="milestones"><span>数据准备</span><span>训练准备</span><span>模型评估</span></div></div>
    {error&&<div className="error-box"><CircleAlert size={17}/><span>{error}</span><button onClick={()=>setError('')}>×</button></div>}
    {loading?<div className="card skeleton">正在连接演示服务…</div>:
    <div className="content-grid">
     <div className="main-col">
      {step===0&&<section className="card step-card"><Section kicker="STEP 01 · DATA ACQUISITION" title="从 ODPS 采样原始特征" description="选定表、分区，编写采样 SQL，形成有版本的原始数据快照。" aside={<IconBox><Database size={22}/></IconBox>}/>
       <form onSubmit={submitSample} className="form-stack">
        <div className="form-grid"><label className="field"><span>ODPS Project</span><div className="readonly-field"><Database size={15}/>{sources?.project||'demo_credit_research'}</div></label><label className="field"><span>研发实验名称</span><input value={name} onChange={e=>setName(e.target.value)} required minLength={3}/></label></div>
        <div className="form-grid"><label className="field"><span>选择数据表</span><select value={table} onChange={e=>changeTable(e.target.value)}>{sources?.tables.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}</select><small>{sources?.tables.find(t=>t.name===table)?.description}</small></label><label className="field"><span>分区 ds</span><select value={partition} onChange={e=>changePartition(e.target.value)}>{sources?.tables.find(t=>t.name===table)?.partitions.map(p=><option key={p}>{p}</option>)}</select><small>分区值参与实验血缘记录</small></label></div>
        <div className="form-grid"><label className="field"><span>采样量（行）</span><input type="number" min={50} max={500} value={sampleSize} onChange={e=>changeSize(Number(e.target.value))}/></label><label className="field"><span>随机种子</span><input type="number" min={0} max={1000000} value={seed} onChange={e=>setSeed(Number(e.target.value))}/></label></div>
        <div className="sql-header"><div><Terminal size={16}/><strong>ODPS SQL 编辑器</strong><Tag>只读执行模拟</Tag></div><button type="button" className="small-action" onClick={()=>{void navigator.clipboard?.writeText(sql)}}><Copy size={14}/> 复制 SQL</button></div>
        <div className="sql-editor"><div className="line-num">{sql.split('\n').map((_,i)=><span key={i}>{i+1}</span>)}</div><textarea spellCheck={false} value={sql} onChange={e=>setSql(e.target.value)} aria-label="ODPS SQL"/></div>
        <div className="notice"><CircleAlert size={16}/> Demo 只验证 SQL 形式并保存文本，不执行真实 ODPS 查询；模拟生成 {sampleSize||'—'} 条特征记录。</div>
        <div className="action-row"><span className="action-hint">产物：SQL 配置 + 原始特征数据快照</span><button type="submit" disabled={busy||!sources} className="primary">{busy?'正在生成…':'运行采样（模拟）'} <ArrowRight size={17}/></button></div>
       </form>
      </section>}
      {step===1&&run&&<section className="card step-card"><Section kicker="STEP 02 · LABEL ENRICHMENT" title="获取原始特征和 Y 标" description="按样本 ID 调用标签接口，把特征和风险结果关联；标签单独保存，不进入 query。" aside={<IconBox tone="purple"><Link2 size={22}/></IconBox>}/>
       <div className="flow-horizontal"><div><Database size={19}/><strong>ODPS 原始特征</strong><small>{run.source.table}</small></div><ArrowRight size={21}/><div><Activity size={19}/><strong>Y 标签服务</strong><small>{sources?.label_api}</small></div><ArrowRight size={21}/><div><Layers3 size={19}/><strong>关联样本</strong><small>sample_id JOIN</small></div></div>
       <div className="mini-heading"><h3>采样结果预览</h3><span>{run.row_count} 条 · {run.source.partition}</span></div>
       <TableWrap><thead><tr><th>样本 ID</th><th>评级</th><th>经营月数</th><th>销售额(万)</th><th>负债率</th><th>逾期次数</th><th>授信(万)</th></tr></thead><tbody>{run.raw_preview.map(x=><tr key={x.sample_id}><td className="mono">{x.sample_id}</td><td>{x.features.risk_grade}</td><td>{x.features.business_months}</td><td>{x.features.monthly_sales}</td><td>{fmt(Number(x.features.debt_ratio)*100,1)}%</td><td>{x.features.overdue_cnt_12m}</td><td>{x.features.total_credit_amt}</td></tr>)}</tbody></TableWrap>
       <div className="mini-heading top-space"><h3>Y 标签字段</h3><span>返回值为模拟二分类标签</span></div>
       <div className="label-chips">{LABELS.map(l=><span key={l}>{l}</span>)}</div>
       {labelAttached&&<><div className="success-box"><CheckCircle2 size={16}/> 已完成样本标签关联，以下是标签侧预览（不属于模型 query）</div><TableWrap><thead><tr><th>样本 ID</th>{LABELS.map(l=><th key={l}>{l}</th>)}</tr></thead><tbody>{run.label_preview.slice(0,4).map(x=><tr key={x.sample_id}><td className="mono">{x.sample_id}</td>{LABELS.map(l=><td key={l}><span className={x.labels[l]?'value-positive':'value-zero'}>{x.labels[l]}</span></td>)}</tr>)}</tbody></TableWrap></>}
       <div className="action-row"><span className="action-hint">Y 标签可用于评估，但不能泄漏进输入</span>{!labelAttached?<button disabled={busy} className="primary" onClick={()=>postStage('/labels',2)}>{busy?'关联中…':'模拟调用接口并关联'} <ArrowRight size={17}/></button>:<button className="primary" onClick={()=>setStep(2)}>下一步：生成对话 <ArrowRight size={17}/></button>}</div>
      </section>}
      {step===2&&run&&<section className="card step-card"><Section kicker="STEP 03 · DIALOGUE CONSTRUCTION" title="把原始特征加工成 Query" description="生成模型可以消费的对话输入。只生成 user 消息，不创建 assistant answer。" aside={<IconBox tone="purple"><WandSparkles size={22}/></IconBox>}/>
       <div className="rule-grid"><div><span className="rule-index">01</span><strong>字段格式化</strong><small>评级、负债率、经营数据标准化</small></div><div><span className="rule-index">02</span><strong>业务提示词模板</strong><small>授信动作 + 建议额度 + 依据</small></div><div><span className="rule-index">03</span><strong>标签隔离</strong><small>Y 标放在单独的评估侧数据</small></div></div>
       {queryReady&&run.query_preview.length>0?<><div className="mini-heading"><h3>生成的 Query 预览</h3><div className="toggle-group"><button className={queryMode==='natural'?'selected':''} onClick={()=>setQueryMode('natural')}>自然语言</button><button className={queryMode==='json'?'selected':''} onClick={()=>setQueryMode('json')}>JSONL</button></div></div>
        <div className="query-preview"><div className="query-top"><span><span className="user-icon">U</span> USER MESSAGE</span><Tag>{run.query_preview[0].sample_id}</Tag></div><pre>{queryMode==='natural'?run.query_preview[0].messages[0].content:JSON.stringify(run.query_preview[0],null,2)}</pre></div>
        <div className="separation"><ShieldCheck size={17}/><div><strong>隔离检查</strong><span>消息数组只有 user role；没有 answer、assistant 或 FPD/TPD/C 标签字段。</span></div><Status done text="PASS"/></div>
        <div className="subtle-box"><strong>实际对话数据结构</strong><code>{'{"sample_id":"...","messages":[{"role":"user","content":"..."}]}'}</code><p>共 {run.query_count} 条 query，标签在独立 sidecar 中保存。</p></div></>
       :<div className="subtle-box"><strong>待执行转换</strong><p>把 {run.row_count} 条特征数据映射进统一提示词；不生成任何目标 answer，也不将标签字段带入 prompt。</p><pre className="code-soft">{'{"messages":[{"role":"user","content":"客户风险评级：..."}]}'}</pre></div>}
       <div className="action-row"><span className="action-hint">产物：query-only 对话记录 + 标签 sidecar</span>{!queryReady?<button disabled={busy} className="primary" onClick={()=>postStage('/dialogues',3)}>{busy?'构造中…':'生成 Query 对话数据'} <ArrowRight size={17}/></button>:<button className="primary" onClick={()=>setStep(3)}>下一步：数据划分 <ArrowRight size={17}/></button>}</div>
      </section>}
      {step===3&&run&&<section className="card step-card"><Section kicker="STEP 04 · DATASET SPLIT" title="划分训练、验证与测试集" description="训练集用于学习，Val 用于迭代调参，独立 Test 锁定用于最后出报告。" aside={<IconBox tone="green"><GitBranch size={22}/></IconBox>}/>
       <div className="split-visual"><div style={{width:(1-valRatio-testRatio)*100+'%'}} className="train-seg">TRAIN</div><div style={{width:valRatio*100+'%'}} className="val-seg">VAL</div><div style={{width:testRatio*100+'%'}} className="test-seg">TEST</div></div>
       <div className="split-cards"><Kpi label="Train 训练集" value={splitReady?String(run.split.train):String(Math.round(run.row_count*(1-valRatio-testRatio)))} small="用于模拟训练过程"/><Kpi label="Val 验证集" value={splitReady?String(run.split.val):String(Math.round(run.row_count*valRatio))} small="允许实验选择"/><Kpi label="Test 冻结测试集" value={splitReady?String(run.split.test):String(Math.round(run.row_count*testRatio))} small="报告阶段才使用"/></div>
       <div className="form-grid top-space"><label className="field"><span>Test 比例</span><select disabled={!!splitReady} value={testRatio} onChange={e=>setTestRatio(Number(e.target.value))}><option value=".15">15%</option><option value=".2">20%</option><option value=".25">25%</option><option value=".3">30%</option></select></label><label className="field"><span>Val 比例</span><select disabled={!!splitReady} value={valRatio} onChange={e=>setValRatio(Number(e.target.value))}><option value=".05">5%</option><option value=".1">10%</option><option value=".15">15%</option><option value=".2">20%</option></select></label></div>
       <label className="field top-space"><span>划分随机种子</span><input type="number" value={splitReady?run.split_seed||splitSeed:splitSeed} disabled={!!splitReady} min={0} max={1000000} onChange={e=>setSplitSeed(Number(e.target.value))}/></label>
       <div className="separation"><ShieldCheck size={17}/><div><strong>数据隔离原则</strong><span>三份样本 ID 互斥；Test 不能反复用来选择超参。</span></div><Status done={!!splitReady} text={splitReady?'已冻结':'待切分'}/></div>
       <div className="action-row"><span className="action-hint">产物：train/val/test 样本清单与 seed</span>{!splitReady?<button disabled={busy} className="primary" onClick={()=>postStage('/split',4,{test_ratio:testRatio,val_ratio:valRatio,seed:splitSeed})}>{busy?'划分中…':'确定数据集划分'} <ArrowRight size={17}/></button>:<button className="primary" onClick={()=>setStep(4)}>下一步：训练调优 <ArrowRight size={17}/></button>}</div>
      </section>}
      {step===4&&run&&<section className="card step-card"><Section kicker="STEP 05 · TRAINING & TUNING" title="配置训练与 Reward 调优" description="在相同的数据切分上调整超参，生成多个候选，用 Val 选择候选，再进入锁定 Test。" aside={<IconBox tone="amber"><FlaskConical size={22}/></IconBox>}/>
       <div className="notice training-warning"><CircleAlert size={16}/> 这里是模拟训练：不启动 GPU / RL rollout，不更新模型参数；Val AUC 由手写评分函数计算。</div>
       <div className="form-grid top-space"><label className="field"><span>训练方法</span><div className="readonly-field"><Sparkles size={16}/> GRPO / RL（模拟）</div></label><label className="field"><span>Reward 版本</span><input value={rewardVersion} onChange={e=>setRewardVersion(e.target.value)}/></label></div>
       <div className="form-grid"><label className="field"><span>Learning Rate</span><input type="number" min={0.00000001} max={0.01} step="any" value={lr} onChange={e=>setLr(Number(e.target.value))}/></label><label className="field"><span>Epochs</span><select value={epochs} onChange={e=>setEpochs(Number(e.target.value))}>{[2,3,4,5,6,8,10].map(x=><option key={x} value={x}>{x} epochs</option>)}</select></label></div>
       <label className="field top-space"><span>风险约束 Reward 权重 <strong className="field-value">{fmt(rewardWeight,2)}</strong></span><input className="range" type="range" min="0" max="1" step=".05" value={rewardWeight} onChange={e=>setRewardWeight(Number(e.target.value))}/><div className="range-labels"><span>更偏业务收益</span><span>更偏风险控制</span></div></label>
       {run.training?<><div className="success-box"><CheckCircle2 size={17}/> 已完成 {run.candidates?.length||1} 轮模拟调优；仅通过 Val 的 fpd30 AUC 选择当前候选。</div>
        <div className="mini-heading"><h3>候选实验对比 · Val</h3><Tag>选择：{run.training.candidate_id}</Tag></div>
        <TableWrap><thead><tr><th>候选</th><th>Reward 版本</th><th>权重</th><th>Epochs</th><th>Val FPD30 AUC</th><th>选择</th></tr></thead><tbody>{run.candidates?.map(c=><tr key={c.candidate_id}><td className="mono">{c.candidate_id}</td><td>{c.config.reward_version}</td><td>{fmt(c.config.reward_weight,2)}</td><td>{c.config.epochs}</td><td>{fmt(c.val_fpd30_auc,4)}</td><td>{c.candidate_id===run.training?.candidate_id?<Status done text="最佳候选"/>:'—'}</td></tr>)}</tbody></TableWrap>
        <div className="mini-heading top-space"><h3>当前选中候选的模拟训练趋势</h3><Tag>{run.training.checkpoint}</Tag></div>
        <div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={run.training.history}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9edf5"/><XAxis dataKey="epoch" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false}/><Tooltip/><Line dataKey="simulated_loss" name="模拟 Loss" stroke="#5678df" strokeWidth={3} dot/><Line dataKey="simulated_reward" name="模拟 Reward" stroke="#42ae8e" strokeWidth={3} dot/></LineChart></ResponsiveContainer></div></>
       :<div className="subtle-box"><strong>训练输入</strong><p>{run.split.train??0} 条 Query-only 训练样本，{run.split.val??0} 条 Val 样本。真实 RL 需要模型 rollout 和 Reward；这里模拟训练曲线并根据 Val 比较候选。</p></div>}
       <div className="action-row tuning-actions"><span className="action-hint">使用 Val 选择候选，不在调参阶段访问 Test</span><div className="action-buttons">{run.training&&<button className="ghost" onClick={()=>setStep(5)}>进入最终 Test <ArrowRight size={16}/></button>}<button disabled={busy||(run.candidates?.length||0)>=6} className="primary" onClick={()=>postStage('/train',4,{epochs,learning_rate:lr,reward_weight:rewardWeight,reward_version:rewardVersion})}>{busy?'模拟训练中…':run.training?'再训练一个候选':'开始模拟训练'} <Play size={17}/></button></div></div>
      </section>}
      {step===5&&run&&<section className="card step-card report-card"><Section kicker="STEP 06 · FINAL EVALUATION" title="生成模型测试报告" description="在冻结 Test 集上评估五项 Y 指标，汇总 Badcase 和数据隔离检查。" aside={<IconBox tone="green"><FileText size={22}/></IconBox>}/>
       {run.report?<><div className="report-banner"><div className="report-icon"><FileCheck2 size={23}/></div><div><span>报告已生成 · Synthetic Only</span><h3>{run.report.title}</h3><small>{run.id} · {new Date(run.report.generated_at).toLocaleString('zh-CN')}</small></div><span className="report-mark">DEMO</span></div>
       <div className="report-stat-grid"><Kpi label="Train 样本" value={String(run.report.dataset.train)}/><Kpi label="Val 样本" value={String(run.report.dataset.val)}/><Kpi label="Test 样本" value={String(run.report.dataset.test)}/><Kpi label="标签数" value={String(run.report.metrics.length)}/></div>
       <div className="mini-heading top-space"><h3>五类风险 Y 标评估</h3><span>Test · synthetic scorer · AUC 不代表真实模型</span></div>
       <TableWrap><thead><tr><th>Y 标</th><th>正样本数</th><th>正样本率</th><th>模拟评分 AUC</th></tr></thead><tbody>{run.report.metrics.map(m=><tr key={m.label}><td><strong className="metric-name">{m.label}</strong></td><td>{m.positives}</td><td>{fmt(m.positive_rate*100,2)}%</td><td>{m.auc===null?'无正负样本':fmt(m.auc,4)}</td></tr>)}</tbody></TableWrap>
       <div className="mini-heading top-space"><h3>质量检查</h3></div>
       <div className="checks">{run.report.checks.map(c=><div key={c.name}><Status done={c.passed} text={c.passed?'通过':'未完成'}/><span>{c.name}</span>{c.reason&&<small>{c.reason}</small>}</div>)}</div>
       <div className="mini-heading top-space"><h3>模拟 Badcase</h3><span>仅展示匿名合成样本</span></div>
       {run.report.badcases.length?<TableWrap><thead><tr><th>样本 ID</th><th>分类</th><th>标签</th><th>模拟风险评分</th></tr></thead><tbody>{run.report.badcases.map(b=><tr key={b.sample_id}><td className="mono">{b.sample_id}</td><td>{b.issue}</td><td>{b.label} = {b.actual}</td><td>{fmt(b.risk_score,4)}</td></tr>)}</tbody></TableWrap>:<div className="empty-small">本轮模拟未命中预设 Badcase 阈值</div>}
       <div className="notice"><ShieldCheck size={16}/> {run.report.summary}</div>
       <div className="action-row"><button className="ghost" onClick={newRun}><RefreshCw size={16}/> 新建下一轮实验</button><button className="primary" onClick={downloadReport}><Download size={16}/> 下载 JSON 测试报告</button></div></>
       :<><div className="report-pending"><IconBox tone="green"><ClipboardList size={24}/></IconBox><h3>训练配置已完成，准备运行 Test 评估</h3><p>将对 {run.split.test} 条锁定测试样本计算 fpd7、fpd30、tpd30、c_m1、c_d30 的样本统计和模拟评分 AUC，并生成可下载报告。</p><div className="report-guard"><ShieldCheck size={17}/> 模拟评分不是实际训练模型预测；报告不会给出真实业务准出结论。</div></div>
       <div className="action-row"><span className="action-hint">产物：完整测试报告 + Badcase 记录</span><button disabled={busy} className="primary" onClick={()=>postStage('/report',5)}>{busy?'计算中…':'生成测试报告'} <FileText size={16}/></button></div></>}
      </section>}
      <div className="bottom-nav"><button disabled={step===0} onClick={()=>setStep(Math.max(0,step-1))}><ArrowLeft size={16}/> 上一步</button><span>{step+1} / 6</span>{step<maxStep&&<button onClick={()=>setStep(step+1)}>下一阶段 <ArrowRight size={16}/></button>}</div>
     </div>
     <aside className="inspector">
      <div className="card insight-card"><div className="insight-header"><span><BookOpen size={16}/> 本阶段说明</span><Tag>STEP {String(step+1).padStart(2,'0')}</Tag></div><h3>{STAGES[step].title}</h3><p>{[
        '沉淀数据表、分区、SQL 文本、采样参数与原始快照。真正接入时需绑定 ODPS 权限与执行接口。',
        '从原始特征侧按样本 ID 关联 fpd7、fpd30、tpd30、c_m1、c_d30 的 Y 标；不要混入 Prompt。',
        '以统一模板构造 user/query 数据；训练答案和标签不在 messages 中，适合作为 RL rollout 提示词。',
        'Train/Val/Test 样本互斥；Val 用于选配置，Test 一旦冻结就不能用于反复调参。',
        '配置 Reward 和学习率；当前仅输出模拟训练轨迹，真实版需要训练平台执行。',
        '用锁定测试集形成指标、Badcase、数据血缘与报告；Demo 不满足真实模型准出条件。'
      ][step]}</p><div className="insight-divider"/><strong className="insight-label">本步骤要沉淀的资产</strong><div className="asset-tags">{[
        ['SQL Spec','Dataset Snapshot','Lineage'],
        ['Feature Schema','Label Contract','Joined Dataset'],
        ['Prompt Template','Query JSONL','Label Sidecar'],
        ['Split Manifest','Random Seed','Isolation Check'],
        ['Training Recipe','Reward Spec','Checkpoint Ref'],
        ['Metric Results','Badcase Set','Test Report']
      ][step].map(t=><span key={t}>{t}</span>)}</div></div>
      <div className="card lineage-summary"><div className="insight-header"><span><Layers3 size={16}/> 当前实验概览</span></div><dl><div><dt>实验 ID</dt><dd>{run?.id||'待创建'}</dd></div><div><dt>ODPS 分区</dt><dd>{run?.source.partition||partition}</dd></div><div><dt>原始样本</dt><dd>{run?.row_count??'—'}</dd></div><div><dt>对话数据</dt><dd>{run?.query_count??0}</dd></div><div><dt>数据状态</dt><dd>{run?.stage||'not started'}</dd></div></dl></div>
      <div className="small-note"><ShieldCheck size={17}/><p>演示环境只使用合成数据，所有真实 ODPS、Y 标服务、训练和推理接口均尚未连接。</p></div>
     </aside>
    </div>}
   </div>
  </main>
 </div>
}
