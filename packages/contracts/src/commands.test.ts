import {describe,it,expect} from 'vitest';
import {CommandEnvelopeSchema,CreateProjectSchema} from './commands';
describe('untrusted commands',()=>{
 it('rejects a forged role in a message',()=>{expect(CommandEnvelopeSchema.safeParse({client_operation_id:crypto.randomUUID(),expected_revision:0,command:{type:'send_message',text:'我想学 Agent',mode:'message',actor_role:'coach'}}).success).toBe(false)});
 it('allows a project without an invented daily budget',()=>{expect(CreateProjectSchema.safeParse({client_operation_id:crypto.randomUUID(),name:'Agent',goal_text:'理解 Agent',time_constraint_text:'两周',timezone:'Asia/Shanghai'}).success).toBe(true)});
});

