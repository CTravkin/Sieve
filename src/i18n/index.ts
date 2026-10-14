import en from '../locales/en.json';
import ru from '../locales/ru.json';
export type Messages=typeof en.messages;
export function messages(language:string):Messages {return language==='ru'?ru.messages:en.messages;}
