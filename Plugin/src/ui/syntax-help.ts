// SPDX-License-Identifier: MPL-2.0
import {Component,MarkdownRenderer,Modal,Setting,getLanguage} from 'obsidian';
import type {App} from 'obsidian';
import english from '../../../Docs/Syntax.en.md';
import russian from '../../../Docs/Syntax.ru.md';
import {locale} from '../i18n/index.ts';

/** Keep the syntax introduction; omit the duplicate title and repository navigation. */
export function syntaxHelp(language:string):string {
  const document=language==='ru'?russian:english;
  return document.replace(/^# [^\r\n]+\r?\n/,'').replace(/^\[Русский\]\(Syntax\.ru\.md\) · \[English\]\(Syntax\.en\.md\)\r?\n/m,'').trim();
}

export class SyntaxHelpModal extends Modal {
  private rendering?:Component;
  constructor(app:App){super(app);}
  async onOpen():Promise<void> {
    const language=getLanguage();const text=locale(language).help;
    this.setTitle(text.title);this.modalEl.addClass('sieve-syntax-modal');this.contentEl.empty();this.contentEl.addClass('sieve-syntax-content');
    const body=this.contentEl.createEl('div',{cls:'sieve-syntax-body markdown-rendered'});
    const rendering=new Component();this.rendering=rendering;rendering.load();
    new Setting(this.contentEl).setClass('sieve-syntax-footer').addButton(button=>button.setButtonText(text.close).onClick(()=>this.close()));
    try{await MarkdownRenderer.render(this.app,syntaxHelp(language),body,'',rendering);}
    catch{if(this.rendering===rendering)body.setText(text.renderError);}
    finally{if(this.rendering!==rendering){rendering.unload();body.empty();}}
  }
  onClose():void {this.rendering?.unload();this.rendering=undefined;this.contentEl.empty();}
}
