import {localDay} from './daily-medical.mjs';
// Synthetic educational rules only. Not a medical clearance model.
export const radiationRules={maxRate:5,doseHold:.1,stableSamples:5};
export function updateRadiationWatch(member){
 const old=member.radiationWatch||{active:false,normalSamples:0,doseHold:false};
 const highDose=member.dose>=radiationRules.doseHold;
 if(highDose||member.trusted&&member.values.radiation_level>radiationRules.maxRate){member.radiationWatch={active:true,doseHold:highDose||old.doseHold,normalSamples:0};}
 else if(old.active){const normal=member.trusted?old.normalSamples+1:0;member.radiationWatch={...old,normalSamples:normal,active:old.doseHold||normal<radiationRules.stableSamples};}
 else member.radiationWatch=old;
 return member.radiationWatch;
}
export const tasks={
 eva:{name:'Выход в открытый космос',duration:20,size:2,weights:{pulse:.2,oxygen:.5,radiation:.3},minOxygen:96,maxFatigue:65,doseBudget:.05,description:'Два участника выполняют осмотр внешнего корпуса; один остаётся в резерве.'},
 repair:{name:'Ремонт оборудования',duration:17,size:1,weights:{pulse:.5,oxygen:.3,radiation:.2},minOxygen:95,maxFatigue:75,doseBudget:.08,description:'Один участник ремонтирует систему жизнеобеспечения. Важны стабильный пульс и запас сил.'},
 research:{name:'Научный эксперимент',duration:16,size:1,weights:{pulse:.3,oxygen:.2,radiation:.5},minOxygen:94,maxFatigue:80,doseBudget:.1,description:'Один участник собирает образцы. Учитываются радиационная нагрузка и стабильность данных.'},
 evacuation:{name:'Аварийное возвращение',duration:18,size:2,weights:{pulse:.35,oxygen:.4,radiation:.25},minOxygen:95,maxFatigue:70,doseBudget:.08,description:'Два участника готовят эвакуационный модуль. Требуется резерв на станции.'}
};
export const missionScenarios={
 station:{name:'Ремонт орбитальной станции',description:'Работа на орбите: гипоксия, подмена пакетов, радиация и перегрузка канала.',preferred:'repair',events:[[10,'hypoxia',0],[25,'mitm',2],[40,'radiation',1],[55,'dos',2]]},
 surface:{name:'Исследование поверхности',description:'Выход группы: постепенное падение кислорода, неисправный датчик и радиационная вспышка.',preferred:'eva',events:[[10,'oxygen_trend',1],[29,'sensor',0],[46,'radiation',2],[62,'fatigue',1]]},
 emergency:{name:'Аварийное возвращение',description:'Подготовка к эвакуации при перегрузке канала, стрессе и потере кислорода.',preferred:'evacuation',events:[[9,'dos',2],[23,'stress',0],[39,'hypoxia',1],[56,'sensor',2]]}
};
const bound=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
export function createCrew(name){return [
 {id:'c1',name,role:'Бортинженер',values:{heart_rate:72,spO2:98,radiation_level:.7},fatigue:15},
 {id:'c2',name:'Алина Каримова',role:'Специалист по выходам',values:{heart_rate:83,spO2:99,radiation_level:.4},fatigue:22},
 {id:'c3',name:'Тимур Рахимов',role:'Исследователь',values:{heart_rate:65,spO2:96,radiation_level:.25},fatigue:18},
 {id:'c4',name:'Анна Волкова',role:'Пилот',values:{heart_rate:104,spO2:93,radiation_level:.8},fatigue:52}
].map(m=>({...m,baseline:{...m.values},trusted:true,lastTrusted:0,dose:0,history:[],symptoms:[],status:'rest'}));}
export function trendOf(member){
 const samples=(member.history||[]).filter(s=>s.trusted).slice(-10);
 const last=samples.at(-1);
 if(samples.length<5||!last||member.lastTrusted-last.second>1)return {available:false,oxygen:0,pulse:0,label:'Нужно минимум 5 доверенных замеров'};
 const first=samples[0],dt=last.second-first.second;
 if(dt<=0||samples.some((s,i)=>i&&s.second-samples[i-1].second>2))return {available:false,oxygen:0,pulse:0,label:'Недостаточно непрерывных данных'};
 const oxygen=(last.values.spO2-first.values.spO2)/dt,pulse=(last.values.heart_rate-first.values.heart_rate)/dt;
 return {available:true,oxygen,pulse,label:oxygen<-.12?`SpO₂ снижается ${dt} с: ${first.values.spO2} → ${last.values.spO2}%`:pulse>1?`Пульс растёт ${dt} с: ${first.values.heart_rate} → ${last.values.heart_rate}`:'Показатели без выраженного ухудшения'};
}
export function riskOf(member){
 const trend=trendOf(member),reasons=[];
 if(!member.trusted)reasons.push('измерения недостоверны');
 if(trend.available&&trend.oxygen<-.12)reasons.push(trend.label);
 if(trend.available&&trend.pulse>1)reasons.push('устойчивый рост пульса');
 if((member.fatigue||0)>=65)reasons.push('высокая усталость');
 if((member.symptoms||[]).some(s=>s.severe))reasons.push('есть выраженная жалоба');
 const score=Math.round(bound((member.fatigue||0)*.4+(trend.available?Math.max(0,-trend.oxygen)*80+Math.max(0,trend.pulse)*8:0)+(!member.trusted?50:0)+(member.symptoms||[]).filter(s=>s.severe).length*30));
 return {score,level:score>=55?'Высокий':score>=30?'Повышенный':'Низкий',reasons,trend,forecast:!member.trusted?'Прогноз недоступен: проверьте канал и датчик.':trend.available&&trend.oxygen<-.12?`При сохранении тенденции SpO₂ через 10 с: ${Math.max(0,member.values.spO2+trend.oxygen*10).toFixed(1)}%. Это линейная экстраполяция, не вероятность события.`:trend.available?'На ближайшие 10 с выраженного ухудшения по тренду не видно.':'Недостаточно истории для прогноза.'};
}
export function assessCrew(crew,taskId){
 const task=tasks[taskId];if(!task)throw new Error('Unknown task');
 const ranked=crew.map(member=>{
  const v=member.values,reasons=[],risk=riskOf(member);
  if(member.requireDailyExam){
   const exam=member.dailyExam;
   if(!exam||exam.day!==member.medicalDay||exam.name!==member.name)reasons.push('обязательный медосмотр за день не пройден');
   else{
    const review=member.dailyRecoveryReview;
    const reviewed=review&&review.day===exam.day&&review.examRecordedAt===exam.recordedAt&&review.memberId===member.id&&review.trusted;
    const effective=reviewed?review:exam;
    const checked=assessCrew([{...member,requireDailyExam:false,values:effective.values,fatigue:effective.fatigue,dose:Math.max(exam.dose,effective.dose),trusted:effective.trusted,symptoms:effective.symptoms,history:[],lastTrusted:0}],taskId).ranked[0];
    reasons.push(...checked.reasons.map(reason=>'Медосмотр: '+reason));
   }
  }
  const valid=v&&['heart_rate','spO2','radiation_level'].every(k=>Number.isFinite(v[k]));
  if(!valid)reasons.push('неполные или некорректные данные');
  if(!member.trusted)reasons.push('нет свежих доверенных измерений');
  if(valid){if(v.heart_rate<50||v.heart_rate>100)reasons.push('пульс вне диапазона 50–100');if(v.spO2<task.minOxygen||v.spO2>100)reasons.push(`SpO₂ вне диапазона ${task.minOxygen}–100%`);if(v.radiation_level<.1||v.radiation_level>5)reasons.push('радиация вне диапазона 0.1–5');}
  if((member.fatigue||0)>=task.maxFatigue)reasons.push('недостаточный запас сил');
  if(member.radiationWatch?.active)reasons.push(member.radiationWatch.doseHold?'радиационное наблюдение: превышена суммарная доза, нужен пересмотр допуска':'защитное наблюдение: ожидаются 5 нормальных доверенных замеров фона');
  if((member.dose||0)>=task.doseBudget)reasons.push('исчерпан учебный бюджет дозы');
  if((member.symptoms||[]).some(s=>s.severe))reasons.push('выраженная жалоба космонавта');
  if(risk.score>=55)reasons.push('высокий учебный индекс риска');
  const parts=valid?{pulse:bound(100-Math.abs(v.heart_rate-70)*2),oxygen:bound((v.spO2-94)/6*100),radiation:bound((5-v.radiation_level)/4.9*100)}:{pulse:0,oxygen:0,radiation:0};
  const medicalScore=Object.keys(task.weights).reduce((sum,k)=>sum+parts[k]*task.weights[k],0);
  const stability=risk.trend.available?bound(100-Math.max(0,-risk.trend.oxygen)*100-Math.max(0,risk.trend.pulse)*10):50;
  const score=Math.round(bound(medicalScore*.7+(100-(member.fatigue||0))*.15+stability*.1+bound((1-(member.dose||0)/task.doseBudget)*100)*.05));
  return {...member,eligible:!reasons.length,reasons,score,parts,stability,risk};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.id.localeCompare(b.id));
 const best=ranked.find(m=>m.eligible)||null;
 return {taskId,task:task.name,ranked,best,explanation:best?`${best.name}: пульс ${best.values.heart_rate}, SpO₂ ${best.values.spO2}%, фон ${best.values.radiation_level.toFixed(2)} мкЗв/ч; усталость ${Math.round(best.fatigue||0)}%, доза ${(best.dose||0).toFixed(4)} мкЗв. Итог ${best.score}/100 — максимум среди доступных участников. Учтены история, жалобы и требования задания.`:'Подходящих кандидатов нет: отклонения, усталость, жалобы, доза или недостоверные данные. Задание отложено.'};
}
export function planTeam(crew,taskId){
 const assessment=assessCrew(crew,taskId),task=tasks[taskId],available=assessment.ranked.filter(m=>m.eligible&&m.status!=='working');
 const team=available.slice(0,task.size),reserve=available[task.size]||null;
 return {...assessment,team,reserve,ready:team.length===task.size&&!!reserve,reason:team.length<task.size?'Не хватает подходящих участников.':!reserve?'Нет подходящего резерва на станции.':'Группа и резерв подобраны по рейтингу; резерв не отправляется на задание.'};
}
export class CrewMonitor{
 constructor(crew){this.members=crew.map(m=>({...m,baseline:{...m.values},values:{...m.values},trusted:true,lastTrusted:0,history:[],symptoms:[],fatigue:m.fatigue||0,dose:m.dose||0,status:'rest',sensorFault:false}));this.elapsed=0;}
 tick(elapsed,event){
  const dt=Math.max(0,elapsed-this.elapsed);this.elapsed=elapsed;
  this.members.forEach((m,i)=>{
   const target=event?.target??(event?.type==='hypoxia'?0:event?.type==='radiation'?1:2),affected=event&&i===target,age=elapsed-(event?.started??elapsed);
   const working=m.status==='working',testing=m.status==='testing';
   m.fatigue=bound(m.fatigue+dt*(working?1.3:testing?.7:-.45)+(affected&&event.type==='fatigue'?dt*3:0));
   m.sensorFault=!!(affected&&event.type==='sensor');
   m.trusted=!(affected&&['mitm','dos','sensor'].includes(event.type));
   m.symptoms=[];
   if(m.fatigue>=55)m.symptoms.push({text:'Чувствую усталость, нужен отдых',severe:m.fatigue>=75});
   if(affected&&['hypoxia','oxygen_trend'].includes(event.type))m.symptoms.push({text:age>=4?'Кружится голова, работать тяжело':'Появилась одышка',severe:age>=4});
   if(affected&&event.type==='stress')m.symptoms.push({text:'Сильное сердцебиение при нагрузке',severe:age>=3});
   if(m.trusted){
    m.lastTrusted=elapsed;
    m.values={heart_rate:Math.round(m.baseline.heart_rate+Math.sin(elapsed/5+i)*2+(working?5:testing?4:0)+(affected&&event.type==='hypoxia'?32:affected&&event.type==='stress'?age*3:0)),spO2:+(m.baseline.spO2+Math.sin(elapsed/7+i)*.2-(affected&&event.type==='hypoxia'?8:affected&&event.type==='oxygen_trend'?age*.28:0)).toFixed(1),radiation_level:+(m.baseline.radiation_level+Math.abs(Math.sin(elapsed/9+i))*.08+(affected&&event.type==='radiation'?7:0)).toFixed(2)};
   }
   // Integrate dose only from trusted measured rates. Missing intervals remain unknown.
   if(m.trusted)m.dose+=m.values.radiation_level*dt/3600;else m.unknownDoseSeconds=(m.unknownDoseSeconds||0)+dt;
   updateRadiationWatch(m);
   m.history.push({second:elapsed,values:{...m.values},trusted:m.trusted,fatigue:m.fatigue,dose:m.dose});if(m.history.length>180)m.history.shift();
  });
 }
}
export class MissionControl{
 constructor(name,scenario='station',medicalBook=null){
  if(!missionScenarios[scenario])throw new Error('Unknown scenario');
  this.scenario=scenario;this.monitor=new CrewMonitor(createCrew(name));this.elapsed=0;this.duration=90;this.event=null;this.timeline=[];this.preflight=null;this.assignment=null;this.completed=[];this.finished=false;this.replacements=0;this.preflightResults=[];this.medicalBook=medicalBook;this.syncDailyExams();
 }
 record(type,text,detail={}){this.timeline.push({second:this.elapsed,type,text,...detail});}
 syncDailyExams(){
  const day=this.medicalBook?.today()||localDay();
  this.monitor.members.forEach(m=>{m.requireDailyExam=true;m.medicalDay=day;m.dailyExam=this.medicalBook?.get(day,m.id)||m.dailyExam||null;
   const exam=m.dailyExam;
   if(this.medicalBook){const exposure=this.medicalBook.exposures?.[m.id];if(exposure){m.dose=Math.max(m.dose,exposure.dose);m.unknownDoseSeconds=Math.max(m.unknownDoseSeconds||0,exposure.unknownSeconds);if(!m.radiationWatch||exposure.watch.doseHold)m.radiationWatch=structuredClone(exposure.watch);}m.dose=Math.max(m.dose,...this.medicalBook.history(m.id).map(e=>e.dose));}
   if(exam&&exam.day===day&&exam.name===m.name&&m.appliedDailyExam!==exam.recordedAt){m.appliedDailyExam=exam.recordedAt;if(exam.trusted){m.baseline={...exam.values};m.values={...exam.values};m.fatigue=exam.fatigue;}updateRadiationWatch(m);}
   if(m.dose>=radiationRules.doseHold)updateRadiationWatch(m);});
 }
 assessment(taskId){this.syncDailyExams();return planTeam(this.monitor.members,taskId);}
 operatorAllowed(taskId){if(!this.operatorId)return true;this.syncDailyExams();const member=this.monitor.members.find(m=>m.id===this.operatorId);return !!member&&assessCrew([member],taskId).ranked[0].eligible;}
 startPreflight(taskId,planned=null){
  if(!this.operatorAllowed(taskId)){this.record('blocked','Допуск текущего профиля не соответствует требованиям задания.');return false;}
  if(this.finished||this.preflight?.status==='testing'||this.assignment?.status==='working'||this.assignment?.status==='paused')return false;
  const plan=this.assessment(taskId);
  if(planned){const ids=[...planned.ids,planned.reserveId];if(planned.ids.length!==tasks[taskId].size||new Set(ids).size!==ids.length||ids.some(id=>!plan.ranked.find(m=>m.id===id)?.eligible)){this.record('blocked','Дневной план не соответствует текущему состоянию экипажа.');return false;}}
  if(!plan.ready){this.record('blocked',plan.reason);return false;}
  const ids=plan.ranked.filter(m=>m.eligible).map(m=>m.id);
  this.preflight={taskId,ids,planned:planned?structuredClone(planned):null,started:this.elapsed,status:'testing',before:this.monitor.members.filter(m=>ids.includes(m.id)).map(m=>({id:m.id,values:{...m.values}}))};
  this.monitor.members.forEach(m=>m.status=ids.includes(m.id)?'testing':'rest');this.record('preflight','Начата 4-секундная учебная проба нагрузки: группа и резерв.',{ids,taskId});return true;
 }
 assign(taskId){
  if(!this.operatorAllowed(taskId)){this.record('blocked','Назначение заблокировано допуском текущего профиля.');return false;}
  if(this.finished||['working','paused'].includes(this.assignment?.status))return false;
  const p=this.preflight,plan=this.assessment(taskId);
  if(p?.planned){plan.team=p.planned.ids.map(id=>plan.ranked.find(m=>m.id===id));plan.reserve=plan.ranked.find(m=>m.id===p.planned.reserveId);plan.ready=plan.team.length===tasks[taskId].size&&plan.team.every(m=>m?.eligible)&&!!plan.reserve?.eligible;}
  if(!p||p.status!=='passed'||p.taskId!==taskId||this.elapsed-p.finishedAt>25||!plan.ready||[...plan.team.map(m=>m.id),plan.reserve.id].some(id=>!p.ids.includes(id))){this.record('blocked','Назначение отклонено: нужна свежая успешная проверка всей группы и резерва.');return false;}
  this.assignment={taskId,ids:plan.team.map(m=>m.id),reserveId:plan.reserve.id,status:'working',progress:0,started:this.elapsed,replacements:[],participants:[...plan.team.map(m=>m.id)]};
  this.monitor.members.forEach(m=>m.status=this.assignment.ids.includes(m.id)?'working':'rest');
  this.assignment.medicalDay=this.monitor.members[0].medicalDay;
  this.record('assignment',`Назначено задание «${tasks[taskId].name}». Резерв остаётся на станции.`,{ids:[...this.assignment.ids],reserveId:plan.reserve.id});return true;
 }
 cancel(){
  if(this.finished)return false;
  if(this.assignment&&['working','paused'].includes(this.assignment.status)){this.assignment.status='cancelled';this.record('cancelled','Задание отменено, участники переведены на отдых.');}
  if(this.preflight?.status==='testing')this.preflight.status='cancelled';
  this.monitor.members.forEach(m=>m.status='rest');return true;
 }
 replacementPlan(){
  const a=this.assignment;if(!a||a.status!=='paused')return null;
  this.syncDailyExams();const ranked=assessCrew(this.monitor.members,a.taskId).ranked;
  const bad=a.ids.filter(id=>!ranked.find(m=>m.id===id)?.eligible);
  const fresh=this.preflight?.status==='passed'&&this.elapsed-this.preflight.finishedAt<=25;
  const tested=new Set(fresh?this.preflight.ids:[]);
  const candidates=ranked.filter(m=>m.eligible&&!a.ids.includes(m.id)&&tested.has(m.id));
  const ids=a.ids.filter(id=>!bad.includes(id)).concat(candidates.slice(0,bad.length).map(m=>m.id));
  const reserve=ranked.find(m=>m.eligible&&!ids.includes(m.id)&&tested.has(m.id));
  return {bad,candidates,ids,reserve,ready:ids.length===tasks[a.taskId].size&&!!reserve,reason:!candidates.length?'Нет подходящего участника с пройденной проверкой.':!reserve?'После замены не остаётся здорового резерва.':'Подобрана замена с пройденной проверкой и резерв.'};
 }
 replace(){
  if(this.assignment&&!this.operatorAllowed(this.assignment.taskId))return false;
  const p=this.replacementPlan();if(this.finished||!p?.ready)return false;
  const a=this.assignment,old=[...a.ids];a.ids=p.ids;a.reserveId=p.reserve.id;a.status='working';a.participants=[...new Set([...a.participants,...a.ids])];a.replacements.push({second:this.elapsed,old,new:[...a.ids]});this.replacements++;
  this.monitor.members.forEach(m=>m.status=a.ids.includes(m.id)?'working':'rest');this.record('replacement','Выполнена замена участника; задание продолжается.',{old,ids:[...a.ids],reserveId:a.reserveId});return true;
 }
 tick(){
  if(this.finished)return;this.syncDailyExams();this.elapsed++;
  const schedule=missionScenarios[this.scenario].events;
  if(this.event&&this.elapsed-this.event.started>=9){this.record('recovery','Событие завершено; состояние и достоверность данных проверяются заново.');this.event=null;}
  const next=schedule.find(([second])=>second===this.elapsed);
  if(next){this.event={type:next[1],target:next[2],started:this.elapsed};this.record('alert',eventDescription(this.event,this.monitor.members));}
  this.monitor.tick(this.elapsed,this.event);
  this.medicalBook?.updateExposure(this.monitor.members);
  const p=this.preflight;
  if(p?.status==='testing'&&this.elapsed-p.started>=4){
   const assessment=assessCrew(this.monitor.members,p.taskId);
   p.results=p.before.map(before=>{const after=this.monitor.members.find(m=>m.id===before.id),a=assessment.ranked.find(m=>m.id===before.id);const pulseDelta=after.values.heart_rate-before.values.heart_rate,oxygenDelta=+(after.values.spO2-before.values.spO2).toFixed(1);return {id:after.id,name:after.name,before:before.values,after:{...after.values},pulseDelta,oxygenDelta,passed:a.eligible&&pulseDelta<=12&&oxygenDelta>=-1,reasons:a.reasons};});
   p.status=p.results.every(r=>r.passed)?'passed':'failed';p.finishedAt=this.elapsed;this.preflightResults.push(structuredClone(p));this.monitor.members.forEach(m=>m.status='rest');this.record('preflight',p.status==='passed'?'Проба нагрузки пройдена: группа готова к назначению.':'Проба нагрузки не пройдена; назначение заблокировано.',{results:p.results});
  }
  const a=this.assignment;
  if(a&&['working','paused'].includes(a.status)){
   this.syncDailyExams();const ranked=assessCrew(this.monitor.members,a.taskId).ranked;
   const bad=a.ids.filter(id=>!ranked.find(m=>m.id===id)?.eligible);
   const reserveGood=ranked.find(m=>m.id===a.reserveId)?.eligible;
   const operatorHealthy=this.operatorAllowed(a.taskId);
   if((bad.length||!reserveGood||!operatorHealthy)&&a.status==='working'){a.status='paused';a.pauseReason=bad.length?'У назначенного участника ухудшение состояния или потеря данных.':'Резерв недоступен.';this.monitor.members.forEach(m=>m.status='rest');this.record('pause',a.pauseReason+' Задание приостановлено.',{ids:bad});}
   else if(!bad.length&&operatorHealthy&&a.status==='paused'){
    const reserve=ranked.find(m=>m.eligible&&!a.ids.includes(m.id));
    if(reserve){a.reserveId=reserve.id;a.status='working';this.monitor.members.forEach(m=>m.status=a.ids.includes(m.id)?'working':'rest');this.record('resume','Показатели восстановились; резерв подтверждён, задание возобновлено.');}
   }
   if(a.status==='working'){
    a.progress++;
    if(a.progress>=tasks[a.taskId].duration){a.status='completed';a.finished=this.elapsed;this.completed.push(structuredClone(a));this.monitor.members.forEach(m=>m.status='rest');this.record('completed',`Задание «${tasks[a.taskId].name}» выполнено. Участники отдыхают.`);}
   }
  }
  if(this.elapsed>=this.duration)this.finish();
 }
 finish(){if(!this.finished){this.finished=true;if(this.preflight?.status==='testing')this.preflight.status='interrupted';if(this.assignment&&['working','paused'].includes(this.assignment.status))this.assignment.status='interrupted';this.monitor.members.forEach(m=>m.status='rest');this.record('finish','Наблюдение завершено.');}return this.report();}
 report(){return {simulation:true,scenario:this.scenario,seconds:this.elapsed,finished:this.finished,completed:structuredClone(this.completed),assignment:structuredClone(this.assignment),preflights:structuredClone(this.preflightResults),timeline:structuredClone(this.timeline),crew:structuredClone(this.monitor.members),replacements:this.replacements};}
}
export function eventDescription(event,members){
 const labels={hypoxia:'Падение кислорода и учащённый пульс',radiation:'Повышенный радиационный фон',mitm:'Подмена телеметрии: пакет отклонён',dos:'Перегрузка канала телеметрии',sensor:'Сбой датчика: ложный SpO₂ 52%, измерение отклонено',oxygen_trend:'Постепенное снижение кислорода',fatigue:'Рост усталости',stress:'Учащённый пульс при нагрузке'};
 return members[event.target].name+': '+labels[event.type];
}

export function makeDailyPlan(members,book,day,requests){
 if(!Array.isArray(requests)||requests.some(r=>!tasks[r.taskId]||!Number.isInteger(r.hour)||r.hour<0||r.hour>23))throw Error('Проверьте время и тип заданий.');
 const slots=new Set();for(const r of requests){if(slots.has(r.hour))throw Error('На один час допускается только одно задание.');slots.add(r.hour);}
 const workload=new Map(),rows=[];
 for(const request of [...requests].sort((a,b)=>a.hour-b.hour)){
  const crew=members.map(m=>{const exam=book.get(day,m.id);return {...m,requireDailyExam:true,medicalDay:day,dailyExam:exam,values:exam?.values||m.values,fatigue:(exam?.fatigue||0)+(workload.get(m.id)||0),dose:exam?.dose||0,trusted:exam?.trusted??false,symptoms:exam?.symptoms||[],history:[],status:'rest',radiationWatch:exam?{active:exam.values.radiation_level>radiationRules.maxRate||exam.dose>=radiationRules.doseHold,doseHold:exam.dose>=radiationRules.doseHold,normalSamples:0}:m.radiationWatch};});
  const plan=planTeam(crew,request.taskId),row={hour:request.hour,taskId:request.taskId,status:plan.ready?'planned':'blocked',ids:plan.ready?plan.team.map(m=>m.id):[],reserveId:plan.ready?plan.reserve.id:null,reason:plan.ready?'Назначено по медосмотру за '+day+' с учётом накопления учебной нагрузки.':plan.reason,comparison:plan.ranked.map(m=>({id:m.id,name:m.name,eligible:m.eligible,score:m.score,reasons:m.reasons}))};
  if(plan.ready)for(const member of plan.team)workload.set(member.id,(workload.get(member.id)||0)+12);
  rows.push(row);
 }
 return {day,createdAt:new Date().toISOString(),rows};
}
