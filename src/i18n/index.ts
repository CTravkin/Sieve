import en from '../locales/en.json';
import ru from '../locales/ru.json';
import type {Diagnostic} from '../core/types.ts';
import type {SettingsError} from '../settings/storage.ts';
export type Messages=typeof en.messages;
export function locale(language:string):typeof en {return language==='ru'?ru:en;}
export function messages(language:string):Messages {return locale(language).messages;}
function interpolate(template:string,values:Record<string,string|number>):string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(placeholder,key:string)=>String(values[key]??placeholder));
}
export function diagnosticMessage(diagnostic:Diagnostic,language:string):string {
  const text=locale(language).diagnostics;
  const reasons={'pattern':text.pattern,'escape':text.escape,'include-read':text.includeRead,'multiple-include':text.multipleInclude,'include-syntax':text.includeSyntax,'line-too-long':text.lineTooLong};
  // The parser reports the caller of #include, not its unreadable target.
  const source=diagnostic.isRoot===true?locale(language).settings.rulesLabel:diagnostic.source;
  return interpolate(text.location,{source,line:diagnostic.line,reason:reasons[diagnostic.code]});
}
export function settingsErrorMessages(error:SettingsError,language:string):string[] {
  if(error.code==='rules' && error.diagnostics?.length)return error.diagnostics.map(diagnostic=>diagnosticMessage(diagnostic,language));
  const text=locale(language).errors;
  const errors={read:text.read,json:text.json,schema:text.schema,rules:text.rules,write:locale(language).messages.saveError,timeout:text.timeout,cancelled:text.cancelled};
  return [errors[error.code]];
}
