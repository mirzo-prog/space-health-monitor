// Local calendar-day records for this educational simulator. No invented history.
export function localDay(date=new Date()){
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDay(day){if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const [y,m,d]=day.split('-').map(Number),date=new Date(y,m-1,d,12);return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;}
export function validateExam(record){
 if(!record||typeof record.memberId!=='string'||typeof record.name!=='string'||!record.name.trim()||!validDay(record.day))throw Error('Некорректная дата или участник осмотра.');
 const ranges={heart_rate:[20,220],spO2:[50,100],radiation_level:[0,100],fatigue:[0,100],dose:[0,10000]};
 for(const [key,[min,max]]of Object.entries(ranges)){const value=key in (record.values||{})?record.values[key]:record[key];if(!Number.isFinite(value)||value<min||value>max)throw Error(`Проверьте поле ${key}: допустимо ${min}–${max}.`);}
 if(typeof record.trusted!=='boolean'||!['manual','simulation'].includes(record.source))throw Error('Укажите источник и достоверность измерений.');
 if(!Array.isArray(record.symptoms)||record.symptoms.some(s=>!s||typeof s.text!=='string'||typeof s.severe!=='boolean'))throw Error('Некорректные жалобы.');
 return record;
}
export function validateDailyPlan(plan){
 const taskSizes={eva:2,repair:1,research:1,evacuation:2};
 if(!plan||!validDay(plan.day)||!Array.isArray(plan.rows)||plan.rows.length>24)throw Error('Некорректный дневной план.');
 const hours=new Set();
 for(const row of plan.rows){
  if(!row||!Object.hasOwn(taskSizes,row.taskId)||!Number.isInteger(row.hour)||row.hour<0||row.hour>23||hours.has(row.hour)||!['planned','blocked'].includes(row.status)||!Array.isArray(row.ids)||typeof row.reason!=='string'||!Array.isArray(row.comparison))throw Error('Некорректная строка дневного плана.');
  hours.add(row.hour);
  if(row.status==='planned'&&(row.ids.length!==taskSizes[row.taskId]||row.ids.some(id=>typeof id!=='string')||typeof row.reserveId!=='string'||new Set([...row.ids,row.reserveId]).size!==row.ids.length+1))throw Error('Некорректная группа или резерв дневного плана.');
  for(const c of row.comparison)if(typeof c.id!=='string'||typeof c.name!=='string'||typeof c.eligible!=='boolean'||!Number.isFinite(c.score)||!Array.isArray(c.reasons)||c.reasons.some(r=>typeof r!=='string'))throw Error('Некорректное сравнение экипажа в плане.');
 }
 return plan;
}
export function validateExposureLedger(ledger){
 if(!ledger||typeof ledger!=='object'||Array.isArray(ledger))throw Error('Некорректный журнал радиационной дозы.');
 for(const [id,e]of Object.entries(ledger))if(!/^c[1-4]$/.test(id)||!e||!Number.isFinite(e.dose)||e.dose<0||!Number.isFinite(e.unknownSeconds)||e.unknownSeconds<0||!e.watch||typeof e.watch.active!=='boolean'||typeof e.watch.doseHold!=='boolean'||!Number.isFinite(e.watch.normalSamples)||e.watch.normalSamples<0)throw Error('Некорректные данные накопленной дозы.');
 return ledger;
}
export class DailyMedicalBook{
 constructor(storage,roster,clock=()=>new Date()){
  this.storage=storage;this.key='alpha-daily-medical-v1:'+encodeURIComponent(roster);this.clock=clock;this.exams=[];this.plans={};this.exposures={};this.warning='';this.persistent=!!storage;this.load();
 }
 today(){return localDay(this.clock());}
 load(){
  if(!this.storage){this.persistent=false;this.warning='Хранилище браузера недоступно. Данные сохранятся только до закрытия страницы; скачайте архив.';return;}
  try{const raw=this.storage.getItem(this.key);if(!raw)return;const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.exams)||!data.plans||typeof data.plans!=='object'||Array.isArray(data.plans))throw Error('Неизвестный формат архива.');const seen=new Set();for(const exam of data.exams){validateExam(exam);const key=exam.day+':'+exam.memberId;if(seen.has(key))throw Error('Повторный осмотр в архиве.');seen.add(key);}for(const [day,plan]of Object.entries(data.plans)){validateDailyPlan(plan);if(day!==plan.day)throw Error('Дата плана не совпадает с ключом архива.');}this.exams=data.exams;this.plans=data.plans;this.exposures=validateExposureLedger(data.exposures||{});}
  catch(error){this.warning='Не удалось прочитать сохранённый журнал: '+error.message;this.persistent=false;this.storageCorrupt=true;}
 }
 persist(){
  if(this.storageCorrupt){this.persistent=false;this.warning='Сохранённый архив повреждён и не перезаписан. Новые записи доступны в этой вкладке; скачайте их.';return false;}
  try{if(!this.storage)throw Error('Хранилище недоступно');this.storage.setItem(this.key,JSON.stringify({version:1,exams:this.exams,plans:this.plans,exposures:this.exposures}));this.persistent=true;this.warning='';return true;}
  catch{this.persistent=false;this.warning='Браузер не сохранил изменения. Они доступны в этой вкладке; скачайте архив медосмотров.';return false;}
 }
 get(day,id){return this.exams.find(e=>e.day===day&&e.memberId===id)||null;}
 history(id){return this.exams.filter(e=>e.memberId===id).sort((a,b)=>a.day.localeCompare(b.day));}
 record(day,member,data){
  if(!validDay(day)||day>this.today())throw Error('Осмотр можно записать только за существующий день, не позже сегодняшнего.');
  if(this.get(day,member.id))throw Error('Осмотр этого космонавта за выбранный день уже записан. Повторная запись запрещена.');
  const exam=validateExam({day,memberId:member.id,name:member.name,values:{...data.values},fatigue:data.fatigue,dose:data.dose,trusted:data.trusted,symptoms:structuredClone(data.symptoms||[]),source:data.source,notes:String(data.notes||'').slice(0,500),recordedAt:this.clock().toISOString()});
  const history=this.history(member.id),previous=history.filter(e=>e.day<day).at(-1),next=history.find(e=>e.day>day);
  if(previous&&exam.dose<previous.dose||next&&exam.dose>next.dose)throw Error('Накопленная доза должна сохраняться или увеличиваться по датам; её нельзя обнулить отдыхом.');
  this.exams.push(exam);this.persist();return structuredClone(exam);
 }
 comparison(day,id){
  const current=this.get(day,id),previous=this.history(id).filter(e=>e.day<day).at(-1)||null;
  if(!current||!previous)return {current,previous,delta:null};
  return {current,previous,delta:{heart_rate:+(current.values.heart_rate-previous.values.heart_rate).toFixed(1),spO2:+(current.values.spO2-previous.values.spO2).toFixed(1),radiation_level:+(current.values.radiation_level-previous.values.radiation_level).toFixed(3),fatigue:+(current.fatigue-previous.fatigue).toFixed(1),dose:+(current.dose-previous.dose).toFixed(4)}};
 }
 updateExposure(members){
  for(const m of members){const old=this.exposures[m.id];this.exposures[m.id]={dose:Math.max(old?.dose||0,m.dose),unknownSeconds:Math.max(old?.unknownSeconds||0,m.unknownDoseSeconds||0),watch:structuredClone(m.radiationWatch||{active:false,doseHold:false,normalSamples:0})};}
  this.persist();
 }
 savePlan(day,plan){validateDailyPlan(plan);if(!validDay(day)||!plan||plan.day!==day)throw Error('Некорректный дневной план.');this.plans[day]=structuredClone(plan);this.persist();}
 export(){return {version:1,rosterKey:this.key,exams:structuredClone(this.exams),plans:structuredClone(this.plans),exposures:structuredClone(this.exposures)};}
 import(data){
  if(data?.version!==1||data.rosterKey!==this.key||!Array.isArray(data.exams)||!data.plans||typeof data.plans!=='object'||Array.isArray(data.plans))throw Error('Архив относится к другому экипажу или имеет неверный формат.');
  for(const [day,plan]of Object.entries(data.plans)){validateDailyPlan(plan);if(day!==plan.day)throw Error('Дата плана не совпадает с ключом архива.');}
  const importedExposure=validateExposureLedger(data.exposures||{});
  const merged=structuredClone(this.exams),seen=new Map(merged.map(e=>[e.day+':'+e.memberId,e]));
  for(const entry of data.exams){const exam=validateExam(entry);if(exam.day>this.today())throw Error('В архиве есть осмотр из будущего.');const key=exam.day+':'+exam.memberId;if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(exam))throw Error('Конфликт: за этот день уже есть другой осмотр.');}else{const copy=structuredClone(exam);merged.push(copy);seen.set(key,copy);}}
  for(const id of new Set(merged.map(e=>e.memberId))){const history=merged.filter(e=>e.memberId===id).sort((a,b)=>a.day.localeCompare(b.day));if(history.some((e,i)=>i&&e.dose<history[i-1].dose))throw Error('В архиве накопленная доза уменьшается по датам.');}
  this.exams=merged;for(const [id,entry]of Object.entries(importedExposure)){const old=this.exposures[id];if(!old||entry.dose>old.dose)this.exposures[id]=structuredClone(entry);else if(entry.watch?.doseHold){this.exposures[id].watch={active:true,doseHold:true,normalSamples:0};}}for(const [day,plan]of Object.entries(data.plans)){if(validDay(day)&&plan?.day===day&&!Object.hasOwn(this.plans,day))this.plans[day]=structuredClone(plan);}this.persist();
 }
}
