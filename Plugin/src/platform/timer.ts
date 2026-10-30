// SPDX-License-Identifier: MPL-2.0
/** Capture the timer provider so cancellation stays with its scheduling host. */
export function scheduleTimeout(callback:()=>void,delay:number):()=>void {
  // Portable services also run without a DOM. Capture both fallback functions.
  const owner=typeof window==='object' && typeof window.setTimeout==='function' && typeof window.clearTimeout==='function'
    ?window:{setTimeout,clearTimeout};
  const timer=owner.setTimeout(callback,delay);
  return ()=>owner.clearTimeout(timer);
}
