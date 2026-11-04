export const onboardingError = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';
export async function onboardingRequest<T>(path = '', data?: unknown): Promise<T> {
  const response=await fetch('/api/modules/client-onboarding'+path,data === undefined ? undefined : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const value=await response.json() as {error?:string}; if(!response.ok)throw Error(value.error || 'This workspace is unavailable.'); return value as T;
}
