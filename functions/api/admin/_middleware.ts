import { authFailure, verifyAdminRequest } from '../../_lib/admin-auth';
import type { AdminEnv } from '../../_lib/admin-db';

interface Context {
  request: Request;
  env: AdminEnv;
  next(): Promise<Response>;
}

export async function onRequest(context: Context): Promise<Response> {
  const auth = await verifyAdminRequest(context.request, context.env);
  if (!auth.ok) return authFailure(auth);
  return context.next();
}
