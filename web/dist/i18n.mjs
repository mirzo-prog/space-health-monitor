import {languageMessages} from './language-messages.mjs';
const supportedLanguages=new Set(['ru','uz','en']);
let currentLanguage='ru';
const messagesBySource=new Map(languageMessages.map(([source,en,uz])=>[source,{en,uz}]));
const translationPattern=new RegExp([...messagesBySource.keys()].sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
const languageLetter=/\p{L}/u;
export function getUILanguage(){return currentLanguage;}
export function setUILanguage(language){if(!supportedLanguages.has(language))return false;currentLanguage=language;return true;}
export function translateText(value,language=currentLanguage){
 if(value===null||value===undefined)return '';
 const source=String(value);if(language==='ru'||!supportedLanguages.has(language))return source;
 const exact=messagesBySource.get(source);if(exact)return exact[language];
 const trimmed=source.trim(),trimmedMatch=messagesBySource.get(trimmed);if(trimmedMatch)return source.replace(trimmed,trimmedMatch[language]);
 return source.replace(translationPattern,(match,offset,text)=>{if(languageLetter.test(match[0])&&offset>0&&languageLetter.test(text[offset-1]))return match;const end=offset+match.length;if(languageLetter.test(match.at(-1))&&end<text.length&&languageLetter.test(text[end]))return match;return messagesBySource.get(match)[language];});
}
export class LanguageSettings{
 constructor(onChange=()=>{}){
  this.select=document.getElementById('language-select');this.onChange=onChange;this.texts=new WeakMap();this.attributes=new WeakMap();
  try{this.storage=window.localStorage;const saved=this.storage?.getItem('alpha-ui-language-v1');if(supportedLanguages.has(saved))setUILanguage(saved);}catch{}
  this.select.value=currentLanguage;this.select.addEventListener('change',()=>this.change(this.select.value));
  this.apply(document.body);
  if(typeof MutationObserver!=='undefined'){
   this.observer=new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')this.text(record.target);else if(record.type==='attributes')this.attribute(record.target,record.attributeName);else for(const node of record.addedNodes)this.apply(node);}});
   this.observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']});
  }
  if(document.documentElement)document.documentElement.lang=currentLanguage;
 }
 excluded(element){return !element||!!element.closest?.('script,style,textarea,code,pre,#language-control,[data-no-translate],#session-name,#crew-name,#pin-person,.crew-name-button,.profile-card strong,.report-member h3');}
 text(node){
  if(node.nodeType!==3||this.excluded(node.parentElement))return;
  const value=node.nodeValue;if(!value?.trim())return;
  let entry=this.texts.get(node);if(!entry||value!==entry.rendered&&value!==entry.source)entry={source:value};
  const rendered=translateText(entry.source);entry.rendered=rendered;this.texts.set(node,entry);if(value!==rendered)node.nodeValue=rendered;
 }
 attribute(element,name){
  if(this.excluded(element)&&element.tagName!=='TEXTAREA'||!element.hasAttribute?.(name))return;
  const value=element.getAttribute(name);let entries=this.attributes.get(element);if(!entries){entries={};this.attributes.set(element,entries);}let entry=entries[name];if(!entry||value!==entry.source&&value!==entry.rendered)entry={source:value};entry.rendered=translateText(entry.source);entries[name]=entry;if(value!==entry.rendered)element.setAttribute(name,entry.rendered);
 }
 apply(root){
  if(!root||!document.createTreeWalker)return;
  if(root.nodeType===3){this.text(root);return;}
  if(root.nodeType!==1||this.excluded(root))return;
  for(const name of ['title','placeholder','aria-label'])this.attribute(root,name);
  const walker=document.createTreeWalker(root,4);let text;while(text=walker.nextNode())this.text(text);
  for(const element of root.querySelectorAll('[title],[placeholder],[aria-label]'))for(const name of ['title','placeholder','aria-label'])this.attribute(element,name);
 }
 change(language){
  if(!setUILanguage(language))return false;
  this.select.value=language;if(document.documentElement)document.documentElement.lang=language;
  try{this.storage?.setItem('alpha-ui-language-v1',language);}catch{}
  this.apply(document.body);this.onChange(language);return true;
 }
}
