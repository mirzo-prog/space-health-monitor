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
  this.callbacks=callbacks;this.$=id=>document.getElementById(id);this.profiles=createCrew('Алексей Иванов');this.profile=null;this.pending=null;this.pin='';this.step=1;this.failures=0;this.lockedUntil=0;
  let storage;try{storage=window.localStorage;}catch{}this.vault=new ProfileVault(storage);
  const root=this.$('profile-cards');for(const [index,p]of this.profiles.entries()){const card=portalElement('button',undefined,'profile-card');card.type='button';card.setAttribute('data-profile',p.id);card.append(portalElement('span',['◉','✦','⬡','◈'][index],'profile-avatar'),portalElement('strong',p.name),portalElement('span',p.role),portalElement('small','ALPHA / '+p.id.toUpperCase()));card.addEventListener('click',()=>this.choose(p.id));root.append(card);}
  const keypad=this.$('pin-keypad');for(const digit of ['1','2','3','4','5','6','7','8','9','clear','0','back']){const b=portalElement('button',digit==='clear'?'Сброс':digit==='back'?'⌫':digit,'pin-key');b.type='button';b.setAttribute('aria-label',digit==='back'?'Удалить последнюю цифру':digit==='clear'?'Очистить PIN':'Цифра '+digit);b.addEventListener('click',()=>this.input(digit));keypad.append(b);}
  this.$('badge-login').addEventListener('click',()=>this.authenticate('demo-badge'));
  this.$('pin-cancel').addEventListener('click',()=>{this.pending=null;this.pin='';this.$('pin-screen').hidden=true;this.$('profile-cards').hidden=false;});
  this.$('logout').addEventListener('click',()=>this.logout());
  for(const step of [1,2,3])this.$('step-button-'+step).addEventListener('click',()=>this.navigate(step));
  this.$('to-flight-tasks').addEventListener('click',()=>this.navigate(3));this.$('back-to-health').addEventListener('click',()=>this.navigate(2));this.$('start-scenario').addEventListener('click',()=>this.callbacks.scenario());
  this.$('recover-rest').addEventListener('click',()=>this.beginRecovery());
  this.$('recover-kit').addEventListener('click',()=>{this.callbacks.message('УЧЕБНЫЙ ЗАПРОС: открыта карточка обращения к медблоку. Препараты и дозировки программа не назначает.');this.$('recovery-feedback').textContent='Запрос инструкции отмечен в журнале симуляции. Реальной связи с ЦУП нет.';});
  this.$('recover-medic').addEventListener('click',()=>{this.callbacks.message('УЧЕБНЫЙ ЗАПРОС: помощь бортинженера-медика.');this.$('recovery-feedback').textContent='Вызов медика добавлен в учебный журнал; внешнее сообщение не отправлялось.';});
  this.$('recheck-health').addEventListener('click',()=>this.recheck());
  this.$('crew-demo-exams').addEventListener('click',()=>{this.$('recovery-feedback').textContent=this.callbacks.examineCrew();this.refresh();});
  window.addEventListener('keydown',e=>{if(!this.pending||this.profile)return;if(/^\d$/.test(e.key)){e.preventDefault();this.input(e.key);}else if(e.key==='Backspace'){e.preventDefault();this.input('back');}else if(e.key==='Escape')this.$('pin-cancel').click();});
  this.arrange();this.navigate(1);
 }
 arrange(){
  // Move the existing nodes intact; original IDs, event handlers and classes survive.
  const health=this.$('health-tools'),flight=this.$('flight-tools');
  for(const selector of ['.daily-medical','#live-mission','.diagnostics','.metrics','.crew-selection','.lower-grid','.disclaimer']){const el=document.querySelector(selector);if(el)health.append(el);}
  for(const selector of ['.daily-planning','.assignment-panel','.scene-panel']){const el=document.querySelector(selector);if(el)flight.append(el);}
  const scenarios=document.querySelector('.scenario-picker');if(scenarios)this.$('scenario-picker-slot').append(scenarios);document.body.classList.add('portal-active');
 }
 choose(id){this.pending=this.profiles.find(p=>p.id===id);if(!this.pending)return;this.pin='';this.$('profile-cards').hidden=true;this.$('pin-screen').hidden=false;this.$('pin-person').textContent=this.pending.name+' / '+this.pending.role;this.$('pin-message').textContent='Учебный PIN для всех профилей: 1234. Или используйте демонстрацию ID-бейджа.';this.drawPin();}
 drawPin(){this.$('pin-dots').textContent='●'.repeat(this.pin.length)+'○'.repeat(4-this.pin.length);this.$('pin-dots').setAttribute('aria-label','Введено цифр: '+this.pin.length+' из 4');}
 input(value){if(!this.pending||this.profile)return;if(Date.now()<this.lockedUntil){this.$('pin-message').textContent='Слишком много попыток. Подождите 15 секунд.';return;}if(value==='clear')this.pin='';else if(value==='back')this.pin=this.pin.slice(0,-1);else if(/^\d$/.test(value)&&this.pin.length<4)this.pin+=value;this.drawPin();if(this.pin.length===4){if(this.pin==='1234')this.authenticate('demo-pin');else{this.pin='';this.drawPin();this.failures++;if(this.failures>=5){this.lockedUntil=Date.now()+15000;this.failures=0;}this.$('pin-message').textContent='Неверный PIN. Для учебного входа используйте 1234.';}}}
 authenticate(method){if(!this.pending||Date.now()<this.lockedUntil)return;this.profile=this.pending;this.pending=null;this.pin='';this.failures=0;this.$('auth-panel').hidden=true;this.$('header-session').hidden=false;this.$('session-name').textContent=this.profile.name;this.$('session-role').textContent=this.profile.role;this.$('session-method').textContent=method==='demo-pin'?'Локальный учебный PIN':'ID-бейдж / демонстрация';this.callbacks.login(this.profile,this.vault.load(this.profile.id));this.navigate(2);}
 navigate(step){
  if(step===1&&this.profile){this.logout();return;}
  if(step!==1&&!this.profile)return;
  if(step===3&&!this.callbacks.clearance(this.profile.id).allowed){this.step=2;this.$('step-hint').textContent='Сначала завершите медосмотр и повторную проверку на шаге 2.';this.refresh();return;}
  this.step=step;if(step===3)this.hasEnteredFlight=true;this.$('auth-panel').hidden=step!==1;this.$('step-health').hidden=step!==2;this.$('step-flight').hidden=step!==3;this.$('step-hint').textContent=['','Выберите крупную карточку, затем введите PIN или проверьте учебный ID-бейдж.','Запишите сегодняшний медосмотр. Проверьте допуск, историю и состояние экипажа.','Выберите задание или дневной план; проверьте готовность группы и резерв.'][step];
  for(const n of [1,2,3]){this.$('step-button-'+n).setAttribute('aria-current',n===step?'step':'false');this.$('step-button-'+n).classList.toggle('active',n===step);this.$('step-button-'+n).disabled=n!==1&&!this.profile;}
  this.callbacks.step?.(step);this.refresh();
 }
 refresh(){
  if(!this.profile)return;const status=this.callbacks.clearance(this.profile.id);const can=status.allowed;
  this.$('clearance-panel').classList.toggle('danger',!can);this.$('clearance-panel').classList.toggle('clearance-approved',can);
  this.$('clearance-status').textContent=can?'Физиологические показатели в норме. Допуск к штатным работам получен.':'ВНИМАНИЕ: допуск к работам ограничен.';
  this.$('clearance-reasons').textContent=can?'Требования конкретного задания и готовность резерва проверяются отдельно.':status.reasons.join('; ');
  this.$('to-flight-tasks').disabled=!can;this.$('step-button-3').disabled=!can;
  if(can)this.lastMedicalAlert=null;
  const missingExam=!status.member?.dailyExam||status.member.dailyExam.day!==status.member.medicalDay;this.$('recovery-panel').hidden=can||missingExam;if(missingExam)this.$('clearance-status').textContent='Для допуска запишите обязательный медосмотр за сегодня.';this.$('recovery-warning').textContent='Выход в открытый космос и тяжёлые работы приостановлены. Учебная передача телеметрии в медблок ЦУП отмечается в журнале; реальной связи с Землёй нет.';
  const alertKey=this.profile.id+':'+status.reasons.join('|');if(!can&&!missingExam&&this.lastMedicalAlert!==alertKey){this.lastMedicalAlert=alertKey;this.callbacks.message('УЧЕБНАЯ ТЕЛЕМЕТРИЯ В МЕДБЛОК ЦУП: '+this.profile.name+'. '+status.reasons.join('; ')+'. Реальная передача не выполнялась.');}
  this.$('start-scenario').disabled=!!this.callbacks.running?.();
  this.$('profile-storage-warning').textContent=this.vault.warning;
  if(!can&&this.step===3){this.step=2;this.$('step-health').hidden=false;this.$('step-flight').hidden=true;this.$('step-button-2').classList.toggle('active',true);this.$('step-button-3').classList.toggle('active',false);this.$('step-hint').textContent='Допуск изменился. Вернитесь к мониторингу и повторной проверке.';}
  const progress=this.callbacks.progress(this.profile.id);this.$('personal-progress').textContent=`Личный прогресс: ${progress.completed} заданий · ${progress.seconds} с наблюдения.`;
 }
 beginRecovery(){
  if(!this.profile||this.recoveryTimer)return;this.remaining=15;this.$('recover-rest').disabled=true;this.callbacks.message('УЧЕБНЫЙ ПРОТОКОЛ: отдых и стабилизация дыхания. 15 минут представлены 15 секундами симуляции.');
  this.$('recovery-feedback').textContent='Выполняется учебный протокол: 15 с (модель 15 мин). Показатели будут проверены повторно; доза не уменьшается.';
  this.recoveryTimer=setInterval(()=>{this.remaining--;this.$('recovery-progress').value=15-this.remaining;this.$('recovery-feedback').textContent='Учебное восстановление: осталось '+this.remaining+' с.';if(this.remaining<=0){clearInterval(this.recoveryTimer);this.recoveryTimer=null;this.$('recover-rest').disabled=false;this.$('recovery-feedback').textContent=this.callbacks.recover(this.profile.id);this.refresh();}},1000);
 }
 recheck(){if(!this.profile)return;this.$('recovery-feedback').textContent=this.callbacks.recheck(this.profile.id);this.refresh();}
 save(){if(this.profile)this.vault.save(this.profile.id,this.callbacks.snapshot());}
 logout(){this.save();if(this.recoveryTimer){clearInterval(this.recoveryTimer);this.recoveryTimer=null;}this.callbacks.logout();this.profile=null;this.pending=null;this.pin='';this.hasEnteredFlight=false;this.$('pin-screen').hidden=true;this.$('profile-cards').hidden=false;this.$('header-session').hidden=true;this.$('auth-panel').hidden=false;this.$('recover-rest').disabled=false;this.$('recovery-progress').value=0;this.navigate(1);}
}
