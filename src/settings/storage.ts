import {compileRules} from '../core/matcher.ts';
import {sha256} from '../core/normalize.ts';
import type {CompileResult,Diagnostic,Platform} from '../core/types.ts';
import {defaultSettings,parseSettings,parseSnapshot,sameSettings,encodeBytes,decodeBytes} from './model.ts';
import type {SieveSettings,WorkingSnapshot,CapturedInclude} from './model.ts';

export interface SettingsIO { exists(path:string):Promise<boolean>; read(path:string):Promise<string>; write(path:string,value:string):Promise<unknown> }
export interface SettingsError { readonly code:'read'|'json'|'schema'|'rules'|'write'|'timeout'|'cancelled'; readonly diagnostics?:readonly Diagnostic[] }
export interface SettingsState { readonly saved?:SieveSettings; readonly active?:SieveSettings; readonly draft:SieveSettings; readonly pending:boolean; readonly fallback:boolean; readonly activeRevision?:string; readonly error?:SettingsError }
interface Prepared { compiled:Extract<CompileResult,{ok:true}>; snapshot:WorkingSnapshot }
const sameIncludes=(a:WorkingSnapshot|undefined,b:WorkingSnapshot|undefined):boolean=>!!a && !!b && a.includes.length===b.includes.length && a.includes.every((entry,i)=>entry.path===b.includes[i]!.path && entry.contentBase64===b.includes[i]!.contentBase64);
export type StartupResult={ok:true;compiled:Prepared['compiled'];fallback:boolean}|{ok:false;error:SettingsError};
export type SaveResult={ok:true;changed:boolean;pending:boolean}|{ok:false;error:SettingsError};
interface Options { io:SettingsIO;configDir:string;platform:Platform;readInclude?:(path:string)=>Promise<string|Uint8Array>;timeoutMs?:number;onChange?:()=>void }
class Failure extends Error { constructor(readonly detail:SettingsError){super(detail.code);} }
const failure=(code:SettingsError['code']):Failure=>new Failure(Object.freeze({code}));
const safeError=(error:unknown,code:SettingsError['code']):SettingsError=>error instanceof Failure?error.detail:Object.freeze({code});

