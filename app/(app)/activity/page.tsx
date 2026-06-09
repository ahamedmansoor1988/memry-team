"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  RefreshCw, ExternalLink, Columns, Clock, ShieldAlert,
  AlertTriangle, MessageSquare, CheckCircle2,
  TrendingUp, TrendingDown, Minus, ArrowRightLeft,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "overview" | "log" | "waiting";

interface PulseData {
  health: { score: number; label: string };
  stalledDecisions:  { count: number; items: unknown[] };
  unresolvedBlocks:  { count: number; items: unknown[] };
  riskFlags:         { count: number; items: unknown[] };
  vagueComments:     { count: number; items: unknown[] };
  topWaitingOn:      { owner_name: string; count: number }[];
}
interface FeedbackItemBrief {
  id: string; status: string; priority: string;
  ai_classification: string | null; ai_key_question: string | null;
  ai_summary: string | null; created_at: string;
  project: { id: string; name: string } | null;
}
interface DecisionItem {
  id: string; decision_text: string; owner_name: string | null;
  source: string; decided_at: string;
}
interface TimelineGroup { date: string; decisions: DecisionItem[]; }
interface TrendEntry { direction: "up" | "down" | "flat"; delta: number; }
interface TrendsData {
  current: { total: number; resolved: number; blocked: number; risk_flags: number; needs_decision: number };
  trends:  { total: TrendEntry; resolved: TrendEntry; blocked: TrendEntry; risk_flags: TrendEntry; needs_decision: TrendEntry };
}
interface ActivityEvent {
  id: string; from_status: string; to_status: string; reason: string | null;
  changed_by: string | null; created_at: string; item_id: string | null;
  ai_key_question: string | null; ai_summary: string | null;
  ai_classification: string | null; project_id: string | null; project_name: string | null;
}
interface DateGroup { label: string; events: ActivityEvent[]; }
interface HandoffItem {
  id: string; status: string; priority: string | null;
  ai_classification: string | null; ai_key_question: string | null;
  ai_summary: string | null; owner_name: string; waiting_days: number;
  updated_at: string; project_id: string | null; project_name: string | null;
  author_name: string | null;
}
type AccountabilityUrgency = "critical" | "high" | "medium" | "low" | "none";
interface AccountabilityItem {
  id: string; status: string; ai_classification: string | null;
  ai_key_question: string | null; ai_summary: string | null;
  owner_name: string | null; project_id: string | null; project_name: string | null;
  updated_at: string; waiting_days: number; blocked_days: number;
  is_overdue: boolean; urgency: AccountabilityUrgency; label: string; should_escalate: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function SkeletonLine({ w = "w-full", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`skeleton ${h} ${w} rounded`} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_CLS: Record<string, string> = {
  "Needs Decision": "bg-zinc-900 text-white border-zinc-900",
  "Blocked":        "bg-red-50 text-red-700 border-red-200",
  "Risk":           "bg-zinc-100 text-zinc-600 border-zinc-200",
  "Approved":       "bg-zinc-100 text-zinc-600 border-zinc-200",
  "Info":           "bg-zinc-100 text-zinc-600 border-zinc-200",
};
const SOURCE_CLS: Record<string, string> = {
  figma:  "bg-zinc-100 text-zinc-600 border-zinc-200",
  manual: "bg-zinc-100 text-zinc-500 border-zinc-200",
  ai:     "bg-zinc-100 text-zinc-900 border-zinc-200",
  meeting:"bg-zinc-100 text-zinc-900 border-zinc-200",
};

function HealthCard({ pulse }: { pulse: PulseData }) {
  const { score, label } = pulse.health;
  const ringColor  = score >= 80 ? "border-zinc-900" : score >= 60 ? "border-zinc-400" : "border-red-400";
  const scoreColor = score >= 80 ? "text-zinc-900"   : score >= 60 ? "text-zinc-700"   : "text-red-600";
  const labelCls   = score >= 80 ? "bg-zinc-100 text-zinc-900 border-zinc-200"
    : score >= 60 ? "bg-zinc-100 text-zinc-600 border-zinc-200"
    : "bg-red-50 text-red-600 border-red-200";
  const stats = [
    { icon: <Clock size={12} />,         label: "Stalled",       value: pulse.stalledDecisions?.count ?? 0 },
    { icon: <ShieldAlert size={12} />,   label: "Blocked",       value: pulse.unresolvedBlocks?.count ?? 0, red: true },
    { icon: <AlertTriangle size={12} />, label: "Risks",         value: pulse.riskFlags?.count        ?? 0 },
    { icon: <MessageSquare size={12} />, label: "Needs Clarity", value: pulse.vagueComments?.count    ?? 0 },
  ];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="flex items-center gap-4 shrink-0">
        <div className={`w-16 h-16 rounded-full border-4 ${ringColor} flex items-center justify-center shrink-0`}>
          <span className={`text-xl font-bold tabular-nums leading-none ${scoreColor}`}>{score}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${labelCls}`}>{label}</span>
          <span className="text-xs text-zinc-400">Workspace health</span>
        </div>
      </div>
      <div className="hidden sm:block w-px h-10 bg-zinc-100 shrink-0" />
      <div className="flex flex-wrap gap-2">
        {stats.map(s => (
          <span key={s.label} className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white border-zinc-200 ${s.red && s.value > 0 ? "text-red-600 border-red-200 bg-red-50" : "text-zinc-700"}`}>
            {s.icon}<span className="font-bold">{s.value}</span><span className="font-normal text-zinc-400">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function QuickActions() {
  const [syncing, setSyncing] = useState<"idle"|"syncing"|"done"|"error">("idle");
  function syncFigma() {
    setSyncing("syncing");
    fetch("/api/figma/pull", { method: "POST" })
      .then(r => r.ok ? setSyncing("done") : setSyncing("error"))
      .catch(() => setSyncing("error"))
      .finally(() => setTimeout(() => setSyncing("idle"), 3000));
  }
  const syncLabel = syncing === "syncing" ? "Syncing…" : syncing === "done" ? "Done ✓" : syncing === "error" ? "Error" : "Sync Figma";
  const syncCls   = syncing === "done" ? "text-zinc-900 border-zinc-200" : syncing === "error" ? "text-red-500 border-red-300" : "text-zinc-700 border-zinc-200 hover:bg-zinc-50";
  return (
    <div className="flex gap-2 flex-wrap">
      <button onClick={syncFigma} disabled={syncing === "syncing"}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-white text-sm font-medium shadow-sm transition-colors disabled:opacity-50 ${syncCls}`}>
        <RefreshCw size={14} className={syncing === "syncing" ? "animate-spin" : ""} />{syncLabel}
      </button>
      <Link href="/decisions" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors">
        <ExternalLink size={14} />Generate Brief
      </Link>
      <Link href="/inbox" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 shadow-sm transition-colors">
        <Columns size={14} />View Inbox
      </Link>
    </div>
  );
}

function NeedsAttentionCard({ items, loading }: { items: FeedbackItemBrief[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Needs Attention</span>
        <Link href="/inbox" className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors">View all →</Link>
      </div>
      <div className="flex-1 divide-y divide-zinc-100">
        {loading
          ? [1,2,3,4,5].map(n=>(
              <div key={n} className="px-4 py-3 space-y-1.5">
                <SkeletonLine w="w-16" h="h-3"/><SkeletonLine w="w-full" h="h-3"/><SkeletonLine w="w-1/2" h="h-2.5"/>
              </div>))
          : items.length === 0
          ? <div className="px-4 py-8 text-center"><CheckCircle2 size={24} className="text-zinc-300 mx-auto mb-2"/><p className="text-sm text-zinc-400">All clear!</p></div>
          : items.map(item => {
              const title = item.ai_key_question && item.ai_key_question !== "None" ? item.ai_key_question : item.ai_summary ?? "Feedback item";
              const href  = item.project?.id ? `/inbox/${item.project.id}/${item.id}` : "/inbox";
              const cls   = item.ai_classification ? (CLASS_CLS[item.ai_classification] ?? null) : null;
              return (
                <Link key={item.id} href={href} className="flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50 transition-colors">
                  {cls && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border self-start ${cls}`}>{item.ai_classification}</span>}
                  <p className="text-sm text-zinc-900 line-clamp-1">{title}</p>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    {item.project?.name && <span>{item.project.name}</span>}<span className="opacity-40">·</span><span>{timeAgo(item.created_at)}</span>
                  </div>
                </Link>
              );
            })
        }
      </div>
    </div>
  );
}

