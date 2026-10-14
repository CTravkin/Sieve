import type {PluginStatus} from '../main.ts';
import type {SieveSettings} from '../settings/model.ts';
import {sameSettings} from '../settings/model.ts';
import {locale} from '../i18n/index.ts';

/** Describe the loaded runtime separately from saved data and the current draft. */
export function statusLines(status:PluginStatus,saved:SieveSettings|undefined,draft:SieveSettings,language:string):string[] {
  const text=locale(language).status;
  const state={loading:text.loading,pending:text.pending,applied:status.fallback?text.fallbackActive:text.active,unsupported:locale(language).messages.unsupportedVersion,unfiltered:text.unfiltered,error:locale(language).messages.runtimeError,disposed:text.disposed};
  const lines=[state[status.status]];
  if(status.fallback && status.status!=='applied')lines.push(text.fallbackSelected);
  if(status.pendingReload)lines.push(text.pendingReload);
  if(!sameSettings(saved,draft))lines.push(text.unsaved);
  return lines;
}
