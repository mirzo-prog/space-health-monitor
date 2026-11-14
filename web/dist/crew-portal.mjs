import {astronautPortrait} from './assets.mjs';
import {createCrew,assessCrew} from './crew.mjs';
export function profileClearance(mission,id){
 const member=mission?.monitor.members.find(m=>m.id===id);
 if(!member)return {allowed:false,reasons:['Выберите профиль космонавта.']};
 mission.syncDailyExams();const evaluated=assessCrew([member],'research').ranked[0];
 return {allowed:evaluated.eligible,reasons:evaluated.reasons,member};
}
export class ProfileVault{
 constructor(storage){this.storage=storage;this.warning='';}
 key(id){return 'alpha-personal-profile-v1:'+id;}
 save(id,state){try{this.storage?.setItem(this.key(id),JSON.stringify({version:1,owner:id,state}));if(!this.storage)throw Error();this.warning='';return true;}catch{this.warning='Личный сеанс не сохранён в браузере. Скачайте отчёт и архив перед выходом.';return false;}}
 load(id){try{const raw=this.storage?.getItem(this.key(id));if(!raw)return null;const data=JSON.parse(raw);if(data.version!==1||data.owner!==id||!data.state||!Array.isArray(data.state.mission?.crew)||data.state.mission.crew.length!==4)throw Error();
 const m=data.state.mission,ids=new Set();
 if(!['station','surface','emergency'].includes(m.scenario)||!Number.isInteger(m.seconds)||m.seconds<0||m.seconds>90||typeof m.finished!=='boolean'||!Array.isArray(m.timeline)||m.timeline.some(e=>typeof e.text!=='string')||!Array.isArray(m.completed))throw Error();
 for(const member of m.crew){if(!['c1','c2','c3','c4'].includes(member.id)||ids.has(member.id)||typeof member.name!=='string'||!member.values||!member.baseline||!['heart_rate','spO2','radiation_level'].every(k=>Number.isFinite(member.values[k])&&Number.isFinite(member.baseline[k]))||!Number.isFinite(member.fatigue)||!Number.isFinite(member.dose)||member.dose<0||!Array.isArray(member.history)||!Array.isArray(member.symptoms))throw Error();ids.add(member.id);}
 for(const assignment of [...m.completed,...(m.assignment?[m.assignment]:[])])if(!['eva','repair','research','evacuation'].includes(assignment.taskId)||!Array.isArray(assignment.ids)||assignment.ids.some(id=>!ids.has(id))||!ids.has(assignment.reserveId)||!Number.isFinite(assignment.progress))throw Error();
return data.state;}catch{this.warning='Сохранённый сеанс не удалось восстановить; медицинский архив сохранён отдельно.';return null;}}
}
const portalElement=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
export class CrewPortal{
 constructor(callbacks){
  this.callbacks=callbacks;this.$=id=>document.getElementById(id);this.profiles=createCrew('Алексей Иванов');this.profile=null;this.pending=null;this.step=1;
  let storage;try{storage=window.localStorage;}catch{}this.vault=new ProfileVault(storage);
  const root=this.$('profile-cards');for(const [index,p]of this.profiles.entries()){const card=portalElement('button',undefined,'profile-card');card.type='button';card.setAttribute('data-profile',p.id);const avatar=portalElement('span',undefined,'profile-avatar'),portrait=portalElement('img');portrait.src=astronautPortrait;portrait.alt='Космонавт в белом скафандре';avatar.append(portrait);card.append(avatar,portalElement('strong',p.name),portalElement('span',p.role),portalElement('small','ALPHA / '+p.id.toUpperCase()));card.addEventListener('click',()=>this.choose(p.id));root.append(card);}
  this.$('compact-primary').addEventListener('click',()=>this.primaryAction());
  this.$('compact-health-tab').addEventListener('click',()=>this.navigate(2));this.$('compact-tasks-tab').addEventListener('click',()=>this.navigate(3));
  this.$('compact-details').addEventListener('toggle',()=>this.callbacks.redraw?.());
  this.$('logout').addEventListener('click',()=>this.logout());
  for(const step of [1,2,3])this.$('step-button-'+step).addEventListener('click',()=>this.navigate(step));
  this.$('to-flight-tasks').addEventListener('click',()=>this.launch());this.$('launch-mission').addEventListener('click',()=>this.launch());this.$('quick-exam').addEventListener('click',()=>{const result=this.callbacks.examineCrew();this.$('launch-feedback').textContent=result;this.refresh();});this.$('back-to-health').addEventListener('click',()=>this.navigate(2));this.$('start-scenario').addEventListener('click',()=>this.callbacks.scenario());
  this.$('recover-rest').addEventListener('click',()=>this.beginRecovery());
  this.$('recover-kit').addEventListener('click',()=>{this.callbacks.message('УЧЕБНЫЙ ЗАПРОС: открыта карточка обращения к медблоку. Препараты и дозировки программа не назначает.');this.$('recovery-feedback').textContent='Запрос инструкции отмечен в журнале симуляции. Реальной связи с ЦУП нет.';});
  this.$('recover-medic').addEventListener('click',()=>{this.callbacks.message('УЧЕБНЫЙ ЗАПРОС: помощь бортинженера-медика.');this.$('recovery-feedback').textContent='Вызов медика добавлен в учебный журнал; внешнее сообщение не отправлялось.';});
  this.$('recheck-health').addEventListener('click',()=>this.recheck());
  this.$('crew-demo-exams').addEventListener('click',()=>{this.$('recovery-feedback').textContent=this.callbacks.examineCrew();this.refresh();});
  this.arrange();this.navigate(1);
 }
 arrange(){
  // Move the existing nodes intact; original IDs, event handlers and classes survive.
  const health=this.$('health-tools'),flight=this.$('flight-tools');
  for(const selector of ['#live-mission','.metrics']){const el=document.querySelector(selector);if(el)health.append(el);}
  for(const selector of ['.daily-medical','.diagnostics','.crew-selection','.lower-grid','.disclaimer']){const el=document.querySelector(selector);if(el)this.$('advanced-health-content').append(el);}
  const missionScene=this.$('mission-scene-panel');if(missionScene)this.$('compact-scene').append(missionScene);
  for(const selector of ['#scenario-controls','.daily-planning','.assignment-panel']){const el=document.querySelector(selector);if(el)this.$('advanced-flight-content').append(el);}
  for(const id of ['advanced-health','advanced-flight']){this.$(id).open=true;this.$(id).addEventListener('toggle',()=>this.callbacks.redraw?.());}
  const scenarios=document.querySelector('.scenario-picker');if(scenarios)this.$('scenario-picker-slot').append(scenarios);for(const id of ['step-health','step-flight'])this.$('compact-details-content').append(this.$(id));
  for(const id of ['medical-summary','selection-summary','report-crew','report-timeline','download'])this.$('compact-report-content').append(this.$(id));
  const reportHeading=document.querySelector('#result > h2');if(reportHeading)this.$('compact-report-content').append(reportHeading);
  document.body.classList.add('portal-active');document.body.classList.add('compact-mode');
 }
 choose(id){const chosen=this.profiles.find(p=>p.id===id);if(!chosen)return;if(this.profile)this.logout();this.pending=chosen;this.authenticate();}
 authenticate(){if(!this.pending)return;this.profile=this.pending;this.pending=null;this.$('auth-panel').hidden=true;this.$('header-session').hidden=false;this.$('session-name').textContent=this.profile.name;this.$('session-role').textContent=this.profile.role;this.$('session-method').hidden=true;this.callbacks.login(this.profile,this.vault.load(this.profile.id));this.navigate(2);}
 navigate(step){
  if(step===1&&this.profile){this.logout();return;}
  if(step!==1&&!this.profile)return;
  if(step===3&&!this.callbacks.clearance(this.profile.id).allowed&&!this.callbacks.hasProgress?.()){this.step=2;this.$('step-hint').textContent='Сначала завершите медосмотр и повторную проверку на шаге 2.';this.refresh();return;}
  this.step=step;if(step===3)this.hasEnteredFlight=true;this.$('auth-panel').hidden=step!==1;this.$('step-health').hidden=step!==2;this.$('step-flight').hidden=step!==3;this.$('step-hint').textContent=['','Нажмите на карточку космонавта, чтобы начать.','Запишите сегодняшний медосмотр. Проверьте допуск, историю и состояние экипажа.','Выберите задание или дневной план; проверьте готовность группы и резерв.'][step];
  for(const n of [1,2,3]){this.$('step-button-'+n).setAttribute('aria-current',n===step?'step':'false');this.$('step-button-'+n).classList.toggle('active',n===step);this.$('step-button-'+n).disabled=n!==1&&!this.profile;}
  this.callbacks.step?.(step);this.refresh();
 }
 refresh(){
  if(!this.profile)return;const status=this.callbacks.clearance(this.profile.id);const can=status.allowed;
  this.$('clearance-panel').classList.toggle('danger',!can);this.$('clearance-panel').classList.toggle('clearance-approved',can);
  this.$('clearance-status').textContent=can?'Физиологические показатели в норме. Допуск к штатным работам получен.':'ВНИМАНИЕ: допуск к работам ограничен.';
  this.$('clearance-reasons').textContent=can?'Требования конкретного задания и готовность резерва проверяются отдельно.':status.reasons.join('; ');
  const canResume=!!this.callbacks.hasProgress?.();this.$('to-flight-tasks').disabled=!can&&!canResume;this.$('step-button-3').disabled=!can&&!canResume;this.$('to-flight-tasks').textContent=canResume?'2. Продолжить миссию':'2. Запустить миссию';
  if(can)this.lastMedicalAlert=null;
  const missingExam=!status.member?.dailyExam||status.member.dailyExam.day!==status.member.medicalDay;this.$('recovery-panel').hidden=can||missingExam;if(missingExam)this.$('clearance-status').textContent='Для допуска запишите обязательный медосмотр за сегодня.';this.$('recovery-warning').textContent='Выход в открытый космос и тяжёлые работы приостановлены. Учебная передача телеметрии в медблок ЦУП отмечается в журнале; реальной связи с Землёй нет.';
  const alertKey=this.profile.id+':'+status.reasons.join('|');if(!can&&!missingExam&&this.lastMedicalAlert!==alertKey){this.lastMedicalAlert=alertKey;this.callbacks.message('УЧЕБНАЯ ТЕЛЕМЕТРИЯ В МЕДБЛОК ЦУП: '+this.profile.name+'. '+status.reasons.join('; ')+'. Реальная передача не выполнялась.');}
  this.$('start-scenario').disabled=!!this.callbacks.running?.();
  this.$('profile-storage-warning').textContent=this.vault.warning;this.callbacks.launchStatus?.();this.renderCompact(status);
  if(!can&&this.step===3&&!this.missionLaunched&&!canResume){this.step=2;this.$('step-health').hidden=false;this.$('step-flight').hidden=true;this.$('step-button-2').classList.toggle('active',true);this.$('step-button-3').classList.toggle('active',false);this.$('step-hint').textContent='Допуск изменился. Вернитесь к мониторингу и повторной проверке.';}
  const progress=this.callbacks.progress(this.profile.id);this.$('personal-progress').textContent=`Личный прогресс: ${progress.completed} заданий · ${progress.seconds} с наблюдения.`;
 }
 renderCompact(clearance){
  const member=clearance.member,state=this.callbacks.compactState?.();if(!member||!state)return;
  this.$('compact-name').textContent=this.profile.name;this.$('compact-role').textContent=this.profile.role;
  this.$('compact-hr').textContent=member.values.heart_rate;this.$('compact-oxygen').textContent=member.values.spO2;this.$('compact-radiation').textContent=member.values.radiation_level.toFixed(2);
  const metricFlags=[member.values.heart_rate<50||member.values.heart_rate>100,member.values.spO2<94,member.values.radiation_level>5||member.radiationWatch?.active];document.querySelectorAll('.compact-readings article').forEach((card,i)=>card.classList.toggle('danger',!!metricFlags[i]));
  const missing=!member.dailyExam||member.dailyExam.day!==member.medicalDay;
  let kind,label,guidance,badge;
  if(this.recoveryTimer){kind='recovering';label='Восстановление: '+this.remaining+' с';badge='Идёт восстановление';guidance='Дождитесь повторной проверки. Радиационная доза не обнуляется.';}
  else if(state.finished){kind='report';label='Открыть отчёт PDF';badge='Миссия завершена';guidance='Результаты готовы. Можно сохранить PDF и посмотреть подробности.';}
  else if(missing||!state.allExamined){kind='exam';label='Пройти осмотр';badge='Нужен осмотр';guidance='Проверьте экипаж одним нажатием. Результаты за сегодня сохранятся.';}
  else if(state.paused&&state.elapsed){kind='start';label='Продолжить наблюдение';badge='Работы приостановлены';guidance='Наблюдение продолжится. Задания останутся заблокированы до восстановления показателей.';}
  else if(!clearance.allowed&&(!this.missionLaunched||state.paused)){
   const restricted=member.radiationWatch?.active||!member.trusted;kind=restricted?'details':'recover';label=restricted?'Посмотреть причину':'Начать восстановление';badge=restricted?'Работы запрещены':'Нужен отдых';guidance=clearance.reasons.join('; ')+(member.radiationWatch?.active?' Суммарная доза: '+member.dose.toFixed(4)+' мкЗв.':'');
  }
  else if(!this.missionLaunched||state.paused){kind='start';label=state.elapsed?'Продолжить миссию':'Начать миссию';badge='Готов';guidance='Допуск получен. Проверку группы и выполнение заданий система проведёт сама.';}
  else{kind='pause';label='Пауза';badge=clearance.allowed?'На миссии':'Работы приостановлены';guidance=state.message;}
  this.primaryKind=kind;this.$('compact-primary').textContent=label;this.$('compact-primary').disabled=kind==='recovering';this.$('compact-health-status').textContent=badge;this.$('compact-health-status').classList.toggle('critical',!clearance.allowed&&!missing);this.$('compact-guidance').textContent=guidance;
  this.$('compact-task').hidden=!state.elapsed&&!this.missionLaunched;this.$('compact-task-name').textContent=state.task||'Подготовка миссии';this.$('compact-task-state').textContent=state.message;this.$('compact-percent').textContent=Math.round(state.percent)+'%';this.$('compact-progress-fill').style.width=state.percent+'%';
 }
 primaryAction(){
  if(!this.profile)return;
  if(this.primaryKind==='exam'){this.$('compact-feedback').textContent=this.callbacks.examineCrew();this.refresh();}
  else if(this.primaryKind==='start')this.launch();
  else if(this.primaryKind==='pause')this.callbacks.pause();
  else if(this.primaryKind==='recover')this.beginRecovery();
  else if(this.primaryKind==='report')this.callbacks.report();
  else if(this.primaryKind==='details'){this.$('compact-details').open=true;this.navigate(2);}
 }
 launch(){if(!this.profile)return;const result=this.callbacks.launch();this.$('launch-feedback').textContent=result.message;this.$('compact-feedback').textContent=result.started?'':result.message;if(result.started){this.missionLaunched=true;this.navigate(3);}}
 beginRecovery(){
  if(!this.profile||this.recoveryTimer)return;this.remaining=15;this.$('recover-rest').disabled=true;this.callbacks.message('УЧЕБНЫЙ ПРОТОКОЛ: отдых и стабилизация дыхания. 15 минут представлены 15 секундами симуляции.');
  this.$('recovery-feedback').textContent='Выполняется учебный протокол: 15 с (модель 15 мин). Показатели будут проверены повторно; доза не уменьшается.';
  this.recoveryTimer=setInterval(()=>{this.remaining--;this.$('recovery-progress').value=15-this.remaining;this.$('recovery-feedback').textContent='Учебное восстановление: осталось '+this.remaining+' с.';this.refresh();if(this.remaining<=0){clearInterval(this.recoveryTimer);this.recoveryTimer=null;this.$('recover-rest').disabled=false;this.$('recovery-feedback').textContent=this.callbacks.recover(this.profile.id);this.refresh();}},1000);
 }
 recheck(){if(!this.profile)return;this.$('recovery-feedback').textContent=this.callbacks.recheck(this.profile.id);this.refresh();}
 save(){if(this.profile)this.vault.save(this.profile.id,this.callbacks.snapshot());}
 logout(){this.save();if(this.recoveryTimer){clearInterval(this.recoveryTimer);this.recoveryTimer=null;}this.callbacks.logout();this.profile=null;this.pending=null;this.hasEnteredFlight=false;this.missionLaunched=false;this.$('profile-cards').hidden=false;this.$('header-session').hidden=true;this.$('auth-panel').hidden=false;this.$('recover-rest').disabled=false;this.$('recovery-progress').value=0;this.navigate(1);}
}
