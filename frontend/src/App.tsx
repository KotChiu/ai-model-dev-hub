import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowDown, ArrowRight, Beaker, BookOpen, Boxes, BrainCircuit, CheckCircle2, ChevronDown, CircleAlert, ClipboardCheck, Code2, Database, GitBranch, Layers3, LayoutDashboard, Menu, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Experiment = { id: string; name: string; reward: string; lr: number; dataset: string; checkpoint: string; status: string; created_at: string; val_risk: number | null; test_risk: number | null; avg_credit: number | null; coverage: number | null; violations: number | null; gate: string; notes: string }
type Overview = { experiments: number; passed: number; failed: number; datasets: number; best_risk: number | null; recent: Experiment[]; pipeline: string[] }
type Contract = { id: string; name: string; version: string; kind: string; status: string; detail: string }
type Skill = { id: string; name: string; stage: string; summary: string }
type Knowledge = { id: string; title: string; category: string; source: string; detail: string }
type Badcase = { type: string; count: number; severity: string; note: string }
type Lineage = { nodes: { id: string; kind: string; label: string }[]; edges: string[][] }
type View = 'overview' | 'experiments' | 'contracts' | 'skills' | 'badcases' | 'lineage' | 'knowledge'
const labels: Record<View,string> = { overview:'总览工作台', experiments:'实验管理', contracts:'指标与契约', skills:'Skills 资产', badcases:'Badcase 分析', lineage:'模型血缘', knowledge:'经验知识库' }
const menu: {id:View; icon:typeof Activity}[] = [{id:'overview',icon:LayoutDashboard},{id:'experiments',icon:Beaker},{id:'contracts',icon:ShieldCheck},{id:'skills',icon:Boxes},{id:'badcases',icon:ClipboardCheck},{id:'lineage',icon:GitBranch},{id:'knowledge',icon:BookOpen}]
async function request<T>(path:string, options?:RequestInit): Promise<T> {
  const response = await fetch('/api'+path, { ...options, headers: {'Content-Type':'application/json',...(options?.headers||{})} })
  if (!response.ok) throw new Error((await response.text()) || '请求失败')
  return response.json() as Promise<T>
}
function Badge({value}:{value:string}) {
  const good = ['PASS','completed','frozen','active'].includes(value)
  const bad = ['FAIL'].includes(value)
  return <span className={'badge '+(good?'good':bad?'bad':'neutral')}><span className="badge-dot"/>{value}</span>
}
function Stat({icon:Icon,label,value,sub}:{icon:typeof Activity;label:string;value:string;sub:string}) {return <div className="stat card"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={18}/></span></div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div>}
function SectionTitle({title,desc,extra}:{title:string;desc?:string;extra?:ReactNode}) {return <div className="section-head"><div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{extra}</div>}
function ExperimentTable({rows,choose}:{rows:Experiment[];choose:(id:string)=>void}) {
  return <div className="table-scroll"><table><thead><tr><th>实验 / 模型</th><th>Reward</th><th>Val 风险</th><th>Test 风险</th><th>授信均额</th><th>准出</th><th></th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.id}><td><button className="table-link" onClick={()=>choose(r.id)}><strong>{r.name}</strong><small>{r.id} · {r.dataset}</small></button></td><td><code>{r.reward}</code></td><td>{r.val_risk == null?'—':r.val_risk.toFixed(2)+'%'}</td><td>{r.test_risk == null?'—':r.test_risk.toFixed(2)+'%'}</td><td>{r.avg_credit == null?'—':r.avg_credit.toFixed(1)+'万'}</td><td><Badge value={r.gate}/></td><td><button className="icon-button" title="查看血缘" onClick={()=>choose(r.id)}><ArrowRight size={16}/></button></td></tr>)}</tbody></table>{!rows.length&&<div className="empty">暂无实验记录</div>}</div>
}
function App() {
 const [view,setView] = useState<View>('overview')
 const [overview,setOverview] = useState<Overview|null>(null)
 const [experiments,setExperiments] = useState<Experiment[]>([])
 const [contracts,setContracts] = useState<Contract[]>([])
 const [skills,setSkills] = useState<Skill[]>([])
 const [badcases,setBadcases] = useState<Badcase[]>([])
 const [knowledge,setKnowledge] = useState<Knowledge[]>([])
 const [lineage,setLineage] = useState<Lineage|null>(null)
 const [selected,setSelected] = useState<string>('')
 const [loading,setLoading] = useState(true)
 const [error,setError] = useState('')
 const [modal,setModal] = useState(false)
 const [busy,setBusy] = useState(false)
 const [filter,setFilter] = useState('')
 const [mobileMenu,setMobileMenu] = useState(false)
 const [form,setForm] = useState({name:'New reward exploration',reward:'reward-v5',lr:'0.000001',dataset:'credit-v13',notes:'对照实验：保持数据版本不变'})
 const refresh = useCallback(async()=>{
   try {
     const [o,e,c,s,b,k] = await Promise.all([
       request<Overview>('/overview'),request<Experiment[]>('/experiments'),
       request<Contract[]>('/contracts'),request<Skill[]>('/skills'),
       request<Badcase[]>('/badcases'),request<Knowledge[]>('/knowledge')
     ])
     setOverview(o);setExperiments(e);setContracts(c);setSkills(s);setBadcases(b);setKnowledge(k)
     setSelected(prev=>prev || e[0]?.id || '')
     setError('')
   } catch (err) {setError(err instanceof Error?err.message:'无法加载 API')} finally {setLoading(false)}
 },[])
 useEffect(()=>{void refresh()},[refresh])
 useEffect(()=>{if(selected){request<Lineage>('/lineage/'+encodeURIComponent(selected)).then(setLineage).catch(()=>setLineage(null))}},[selected])
 async function submit(event:FormEvent<HTMLFormElement>) {
   event.preventDefault();setBusy(true)
   try {
     const result=await request<{id:string}>('/experiments',{method:'POST',body:JSON.stringify({...form,lr:Number(form.lr)})})
     await refresh();setSelected(result.id);setModal(false);setView('experiments')
   } catch(err){setError(String(err))}finally{setBusy(false)}
 }
 async function evaluate(id:string) {
   setBusy(true)
   try {await request('/experiments/'+encodeURIComponent(id)+'/evaluate',{method:'POST'});await refresh()}catch(err){setError(String(err))}finally{setBusy(false)}
 }
 function choose(id:string){setSelected(id);setView('lineage')}
 const chosen = experiments.find(e=>e.id===selected)
 const chart = [...experiments].filter(e=>e.test_risk!==null).reverse().map(e=>({name:e.id,risk:e.test_risk,val:e.val_risk}))
 const passing = experiments.filter(e=>e.gate==='PASS')
 const filtered=experiments.filter(e=>(e.name+' '+e.id+' '+e.reward).toLowerCase().includes(filter.toLowerCase()))
 return <div className="app-shell">
   <aside className={'sidebar '+(mobileMenu?'sidebar-open':'')}>
     <div className="brand"><div className="brand-symbol"><Layers3 size={22}/></div><div><strong>MODEL HUB</strong><small>AI Development Platform</small></div><button className="close-mobile" onClick={()=>setMobileMenu(false)}><X size={18}/></button></div>
     <div className="workspace"><span className="workspace-icon"><BrainCircuit size={18}/></span><span><strong>Credit Intelligence</strong><small>Research Workspace</small></span><ChevronDown size={14}/></div>
     <div className="nav-label">WORKSPACE</div>
     <nav>{menu.map(({id,icon:Icon})=><button key={id} className={'nav-item '+(view===id?'nav-active':'')} onClick={()=>{setView(id);setMobileMenu(false)}}><Icon size={18}/>{labels[id]}{id==='experiments'&&<span className="nav-count">{experiments.length}</span>}</button>)}</nav>
     <div className="sidebar-bottom"><div className="agent-card"><div><Sparkles size={17}/><strong>Codex Ready</strong></div><p>Contracts · Recipes · Skills<br/>由 AGENTS.md 约束执行</p><span className="agent-status"><span/> Workspace configured</span></div><div className="sidebar-footer"><Settings2 size={16}/> Demo environment <span>v0.1</span></div></div>
   </aside>
   <main className="main">
     <header className="topbar"><div className="breadcrumbs"><button className="mobile-toggle" onClick={()=>setMobileMenu(true)}><Menu size={20}/></button>Workspace <span>/</span> Credit RL <span>/</span> <strong>{labels[view]}</strong></div><div className="top-actions"><span className="env-pill"><span/> SYNTHETIC DEMO</span><button className="refresh" onClick={()=>{setLoading(true);void refresh()}} title="刷新"><RefreshCw size={16}/></button><div className="avatar">AI</div></div></header>
     <div className="content">
       <div className="page-heading"><div><div className="eyebrow"><span/> MODEL RESEARCH WORKSPACE</div><h1>{labels[view]}</h1><p>{view==='overview'?'从数据到评估，构建可追溯、可复用的 AI 模型研发闭环。':'统一管理实验资产、规则定义与质量准出。'}</p></div><button className="primary-button" onClick={()=>setModal(true)}><Plus size={17}/> 新建实验</button></div>
       {error&&<div className="error"><CircleAlert size={17}/> 无法完成请求：{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}
       {loading&&!overview?<div className="loading">正在加载实验工作空间…</div>:null}
       {view==='overview'&&overview&&<div className="screen">
         <div className="stats-grid"><Stat icon={Beaker} label="实验总数" value={String(overview.experiments).padStart(2,'0')} sub="Registered experiments"/><Stat icon={CheckCircle2} label="通过准出" value={String(overview.passed).padStart(2,'0')} sub="Synthetic release gates"/><Stat icon={Database} label="数据集版本" value={String(overview.datasets).padStart(2,'0')} sub="Reproducible snapshots"/><Stat icon={Activity} label="最低模拟风险" value={overview.best_risk?.toFixed(2)+'%' || '—'} sub="Test risk · lower is better"/></div>
         <div className="panel-grid"><section className="card chart-card"><SectionTitle title="实验效果趋势" desc="冻结 Test 风险与 Val 风险 · 合成演示数据" extra={<span className="small-legend"><i/>Test <i className="legend-muted"/>Val</span>}/><div className="chart-container"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{top:12,right:12,left:-20,bottom:5}}><defs><linearGradient id="risk-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5f8bfa" stopOpacity={0.22}/><stop offset="95%" stopColor="#5f8bfa" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8ecf4"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill:'#8b95a6',fontSize:11}}/><YAxis axisLine={false} tickLine={false} domain={['dataMin - 0.3','dataMax + 0.3']} tick={{fill:'#8b95a6',fontSize:11}} tickFormatter={v=>v+'%'}/><Tooltip formatter={(v)=>String(v)+'%'} contentStyle={{borderRadius:12,border:'1px solid #e6eaf2'}}/><Area type="monotone" dataKey="risk" name="Test" stroke="#4c75ec" strokeWidth={2.5} fill="url(#risk-fill)"/><Area type="monotone" dataKey="val" name="Val" stroke="#9db0d8" strokeWidth={2} strokeDasharray="5 5" fill="transparent"/></AreaChart></ResponsiveContainer></div></section>
         <section className="card gate-card"><SectionTitle title="准出评估" desc="质量门禁 · Release Gate v1"/><div className="gate-banner"><ShieldCheck size={23}/><div><strong>{passing.length} 个候选模型通过</strong><span>模拟准出规则（非真实信贷标准）</span></div></div>{[{name:'模拟 Test 风险',threshold:'≤ 3.50%',good:'Risk Control'},{name:'输出覆盖率',threshold:'≥ 95.00%',good:'Coverage'},{name:'约束违反率',threshold:'≤ 1.00%',good:'Compliance'}].map(a=><div className="gate-item" key={a.name}><span className="gate-check"><CheckCircle2 size={17}/></span><div><strong>{a.name}</strong><small>{a.good}</small></div><b>{a.threshold}</b></div>)}<button className="subtle-link" onClick={()=>setView('contracts')}>查看完整准出契约 <ArrowRight size={15}/></button></section></div>
         <section className="card recent-card"><SectionTitle title="最近实验" desc="所有实验可追溯数据与 Reward 配置" extra={<button className="subtle-link" onClick={()=>setView('experiments')}>查看全部 <ArrowRight size={15}/></button>}/><ExperimentTable rows={overview.recent} choose={choose}/></section>
         <section className="pipeline-card card"><SectionTitle title="端到端研发流水线" desc="基于 Recipe 的标准化流程 · 从实验到知识沉淀"/><div className="pipeline">{overview.pipeline.map((n,i)=><div className="pipeline-node" key={n}><span className="step-number">{String(i+1).padStart(2,'0')}</span><span>{n}</span>{i<overview.pipeline.length-1&&<ArrowRight className="step-arrow" size={14}/>}</div>)}</div></section>
       </div>}
       {view==='experiments'&&<div className="screen"><section className="card full-card"><SectionTitle title="实验运行记录" desc="支持创建合成实验、运行模拟评估及跳转模型血缘" extra={<div className="search-box"><Search size={16}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜索实验或 Reward"/></div>}/><ExperimentTable rows={filtered} choose={choose}/></section>{chosen&&<section className="card detail-card"><SectionTitle title="当前选择 · "+chosen.id} desc={chosen.notes}/><div className="detail-grid">{[{k:'Dataset',v:chosen.dataset},{k:'Reward',v:chosen.reward},{k:'Learning Rate',v:chosen.lr.toExponential(1)},{k:'Checkpoint',v:chosen.checkpoint},{k:'Test Risk',v:chosen.test_risk===null?'—':chosen.test_risk+'%'},{k:'Gate',v:chosen.gate}].map(x=><div key={x.k}><small>{x.k}</small><strong>{x.v}</strong></div>)}</div>{chosen.status==='draft'&&<button disabled={busy} className="primary-button" onClick={()=>void evaluate(chosen.id)}><Activity size={16}/> {busy?'正在计算…':'执行模拟 Val / Test 评估'}</button>}</section>}</div>}
       {view==='contracts'&&<div className="screen"><div className="info-strip"><ShieldCheck size={19}/> 规范是模型研发的单一事实来源；冻结契约不得由 Agent 擅自修改。</div><div className="asset-grid">{contracts.map(c=><div className="card asset-card" key={c.id}><div className="asset-top"><div className="asset-icon"><ShieldCheck size={19}/></div><Badge value={c.status}/></div><h3>{c.name}</h3><p>{c.detail}</p><div className="asset-foot"><code>{c.id} / {c.version}</code><span>{c.kind}</span></div></div>)}</div></div>}
       {view==='skills'&&<div className="screen"><div className="info-strip"><Code2 size={19}/> Skill 定义可执行能力；Contract 定义正确性；Recipe 负责流程编排。</div><div className="asset-grid">{skills.map(s=><div className="card asset-card" key={s.id}><div className="asset-top"><div className="asset-icon purple"><Boxes size={19}/></div><span className="tag">{s.stage}</span></div><h3>{s.name}</h3><p>{s.summary}</p><div className="asset-foot"><code>skills/{s.id}</code><ArrowRight size={15}/></div></div>)}</div></div>}
       {view==='badcases'&&<div className="screen"><div className="stats-grid"><Stat icon={CircleAlert} label="Badcase 总数" value={String(badcases.reduce((a,b)=>a+b.count,0))} sub="Synthetic cases"/><Stat icon={ShieldCheck} label="分类数量" value={String(badcases.length)} sub="Taxonomy categories"/><Stat icon={ClipboardCheck} label="待验证分布" value="04" sub="Regression categories"/><Stat icon={Activity} label="测试数据" value="Mock" sub="Not production data"/></div><section className="card full-card"><SectionTitle title="Badcase 类型分析" desc="从错误分类升级为可复用回归用例"/>{badcases.map(b=><div className="badcase-row" key={b.type}><div className="badcase-heading"><strong>{b.type}</strong><Badge value={b.severity}/><b>{b.count} cases</b></div><div className="bar-track"><div style={{width:(b.count/25*100)+'%'}}/></div><p>{b.note}</p></div>)}</section></div>}
       {view==='lineage'&&<div className="screen"><section className="card lineage-card"><SectionTitle title="实验资产血缘" desc="从数据源与 Contract 追溯到模型、评估及准出判定" extra={<select className="select" value={selected} onChange={e=>setSelected(e.target.value)}>{experiments.map(e=><option value={e.id} key={e.id}>{e.id} · {e.name}</option>)}</select>}/><div className="lineage-flow">{lineage?.nodes.map((node,i)=><div className="lineage-part" key={node.id}>{i>0&&<div className="lineage-arrow"><ArrowDown size={18}/></div>}<div className={'lineage-node kind-'+node.kind}><span>{node.kind}</span><strong>{node.label}</strong></div></div>)}</div><p className="lineage-note">注：契约节点与数据节点均是实验的上游依赖；此处用简化线性布局展示，实际依赖由 API 的 edges 返回。</p></section></div>}
       {view==='knowledge'&&<div className="screen"><div className="info-strip"><BrainCircuit size={19}/> 实验记录说明发生了什么，知识卡片记录有证据边界的结论。</div><div className="asset-grid">{knowledge.map(k=><div className="card asset-card" key={k.id}><div className="asset-top"><div className="asset-icon orange"><BookOpen size={19}/></div><span className="tag">{k.category}</span></div><h3>{k.title}</h3><p>{k.detail}</p><div className="asset-foot"><span>来源：{k.source}</span><ArrowRight size={15}/></div></div>)}</div></div>}
       <footer className="footer"><span>MODEL HUB · AI-assisted research operations</span><span><span className="foot-dot"/> Synthetic sample data · Not a credit decision system</span></footer>
     </div>
   </main>
   {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false)}}><form className="modal" onSubmit={e=>void submit(e)}><div className="modal-heading"><div><span className="eyebrow">NEW EXPERIMENT</span><h2>创建实验</h2><p>配置一个可追溯的模拟 RL 训练实验。</p></div><button type="button" onClick={()=>setModal(false)} className="icon-button"><X size={20}/></button></div><label>实验名称<input required minLength={3} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><div className="form-row"><label>Reward 版本<input required value={form.reward} onChange={e=>setForm({...form,reward:e.target.value})}/></label><label>Learning Rate<input required type="number" min="0.00000001" max="0.1" step="any" value={form.lr} onChange={e=>setForm({...form,lr:e.target.value})}/></label></div><label>Dataset 版本<select value={form.dataset} onChange={e=>setForm({...form,dataset:e.target.value})}><option value="credit-v12">credit-v12</option><option value="credit-v13">credit-v13</option></select></label><label>实验假设<textarea rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label><div className="modal-footer"><button type="button" className="secondary-button" onClick={()=>setModal(false)}>取消</button><button type="submit" disabled={busy} className="primary-button"><Plus size={16}/>{busy?'创建中…':'创建实验'}</button></div></form></div>}
 </div>
}
export default App