function RecentDecisionsCard({ decisions, loading }: { decisions: DecisionItem[]; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Recent Decisions</span>
        <Link href="/decisions" className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors">View all →</Link>
      </div>
      <div className="flex-1 divide-y divide-zinc-100">
        {loading
          ? [1,2,3,4,5].map(n=>(<div key={n} className="px-4 py-3 space-y-1.5"><SkeletonLine w="w-full" h="h-3"/><SkeletonLine w="w-1/3" h="h-2.5"/></div>))
          : decisions.length === 0
          ? <div className="px-4 py-8 text-center"><p className="text-sm text-zinc-400">No decisions yet</p></div>
          : decisions.map(d => {
              const srcCls = SOURCE_CLS[d.source] ?? SOURCE_CLS.manual;
              return (
                <div key={d.id} className="flex flex-col gap-1 px-4 py-3">
                  <p className="text-sm text-zinc-900 line-clamp-1">{d.decision_text}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${srcCls}`}>{d.source}</span>
                    {d.owner_name && <span className="text-xs text-zinc-400">{d.owner_name}</span>}
                    <span className="text-xs text-zinc-400 ml-auto">{timeAgo(d.decided_at)}</span>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

function WaitingOnChips({ entries }: { entries: { owner_name: string; count: number }[] }) {
  if (!entries.length) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-400 shrink-0">Waiting on:</span>
      {entries.map(e => (
        <span key={e.owner_name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-sm text-zinc-700">
          <span className="w-5 h-5 rounded-full bg-zinc-200 flex items-center justify-center text-[9px] font-bold text-zinc-500 shrink-0">{e.owner_name.slice(0,2).toUpperCase()}</span>
          {e.owner_name}<span className="text-[10px] font-bold text-zinc-400">{e.count}</span>
        </span>
      ))}
    </div>
  );
}

function OverviewTab() {
  const [pulse,            setPulse]            = useState<PulseData | null>(null);
  const [pulseLoading,     setPulseLoading]     = useState(true);
  const [feedbackItems,    setFeedbackItems]    = useState<FeedbackItemBrief[]>([]);
  const [feedbackLoading,  setFeedbackLoading]  = useState(true);
  const [decisions,        setDecisions]        = useState<DecisionItem[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(true);
  const [trendsData,       setTrendsData]       = useState<TrendsData | null>(null);

  const loadAll = useCallback(() => {
    fetch("/api/pulse")
      .then(r=>r.json()).then((d: PulseData)=>{setPulse(d);setPulseLoading(false);})
      .catch(()=>setPulseLoading(false));
    fetch("/api/feedback")
      .then(r=>r.json()).then((d:{items?:FeedbackItemBrief[]})=>{setFeedbackItems(d.items??[]);setFeedbackLoading(false);})
      .catch(()=>setFeedbackLoading(false));
    fetch("/api/decisions/timeline")
      .then(r=>r.json()).then((d:{timeline?:TimelineGroup[]})=>{
        const flat=(d.timeline??[]).flatMap(g=>g.decisions);
        setDecisions(flat.slice(0,5));setDecisionsLoading(false);
      }).catch(()=>setDecisionsLoading(false));
    fetch("/api/pulse/trends")
      .then(r=>r.json()).then((d:TrendsData)=>setTrendsData(d))
      .catch(()=>{});
  }, []);

  useEffect(()=>{loadAll();},[loadAll]);

  const needsAttention = feedbackItems.filter(i=>i.status==="open"||i.status==="needs_decision").slice(0,5);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Workspace Health</p>
        {pulseLoading
          ? <div className="rounded-xl border border-zinc-200 bg-white p-5 flex items-center gap-5">
              <div className="skeleton w-16 h-16 rounded-full"/>
              <div className="skeleton h-6 w-24 rounded-full"/>
              <div className="flex gap-2 ml-4">{[1,2,3,4].map(n=><div key={n} className="skeleton h-8 w-24 rounded-lg"/>)}</div>
            </div>
          : pulse ? <HealthCard pulse={pulse}/> : null}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Quick Actions</p>
        <QuickActions/>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Activity</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NeedsAttentionCard items={needsAttention} loading={feedbackLoading}/>
          <RecentDecisionsCard decisions={decisions} loading={decisionsLoading}/>
        </div>
      </div>
      {pulse && (pulse.topWaitingOn??[]).length>0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Waiting On</p>
          <WaitingOnChips entries={pulse.topWaitingOn??[]}/>
        </div>
      )}
      {trendsData && (()=>{
        type MetricKey = "total"|"resolved"|"blocked"|"risk_flags"|"needs_decision";
        const metaCfg: {key:MetricKey;label:string;goodDir:"up"|"down"|"flat"}[] = [
          {key:"total",label:"New Items",goodDir:"flat"},
          {key:"resolved",label:"Resolved",goodDir:"up"},
          {key:"blocked",label:"Blocked",goodDir:"down"},
          {key:"risk_flags",label:"Risks",goodDir:"down"},
          {key:"needs_decision",label:"Needs Decision",goodDir:"down"},
        ];
        return (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-3">Trends This Week</p>
            <div className="grid grid-cols-5 gap-2">
              {metaCfg.map(({key,label,goodDir})=>{
                const t=trendsData.trends[key];const val=trendsData.current[key];
                const isGood=t.direction===goodDir||(goodDir==="flat"&&t.direction!=="up");
                const isBad=(goodDir==="up"&&t.direction==="down")||(goodDir==="down"&&t.direction==="up")||(goodDir==="flat"&&t.direction==="up");
                const numColor=isBad?"text-red-500":isGood?"text-zinc-900":"text-zinc-600";
                const deltaCls=isBad?"text-red-400":isGood?"text-zinc-900":"text-zinc-400";
                const ArrowIcon=t.direction==="up"?TrendingUp:t.direction==="down"?TrendingDown:Minus;
                return (
                  <div key={key} className="flex flex-col items-center gap-0.5 rounded-xl border border-zinc-200 bg-white p-3 text-center">
                    <span className="text-[10px] text-zinc-400 leading-tight mb-1">{label}</span>
                    <span className={`text-[22px] font-bold leading-none tabular-nums ${numColor}`}>{val}</span>
                    <div className={`flex items-center gap-0.5 mt-1 ${deltaCls}`}>
                      <ArrowIcon size={11}/>
                      <span className="text-[10px] font-semibold">{t.delta>0?`+${t.delta}`:t.delta===0?"—":t.delta}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB
// ─────────────────────────────────────────────────────────────────────────────

const LOG_STATUS_CLS: Record<string,string> = {
  open:"bg-zinc-100 text-zinc-600 border border-zinc-200",
  needs_decision:"bg-zinc-100 text-zinc-600 border border-zinc-200",
  resolved:"bg-zinc-100 text-zinc-700 border border-zinc-200",
  archived:"bg-zinc-100 text-zinc-400 border border-zinc-200",
  deleted:"bg-zinc-100 text-zinc-400 border border-zinc-200",
};
const LOG_STATUS_LABEL: Record<string,string> = {
  open:"Open",needs_decision:"Needs Decision",resolved:"Resolved",archived:"Archived",deleted:"Deleted",
};

function toDateKey(iso:string):string{return new Date(iso).toLocaleDateString("en-CA");}
function toDateLabel(key:string):string{
  const today=new Date().toLocaleDateString("en-CA");
  const yesterday=new Date(Date.now()-86400000).toLocaleDateString("en-CA");
  if(key===today)return"Today";if(key===yesterday)return"Yesterday";
  return new Date(key+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric"});
}
function groupByDate(events:ActivityEvent[]):DateGroup[]{
  const map=new Map<string,ActivityEvent[]>();
  for(const e of events){const key=toDateKey(e.created_at);if(!map.has(key))map.set(key,[]);map.get(key)!.push(e);}
  return Array.from(map.entries()).map(([key,evts])=>({label:toDateLabel(key),events:evts}));
}
function itemTitle(e:ActivityEvent):string{
  if(e.ai_key_question&&e.ai_key_question!=="None")return e.ai_key_question;
  if(e.ai_summary)return e.ai_summary;return"Feedback item";
}

function LogStatusBadge({status}:{status:string}){
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${LOG_STATUS_CLS[status]??LOG_STATUS_CLS.open}`}>{LOG_STATUS_LABEL[status]??status}</span>;
}

function EventCard({event}:{event:ActivityEvent}){
  const href=event.project_id&&event.item_id?`/inbox/${event.project_id}/${event.item_id}`:null;
  const inner=(
    <div className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm transition-all">
      <p className="text-sm font-medium text-zinc-900 line-clamp-2 mb-2">{itemTitle(event)}</p>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <LogStatusBadge status={event.from_status}/>
        <span className="text-xs text-zinc-400">→</span>
        <LogStatusBadge status={event.to_status}/>
      </div>
      {event.reason&&<p className="text-xs text-zinc-500 italic mb-2 leading-relaxed">{event.reason}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {event.project_name&&<span className="text-xs text-zinc-400">{event.project_name}</span>}
        <span className="text-xs text-zinc-400 ml-auto">{timeAgo(event.created_at)}</span>
      </div>
    </div>
  );
  return href?<Link href={href} className="block">{inner}</Link>:inner;
}

function LogTab(){
  const [events,setEvents]=useState<ActivityEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const fetched=useRef(false);
  useEffect(()=>{
    if(fetched.current)return;fetched.current=true;
    fetch("/api/activity?limit=100")
      .then(r=>r.json()).then((d:{events?:ActivityEvent[]})=>{setEvents(d.events??[]);setLoading(false);})
      .catch(()=>setLoading(false));
  },[]);
  const groups=groupByDate(events);
  if(loading)return(
    <div className="space-y-2">
      {[1,2,3,4,5].map(n=>(
        <div key={n} className="rounded-xl border border-zinc-200 bg-white p-4 space-y-2">
          <div className="skeleton h-4 w-2/3 rounded"/>
          <div className="flex items-center gap-2"><div className="skeleton h-4 w-20 rounded"/><div className="skeleton h-3 w-3 rounded"/><div className="skeleton h-4 w-16 rounded"/></div>
          <div className="skeleton h-3 w-1/3 rounded"/>
        </div>
      ))}
    </div>
  );
  if(events.length===0)return(
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <p className="text-base font-medium text-zinc-900">No activity yet</p>
      <p className="text-sm text-zinc-400 max-w-xs">Status changes will appear here as your team reviews feedback.</p>
    </div>
  );
  return(
    <div className="space-y-8 fade-in">
      {groups.map(group=>(
        <div key={group.label}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{group.label}</span>
            <span className="text-xs text-zinc-300">· {group.events.length} {group.events.length===1?"event":"events"}</span>
          </div>
          <div className="space-y-2">{group.events.map(event=><EventCard key={event.id} event={event}/>)}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING ON TAB
// ─────────────────────────────────────────────────────────────────────────────

const URGENCY_BORDER: Record<AccountabilityUrgency,string> = {
  critical:"border-l-red-500",high:"border-l-zinc-500",medium:"border-l-zinc-400",low:"border-l-zinc-200",none:"border-l-transparent",
};
const URGENCY_LABEL_CLS: Record<AccountabilityUrgency,string> = {
  critical:"bg-red-50 text-red-700",high:"bg-zinc-100 text-zinc-600",medium:"bg-zinc-100 text-zinc-600",low:"bg-zinc-100 text-zinc-400",none:"bg-zinc-100 text-zinc-400",
};
const URGENCY_HEADING: Record<AccountabilityUrgency,string> = {critical:"CRITICAL",high:"HIGH",medium:"MEDIUM",low:"LOW",none:""};
const URGENCY_HEADING_CLS: Record<AccountabilityUrgency,string> = {critical:"text-red-500",high:"text-zinc-600",medium:"text-zinc-500",low:"text-zinc-400",none:"text-zinc-300"};
const URGENCY_ORDER: AccountabilityUrgency[] = ["critical","high","medium","low"];

const HANDOFF_STATUS_LABEL: Record<string,string> = {open:"Open",needs_decision:"Needs Decision"};
const HANDOFF_CLASS_CLS: Record<string,string> = {
  "Needs Decision":"bg-zinc-100 text-zinc-600 border border-zinc-200",
  "Blocked":"bg-red-50 text-red-600 border border-red-200",
  "Risk":"bg-zinc-100 text-zinc-600 border border-zinc-200",
};

type WaitingTabView = "owner"|"urgency";

function HandoffCard({item}:{item:HandoffItem}){
  const href=item.project_id?`/inbox/${item.project_id}/${item.id}`:"#";
  const title=item.ai_key_question&&item.ai_key_question!=="None"?item.ai_key_question:item.ai_summary??"Feedback item";
  const classCls=item.ai_classification?(HANDOFF_CLASS_CLS[item.ai_classification]??null):null;
  const waitCls=item.waiting_days>7?"text-red-600 bg-red-50 border border-red-200":item.waiting_days>3?"text-zinc-600 bg-zinc-100 border border-zinc-200":"text-zinc-400 bg-zinc-50 border border-zinc-200";
  return(
    <Link href={href} className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-sm transition-all mb-2">
      <p className="text-sm font-medium text-zinc-900 line-clamp-2 leading-snug mb-2">{title}</p>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200">{HANDOFF_STATUS_LABEL[item.status]??item.status}</span>
        {classCls&&<span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${classCls}`}>{item.ai_classification}</span>}
        {item.waiting_days>0&&<span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${waitCls}`}>Waiting {item.waiting_days}d</span>}
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
        {item.project_name&&<span>{item.project_name}</span>}
        {item.author_name&&<><span className="opacity-40">·</span><span>{item.author_name}</span></>}
        <span className="ml-auto">{timeAgo(item.updated_at)}</span>
      </div>
    </Link>
  );
}

function AccountabilityRow({item}:{item:AccountabilityItem}){
  const href=item.project_id?`/inbox/${item.project_id}/${item.id}`:"#";
  const title=item.ai_key_question&&item.ai_key_question!=="None"?item.ai_key_question:item.ai_summary??"—";
  return(
    <Link href={href} className={`block border border-zinc-200 bg-white rounded-xl mb-2 border-l-4 ${URGENCY_BORDER[item.urgency]} hover:border-zinc-300 hover:shadow-sm transition-all p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 line-clamp-2">{title}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {item.project_name&&<span className="text-xs text-zinc-400">{item.project_name}</span>}
            {item.owner_name&&<><span className="text-xs text-zinc-300">·</span><span className="text-xs text-zinc-400">{item.owner_name}</span></>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {item.label&&<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${URGENCY_LABEL_CLS[item.urgency]}`}>{item.label}</span>}
          <span className="text-xs text-zinc-400">{timeAgo(item.updated_at)}</span>
        </div>
      </div>
    </Link>
  );
}

function WaitingTab(){
  const [view,setView]=useState<WaitingTabView>("owner");
  const [handoffs,setHandoffs]=useState<HandoffItem[]>([]);
  const [handoffsLoading,setHandoffsLoading]=useState(true);
  const [urgencyItems,setUrgencyItems]=useState<AccountabilityItem[]>([]);
  const [urgencyLoading,setUrgencyLoading]=useState(false);
  const handoffsFetched=useRef(false);
  const urgencyFetched=useRef(false);

  useEffect(()=>{
    if(handoffsFetched.current)return;handoffsFetched.current=true;
    fetch("/api/handoffs")
      .then(r=>r.json()).then((d:{handoffs?:HandoffItem[]})=>{setHandoffs(d.handoffs??[]);setHandoffsLoading(false);})
      .catch(()=>setHandoffsLoading(false));
  },[]);

  useEffect(()=>{
    if(view!=="urgency"||urgencyFetched.current)return;urgencyFetched.current=true;
    setUrgencyLoading(true);
    fetch("/api/accountability")
      .then(r=>r.json()).then((d:{items?:AccountabilityItem[]})=>{setUrgencyItems(d.items??[]);setUrgencyLoading(false);})
      .catch(()=>setUrgencyLoading(false));
  },[view]);

  const ownerGroups=new Map<string,HandoffItem[]>();
  for(const h of handoffs){if(!ownerGroups.has(h.owner_name))ownerGroups.set(h.owner_name,[]);ownerGroups.get(h.owner_name)!.push(h);}

  const urgencyGroups:Record<AccountabilityUrgency,AccountabilityItem[]>={critical:[],high:[],medium:[],low:[],none:[]};
  for(const item of urgencyItems){const u=item.urgency in urgencyGroups?item.urgency:"low";urgencyGroups[u].push(item);}

  const skeleton=(
    <div className="space-y-2">
      {[1,2,3,4].map(n=>(
        <div key={n} className="rounded-xl border border-zinc-200 bg-white p-4 space-y-2">
          <div className="skeleton h-4 w-2/3 rounded mb-2"/>
          <div className="flex gap-1.5"><div className="skeleton h-4 w-20 rounded"/><div className="skeleton h-4 w-16 rounded"/></div>
          <div className="skeleton h-3 w-1/3 rounded"/>
        </div>
      ))}
    </div>
  );
  const empty=(
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <ArrowRightLeft size={32} className="text-zinc-200"/>
      <p className="text-base font-medium text-zinc-900">Nothing pending</p>
      <p className="text-sm text-zinc-400 max-w-xs">Items requiring follow-up will appear here.</p>
    </div>
  );

  return(
    <div>
      <div className="flex items-center gap-1 mb-5">
        {(["owner","urgency"] as WaitingTabView[]).map(t=>(
          <button key={t} onClick={()=>setView(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view===t?"bg-zinc-900 text-white":"bg-zinc-50 text-zinc-500 border border-zinc-200 hover:text-zinc-900"}`}>
            {t==="owner"?"By Owner":"By Urgency"}
          </button>
        ))}
      </div>
      {view==="owner"?(
        handoffsLoading?skeleton:handoffs.length===0?empty:(
          <div className="space-y-6 fade-in">
            {Array.from(ownerGroups.entries()).map(([owner,items])=>(
              <div key={owner}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-zinc-200 flex items-center justify-center text-[9px] font-bold text-zinc-500 shrink-0">{owner.slice(0,2).toUpperCase()}</span>
                  <span className="text-sm font-semibold text-zinc-900">{owner}</span>
                  <span className="text-xs text-zinc-400">· {items.length} item{items.length!==1?"s":""}</span>
                </div>
                {items.map(item=><HandoffCard key={item.id} item={item}/>)}
              </div>
            ))}
          </div>
        )
      ):(
        urgencyLoading?skeleton:urgencyItems.length===0?empty:(
          <div className="space-y-6 fade-in">
            {URGENCY_ORDER.filter(u=>urgencyGroups[u].length>0).map(urgency=>(
              <div key={urgency}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${URGENCY_HEADING_CLS[urgency]}`}>{URGENCY_HEADING[urgency]}</span>
                  <span className="text-xs text-zinc-400">{urgencyGroups[urgency].length} item{urgencyGroups[urgency].length!==1?"s":""}</span>
                </div>
                {urgencyGroups[urgency].map(item=><AccountabilityRow key={item.id} item={item}/>)}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

const TABS: {id:TabId;label:string}[] = [
  {id:"overview",label:"Overview"},
  {id:"log",label:"Log"},
  {id:"waiting",label:"Waiting On"},
];

export default function ActivityPage() {
  const [activeTab,setActiveTab]=useState<TabId>("overview");
  const [activated,setActivated]=useState<Set<TabId>>(()=>new Set<TabId>(["overview"] as TabId[]));

  function handleTab(tab:TabId){
    setActiveTab(tab);
    setActivated(prev=>new Set(Array.from(prev).concat(tab)));
  }

  return(
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      {/* Header + Tabs */}
      <div className="px-8 pt-7 pb-0 border-b border-zinc-200 shrink-0">
        <h1 className="text-2xl font-semibold text-zinc-900 mb-4">Activity</h1>
        <div className="flex gap-0">
          {TABS.map(tab=>(
            <button key={tab.id} onClick={()=>handleTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab===tab.id?"text-zinc-900 border-b-2 border-zinc-900 -mb-px":"text-zinc-400 hover:text-zinc-600"}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {/* Content — mount all activated tabs, hide inactive ones */}
      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-6xl">
        {activated.has("overview")&&<div className={activeTab==="overview"?"":"hidden"}><OverviewTab/></div>}
        {activated.has("log")&&<div className={activeTab==="log"?"":"hidden"}><LogTab/></div>}
        {activated.has("waiting")&&<div className={activeTab==="waiting"?"":"hidden"}><WaitingTab/></div>}
      </div>
    </div>
  );
}
