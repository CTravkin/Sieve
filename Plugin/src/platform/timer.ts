// SPDX-License-Identifier: MPL-2.0
/** Cancellation belongs to the same window that scheduled the timeout. */
export function scheduleTimeout(callback:()=>void,delay:number):()=>void {
  if(typeof window==='object' && typeof window.setTimeout==='function' && typeof window.clearTimeout==='function'){
    const owner=window;
    const timer=owner.setTimeout(callback,delay);
    return ()=>owner.clearTimeout(timer);
  }
  // Portable services also run without a DOM (native oracle/model checks).
  // eslint-disable-next-line no-restricted-globals
  const timer=setTimeout(callback,delay);
  // eslint-disable-next-line no-restricted-globals
  return ()=>clearTimeout(timer);
}
