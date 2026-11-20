"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const WebSocket = require("ws");

const TOKEN = "truth-dare-ci-test-token";
const PORT = 3123;
const HOST = "127.0.0.1";
const SERVER_PATH = path.join(__dirname, "truth-dare-server.js");

function makeInitData(id, name) {
  const user = JSON.stringify({ id, first_name: name });
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user });
  const checkString = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}
function client(id,name){
  const ws=new WebSocket("ws://"+HOST+":"+PORT+"/ws?initData="+encodeURIComponent(makeInitData(id,name)));
  const c={ws,events:[],waiters:[]};
  ws.on("message",raw=>{
    let data;try{data=JSON.parse(raw.toString());}catch{return;}
    const i=c.waiters.findIndex(w=>w.type===data.type && (!w.predicate||w.predicate(data)));
    if(i>=0){const w=c.waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(data);}else c.events.push(data);
  });
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("WebSocket connect timed out")),6000);
    ws.once("open",()=>{clearTimeout(timer);resolve(c);});
    ws.once("error",err=>{clearTimeout(timer);reject(err);});
  });
}
function waitEvent(c,type,predicate=()=>true,timeout=7000){
  const i=c.events.findIndex(e=>e.type===type&&predicate(e));
  if(i>=0)return Promise.resolve(c.events.splice(i,1)[0]);
  return new Promise((resolve,reject)=>{
    const w={type,predicate,resolve,timer:setTimeout(()=>{const j=c.waiters.indexOf(w);if(j>=0)c.waiters.splice(j,1);reject(new Error("Timed out waiting for "+type+"; buffered events: "+JSON.stringify(c.events.map(e=>({type:e.type,code:e.code,phase:e.phase})))));},timeout)};
    c.waiters.push(w);
  });
}
function send(c,msg){c.ws.send(JSON.stringify(msg));}
async function health(){
  const res=await fetch("http://"+HOST+":"+PORT+"/health");
  return res.ok&&((await res.json()).service==="truth-dare-matchmaking");
}

test("authenticated 2-player game spins, challenge verification, scoring, chat, and RTC relay", {timeout:30000}, async t=>{
  const server=spawn(process.execPath,[SERVER_PATH],{cwd:__dirname,env:{...process.env,BOT_TOKEN:TOKEN,TRUTH_DARE_HOST:HOST,TRUTH_DARE_PORT:String(PORT),ALLOWED_ORIGINS:"https://meetstrangers4u-miniapp-v2.vercel.app"},stdio:["ignore","pipe","pipe"]});
  let serverLogs="";
  server.stdout.on("data",b=>serverLogs+=b.toString());
  server.stderr.on("data",b=>serverLogs+=b.toString());
  t.after(async()=>{
    for(const c of t.clients||[]){try{c.ws.close();}catch{}}
    if(server.exitCode===null){server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));}
  });
  let healthy=false;
  for(let i=0;i<80&&!healthy;i++){await new Promise(r=>setTimeout(r,125));try{healthy=await health();}catch{}}
  assert.ok(healthy,"server health failed; logs: "+serverLogs);

  const a=await client("101","Alice"), b=await client("202","Bob");
  t.clients=[a,b];
  await Promise.all([waitEvent(a,"connected"),waitEvent(b,"connected")]);
  send(a,{type:"queue",playerCount:2,mode:"normal"});
  send(b,{type:"queue",playerCount:2,mode:"normal"});
  await Promise.all([waitEvent(a,"room-formed"),waitEvent(b,"room-formed")]);
  send(a,{type:"ready",ready:true});
  await Promise.all([waitEvent(a,"ready-update"),waitEvent(b,"ready-update")]);
  send(b,{type:"ready",ready:true});
  await Promise.all([waitEvent(a,"game-start"),waitEvent(b,"game-start")]);
  await Promise.all([waitEvent(a,"game-state"),waitEvent(b,"game-state")]);

  send(a,{type:"spin"});
  const [spinA,spinB]=await Promise.all([waitEvent(a,"bottle-spin"),waitEvent(b,"bottle-spin")]);
  assert.equal(spinA.selectedId,spinB.selectedId);
  const selected=spinA.selectedId==="101"?a:b, verifier=selected===a?b:a;
  send(selected,{type:"choose-challenge",choice:"truth"});
  const [challengeA,challengeB]=await Promise.all([waitEvent(a,"challenge"),waitEvent(b,"challenge")]);
  assert.equal(challengeA.challenge.id,challengeB.challenge.id);
  send(selected,{type:"submit-task"});
  await Promise.all([waitEvent(a,"task-submitted"),waitEvent(b,"task-submitted")]);
  send(verifier,{type:"verify-vote",vote:"yes"});
  const [voteA,voteB]=await Promise.all([waitEvent(a,"verification-update"),waitEvent(b,"verification-update")]);
  assert.equal(voteA.yes,1);assert.equal(voteB.yes,1);
  const [resultA,resultB]=await Promise.all([waitEvent(a,"challenge-result"),waitEvent(b,"challenge-result")]);
  assert.equal(resultA.accepted,true);assert.equal(resultB.accepted,true);
  const expected=challengeA.challenge.type==="truth"?25:50;
  assert.equal(resultA.delta,expected);
  assert.equal(resultA.scores[spinA.selectedId],expected);

  send(a,{type:"chat",text:"CI chat message"});
  const chat=await waitEvent(b,"chat-message",m=>m.text==="CI chat message");
  assert.equal(chat.playerId,"101");

  send(a,{type:"rtc-signal",to:"202",signal:{type:"offer",description:{type:"offer",sdp:"test-sdp"}}});
  const rtc=await waitEvent(b,"rtc-signal");
  assert.equal(rtc.from,"101");assert.equal(rtc.signal.type,"offer");
});

