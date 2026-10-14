// Models the native handler's timing and contracts; this is not native UI evidence.
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
export const config=displayName=>JSON.stringify({schemaVersion:1,rules:'[ not compiled for another vault',displayName});
export const vaults=()=>[
  {id:'0000000000000001',path:'/one/Shared',name:'Shared',isCurrentVault:true},
  {id:'0000000000000002',path:'/two/Shared',name:'Shared',isCurrentVault:false},
];

class FakeMouse {
  constructor(type,options={}){Object.assign(this,{type,button:0,bubbles:true,cancelable:true,defaultPrevented:false,buttons:1,detail:1},options);}
  preventDefault(){this.defaultPrevented=true;}stopImmediatePropagation(){this.stopped=true;}
}
class Element {
  constructor(document,kind,text=''){this.ownerDocument=document;this.kind=kind;this.textContent=text;this.isConnected=true;this.handlers=[];}
  closest(selector){return selector==='.workspace-drawer-vault-switcher' && this.kind==='switcher'?this:undefined;}
  dispatchEvent(event){event.target=this;const doc=this.ownerDocument;for(const [callback,capture] of doc.handlers)if(capture){callback(event);if(event.stopped)return false;}
    for(const callback of this.handlers){callback(event);if(event.stopped)return false;}
    for(const [callback,capture] of doc.handlers)if(!capture){callback(event);if(event.stopped)return false;}return !event.defaultPrevented;}
  click(){const event=new FakeMouse('click');this.dispatchEvent(event);return event;}
}
export class Document {
  constructor(){this.title='Note - Shared - Obsidian 1.14.4';this.handlers=[];this.label=new Element(this,'name','Shared');this.switcher=new Element(this,'switcher');this.defaultView={MouseEvent:FakeMouse};}
  querySelectorAll(selector){return selector==='.workspace-drawer-vault-name'?[this.label]:[];}querySelector(){return undefined;}
  addEventListener(type,callback,capture=false){if(type==='click')this.handlers.push([callback,capture]);}
  removeEventListener(type,callback){this.handlers=this.handlers.filter(entry=>entry[0]!==callback);}
}

export function aliasHost({nativeMenu=false,loadGate}={}){
  const doc=new Document(),list=vaults(),reads=[],menus=[],selected=[];let name='Current alias';
  const app={appId:list[0].id,title:'Shared - Obsidian 1.14.4',vault:{configDir:'.custom',getName:()=> 'Shared'},commands:{commands:{}},workspace:{onLayoutReady(){}},getAppTitle(note){return note?note+' - '+this.title:this.title;}};
  const provider={list:()=>list,async read(vault){reads.push(vault.path);return config('Other alias');}};
  const eventMenus=new WeakMap();
  class Menu {
    static forEvent(event){event.preventDefault();let menu=eventMenus.get(event);if(!menu){menu=new Menu();eventMenus.set(event,menu);menus.push(menu);setTimeout(()=>{menu.shown=true;menu.converted=menu.items.map(item=>item.titleEl?.textContent);},0);}return menu;}
    constructor(){this.items=[];this.useNativeMenu=nativeMenu;}
    hide(){this.shown=false;return this;}
  }
  doc.switcher.handlers.push(event=>{const menu=Menu.forEvent(event);for(const v of list)menu.items.push({titleEl:{textContent:v.name},checked:v.isCurrentVault,callback:()=>selected.push(v.path),setTitle(value){this.titleEl.textContent=value;return this;}});menu.items.push({separator:true});menu.items.push({titleEl:{textContent:'Manage vaults'},callback:()=>selected.push('manage'),setTitle(value){this.titleEl.textContent=value;}});});
  const modalItems=()=>list.map(({id,...v})=>({...v}));const modals=[];
  class FuzzySuggestModal {constructor(){this.app=app;this.items=[];this.updates=0;}open(){this.opened=true;this.onOpen();modals.push(this);return this;}close(){this.opened=false;}}
  class NativeChooser extends FuzzySuggestModal {
    onOpen(){this.loadVaults();}
    loadVaults(){if(loadGate)return loadGate.promise.then(()=>{this.items.push(...modalItems());this.updateSuggestions();});this.items.push(...modalItems());this.updateSuggestions();}
    getItemText(item){return item.name;}
    updateSuggestions(){this.updates++;this.search=this.items.map(item=>this.getItemText(item));}
    onChooseItem(item){selected.push(item.path);}
  }
  for(const id of ['app:switch-vault','app:open-another-vault'])app.commands.commands[id]={callback:function(){return new NativeChooser().open();}};
  return{app,doc,list,provider,reads,menus,selected,modals,sdk:{Menu,FuzzySuggestModal},NativeChooser,current:()=>name,setCurrent(value){name=value;}};
}
