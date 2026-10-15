import type {CacheEntry,FilterInstallation,FilterOptions,HostMethod,RuntimeApp,RuntimePhase} from './contracts.ts';
import {method} from './contracts.ts';
import {capabilities} from './capabilities.ts';
import {installProjection} from './projection.ts';
import {hostKey,hostClean,matchPath,parentPath,within} from './paths.ts';
import type {Matcher,Platform} from '../core/types.ts';

export function installFilter(app:RuntimeApp,matcher:Matcher,platform:Platform,options:FilterOptions={}):FilterInstallation {
  let active=true;let phase:RuntimePhase='pending';let started=false;let completed=false;let listed=false;let listCompleted=false;let layout=app.workspace?.layoutReady===true;
  // Rules and platform are immutable for this installation. Keep exact real
  // paths distinct (including case/NBSP), and bound retained decisions by FIFO.
  const decisions=new Map<string,ReturnType<Matcher['match']>>();
  const restores:(()=>void)[]=[];
  const notify=():void=>{try{options.onChange?.();}catch{/* Status observers never own filesystem control flow. */}};
  const deactivate=(next:RuntimePhase):void=>{if(!active)return;active=false;phase=next;decisions.clear();for(const restore of restores.reverse())try{restore();}catch{/* A foreign descriptor may prevent restoration; retained own guards are inert. */}notify();};
  const dispose=():void=>deactivate('disposed');
  const result=(status:FilterInstallation['status'],reloadNeeded=false):FilterInstallation=>({get status(){return phase==='error'?'error':status;},get phase(){return phase;},get reloadNeeded(){return reloadNeeded||phase==='error';},get initialStarted(){return started;},get initialCompleted(){return completed;},get layoutReady(){return layout;},dispose});
  const mobile=platform==='android'||platform==='ios';
  let checked:ReturnType<typeof capabilities>;try{checked=capabilities(app,mobile);}catch{phase='error';active=false;return result('error',true);}if(!checked)return result('unsupported',true);
  if(layout)return result('ready',true);
  const adapter=checked.adapter;const config=hostKey(app.vault.configDir);const kept=new Set<string>();const counts=new Map<string,number>();const dirty=new Set<string>();
  const cached=(key:string):CacheEntry|undefined=>Object.prototype.hasOwnProperty.call(adapter.files,key)?adapter.files[key]:undefined;
  let projection:ReturnType<typeof installProjection>;
  let renamesInFlight=0;
  const changed=():void=>{if(active && phase!=='error' && started && completed && listed && listCompleted && layout)phase='applied';if(active)notify();};
  const failed=():void=>deactivate('error');
  const decide=(real:string)=>{
    const previous=decisions.get(real);if(previous)return previous;
    const path=hostClean(real);if(path==='/'||within(hostKey(path),config))return {ignored:false,canSkipDir:false};
    const decision=matcher.match(matchPath(path,platform));
    if(decisions.size>=8192)decisions.delete(decisions.keys().next().value!);
    decisions.set(real,decision);return decision;
  };
  const realFor=(key:string):string=>cached(key)?.realpath??key;
  const mark=(key:string,add:boolean):void=>{
    if(key==='/' || (add?kept.has(key):!kept.has(key)))return;
    if(add)kept.add(key);else kept.delete(key);
    for(let current=key;current;current=parentPath(current)){const count=(counts.get(current)??0)+(add?1:-1);if(count>0)counts.set(current,count);else counts.delete(current);}
  };
  const dirtyParents=(key:string):void=>{for(let current=key;current;current=parentPath(current))dirty.add(current);};
  const forget=(key:string):void=>{const entry=cached(key);if(key==='/' || !entry || (entry.type==='folder' && (counts.get(key)??0)>0))return;projection.hide(key);};
  const cleanDirty=(withinRename=false):void=>{
    if(!active || (renamesInFlight>0 && !withinRename))return;
    const keys=[...dirty].sort((a,b)=>b.split('/').length-a.split('/').length);dirty.clear();
    for(const key of keys)if(cached(key) && decide(realFor(key)).ignored)forget(key);
  };
  let cleanupQueued=false;
  const laterCleanup=():void=>{if(cleanupQueued)return;cleanupQueued=true;void Promise.resolve().then(()=>{cleanupQueued=false;try{cleanDirty();}catch{failed();}});};
  const ensureParents=(real:string):void=>{
    const parents:string[]=[];for(let p=parentPath(hostClean(real));p;p=parentPath(p))parents.push(p);
    for(const p of parents.reverse()){const key=hostKey(p);if(!projection.indexed(key)){if(!cached(key))Object.defineProperty(adapter.files,key,{value:{type:'folder',realpath:p},configurable:true,writable:true,enumerable:true});if(!projection.restoreParent(key))method(adapter,'trigger').call(adapter,'folder-created',key);}if(decide(p).ignored)dirty.add(key);}
  };
  const observe=(value:unknown,success:()=>void):unknown=>{
    const finish=():void=>{if(active)try{success();}catch{failed();}};
    if(value && typeof (value as PromiseLike<unknown>).then==='function')void Promise.resolve(value).then(finish,failed);
    else finish();return value;
  };
  function wrap(owner:object,key:string,body:(original:HostMethod,args:unknown[])=>unknown,nativeFailureFatal=true):void {
    const original=method(owner,key);const descriptor=Object.getOwnPropertyDescriptor(owner,key);
    const wrapper:HostMethod=function(...args){
      if(!active || this!==owner)return original.apply(this,args);
      let nativeThrew=false;let nativeError:unknown;
      const guardedOriginal:HostMethod=function(...values){try{return original.apply(this,values);}catch(error){nativeThrew=true;nativeError=error;throw error;}};
      try{const value=body.call(this,guardedOriginal,args);return nativeFailureFatal?observe(value,()=>{}):value;}
      catch(error){if(nativeFailureFatal || !nativeThrew || error!==nativeError)failed();throw error;}
    };
    Object.defineProperty(owner,key,{configurable:true,writable:true,enumerable:descriptor?.enumerable??true,value:wrapper});
    restores.push(()=>{if(Object.getOwnPropertyDescriptor(owner,key)?.value!==wrapper)return;if(descriptor)Object.defineProperty(owner,key,descriptor);else delete (owner as Record<string,unknown>)[key];});
  }
  try {
    projection=installProjection(app,adapter,real=>decide(real).ignored,wrap,()=>cleanDirty(true),failed);
    restores.push(()=>projection.dispose());
    wrap(adapter,'trigger',function(original,args){
      const [type,keyValue,oldValue]=args;const key=typeof keyValue==='string'?keyValue:'';const old=typeof oldValue==='string'?oldValue:'';const decision=decide(realFor(key));
      if(type==='raw' && decision.ignored)return;
      if((type==='file-created'||type==='modified') && decision.ignored){if(type==='modified')projection.modified(key,args[3]);mark(key,false);forget(key);return;}
      if(type==='file-created'||type==='folder-created'){if(!decision.ignored){ensureParents(realFor(key));mark(key,true);}else dirty.add(key);}
      const restored=type==='renamed'?projection.restore(old):undefined;
      if(type==='file-removed'||type==='folder-removed')projection.restore(key);
      if(type==='renamed' && !decision.ignored)ensureParents(realFor(key));
      if(type==='renamed'){mark(old,false);if(!decision.ignored)mark(key,true);dirtyParents(old);dirtyParents(key);}
      const returned=original.apply(adapter,args);
      if(type==='renamed'){if(!decision.ignored && restored)projection.compute(key);laterCleanup();}
      if(type==='file-removed'||type==='folder-removed'){mark(key,false);dirtyParents(parentPath(key));laterCleanup();}
      return returned;
    });
    for(const key of ['listRecursiveChild',...(mobile?['quickList']:[])])wrap(adapter,key,function(original,args){
      const parent=typeof args[0]==='string'?args[0]:'';const entry=args[1];
      const name=mobile&&entry&&typeof entry==='object'?(entry as Record<string,unknown>).name:entry;
      if(typeof name!=='string')throw Error('Unsupported adapter entry signature');
      const real=parent?parent+'/'+name:name;const decision=decide(real);
      if(decision.ignored && (decision.canSkipDir || (mobile && (entry as Record<string,unknown>).type==='file'))){forget(hostKey(real));return Promise.resolve();}
      return original.apply(adapter,args);
    });
    for(const key of ['reconcileFile',...(!mobile?['reconcileFileInternal']:[])])wrap(adapter,key,function(original,args){
      const real=typeof args[0]==='string'?args[0]:'';const normalized=typeof args[1]==='string'?args[1]:hostKey(real);const decision=decide(real);
      if(decision.ignored && !projection.has(normalized) && (decision.canSkipDir || cached(normalized)?.type==='file')){mark(normalized,false);forget(normalized);return Promise.resolve();}
      // Keep native reconcileFile's ENOENT recovery for traversable containers.
      // They can disappear between watcher notification and lstat, even when
      // their allowed descendants previously kept them in the projection.
      return original.apply(adapter,args);
    // Native reconcileFile handles inner ENOENT itself; traversal failures still
    // reach the guarded caller. Own filtering errors always deactivate hooks.
    },key!=='reconcileFileInternal');
    for(const key of ['reconcileFileCreation',...(mobile?['reconcileFileChanged']:[])])wrap(adapter,key,function(original,args){
      const real=typeof args[0]==='string'?args[0]:'';const normalized=typeof args[1]==='string'?args[1]:hostKey(real);
      if(decide(real).ignored){mark(normalized,false);return original.apply(adapter,args);}
      ensureParents(real);return original.apply(adapter,args);
    });
    wrap(adapter,'reconcileFolderCreation',function(original,args){
      const real=typeof args[0]==='string'?args[0]:'';const key=typeof args[1]==='string'?args[1]:hostKey(real);const decision=decide(real);
      if(decision.ignored && decision.canSkipDir){forget(key);return Promise.resolve();}
      ensureParents(real);return observe(original.apply(adapter,args),()=>{if(decision.ignored){dirty.add(key);cleanDirty();}});
    });
    wrap(adapter,'listRecursive',function(original,args){
      const real=typeof args[0]==='string'?args[0]:'';const decision=decide(real);
      if(decision.ignored && decision.canSkipDir){forget(hostKey(real));return Promise.resolve();}
      return observe(original.apply(adapter,args),()=>{if(decision.ignored){dirty.add(hostKey(real));cleanDirty();}});
    });
    wrap(adapter,'rename',function(original,args){
      renamesInFlight++;
      const finish=():void=>{renamesInFlight--;try{cleanDirty();}catch{failed();}};
      let value:unknown;try{value=original.apply(adapter,args);}catch(error){finish();throw error;}
      if(value && typeof (value as PromiseLike<unknown>).then==='function')void Promise.resolve(value).then(finish,finish);else finish();
      return value;
    // A normal denied user rename is not a filter failure. Projection callbacks
    // and cleanup keep their own fatal-error handling; the user operation is not retried.
    },false);
    const root=mobile?'watchAndList':'listAll';
    wrap(adapter,root,function(original,args){
      const initial=!listed;listed=true;kept.clear();counts.clear();dirty.clear();
      let value:unknown;
      if(mobile)value=(async()=>{
        try{adapter.files={'/':{type:'folder',realpath:'/'}};projection.retainCache();await method(adapter.fs!,'watch').call(adapter.fs!,adapter.basePath);await method(adapter,'listRecursive').call(adapter,'');}
        catch{
          // Recovery is explicitly unfiltered: restore every own hook before
          // allowing the host's normal bulk/fallback path. Never claim applied.
          if(active)deactivate('error');
          await original.apply(adapter,args);
        }
      })();
      else value=original.apply(adapter,args);
      return observe(value,()=>{projection.retainCache();if(initial)listCompleted=true;cleanDirty();changed();});
    });
    wrap(app.vault,'load',function(original,args){
      const initial=!started;started=true;let value:unknown;
      try{value=original.apply(app.vault,args);}catch(error){failed();throw error;}
      return observe(value,()=>{if(initial)completed=true;changed();});
    });
    app.workspace.onLayoutReady(()=>{if(active){layout=true;changed();}});
    return result('ready');
  }catch{dispose();phase='error';return result('error',true);}
}