test("multi-player private-room decline keeps room open and host can replace invite; lobby voice signaling works", {timeout:25000}, async t=>{
  const server=spawn(process.execPath,[SERVER_PATH],{cwd:__dirname,env:{...process.env,BOT_TOKEN:TOKEN,TRUTH_DARE_HOST:HOST,TRUTH_DARE_PORT:String(PORT),TRUTH_DARE_TEST_MODE:"1",ALLOWED_ORIGINS:"https://meetstrangers4u-miniapp-v2.vercel.app"},stdio:["ignore","pipe","pipe"]});
  let logs="";server.stdout.on("data",b=>logs+=b.toString());server.stderr.on("data",b=>logs+=b.toString());
  t.after(async()=>{for(const c of t.clients||[]){try{c.ws.close();}catch{}}if(server.exitCode===null){server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));}});
  let ok=false;for(let i=0;i<80&&!ok;i++){await new Promise(r=>setTimeout(r,125));try{ok=await health();}catch{}}
  assert.ok(ok,"multi-player decline test server health failed: "+logs);
  const host=await client("51001","DeclineHost");t.clients=[host];await waitEvent(host,"connected");
  send(host,{type:"create-custom-room",mode:"normal",inviteIds:["51002","51003"]});
  const created=await waitEvent(host,"custom-room-created");
  const guest=await client("51002","JoinedGuest");t.clients.push(guest);await waitEvent(guest,"connected");
  send(guest,{type:"join-custom-room",token:created.testInviteTokens[0]});
  await waitEvent(guest,"custom-joined");
  const declineUrl="http://"+HOST+":"+PORT+"/invite/decline?token="+encodeURIComponent(created.testInviteTokens[1]);
  const response=await fetch(declineUrl);assert.equal(response.status,200);assert.match(await response.text(),/Invitation declined/);
  const hostNotice=await waitEvent(host,"invite-declined");
  assert.equal(hostNotice.inviteeId,"51003");assert.equal(hostNotice.closeRoom,false);
  assert.match(hostNotice.inviteeName,/Decline|51003/);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(guest.events.some(e=>e.type==="room-closed"),false,"room must remain open after a multi-player decline");
  send(host,{type:"host-add-invite",inviteeId:"51004"});
  const sent=await waitEvent(host,"custom-invite-sent");
  assert.equal(sent.inviteeId,"51004");assert.equal(sent.sent,false);assert.ok(sent.testInviteToken);
  const replacement=await client("51004","ReplacementGuest");t.clients.push(replacement);await waitEvent(replacement,"connected");
  send(replacement,{type:"join-custom-room",token:sent.testInviteToken});
  await Promise.all([waitEvent(replacement,"custom-joined"),waitEvent(host,"room-formed"),waitEvent(guest,"room-formed")]);
  send(host,{type:"voice-status",active:true});
  const [voiceHost,voiceGuest]=await Promise.all([waitEvent(host,"voice-joined"),waitEvent(guest,"voice-joined")]);
  assert.equal(voiceHost.playerId,"51001");assert.equal(voiceGuest.playerId,"51001");
  send(host,{type:"rtc-signal",to:"51004",signal:{type:"offer",description:{type:"offer",sdp:"lobby-voice-test"}}});
  const rtc=await waitEvent(replacement,"rtc-signal");
  assert.equal(rtc.from,"51001");assert.equal(rtc.signal.type,"offer");
  send(host,{type:"host-add-invite",inviteeId:"51005"});
  const nonHostErr=await waitEvent(guest,"error",e=>e.code==="HOST_ONLY_INVITE");
  assert.equal(nonHostErr.code,"HOST_ONLY_INVITE");
});

