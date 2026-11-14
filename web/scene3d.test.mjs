import test from 'node:test';
import assert from 'node:assert/strict';
import {MissionScene} from './dist/scene3d.mjs';
test('WebGL renderer draws every task/scenario with finite transforms and handles camera controls',()=>{
 let draws=0,frames=0;const listeners={};
 const gl=new Proxy({}, {get(_,key){if(key==='getShaderParameter'||key==='getProgramParameter')return ()=>true;if(key==='getAttribLocation')return ()=>0;if(key==='getUniformLocation')return ()=>({});if(key==='uniformMatrix4fv')return (_loc,_transpose,m)=>{assert.equal(m.length,16);assert.ok([...m].every(Number.isFinite));};if(key==='uniform3fv')return (_loc,v)=>assert.ok([...v].every(Number.isFinite));if(key==='drawArrays')return ()=>draws++;if(String(key).startsWith('create'))return ()=>({});if(String(key).toUpperCase()===key)return 1;return ()=>{};}});
 const labels={};globalThis.document={getElementById:id=>labels[id]??=( {})};globalThis.window={devicePixelRatio:1,matchMedia:()=>({matches:false})};globalThis.requestAnimationFrame=()=>frames++;
 const canvas={width:0,height:0,getContext:()=>gl,getBoundingClientRect:()=>({width:800,height:430}),addEventListener:(id,fn)=>listeners[id]=fn,setPointerCapture(){}};
 const scene=new MissionScene(canvas,{hidden:true});assert.ok(scene.gl);
 for(const scenario of ['station','surface','emergency'])for(const task of ['repair','eva','research','evacuation']){scene.update({scenario,task,status:'working',progress:.6,team:task==='eva'?2:1,alert:true});const before=draws;scene.frame(1000+frames*16);assert.ok(draws>before);}
 listeners.pointerdown({clientX:10,clientY:10,pointerId:1});listeners.pointermove({clientX:30,clientY:20});listeners.pointerup();listeners.wheel({deltaY:100,preventDefault(){}});listeners.keydown({key:'ArrowLeft',preventDefault(){}});scene.frame(2000);assert.ok(Number.isFinite(scene.azimuth));assert.ok(labels['scene-task-label'].textContent.includes('ВОЗВРАЩЕНИЕ'));
 scene.update({scenario:'station',task:'repair',status:'paused',progress:.1,team:1});const time=scene.time;scene.frame(3000);assert.equal(scene.time,time);
 delete globalThis.document;delete globalThis.window;delete globalThis.requestAnimationFrame;
});
test('missing WebGL exposes fallback and leaves the application usable',()=>{const canvas={getContext:()=>null,hidden:false},fallback={hidden:true};const scene=new MissionScene(canvas,fallback);assert.equal(scene.gl,null);assert.equal(fallback.hidden,false);assert.equal(canvas.hidden,true);});
