import {Agent} from 'agents';
import worker from './src/index';
export class EchoChild extends Agent {async echo(text:string){return text}}
export class TestParent extends Agent<Record<string,unknown>,{checkpoint:string|null}> {
 initialState={checkpoint:null};
 async delegate(text:string){const child=await this.dynamicAgents.get(EchoChild,'echo');return child.echo(text)}
 async queueCheckpoint(){await this.schedule(0,'markCheckpoint',{checkpoint:'persisted'},{idempotent:true})}
 async markCheckpoint(payload:{checkpoint:string}){this.setState(payload)}
 async readCheckpoint(){return this.state}
}
export default worker;
