import {PublicEventSchema,type WorkspaceDTO,type PublicEvent,type CompletionEvidenceDTO,type PendingInput} from '@learning/contracts';
import type {WorkspaceRecord,EventRecord} from '../db/types';
const decode=<T>(s:string|null,fallback:T):T=>{try{return s?JSON.parse(s) as T:fallback}catch{return fallback}};
export function toWorkspaceDTO(r:WorkspaceRecord):WorkspaceDTO {const p=r.project;const pending=decode<PendingInput|null>(p.pending_input_json,null);const question=pending?.kind==='answer'?r.questions.find(q=>q.id===pending.entity_id):null;const run=r.runs.find(x=>x.id===p.active_run_id);const proposal=[...r.proposals].reverse().find(x=>x.status==='pending');const policy=r.policies.at(-1);return {
 project:{id:p.id,name:p.name,goal_text:p.goal_text,time_constraint_text:p.time_constraint_text,timezone:p.timezone,goal_version:p.goal_version},phase:p.phase,revision:p.revision,run_epoch:p.run_epoch,pending_input:pending,active_run:run?{id:run.id,status:run.status,error_code:run.error_code}:null,
 question:question?{id:String(question.id),version:Number(question.version),prompt:String(question.prompt),attempt_index:r.attempts.filter(a=>a.question_id===question.id).length+1}:null,
 messages:r.messages.map(m=>({id:m.id,seq:m.seq,role:m.sender_role,text:m.body,created_at:m.created_at})),artifacts:r.artifacts.filter(a=>!a.tombstone).map(a=>({id:a.id,kind:a.kind,version:a.version,content:a.content,created_at:a.created_at})),latest_seq:r.latest_seq,
 completion:decode<CompletionEvidenceDTO>(p.completion_json,{status:'policy_required',correct_count:null,total_count:null,policy_version:null,goal_version:p.goal_version,items:[]}),
 proposal:proposal?{id:String(proposal.id),version:Number(proposal.version),impact:proposal.impact as 'none'|'affected'|'unknown',summary:String(proposal.summary),status:String(proposal.status)}:null,
 policy:policy?{id:String(policy.id),version:Number(policy.version),status:String(policy.status),summary:policySummary(String(policy.policy_json))}:null
 }}
function policySummary(json:string){const p=decode<Record<string,unknown>>(json,{});return `题数：${p.question_count??'待定'}；口径：${p.attempt_basis??'待定'}；部分正确：${p.partial_rule??'待定'}；完成标准：80%`}
export function toPublicEvent(r:EventRecord):PublicEvent {const raw=decode<Record<string,unknown>>(r.payload_json,{});const payload=Object.fromEntries(['text','entity_id','status','from','to'].filter(k=>typeof raw[k]==='string').map(k=>[k,raw[k]]));return PublicEventSchema.parse({project_id:r.project_id,seq:r.seq,type:r.type,run_id:r.run_id,role:r.role,occurred_at:r.occurred_at,payload})}
