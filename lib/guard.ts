import { isAuthed, unauthorized } from './auth';

/** Returns a 401 Response if the request is not from the logged-in owner, otherwise null. */
export async function guard(req: Request): Promise<Response | null> {
  return (await isAuthed(req)) ? null : unauthorized();
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