export class SettingsService {
  private saved?:SieveSettings;
  private savedSnapshot?:WorkingSnapshot;
  private currentFingerprint?:string;
  private readGeneration=0;
  private active?:Prepared;
  private working?:WorkingSnapshot;
  private draft:SieveSettings=defaultSettings();
  private pending=false;
  private fallback=false;
  private error?:SettingsError;
  private alive=true;
  private operations:Promise<unknown>=Promise.resolve();
  private readonly currentPath:string;
  private readonly previousPath:string;
  private readonly options:Options;
  constructor(options:Options) {
    this.options={...options};
    const folder=options.configDir.replace(/\/$/,'')+'/plugins/sieve/';
    this.currentPath=folder+'data.json';this.previousPath=folder+'data.previous.json';
  }
  get state():SettingsState {return Object.freeze({saved:this.saved,active:this.active?.snapshot.settings,draft:this.draft,pending:this.pending,fallback:this.fallback,activeRevision:this.active?.compiled.revision,error:this.error});}
  private changed():void {this.options.onChange?.();}
  private check():void {if(!this.alive)throw failure('cancelled');}
  private deadline():number {return performance.now()+(this.options.timeoutMs??10000);}
  private async wait<T>(operation:Promise<T>,deadline:number):Promise<T> {
    this.check();const remaining=deadline-performance.now();if(remaining<=0)throw failure('timeout');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {const result=await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(failure('timeout')),remaining);})]);this.check();return result;}
    finally {if(timer!==undefined)clearTimeout(timer);}
  }
  private async readJson(path:string,deadline:number):Promise<unknown> {
    try {
      if(!await this.wait(this.options.io.exists(path),deadline)){if(path===this.currentPath){this.currentFingerprint=undefined;this.readGeneration++;}return undefined;}
      const raw=await this.wait(this.options.io.read(path),deadline);if(path===this.currentPath){this.currentFingerprint=sha256(raw);this.readGeneration++;}
      try{return JSON.parse(raw) as unknown;}catch{throw failure('json');}
    }
    catch(error){throw new Failure(safeError(error,'read'));}
  }
  private async prepare(settings:SieveSettings,deadline:number,snapshot?:WorkingSnapshot):Promise<Prepared> {
    const includes:CapturedInclude[]=[];let cursor=0;let includeFailure:SettingsError|undefined;
    const result=await compileRules(settings.rules,{platform:this.options.platform,readInclude:async path=>{
      this.check();let content:string|Uint8Array;
      if(snapshot){const entry=snapshot.includes[cursor++];if(!entry || entry.path!==path)throw Error('Include snapshot mismatch');content=decodeBytes(entry.contentBase64);}
      else {if(!this.options.readInclude)throw Error('Include read unavailable');try{content=await this.wait(this.options.readInclude(path),deadline);}catch(error){if(error instanceof Failure)includeFailure=error.detail;throw Error('Include read failed');}}
      const bytes=typeof content==='string'?new TextEncoder().encode(content):new Uint8Array(content);
      includes.push(Object.freeze({path,contentBase64:encodeBytes(bytes)}));return bytes;
    }});
    this.check();
    if(includeFailure)throw new Failure(includeFailure);
    if(!result.ok)throw new Failure(Object.freeze({code:'rules',diagnostics:Object.freeze(result.diagnostics.map(d=>Object.freeze({source:d.source,isRoot:d.isRoot,line:d.line,code:d.code,reason:d.code==='include-read'?'Could not read included file':'Invalid filter rule'})))}));
    if(snapshot && cursor!==snapshot.includes.length)throw failure('schema');
    return {compiled:result,snapshot:Object.freeze({schemaVersion:1,settings,includes:Object.freeze(includes)})};
  }
  async startup():Promise<StartupResult> {
    const deadline=this.deadline();const previous=this.readJson(this.previousPath,deadline).then(value=>({value}),error=>({error}));
    try {
      const raw=await this.readJson(this.currentPath,deadline);
      try{this.saved=raw===undefined?defaultSettings():parseSettings(raw);}catch{throw failure('schema');}
      const prepared=await this.prepare(this.saved,deadline);this.active=prepared;this.savedSnapshot=prepared.snapshot;this.draft=this.saved;this.changed();return{ok:true,compiled:prepared.compiled,fallback:false};
    } catch(error) {
      this.error=safeError(error,'read');
      const backup=await previous;
      if(this.alive && 'value' in backup && backup.value!==undefined) {
        try {const snapshot=parseSnapshot(backup.value);const prepared=await this.prepare(snapshot.settings,deadline,snapshot);this.active=prepared;this.working=prepared.snapshot;this.draft=prepared.snapshot.settings;this.fallback=true;this.pending=true;this.changed();return{ok:true,compiled:prepared.compiled,fallback:true};}catch{/* Invalid fallback is never an empty matcher. */}
      }
      this.changed();return{ok:false,error:this.error};
    }
  }
  confirmActive():void {if(this.alive && this.active)this.working=this.active.snapshot;}
  setDraft(value:unknown):void {this.draft=parseSettings(value);this.changed();}
  private enqueue<T>(operation:()=>Promise<T>):Promise<T> {const result=this.operations.then(operation,operation);this.operations=result.catch(()=>undefined);return result;}
  save(value:unknown):Promise<SaveResult> {return this.enqueue(async()=>{
    try {
      this.check();let candidate:SieveSettings;try{candidate=parseSettings(value);}catch{throw failure('schema');}
      const deadline=this.deadline();const prepared=await this.prepare(candidate,deadline);
      if(sameSettings(candidate,this.saved) && sameIncludes(prepared.snapshot,this.savedSnapshot)){this.draft=candidate;this.changed();return{ok:true,changed:false,pending:this.pending};}
      if(this.working)await this.wait(this.options.io.write(this.previousPath,JSON.stringify(this.working)),deadline);
      this.check();await this.wait(this.options.io.write(this.currentPath,JSON.stringify(candidate)),deadline);
      this.saved=candidate;this.savedSnapshot=prepared.snapshot;this.currentFingerprint=sha256(JSON.stringify(candidate));this.draft=candidate;this.pending=this.fallback||!sameSettings(candidate,this.active?.snapshot.settings)||!sameIncludes(prepared.snapshot,this.active?.snapshot);this.error=undefined;this.changed();return{ok:true,changed:true,pending:this.pending};
    }catch(error){const detail=safeError(error,'write');this.error=detail;this.changed();return{ok:false,error:detail};}
  });}
  externalChange():Promise<SaveResult> {return this.enqueue(async()=>{
    const deadline=this.deadline();const previousFingerprint=this.currentFingerprint;const previousGeneration=this.readGeneration;let candidate:SieveSettings|undefined;let error:SettingsError|undefined;
    try{const raw=await this.readJson(this.currentPath,deadline);if(raw===undefined)throw failure('schema');try{candidate=parseSettings(raw);}catch{throw failure('schema');}}catch(e){error=safeError(e,'read');}
    if((this.readGeneration!==previousGeneration && previousFingerprint===this.currentFingerprint) || (candidate && sameSettings(candidate,this.saved)))return{ok:true,changed:false,pending:this.pending};
    let prepared:Prepared|undefined;
    try{this.check();if(this.working)await this.wait(this.options.io.write(this.previousPath,JSON.stringify(this.working)),deadline);if(candidate)prepared=await this.prepare(candidate,deadline);}catch(e){error=safeError(e,'write');}
    this.savedSnapshot=prepared?.snapshot;
    this.saved=candidate;this.draft=candidate??this.active?.snapshot.settings??defaultSettings();this.pending=true;this.error=error;this.changed();return error?{ok:false,error}:{ok:true,changed:true,pending:true};
  });}
  dispose():void {this.alive=false;}
}
