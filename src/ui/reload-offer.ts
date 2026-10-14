import {Modal,Setting,getLanguage} from 'obsidian';
import type {App} from 'obsidian';
import {locale} from '../i18n/index.ts';

export class ReloadOfferModal extends Modal {
  constructor(app:App,private readonly reload:()=>void){super(app);}
  onOpen():void {
    const text=locale(getLanguage()).reload;
    this.setTitle(text.title);this.contentEl.createEl('p',{text:text.description});
    new Setting(this.contentEl)
      .addButton(button=>button.setButtonText(text.later).onClick(()=>this.close()))
      .addButton(button=>button.setButtonText(text.reload).setCta().onClick(()=>{this.close();this.reload();}));
  }
  onClose():void {this.contentEl.empty();}
}
