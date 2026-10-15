import type {PluginStatus} from '../main.ts';
import type {SieveSettings} from '../settings/model.ts';
import {sameSettings} from '../settings/model.ts';
import {locale} from '../i18n/index.ts';

/** Describe the loaded runtime separately from saved data and the current draft. */
export function statusLines(status:PluginStatus,saved:SieveSettings|undefined,draft:SieveSettings,language:string):string[] {
  return statusEntries(status,saved,draft,language).map(entry=>entry.text);
}

export interface StatusEntry {readonly text:string;readonly severity?:'warning'|'error'}
export function statusEntries(status:PluginStatus,saved:SieveSettings|undefined,draft:SieveSettings,language:string):StatusEntry[] {
  const text=locale(language).status;
  const state={loading:text.loading,pending:text.pending,applied:status.fallback?text.fallbackActive:text.active,unsupported:locale(language).messages.unsupportedVersion,unfiltered:text.unfiltered,error:locale(language).messages.runtimeError,disposed:text.disposed};
  const severity=status.status==='error'?'error':status.fallback||['pending','unsupported','unfiltered'].includes(status.status)?'warning':undefined;
  const lines:StatusEntry[]=[{text:state[status.status],severity}];
  if(status.fallback && status.status!=='applied')lines.push({text:text.fallbackSelected,severity:'warning'});
  if(status.pendingReload)lines.push({text:text.pendingReload,severity:'warning'});
  if(!sameSettings(saved,draft))lines.push({text:text.unsaved,severity:'warning'});
  return lines;
}
