// SDK/DOM boundary doubles. These verify plugin code, not native Obsidian UI.
export const uiSdk = `
export class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this.classes=new Set();this.value='';this.disabled=false;this._text='';}
  createEl(tag,options={}){const el=new Element(tag);el._text=options.text||'';if(options.cls)el.addClass(options.cls);Object.assign(el.attributes,options.attr||{});this.children.push(el);return el;}
  empty(){this.children=[];this._text='';}
  setText(text){this._text=text;}
  setAttr(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  addClass(...names){for(const name of names)this.classes.add(name);}
  removeClass(...names){for(const name of names)this.classes.delete(name);}
  get textContent(){return this._text+this.children.map(el=>el.textContent).join(' ');}
  set textContent(text){this._text=text;this.children=[];}
  descendants(){return this.children.flatMap(el=>[el,...el.descendants()]);}
}
export class Plugin {constructor(app){this.app=app;this.settingTabs=[];}addSettingTab(tab){this.settingTabs.push(tab);}}
export class PluginSettingTab {constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=new Element();}}
export class Component {load(){this.loaded=true;}unload(){this.loaded=false;this.unloaded=true;}}
export class Modal {
  constructor(app){this.app=app;this.contentEl=new Element();this.modalEl=new Element();this.titleEl=new Element();}
  setTitle(title){this.titleEl.setText(title);return this;}
  open(){this.opened=true;(globalThis.__sieveModals??=[]).push(this);this.rendered=Promise.resolve(this.onOpen());}
  close(){this.opened=false;this.onClose();}
  onOpen(){}onClose(){}
}
export class TextComponent {
  constructor(el,tag='input'){this.inputEl=el.createEl(tag);}
  setValue(value){this.inputEl.value=value;return this;}setDisabled(value){this.inputEl.disabled=value;return this;}
  onChange(callback){this.inputEl.change=value=>{if(!this.inputEl.disabled){this.inputEl.value=value;callback(value);}};return this;}
}
export class TextAreaComponent extends TextComponent{constructor(el){super(el,'textarea');}}
export class ButtonComponent {
  constructor(el){this.buttonEl=el.createEl('button');}
  setButtonText(value){this.buttonEl.setText(value);return this;}setCta(){return this;}
  setDisabled(value){this.buttonEl.disabled=value;return this;}
  onClick(callback){this.buttonEl.click=()=>this.buttonEl.disabled?undefined:callback();return this;}
}
export class Setting {
  constructor(el){this.settingEl=el.createEl('div');this.nameEl=this.settingEl.createEl('div');this.descEl=this.settingEl.createEl('div');this.controlEl=this.settingEl.createEl('div');}
  setName(value){this.nameEl.setText(value);return this;}setDesc(value){this.descEl.setText(value);return this;}
  setClass(value){this.settingEl.addClass(value);return this;}
  addText(callback){callback(new TextComponent(this.controlEl));return this;}
  addTextArea(callback){callback(new TextAreaComponent(this.controlEl));return this;}
  addButton(callback){callback(new ButtonComponent(this.controlEl));return this;}
}
export class MarkdownRenderer {static async render(app,markdown,el,path,component){el.setText(markdown);(globalThis.__sieveRenders??=[]).push({markdown,path,component});}}
export const Platform={isDesktopApp:true,isWin:false,isMacOS:false,isLinux:true};
export function getLanguage(){return globalThis.__sieveTestLanguage||'en';}
export class Notice{constructor(message){(globalThis.__sieveTestNotices??=[]).push(message);}}
`;

export function element(root,tag,text){return root.descendants().find(el=>el.tag===tag&&(text===undefined||el.textContent===text));}
export function resetUi(){globalThis.__sieveModals=[];globalThis.__sieveRenders=[];globalThis.__sieveTestNotices=[];globalThis.__sieveTestLanguage='en';}
