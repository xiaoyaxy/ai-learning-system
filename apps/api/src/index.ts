import {createApp} from './http/routes';
import {ProjectRepository} from './db/repository';
import {ApiError} from './http/errors';
import type {Env} from './env';
export default {fetch(request:Request,env:Env,ctx:ExecutionContext){return createApp({repo:new ProjectRepository(env.DB),dispatcher:{accept:async()=>{throw new ApiError('NOT_IMPLEMENTED',501)}}}).fetch(request,env,ctx)}};
