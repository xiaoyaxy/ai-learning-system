import {Hono} from 'hono';
import type {Env} from './env';
const app=new Hono<{Bindings:Env}>();
app.get('/api/v1/health',c=>c.json({status:'ok'}));
export default app;