test("two-player private-room decline closes the room and notifies host", {timeout:15000}, async t=>{
  const server=spawn(process.execPath,[SERVER_PATH],{cwd:__dirname,env:{...process.env,BOT_TOKEN:TOKEN,TRUTH_DARE_HOST:HOST,TRUTH_DARE_PORT:String(PORT),TRUTH_DARE_TEST_MODE:"1",ALLOWED_ORIGINS:"https://meetstrangers4u-miniapp-v2.vercel.app"},stdio:["ignore","pipe","pipe"]});
  let logs="";server.stdout.on("data",b=>logs+=b.toString());server.stderr.on("data",b=>logs+=b.toString());
  t.after(async()=>{for(const c of t.clients||[]){try{c.ws.close();}catch{}}if(server.exitCode===null){server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));}});
  let ok=false;for(let i=0;i<80&&!ok;i++){await new Promise(r=>setTimeout(r,125));try{ok=await health();}catch{}}
  assert.ok(ok,"two-player decline test server health failed: "+logs);
  const host=await client("52001","TwoPlayerHost");t.clients=[host];await waitEvent(host,"connected");
  send(host,{type:"create-custom-room",mode:"normal",inviteIds:["52002"]});
  const created=await waitEvent(host,"custom-room-created");
  const url="http://"+HOST+":"+PORT+"/invite/decline?token="+encodeURIComponent(created.testInviteTokens[0]);
  const response=await fetch(url);assert.equal(response.status,200);
  const notice=await waitEvent(host,"invite-declined");
  assert.equal(notice.inviteeId,"52002");assert.equal(notice.closeRoom,true);
  assert.equal(roomsNotRelevant,undefined);
});

test("private-room host can create an invite-only room and invalid invitations are rejected", {timeout:15000}, async t=>{
  const server=spawn(process.execPath,[SERVER_PATH],{cwd:__dirname,env:{...process.env,BOT_TOKEN:TOKEN,TRUTH_DARE_HOST:HOST,TRUTH_DARE_PORT:String(PORT),TRUTH_DARE_TEST_MODE:"1",ALLOWED_ORIGINS:"https://meetstrangers4u-miniapp-v2.vercel.app"},stdio:["ignore","pipe","pipe"]});
  let logs="";
  server.stdout.on("data",b=>logs+=b.toString());server.stderr.on("data",b=>logs+=b.toString());
  t.after(async()=>{for(const c of t.clients||[]){try{c.ws.close();}catch{}}if(server.exitCode===null){server.kill("SIGTERM");await new Promise(resolve=>server.once("exit",resolve));}});
  let ok=false;for(let i=0;i<80&&!ok;i++){await new Promise(r=>setTimeout(r,125));try{ok=await health();}catch{}}
  assert.ok(ok,"private test server health failed: "+logs);
  const host=await client("50001","RoomHost");t.clients=[host];await waitEvent(host,"connected");
  send(host,{type:"create-custom-room",mode:"normal",inviteIds:["50002"]});
  const created=await waitEvent(host,"custom-room-created");
  assert.equal(created.playerCount,2);assert.equal(created.players.length,1);assert.equal(created.players[0].id,"50001");
  assert.equal(created.testInviteTokens.length,1,"test server exposes invite token only in test mode");
  const sent=await waitEvent(host,"custom-invites-sent");
  assert.equal(sent.sent,0);assert.equal(sent.failed,1,"test mode simulates unavailable Telegram delivery");
  const guest=await client("50002","InvitedGuest");t.clients.push(guest);await waitEvent(guest,"connected");
  send(guest,{type:"join-custom-room",token:created.testInviteTokens[0]});
  const [joined,hostForm,guestForm]=await Promise.all([waitEvent(guest,"custom-joined"),waitEvent(host,"room-formed"),waitEvent(guest,"room-formed")]);
  assert.equal(joined.playerCount,2);assert.equal(hostForm.players.length,2);assert.equal(guestForm.roomId,hostForm.roomId);
  send(host,{type:"ready",ready:true});await Promise.all([waitEvent(host,"ready-update"),waitEvent(guest,"ready-update")]);
  send(guest,{type:"ready",ready:true});
  await Promise.all([waitEvent(host,"game-start"),waitEvent(guest,"game-start"),waitEvent(host,"game-state"),waitEvent(guest,"game-state")]);
  send(host,{type:"create-custom-room",mode:"normal",inviteIds:["50001"]});
  const err=await waitEvent(host,"error",e=>e.code==="INVALID_INVITE_IDS");
  assert.equal(err.code,"INVALID_INVITE_IDS");
  send(host,{type:"join-custom-room",token:"invalid-token"});
  const joinErr=await waitEvent(host,"error",e=>e.code==="INVITE_EXPIRED");
  assert.equal(joinErr.code,"INVITE_EXPIRED");
});
